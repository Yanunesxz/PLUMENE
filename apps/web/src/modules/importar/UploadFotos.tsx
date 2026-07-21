import { useRef, useState } from 'react';
import { ImagePlus, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import type { ApiResponse } from '@csb/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Upload de fotos EM LOTE. A pessoa escolhe vários arquivos nomeados pelo código
// do produto (0001.jpg, MB002.png…). O NAVEGADOR redimensiona cada foto (~1000px,
// JPEG) antes de enviar em base64 — assim o payload já vai pequeno.
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DIM = 1000;
const QUALITY = 0.82;

interface ProcessedImage {
  blob: Blob;
  /** Cor predominante da peça (hex, sem "#") para a bolinha; null se não deu. */
  hex: string | null;
}

/**
 * Cor "da peça": média dos pixels COLORIDOS, ignorando fundo branco/preto e
 * cinzas (baixa saturação) — assim a bolinha reflete a cor do produto, não o
 * fundo do estúdio. Devolve hex sem "#" ou null se a foto for quase toda neutra.
 */
function dominantHex(data: Uint8ClampedArray): string | null {
  let r = 0, g = 0, b = 0, n = 0;
  // amostra 1 a cada 4 pixels (passo 16 no array RGBA) — rápido e suficiente.
  for (let i = 0; i < data.length; i += 16) {
    const R = data[i] ?? 0, G = data[i + 1] ?? 0, B = data[i + 2] ?? 0, A = data[i + 3] ?? 0;
    if (A < 200) continue;
    const max = Math.max(R, G, B), min = Math.min(R, G, B);
    const sat = max === 0 ? 0 : (max - min) / max;
    if (max > 240 && sat < 0.12) continue; // quase branco (fundo)
    if (max < 28) continue; // quase preto (sombra)
    if (sat < 0.15) continue; // cinza sem cor definida
    r += R; g += G; b += B; n += 1;
  }
  if (n < 20) return null; // peça neutra (branca/preta/cinza) — sem cor confiável
  const h = (v: number) => Math.round(v / n).toString(16).padStart(2, '0');
  return `${h(r)}${h(g)}${h(b)}`;
}

/** Redimensiona no navegador, extrai a cor e devolve o JPEG como Blob (binário). */
function processImage(file: File): Promise<ProcessedImage> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      URL.revokeObjectURL(url);
      const scale = Math.min(1, MAX_DIM / Math.max(img.width, img.height));
      const w = Math.max(1, Math.round(img.width * scale));
      const h = Math.max(1, Math.round(img.height * scale));
      const canvas = document.createElement('canvas');
      canvas.width = w;
      canvas.height = h;
      const ctx = canvas.getContext('2d');
      if (!ctx) return reject(new Error('canvas indisponível'));
      ctx.drawImage(img, 0, 0, w, h);
      let hex: string | null = null;
      try {
        hex = dominantHex(ctx.getImageData(0, 0, w, h).data);
      } catch {
        hex = null; // se getImageData falhar (raro), segue sem cor
      }
      canvas.toBlob(
        (blob) => (blob ? resolve({ blob, hex }) : reject(new Error('falha ao gerar a imagem'))),
        'image/jpeg',
        QUALITY,
      );
    };
    img.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('arquivo não é uma imagem válida'));
    };
    img.src = url;
  });
}

/** "0001.jpg" → "0001"; "MB002 (1).png" → "MB002 (1)" (só tira a extensão). */
const skuFromFilename = (name: string): string =>
  name.replace(/\.[^.]+$/, '').trim().toUpperCase();

interface Progress {
  total: number;
  done: number;
  sent: number;
  notFound: string[];
  errors: { sku: string; msg: string }[];
}

export function UploadFotos() {
  const { token } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<Progress | null>(null);

  const handleFiles = async (files: File[]) => {
    if (!token || busy || files.length === 0) return;
    const images = files.filter((f) => f.type.startsWith('image/'));
    setBusy(true);
    const state: Progress = { total: images.length, done: 0, sent: 0, notFound: [], errors: [] };
    setProgress({ ...state });

    for (const file of images) {
      const sku = skuFromFilename(file.name);
      try {
        const { blob, hex } = await processImage(file);
        const q = hex ? `&hex=${hex}` : '';
        await api.postBlob<ApiResponse<{ url: string }>>(
          `/products/fotos?sku=${encodeURIComponent(sku)}${q}`,
          blob,
          token,
        );
        state.sent += 1;
      } catch (err) {
        const code = (err as Error & { code?: string }).code;
        if (code === 'PRODUCT_NOT_FOUND') state.notFound.push(sku);
        else state.errors.push({ sku, msg: err instanceof Error ? err.message : 'erro' });
      } finally {
        state.done += 1;
        setProgress({ ...state, notFound: [...state.notFound], errors: [...state.errors] });
      }
    }
    setBusy(false);
  };

  const pct = progress && progress.total > 0 ? Math.round((progress.done / progress.total) * 100) : 0;

  return (
    <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <h2 className="mb-1 text-sm font-semibold text-foreground">3 · Fotos dos produtos (em lote)</h2>
      <p className="mb-3 text-xs text-muted-foreground">
        Escolha vários arquivos nomeados pela referência do produto — ex.:{' '}
        <code className="rounded bg-muted px-1">0001.jpg</code>,{' '}
        <code className="rounded bg-muted px-1">0002.png</code>. As fotos são reduzidas automaticamente
        (máx. {MAX_DIM}px) e guardadas na nuvem. Importe os produtos primeiro.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept="image/*"
        multiple
        hidden
        onChange={(e) => {
          const fs = Array.from(e.target.files ?? []);
          if (fs.length) void handleFiles(fs);
          e.target.value = '';
        }}
      />

      <Button size="sm" variant="outline" disabled={busy} onClick={() => inputRef.current?.click()}>
        {busy ? <Spinner /> : <ImagePlus className="h-4 w-4" strokeWidth={2.5} />}
        {busy ? 'Enviando fotos…' : 'Escolher fotos'}
      </Button>

      {progress && (
        <div className="mt-4 space-y-3">
          <div>
            <div className="mb-1 flex items-center justify-between text-xs text-muted-foreground">
              <span>{progress.done} de {progress.total}</span>
              <span>{pct}%</span>
            </div>
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
              <div className="h-full rounded-full bg-brand-600 transition-all" style={{ width: `${pct}%` }} />
            </div>
          </div>

          <div className="flex flex-wrap gap-2 text-xs">
            <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 font-medium text-green-800">
              <CheckCircle2 className="h-3.5 w-3.5" /> {progress.sent} enviada(s)
            </span>
            {progress.notFound.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800">
                <AlertTriangle className="h-3.5 w-3.5" /> {progress.notFound.length} sem produto
              </span>
            )}
            {progress.errors.length > 0 && (
              <span className="inline-flex items-center gap-1 rounded-full bg-red-100 px-2.5 py-0.5 font-medium text-red-800">
                <AlertTriangle className="h-3.5 w-3.5" /> {progress.errors.length} com erro
              </span>
            )}
          </div>

          {progress.notFound.length > 0 && (
            <p className="text-xs text-amber-700">
              Sem produto correspondente (confira o nome do arquivo = referência):{' '}
              {progress.notFound.slice(0, 15).join(', ')}
              {progress.notFound.length > 15 ? '…' : ''}
            </p>
          )}
          {!busy && progress.done === progress.total && (
            <p className="text-xs text-muted-foreground">Concluído. As fotos já aparecem no catálogo.</p>
          )}
        </div>
      )}
    </section>
  );
}
