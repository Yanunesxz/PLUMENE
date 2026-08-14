import { supabase } from '../../config/supabase.js';
import { buscarTudo } from '../../lib/paginacao.js';
import { enviarConfirmacaoDoPedido } from './pedidoEmail.js';
import { condicaoValida, detectarColunaDaCondicao } from './paymentConditions.service.js';
import type { Order, OrderWithItems, CreateOrderRequest, UpdateOrderStatusRequest } from '@csb/shared';
import { ORDER_STATUS_FLOW, precoDoTamanho } from '@csb/shared';
import type { AuthRole, OrderSource } from '@csb/shared';

export async function getOrders(
  company_id: string,
  role: AuthRole,
  rep_id: string,
  customer_id?: string | null,
): Promise<Order[]> {
  // Paginado: o PostgREST corta em 1.000 linhas SEM avisar. Passando disso, o
  // gerente veria a lista mais antiga sumir da tela — e as somas do painel
  // (vendas do mês, faturamento, ticket) sairiam erradas sem nada indicar erro.
  return buscarTudo<Order>((de, ate) => {
    let query = supabase
      .from('orders')
      .select('*')
      .eq('company_id', company_id)
      .order('created_at', { ascending: false })
      .range(de, ate);

    if (role === 'rep') query = query.eq('rep_id', rep_id);
    // A loja enxerga por CLIENTE, não por representante: são os pedidos dela,
    // tenha quem tiver montado (ela mesma ou o representante).
    if (role === 'store') query = query.eq('customer_id', customer_id ?? '');

    return query;
  });
}

export async function getOrderById(
  id: string,
  company_id: string,
  role?: AuthRole,
  rep_id?: string,
  customer_id?: string | null,
): Promise<OrderWithItems | null> {
  // A condição de pagamento volta já resolvida (código + descrição): é o que a
  // tela mostra, o e-mail escreve e a planilha põe no COND PGTO. O embed só
  // entra com a migração 028 aplicada — sem ela, o select falharia inteiro.
  const colunas = (await detectarColunaDaCondicao())
    ? '*, items:order_items(*), payment_condition:payment_conditions(code, description)'
    : '*, items:order_items(*)';

  let query = supabase
    .from('orders')
    .select(colunas)
    .eq('id', id)
    .eq('company_id', company_id);

  // Representante só acessa os próprios pedidos (gerente/admin veem todos).
  if (role === 'rep' && rep_id) query = query.eq('rep_id', rep_id);
  // Loja só acessa os pedidos do cliente que ela representa.
  if (role === 'store') query = query.eq('customer_id', customer_id ?? '');

  const { data: order, error } = await query.single();

  if (error || !order) return null;
  // `as unknown`: o select dinâmico (com/sem embed) tira do supabase-js a
  // inferência do shape — mesmo caso do getPriceMap logo abaixo.
  return order as unknown as OrderWithItems;
}

interface PrecoDoProduto {
  price: number;
  price_larger: number | null;
}

/**
 * `product_prices.price_larger` vem da migração 026 — mesmo cuidado das outras
 * detecções deste arquivo. Sem a coluna, a faixa maior fica null e todo tamanho
 * paga o preço normal: é o comportamento anterior à migração, não um erro.
 */
let temColunaDaFaixaMaior: boolean | null = null;

async function detectarColunaDaFaixaMaior(): Promise<boolean> {
  if (temColunaDaFaixaMaior !== null) return temColunaDaFaixaMaior;
  const { error } = await supabase.from('product_prices').select('price_larger').limit(1);
  temColunaDaFaixaMaior = !error;
  return temColunaDaFaixaMaior;
}

// Preço dos produtos na tabela de preço do representante. É a fonte autoritativa:
// o unit_price que vem do cliente nunca é usado para gravar/totalizar o pedido.
async function getPriceMap(
  price_table_id: string | null,
  productIds: string[],
): Promise<Map<string, PrecoDoProduto>> {
  const map = new Map<string, PrecoDoProduto>();
  if (!price_table_id || productIds.length === 0) return map;

  const colunas = (await detectarColunaDaFaixaMaior())
    ? 'product_id, price, price_larger'
    : 'product_id, price';

  const { data } = await supabase
    .from('product_prices')
    .select(colunas)
    .eq('price_table_id', price_table_id)
    .in('product_id', productIds);

  for (const pp of (data ?? []) as unknown as Array<{
    product_id: string;
    price: number;
    price_larger?: number | null;
  }>) {
    map.set(pp.product_id, { price: pp.price, price_larger: pp.price_larger ?? null });
  }
  return map;
}

