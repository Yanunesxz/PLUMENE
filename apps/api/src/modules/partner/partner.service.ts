/**
 * Serviço da API de Parceiro — pedidos prontos para importação no ERP.
 *
 * O parceiro (programa do ERP) busca os pedidos aprovados, grava no sistema
 * dele e confirma a importação informando o número gerado no ERP. A partir
 * daí o pedido fica como `sent_erp` e sai da fila.
 */
import { supabase } from '../../config/supabase.js';
import {
  coresPorSku,
  semLinhasDeCor,
  normalizarNumeroErp,
  numeroErpValido,
  ORDER_STATUS_FLOW,
} from '@csb/shared';
import type { OrderStatus } from '@csb/shared';
import { registrarNoErp } from '../orders/erpSync.service.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import { buscarTudoOuFalhar } from '../../lib/paginacao.js';

/** Código de cor usado pelo ERP quando o pedido é por tamanho (cores sortidas). */
const COR_SORTIDA = '00001';

export interface PartnerOrderItem {
  produto: string | null;
  tamanho: string | null;
  cor: string;
  quantidade: number;
  preco_unitario: number;
  valor_total: number;
  /** A(s) cor(es) que o cliente escolheu para esta referência — vazio = sortido. */
  observacao: string | null;
}

export interface PartnerOrder {
  id: string;
  numero: number | null;
  situacao: string;
  criado_em: string;
  atualizado_em: string;
  valor_total: number | null;
  observacoes: string | null;
  pedido_erp: string | null;
  cliente: {
    codigo_erp: string | null;
    cnpj: string | null;
    razao_social: string | null;
    nome_fantasia: string | null;
  };
  representante_erp: string | null;
  tabela_preco: { codigo_erp: string | null; coluna: number };
  /** Código e descrição da condição no Control (ex.: "021" / "30/60/90"). */
  condicao_pagamento: { codigo: string; descricao: string | null } | null;
  /**
   * Desconto do representante em PONTOS PERCENTUAIS: 10 = 10%. Os preços dos
   * itens vêm SEM o desconto (preço de tabela); `valor_total` do pedido já o
   * aplica — o mesmo contrato da planilha (AB46).
   */
  desconto_percentual: number;
  /** O carimbo de faturado — só aparece preenchido com `incluir=todos`. */
  faturado: boolean;
  faturado_em: string | null;
  valor_faturado: number | null;
  itens: PartnerOrderItem[];
  /** true quando todos os vínculos com o ERP estão presentes */
  importavel: boolean;
  /** Cadastros faltando que impedem a importação (vazio quando importavel) */
  pendencias: string[];
}

interface OrderRow {
  id: string;
  order_number?: number | null;
  status: string;
  total: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  erp_order_id: string | null;
  discount_percent?: number | null;
  invoiced?: boolean | null;
  invoiced_at?: string | null;
  invoiced_total?: number | null;
  payment_condition?: { code: string; description: string | null } | null;
  /** Foto da tabela de preço no momento do pedido (preferida sobre a do cliente) */
  price_table_erp_code: string | null;
  price_column: number | null;
  customer: {
    erp_id: string | null;
    cnpj: string | null;
    name: string | null;
    trade_name: string | null;
    rep_erp_id: string | null;
    price_table_id: string | null;
  } | null;
  items: Array<{
    quantity: number;
    unit_price: number;
    total: number;
    variant: { erp_sku: string | null; size: string | null } | null;
    product: { erp_id: string | null; sku: string | null } | null;
  }>;
}

/** Quais colunas opcionais (migrações 009/027/028/029) este banco já tem. */
interface ColunasOpcionais {
  orderNumber: boolean;
  invoiced: boolean;
  condition: boolean;
  discount: boolean;
}

function buildOrderSelect(c: ColunasOpcionais): string {
  return `
    id, ${c.orderNumber ? 'order_number, ' : ''}status, total, notes,
    created_at, updated_at, erp_order_id, price_table_erp_code, price_column,
    ${c.invoiced ? 'invoiced, invoiced_at, invoiced_total, ' : ''}
    ${c.discount ? 'discount_percent, ' : ''}
    ${c.condition ? 'payment_condition:payment_conditions(code, description), ' : ''}
    customer:customers(erp_id, cnpj, name, trade_name, rep_erp_id, price_table_id),
    items:order_items(quantity, unit_price, total,
      variant:product_variants(erp_sku, size),
      product:products(erp_id, sku))
  `;
}

