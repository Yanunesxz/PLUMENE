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
  Sparkles,
  CalendarCheck,
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
import { CartaoAvisos } from '../../components/interface/CartaoAvisos.js';
import { decisaoDoPedido } from '../../lib/pedido.js';
import { situacaoDaCompra } from '../../lib/carteira.js';
import {
  janelaDoFechamento,
  comInicialMaiuscula,
  DIA_LIMITE_DO_FECHAMENTO,
} from '../../lib/fechamento.js';
import { Link } from 'react-router-dom';
import { valorDaVenda } from '@csb/shared';
import type { TarefaDoRep } from '@csb/shared';
import { usePermissao } from '../../hooks/usePermissao.js';
import { formatBRL } from '../../lib/utils.js';
import { MARCA } from '../../lib/marca.js';
import { contaParaAMeta, type Order, type CustomerListItem, type ApiResponse } from '@csb/shared';
import { ReguaDaMeta } from '../../components/comercial/ReguaDaMeta.js';
import { useMinhaMeta } from '../../hooks/useMinhaMeta.js';

// Suporte por WhatsApp — o número vem da configuração da marca (na Corpo
// Sensual é o gerente comercial, que controla senhas e acessos).
const suporteWhatsappUrl = (nome: string) =>
  `https://wa.me/${MARCA.suporteWhatsapp}?text=${encodeURIComponent(
    `Olá! Sou ${nome || 'representante'} e preciso de ajuda no app ${MARCA.nome}.`,
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

  // ─── O que pediram para você (tarefas do escritório) ───────────────────────
  const [tarefas, setTarefas] = useState<TarefaDoRep[]>([]);
  const [tarefaOcupada, setTarefaOcupada] = useState<string | null>(null);

  const carregarTarefas = (t: string) =>
    api
      .get<ApiResponse<TarefaDoRep[]>>('/tarefas', t)
      .then((r) => setTarefas(r.data))
      .catch(() => {});

  useEffect(() => {
    if (token) void carregarTarefas(token);
  }, [token]);

  const agirNaTarefa = async (id: string, status: 'confirmada' | 'feita') => {
    if (!token || tarefaOcupada) return;
    setTarefaOcupada(id);
    try {
      await api.patch<ApiResponse<{ ok: boolean }>>(`/tarefas/${id}`, { status }, token);
      setTarefas((ts) => ts.map((t) => (t.id === id ? { ...t, status } : t)));
      setToast({
        message: status === 'feita' ? 'Tarefa concluída!' : 'OK enviado — quem marcou já sabe.',
        type: 'success',
      });
    } catch (err) {
      setToast({ message: err instanceof Error ? err.message : 'Não deu para atualizar.', type: 'error' });
    } finally {
      setTarefaOcupada(null);
    }
  };

  const tarefasAbertas = tarefas.filter((t) => t.status !== 'feita');

  // ─── Relatório da carteira — só quando pedem ───────────────────────────────
  // Por padrão quem escreve é o PRÓPRIO APP, com os números da carteira (custo
  // zero). Se um dia houver chave de IA no servidor, ela assume — e o rodapé
  // diz quem fez, porque relatório de conta não finge ser IA.
  const [relatorio, setRelatorio] = useState('');
  const [motorDoRelatorio, setMotorDoRelatorio] = useState('');
  const [gerandoRelatorio, setGerandoRelatorio] = useState(false);

  const gerarRelatorio = async () => {
    if (!token || gerandoRelatorio) return;
    setGerandoRelatorio(true);
    try {
      const r = await api.post<ApiResponse<{ relatorio: string; clientes: number; motor: string }>>(
        '/ia/relatorio-carteira',
        {},
        token,
      );
      setRelatorio(r.data.relatorio);
      setMotorDoRelatorio(r.data.motor);
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'A IA não respondeu — tente de novo.',
        type: 'error',
      });
    } finally {
      setGerandoRelatorio(false);
    }
  };

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
    // O fechamento do mês que terminou — só entre os dias 1 e 10.
    const janela = janelaDoFechamento(now);
    const faturadoMesPassado = invoiced
      .filter((o) => janela.contem(o.invoiced_at))
      .reduce((s, o) => s + valorDaVenda(o), 0);
    const pedidosMesPassado = invoiced.filter((o) => janela.contem(o.invoiced_at)).length;
    // Pelo valor da NOTA quando o ERP informa: o financeiro corta o que faltou
    // no estoque, e mostrar o total do pedido faria o representante contar
    // dinheiro que a fábrica não faturou.
    const faturadoMes = invoiced
      .filter((o) => thisMonth(o.invoiced_at as string))
      .reduce((s, o) => s + valorDaVenda(o), 0);
    const faturadoTotal = invoiced.reduce((s, o) => s + valorDaVenda(o), 0);
    return {
      // A bonificação conta o que ele ENVIOU no mês, não o que a fábrica já
      // faturou — são coisas diferentes, e o aviso da fábrica é explícito.
      enviadoNoMes: list
        .filter((o) => thisMonth(o.created_at) && contaParaAMeta(o.status))
        .reduce((s, o) => s + (o.total ?? 0), 0),
      faturadoMes,
      faturadoTotal,
      // Fechamento do mês passado: valor, quantidade e a janela que o esconde.
      faturadoMesPassado,
      pedidosMesPassado,
      janela,
      pedidosMes: list.filter((o) => thisMonth(o.created_at)).length,
      totalPedidos: list.length,
      ticket: approved.length ? approved.reduce((s, o) => s + (o.total ?? 0), 0) / approved.length : 0,
      taxaAprovacao: list.length ? Math.round((approved.length / list.length) * 100) : 0,
      vendasTotais: list.reduce((s, o) => s + (o.total ?? 0), 0),
    };
  }, [orders]);

  const clientes = customers?.length ?? 0;
  // Nascidos no app e ainda sem o número do Control — a fila de inclusão.
  const clientesSemCodigo = useMemo(() => (customers ?? []).filter((c) => !c.erp_id).length, [customers]);
  const firstName = user?.name?.trim().split(' ')[0] ?? '';
  const mesAtual = new Date().toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });

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

  // A saúde da carteira, para o aviso lá embaixo.
  const carteira = useMemo(() => {
    let parados = 0;
    let esfriando = 0;
    let vencido = 0;
    for (const c of customers ?? []) {
      const s = situacaoDaCompra(c.last_purchase_at);
      if (s.nivel === 'parado') parados++;
      if (s.nivel === 'esfriando') esfriando++;
      vencido += c.overdue_amount ?? 0;
    }
    return { parados, esfriando, vencido };
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
        {/* Nomeia o mês: os números logo abaixo são todos dele. Caixa alta só
            na primeira letra — o `capitalize` do CSS viraria "Setembro De". */}
        <p className="text-sm text-muted-foreground">{comInicialMaiuscula(mesAtual)}</p>
      </div>

      {/* O escritório manda, você executa: a visita que a Bruna marcou, a
          tarefa que o Fabian pediu. OK = "vi e topei o horário"; Feito fecha. */}
      {tarefasAbertas.length > 0 && (
        <section>
          <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
            O que pediram para você
          </h2>
          <ul className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {tarefasAbertas.map((t) => (
              <li key={t.id} className="rounded-xl border border-border bg-card p-4 shadow-sm">
                <p className="text-sm font-medium text-foreground">{t.titulo}</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  {t.criado_por_nome ? `pedido por ${t.criado_por_nome}` : 'pedido pelo escritório'}
                  {t.prazo
                    ? ` · ${new Date(t.prazo).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' })} às ${new Date(t.prazo).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}`
                    : ''}
                </p>
                {t.cliente_nome && (
                  <p className="truncate text-xs text-muted-foreground">Cliente: {t.cliente_nome}</p>
                )}
                {t.local && (
                  <p className="truncate text-xs text-muted-foreground">Local: {t.local}</p>
                )}
                {t.observacoes && (
                  <p className="mt-1.5 whitespace-pre-wrap rounded-lg bg-muted px-2.5 py-1.5 text-xs text-muted-foreground">
                    {t.observacoes}
                  </p>
                )}
                <div className="mt-3 flex gap-2">
                  {t.status === 'pendente' && t.prazo && (
                    <Button
                      size="sm"
                      variant="outline"
                      className="flex-1"
                      disabled={tarefaOcupada === t.id}
                      onClick={() => void agirNaTarefa(t.id, 'confirmada')}
                    >
                      Dar OK no horário
                    </Button>
                  )}
                  <Button
                    size="sm"
                    className="flex-1 bg-positive hover:bg-positive/90 active:bg-positive/80"
                    disabled={tarefaOcupada === t.id}
                    onClick={() => void agirNaTarefa(t.id, 'feita')}
                  >
                    Feito
                  </Button>
                </div>
                {t.status === 'confirmada' && (
                  <p className="mt-2 text-[11px] text-positive-soft-foreground">
                    Você deu OK — quem marcou já sabe.
                  </p>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

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

      {/* Tudo aqui é DESTE mês. O acumulado de sempre vive lá embaixo, em
          "Desempenho": misturar o total de todos os tempos com o número do mês
          na mesma fileira fazia o mesmo valor aparecer duas vezes com nomes
          diferentes — foi confusão de verdade na tela da Simone (01/09/2026). */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricCard icon={Receipt} tint="brand" value={formatBRL(m.faturadoMes)} label="Faturado no mês" />
        <MetricCard icon={TrendingUp} tint="green" value={formatBRL(m.enviadoNoMes)} label="Enviado no mês" />
        <MetricCard icon={Users} tint="brand" value={String(clientes)} label="Meus clientes" />
        <MetricCard icon={ShoppingCart} tint="brand" value={String(m.pedidosMes)} label="Pedidos no mês" />
      </div>

      {/* O fechamento do mês que terminou — a nota sai depois do pedido, então
          o número só fica completo na virada. Fica à vista até o dia 10 e some
          sozinho: passado isso, o mês corrente é o que importa, e dois números
          lado a lado confundem quem bate meta. */}
      {m.janela.visivel && m.faturadoMesPassado > 0 && (
        <section>
          <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                <CalendarCheck className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">
                  Fechamento de {comInicialMaiuscula(m.janela.mes)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {m.pedidosMesPassado} pedido{m.pedidosMesPassado > 1 ? 's' : ''} faturado
                  {m.pedidosMesPassado > 1 ? 's' : ''} · fica aqui até o dia {DIA_LIMITE_DO_FECHAMENTO}
                </p>
              </div>
            </div>
            <p className="tnum text-xl font-bold text-foreground">{formatBRL(m.faturadoMesPassado)}</p>
          </div>
        </section>
      )}

      {/* A fila da Larissa: cliente cadastrado pelo app ainda sem o número do
          Control. Ela inclui lá e volta pra atrelar — o toque abre a lista já
          filtrada. Só pra quem inclui (financeiro; admin como válvula). */}
      {(user?.role === 'financeiro' || user?.role === 'admin') && clientesSemCodigo > 0 && (
        <Link
          to="/customers?erp=sem"
          className="block rounded-xl border border-primary/30 bg-primary-soft p-4 transition-colors hover:border-primary/60"
        >
          <p className="text-sm font-semibold text-primary-soft-foreground">
            {clientesSemCodigo} cliente{clientesSemCodigo > 1 ? 's' : ''} para incluir no Control
          </p>
          <p className="mt-0.5 text-xs text-primary-soft-foreground/80">
            Cadastrados pelo app, ainda sem código do ERP. Toque para ver e atrelar os números.
          </p>
        </Link>
      )}

      {/* A saúde da carteira: quem parou de comprar é venda esperando visita.
          O toque cai na lista de Clientes já filtrada nos parados. */}
      {(carteira.parados > 0 || carteira.esfriando > 0) && (
        <Link
          to="/customers?frescor=parado"
          className="block rounded-xl border border-warn/30 bg-warn-soft p-4 transition-colors hover:border-warn/60"
        >
          <p className="text-sm font-semibold text-warn-soft-foreground">
            {carteira.parados > 0
              ? `${carteira.parados} cliente${carteira.parados > 1 ? 's' : ''} sem comprar há 6+ meses`
              : `${carteira.esfriando} cliente${carteira.esfriando > 1 ? 's' : ''} esfriando`}
          </p>
          <p className="mt-0.5 text-xs text-warn-soft-foreground/80">
            {carteira.parados > 0 && carteira.esfriando > 0
              ? `E mais ${carteira.esfriando} esfriando (3–6 meses). `
              : ''}
            {carteira.vencido > 0 ? `${formatBRL(carteira.vencido)} vencidos na carteira. ` : ''}
            Toque para ver quem visitar primeiro.
          </p>
        </Link>
      )}

      {/* O relatório é gerado na hora e SÓ quando alguém pede — nada analisa a
          carteira em segundo plano. Precisa de internet. */}
      <section>
        <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-3">
              <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary-soft text-primary-soft-foreground">
                <Sparkles className="h-5 w-5" strokeWidth={2} />
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-foreground">Relatório da carteira</p>
                <p className="text-xs text-muted-foreground">
                  Quem procurar primeiro, com os números da sua carteira.
                </p>
              </div>
            </div>
            <Button
              size="sm"
              variant="outline"
              disabled={gerandoRelatorio || !isOnline}
              onClick={() => void gerarRelatorio()}
            >
              {gerandoRelatorio ? <Spinner /> : <Sparkles className="h-4 w-4" strokeWidth={2.5} />}
              {gerandoRelatorio ? 'Analisando…' : relatorio ? 'Gerar de novo' : 'Gerar relatório'}
            </Button>
          </div>
          {relatorio && (
            <>
              <div className="mt-4 whitespace-pre-wrap rounded-lg bg-muted p-3.5 text-sm leading-relaxed text-foreground">
                {relatorio}
              </div>
              <p className="mt-2 text-[11px] text-muted-foreground">
                {motorDoRelatorio === 'app'
                  ? 'Feito pelo app com os números da carteira.'
                  : `Escrito por IA (${motorDoRelatorio === 'chatgpt' ? 'ChatGPT' : 'Claude'}) sobre os números da carteira.`}
              </p>
            </>
          )}
        </div>
      </section>

      <ReguaDaMeta enviadoNoMes={m.enviadoNoMes} faixas={faixasDoMes} />

      <CartaoInstalar />

      <CartaoAvisos />

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

      {/* A seção do ACUMULADO — o único lugar da tela que soma todos os meses.
          O título diz isso na cara, para ninguém ler um número daqui achando
          que é do mês. */}
      <section>
        <h2 className="mb-3 text-sm font-semibold uppercase tracking-wide text-muted-foreground">
          Desde o começo
        </h2>
        <div className="overflow-hidden rounded-xl border border-border bg-card shadow-sm">
          <Row icon={Wallet} label="Faturado (todos os meses)" value={formatBRL(m.faturadoTotal)} highlight />
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
                Senha, acesso ou dúvidas · WhatsApp {MARCA.suporteWhatsappLabel}
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