/**
 * O tamanho de cada variante pedida — é ele que decide a faixa de preço.
 *
 * Vem do banco, nunca do corpo da requisição: o tamanho escolhe entre o preço
 * normal e o da faixa maior, então aceitá-lo do cliente seria deixar quem monta
 * o pedido escolher quanto vai pagar pelo EG.
 */
async function getSizeMap(variantIds: string[]): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  if (variantIds.length === 0) return map;

  const { data } = await supabase
    .from('product_variants')
    .select('id, size')
    .in('id', variantIds);

  for (const v of data ?? []) map.set(v.id as string, v.size as string);
  return map;
}

/**
 * `orders.source`, `guest_name` e `guest_whatsapp` vêm da migração 014, que pode
 * não estar aplicada. Mandar coluna inexistente no INSERT faz o PostgREST
 * recusar o pedido INTEIRO — o representante deixaria de conseguir vender até
 * alguém rodar o SQL. Detecta uma vez e guarda, para o deploy não depender da
 * ordem. (Mesmo padrão de `reps.service.ts` e `partner.service.ts`.)
 */
let temColunasDeOrigem: boolean | null = null;

async function detectarColunasDeOrigem(): Promise<boolean> {
  if (temColunasDeOrigem !== null) return temColunasDeOrigem;
  const { error } = await supabase.from('orders').select('source').limit(1);
  temColunasDeOrigem = !error;
  return temColunasDeOrigem;
}

/** `orders.price_table_id` vem da migração 025 — mesmo cuidado da 014 acima. */
let temColunaDaTabela: boolean | null = null;

async function detectarColunaDaTabela(): Promise<boolean> {
  if (temColunaDaTabela !== null) return temColunaDaTabela;
  const { error } = await supabase.from('orders').select('price_table_id').limit(1);
  temColunaDaTabela = !error;
  return temColunaDaTabela;
}

/** `orders.discount_percent` vem da migração 029 — mesmo cuidado das outras. */
let temColunaDoDesconto: boolean | null = null;

async function detectarColunaDoDesconto(): Promise<boolean> {
  if (temColunaDoDesconto !== null) return temColunaDoDesconto;
  const { error } = await supabase.from('orders').select('discount_percent').limit(1);
  temColunaDoDesconto = !error;
  return temColunaDoDesconto;
}

/**
 * `pending_rep` (triagem do representante) vem da migração 015, que altera o
 * CHECK de `orders.status`. CHECK não dá para detectar com um SELECT como se faz
 * com coluna: descobrimos tentando gravar. Se o banco recusar, o pedido de loja
 * e de vitrine volta a cair direto na fila do gerente — que é o comportamento da
 * 014 — em vez de a compra simplesmente falhar para quem está do outro lado.
 */
let temTriagem = true;

function recusouOStatus(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23514' && /status/i.test(error.message ?? '');
}

/** Postgres: violação de índice único. */
const CHAVE_DUPLICADA = '23505';

/** O pedido que já nasceu deste `local_id`, se houver. */
async function pedidoDoLocalId(
  local_id: string,
  company_id: string,
): Promise<OrderWithItems | null> {
  const { data } = await supabase
    .from('orders')
    .select('id')
    .eq('company_id', company_id)
    .eq('local_id', local_id)
    .maybeSingle();

  const existente = data as { id: string } | null;
  return existente ? getOrderById(existente.id, company_id) : null;
}

export interface OrigemPedido {
  /** Quem montou. `showcase` é o único que pode ficar sem cliente. */
  source: OrderSource;
  /** Vitrine: contato informado no fechamento, já que não há cadastro. */
  guest_name?: string | null;
  guest_whatsapp?: string | null;
  /**
   * Quem apertou enviar. Para a loja é o usuário dela; para a vitrine não há
   * usuário, então fica o representante dono do link. `rep_id` continua sendo
   * quem RECEBE o pedido — os dois só coincidem no caminho do representante.
   */
  created_by?: string;
}

