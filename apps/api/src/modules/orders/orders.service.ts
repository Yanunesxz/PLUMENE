import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { guardarOriginal, lerOriginal } from './pedidoOriginal.service.js';
import { registrarNoErp, lerSincronia } from './erpSync.service.js';
import { buscarTudo } from '../../lib/paginacao.js';
import { enviarConfirmacaoDoPedido } from './pedidoEmail.js';
import { condicaoValida, detectarColunaDaCondicao } from './paymentConditions.service.js';
import type {
  Order,
  OrderWithItems,
  PedidoExcluido,
  CreateOrderRequest,
  UpdateOrderStatusRequest,
} from '@csb/shared';
import {
  ORDER_STATUS_FLOW,
  precoDoTamanho,
  apenasLinhasDeCor,
  juntarObservacao,
  normalizarNumeroErp,
  numeroErpValido,
} from '@csb/shared';
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
    // O financeiro é "quem aceita os pedidos" (Yan, 14/08): o que o rep MANDA
    // para a fábrica cai direto na mesa dele — fila de aprovação, aprovados e
    // enviados ao ERP — mais os que ele próprio criar. Fora do alcance dele só
    // a triagem (pedido de loja parado no rep) e o rascunho alheio.
    if (role === 'financeiro') {
      query = query.or(`status.in.(pending_approval,approved,sent_erp),rep_id.eq.${rep_id}`);
    }

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
  const pedido = order as unknown as OrderWithItems;
  // A cópia do original (044), quando existe: é ela que deixa a tela mostrar
  // "o pedido veio assim, foi faturado assado". Só existe em pedido que
  // encolheu — no resto, ausente, e a tela não mostra bloco nenhum.
  const original = await lerOriginal(pedido.id, company_id);
  if (original) pedido.original = original;
  // E o que o Control conhece (046): é comparando com isto que a tela descobre
  // que a fábrica está com a versão velha depois de a venda interna editar.
  const sincronia = await lerSincronia(pedido.id, company_id);
  if (sincronia) pedido.erp_sync = sincronia;
  return pedido;
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
async function detectarColunaDaFaixaMaior(): Promise<boolean> {
  return detectar('product_prices', 'price_larger');
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
async function detectarColunasDeOrigem(): Promise<boolean> {
  return detectar('orders', 'source');
}

/** `orders.price_table_id` vem da migração 025 — mesmo cuidado da 014 acima. */
async function detectarColunaDaTabela(): Promise<boolean> {
  return detectar('orders', 'price_table_id');
}

/** `orders.discount_percent` vem da migração 029 — mesmo cuidado das outras. */
async function detectarColunaDoDesconto(): Promise<boolean> {
  return detectar('orders', 'discount_percent');
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
   * Representante de VENDA INTERNA (migração 031): o pedido enviado nasce
   * APROVADO — venda de balcão não passa pela fila da fábrica. Vem do token.
   */
  venda_interna?: boolean;
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

  // Cliente do pedido: obrigatório e liberado em todo caminho, MENOS na
  // vitrine antiga de visitante (link sem cliente atrelado, anterior à 035) —
  // ali quem pediu se identifica só por nome e WhatsApp. Vitrine com cliente
  // (o link novo) passa pela mesma checagem dos outros.
  if (!daVitrine || body.customer_id) {
    if (!body.customer_id) return null;
    const { data: customer } = await supabase
      .from('customers')
      .select('id, blocked, price_table_id')
      .eq('id', body.customer_id)
      .eq('company_id', company_id)
      .single();

    if (!customer) return null;
    if ((customer as { blocked: boolean }).blocked) {
      throw new Error('CUSTOMER_BLOCKED');
    }

    // A tabela do pedido é a do CADASTRO do cliente — aqui, no único lugar
    // por onde todo pedido passa. O caminho online já resolvia isso no
    // controller; o offline (fila de sync) mandava a tabela do REPRESENTANTE,
    // e um cliente de tabela 3 nasceu em pedido de tabela 1 (#14637, Simone,
    // 03/09/2026). Sem tabela no cadastro, vale a que o chamador mandou.
    const tabelaDoCliente = (customer as { price_table_id: string | null }).price_table_id;
    if (tabelaDoCliente) price_table_id = tabelaDoCliente;
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
  // Em % ou em R$: o valor vira percentual com a soma que ACABAMOS de calcular.
  // Desconto maior que o pedido é erro de digitação — o pedido sai sem desconto
  // em vez de virar 100% e entregar a mercadoria de graça.
  const pctPedido =
    body.discount_value != null
      ? (percentualDoValor(body.discount_value, totalBruto) ?? 0)
      : (body.discount_percent ?? 0);
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
        ? // Venda interna nasce APROVADA: o balcão não pede licença à fábrica.
          // "Faturado" segue sendo o carimbo de sempre, nunca um status.
          origem.venda_interna
          ? 'approved'
          : 'pending_approval'
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
        // Vitrine COM cliente (link novo, 035) grava o cliente; a de visitante
        // (link antigo) segue sem — o contato fica nos campos guest_*.
        customer_id: body.customer_id ?? null,
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
  | { ok: false; reason: 'not_found' | 'forbidden' | 'invoiced' | 'sem_copia' };

// ─── Pedidos excluídos (migração 040) ────────────────────────────────────────
//
// Excluir continua apagando o pedido de `orders` — listas, filas, metas e
// relatórios não precisam saber de nada. O que muda é que, um instante antes
// do DELETE, o pedido inteiro é copiado para `deleted_orders`, com quem apagou
// e quando. É o que a aba "Excluídos" do admin lê. Pedido do Yan (03/09/2026),
// depois de dois pedidos da CS sumirem sem rastro nenhum.

/** `deleted_orders` vem da migração 040 — mesmo cuidado das outras. */
async function detectarPedidosExcluidos(): Promise<boolean> {
  return detectar('deleted_orders', 'id');
}

/**
 * A cópia leva o que a aba precisa mostrar sem consultar mais nada: as peças
 * já com referência e tamanho, o cliente e o representante — porque, depois
 * do DELETE, os itens não existem mais para serem resolvidos.
 */
const COLUNAS_DA_COPIA =
  '*, items:order_items(*, product:products(sku, name), variant:product_variants(size)), ' +
  'customer:customers(name, cnpj), rep:users!orders_rep_id_fkey(name)';

type ResultadoDaCopia = 'guardada' | 'sem_tabela' | 'falhou';

async function guardarCopiaAntesDeExcluir(
  id: string,
  company_id: string,
  quem: { id: string; nome: string },
): Promise<ResultadoDaCopia> {
  if (!(await detectarPedidosExcluidos())) return 'sem_tabela';

  // O select rico depende dos embeds; se algum faltar (banco antigo), a cópia
  // sai sem eles — melhor um retrato incompleto do que nenhum.
  let pedido: unknown = null;
  const rico = await supabase
    .from('orders')
    .select(COLUNAS_DA_COPIA)
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!rico.error && rico.data) {
    pedido = rico.data;
  } else {
    const simples = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('id', id)
      .eq('company_id', company_id)
      .maybeSingle();
    pedido = simples.data ?? null;
  }
  if (!pedido) return 'falhou';

  const { error } = await supabase.from('deleted_orders').insert({
    company_id,
    order_id: id,
    order_number: (pedido as { order_number?: number | null }).order_number ?? null,
    deleted_by: quem.id,
    deleted_by_name: quem.nome,
    snapshot: pedido,
  });
  return error ? 'falhou' : 'guardada';
}

export async function deleteOrder(
  id: string,
  company_id: string,
  rep_id: string,
  role: AuthRole,
  /** Nome de quem está excluindo — vai gravado na cópia, para a aba do admin. */
  nome_de_quem_exclui = '',
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

  // Com a tabela no ar, a cópia é obrigatória: se ela não gravou, o pedido não
  // é apagado — é exatamente o "sumiu sem rastro" que a 040 existe para evitar.
  // Sem a tabela (migração ainda não rodada), exclui como sempre excluiu.
  const copia = await guardarCopiaAntesDeExcluir(id, company_id, { id: rep_id, nome: nome_de_quem_exclui });
  if (copia === 'falhou') return { ok: false, reason: 'sem_copia' };

  // order_items tem ON DELETE CASCADE — somem junto.
  const { error } = await supabase.from('orders').delete().eq('id', id).eq('company_id', company_id);
  if (error) return { ok: false, reason: 'not_found' };
  return { ok: true };
}

/** A aba "Excluídos" do admin: os mais recentes primeiro. `null` = o banco falhou. */
export async function listDeletedOrders(company_id: string): Promise<PedidoExcluido[] | null> {
  // Sem a migração 040 não há o que listar — a aba fica vazia, sem erro.
  if (!(await detectarPedidosExcluidos())) return [];
  const { data, error } = await supabase
    .from('deleted_orders')
    .select('id, order_id, order_number, deleted_at, deleted_by_name, snapshot')
    .eq('company_id', company_id)
    .order('deleted_at', { ascending: false })
    .limit(200);
  if (error) return null;
  return (data ?? []) as PedidoExcluido[];
}

export type DescontoResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'tarde_demais' | 'sem_coluna' | 'maior_que_o_pedido' };

/**
 * O percentual que corresponde a um desconto em REAIS.
 *
 * Seis casas porque o percentual é o que fica guardado: R$ 8,90 sobre
 * R$ 1.234,56 dá 0,720915…%, e cortar em duas casas devolveria R$ 8,89 — um
 * centavo a menos do que foi combinado com o lojista (ver migração 032).
 *
 * `null` quando o desconto passa do valor do pedido: isso não é desconto, é
 * erro de digitação, e virar 100% em silêncio seria dar a mercadoria.
 */
function percentualDoValor(valor: number, bruto: number): number | null {
  if (bruto <= 0) return valor > 0 ? null : 0;
  if (valor > bruto) return null;
  return Number(((valor / bruto) * 100).toFixed(6));
}

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
  desconto: { percent?: number | undefined; valor?: number | undefined },
  vendaInterna = false,
): Promise<DescontoResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, status, invoiced')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as unknown as Order;

  const acesso = podeMexerNoPedido(o, role, rep_id, vendaInterna);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  const { data: itens } = await supabase
    .from('order_items')
    .select('total')
    .eq('order_id', id);

  const bruto = (itens ?? []).reduce((s, i) => s + Number((i as { total: number }).total), 0);

  // Desconto em REAIS vira percentual aqui, com a soma que o servidor calculou —
  // nunca com um total vindo do aparelho, que pode estar velho ou adulterado.
  const percent =
    desconto.valor != null ? percentualDoValor(desconto.valor, bruto) : (desconto.percent ?? 0);
  if (percent == null) return { ok: false, reason: 'maior_que_o_pedido' };

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
 * Representante: nos PRÓPRIOS pedidos, até a fábrica DECIDIR. O pedido dele
 * nasce direto na fila (`pending_approval`) — se a fila já fosse "da fábrica",
 * ele não teria janela nenhuma para corrigir o que acabou de passar. O que
 * fecha a mão dele é a decisão do gerente (aprovado), não o envio — regra do
 * Yan (14/08/2026): a Simone passa o pedido e precisa poder alterar.
 *
 * Gerente/admin: em tudo que ainda está nas mãos da fábrica — triagem, fila e
 * até o já aprovado: "o gerente pode mudar o pedido do representante e do
 * cliente".
 *
 * VENDA INTERNA (031): o teto dela é o CARIMBO, não o envio. Quem fatura o
 * pedido dela é ela mesma (não há integração que avise), então enquanto o
 * carimbo não veio o pedido continua na mão dela — inclusive já enviado à
 * fábrica. Regra do Yan (01/09/2026): "ela tem que poder alterar esses
 * pedidos, só trava depois de marcar como faturado".
 *
 * Ninguém: pedido faturado ou já no ERP. A nota saiu por aquele valor; mexer
 * aqui criaria uma verdade diferente da do Control.
 */