/**
 * Colunas de migrações que podem não estar aplicadas (009, 027, 028, 029).
 * Sem a coluna, o campo correspondente sai null/0.
 *
 * `detectar` lembra o "sim" para sempre e o "não" por 30 s: a migração pode
 * rodar com a API de pé e o campo passa a sair sozinho, sem reiniciar. O
 * cache próprio que morava aqui memorizava qualquer erro de rede como
 * "coluna não existe" até o próximo restart.
 *
 * Só `invoiced` NÃO pode degradar: ela é FILTRO da fila (não só campo do
 * SELECT). Se a sonda falhar por rede e for lida como "não existe", a fila sai
 * sem `.or('invoiced...')` e entrega os pedidos faturados à mão — exatamente o
 * que o filtro existe para impedir. Então ali o erro sobe (500) e o ERP tenta
 * de novo na próxima rodada, como a doc manda.
 */
async function detectarColunas(): Promise<ColunasOpcionais> {
  const [orderNumber, invoiced, condition, discount] = await Promise.all([
    detectar('orders', 'order_number'),
    detectarOuFalhar('orders', 'invoiced'),
    detectar('orders', 'payment_condition_id'),
    detectar('orders', 'discount_percent'),
  ]);
  return { orderNumber, invoiced, condition, discount };
}

function mapOrder(
  row: OrderRow,
  tableMap: Map<string, { erp_code: string | null; price_column: number }>,
): PartnerOrder {
  const pendencias: string[] = [];
  const customer = row.customer;

  if (!customer?.erp_id) pendencias.push('cliente sem código do ERP');
  if (!customer?.rep_erp_id) pendencias.push('cliente sem representante vinculado no ERP');

  // Tabela de preço: prefere a foto gravada no pedido; senão, a do cliente.
  const customerTable = customer?.price_table_id
    ? tableMap.get(customer.price_table_id)
    : undefined;
  const tabelaErp = row.price_table_erp_code ?? customerTable?.erp_code ?? null;
  const coluna = row.price_column ?? customerTable?.price_column ?? 1;
  if (!tabelaErp) pendencias.push('pedido sem tabela de preço vinculada no ERP');

  // A cor escolhida pelo cliente vive nas linhas "0015 3M azul" das notas —
  // o item vai sortido para o ERP e a escolha viaja na observação, igual à
  // coluna OBSERVAÇÃO da planilha do Control (ver @csb/shared observacaoCores).
  const skusDoPedido = new Set<string>();
  for (const it of row.items ?? []) {
    if (it.product?.sku) skusDoPedido.add(it.product.sku);
    if (it.product?.erp_id) skusDoPedido.add(it.product.erp_id);
  }
  const corDasNotas = coresPorSku(row.notes, skusDoPedido);

  const itens: PartnerOrderItem[] = (row.items ?? []).map((it) => {
    let produto: string | null = null;
    let tamanho: string | null = null;
    if (it.variant?.erp_sku?.includes('|')) {
      const [p, t] = it.variant.erp_sku.split('|', 2);
      produto = p ?? null;
      tamanho = t ?? null;
    } else {
      produto = it.product?.erp_id ?? null;
      tamanho = it.variant?.size ?? null;
    }
    if (!produto || !tamanho) pendencias.push('item sem vínculo de produto/tamanho com o ERP');
    const observacao =
      (it.product?.sku ? corDasNotas.get(it.product.sku) : undefined) ??
      (it.product?.erp_id ? corDasNotas.get(it.product.erp_id) : undefined) ??
      null;
    return {
      produto,
      tamanho,
      cor: COR_SORTIDA,
      quantidade: it.quantity,
      preco_unitario: it.unit_price,
      valor_total: it.total,
      observacao,
    };
  });

  if (itens.length === 0) pendencias.push('pedido sem itens');

  return {
    id: row.id,
    numero: row.order_number ?? null,
    situacao: row.status,
    criado_em: row.created_at,
    atualizado_em: row.updated_at,
    valor_total: row.total,
    // Só o que o representante DIGITOU — as linhas de cor já saem por item.
    observacoes: semLinhasDeCor(row.notes, skusDoPedido) || null,
    pedido_erp: row.erp_order_id,
    cliente: {
      codigo_erp: customer?.erp_id ?? null,
      cnpj: customer?.cnpj ?? null,
      razao_social: customer?.name ?? null,
      nome_fantasia: customer?.trade_name ?? null,
    },
    representante_erp: customer?.rep_erp_id ?? null,
    tabela_preco: { codigo_erp: tabelaErp, coluna },
    condicao_pagamento: row.payment_condition
      ? { codigo: row.payment_condition.code, descricao: row.payment_condition.description }
      : null,
    desconto_percentual: Number(row.discount_percent ?? 0),
    faturado: row.invoiced === true,
    faturado_em: row.invoiced_at ?? null,
    valor_faturado: row.invoiced_total ?? null,
    itens,
    importavel: pendencias.length === 0,
    pendencias: [...new Set(pendencias)],
  };
}