export async function createOrder(
  company_id: string,
  rep_id: string,
  price_table_id: string | null,
  body: CreateOrderRequest,
  origem: OrigemPedido = { source: 'rep' },
): Promise<OrderWithItems | null> {
  const daVitrine = origem.source === 'showcase';

  // Pedido offline reenviado: se ele já entrou, devolve o que existe em vez de
  // criar outro. O aparelho só limpa a fila quando a resposta chega, então uma
  // resposta perdida no caminho (sinal caindo, servidor reiniciando) faz a fila
  // ser reenviada inteira — e o segundo pedido idêntico vira segunda nota.
  if (body.local_id) {
    const jaEntrou = await pedidoDoLocalId(body.local_id, company_id);
    if (jaEntrou) return jaEntrou;
  }

  // Sem a 014, `orders.customer_id` ainda é NOT NULL e não há onde guardar o
  // contato do visitante: o pedido de vitrine simplesmente não cabe no banco.
  // Falha aqui, com motivo, em vez de estourar um 500 sem explicação.
  if (daVitrine && !(await detectarColunasDeOrigem())) {
    throw new Error('ACESSO_INDISPONIVEL');
  }

  // Pedido de vitrine não tem cliente: quem pediu é um visitante identificado
  // só por nome e WhatsApp. Nos outros caminhos, o cliente é obrigatório e
  // precisa estar liberado.
  if (!daVitrine) {
    if (!body.customer_id) return null;
    const { data: customer } = await supabase
      .from('customers')
      .select('id, blocked')
      .eq('id', body.customer_id)
      .eq('company_id', company_id)
      .single();

    if (!customer) return null;
    if ((customer as { blocked: boolean }).blocked) {
      throw new Error('CUSTOMER_BLOCKED');
    }
  }

  // Recalcula o preço no servidor pela tabela do representante. Se algum item
  // não tiver preço definido nessa tabela, o pedido é recusado (não confiamos
  // num preço vindo do cliente).
  const productIds = [...new Set(body.items.map((item) => item.product_id))];
  const variantIds = [...new Set(body.items.map((i) => i.variant_id).filter((v): v is string => !!v))];
  const [priceMap, sizeMap] = await Promise.all([
    getPriceMap(price_table_id, productIds),
    getSizeMap(variantIds),
  ]);

  const items = body.items.map((item) => {
    const preco = priceMap.get(item.product_id);
    if (preco === undefined) {
      throw new Error('PRICE_NOT_FOUND');
    }
    // O EG (e a grade plus 48-54) custa mais caro na tabela da fábrica. Quem
    // decide é o tamanho da variante, lido do banco — ver `precoDoTamanho`.
    // Item sem variante cai na faixa normal: é o pedido antigo/offline que não
    // gravou o tamanho, e cobrar o preço maior por suposição seria pior.
    const unit_price = precoDoTamanho(
      item.variant_id ? sizeMap.get(item.variant_id) : null,
      preco.price,
      preco.price_larger,
    );
    if (unit_price == null) {
      throw new Error('PRICE_NOT_FOUND');
    }
    return {
      product_id: item.product_id,
      variant_id: item.variant_id ?? null,
      quantity: item.quantity,
      unit_price,
      total: item.quantity * unit_price,
    };
  });

  const totalBruto = items.reduce((sum, item) => sum + item.total, 0);

  // O desconto que o representante fechou com o lojista, dado na MONTAGEM — é
  // aqui que ele aparece para quem monta, porque o pedido do rep nasce direto
  // na fila do gerente e nunca passa por uma tela de "antes de mandar".
  //
  // Só na origem 'rep' (o controller descarta o campo de quem não é) e só com a
  // 029 no banco: descontar o total sem gravar QUANTO foi dado faria a planilha
  // do Control sair cheia ao lado de um total menor — dois números que não
  // fecham, e ninguém saberia qual vale.
  const pctPedido = body.discount_percent ?? 0;
  const comDesconto =
    origem.source === 'rep' && pctPedido > 0 && (await detectarColunaDoDesconto());
  const total = comDesconto
    ? Number((totalBruto * (1 - pctPedido / 100)).toFixed(2))
    : totalBruto;
  const descontoGravado = comDesconto ? { discount_percent: pctPedido } : {};

  // Pedido enviado pelo representante já nasce na fila do gerente. Sem isto ele
  // ficava em 'draft' para sempre e a tela de aprovação nunca via nada.
  //
  // Loja e vitrine não têm rascunho nem falam direto com a fábrica: param no
  // REPRESENTANTE (`pending_rep`), que decide se aquilo vira pedido. Quem monta
  // o pedido nunca escolhe o próprio status.
  const statusInicial: Order['status'] =
    origem.source === 'rep'
      ? body.submit
        ? 'pending_approval'
        : 'draft'
      : temTriagem
        ? 'pending_rep'
        : 'pending_approval';

  // Qual tabela precificou ESTE pedido. Sem isso, quem lê depois só consegue
  // deduzir pelo cadastro do cliente — e a dedução erra quando o cliente troca
  // de tabela, ou quando o representante escolheu outra só para este pedido.
  const tabelaGravada =
    price_table_id && (await detectarColunaDaTabela()) ? { price_table_id } : {};

  // A condição de pagamento que o rep (ou a loja) escolheu. Validada: precisa
  // ser desta empresa e estar ativa. Inválida ou com a 028 pendente, o pedido
  // segue SEM ela — condição é acessória, e recusar a venda por causa dela
  // seria o dano maior. O COND PGTO da planilha sai em branco, como sempre foi.
  const condicaoEscolhida = await condicaoValida(body.payment_condition_id, company_id);
  const condicaoGravada = condicaoEscolhida ? { payment_condition_id: condicaoEscolhida } : {};

  const camposDeOrigem = (await detectarColunasDeOrigem())
    ? {
        source: origem.source,
        guest_name: origem.guest_name ?? null,
        guest_whatsapp: origem.guest_whatsapp ?? null,
      }
    : {};

  const gravar = (status: Order['status']) =>
    supabase
      .from('orders')
      .insert({
        company_id,
        rep_id,
        customer_id: daVitrine ? null : body.customer_id,
        status,
        total,
        notes: body.notes ?? null,
        local_id: body.local_id ?? null,
        created_by: origem.created_by ?? rep_id,
        ...camposDeOrigem,
        ...tabelaGravada,
        ...condicaoGravada,
        ...descontoGravado,
      })
      .select()
      .single();

  let { data: order, error: orderError } = await gravar(statusInicial);

  // Banco ainda sem a 015: cai para a fila do gerente e não tenta de novo.
  if (recusouOStatus(orderError) && statusInicial === 'pending_rep') {
    temTriagem = false;
    ({ data: order, error: orderError } = await gravar('pending_approval'));
  }

  // Duas requisições com o mesmo `local_id` ao mesmo tempo passam as duas pela
  // checagem lá em cima antes de qualquer uma inserir — acontece quando a
  // sincronização automática ao reconectar coincide com o toque no botão. Quem
  // perder a corrida encontra o pedido do outro em vez de devolver erro.
  if ((orderError as { code?: string } | null)?.code === CHAVE_DUPLICADA && body.local_id) {
    const doOutro = await pedidoDoLocalId(body.local_id, company_id);
    if (doOutro) return doOutro;
  }

  if (orderError || !order) return null;

  const orderId = (order as Order).id;
  const itemsToInsert = items.map((item) => ({ order_id: orderId, ...item }));

  const { error: itemsError } = await supabase.from('order_items').insert(itemsToInsert);
  if (itemsError) {
    // Rollback compensatório: um pedido sem itens não deve existir. Sem isso,
    // uma falha aqui deixaria um pedido órfão (sem itens) no banco.
    await supabase.from('orders').delete().eq('id', orderId);
    return null;
  }

  const pedidoCompleto = await getOrderById(orderId, company_id);

  // Pedido fechado (não rascunho) manda a confirmação para o cliente e o rep.
  // Em segundo plano: e-mail é acessório e nunca pode segurar nem derrubar o
  // pedido. Rascunho não dispara — ainda está em montagem.
  if (pedidoCompleto && pedidoCompleto.status !== 'draft') {
    void enviarConfirmacaoDoPedido(pedidoCompleto);
  }

  return pedidoCompleto;
}

