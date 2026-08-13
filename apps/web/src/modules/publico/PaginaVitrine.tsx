import { useState, useEffect, useMemo, type FormEvent } from 'react';
import { useParams } from 'react-router-dom';
import { Search, PackageSearch, ShoppingCart, Check, Clock, Info } from 'lucide-react';
import { Logo } from '../../components/interface/Logo.js';
import { Input } from '../../components/interface/Input.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { CartaoProduto } from '../../components/comercial/CartaoProduto.js';
import { SeletorTamanho } from '../../components/comercial/SeletorTamanho.js';
import { api } from '../../services/api.js';
import { formatBRL } from '../../lib/utils.js';
import { observacaoDeCores, juntarObservacao } from '../../lib/observacaoCores.js';
import type { ApiResponse, ProductWithPrice, SessaoVitrine } from '@csb/shared';
import { precoDoTamanho } from '@csb/shared';

interface Linha {
  product_id: string;
  variant_id: string | null;
  size: string;
  sku: string;
  nome: string;
  quantidade: number;
  preco: number;
  color_code?: string | null;
  color_name?: string | null;
}

// Não filtre por prefixo de código: os 2xxx não são só da Plumene, e o prefixo
// escondia 4 referências ativas da Corpo Sensual. Ver PaginaCatalogo.tsx.

/** Quanto falta para o link expirar, em texto curto. */
function faltam(ate: string): string {
  const ms = new Date(ate).getTime() - Date.now();
  if (ms <= 0) return 'expirado';
  const horas = Math.floor(ms / 3600_000);
  const minutos = Math.floor((ms % 3600_000) / 60_000);
  return horas > 0 ? `${horas}h${minutos > 0 ? ` ${minutos}min` : ''}` : `${minutos}min`;
}

/**
 * Vitrine temporária — catálogo aberto por link, sem conta.
 *
 * De propósito NÃO usa o authStore nem o Dexie: a sessão é anônima e morre com
 * o link, então nada dela pode se misturar com a conta de quem usa o app no
 * mesmo aparelho (o representante, por exemplo).
 */