async function getPriceTableMap(
  company_id: string,
): Promise<Map<string, { erp_code: string | null; price_column: number }>> {
  // Erro sobe (500): mapa vazio faria todo pedido sair com pendência de
  // tabela sem motivo, e o robô do ERP acreditaria.
  const tabelas = await buscarTudoOuFalhar<{
    id: string;
    erp_code: string | null;
    price_column: number | null;
  }>((de, ate) =>
    supabase
      .from('price_tables')
      .select('id, erp_code, price_column')
      .eq('company_id', company_id)
      .order('id')
      .range(de, ate),
  );

  return new Map(
    tabelas.map((t) => [t.id, { erp_code: t.erp_code, price_column: t.price_column ?? 1 }]),
  );
}

/**
 * Pedidos aprovados aguardando importação no ERP (padrão), ou todos os
 * aprovados/importados quando `incluir=todos`. `desde` filtra por
 * atualizado_em >= data (a "data que eu puxei" do parceiro).
 *
 * A lista vem INTEIRA: o PostgREST corta em 1.000 linhas em silêncio, e com
 * `incluir=todos` (a reconciliação) o ERP concluiria que o resto dos pedidos
 * não existe. Erro em qualquer página sobe — nunca "200 com a lista pela
 * metade".
 */
export async function getPartnerOrders(
  company_id: string,
  opts: { desde?: string | undefined; incluirImportados?: boolean },
): Promise<PartnerOrder[]> {
  const colunas = await detectarColunas();
  const select = buildOrderSelect(colunas);

  const linhas = await buscarTudoOuFalhar<OrderRow>((de, ate) => {
    let query = supabase.from('orders').select(select).eq('company_id', company_id);

    if (opts.incluirImportados) {
      query = query.in('status', ['approved', 'sent_erp']);
    } else {
      // A fila: aprovado, sem número do Control e NÃO faturado. O carimbo
      // manual de faturado não exige número — sem este filtro, 19 dos 21
      // pedidos da fila da Corpo Sensual (11/09/2026) já estavam faturados e
      // iriam para o Control de novo.
      query = query.eq('status', 'approved').is('erp_order_id', null);
      if (colunas.invoiced) query = query.or('invoiced.is.null,invoiced.eq.false');
    }
    if (opts.desde) {
      query = query.gte('updated_at', opts.desde);
    }

    // O desempate por id é o que faz o `.range()` valer: dois pedidos criados
    // no mesmo instante trocariam de lugar entre uma página e a outra.
    return query
      .order('created_at', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate);
  });

  const tableMap = await getPriceTableMap(company_id);
  return linhas.map((row) => mapOrder(row, tableMap));
}

export type ConfirmResult =
  | { outcome: 'ok'; ja_confirmado: boolean }
  /** `pedido_erp` fora da máscara duas letras + até 10 dígitos. */
  | { outcome: 'invalid_number' }
  | { outcome: 'not_found' }
  /** Este pedido já tem OUTRO número do Control. */
  | { outcome: 'conflict'; pedido_erp_atual: string }
  /** O status atual não deixa o pedido ir para sent_erp (rascunho, recusado, em triagem…). */
  | { outcome: 'not_confirmable'; situacao: string }
  /** O número já é de OUTRO pedido desta empresa. `pedido_em_uso` é null se não deu para achá-lo. */
  | { outcome: 'number_in_use'; pedido_em_uso: { id: string; numero: number | null } | null };

/** Postgres: violação de chave única — o índice da migração 042 no número do Control. */
const CHAVE_DUPLICADA = '23505';

/** Postgres: "invalid input syntax for type uuid" — o `:id` não tem forma de id. */
const ID_MALFORMADO = '22P02';

interface PedidoLido {
  id: string;
  status: string;
  erp_order_id: string | null;
}

async function lerPedido(company_id: string, order_id: string): Promise<PedidoLido | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, status, erp_order_id')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();

  // Erro de banco NÃO é "não existe": com o `.single()` de antes, um timeout
  // do Supabase virava 404 e o robô do ERP concluía que o pedido tinha sumido.
  // A exceção é o id sem forma de UUID ("abc", ou um id cortado num CHAR(30)
  // do Firebird): o Postgres recusa o texto (22P02), e isso É "não existe
  // pedido com esse id" — como 500, a doc mandaria o ERP repetir a mesma
  // chamada errada em toda rodada, sem nunca chegar a um 4xx.
  if (error) {
    if ((error as { code?: string }).code === ID_MALFORMADO) return null;
    throw new Error(`Falha ao ler o pedido: ${error.message}`);
  }
  return (data as PedidoLido | null) ?? null;
}

/**
 * O OUTRO pedido desta empresa que já usa o número — `null` quando está livre.
 * É a mesma pergunta que o financeiro faz ao lançar à mão (ERP_NUMBER_IN_USE
 * em orders.service.ts); o número do Control é de UM pedido só.
 */