export type DeleteOrderResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'invoiced' };

export async function deleteOrder(
  id: string,
  company_id: string,
  rep_id: string,
  role: AuthRole,
): Promise<DeleteOrderResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, invoiced')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as { rep_id: string; invoiced: boolean | null };
  if (role === 'rep' && o.rep_id !== rep_id) return { ok: false, reason: 'forbidden' };
  if (o.invoiced) return { ok: false, reason: 'invoiced' };

  // order_items tem ON DELETE CASCADE — somem junto.
  const { error } = await supabase.from('orders').delete().eq('id', id).eq('company_id', company_id);
  if (error) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

export type DescontoResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'tarde_demais' | 'sem_coluna' };

/**
 * O percentual de desconto do pedido inteiro.
 *
 * Quem pode e quando é o `podeMexerNoPedido`: o representante nos próprios,
 * enquanto estão com ele; o gerente em tudo que ainda não virou nota.
 *
 * O total é recalculado A PARTIR DOS ITENS, nunca do total gravado: aplicar o
 * percentual sobre o total anterior descontaria em cima do já descontado a cada
 * troca de percentual (10% depois 10% viraria 19%).
 *
 * Os `unit_price` não são tocados. O formulário do Control tem campo próprio
 * para o desconto (DESC % em AB46) e espera a coluna UNIT com o preço de
 * tabela — ver a migração 029.
 */
