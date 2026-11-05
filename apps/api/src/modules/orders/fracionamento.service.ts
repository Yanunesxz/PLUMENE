import { supabase } from '../../config/supabase.js';
import { detectarComCerteza } from '../../lib/detectarColuna.js';
import { nomeDoUsuario } from '../../lib/nomeDoUsuario.js';
import { garantirFotoDoErp } from './erpSync.service.js';
import {
  conferirDistribuicao,
  podeFracionarPedido,
  podeMudarDataDeEnvio,
  repartirObservacao,
  vendeEmNomeProprio,
} from '@csb/shared';
import type {
  AuthRole,
  EntregaDoGrupo,
  EntregaPedida,
  ErroDaDistribuicao,
  FracionamentoDoPedido,
  Order,
  OrderItem,
  ParteDoItem,
  PodeFracionar,
  PodeMudarDataDeEnvio,
} from '@csb/shared';

/**
 * FRACIONAR O PEDIDO EM ENTREGAS (migração 057; Yan, 05/11/2026).
 *
 * O pedido que no Control sai em três — cada um com a sua data de saída e a
 * sua nota — é dividido aqui em três PEDIDOS, ligados pelo grupo
 * (`split_group_id` = o id do pedido fracionado, que continua existindo como
 * a entrega 1). Quem pode e até quando: `podeFracionarPedido` (shared), a
 * mesma trava de mexer nas peças.
 *
 * As peças só mudam de pedido: preço unitário, tabela, desconto, condição e
 * cliente são os do pedido de origem — nada é reprecificado. As entregas novas
 * nascem com a data de criação do pedido de origem, para o mês da meta do
 * representante não mudar; e a que nasce de um pedido já lançado no Control
 * nasce "aprovada", porque ELA ainda não foi lançada.
 *
 * O PostgREST não tem transação. A ordem das gravações foi escolhida para que
 * uma falha no meio nunca perca peça: primeiro o pedido é MARCADO (um UPDATE
 * condicional — dois toques, ou o pedido andando ao mesmo tempo, não passam),
 * depois as entregas novas nascem com as peças delas, e só então o pedido de
 * origem encolhe. Qualquer falha desfaz o que já foi feito.
 */

/** O que as entregas novas herdam do pedido de origem — só o que existir neste banco. */
const HERDADAS = [
  'rep_id',
  'customer_id',
  'created_by',
  'approved_by',
  'created_at',
  'source',
  'guest_name',
  'guest_whatsapp',
  'price_table_id',
  'payment_condition_id',
  'discount_percent',
] as const;

const COLUNAS_DO_GRUPO =
  'id, order_number, split_index, split_count, ship_date, status, invoiced, total, erp_order_id';

type ItemLido = OrderItem & {
  product?: { sku: string | null } | null;
  variant?: { size: string | null } | null;
};
type PedidoLido = Order & Record<string, unknown> & { items: ItemLido[] };

export type ResultadoDoFracionamento =
  | { ok: true; order: Order; entregas: Order[] }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'sem_migracao'
        | 'banco_indisponivel'
        | 'distribuicao'
        /** O pedido andou (ou foi fracionado) entre a leitura e a gravação. */
        | 'mudou'
        | 'erro'
        | Exclude<PodeFracionar, 'ok'>;
      erro?: ErroDaDistribuicao;
      entrega?: number | undefined;
    };

/** A 057 está neste banco? `nao_sei` = o banco não respondeu (nada é gravado). */
async function detectarFracionamento(): Promise<'existe' | 'nao_existe' | 'nao_sei'> {
  return detectarComCerteza('orders', 'split_group_id');
}

