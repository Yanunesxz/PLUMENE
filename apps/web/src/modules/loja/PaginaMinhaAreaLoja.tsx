import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  ShoppingBag,
  Package,
  Wallet,
  Receipt,
  RotateCcw,
  Clock,
  ChevronRight,
  MessageCircle,
  Info,
  Store,
  CalendarClock,
  WifiOff,
} from 'lucide-react';
import { db } from '../../offline/db.js';
import { api } from '../../services/api.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { useCartStore } from '../../store/cartStore.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button, buttonVariants } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { CartaoInstalar } from '../../components/interface/CartaoInstalar.js';
import { cn, formatBRL } from '../../lib/utils.js';
import { STATUS_VARIANTE } from '../../lib/pedido.js';
import { ORDER_STATUS_LABELS } from '@csb/shared';
import type { ApiResponse, MinhaAreaLoja, PecaComprada, ProductWithPrice } from '@csb/shared';

/**
 * A última resposta boa fica no aparelho.
 *
 * A loja abre isto na loja dela, muitas vezes sem sinal. Guardar o payload
 * inteiro (são 12 peças e 10 pedidos, cabe folgado) é o que faz a tela abrir
 * offline com o histórico de ontem em vez de um aviso de erro. Fora do Dexie de
 * propósito: é UMA linha por usuário, não uma coleção para consultar.
 */
const CACHE_KEY = 'csb-minha-area-loja';

function lerCache(userId: string | undefined): MinhaAreaLoja | null {
  if (!userId) return null;
  try {
    const cru = localStorage.getItem(`${CACHE_KEY}:${userId}`);
    return cru ? (JSON.parse(cru) as MinhaAreaLoja) : null;
  } catch {
    return null;
  }
}

function gravarCache(userId: string | undefined, area: MinhaAreaLoja): void {
  if (!userId) return;
  try {
    localStorage.setItem(`${CACHE_KEY}:${userId}`, JSON.stringify(area));
  } catch {
    /* aparelho sem espaço: a tela funciona online do mesmo jeito */
  }
}

/**
 * "Minha área" da loja.
 *
 * A loja não abre isto para estudar relatório: abre para saber se está na hora
 * de comprar de novo e para repetir o que já comprou. Por isso a primeira coisa
 * da tela é há quanto tempo ela não pede, com o botão de repetir do lado — e o
 * cadastro, que ela olha uma vez por ano, fica no fim.
 */