export async function setOrderDiscount(
  id: string,
  company_id: string,
  rep_id: string,
  role: AuthRole,
  percent: number,
): Promise<DescontoResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, status, invoiced')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as unknown as Order;

  const acesso = podeMexerNoPedido(o, role, rep_id);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  const { data: itens } = await supabase
    .from('order_items')
    .select('total')
    .eq('order_id', id);

  const bruto = (itens ?? []).reduce((s, i) => s + Number((i as { total: number }).total), 0);
  const total = Number((bruto * (1 - percent / 100)).toFixed(2));

  const { data, error } = await supabase
    .from('orders')
    .update({ discount_percent: percent, total, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  // Sem a migração 028 o PostgREST recusa a coluna. Falha com motivo, em vez de
  // gravar o total descontado e perder o registro de quanto foi dado.
  if (error) return { ok: false, reason: 'sem_coluna' };
  if (!data) return { ok: false, reason: 'not_found' };
  return { ok: true, order: data as Order };
}

/**
 * Quem pode MEXER num pedido — peças, desconto e condição de pagamento passam
 * todos por este portão, para as três coisas nunca divergirem.
 *
 * Representante: nos PRÓPRIOS pedidos, enquanto estão com ele (rascunho e
 * triagem). O que já foi para a fábrica está na mesa de outra pessoa.
 *
 * Gerente/admin: em tudo que ainda está nas mãos da fábrica — triagem, fila de
 * aprovação e até o já aprovado — regra do Yan (14/08/2026): "o gerente pode
 * mudar o pedido do representante e do cliente".
 *
 * Ninguém: pedido faturado ou já no ERP. A nota saiu por aquele valor; mexer
 * aqui criaria uma verdade diferente da do Control.
 */
function podeMexerNoPedido(
  o: Order,
  role: AuthRole,
  user_id: string,
): 'ok' | 'forbidden' | 'tarde_demais' {
  if (o.invoiced || o.status === 'sent_erp' || o.status === 'rejected' || o.status === 'error_erp') {
    return 'tarde_demais';
  }
  if (role === 'rep') {
    if (o.rep_id !== user_id) return 'forbidden';
    return o.status === 'draft' || o.status === 'pending_rep' ? 'ok' : 'tarde_demais';
  }
  if (role === 'manager' || role === 'admin') {
    // Rascunho fica de fora: é a montagem privada do representante.
    return o.status === 'pending_rep' || o.status === 'pending_approval' || o.status === 'approved'
      ? 'ok'
      : 'tarde_demais';
  }
  return 'forbidden';
}

export interface ItemEditado {
  product_id: string;
  variant_id?: string | undefined;
  quantity: number;
}

export type EditarPecasResult =
  | { ok: true; order: OrderWithItems }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'tarde_demais' | 'price_not_found' | 'save_failed' };

