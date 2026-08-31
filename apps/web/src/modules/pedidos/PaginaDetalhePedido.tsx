import { useEffect, useState, useMemo } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useLiveQuery } from 'dexie-react-hooks';
import { ArrowLeft, Package, WifiOff, MessageCircle, Trash2, Check, X, Pencil, Minus, Plus } from 'lucide-react';
import { db } from '../../offline/db.js';
import { useAuthStore } from '../../store/authStore.js';
import { useOnlineStatus } from '../../hooks/useOnlineStatus.js';
import { useDecidirPedido } from '../../hooks/useDecidirPedido.js';
import { api } from '../../services/api.js';
import { Badge } from '../../components/interface/Badge.js';
import { Button } from '../../components/interface/Button.js';
import { Skeleton } from '../../components/interface/Skeleton.js';
import { Toast } from '../../components/interface/Toast.js';
import { formatBRL } from '../../lib/utils.js';
import { MARCA } from '../../lib/marca.js';
import { nomeDoComprador, origemParaExibir, decisaoDoPedido, seloDoPedido, compararReferencia, linkDoWhatsApp } from '../../lib/pedido.js';
import { compararTamanho } from '../../components/comercial/grade.js';
import { usePermissao } from '../../hooks/usePermissao.js';
import { useCondicoesDePagamento } from '../../hooks/useCondicoesDePagamento.js';
import { SeletorTamanho, type PickedSize } from '../../components/comercial/SeletorTamanho.js';
import { SearchSelect } from '../../components/interface/SearchSelect.js';
import { CampoDesconto } from '../../components/comercial/CampoDesconto.js';
import { precoDoTamanho, coresPorSku, semLinhasDeCor } from '@csb/shared';
import type { Order, OrderWithItems, ApiResponse, OrderStatus, ProductWithPrice } from '@csb/shared';

/** Uma linha do pedido em edição. O preço é só ilustração — o servidor refaz. */
interface LinhaEdit {
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
}