async function donoDoNumero(
  company_id: string,
  numero: string,
  order_id: string,
): Promise<{ id: string; numero: number | null } | null> {
  const temNumero = await detectar('orders', 'order_number');
  const { data, error } = await supabase
    .from('orders')
    .select(temNumero ? 'id, order_number' : 'id')
    .eq('company_id', company_id)
    .eq('erp_order_id', numero)
    .neq('id', order_id)
    .limit(1);

  if (error) throw new Error(`Falha ao conferir o número do Control: ${error.message}`);
  const dono = Array.isArray(data)
    ? (data[0] as { id: string; order_number?: number | null } | undefined)
    : undefined;
  return dono ? { id: dono.id, numero: dono.order_number ?? null } : null;
}

/** Pedido que já tem número: o mesmo é idempotente, outro é conflito. */
function respostaParaJaConfirmado(atual: string, numero: string): ConfirmResult {
  if (normalizarNumeroErp(atual) === numero) return { outcome: 'ok', ja_confirmado: true };
  return { outcome: 'conflict', pedido_erp_atual: atual };
}

/**
 * Confirma a importação: grava o número do pedido gerado no ERP e tira o
 * pedido da fila. Idempotente — repetir com o mesmo número responde ok.
 *
 * A ordem das checagens é contrato (15/09/2026): formato → existe → já tem
 * número → status permite → número livre → grava (só se ninguém gravou no
 * meio). O "já tem número" vem ANTES do status para reconfirmar um `sent_erp`
 * continuar idempotente.
 */
export async function confirmOrderImport(
  company_id: string,
  order_id: string,
  pedido_erp: string,
): Promise<ConfirmResult> {
  // Uma grafia só para o número do Control: é por ele que o faturamento acha o
  // pedido depois, e "sx-14627" não pode virar um pedido diferente de "SX14627".
  // E é a mesma máscara que o financeiro precisa respeitar ao lançar à mão.
  const numero = normalizarNumeroErp(pedido_erp);
  if (!numeroErpValido(numero)) return { outcome: 'invalid_number' };

  const pedido = await lerPedido(company_id, order_id);
  if (!pedido) return { outcome: 'not_found' };

  if (pedido.erp_order_id) return respostaParaJaConfirmado(pedido.erp_order_id, numero);

  // Só o que o fluxo do app deixa ir para sent_erp (hoje approved e error_erp).
  // Sem isto, um id errado promovia rascunho, recusado ou pedido em triagem
  // direto para "enviado ao ERP".
  const destinos = (ORDER_STATUS_FLOW as Record<string, OrderStatus[] | undefined>)[pedido.status];
  if (!destinos?.includes('sent_erp')) return { outcome: 'not_confirmable', situacao: pedido.status };

  const dono = await donoDoNumero(company_id, numero, order_id);
  if (dono) return { outcome: 'number_in_use', pedido_em_uso: dono };

  const agora = new Date().toISOString();
  const { data: afetadas, error } = await supabase
    .from('orders')
    .update({
      status: 'sent_erp',
      erp_order_id: numero,
      synced_at: agora,
      updated_at: agora,
    })
    .eq('id', order_id)
    .eq('company_id', company_id)
    // Só grava se ninguém gravou no meio: duas confirmações simultâneas com
    // números diferentes não podem passar as duas com a última vencendo.
    .is('erp_order_id', null)
    .select('id');

  if (error) {
    // O índice único da 042 pegou o que a pré-checagem não viu (corrida).
    if ((error as { code?: string }).code === CHAVE_DUPLICADA) {
      const emUso = await donoDoNumero(company_id, numero, order_id).catch(() => null);
      return { outcome: 'number_in_use', pedido_em_uso: emUso };
    }
    throw new Error(`Falha ao confirmar pedido: ${error.message}`);
  }

  // Nenhuma linha afetada = alguém confirmou entre a leitura e a gravação.
  // Responde como se o pedido já tivesse número (idempotente ou conflito).
  if (Array.isArray(afetadas) && afetadas.length === 0) {
    const relido = await lerPedido(company_id, order_id);
    if (!relido) return { outcome: 'not_found' };
    if (relido.erp_order_id) return respostaParaJaConfirmado(relido.erp_order_id, numero);
    throw new Error('Falha ao confirmar pedido: nenhuma linha gravada');
  }

  // O Control passou a conhecer o pedido por ESTE caminho também (046): sem a
  // foto aqui, pedido confirmado pela API nunca acusaria "mudou depois de ir
  // para o ERP" quando a venda interna editasse. Acessório: não derruba a
  // confirmação.
  await registrarNoErp(order_id, company_id, null);
  return { outcome: 'ok', ja_confirmado: false };
}