/**
 * Troca as peças de um pedido que ainda não foi para a fábrica.
 *
 * É a triagem de verdade: a loja monta o pedido dela, mas quem conhece o
 * cliente é o representante — ele tira a peça que sabe que não vai vender e
 * acrescenta a que o lojista esqueceu. O gerente faz o mesmo ajuste fino na
 * fila dele, antes de aprovar.
 *
 * O corpo traz só (produto × variante × quantidade). Preço NUNCA vem do
 * aparelho: cada linha é reprecificada pela tabela do pedido, com a mesma
 * régua do `createOrder` — inclusive a faixa maior do EG/48-54. E o desconto
 * do pedido continua valendo: o total sai da soma nova × (1 − desconto).
 */
export async function setOrderItems(
  id: string,
  company_id: string,
  user_id: string,
  role: AuthRole,
  itens: ItemEditado[],
): Promise<EditarPecasResult> {
  // `select('*')` de propósito: traz `price_table_id` (025) e `discount_percent`
  // (029) quando existem, sem quebrar quando a migração ainda não rodou.
  const { data: order } = await supabase
    .from('orders')
    .select('*')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as Order;

  const acesso = podeMexerNoPedido(o, role, user_id);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  // A tabela DO pedido, com a mesma dedução de sempre: a gravada (025), senão a
  // do cadastro do cliente, senão a do representante dono.
  let tabela: string | null = o.price_table_id ?? null;
  if (!tabela && o.customer_id) {
    const { data: cli } = await supabase
      .from('customers')
      .select('price_table_id')
      .eq('id', o.customer_id)
      .maybeSingle();
    tabela = (cli as { price_table_id: string | null } | null)?.price_table_id ?? null;
  }
  if (!tabela) {
    const { data: rep } = await supabase
      .from('users')
      .select('price_table_id')
      .eq('id', o.rep_id)
      .maybeSingle();
    tabela = (rep as { price_table_id: string | null } | null)?.price_table_id ?? null;
  }

  const productIds = [...new Set(itens.map((i) => i.product_id))];
  const variantIds = [...new Set(itens.map((i) => i.variant_id).filter((v): v is string => !!v))];
  const [priceMap, sizeMap] = await Promise.all([
    getPriceMap(tabela, productIds),
    getSizeMap(variantIds),
  ]);

  let novos: Array<{
    order_id: string;
    product_id: string;
    variant_id: string | null;
    quantity: number;
    unit_price: number;
    total: number;
  }>;
  try {
    novos = itens.map((item) => {
      const preco = priceMap.get(item.product_id);
      if (preco === undefined) throw new Error('PRICE_NOT_FOUND');
      const unit_price = precoDoTamanho(
        item.variant_id ? sizeMap.get(item.variant_id) : null,
        preco.price,
        preco.price_larger,
      );
      if (unit_price == null) throw new Error('PRICE_NOT_FOUND');
      return {
        order_id: id,
        product_id: item.product_id,
        variant_id: item.variant_id ?? null,
        quantity: item.quantity,
        unit_price,
        total: Number((item.quantity * unit_price).toFixed(2)),
      };
    });
  } catch {
    return { ok: false, reason: 'price_not_found' };
  }

  const bruto = novos.reduce((s, n) => s + n.total, 0);
  const pct = Number(o.discount_percent ?? 0);
  const total = Number((bruto * (1 - pct / 100)).toFixed(2));

  // Troca de fato: guarda os antigos, apaga, insere os novos. Se a inserção
  // falhar no meio, repõe os antigos — e um pedido que porventura fique com o
  // total antigo e itens novos diverge para MENOS, que é a direção visível
  // (mesma escolha do corrigir-pedidos: divergência que aparece, não que cobra).
  const { data: antigos } = await supabase.from('order_items').select('*').eq('order_id', id);
  const { error: eDel } = await supabase.from('order_items').delete().eq('order_id', id);
  if (eDel) return { ok: false, reason: 'save_failed' };

  const { error: eIns } = await supabase.from('order_items').insert(novos);
  if (eIns) {
    if (antigos && antigos.length > 0) await supabase.from('order_items').insert(antigos);
    return { ok: false, reason: 'save_failed' };
  }

  const { error: eUpd } = await supabase
    .from('orders')
    .update({ total, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id);
  if (eUpd) return { ok: false, reason: 'save_failed' };

  const { data: atualizado } = await supabase
    .from('orders')
    .select('*, items:order_items(*)')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  return { ok: true, order: (atualizado ?? { ...o, total, items: novos }) as OrderWithItems };
}

export type PagamentoResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'tarde_demais' | 'condicao_invalida' | 'sem_coluna' };

