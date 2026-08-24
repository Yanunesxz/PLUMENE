import { supabase } from '../../config/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Upload de foto de produto → Supabase Storage (CDN), por empresa.
// Recebe a imagem já redimensionada como BINÁRIO cru (sem base64). Aqui só
// validamos o tamanho, isolamos por company_id e gravamos products.image_url.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'product-images';

/** Tamanho máximo por foto (já redimensionada). Protege contra upload gigante. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export type PhotoResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_found' | 'too_large' | 'error'; detail?: string };

/** #RGB ou #RRGGBB → normaliza para "#RRGGBB" maiúsculo; inválido → null. */
function normalizeHex(hex: string | undefined): string | null {
  if (!hex) return null;
  const h = hex.trim().replace(/^#/, '');
  if (/^[0-9a-fA-F]{6}$/.test(h)) return `#${h.toUpperCase()}`;
  if (/^[0-9a-fA-F]{3}$/.test(h)) return `#${h.split('').map((c) => c + c).join('').toUpperCase()}`;
  return null;
}

export async function uploadProductPhoto(
  company_id: string,
  skuRaw: string,
  buffer: Buffer,
  colorHexRaw?: string,
): Promise<PhotoResult> {
  const sku = skuRaw.trim().toUpperCase();
  // Nome de arquivo seguro para o Storage: remove separadores de caminho e
  // qualquer caractere estranho. Impede path traversal (ex.: sku "../EMPRESA-X/0001"
  // sobrescrevendo a foto de outra empresa). A busca no banco usa o sku real.
  const safeSku = sku.replace(/[^A-Za-z0-9._-]/g, '_');

  if (buffer.length === 0) return { ok: false, reason: 'error', detail: 'imagem vazia ou inválida' };
  if (buffer.length > MAX_IMAGE_BYTES) return { ok: false, reason: 'too_large' };

  // O produto tem que existir NA EMPRESA: garante isolamento e evita foto órfã.
  const { data: product } = await supabase
    .from('products')
    .select('id')
    .eq('company_id', company_id)
    .eq('sku', sku)
    .maybeSingle();
  if (!product) return { ok: false, reason: 'not_found' };

  const path = `${company_id}/${safeSku}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: '31536000',
  });
  if (upErr) return { ok: false, reason: 'error', detail: upErr.message };

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  // O caminho no Storage é fixo (empresa/SKU.jpg) e o cache é de um ano —
  // reenviar a foto trocava o arquivo mas ninguém via: navegador, service
  // worker e CDN seguravam a versão antiga na MESMA URL. O ?v= com o carimbo
  // do envio faz cada versão ter endereço próprio, e o cache antigo morre só.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  // Grava a URL da foto e, se veio, a cor da bolinha (extraída da foto no navegador).
  const update: Record<string, unknown> = { image_url: url, updated_at: new Date().toISOString() };
  const hex = normalizeHex(colorHexRaw);
  if (hex) update['color_hex'] = hex;

  await supabase.from('products').update(update).eq('id', (product as { id: string }).id);

  return { ok: true, url };
}