async function lerPedidoComItens(id: string, company_id: string): Promise<PedidoLido | null | 'erro'> {
  // As peças com referência e tamanho: é o que reparte as cores anotadas.
  const rico = await supabase
    .from('orders')
    .select('*, items:order_items(*, product:products(sku), variant:product_variants(size))')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!rico.error) return (rico.data as unknown as PedidoLido | null) ?? null;

  // Banco sem os embeds: o pedido fraciona do mesmo jeito; só as cores
  // anotadas vão inteiras para todas as entregas.
  const simples = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (simples.error) {
    console.error(`[fracionamento] falha ao ler o pedido ${id}: ${simples.error.message}`);
    return 'erro';
  }
  return (simples.data as unknown as PedidoLido | null) ?? null;
}

interface LinhaDaEntrega {
  /** O `order_items.id` de origem. */
  origem: string;
  product_id: string;
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  total: number;
}

export async function fracionarPedido(
  id: string,
  company_id: string,
  quem: { id: string; role: AuthRole; venda_interna?: boolean | undefined },
  entregas: EntregaPedida[],
): Promise<ResultadoDoFracionamento> {
  const coluna = await detectarFracionamento();
  if (coluna === 'nao_sei') return { ok: false, reason: 'banco_indisponivel' };
  if (coluna === 'nao_existe') return { ok: false, reason: 'sem_migracao' };

  const lido = await lerPedidoComItens(id, company_id);
  if (lido === 'erro') return { ok: false, reason: 'erro' };
  if (!lido) return { ok: false, reason: 'not_found' };
  const o = lido;
  const itens = o.items ?? [];

  const acesso = podeFracionarPedido(o, quem.role, quem.id, quem.venda_interna === true);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  const conferencia = conferirDistribuicao(
    itens.map((i) => ({ id: i.id, quantity: i.quantity })),
    entregas,
  );
  if (!conferencia.ok) {
    return { ok: false, reason: 'distribuicao', erro: conferencia.erro, entrega: conferencia.entrega };
  }

  // ─── A conta de cada entrega ───────────────────────────────────────────────
  const itemPorId = new Map(itens.map((i) => [i.id, i]));
  const pct = Number(o.discount_percent ?? 0);
  const montar = (partes: readonly ParteDoItem[]): { linhas: LinhaDaEntrega[]; total: number } => {
    const linhas = partes.map((parte) => {
      const item = itemPorId.get(parte.item_id)!;
      return {
        origem: item.id,
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        quantity: parte.quantity,
        // O preço é o do pedido: fracionar não reprecifica nada.
        unit_price: Number(item.unit_price),
        total: Number((parte.quantity * Number(item.unit_price)).toFixed(2)),
      };
    });
    const bruto = linhas.reduce((s, l) => s + l.total, 0);
    return { linhas, total: Number((bruto * (1 - pct / 100)).toFixed(2)) };
  };
  const contas = entregas.map((e) => montar(e.itens));
  const notas = repartirObservacao(
    o.notes,
    itens.map((i) => ({
      id: i.id,
      quantity: i.quantity,
      sku: i.product?.sku ?? null,
      size: i.variant?.size ?? null,
    })),
    entregas.map((e) => e.itens),
  );

  // Pedido já no Control (a venda interna fraciona o próprio até o carimbo):
  // a foto do que a fábrica tem na mão sai ANTES de o pedido encolher, senão o
  // aviso "atualize no Control" não teria com o que comparar. Foto que falha
  // não trava nada (ordem de 23/09/2026) — fica no log.
  if ((await garantirFotoDoErp(o, company_id)) === 'falhou') {
    console.error(`[046] sem foto do Control para o pedido ${o.id}; o fracionamento segue sem ela`);
  }

  const agora = new Date().toISOString();
  const n = entregas.length;
  const marca = { split_group_id: o.id, split_count: n, split_at: agora, split_by: quem.id };

  // ─── 1. Marca o pedido de origem como a entrega 1 ──────────────────────────
  // Só se ele CONTINUA como foi lido: não fracionado, no mesmo status e sem
  // nota. Dois toques gravam um só; o pedido que andou no meio não é dividido.
  const { data: marcado, error: erroDaMarca } = await supabase
    .from('orders')
    .update({
      ...marca,
      split_index: 1,
      ship_date: entregas[0]!.ship_date,
      total: contas[0]!.total,
      notes: notas[0] ?? null,
      updated_at: agora,
    })
    .eq('id', id)
    .eq('company_id', company_id)
    .is('split_group_id', null)
    .eq('status', o.status)
    .or('invoiced.is.null,invoiced.eq.false')
    .select('*')
    .maybeSingle();
  if (erroDaMarca) {
    console.error(`[fracionamento] falha ao marcar o pedido ${id}: ${erroDaMarca.message}`);
    return { ok: false, reason: 'erro' };
  }
  if (!marcado) return { ok: false, reason: 'mudou' };

  const desfazerMarca = async (): Promise<void> => {
    const { error } = await supabase
      .from('orders')
      .update({
        split_group_id: null,
        split_index: null,
        split_count: null,
        split_at: null,
        split_by: null,
        ship_date: null,
        total: o.total,
        notes: o.notes ?? null,
      })
      .eq('id', id)
      .eq('company_id', company_id);
    if (error) {
      console.error(
        `[fracionamento] NÃO DEU PARA DESFAZER a marca do pedido ${o.order_number ?? id}: ${error.message}. ` +
          'O pedido ficou marcado como entrega 1 com as peças inteiras — conferir à mão.',
      );
    }
  };

  // ─── 2. As entregas novas ──────────────────────────────────────────────────
  const herdado: Record<string, unknown> = { company_id };
  for (const coluna of HERDADAS) {
    if (coluna in o && o[coluna] !== undefined) herdado[coluna] = o[coluna];
  }
  // Lançado no Control é o pedido de ORIGEM; a entrega nova ainda vai ser.
  const statusDasNovas: Order['status'] = o.status === 'sent_erp' ? 'approved' : o.status;
  const novas = contas.slice(1).map((conta, i) => ({
    ...herdado,
    ...marca,
    status: statusDasNovas,
    split_index: i + 2,
    ship_date: entregas[i + 1]!.ship_date,
    total: conta.total,
    notes: notas[i + 1] ?? null,
  }));

  const { data: criadas, error: erroDasNovas } = await supabase.from('orders').insert(novas).select('*');
  const nascidas = (criadas as Order[] | null) ?? [];
  const apagarNovas = async (): Promise<void> => {
    const ids = nascidas.map((p) => p.id);
    if (ids.length === 0) return;
    const { error } = await supabase.from('orders').delete().in('id', ids).eq('company_id', company_id);
    if (error) {
      console.error(
        `[fracionamento] NÃO DEU PARA APAGAR as entregas ${ids.join(', ')} do pedido ${o.order_number ?? id}: ${error.message}`,
      );
    }
  };
  if (erroDasNovas || nascidas.length !== n - 1) {
    console.error(
      `[fracionamento] falha ao criar as entregas do pedido ${id}: ${erroDasNovas?.message ?? 'vieram menos linhas do que o pedido'}`,
    );
    await apagarNovas();
    await desfazerMarca();
    return { ok: false, reason: 'erro' };
  }

  // Cada entrega recebe as peças DELA — casadas pela posição, não pela ordem
  // em que o banco devolveu as linhas.
  const idDaEntrega = new Map(nascidas.map((p) => [Number(p.split_index), p.id]));
  const pecasDasNovas = contas.slice(1).flatMap((conta, i) =>
    conta.linhas.map(({ origem: _origem, ...linha }) => ({ order_id: idDaEntrega.get(i + 2) ?? '', ...linha })),
  );
  if (pecasDasNovas.some((l) => !l.order_id)) {
    console.error(`[fracionamento] entrega sem id depois do insert (pedido ${id})`);
    await apagarNovas();
    await desfazerMarca();
    return { ok: false, reason: 'erro' };
  }
  const { error: erroDasPecas } = await supabase.from('order_items').insert(pecasDasNovas);
  if (erroDasPecas) {
    console.error(`[fracionamento] falha ao gravar as peças das entregas do pedido ${id}: ${erroDasPecas.message}`);
    await apagarNovas();
    await desfazerMarca();
    return { ok: false, reason: 'erro' };
  }

  // ─── 3. O pedido de origem encolhe para a entrega 1 ────────────────────────
  // As linhas que ficam com menos peças são regravadas pelo id (uma ida só);
  // as que foram inteiras para outras entregas saem. Nesta ordem: se a segunda
  // falhar, a primeira se desfaz regravando as quantidades de antes.
  const ficam = contas[0]!.linhas;
  const queFicam = new Set(ficam.map((l) => l.origem));
  const saem = itens.filter((i) => !queFicam.has(i.id)).map((i) => i.id);
  const mudam = ficam.filter((l) => l.quantity !== itemPorId.get(l.origem)!.quantity);
  const comoLinha = (l: LinhaDaEntrega) => ({
    id: l.origem,
    order_id: id,
    product_id: l.product_id,
    variant_id: l.variant_id,
    quantity: l.quantity,
    unit_price: l.unit_price,
    total: l.total,
  });
  const comoEra = (l: LinhaDaEntrega) => {
    const item = itemPorId.get(l.origem)!;
    return { ...comoLinha(l), quantity: item.quantity, total: Number(item.total) };
  };

  if (mudam.length > 0) {
    const { error } = await supabase.from('order_items').upsert(mudam.map(comoLinha), { onConflict: 'id' });
    if (error) {
      console.error(`[fracionamento] falha ao reduzir as peças do pedido ${id}: ${error.message}`);
      await apagarNovas();
      await desfazerMarca();
      return { ok: false, reason: 'erro' };
    }
  }
  if (saem.length > 0) {
    const { error } = await supabase.from('order_items').delete().in('id', saem).eq('order_id', id);
    if (error) {
      console.error(`[fracionamento] falha ao tirar as peças que saíram do pedido ${id}: ${error.message}`);
      if (mudam.length > 0) {
        const volta = await supabase.from('order_items').upsert(mudam.map(comoEra), { onConflict: 'id' });
        if (volta.error) {
          console.error(
            `[fracionamento] NÃO DEU PARA REPOR as quantidades do pedido ${o.order_number ?? id}: ${volta.error.message} — conferir à mão.`,
          );
        }
      }
      await apagarNovas();
      await desfazerMarca();
      return { ok: false, reason: 'erro' };
    }
  }

  const ordenadas = [marcado as unknown as Order, ...nascidas].sort(
    (a, b) => Number(a.split_index ?? 0) - Number(b.split_index ?? 0),
  );
  console.info(
    `[fracionamento] pedido ${o.order_number ?? id} fracionado em ${n} entregas (${ordenadas
      .map((p) => `#${p.order_number ?? '?'}`)
      .join(', ')}) por ${quem.id} (${quem.role})`,
  );
  return { ok: true, order: marcado as unknown as Order, entregas: ordenadas };
}

// ─── A data de envio de uma entrega ──────────────────────────────────────────

export type ResultadoDaDataDeEnvio =
  | { ok: true; order: Order; mudou: boolean }
  | {
      ok: false;
      reason: 'not_found' | 'sem_migracao' | 'banco_indisponivel' | 'erro' | Exclude<PodeMudarDataDeEnvio, 'ok'>;
    };

export async function mudarDataDeEnvio(
  id: string,
  company_id: string,
  quem: { id: string; role: AuthRole; venda_interna?: boolean | undefined },
  ship_date: string,
): Promise<ResultadoDaDataDeEnvio> {
  const coluna = await detectarFracionamento();
  if (coluna === 'nao_sei') return { ok: false, reason: 'banco_indisponivel' };
  if (coluna === 'nao_existe') return { ok: false, reason: 'sem_migracao' };

  const { data: lido, error: erroDaLeitura } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (erroDaLeitura) {
    console.error(`[fracionamento] falha ao ler o pedido ${id}: ${erroDaLeitura.message}`);
    return { ok: false, reason: 'erro' };
  }
  if (!lido) return { ok: false, reason: 'not_found' };
  const o = lido as unknown as Order;

  const acesso = podeMudarDataDeEnvio(o, quem.role, quem.id, quem.venda_interna === true);
  if (acesso !== 'ok') return { ok: false, reason: acesso };
  if (o.ship_date === ship_date) return { ok: true, order: o, mudou: false };

  const { data, error } = await supabase
    .from('orders')
    .update({ ship_date, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('status', o.status)
    .or('invoiced.is.null,invoiced.eq.false')
    .select('*')
    .maybeSingle();
  if (error) {
    console.error(`[fracionamento] falha ao gravar a data de envio do pedido ${id}: ${error.message}`);
    return { ok: false, reason: 'erro' };
  }
  // O pedido andou entre a leitura e a gravação: a data já não é de quem pediu.
  if (!data) return { ok: false, reason: 'tarde_demais' };
  return { ok: true, order: data as unknown as Order, mudou: true };
}

// ─── As entregas do grupo, para o detalhe do pedido ──────────────────────────

/**
 * O bloco `fracionamento` do GET /orders/:id: em que entrega este pedido está
 * e quais são as outras. Quem olha só enxerga as entregas que enxergaria na
 * lista — o representante e o SAC as suas, a loja as dela (são sempre as
 * mesmas do grupo, mas o filtro fica: quem protege é a consulta, não a sorte).
 *
 * Nunca derruba a leitura do pedido: se a consulta do grupo falhar, o bloco
 * sai só com a própria entrega, e a tela mostra o aviso sem os botões.
 */
export async function lerFracionamento(
  pedido: Order,
  company_id: string,
  role?: AuthRole,
  rep_id?: string,
  customer_id?: string | null,
): Promise<FracionamentoDoPedido | null> {
  if (!pedido.split_group_id) return null;

  let consulta = supabase
    .from('orders')
    .select(COLUNAS_DO_GRUPO)
    .eq('company_id', company_id)
    .eq('split_group_id', pedido.split_group_id)
    .order('split_index', { ascending: true });
  if (vendeEmNomeProprio(role) && rep_id) consulta = consulta.eq('rep_id', rep_id);
  if (role === 'store') consulta = consulta.eq('customer_id', customer_id ?? '');

  const { data, error } = await consulta;
  if (error) console.error(`[fracionamento] falha ao ler as entregas do grupo ${pedido.split_group_id}: ${error.message}`);

  type Linha = Pick<
    Order,
    'id' | 'order_number' | 'split_index' | 'ship_date' | 'status' | 'invoiced' | 'total' | 'erp_order_id'
  >;
  const linhas = (Array.isArray(data) ? (data as unknown as Linha[]) : []).filter((l) => l && l.id);
  const comoEntrega = (l: Linha): EntregaDoGrupo => ({
    id: l.id,
    order_number: l.order_number ?? null,
    indice: Number(l.split_index ?? 0),
    ship_date: l.ship_date ?? null,
    status: l.status,
    invoiced: l.invoiced === true,
    total: l.total ?? null,
    erp_order_id: l.erp_order_id ?? null,
  });

  return {
    grupo: pedido.split_group_id,
    indice: Number(pedido.split_index ?? 0),
    total_de_entregas: Number(pedido.split_count ?? 0),
    ship_date: pedido.ship_date ?? null,
    fracionado_em: pedido.split_at ?? null,
    fracionado_por_nome: await nomeDoUsuario(pedido.split_by),
    entregas: linhas.length > 0 ? linhas.map(comoEntrega) : [comoEntrega(pedido)],
  };
}