function podeMexerNoPedido(
  o: Order,
  role: AuthRole,
  user_id: string,
  vendaInterna = false,
): 'ok' | 'forbidden' | 'tarde_demais' {
  // Antes do teto geral: para a venda interna, no PRÓPRIO pedido, o único
  // teto é o faturamento — ela é quem carimba, então é ela quem fecha a porta.
  if (role === 'rep' && vendaInterna && o.rep_id === user_id) {
    return o.invoiced ? 'tarde_demais' : 'ok';
  }
  if (o.invoiced || o.status === 'sent_erp' || o.status === 'rejected' || o.status === 'error_erp') {
    return 'tarde_demais';
  }
  if (role === 'rep') {
    if (o.rep_id !== user_id) return 'forbidden';
    return o.status === 'draft' || o.status === 'pending_rep' || o.status === 'pending_approval'
      ? 'ok'
      : 'tarde_demais';
  }
  // O financeiro altera como o gerente — inclusive o já APROVADO, que é a mesa
  // dele ("alterar os pedidos mandados mesmo pela fábrica", Yan 14/08/2026).
  // O teto é o mesmo de todos, lá em cima: faturou ou foi pro ERP, ninguém mexe.
  if (role === 'manager' || role === 'admin' || role === 'financeiro') {
    // Rascunho alheio fica de fora (é a montagem privada do representante) —
    // mas o gerente que monta pedido também nasce em rascunho, e o dele é dele.
    if (o.status === 'draft') return o.rep_id === user_id ? 'ok' : 'tarde_demais';
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
  vendaInterna = false,
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

  const acesso = podeMexerNoPedido(o, role, user_id, vendaInterna);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  // ANTES de trocar qualquer peça: a foto do que o representante fechou (044).
  // Só a primeira vale, e rascunho não entra — quem está montando o pedido não
  // está cortando nada. É acessório: falhar aqui não impede a edição.
  await guardarOriginal(o, 'edicao', user_id);

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
  vendaInterna = false,
): Promise<PagamentoResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, status, invoiced')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as unknown as Order;

  const acesso = podeMexerNoPedido(o, role, user_id, vendaInterna);
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

export type CorrigirNumeroErpResult =
  | { ok: true; erp_order_id: string }
  | { ok: false; motivo: 'not_found' | 'formato' | 'em_uso' | 'nao_lancado' | 'ja_faturado' | 'erro' };

/**
 * Corrige o número do Control de um pedido já lançado.
 *
 * Existe porque errar o número é fácil (o diálogo sugere o próximo da
 * sequência, e a sugestão pode não ser o que o Control deu) e o estrago é
 * grande: é por esse número que o faturamento do ERP acha o pedido. Sem
 * conserto, o pedido ficaria esperando uma nota que nunca chega.
 *
 * Depois da NOTA o número não muda mais: aí ele é o que está no documento
 * fiscal, e divergir disso seria criar uma segunda verdade.
 */
export async function corrigirNumeroErp(
  id: string,
  company_id: string,
  numeroDigitado: string,
): Promise<CorrigirNumeroErpResult> {
  const numero = normalizarNumeroErp(numeroDigitado);
  if (!numero || !numeroErpValido(numero)) return { ok: false, motivo: 'formato' };

  const { data: pedido } = await supabase
    .from('orders')
    .select('id, status, invoiced, erp_order_id')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!pedido) return { ok: false, motivo: 'not_found' };
  const o = pedido as { status: Order['status']; invoiced: boolean | null; erp_order_id: string | null };
  if (o.status !== 'sent_erp' || !o.erp_order_id) return { ok: false, motivo: 'nao_lancado' };
  if (o.invoiced) return { ok: false, motivo: 'ja_faturado' };

  const { data: dono } = await supabase
    .from('orders')
    .select('id')
    .eq('company_id', company_id)
    .eq('erp_order_id', numero)
    .neq('id', id)
    .limit(1);
  if ((dono ?? []).length > 0) return { ok: false, motivo: 'em_uso' };

  const { error } = await supabase
    .from('orders')
    .update({ erp_order_id: numero, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id);
  if (error) {
    return { ok: false, motivo: (error as { code?: string }).code === CHAVE_DUPLICADA ? 'em_uso' : 'erro' };
  }
  return { ok: true, erp_order_id: numero };
}

/**
 * O último número do Control lançado nesta empresa — é dele que a tela sugere
 * o próximo, para a Larissa seguir a ordem de lá sem consultar o ERP.
 */
export async function ultimoNumeroErp(company_id: string): Promise<string | null> {
  const { data } = await supabase
    .from('orders')
    .select('erp_order_id')
    .eq('company_id', company_id)
    .not('erp_order_id', 'is', null)
    .order('synced_at', { ascending: false, nullsFirst: false })
    .limit(1);
  const linha = (data ?? [])[0] as { erp_order_id: string | null } | undefined;
  return linha?.erp_order_id ?? null;
}

export type NotesResult =
  | { ok: true; order: Order }
  | { ok: false; reason: 'not_found' | 'forbidden' | 'tarde_demais' };

/**
 * Troca a observação do pedido — só o TEXTO LIVRE. As linhas de cor que o
 * catálogo escreveu nas notas ficam como estão: são a única memória da cor
 * escolhida (o item vai sortido para o ERP), e uma edição de recado não pode
 * apagá-las por acidente.
 *
 * O portão é o mesmo das peças e do desconto (`podeMexerNoPedido`) — para a
 * venda interna, portanto, vale em qualquer estado até o carimbo. Pedido do
 * Yan (01/09/2026): "para vendedora a Obs pode ser editada em todos, menos no
 * faturado".
 */
export async function setOrderNotes(
  id: string,
  company_id: string,
  user_id: string,
  role: AuthRole,
  textoLivre: string,
  vendaInterna = false,
): Promise<NotesResult> {
  const { data: order } = await supabase
    .from('orders')
    .select('id, rep_id, status, invoiced, notes')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();

  if (!order) return { ok: false, reason: 'not_found' };
  const o = order as unknown as Order;

  const acesso = podeMexerNoPedido(o, role, user_id, vendaInterna);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  // Sem a lista de SKUs em mãos: o modo genérico reconhece a linha de cor pelo
  // formato completo ("0015 3M azul"), que é o que `observacaoDeCores` grava.
  const cores = apenasLinhasDeCor(o.notes, null);
  const notes = juntarObservacao(textoLivre, cores) ?? null;

  const { data, error } = await supabase
    .from('orders')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .select()
    .maybeSingle();

  if (error || !data) return { ok: false, reason: 'not_found' };
  return { ok: true, order: data as Order };
}

/** `customers.last_purchase_at` vem da migração 036 — mesmo cuidado das outras. */
async function detectarUltimaCompra(): Promise<boolean> {
  return detectar('customers', 'last_purchase_at');
}

/**
 * O carimbo do faturamento empurra a última compra do cliente para FRENTE — é
 * o que mantém o selo da carteira vivo para quem vende pelo app.
 *
 * Só para frente, nunca para trás: desfazer um faturamento não apaga a compra
 * que existiu, e um carimbo retroativo não rejuvenesce o retrato. Falha aqui
 * não derruba o faturamento — o selo é acessório do carimbo, não o contrário.
 */
export async function registrarCompraDoCliente(
  customer_id: string | null | undefined,
  quando: string | null | undefined,
): Promise<void> {
  if (!customer_id || !quando) return;
  if (!(await detectarUltimaCompra())) return;
  const dia = quando.slice(0, 10);
  try {
    await supabase
      .from('customers')
      .update({ last_purchase_at: dia, updated_at: new Date().toISOString() })
      .eq('id', customer_id)
      .or(`last_purchase_at.is.null,last_purchase_at.lt.${dia}`);
  } catch {
    /* acessório — nunca derruba o carimbo */
  }
}

export async function setOrderInvoiced(
  id: string,
  company_id: string,
  invoiced: boolean,
  opcoes: {
    /** Venda interna: o rep só carimba o PRÓPRIO pedido. Nulo = sem restrição. */
    somenteDoRep?: string | null;
  } = {},
): Promise<Order | null> {
  // O carimbo fecha o pedido para sempre. Se ninguém tinha cortado peça, esta
  // é a hora da foto (044): daí em diante todo pedido faturado tem o original
  // registrado, e o "veio assim, foi faturado assado" sempre tem as duas metades.
  if (invoiced) {
    const { data: antes } = await supabase
      .from('orders')
      .select('id, company_id, status')
      .eq('id', id)
      .eq('company_id', company_id)
      .maybeSingle();
    if (antes) await guardarOriginal(antes as Pick<Order, 'id' | 'company_id' | 'status'>, 'faturamento');
  }

  let query = supabase
    .from('orders')
    .update({
      invoiced,
      invoiced_at: invoiced ? new Date().toISOString() : null,
      updated_at: new Date().toISOString(),
    })
    .eq('id', id)
    .eq('company_id', company_id);

  if (opcoes.somenteDoRep) query = query.eq('rep_id', opcoes.somenteDoRep);

  const { data, error } = await query.select().maybeSingle();

  if (error || !data) return null;
  const order = data as Order;
  if (invoiced) await registrarCompraDoCliente(order.customer_id, order.invoiced_at ?? undefined);
  return order;
}

export async function updateOrderStatus(
  id: string,
  company_id: string,
  approverId: string,
  body: UpdateOrderStatusRequest,
  role?: AuthRole,
  vendaInterna = false,
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
    // VENDA INTERNA aprova o PRÓPRIO rascunho: o balcão não passa pela fila da
    // fábrica (migração 031). Só do rascunho — o resto do ciclo segue igual.
    const aprovandoVendaInterna =
      vendaInterna && body.status === 'approved' && row.status === 'draft';
    const forcandoAprovacao = body.status === 'approved' && !aprovandoVendaInterna;
    const recusandoForaDaTriagem = body.status === 'rejected' && row.status !== 'pending_rep';
    // Lançar no ERP é de quem importa a planilha no Control — financeiro e
    // fábrica. Representante (venda interna incluída) não carimba isso.
    const lancandoNoErp = body.status === 'sent_erp';
    if (forcandoAprovacao || recusandoForaDaTriagem || lancandoNoErp) {
      throw new Error('FORBIDDEN_ROLE');
    }
  }

  // O GERENTE não é mais porteiro (Yan, 02/09/2026): "nenhum pedido precisa
  // passar por ele — todos chegam direto no financeiro". Ele continua vendo e
  // organizando tudo (peças, desconto, condição, triagem de quem sumiu), mas a
  // decisão do pedido na fila — aprovar ou recusar — é do financeiro. O admin
  // fica como válvula de escape.
  if (
    role === 'manager' &&
    row.status === 'pending_approval' &&
    (body.status === 'approved' || body.status === 'rejected')
  ) {
    throw new Error('FORBIDDEN_ROLE');
  }

  // "Os pedidos só vão ser incluídos pela Larissa" (Yan, 10/09/2026): lançar
  // no ERP é do financeiro. O gerente vê e organiza; o admin fica como válvula.
  if (role === 'manager' && body.status === 'sent_erp') {
    throw new Error('FORBIDDEN_ROLE');
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

  // LANÇAR exige o número que o Control deu ao pedido (Yan, 10/09/2026: "toda
  // vez que ela for lançar tem que carregar e seguir o padrão da fábrica"). O
  // app nunca inventa esse número; e um número do Control é de UM pedido só.
  if (body.status === 'sent_erp') {
    const numero = normalizarNumeroErp(body.erp_order_id);
    if (!numero || !numeroErpValido(numero)) throw new Error('ERP_NUMBER_REQUIRED');
    const { data: dono } = await supabase
      .from('orders')
      .select('id')
      .eq('company_id', company_id)
      .eq('erp_order_id', numero)
      .neq('id', id)
      .limit(1);
    if ((dono ?? []).length > 0) throw new Error('ERP_NUMBER_IN_USE');
    update.erp_order_id = numero;
    update.synced_at = new Date().toISOString();
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

  // Duas pessoas lançando ao mesmo tempo leem "número livre" e gravam as duas;
  // quem chega depois bate no índice único da 042. Vira o mesmo 409 da leitura
  // — a Larissa vê "já está em outro pedido" em vez de um erro cru.
  if (error && (error as { code?: string }).code === CHAVE_DUPLICADA) {
    throw new Error('ERP_NUMBER_IN_USE');
  }
  if (error || !data) return null;

  // Lançou no Control: a fábrica passa a conhecer o pedido COMO ELE ESTÁ AGORA.
  // É desta foto que sai o aviso de "mudou depois de ir para o ERP" quando a
  // venda interna editar as peças mais tarde. Acessório: não derruba o lançamento.
  if (body.status === 'sent_erp') {
    await registrarNoErp(id, company_id, approverId);
  }

  // O e-mail de confirmação acompanha o FECHAMENTO de verdade. Quando o pedido
  // nascia direto na fila, o create disparava; agora o pedido do representante
  // nasce rascunho na área "Enviar pra fábrica", e o momento em que o cliente
  // deve ser avisado é este — o rascunho virando pedido. Em segundo plano,
  // como no create: e-mail é acessório e não pode segurar a resposta.
  if (row.status === 'draft' && body.status === 'pending_approval') {
    const completo = await getOrderById(id, company_id);
    if (completo) void enviarConfirmacaoDoPedido(completo);
  }

  return data as Order;
}