export function PaginaMinhaAreaLoja() {
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const online = useOnlineStatus();
  const adicionarAoCarrinho = useCartStore((s) => s.add);
  const limparCarrinho = useCartStore((s) => s.clear);

  // Já começa com o que estiver guardado: a tela abre preenchida e só troca
  // quando a resposta nova chega. Sem sinal, é isto que a loja vê.
  const [area, setArea] = useState<MinhaAreaLoja | null | undefined>(
    () => lerCache(user?.id) ?? undefined,
  );
  const [desatualizado, setDesatualizado] = useState(false);
  const [repetindo, setRepetindo] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const produtos = useLiveQuery(() => db.products.toArray(), []);

  useEffect(() => {
    if (!token) return;
    api
      .get<ApiResponse<MinhaAreaLoja>>('/minha-area', token)
      .then((r) => {
        setArea(r.data);
        setDesatualizado(false);
        gravarCache(user?.id, r.data);
      })
      .catch(() => {
        const guardado = lerCache(user?.id);
        setArea(guardado);
        setDesatualizado(guardado !== null);
      });
  }, [token, user?.id]);

  const primeiroNome = (area?.conta.trade_name ?? area?.conta.name ?? user?.name ?? '')
    .trim()
    .split(/\s+/)[0];

  /**
   * Repete a última compra: mesma grade, mesmo sortimento.
   *
   * Os preços vêm do catálogo de HOJE, nunca do pedido antigo — o servidor
   * recalcula tudo mesmo assim, e mostrar um preço vencido na montagem só
   * criaria surpresa no total.
   */
  const repetirCompra = async () => {
    if (!area || area.repetir.length === 0) return;
    setRepetindo(true);
    try {
      let catalogo = produtos ?? [];
      if (catalogo.length === 0 && token) {
        const r = await api.get<ApiResponse<ProductWithPrice[]>>('/products', token);
        await db.products.bulkPut(r.data);
        catalogo = r.data;
      }

      const porId = new Map(catalogo.map((p) => [p.id, p]));
      let adicionados = 0;
      let foraDeLinha = 0;

      limparCarrinho();
      for (const item of area.repetir) {
        const produto = porId.get(item.product_id);
        // Peça tirada de linha (ou sem preço na tabela da loja) não entra: ela
        // derrubaria o pedido inteiro na hora de enviar.
        if (!produto || !produto.active || produto.price == null) {
          foraDeLinha += 1;
          continue;
        }
        const tamanho = item.variant_id
          ? ((produto.variants ?? []).find((v) => v.id === item.variant_id)?.size ?? '')
          : '';
        adicionarAoCarrinho({
          product_id: produto.id,
          variant_id: item.variant_id,
          size: tamanho,
          product_name: produto.name,
          sku: produto.sku,
          quantity: item.quantity,
          unit_price: produto.price,
        });
        adicionados += 1;
      }

      if (adicionados === 0) {
        setToast({ message: 'As peças do último pedido não estão mais disponíveis.', type: 'error' });
        return;
      }
      if (foraDeLinha > 0) {
        setToast({
          message: `${foraDeLinha} peça(s) saíram de linha e ficaram de fora.`,
          type: 'info',
        });
      }
      navigate('/orders/new');
    } catch {
      setToast({ message: 'Não conseguimos montar o pedido agora. Tente de novo.', type: 'error' });
    } finally {
      setRepetindo(false);
    }
  };

  if (area === undefined) {
    return (
      <div className="space-y-3 p-4 md:p-6">
        <Skeleton className="h-24 w-full rounded-xl" />
        <Skeleton className="h-28 w-full rounded-xl" />
        <Skeleton className="h-40 w-full rounded-xl" />
      </div>
    );
  }

  if (area === null) {
    return (
      <div className="p-4 md:p-6">
        <h1 className="titulo mb-2 text-[26px] leading-none text-foreground md:text-[32px]">Minha área</h1>
        <p className="text-sm text-muted-foreground">
          {online
            ? 'Não conseguimos carregar seus dados agora. Tente de novo em instantes.'
            : 'Você está sem internet e ainda não temos seus dados guardados neste aparelho. Abra esta tela uma vez com conexão.'}
        </p>
        <Link
          to="/catalog"
          className={cn('mt-4 inline-flex', buttonVariants({ size: 'sm', variant: 'outline' }))}
        >
          Abrir o catálogo
        </Link>
      </div>
    );
  }

  const { conta, resumo, pecas, pedidos } = area;
  const podeRepetir = area.repetir.length > 0;

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">
          Olá{primeiroNome ? `, ${primeiroNome}` : ''}
        </h1>
        <p className="text-sm text-muted-foreground">
          {conta.rep_name ? `Seu representante é ${conta.rep_name}` : 'Sua área de compras'}
        </p>
      </div>

      {desatualizado && (
        <p className="flex items-center gap-2 rounded-lg border border-warn/30 bg-warn-soft px-3 py-2 text-xs font-medium text-warn-soft-foreground">
          <WifiOff className="h-4 w-4 shrink-0" strokeWidth={2.5} />
          Sem internet — mostrando os dados da última vez que você abriu.
        </p>
      )}

      <UltimaCompra
        dias={resumo.dias_desde_ultimo}
        quando={resumo.ultimo_pedido_em}
        podeRepetir={podeRepetir}
        repetindo={repetindo}
        onRepetir={() => void repetirCompra()}
      />

      {resumo.aguardando > 0 && (
        <div className="flex items-center gap-3 rounded-xl border border-primary/30 bg-primary-soft p-4">
          <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-card text-primary-soft-foreground">
            <Clock className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-sm font-medium text-foreground">
              {resumo.aguardando} pedido{resumo.aguardando > 1 ? 's' : ''} em análise
            </p>
            <p className="text-xs text-muted-foreground">
              {conta.rep_name ?? 'Seu representante'} está conferindo. Você é avisado assim que sair.
            </p>
          </div>
        </div>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Cartao icon={Package} tint="brand" valor={String(resumo.total_pecas)} rotulo="Peças compradas" />
        <Cartao icon={Receipt} tint="brand" valor={String(resumo.total_pedidos)} rotulo="Pedidos feitos" />
        <Cartao icon={Wallet} tint="green" valor={formatBRL(resumo.total_gasto)} rotulo="Total comprado" />
        <Cartao icon={ShoppingBag} tint="brand" valor={formatBRL(resumo.ticket_medio)} rotulo="Média por pedido" />
      </div>

      {pecas.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            O que você mais compra
          </h2>
          <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {pecas.map((peca) => (
              <LinhaPeca key={peca.product_id} peca={peca} />
            ))}
          </ul>
        </section>
      )}

      <section>
        <div className="mb-3 flex items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            Seus pedidos
          </h2>
          {pedidos.length > 0 && (
            <Link to="/orders" className="text-xs font-semibold text-primary-soft-foreground">
              Ver todos
            </Link>
          )}
        </div>

        {pedidos.length === 0 ? (
          <div className="flex flex-col items-center gap-3 rounded-xl border border-dashed border-border py-10 text-center">
            <ShoppingBag className="h-8 w-8 text-muted-foreground" strokeWidth={1.5} />
            <p className="text-sm text-muted-foreground">
              Seu primeiro pedido aparece aqui assim que você enviar.
            </p>
            <Link to="/catalog" className={cn(buttonVariants({ size: 'sm', variant: 'outline' }))}>
              Abrir o catálogo
            </Link>
          </div>
        ) : (
          <ul className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
            {pedidos.map((pedido) => (
              <li key={pedido.id}>
                <Link
                  to={`/orders/${pedido.id}`}
                  className="flex items-center justify-between gap-3 border-b border-border px-4 py-3 transition-colors last:border-b-0 hover:bg-muted"
                >
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-sm font-medium text-foreground">
                      <span className="font-mono text-xs text-muted-foreground">
                        #{pedido.order_number ?? pedido.id.slice(0, 8)}
                      </span>
                      <Badge variant={STATUS_VARIANTE[pedido.status]}>
                        {ORDER_STATUS_LABELS[pedido.status]}
                      </Badge>
                    </p>
                    <p className="mt-0.5 text-xs text-muted-foreground">
                      {new Date(pedido.created_at).toLocaleDateString('pt-BR', {
                        day: '2-digit',
                        month: 'short',
                        year: 'numeric',
                      })}
                      {pedido.pecas > 0 && ` · ${pedido.pecas} peças`}
                    </p>
                  </div>
                  <span className="flex shrink-0 items-center gap-1 text-sm font-semibold text-foreground">
                    {formatBRL(pedido.total)}
                    <ChevronRight className="h-4 w-4 text-muted-foreground" />
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </section>

      <CartaoInstalar />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sua conta
        </h2>

        <div className="mb-3 flex items-center gap-3 rounded-xl border border-border bg-card p-4">
          <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
            <Store className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold text-foreground">{conta.name}</p>
            {conta.trade_name && (
              <p className="truncate text-sm text-muted-foreground">{conta.trade_name}</p>
            )}
          </div>
        </div>

        <dl className="overflow-hidden rounded-xl border border-border bg-card">
          <Linha rotulo="CNPJ" valor={conta.cnpj} mono />
          <Linha rotulo="WhatsApp" valor={conta.whatsapp} />
          <Linha rotulo="E-mail de acesso" valor={user?.email} />
          <Linha rotulo="Representante" valor={conta.rep_name} />
        </dl>

        {conta.rep_whatsapp && (
          <a
            href={`https://wa.me/55${conta.rep_whatsapp.replace(/\D/g, '')}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-positive/40 hover:bg-positive-soft"
          >
            <span className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive-soft-foreground">
                <MessageCircle className="h-5 w-5" strokeWidth={2} />
              </span>
              <span className="min-w-0">
                <span className="block text-sm font-medium text-foreground">
                  Falar com {conta.rep_name ?? 'o representante'}
                </span>
                <span className="block text-xs text-muted-foreground">
                  Dúvida no pedido, prazo ou cadastro
                </span>
              </span>
            </span>
            <span className="shrink-0 text-xs font-semibold text-positive-soft-foreground">Abrir</span>
          </a>
        )}

        <p className="mt-3 flex items-start gap-2 px-1 text-xs text-muted-foreground">
          <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" strokeWidth={2} />
          Para corrigir qualquer dado acima — inclusive a senha — fale com o seu representante.
        </p>
      </section>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

/**
 * O destaque da tela: há quanto tempo a loja não compra.
 *
 * Passando de dois meses o cartão muda de cor. Não é enfeite — é o lembrete que
 * o representante daria por telefone, aparecendo sozinho.
 */
function UltimaCompra({
  dias,
  quando,
  podeRepetir,
  repetindo,
  onRepetir,
}: {
  dias: number | null;
  quando: string | null;
  podeRepetir: boolean;
  repetindo: boolean;
  onRepetir: () => void;
}) {
  const frio = dias !== null && dias >= 60;

  const frase =
    dias === null
      ? 'Você ainda não fez nenhum pedido por aqui'
      : dias === 0
        ? 'Você comprou hoje'
        : dias === 1
          ? 'Sua última compra foi ontem'
          : `Sua última compra foi há ${dias} dias`;

  return (
    <div
      className={`rounded-xl border p-4 shadow-sm ${
        frio ? 'border-warn/40 bg-warn-soft' : 'border-border bg-card'
      }`}
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 items-center gap-3">
          <span
            className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-full ${
              frio ? 'bg-card text-warn-soft-foreground' : 'bg-primary-soft text-primary-soft-foreground'
            }`}
          >
            <CalendarClock className="h-5 w-5" strokeWidth={2} />
          </span>
          <div className="min-w-0">
            <p className="text-[15px] font-semibold text-foreground">{frase}</p>
            <p className="text-xs text-muted-foreground">
              {quando
                ? `Em ${new Date(quando).toLocaleDateString('pt-BR', {
                    day: '2-digit',
                    month: 'long',
                    year: 'numeric',
                  })}`
                : 'Monte um pedido pelo catálogo quando quiser.'}
            </p>
          </div>
        </div>

        {podeRepetir && (
          <Button size="md" disabled={repetindo} onClick={onRepetir} className="shrink-0">
            <RotateCcw className="h-4 w-4" strokeWidth={2.5} />
            {repetindo ? 'Montando…' : 'Repetir última compra'}
          </Button>
        )}
      </div>
    </div>
  );
}

function LinhaPeca({ peca }: { peca: PecaComprada }) {
  return (
    <li className="flex items-center gap-3 border-b border-border px-4 py-3 last:border-b-0">
      {peca.image_url ? (
        <img
          src={peca.image_url}
          alt=""
          loading="lazy"
          className="h-12 w-12 shrink-0 rounded-lg object-cover"
        />
      ) : (
        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-lg bg-muted text-muted-foreground">
          <Package className="h-5 w-5" strokeWidth={1.5} />
        </span>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-foreground">{peca.name}</p>
        <p className="truncate text-xs text-muted-foreground">
          {peca.sku ? `${peca.sku} · ` : ''}
          {peca.vezes === 1 ? 'em 1 pedido' : `em ${peca.vezes} pedidos`}
        </p>
      </div>
      <span className="shrink-0 text-right">
        <span className="block text-sm font-semibold text-foreground">{peca.quantidade}</span>
        <span className="block text-[11px] text-muted-foreground">peças</span>
      </span>
    </li>
  );
}

function Cartao({
  icon: Icon,
  tint,
  valor,
  rotulo,
}: {
  icon: typeof Wallet;
  tint: 'green' | 'brand';
  valor: string;
  rotulo: string;
}) {
  const tints: Record<string, string> = {
    green: 'bg-positive-soft text-positive-soft-foreground',
    brand: 'bg-primary-soft text-primary-soft-foreground',
  };
  return (
    <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
      <div className={`mb-2 flex h-9 w-9 items-center justify-center rounded-full ${tints[tint]}`}>
        <Icon className="h-5 w-5" strokeWidth={2} />
      </div>
      <p className="truncate text-xl font-bold text-foreground">{valor}</p>
      <p className="text-xs text-muted-foreground">{rotulo}</p>
    </div>
  );
}

function Linha({ rotulo, valor, mono }: { rotulo: string; valor: string | null | undefined; mono?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-border px-4 py-3 last:border-b-0">
      <dt className="shrink-0 text-sm text-muted-foreground">{rotulo}</dt>
      <dd
        className={`min-w-0 truncate text-right text-sm font-medium text-foreground ${mono ? 'tnum font-mono' : ''}`}
      >
        {valor?.trim() ? valor : '—'}
      </dd>
    </div>
  );
}
