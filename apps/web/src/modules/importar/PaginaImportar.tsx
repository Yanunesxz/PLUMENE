import { useRef, useState } from 'react';
import { read, utils, writeFile } from 'xlsx';
import { UploadCloud, FileSpreadsheet, Download, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useAuthStore } from '../../store/authStore.js';
import { api } from '../../services/api.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import type { ApiResponse } from '@csb/shared';

// ─────────────────────────────────────────────────────────────────────────────
// Importação de catálogo (admin) — para fábricas que usam o sistema sem o
// sincronizador de ERP. Planilha (.xlsx/.csv) → prévia validada → API.
// ─────────────────────────────────────────────────────────────────────────────

interface ParsedRow {
  sku: string;
  name: string;
  price?: number;
  sizes?: { size: string; stock: number }[];
  image_url?: string;
  group?: string;
  /** Problema de validação da linha (linha inválida não é enviada). */
  error?: string;
}

interface ImportSummary {
  products_created: number;
  products_updated: number;
  variants_upserted: number;
  prices_set: number;
  price_table: string;
  warnings: string[];
}

// Aceita cabeçalhos flexíveis (referencia/sku/código, nome/descrição, etc.)
const HEADER_MAP: Record<string, keyof ParsedRow | 'sizes_raw' | 'stock_raw'> = {
  sku: 'sku', referencia: 'sku', 'referência': 'sku', codigo: 'sku', 'código': 'sku', ref: 'sku',
  nome: 'name', name: 'name', descricao: 'name', 'descrição': 'name', produto: 'name',
  preco: 'price', 'preço': 'price', valor: 'price', price: 'price',
  tamanhos: 'sizes_raw', grade: 'sizes_raw', tamanho: 'sizes_raw', sizes: 'sizes_raw',
  estoque: 'stock_raw', stock: 'stock_raw', quantidade: 'stock_raw',
  foto: 'image_url', imagem: 'image_url', foto_url: 'image_url', image_url: 'image_url',
  grupo: 'group', categoria: 'group', group: 'group', colecao: 'group', 'coleção': 'group',
};

/** "P:10, M:20" ou "P,M,G" (+estoque padrão) → lista de tamanhos. */
function parseSizes(raw: string, defaultStock: number): { size: string; stock: number }[] {
  return raw
    .split(/[,;/]/)
    .map((part) => part.trim())
    .filter(Boolean)
    .map((part) => {
      const [size, qty] = part.split(':').map((s) => s.trim());
      return { size: (size ?? '').toUpperCase(), stock: qty ? Math.max(0, parseInt(qty, 10) || 0) : defaultStock };
    })
    .filter((s) => s.size.length > 0);
}

function parseWorkbook(buf: ArrayBuffer): ParsedRow[] {
  const wb = read(buf, { type: 'array' });
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  if (!sheet) return [];
  const rows = utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: '' });

  return rows.map((row) => {
    const mapped: Partial<ParsedRow> & { sizes_raw?: string; stock_raw?: string } = {};
    for (const [key, value] of Object.entries(row)) {
      const target = HEADER_MAP[key.trim().toLowerCase()];
      if (!target) continue;
      const text = String(value ?? '').trim();
      if (!text) continue;
      if (target === 'price') {
        const n = Number(text.replace(/[R$\s.]/g, '').replace(',', '.'));
        if (Number.isFinite(n) && n >= 0) mapped.price = Math.round(n * 100) / 100;
      } else if (target === 'sizes_raw' || target === 'stock_raw') {
        mapped[target] = text;
      } else {
        (mapped as Record<string, unknown>)[target] = text;
      }
    }

    const defaultStock = Math.max(0, parseInt(mapped.stock_raw ?? '0', 10) || 0);
    const sizes = mapped.sizes_raw ? parseSizes(mapped.sizes_raw, defaultStock) : undefined;

    const out: ParsedRow = {
      sku: (mapped.sku ?? '').toUpperCase(),
      name: mapped.name ?? '',
      ...(mapped.price != null ? { price: mapped.price } : {}),
      ...(sizes?.length ? { sizes } : {}),
      ...(mapped.image_url ? { image_url: mapped.image_url } : {}),
      ...(mapped.group ? { group: mapped.group } : {}),
    };
    if (!out.sku) out.error = 'Sem referência (SKU)';
    else if (!out.name) out.error = 'Sem nome';
    else if (out.image_url && !/^https?:\/\//i.test(out.image_url)) out.error = 'Foto deve ser um link http(s)';
    return out;
  });
}