/**
 * Troca a condição de pagamento de um pedido em aberto.
 *
 * Na criação a condição é acessória (inválida = pedido segue sem ela), mas aqui
 * a intenção é explícita: quem está TROCANDO uma condição quer aquela condição.
 * Id inválido é recusado com motivo, em vez de silenciosamente virar "sem
 * condição". `null` remove — o COND PGTO da planilha volta a sair em branco.
 */
export async function setOrderPayment(
  id: string,
  company_id: string,
  user_id: string,
  role: AuthRole,
  payment_condition_id: string | null,
): Promise<PagamentoResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, status, invoiced')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as unknown as Order;

  const acesso = podeMexerNoPedido(o, role, user_id);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  if (!(await detectarColunaDaCondicao())) return { ok: false, reason: 'sem_coluna' };

  let gravar: string | null = null;
  if (payment_condition_id) {
    gravar = await condicaoValida(payment_condition_id, company_id);
    if (!gravar) return { ok: false, reason: 'condicao_invalida' };
  }

  const { data, error } = await supabase
    .from('orders')
    .update({ payment_condition_id: gravar, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) return { ok: false, reason: 'not_found' };
  return { ok: true, order: data as Order };
}

export async function setOrderInvoiced(
  id: string,
  company_id: string,
  invoiced: boolean,
): Promise<Order | null> {
  const { data, error } = await supabase
    .from('orders')
    .update({
      invoiced,
      invoiced_at: invoiced ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) return null;
  return data as Order;
}

export async function updateOrderStatus(
  id: string,
  company_id: string,
  approverId: string,
  body: UpdateOrderStatusRequest,
  role?: AuthRole,
): Promise<Order | null> {
  const { data: current, error: currentError } = await supabase
    .from('orders')
    .select('status, rep_id')
    .eq('id', id)
    .eq('company_id', company_id)
    .single();

  if (currentError || !current) return null;

  const row = current as { status: Order['status']; rep_id: string };

  // Representante só mexe no status dos próprios pedidos (ex.: enviar para aprovação).
  if (role === 'rep' && row.rep_id !== approverId) {
    throw new Error('FORBIDDEN_NOT_OWNER');
  }

  // O que o representante pode decidir é a TRIAGEM, e só ela: o pedido que
  // chegou da loja ou da vitrine ele manda para a fábrica ou recusa ali mesmo.
  // A palavra final sobre vender continua sendo do gerente — por isso `approved`
  // nunca sai da mão dele, e recusar fora da triagem seria o representante
  // derrubando um pedido que o gerente já tem na mesa.
  if (role === 'rep') {
    const forcandoAprovacao = body.status === 'approved';
    const recusandoForaDaTriagem = body.status === 'rejected' && row.status !== 'pending_rep';
    if (forcandoAprovacao || recusandoForaDaTriagem) {
      throw new Error('FORBIDDEN_ROLE');
    }
  }

  const allowed = ORDER_STATUS_FLOW[row.status];
  if (!allowed.includes(body.status)) {
    throw new Error('INVALID_STATUS_TRANSITION');
  }

  const update: Partial<Order> = {
    status: body.status,
    updated_at: new Date().toISOString(),
  };

  if (body.status === 'approved' || body.status === 'rejected') {
    update.approved_by = approverId;
  }

  if (body.notes) {
    update.notes = body.notes;
  }

  const { data, error } = await supabase
    .from('orders')
    .update(update)
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .single();

  if (error || !data) return null;
  return data as Order;
}