export function PaginaVitrine() {
  const { token = '' } = useParams();

  const [sessao, setSessao] = useState<SessaoVitrine | null>(null);
  const [erroLink, setErroLink] = useState('');
  const [carregando, setCarregando] = useState(true);

  const [produtos, setProdutos] = useState<ProductWithPrice[]>([]);
  const [busca, setBusca] = useState('');
  const [picker, setPicker] = useState<ProductWithPrice | null>(null);
  const [linhas, setLinhas] = useState<Linha[]>([]);

  const [fechando, setFechando] = useState(false);
  const [nome, setNome] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [enviando, setEnviando] = useState(false);
  const [erro, setErro] = useState('');
  const [enviado, setEnviado] = useState(false);

  // Troca o token do link por uma sessão e já busca o catálogo.
  useEffect(() => {
    let cancelado = false;
    api
      .post<ApiResponse<SessaoVitrine>>(`/public/showcase/${token}`, {})
      .then(async (res) => {
        if (cancelado) return;
        setSessao(res.data);
        const cat = await api.get<ApiResponse<ProductWithPrice[]>>('/products', res.data.token);
        if (!cancelado) setProdutos(cat.data);
      })
      .catch((e: unknown) => {
        if (!cancelado) setErroLink(e instanceof Error ? e.message : 'Não foi possível abrir o catálogo.');
      })
      .finally(() => {
        if (!cancelado) setCarregando(false);
      });
    return () => {
      cancelado = true;
    };
  }, [token]);

  const visiveis = useMemo(() => {
    const q = busca.trim().toLowerCase();
    return produtos
      .filter((p) => p.active && !!p.image_url)
      .filter((p) => !q || p.name.toLowerCase().includes(q) || p.sku.toLowerCase().includes(q))
      .sort((a, b) => a.sku.localeCompare(b.sku, 'pt-BR', { numeric: true }));
  }, [produtos, busca]);

  const pecas = linhas.reduce((n, l) => n + l.quantidade, 0);
  const total = linhas.reduce((t, l) => t + l.quantidade * l.preco, 0);

  const enviar = async (e: FormEvent) => {
    e.preventDefault();
    setErro('');
    const digitos = whatsapp.replace(/\D/g, '');
    if (nome.trim().length < 2) {
      setErro('Informe o nome da sua loja.');
      return;
    }
    if (digitos.length < 10 || digitos.length > 11) {
      setErro('Informe o WhatsApp com DDD.');
      return;
    }

    setEnviando(true);
    try {
      await api.post(
        '/orders',
        {
          guest_name: nome.trim(),
          guest_whatsapp: whatsapp,
          // O ERP recebe tudo como sortido; a cor escolhida vai na observação.
          notes: juntarObservacao(undefined, observacaoDeCores(linhas)),
          items: linhas.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id ?? undefined,
            quantity: l.quantidade,
            unit_price: l.preco,
          })),
        },
        sessao!.token,
      );
      setEnviado(true);
    } catch (err) {
      setErro(err instanceof Error ? err.message : 'Não foi possível enviar o pedido.');
      setEnviando(false);
    }
  };

  if (carregando) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <Spinner />
      </div>
    );
  }

  if (erroLink) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center">
          <Logo className="mx-auto mb-6 h-20 w-20" />
          <p className="text-sm text-foreground">{erroLink}</p>
        </div>
      </div>
    );
  }

  if (enviado) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background p-4">
        <div className="w-full max-w-sm text-center">
          <div className="mx-auto mb-5 flex h-14 w-14 items-center justify-center rounded-full bg-positive-soft text-positive-soft-foreground">
            <Check className="h-7 w-7" strokeWidth={2.5} />
          </div>
          <h1 className="titulo mb-2 text-[26px] leading-none text-foreground">Pedido enviado</h1>
          <p className="text-sm text-muted-foreground">
            {sessao?.rep_name ? `${sessao.rep_name} vai` : 'O representante vai'} conferir e falar com você no
            WhatsApp informado.
          </p>
          <p className="mt-5 rounded-lg bg-muted px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
            Este link foi encerrado agora — cada link vale por um pedido. Para fazer outro, é só pedir um
            novo {sessao?.rep_name ? `a ${sessao.rep_name}` : 'ao representante'}.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background pb-28">
      <header className="sticky top-0 z-40 border-b border-border bg-card safe-top">
        <div className="mx-auto flex max-w-6xl items-center gap-2.5 px-4 py-3">
          <Logo className="h-10 w-10 shrink-0" />
          <div className="min-w-0 flex-1">
            <p className="titulo text-[18px] leading-none text-foreground">Corpo Sensual</p>
            <p className="mt-0.5 truncate text-[11px] text-muted-foreground">
              {sessao?.rep_name ? `Catálogo de ${sessao.rep_name}` : 'Catálogo'}
            </p>
          </div>
          {sessao && (
            <span className="flex shrink-0 items-center gap-1 rounded bg-muted px-2 py-1 text-[11px] font-medium text-muted-foreground">
              <Clock className="h-3 w-3" strokeWidth={2.5} />
              {faltam(sessao.expires_at)}
            </span>
          )}
        </div>
      </header>

      <main className="mx-auto max-w-6xl p-4">
        <div className="relative mb-4">
          <Search
            className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground"
            strokeWidth={2}
          />
          <Input
            type="search"
            inputMode="search"
            placeholder="Buscar por nome ou referência…"
            value={busca}
            onChange={(e) => setBusca(e.target.value)}
            className="pl-9"
          />
        </div>

        {produtos.length === 0 ? (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {Array.from({ length: 8 }).map((_, i) => (
              <Skeleton key={i} className="aspect-[3/5] w-full rounded-lg" />
            ))}
          </div>
        ) : visiveis.length === 0 ? (
          <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
            <PackageSearch className="h-7 w-7 text-subtle" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">Nenhum produto encontrado.</p>
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-x-3 gap-y-6 sm:grid-cols-3 lg:grid-cols-4">
            {visiveis.map((p, i) => (
              <CartaoProduto
                key={p.id}
                product={p}
                showStock={false}
                prioritaria={i < 6}
                inOrder={linhas.some((l) => l.product_id === p.id)}
                onAdd={() => setPicker(p)}
              />
            ))}
          </div>
        )}
      </main>

      {pecas > 0 && !fechando && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card p-3 safe-bottom">
          <div className="mx-auto flex max-w-6xl items-center gap-3">
            <div className="min-w-0 flex-1">
              <p className="tnum text-sm font-semibold text-foreground">{formatBRL(total)}</p>
              <p className="tnum text-xs text-muted-foreground">
                {pecas} {pecas === 1 ? 'peça' : 'peças'}
              </p>
            </div>
            <Button size="lg" onClick={() => setFechando(true)}>
              <ShoppingCart className="h-4 w-4" strokeWidth={2.5} />
              Fechar pedido
            </Button>
          </div>
        </div>
      )}

      {fechando && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center sm:items-center">
          <div className="absolute inset-0 bg-foreground/40" onClick={() => setFechando(false)} aria-hidden />
          <div className="animate-slide-up relative w-full max-w-md rounded-t-2xl bg-card p-5 sm:rounded-2xl">
            <h2 className="titulo mb-1 text-[22px] leading-none text-foreground">Quase lá</h2>
            <p className="mb-3 text-sm text-muted-foreground">
              O representante precisa saber com quem falar para confirmar o pedido.
            </p>
            {/* Antes de enviar, não depois: o link vale por um pedido, e a
                pessoa tem que saber disso enquanto ainda dá para adicionar. */}
            <p className="mb-4 flex items-start gap-2 rounded-lg bg-warn-soft px-3 py-2 text-xs leading-relaxed text-warn-soft-foreground">
              <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2.5} />
              <span>
                Confira se está tudo aqui: <strong>ao enviar, este link deixa de funcionar</strong> e o
                pedido segue para o representante.
              </span>
            </p>

            <form onSubmit={(e) => void enviar(e)} className="space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="nome" className="text-sm font-medium text-foreground">
                  Nome da loja
                </label>
                <Input id="nome" value={nome} onChange={(e) => setNome(e.target.value)} required />
              </div>

              <div className="space-y-1.5">
                <label htmlFor="zap" className="text-sm font-medium text-foreground">
                  WhatsApp
                </label>
                <Input
                  id="zap"
                  value={whatsapp}
                  onChange={(e) => setWhatsapp(e.target.value)}
                  inputMode="tel"
                  placeholder="(00) 00000-0000"
                  required
                />
              </div>

              <div className="flex items-center justify-between rounded-lg bg-muted px-3 py-2">
                <span className="tnum text-sm text-muted-foreground">
                  {pecas} {pecas === 1 ? 'peça' : 'peças'}
                </span>
                <span className="tnum text-base font-semibold text-foreground">{formatBRL(total)}</span>
              </div>

              {erro && (
                <p className="rounded-lg bg-danger-soft px-3 py-2 text-sm text-danger-soft-foreground">{erro}</p>
              )}

              <Button type="submit" size="lg" className="w-full" disabled={enviando}>
                {enviando ? (
                  <>
                    <Spinner />
                    Enviando…
                  </>
                ) : (
                  'Enviar pedido'
                )}
              </Button>
              <button
                type="button"
                onClick={() => setFechando(false)}
                className="w-full text-center text-sm text-muted-foreground hover:text-foreground"
              >
                Continuar escolhendo
              </button>
            </form>
          </div>
        </div>
      )}

      {picker && (
        <SeletorTamanho
          product={picker}
          onClose={() => setPicker(null)}
          onConfirm={(escolhido, escolhas) =>
            setLinhas((atuais) => {
              const proximas = [...atuais];
              for (const e of escolhas) {
                // A cor entra na chave: 3 na azul e 2 na rosa são duas linhas,
                // senão a observação sairia com uma cor só e a quantidade errada.
                const i = proximas.findIndex(
                  (l) =>
                    l.product_id === escolhido.id &&
                    l.size === e.size &&
                    (l.color_code ?? null) === (e.color_code ?? null),
                );
                if (i >= 0) {
                  proximas[i] = { ...proximas[i]!, quantidade: proximas[i]!.quantidade + e.quantity };
                } else {
                  proximas.push({
                    product_id: escolhido.id,
                    variant_id: e.variant_id,
                    size: e.size,
                    sku: escolhido.sku,
                    nome: escolhido.name,
                    quantidade: e.quantity,
                    preco: precoDoTamanho(e.size, escolhido.price, escolhido.price_larger) ?? 0,
                    color_code: e.color_code ?? null,
                    color_name: e.color_name ?? null,
                  });
                }
              }
              return proximas;
            })
          }
        />
      )}
    </div>
  );
}