function downloadTemplate() {
  const rows = [
    { referencia: '0001', nome: 'PIJAMA EXEMPLO CURTO', preco: 49.9, tamanhos: 'P:10, M:15, G:10', foto_url: '', grupo: 'PIJAMAS' },
    { referencia: '0002', nome: 'CAMISOLA EXEMPLO', preco: 39.9, tamanhos: 'P, M, G, GG', estoque: 5, foto_url: '', grupo: 'CAMISOLAS' },
  ];
  const ws = utils.json_to_sheet(rows);
  const wb = utils.book_new();
  utils.book_append_sheet(wb, ws, 'Produtos');
  writeFile(wb, 'modelo-importacao-produtos.xlsx');
}

export function PaginaImportar() {
  const { token } = useAuthStore();
  const inputRef = useRef<HTMLInputElement>(null);
  const [fileName, setFileName] = useState('');
  const [rows, setRows] = useState<ParsedRow[]>([]);
  const [sending, setSending] = useState(false);
  const [summary, setSummary] = useState<ImportSummary | null>(null);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const valid = rows.filter((r) => !r.error);
  const invalid = rows.filter((r) => r.error);

  const handleFile = async (file: File) => {
    setSummary(null);
    setFileName(file.name);
    try {
      const parsed = parseWorkbook(await file.arrayBuffer());
      setRows(parsed);
      if (parsed.length === 0) setToast({ message: 'Planilha vazia ou sem colunas reconhecidas.', type: 'error' });
    } catch {
      setRows([]);
      setToast({ message: 'Não consegui ler esse arquivo. Use .xlsx ou .csv.', type: 'error' });
    }
  };

  const handleImport = async () => {
    if (!token || valid.length === 0 || sending) return;
    setSending(true);
    try {
      const res = await api.post<ApiResponse<ImportSummary>>(
        '/products/import',
        { products: valid.map(({ error: _e, ...p }) => p) },
        token,
      );
      setSummary(res.data);
      setRows([]);
      setFileName('');
      setToast({ message: 'Importação concluída!', type: 'success' });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Erro na importação.', type: 'error' });
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-4 md:p-6">
      <div>
        <h1 className="text-xl font-bold tracking-tight text-foreground md:text-2xl">Importar produtos</h1>
        <p className="text-sm text-muted-foreground">
          Suba o catálogo da sua fábrica por planilha — sem depender de integração com ERP.
        </p>
      </div>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-2 text-sm font-semibold text-foreground">1 · Baixe o modelo</h2>
        <p className="mb-3 text-xs text-muted-foreground">
          Colunas: <strong>referencia</strong> e <strong>nome</strong> (obrigatórias) · preco · tamanhos
          (ex.: <code className="rounded bg-muted px-1">P:10, M:20</code> ou <code className="rounded bg-muted px-1">P, M, G</code> + coluna estoque) · foto_url · grupo.
        </p>
        <Button size="sm" variant="outline" onClick={downloadTemplate}>
          <Download className="h-4 w-4" strokeWidth={2.5} /> Baixar planilha modelo
        </Button>
      </section>

      <section className="rounded-xl border border-border bg-card p-4 shadow-sm">
        <h2 className="mb-3 text-sm font-semibold text-foreground">2 · Envie sua planilha</h2>
        <input
          ref={inputRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          hidden
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void handleFile(f);
            e.target.value = '';
          }}
        />
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="flex w-full flex-col items-center gap-2 rounded-xl border-2 border-dashed border-border py-8 text-center transition-colors hover:border-brand-400 hover:bg-brand-50/40"
        >
          <UploadCloud className="h-8 w-8 text-brand-600" strokeWidth={1.8} />
          <span className="text-sm font-medium text-foreground">
            {fileName ? fileName : 'Toque para escolher o arquivo (.xlsx ou .csv)'}
          </span>
          <span className="text-xs text-muted-foreground">Até 2000 produtos por importação</span>
        </button>

        {rows.length > 0 && (
          <div className="mt-4 space-y-3">
            <div className="flex flex-wrap items-center gap-2 text-sm">
              <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2.5 py-0.5 font-medium text-green-800">
                <CheckCircle2 className="h-3.5 w-3.5" /> {valid.length} válidos
              </span>
              {invalid.length > 0 && (
                <span className="inline-flex items-center gap-1 rounded-full bg-amber-100 px-2.5 py-0.5 font-medium text-amber-800">
                  <AlertTriangle className="h-3.5 w-3.5" /> {invalid.length} com problema (não serão enviados)
                </span>
              )}
            </div>

            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[560px] text-left text-xs">
                <thead className="bg-muted/60 text-muted-foreground">
                  <tr>
                    <th className="px-3 py-2 font-medium">Ref.</th>
                    <th className="px-3 py-2 font-medium">Nome</th>
                    <th className="px-3 py-2 font-medium">Preço</th>
                    <th className="px-3 py-2 font-medium">Tamanhos</th>
                    <th className="px-3 py-2 font-medium">Situação</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {rows.slice(0, 8).map((r, i) => (
                    <tr key={i} className={r.error ? 'bg-amber-50/60' : ''}>
                      <td className="px-3 py-2 font-mono">{r.sku || '—'}</td>
                      <td className="max-w-[220px] truncate px-3 py-2">{r.name || '—'}</td>
                      <td className="px-3 py-2">{r.price != null ? formatBRL(r.price) : 'sob consulta'}</td>
                      <td className="px-3 py-2">{r.sizes?.map((s) => s.size).join(', ') ?? 'U'}</td>
                      <td className="px-3 py-2">
                        {r.error ? <span className="text-amber-700">{r.error}</span> : <span className="text-green-700">ok</span>}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {rows.length > 8 && (
                <p className="border-t border-border px-3 py-2 text-[11px] text-muted-foreground">
                  … e mais {rows.length - 8} linha(s)
                </p>
              )}
            </div>

            <Button onClick={() => void handleImport()} disabled={sending || valid.length === 0} className="w-full sm:w-auto">
              {sending ? <Spinner /> : <FileSpreadsheet className="h-4 w-4" strokeWidth={2.5} />}
              {sending ? 'Importando…' : `Importar ${valid.length} produto(s)`}
            </Button>
          </div>
        )}
      </section>

      {summary && (
        <section className="rounded-xl border border-green-200 bg-green-50 p-4">
          <h2 className="mb-2 flex items-center gap-2 text-sm font-semibold text-green-900">
            <CheckCircle2 className="h-4 w-4" /> Importação concluída
          </h2>
          <ul className="space-y-1 text-sm text-green-900">
            <li>• {summary.products_created} produto(s) criado(s), {summary.products_updated} atualizado(s)</li>
            <li>• {summary.variants_upserted} tamanho(s) gravado(s)</li>
            <li>• {summary.prices_set} preço(s) definidos na tabela “{summary.price_table}”</li>
          </ul>
          {summary.warnings.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-100/70 p-3 text-xs text-amber-900">
              <p className="mb-1 font-semibold">Avisos:</p>
              {summary.warnings.map((w, i) => (
                <p key={i}>• {w}</p>
              ))}
            </div>
          )}
        </section>
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