export function PaginaDetalhePedido() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { token, user } = useAuthStore();
  const isOnline = useOnlineStatus();
  // As teclas do gerente: sem elas o botão some, em vez de aparecer e responder
  // "acesso negado" no toque. Quem protege de verdade é a API.
  const podeFaturar = usePermissao('faturar_pedidos');
  const podeAprovar = usePermissao('aprovar_pedidos');
  // A VENDA INTERNA fatura o próprio pedido: o balcão fecha a própria venda.
  const ehVendaInterna = user?.role === 'rep' && user?.venda_interna === true;
  // A loja acompanha o próprio pedido: não fatura e não apaga (a rota nega os
  // dois), então os botões não aparecem em vez de responder 403 no toque.
  const ehLoja = user?.role === 'store';
  // undefined = carregando, null = não encontrado
  const [order, setOrder] = useState<OrderWithItems | null | undefined>(undefined);

  // O financeiro fatura — é a razão de ele existir ("quem aceita os pedidos").
  // E a venda interna, só nos pedidos DELA.
  const canInvoice =
    ((user?.role === 'manager' || user?.role === 'admin' || user?.role === 'financeiro') &&
      podeFaturar) ||
    (ehVendaInterna && !!order && order.rep_id === user.id);
  const [invoicing, setInvoicing] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [toast, setToast] = useState<{ message: string; type: 'success' | 'error' } | null>(null);

  const { decidir, decidindo } = useDecidirPedido((mensagem, erro) =>
    setToast({ message: mensagem, type: erro ? 'error' : 'success' }),
  );

  // Quem abre um pedido parado quer decidir ali mesmo — obrigar a voltar para
  // uma lista para apertar o botão é o tipo de caminho que ninguém descobre.
  const decisao = order ? decisaoDoPedido(user?.role, order.status, podeAprovar) : null;

  const handleDecisao = async (status: OrderStatus) => {
    if (!id || !order) return;
    if (await decidir(id, status)) setOrder({ ...order, status });
  };

  const [salvandoDesconto, setSalvandoDesconto] = useState(false);

  /**
   * Quem pode MEXER neste pedido — peças, desconto e condição de pagamento
   * seguem o mesmo portão, espelho do da API: o representante nos próprios,
   * enquanto estão com ele (rascunho/triagem); o gerente e o admin em tudo que
   * ainda não virou nota — triagem, fila e até o aprovado. Regra do Yan: "o
   * gerente pode mudar o pedido do representante e do cliente".
   *
   * Online porque alterar vale para os outros — não entra na fila offline.
   */
  const podeMudarPedido =
    !!order &&
    !order.invoiced &&
    isOnline &&
    (user?.role === 'rep'
      ? // Até a fábrica DECIDIR: o pedido do rep nasce direto na fila, e é lá
        // que ele corrige o que acabou de passar. Aprovado, fecha a mão dele —
        // exceto na VENDA INTERNA, cujo pedido já NASCE aprovado: a janela de
        // ajuste dela vai até o carimbo do faturamento.
        order.status === 'draft' ||
        order.status === 'pending_rep' ||
        order.status === 'pending_approval' ||
        (user.venda_interna === true && order.status === 'approved' && order.rep_id === user.id)
      : (user?.role === 'manager' || user?.role === 'admin' || user?.role === 'financeiro') &&
        (order.status === 'pending_rep' ||
          order.status === 'pending_approval' ||
          order.status === 'approved' ||
          // O rascunho do PRÓPRIO gerente — o alheio é montagem privada do rep.
          (order.status === 'draft' && order.rep_id === user.id)));

  const podeDarDesconto = podeMudarPedido;

  /** Soma dos itens, sem desconto — é o "Valor Parcial" do formulário. */
  const bruto = (order?.items ?? []).reduce((s, i) => s + (i.total ?? 0), 0);

  const aplicarDesconto = async (desconto: { percent?: number; valor?: number }) => {
    if (!id || !order || salvandoDesconto) return;
    setSalvandoDesconto(true);
    try {
      // O servidor refaz a conta a partir dos itens e devolve o pedido inteiro:
      // aplicar o percentual na tela sobre o total já descontado acumularia
      // desconto a cada troca (10% depois 10% viraria 19%). E quando vem em
      // reais, é ele quem converte — com a soma que ele mesmo tem.
      const res = await api.patch<ApiResponse<OrderWithItems>>(
        `/orders/${id}/desconto`,
        desconto.valor != null ? { desconto_valor: desconto.valor } : { desconto: desconto.percent },
        token!,
      );
      setOrder({ ...order, ...res.data });
      const zerou = desconto.valor === 0 || desconto.percent === 0;
      setToast({
        message: zerou
          ? 'Desconto removido.'
          : desconto.valor != null
            ? `Desconto de ${formatBRL(desconto.valor)} aplicado.`
            : `Desconto de ${desconto.percent}% aplicado.`,
        type: 'success',
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível aplicar o desconto.',
        type: 'error',
      });
    } finally {
      setSalvandoDesconto(false);
    }
  };

  // ─── Edição das peças ──────────────────────────────────────────────────────
  const [editando, setEditando] = useState(false);
  const [linhasEdit, setLinhasEdit] = useState<LinhaEdit[]>([]);
  const [buscaPeca, setBuscaPeca] = useState('');
  const [pickerEdit, setPickerEdit] = useState<{ product: ProductWithPrice; group: ProductWithPrice[] } | null>(null);
  const [salvandoPecas, setSalvandoPecas] = useState(false);

  const podeEditarPecas = podeMudarPedido;

  const iniciarEdicao = () => {
    if (!order) return;
    // Nasce na mesma ordem da lista (ref crescente). Peça acrescentada depois
    // entra no fim, de propósito: linha pulando de lugar no meio da edição
    // faria o dedo errar o stepper.
    setLinhasEdit(
      itensOrdenados.map((i) => ({
        product_id: i.product_id,
        variant_id: i.variant_id,
        quantity: i.quantity,
        unit_price: i.unit_price,
      })),
    );
    setBuscaPeca('');
    setEditando(true);
  };

  const mudarQtd = (idx: number, delta: number) =>
    setLinhasEdit((ls) =>
      ls.map((l, i) => (i === idx ? { ...l, quantity: Math.max(1, l.quantity + delta) } : l)),
    );

  const removerLinha = (idx: number) => setLinhasEdit((ls) => ls.filter((_, i) => i !== idx));

  /** As peças que o seletor devolveu entram somando na linha que já existe. */
  const adicionarPecas = (chosen: ProductWithPrice, lines: PickedSize[]) => {
    setLinhasEdit((ls) => {
      const novas = [...ls];
      for (const l of lines) {
        const preco = precoDoTamanho(l.size, chosen.price, chosen.price_larger) ?? 0;
        const idx = novas.findIndex(
          (n) => n.product_id === chosen.id && n.variant_id === l.variant_id,
        );
        if (idx >= 0) {
          novas[idx] = { ...novas[idx]!, quantity: novas[idx]!.quantity + l.quantity };
        } else {
          novas.push({
            product_id: chosen.id,
            variant_id: l.variant_id,
            quantity: l.quantity,
            unit_price: preco,
          });
        }
      }
      return novas;
    });
    setBuscaPeca('');
  };

  const salvarPecas = async () => {
    if (!id || !order || !token || linhasEdit.length === 0 || salvandoPecas) return;
    setSalvandoPecas(true);
    try {
      // Só (produto × variante × quantidade) — o servidor reprecifica tudo pela
      // tabela do pedido e reaplica o desconto. Preço daqui é ilustração.
      const res = await api.patch<ApiResponse<OrderWithItems>>(
        `/orders/${id}/items`,
        {
          items: linhasEdit.map((l) => ({
            product_id: l.product_id,
            variant_id: l.variant_id ?? undefined,
            quantity: l.quantity,
          })),
        },
        token,
      );
      setOrder(res.data);
      void db.orders.update(id, { total: res.data.total ?? 0 });
      setEditando(false);
      setToast({ message: 'Peças do pedido atualizadas.', type: 'success' });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível salvar as peças.',
        type: 'error',
      });
    } finally {
      setSalvandoPecas(false);
    }
  };

  const products = useLiveQuery(() => db.products.toArray(), []);
  const customers = useLiveQuery(() => db.customers.toArray(), []);
  const condicoes = useCondicoesDePagamento();

  const [salvandoCondicao, setSalvandoCondicao] = useState(false);

  const salvarCondicao = async (novaId: string) => {
    if (!id || !order || !token || salvandoCondicao) return;
    if ((order.payment_condition_id ?? '') === novaId) return;
    setSalvandoCondicao(true);
    try {
      const res = await api.patch<ApiResponse<Order>>(
        `/orders/${id}/pagamento`,
        { payment_condition_id: novaId || null },
        token,
      );
      // O embed `payment_condition` fica para trás no update — zera para o
      // rótulo resolver pelo cache das condições, que tem a nova.
      setOrder({ ...order, ...res.data, payment_condition: null });
      setToast({
        message: novaId ? 'Condição de pagamento atualizada.' : 'Condição de pagamento removida.',
        type: 'success',
      });
    } catch (err) {
      setToast({
        message: err instanceof Error ? err.message : 'Não foi possível trocar a condição.',
        type: 'error',
      });
    } finally {
      setSalvandoCondicao(false);
    }
  };

  // A condição de pagamento: a API manda resolvida; offline, o cache do Dexie
  // resolve pelo id. Sem nenhuma das duas, a linha não aparece.
  const condicaoDoPedido =
    order?.payment_condition?.description ??
    (order?.payment_condition_id
      ? (condicoes.find((c) => c.id === order.payment_condition_id)?.description ?? null)
      : null);

  const prodMap = useMemo(() => {
    const m = new Map<string, ProductWithPrice>();
    for (const p of products ?? []) m.set(p.id, p);
    return m;
  }, [products]);
  const variantSize = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of products ?? []) for (const v of p.variants ?? []) m.set(v.id, v.size);
    return m;
  }, [products]);
  // A busca do "adicionar peça": referência ou nome, a partir de 2 letras.
  const resultadosBusca = useMemo(() => {
    const q = buscaPeca.trim().toLowerCase();
    if (q.length < 2) return [];
    return (products ?? [])
      .filter(
        (p) => p.active && (p.sku.toLowerCase().includes(q) || p.name.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [buscaPeca, products]);

  const abrirPickerEdit = (p: ProductWithPrice) => {
    const group = p.variant_group
      ? (products ?? []).filter((x) => x.variant_group === p.variant_group && x.active)
      : [p];
    setPickerEdit({ product: p, group });
  };

  // Prévia do total na edição, com o desconto do pedido mantido. O número final
  // é o do servidor, que reprecifica pela tabela do pedido ao salvar.
  const totalEditPrevia =
    linhasEdit.reduce((s, l) => s + l.quantity * l.unit_price, 0) *
    (1 - (order?.discount_percent ?? 0) / 100);

  const custName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) m.set(c.id, c.name);
    return m;
  }, [customers]);
  const custWhats = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of customers ?? []) if (c.whatsapp) m.set(c.id, c.whatsapp);
    return m;
  }, [customers]);

  // O código do cliente NO CONTROL — vem do cache de clientes (agora carrega o
  // erp_id). Cliente criado no app ainda sem código = linha não aparece.
  const codigoDoCliente = order?.customer_id
    ? ((customers ?? []).find((c) => c.id === order.customer_id)?.erp_id ?? null)
    : null;

  // Ref crescente e, na mesma ref, a ordem da grade — a ordem do catálogo
  // impresso, que é como se confere um pedido. Do banco os itens chegam na
  // ordem em que foram gravados, que não diz nada.
  const itensOrdenados = useMemo(() => {
    if (!order?.items) return [];
    return [...order.items].sort((a, b) => {
      const refA = prodMap.get(a.product_id)?.sku ?? '';
      const refB = prodMap.get(b.product_id)?.sku ?? '';
      return (
        compararReferencia(refA, refB) ||
        compararTamanho(
          (a.variant_id && variantSize.get(a.variant_id)) || '',
          (b.variant_id && variantSize.get(b.variant_id)) || '',
        )
      );
    });
  }, [order?.items, prodMap, variantSize]);

  // Uma linha por REFERÊNCIA, com a grade junta — é assim que se confere um
  // pedido: a peça, os tamanhos dela e a cor, não uma linha solta por tamanho.
  // A ordem vem de itensOrdenados, então os grupos já saem por ref crescente
  // e cada grade na ordem de tamanho.
  const grupos = useMemo(() => {
    const porProduto = new Map<
      string,
      { product_id: string; linhas: typeof itensOrdenados; pecas: number; total: number }
    >();
    for (const item of itensOrdenados) {
      let g = porProduto.get(item.product_id);
      if (!g) {
        g = { product_id: item.product_id, linhas: [], pecas: 0, total: 0 };
        porProduto.set(item.product_id, g);
      }
      g.linhas.push(item);
      g.pecas += item.quantity;
      g.total += item.total;
    }
    return [...porProduto.values()];
  }, [itensOrdenados]);

  // A cor escolhida mora nas linhas "0015 3M azul" das notas (o item vai
  // sortido para o ERP) — aqui ela volta para a linha do produto, onde quem
  // confere olha. O que sobra das notas é o recado que o rep digitou.
  const skusDoPedido = useMemo(() => {
    const s = new Set<string>();
    for (const item of order?.items ?? []) {
      const sku = prodMap.get(item.product_id)?.sku;
      if (sku) s.add(sku);
    }
    return s;
  }, [order?.items, prodMap]);
  const corPorRef = useMemo(
    () => coresPorSku(order?.notes, skusDoPedido),
    [order?.notes, skusDoPedido],
  );
  const obsDoRep = useMemo(
    () => semLinhasDeCor(order?.notes, skusDoPedido),
    [order?.notes, skusDoPedido],
  );

  // Pedido de vitrine não tem cadastro: o contato é o que o visitante digitou
  // no fechamento. É por ele que o representante vai retornar.
  const zapDoComprador = order?.customer_id
    ? (custWhats.get(order.customer_id) ?? null)
    : (order?.guest_whatsapp ?? null);

  useEffect(() => {
    if (!id) return;
    let cancel = false;
    const fallbackLocal = async () => {
      const local = await db.orders.get(id);
      if (!cancel) setOrder(local ? ({ ...local, items: [] } as OrderWithItems) : null);
    };
    if (token) {
      api
        .get<ApiResponse<OrderWithItems>>(`/orders/${id}`, token)
        .then((r) => {
          if (!cancel) setOrder(r.data);
        })
        .catch(() => void fallbackLocal());
    } else {
      void fallbackLocal();
    }
    return () => {
      cancel = true;
    };
  }, [id, token]);

  const toggleInvoiced = async () => {
    if (!id || !token || !order) return;
    setInvoicing(true);
    try {
      const res = await api.patch<ApiResponse<OrderWithItems>>(
        `/orders/${id}/invoice`,
        { invoiced: !order.invoiced },
        token,
      );
      setOrder((prev) =>
        prev ? { ...prev, invoiced: !!res.data.invoiced, invoiced_at: res.data.invoiced_at ?? null } : prev,
      );
    } catch {
      /* mantém estado anterior */
    } finally {
      setInvoicing(false);
    }
  };

  const handleDelete = async () => {
    if (!id || !token || !order) return;
    if (!window.confirm('Excluir este pedido? Esta ação não pode ser desfeita.')) return;
    setDeleting(true);
    try {
      await api.del<ApiResponse<{ ok: boolean }>>(`/orders/${id}`, token);
      await db.orders.delete(id);
      navigate('/orders');
    } catch (err) {
      window.alert(err instanceof Error ? err.message : 'Erro ao excluir pedido');
      setDeleting(false);
    }
  };

  return (
    <div className="mx-auto max-w-2xl p-4 md:p-6">
      <button
        type="button"
        onClick={() => navigate('/orders')}
        className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
      >
        <ArrowLeft className="h-4 w-4" /> Voltar
      </button>

      {order === undefined ? (
        <div className="space-y-3">
          <Skeleton className="h-28 w-full rounded-xl" />
          <Skeleton className="h-40 w-full rounded-xl" />
        </div>
      ) : order === null ? (
        <div className="flex flex-col items-center justify-center gap-3 py-16 text-center">
          <div className="flex h-14 w-14 items-center justify-center rounded-full bg-muted text-muted-foreground">
            <Package className="h-7 w-7" strokeWidth={1.5} />
          </div>
          <p className="font-medium text-foreground">Pedido não encontrado</p>
        </div>
      ) : (
        <div className="space-y-4">
          <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
            <div className="flex items-start justify-between gap-2">
              <span className="flex min-w-0 items-center gap-1.5">
                <span className="font-mono text-xs text-muted-foreground">#{order.order_number ?? order.id.slice(0, 8)}</span>
                {origemParaExibir(order) && (
                  <span className="shrink-0 rounded bg-muted px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                    {origemParaExibir(order)}
                  </span>
                )}
              </span>
              <Badge variant={seloDoPedido(order, user?.role).variante}>
                {seloDoPedido(order, user?.role).texto}
              </Badge>
            </div>
            <div className="mt-2 flex items-center justify-between gap-2">
              <p className="min-w-0 truncate text-lg font-bold text-foreground">
                {ehLoja ? (user?.name ?? 'Meu pedido') : nomeDoComprador(order, custName)}
              </p>
              {zapDoComprador && (
                <a
                  href={linkDoWhatsApp(zapDoComprador)}
                  target="_blank"
                  rel="noopener noreferrer"
                  aria-label="Falar no WhatsApp"
                  className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg text-positive-soft-foreground transition-colors hover:bg-positive-soft"
                >
                  <MessageCircle className="h-[18px] w-[18px]" />
                </a>
              )}
            </div>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {new Date(order.created_at).toLocaleDateString('pt-BR', {
                day: '2-digit',
                month: 'long',
                year: 'numeric',
              })}
            </p>

            {/* Quem vendeu e os códigos no Control — o que o financeiro confere
                antes de lançar no ERP. A loja não precisa disso. */}
            {!ehLoja && (order.rep_info || codigoDoCliente) && (
              <p className="mt-1 text-xs text-muted-foreground">
                {order.rep_info && (
                  <>
                    Representante:{' '}
                    <span className="font-medium text-foreground">{order.rep_info.name}</span>
                    {order.rep_info.erp_rep_id ? ` (cód. ${order.rep_info.erp_rep_id})` : ''}
                  </>
                )}
                {order.rep_info && codigoDoCliente ? ' · ' : ''}
                {codigoDoCliente && (
                  <>
                    Cód. cliente no ERP:{' '}
                    <span className="font-medium text-foreground">{codigoDoCliente}</span>
                  </>
                )}
              </p>
            )}

            {/* Editável enquanto o pedido está ao alcance de quem olha — o
                gerente corrige a condição sem devolver o pedido pro rep. */}
            {podeMudarPedido && condicoes.length > 0 ? (
              <div className="mt-2 space-y-1">
                <p className="text-xs text-muted-foreground">Cond. de pagamento</p>
                <SearchSelect
                  id="condicao-pedido"
                  value={order.payment_condition_id ?? ''}
                  onSelect={(v) => void salvarCondicao(v)}
                  placeholder="Sem condição — escolher…"
                  searchPlaceholder="Digite os prazos ou o código…"
                  emptyText="Nenhuma condição encontrada"
                  options={[
                    { value: '', label: 'Sem condição' },
                    ...condicoes.map((c) => ({
                      value: c.id,
                      label: c.description,
                      sublabel: `Código ${c.code}`,
                    })),
                  ]}
                />
              </div>
            ) : (
              condicaoDoPedido && (
                <p className="mt-1 text-xs text-muted-foreground">
                  Cond. de pagamento:{' '}
                  <span className="font-medium text-foreground">{condicaoDoPedido}</span>
                </p>
              )
            )}

            {/* O cliente pediu o link? Um toque abre o WhatsApp dele com a
                mensagem e o link públicos prontos — decisão do Yan (14/08/2026):
                nada automático, o representante manda quando pedirem. Vale
                ANTES de ir para a fábrica: a página é viva (lê o banco a cada
                abertura), então o rep manda o link, ajusta o pedido no app e a
                cliente vê a versão nova no MESMO link. O link só existe online
                (a API assina o token); no cache offline o botão some. */}
            {!ehLoja && order.public_link && (
              <a
                href={linkDoWhatsApp(
                  zapDoComprador,
                  `Olá! Seu pedido #${order.order_number ?? ''} da ${MARCA.nome} está registrado. ` +
                    `Veja as peças com fotos e acompanhe por aqui: ${order.public_link}`,
                )}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-lg border border-input text-sm font-medium text-foreground transition-colors hover:bg-positive-soft hover:text-positive-soft-foreground"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={2.5} />
                Enviar pedido para o cliente
              </a>
            )}

            <div className={`mt-3 items-center justify-between gap-2 border-t border-border pt-3 ${ehLoja ? 'hidden' : 'flex'}`}>
              <span className="flex items-center gap-2">
                {order.invoiced ? (
                  <Badge variant="green">Faturado</Badge>
                ) : (
                  <Badge variant="gray">Não faturado</Badge>
                )}
                {order.invoiced && order.invoiced_at && (
                  <span className="text-xs text-muted-foreground">
                    em {new Date(order.invoiced_at).toLocaleDateString('pt-BR')}
                  </span>
                )}
              </span>
              {canInvoice && (
                <Button
                  variant="outline"
                  size="sm"
                  disabled={invoicing}
                  onClick={() => void toggleInvoiced()}
                >
                  {order.invoiced ? 'Desmarcar' : 'Marcar faturado'}
                </Button>
              )}
            </div>
          </div>

          {/* O desconto fica ACIMA da decisão: é a última coisa que se ajusta
              antes de decidir — o rep no que está com ele, o gerente em tudo
              que ainda não virou nota. */}
          {podeDarDesconto && (
            <div className="rounded-xl border border-border bg-card p-4">
              <CampoDesconto
                bruto={bruto}
                percentual={Number(order.discount_percent ?? 0)}
                desabilitado={salvandoDesconto}
                onAplicar={(d) => void aplicarDesconto(d)}
                rodape="Vai no campo DESC % da planilha da fábrica. Os preços das peças não mudam."
              />
            </div>
          )}

          {/* O rascunho é o pedido salvo que a fábrica ainda não viu. Este é o
              botão que o tira da área "Enviar pra fábrica" — até lá, o
              representante confere e altera à vontade. Na VENDA INTERNA o mesmo
              botão APROVA na hora: balcão não pede licença à fábrica. */}
          {order.status === 'draft' && !ehLoja && podeAprovar && (
            <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
              <p className="mb-3 text-sm text-foreground">
                {ehVendaInterna
                  ? 'Venda interna: ao aprovar, o pedido já sai aprovado — depois é só marcar o faturamento.'
                  : 'Este pedido está salvo, mas ainda não foi. Confira as peças, o desconto e a condição — quando estiver certo, mande.'}
              </p>
              <Button
                size="lg"
                className="w-full bg-positive hover:bg-positive/90 active:bg-positive/80"
                disabled={decidindo !== null}
                onClick={() => void handleDecisao(ehVendaInterna ? 'approved' : 'pending_approval')}
              >
                <Check className="h-4 w-4" strokeWidth={2.5} />
                {ehVendaInterna ? 'Aprovar venda' : 'Enviar para a fábrica'}
              </Button>
            </div>
          )}

          {/* Aceito, mas ainda fora do Control. Este botão registra o LANÇAMENTO:
              a fábrica importou a planilha no ERP e o pedido passa a esperar só a
              nota. É mesa do financeiro/fábrica — o representante (venda interna
              inclusa) não lança, e a API recusa se tentar. */}
          {order.status === 'approved' &&
            !order.invoiced &&
            (user?.role === 'manager' || user?.role === 'admin' || user?.role === 'financeiro') &&
            podeAprovar && (
              <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
                <p className="mb-3 text-sm text-foreground">
                  Pedido aceito. Depois de importar a planilha no Control, marque aqui que ele foi
                  lançado — ele sai da fila &quot;A lançar&quot; e fica aguardando a nota.
                </p>
                <Button
                  size="lg"
                  className="w-full"
                  disabled={decidindo !== null}
                  onClick={() => void handleDecisao('sent_erp')}
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  Lançar no ERP
                </Button>
              </div>
            )}

          {decisao && (
            <div className="rounded-xl border border-primary/30 bg-primary-soft p-4">
              <p className="mb-3 text-sm text-foreground">{decisao.explicacao}</p>
              <div className="flex gap-2">
                <Button
                  size="lg"
                  className="flex-1 bg-positive hover:bg-positive/90 active:bg-positive/80"
                  disabled={decidindo !== null}
                  onClick={() => void handleDecisao(decisao.aceitar)}
                >
                  <Check className="h-4 w-4" strokeWidth={2.5} />
                  {decisao.rotuloAceitar}
                </Button>
                <Button
                  size="lg"
                  variant="destructive"
                  disabled={decidindo !== null}
                  onClick={() => void handleDecisao('rejected')}
                >
                  <X className="h-4 w-4" strokeWidth={2.5} />
                  {decisao.rotuloRecusar}
                </Button>
              </div>
            </div>
          )}

          <div className="rounded-xl border border-border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b border-border px-4 py-3">
              <h2 className="text-sm font-semibold text-foreground">Itens</h2>
              <span className="flex items-center gap-3">
                {podeEditarPecas && !editando && (
                  <button
                    type="button"
                    onClick={iniciarEdicao}
                    className="inline-flex items-center gap-1 text-xs font-medium text-primary transition-colors hover:opacity-80"
                  >
                    <Pencil className="h-3.5 w-3.5" /> Editar peças
                  </button>
                )}
                {/* PEÇAS, não linhas — é o número que a fábrica confere no
                    romaneio e o que o representante fala com o lojista ("131
                    peças"). A contagem de linhas fica ao lado, menor. */}
                <span className="text-xs text-muted-foreground">
                  <span className="tnum font-semibold text-foreground">
                    {editando
                      ? linhasEdit.reduce((s, l) => s + l.quantity, 0)
                      : order.items.reduce((s, i) => s + i.quantity, 0)}
                  </span>{' '}
                  peças · {editando ? linhasEdit.length : grupos.length} ref.
                </span>
              </span>
            </div>

            {editando ? (
              <>
                <div className="border-b border-border px-4 py-3">
                  <input
                    value={buscaPeca}
                    onChange={(e) => setBuscaPeca(e.target.value)}
                    placeholder="Adicionar peça — referência ou nome"
                    className="w-full rounded-lg border border-border bg-background px-3 py-2 text-sm text-foreground placeholder:text-subtle"
                  />
                  {resultadosBusca.length > 0 && (
                    <ul className="mt-2 overflow-hidden rounded-lg border border-border">
                      {resultadosBusca.map((p) => (
                        <li key={p.id}>
                          <button
                            type="button"
                            onClick={() => abrirPickerEdit(p)}
                            className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors hover:bg-sunken"
                          >
                            <span className="tnum shrink-0 font-mono text-[11px] font-semibold text-subtle">
                              {p.sku}
                            </span>
                            <span className="min-w-0 truncate text-foreground">{p.name}</span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>

                <ul className="divide-y divide-border">
                  {linhasEdit.map((l, idx) => {
                    const p = prodMap.get(l.product_id);
                    const tam = l.variant_id ? variantSize.get(l.variant_id) : undefined;
                    return (
                      <li
                        key={`${l.product_id}|${l.variant_id ?? '-'}`}
                        className="flex items-center gap-2 px-4 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-foreground">
                            {p?.name ?? 'Produto'}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            {p?.sku ? `${p.sku} · ` : ''}
                            {tam ? `Tam ${tam} · ` : ''}
                            {formatBRL(l.unit_price)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-1">
                          <button
                            type="button"
                            aria-label="Tirar uma peça"
                            disabled={l.quantity <= 1}
                            onClick={() => mudarQtd(idx, -1)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-sunken disabled:opacity-40"
                          >
                            <Minus className="h-3.5 w-3.5" />
                          </button>
                          <span className="tnum w-8 text-center text-sm font-semibold text-foreground">
                            {l.quantity}
                          </span>
                          <button
                            type="button"
                            aria-label="Somar uma peça"
                            onClick={() => mudarQtd(idx, 1)}
                            className="flex h-8 w-8 items-center justify-center rounded-lg border border-border text-foreground transition-colors hover:bg-sunken"
                          >
                            <Plus className="h-3.5 w-3.5" />
                          </button>
                        </div>
                        <button
                          type="button"
                          aria-label="Tirar esta peça do pedido"
                          onClick={() => removerLinha(idx)}
                          className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-danger-soft-foreground transition-colors hover:bg-danger-soft"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </li>
                    );
                  })}
                  {linhasEdit.length === 0 && (
                    <li className="px-4 py-6 text-center text-sm text-muted-foreground">
                      Sem peças. Para cancelar o pedido, use recusar ou excluir.
                    </li>
                  )}
                </ul>

                <div className="space-y-2 border-t border-border px-4 py-3">
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">
                      Prévia
                      {(order.discount_percent ?? 0) > 0
                        ? ` (com ${order.discount_percent}% de desconto)`
                        : ''}
                    </span>
                    <span className="text-xl font-bold text-foreground">
                      {formatBRL(totalEditPrevia)}
                    </span>
                  </div>
                  <p className="text-[11px] leading-tight text-subtle">
                    Ao salvar, os preços saem da tabela do pedido — é o valor do servidor que vale.
                  </p>
                  <div className="flex gap-2">
                    <Button
                      variant="outline"
                      className="flex-1"
                      disabled={salvandoPecas}
                      onClick={() => setEditando(false)}
                    >
                      Cancelar
                    </Button>
                    <Button
                      className="flex-1"
                      disabled={salvandoPecas || linhasEdit.length === 0}
                      onClick={() => void salvarPecas()}
                    >
                      {salvandoPecas ? 'Salvando…' : 'Salvar peças'}
                    </Button>
                  </div>
                </div>
              </>
            ) : order.items.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-4 py-8 text-center">
                {!isOnline && <WifiOff className="h-5 w-5 text-muted-foreground" />}
                <p className="text-sm text-muted-foreground">
                  {isOnline ? 'Sem itens neste pedido.' : 'Itens disponíveis quando reconectar.'}
                </p>
              </div>
            ) : (
              <ul className="divide-y divide-border">
                {grupos.map((g) => {
                  const p = prodMap.get(g.product_id);
                  const cor = p?.sku ? corPorRef.get(p.sku) : undefined;
                  const precos = [...new Set(g.linhas.map((l) => l.unit_price))];
                  return (
                    <li key={g.product_id} className="flex items-start gap-3 px-4 py-3">
                      <div className="h-16 w-10 shrink-0 overflow-hidden rounded-lg bg-sunken">
                        {p?.image_url ? (
                          <img
                            src={p.image_url}
                            alt={p.name}
                            loading="lazy"
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-primary/40">
                            <Package className="h-4 w-4" strokeWidth={1.5} />
                          </div>
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-sm font-medium text-foreground">
                          {p?.name ?? 'Produto'}
                        </p>
                        <p className="text-xs text-muted-foreground">
                          {p?.sku ?? ''}
                          {cor && (
                            <>
                              {p?.sku ? ' · ' : ''}
                              <span className="font-medium text-primary">{cor}</span>
                            </>
                          )}
                        </p>
                        {/* A grade junta: um chip por tamanho, na ordem da grade. */}
                        <div className="mt-1.5 flex flex-wrap items-center gap-1">
                          {g.linhas.map((l) => (
                            <span
                              key={l.id}
                              className="tnum rounded-md bg-sunken px-1.5 py-0.5 text-[11px] font-semibold text-foreground"
                            >
                              {(l.variant_id && variantSize.get(l.variant_id)) || 'Único'}
                              <span className="font-normal text-muted-foreground"> ×{l.quantity}</span>
                            </span>
                          ))}
                        </div>
                      </div>
                      <div className="shrink-0 text-right">
                        <p className="text-sm font-semibold text-foreground">{formatBRL(g.total)}</p>
                        <p className="tnum text-[11px] text-muted-foreground">
                          {g.pecas} {g.pecas === 1 ? 'peça' : 'peças'}
                          {' · '}
                          {precos.length === 1
                            ? formatBRL(precos[0] ?? 0)
                            : `${formatBRL(Math.min(...precos))}–${formatBRL(Math.max(...precos))}`}
                        </p>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}

            {!editando && (
              <div className="border-t border-border px-4 py-3">
                {/* Com desconto, o rodapé mostra a conta inteira: o que as peças
                    somam, quanto saiu, e o que o lojista deve. Sem ele, só o
                    total — três linhas para dizer um número seria ruído. */}
                {(order.discount_percent ?? 0) > 0 && (
                  <>
                    <div className="mb-1 flex items-center justify-between text-sm text-muted-foreground">
                      <span>Valor das peças</span>
                      <span className="tnum">{formatBRL(bruto)}</span>
                    </div>
                    <div className="mb-2 flex items-center justify-between text-sm text-positive">
                      <span>
                        Desconto ({Number(order.discount_percent).toFixed(2).replace(/\.?0+$/, '')}%)
                      </span>
                      <span className="tnum">−{formatBRL(bruto - (order.total ?? 0))}</span>
                    </div>
                  </>
                )}
                <div className="flex items-center justify-between">
                  <span className="text-sm text-muted-foreground">Total</span>
                  <span className="text-xl font-bold text-foreground">{formatBRL(order.total ?? 0)}</span>
                </div>
              </div>
            )}
          </div>

          {/* Só o recado do rep: as linhas de cor já aparecem em cada item. */}
          {obsDoRep && (
            <div className="rounded-xl border border-border bg-card p-4 shadow-sm">
              <h2 className="mb-1 text-sm font-semibold text-foreground">Observações</h2>
              <p className="whitespace-pre-line text-sm text-muted-foreground">{obsDoRep}</p>
            </div>
          )}

          {!order.invoiced && !ehLoja && podeAprovar && (
            <Button
              variant="outline"
              size="lg"
              className="w-full text-danger-soft-foreground hover:bg-danger-soft"
              disabled={deleting}
              onClick={() => void handleDelete()}
            >
              <Trash2 className="h-4 w-4" />
              {deleting ? 'Excluindo…' : 'Excluir pedido'}
            </Button>
          )}
        </div>
      )}

      {pickerEdit && (
        <SeletorTamanho
          product={pickerEdit.product}
          colorGroup={pickerEdit.group.length > 1 ? pickerEdit.group : undefined}
          onClose={() => setPickerEdit(null)}
          onConfirm={(chosen, lines) => adicionarPecas(chosen, lines)}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onDone={() => setToast(null)} />}
    </div>
  );
}
