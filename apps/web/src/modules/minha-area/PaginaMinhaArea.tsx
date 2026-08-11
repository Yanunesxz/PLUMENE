import { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import {
  Receipt,
  Wallet,
  Users,
  ShoppingCart,
  TrendingUp,
  Percent,
  Target,
  RefreshCw,
  CheckCircle2,
  CloudOff,
  MessageCircle,
} from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { useDecidirPedido } from '../../hooks/useDecidirPedido.js';
import { api } from '../../services/api.js';
import { flushSyncQueue } from '../../offline/sync.js';
import { Button } from '../../components/interface/Button.js';
import { Spinner } from '../../components/interface/Spinner.js';
import { Toast } from '../../components/interface/Toast.js';
import { CartaoDecisao } from '../../components/comercial/CartaoDecisao.js';
import { CartaoInstalar } from '../../components/interface/CartaoInstalar.js';
import { CartaoAtualizar } from '../../components/interface/CartaoAtualizar.js';
import { decisaoDoPedido } from '../../lib/pedido.js';
import { usePermissao } from '../../hooks/usePermissao.js';
import { formatBRL } from '../../lib/utils.js';
import { contaParaAMeta, type Order, type CustomerListItem, type ApiResponse } from '@csb/shared';
import { ReguaDaMeta } from '../../components/comercial/ReguaDaMeta.js';
import { useMinhaMeta } from '../../hooks/useMinhaMeta.js';

// Gerente comercial (suporte) por WhatsApp — número (55) 32 9 9849-3177.
// É quem controla senhas e acessos; o rep fala com ele por aqui.
const SUPORTE_WHATSAPP = '5532998493177';
const SUPORTE_WHATSAPP_LABEL = '(32) 9 9849-3177';
const suporteWhatsappUrl = (nome: string) =>
  `https://wa.me/${SUPORTE_WHATSAPP}?text=${encodeURIComponent(
    `Olá! Sou ${nome || 'representante'} e preciso de ajuda no app Corpo Sensual.`,
  )}`;

export function PaginaMinhaArea() {
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();
  // Só estreita o gerente: para o representante a tecla não existe e vem `true`.
  const podeAprovar = usePermissao('aprovar_pedidos');
  // Faixas de bônus deste representante neste mês — quem cadastra é o gerente.
  const faixasDoMes = useMinhaMeta();
  const orders = useLiveQuery(() => db.orders.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const pendingSync = useLiveQuery(() => db.sync_queue.count(), []) ?? 0;
  const [syncing, setSyncing] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' | 'info' } | null>(null);

  const handleSync = async () => {
    if (!token || syncing) return;
    setSyncing(true);
    try {
      const { synced, failed } = await flushSyncQueue(token);
      if (synced > 0) {
        const r = await api.get<ApiResponse<Order[]>>('/orders', token);
        await db.orders.bulkPut(r.data);
      }
      setToast(
        failed > 0
          ? { message: `${failed} pedido(s) não sincronizaram. Vamos tentar de novo.`, type: 'error' }
          : synced > 0
            ? { message: `${synced} pedido(s) sincronizado(s)!`, type: 'success' }
            : { message: 'Nada para sincronizar.', type: 'info' },
      );
    } catch {
      setToast({ message: 'Erro ao sincronizar. Verifique a conexão.', type: 'error' });
    } finally {
      setSyncing(false);
    }
  };

  useEffect(() => {
    if (!token) return;
    api.get<ApiResponse<Order[]>>('/orders', token).then((r) => db.orders.bulkPut(r.data)).catch(() => {});
    api
      .getLista<ApiResponse<CustomerListItem[]>>('/customers', token)
      .then((r) => db.customers.bulkPut(r.data))
      .catch(() => {});
  }, [token]);

  const m = useMemo(() => {
    const list = orders ?? [];
    const now = new Date();
    const thisMonth = (iso: string) => {
      const d = new Date(iso);
      return d.getMonth() === now.getMonth() && d.getFullYear() === now.getFullYear();
    };
    const invoiced = list.filter((o) => o.invoiced && o.invoiced_at);
    const approved = list.filter((o) => o.status === 'approved');
    const faturadoMes = invoiced
      .filter((o) => thisMonth(o.invoiced_at as string))
      .reduce((s, o) => s + (o.total ?? 0), 0);
    const faturadoTotal = invoiced.reduce((s, o) => s + (o.total ?? 0), 0);
    return {
      // A bonificação conta o que ele ENVIOU no mês, não o que a fábrica já
      // faturou — são coisas diferentes, e o aviso da fábrica é explícito.
      enviadoNoMes: list
        .filter((o) => thisMonth(o.created_at) && contaParaAMeta(o.status))
        .reduce((s, o) => s + (o.total ?? 0), 0),
      faturadoMes,
      faturadoTotal,
      pedidosMes: list.filter((o) => thisMonth(o.created_at)).length,
      totalPedidos: list.length,
      ticket: approved.length ? approved.reduce((s, o) => s + (o.total ?? 0), 0) / approved.length : 0,
      taxaAprovacao: list.length ? Math.round((approved.length / list.length) * 100) : 0,
      vendasTotais: list.reduce((s, o) => s + (o.total ?? 0), 0),
    };
  }, [orders]);

  const clientes = customers?.length ?? 0;
  const firstName = user?.name?.trim().split(' ')[0] ?? '';

  // Pedidos que a loja (ou um link de vitrine) montou e que estão parados
  // esperando ele. É a única coisa da tela com prazo, então vem antes de tudo.
  const triagem = useMemo(
    () => (orders ?? []).filter((o) => o.status === 'pending_rep'),
    [orders],
  );
  const nomePorCliente = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);
  const { decidir, decidindo } = useDecidirPedido((mensagem, erro) =>
    setToast({ message: mensagem, type: erro ? 'error' : 'success' }),
  );

  return (
    <div className="space-y-6 p-4 md:p-6">
      <div>
        <h1 className="titulo text-[26px] leading-none text-foreground md:text-[32px]">
          Olá, {firstName}
        </h1>
        <p className="text-sm text-muted-foreground">Seu desempenho</p>
      </div>

      {triagem.length > 0 && (
        <section>
          <div className="mb-3 flex items-baseline justify-between gap-3">
            <h2 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
              Chegaram para você
            </h2>
            <span className="text-xs font-semibold text-primary-soft-foreground">
              {formatBRL(triagem.reduce((s, o) => s + (o.total ?? 0), 0))}
            </span>
          </div>
          <p className="mb-3 text-sm text-muted-foreground">
            {triagem.length === 1
              ? 'Uma loja montou um pedido pelo catálogo. Você decide se ele vai para a fábrica.'
              : `${triagem.length} lojas montaram pedidos pelo catálogo. Você decide quais vão para a fábrica.`}
          </p>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {triagem.map((order) => {
              const decisao = decisaoDoPedido(user?.role, order.status, podeAprovar);
              if (!decisao) return null;
              return (
                <CartaoDecisao
                  key={order.id}
                  order={order}
                  decisao={decisao}
                  nomePorCliente={nomePorCliente}
                  ocupado={decidindo === order.id}
                  onDecidir={(status) => void decidir(order.id, status)}
                />
              );
            })}
          </ul>
        </section>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Receipt} tint="brand" value={formatBRL(m.faturadoMes)} label="Faturado no mês" />
        <MetricCard icon={Wallet} tint="green" value={formatBRL(m.faturadoTotal)} label="Faturado total" />
        <MetricCard icon={Users} tint="brand" value={String(clientes)} label="Meus clientes" />
        <MetricCard icon={ShoppingCart} tint="brand" value={String(m.pedidosMes)} label="Pedidos no mês" />
      </div>

      <ReguaDaMeta enviadoNoMes={m.enviadoNoMes} faixas={faixasDoMes} />

      <CartaoInstalar />

      <CartaoAtualizar />

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Sincronização
        </h2>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span
                className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${
                  pendingSync > 0 ? 'bg-warn-soft text-warn-soft-foreground' : 'bg-positive-soft text-positive-soft-foreground'
                }`}
              >
                {pendingSync > 0 ? (
                  <CloudOff className="h-5 w-5" strokeWidth={2} />
                ) : (
                  <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
                )}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  {pendingSync > 0
                    ? `${pendingSync} pedido${pendingSync > 1 ? 's' : ''} aguardando sincronização`
                    : 'Tudo sincronizado'}
                </p>
                <p className="text-xs text-muted-foreground">
                  {isOnline
                    ? 'A sincronização é automática ao reconectar.'
                    : 'Você está offline — sincroniza sozinho ao reconectar.'}
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={syncing || !isOnline}
              onClick={() => void handleSync()}
            >
              {syncing ? <Spinner /> : <RefreshCw className="h-4 w-4" strokeWidth={2.5} />}
              {syncing ? 'Sincronizando…' : 'Sincronizar'}
            </Button>
          </div>
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Desempenho
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <Row icon={Wallet} label="Faturado acumulado" value={formatBRL(m.faturadoTotal)} highlight />
          <Row icon={TrendingUp} label="Vendas totais (todos os pedidos)" value={formatBRL(m.vendasTotais)} />
          <Row icon={Target} label="Ticket médio (pedidos aprovados)" value={formatBRL(m.ticket)} />
          <Row icon={Percent} label="Taxa de aprovação" value={`${m.taxaAprovacao}%`} />
          <Row icon={ShoppingCart} label="Total de pedidos" value={String(m.totalPedidos)} last />
        </div>
      </section>

      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Suporte
        </h2>
        <a
          href={suporteWhatsappUrl(user?.name ?? '')}
          target="_blank"
          rel="noopener noreferrer"
          className="flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm transition-colors hover:border-positive/40 hover:bg-positive-soft"
        >
          <span className="flex min-w-0 items-center gap-3">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-positive-soft text-positive-soft-foreground">
              <MessageCircle className="h-5 w-5" strokeWidth={2} />
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-medium text-foreground">Falar com o gerente comercial</span>
              <span className="block text-xs text-muted-foreground">
                Senha, acesso ou dúvidas · WhatsApp {SUPORTE_WHATSAPP_LABEL}
              </span>
            </span>
          </span>
          <span className="shrink-0 text-xs font-semibold text-positive-soft-foreground">Abrir</span>
        </a>
      </section>

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}

function MetricCard({
  icon: Icon,
  tint,
  value,
  label,
}: {
  icon: typeof Wallet;
  tint: 'green' | 'brand';
  value: string;
  label: string;
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
      <p className="truncate text-xl font-bold text-foreground">{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
    </div>
  );
}

function Row({
  icon: Icon,
  label,
  value,
  highlight,
  last,
}: {
  icon: typeof Wallet;
  label: string;
  value: string;
  highlight?: boolean;
  last?: boolean;
}) {
  return (
    <div className={`flex items-center justify-between gap-3 px-4 py-3 ${last ? '' : 'border-b border-border'}`}>
      <span className="flex items-center gap-2.5 text-sm text-muted-foreground">
        <Icon className="h-4 w-4 shrink-0" /> {label}
      </span>
      <span className={`text-sm font-semibold ${highlight ? 'text-primary-soft-foreground' : 'text-foreground'}`}>{value}</span>
    </div>
  );
}
