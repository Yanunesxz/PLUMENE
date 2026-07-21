import { supabase } from '../../config/supabase.js';

// ─────────────────────────────────────────────────────────────────────────────
// Upload de foto de produto (base64) → Supabase Storage (CDN), por empresa.
// O navegador já redimensiona a imagem antes de enviar; aqui só validamos o
// tamanho, isolamos por company_id e gravamos products.image_url.
// ─────────────────────────────────────────────────────────────────────────────

const BUCKET = 'product-images';

/** Tamanho máximo por foto (já redimensionada). Protege contra upload gigante. */
export const MAX_IMAGE_BYTES = 2 * 1024 * 1024; // 2 MB

export type PhotoResult =
  | { ok: true; url: string }
  | { ok: false; reason: 'not_found' | 'too_large' | 'error'; detail?: string };

export async function uploadProductPhoto(
  company_id: string,
  skuRaw: string,
  imageBase64: string,
): Promise<PhotoResult> {
  const sku = skuRaw.trim().toUpperCase();

  // Aceita tanto "data:image/...;base64,XXXX" quanto só o "XXXX".
  const b64 = imageBase64.includes(',') ? (imageBase64.split(',').pop() ?? '') : imageBase64;
  const buffer = Buffer.from(b64, 'base64');
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

  const path = `${company_id}/${sku}.jpg`;
  const { error: upErr } = await supabase.storage.from(BUCKET).upload(path, buffer, {
    contentType: 'image/jpeg',
    upsert: true,
    cacheControl: '31536000',
  });
  if (upErr) return { ok: false, reason: 'error', detail: upErr.message };

  const { data: pub } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = pub.publicUrl;

  await supabase
    .from('products')
    .update({ image_url: url, updated_at: new Date().toISOString() })
    .eq('id', (product as { id: string }).id);

  return { ok: true, url };
}
