/**
 * Serviço da API de Parceiro — pedidos prontos para importação no ERP.
 *
 * O parceiro (programa do ERP) busca os pedidos aprovados, grava no sistema
 * dele e confirma a importação informando o número gerado no ERP. A partir
 * daí o pedido fica como `sent_erp` e sai da fila.
 *
 * Desde a 049 (decisões de 16/09/2026) a fila é o que o financeiro SOLICITOU:
 * o clique em "Lançar no Control" grava orders.erp_requested_at, e só esses
 * pedidos saem no GET /pedidos. Sem a 049 no banco, a fila é a de antes.
 */
import { supabase } from '../../config/supabase.js';
import {
  coresPorSku,
  divergenciaComOErp,
  semLinhasDeCor,
  normalizarNumeroErp,
  numeroErpValido,
  ORDER_STATUS_FLOW,
} from '@csb/shared';
import type { ItemDaFoto, OrderStatus, PedidoParaComparar } from '@csb/shared';
import { registrarNoErp } from '../orders/erpSync.service.js';
import { gravarOrigemDoNumero, registrarEventoErp } from '../orders/eventosErp.service.js';
import { detectar, detectarOuFalhar } from '../../lib/detectarColuna.js';
import { buscarTudoOuFalhar, emLotes } from '../../lib/paginacao.js';

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
  /**
   * Quando o financeiro solicitou o lançamento ao Control (049,
   * orders.erp_requested_at). Na fila padrão vem sempre preenchido; null em
   * pedido lançado à mão, no passivo e em banco sem a 049.
   */
  solicitado_em: string | null;
  /**
   * O app mudou este pedido DEPOIS de o Control o conhecer? É a comparação do
   * pedido de hoje com a foto do que o Control conhece (046, order_erp_sync):
   * peças, desconto, condição de pagamento ou observação diferentes. NÃO é
   * `updated_at > erp_order_set_at`: a trigger da 013 grava `updated_at` com a
   * hora do banco (sempre um pouco depois do carimbo da confirmação), e o
   * faturamento e as notas regravam `updated_at` sem mudar nada que o Control
   * tenha — todo pedido importado sairia `true` (revisão de 16/09/2026).
   * Fica `true` até alguém confirmar na tela que atualizou no Control (foto
   * nova). `null` quando o pedido ainda não tem número, quando não há foto dele
   * (lançado antes da 046) ou quando o banco não tem a 046.
   * Serve à reconciliação (`incluir=todos`): na fila, é sempre null.
   */
  alterado_apos_importacao: boolean | null;
  cliente: {
    codigo_erp: string | null;
    cnpj: string | null;
    /**
     * A CHAVE ÚNICA do cliente entre os sistemas: o CNPJ só com dígitos
     * (decisão de 16/09/2026). É por ela que o Control casa o cadastro — e
     * cria o cliente quando não acha. `null` quando o cadastro não tem CNPJ.
     */
    chave: string | null;
    /**
     * `true` = o app não tem o código deste cliente no Control (sem `erp_id`).
     * O Control cria o cadastro, casa pelo CNPJ, e devolve o código pelo
     * POST /clientes. Não é pendência: a falta de código deixou de travar.
     */
    novo_no_control: boolean;
    razao_social: string | null;
    nome_fantasia: string | null;
    /**
     * O endereço em pedaços (colunas da 041). Sai sempre com as sete chaves;
     * sem a 041 no banco, ou sem o dado no cadastro, cada uma sai null.
     */
    endereco: EnderecoDoCliente;
    inscricao_estadual: string | null;
    whatsapp: string | null;
    email: string | null;
  };
  representante_erp: string | null;
  /**
   * A tabela que precificou ESTE pedido (orders.price_table_id); na falta, a
   * do cadastro do cliente. `coluna` é a price_column dessa tabela (1 só
   * quando a tabela não tem coluna gravada).
   */
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

export interface EnderecoDoCliente {
  cep: string | null;
  logradouro: string | null;
  numero: string | null;
  complemento: string | null;
  bairro: string | null;
  cidade: string | null;
  uf: string | null;
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
  /** Quando o financeiro solicitou o lançamento (049). Ausente em banco sem a coluna. */
  erp_requested_at?: string | null;
  discount_percent?: number | null;
  /** A condição do pedido (028) — entra na comparação com a foto do Control. */
  payment_condition_id?: string | null;
  invoiced?: boolean | null;
  invoiced_at?: string | null;
  invoiced_total?: number | null;
  payment_condition?: { code: string; description: string | null } | null;
  /** A tabela que precificou o pedido (025). Ausente em banco sem a coluna. */
  price_table_id?: string | null;
  /**
   * Foto antiga da tabela (002). Nenhum código grava esta coluna; fica só como
   * segunda opção para não quebrar um banco que a tenha preenchida à mão.
   */
  price_table_erp_code: string | null;
  price_column: number | null;
  customer: {
    erp_id: string | null;
    cnpj: string | null;
    name: string | null;
    trade_name: string | null;
    rep_erp_id: string | null;
    price_table_id: string | null;
    whatsapp?: string | null;
    email?: string | null;
    cep?: string | null;
    logradouro?: string | null;
    numero?: string | null;
    complemento?: string | null;
    bairro?: string | null;
    cidade?: string | null;
    uf?: string | null;
    inscricao_estadual?: string | null;
  } | null;
  items: Array<{
    product_id?: string | null;
    variant_id?: string | null;
    quantity: number;
    unit_price: number;
    total: number;
    variant: { erp_sku: string | null; size: string | null } | null;
    product: { erp_id: string | null; sku: string | null } | null;
  }>;
}

/** Quais colunas opcionais (migrações 009/025/027/028/029/041) este banco já tem. */
interface ColunasOpcionais {
  orderNumber: boolean;
  invoiced: boolean;
  condition: boolean;
  discount: boolean;
  /** orders.price_table_id (025): a tabela que precificou o pedido. */
  priceTable: boolean;
  /**
   * orders.erp_requested_at (049): o pedido foi SOLICITADO ao Control. Com a
   * coluna, a fila é só o solicitado; sem ela, a fila de antes.
   */
  solicitado: boolean;
  /** customers.cep e as demais colunas do cadastro real (041). */
  cadastroReal: boolean;
}

/** As colunas da 041 que o ERP recebe no cliente do pedido. */
const COLUNAS_DO_CADASTRO_REAL =
  'cep, logradouro, numero, complemento, bairro, cidade, uf, inscricao_estadual';

function buildOrderSelect(c: ColunasOpcionais): string {
  return `
    id, ${c.orderNumber ? 'order_number, ' : ''}status, total, notes,
    created_at, updated_at, erp_order_id, price_table_erp_code, price_column,
    ${c.priceTable ? 'price_table_id, ' : ''}
    ${c.solicitado ? 'erp_requested_at, ' : ''}
    ${c.invoiced ? 'invoiced, invoiced_at, invoiced_total, ' : ''}
    ${c.discount ? 'discount_percent, ' : ''}
    ${c.condition ? 'payment_condition_id, payment_condition:payment_conditions(code, description), ' : ''}
    customer:customers(erp_id, cnpj, name, trade_name, rep_erp_id, price_table_id, whatsapp, email${
      c.cadastroReal ? `, ${COLUNAS_DO_CADASTRO_REAL}` : ''
    }),
    items:order_items(product_id, variant_id, quantity, unit_price, total,
      variant:product_variants(erp_sku, size),
      product:products(erp_id, sku))
  `;
}

/**
 * Colunas de migrações que podem não estar aplicadas (009, 025, 027, 028, 029,
 * 041). Sem a coluna, o campo correspondente sai null/0.
 *
 * `detectar` lembra o "sim" para sempre e o "não" por 30 s: a migração pode
 * rodar com a API de pé e o campo passa a sair sozinho, sem reiniciar. O
 * cache próprio que morava aqui memorizava qualquer erro de rede como
 * "coluna não existe" até o próximo restart.
 *
 * `invoiced` e `erp_requested_at` NÃO podem degradar: são FILTRO da fila (não
 * só campo do SELECT). Se a sonda falhar por rede e for lida como "não
 * existe", a fila sai sem `.or('invoiced...')` e entrega os pedidos faturados à
 * mão — ou sai sem `.not('erp_requested_at'...)` e entrega pedidos que o
 * financeiro ainda não mandou lançar. Exatamente o que os filtros existem para
 * impedir. Então ali o erro sobe (500) e o ERP tenta de novo na próxima
 * rodada, como a doc manda.
 */
async function detectarColunas(): Promise<ColunasOpcionais> {
  // A ordem das sondas de `orders` é a que os testes do dublê seguem; a de
  // `customers` vai por último e não mexe na fila de `orders`.
  const [orderNumber, invoiced, condition, discount, priceTable, solicitado, cadastroReal] = await Promise.all([
    detectar('orders', 'order_number'),
    detectarOuFalhar('orders', 'invoiced'),
    detectar('orders', 'payment_condition_id'),
    detectar('orders', 'discount_percent'),
    detectar('orders', 'price_table_id'),
    detectarOuFalhar('orders', 'erp_requested_at'),
    detectar('customers', 'cep'),
  ]);
  return { orderNumber, invoiced, condition, discount, priceTable, solicitado, cadastroReal };
}

type MapaDeTabelas = Map<string, { erp_code: string | null; price_column: number }>;

/**
 * A tabela e a coluna que o ERP deve usar para ESTE pedido.
 *
 * 1. A tabela do pedido (orders.price_table_id) — é ela que precificou os
 *    itens. Sem `erp_code`, sai null e vira pendência: cair para a tabela do
 *    cliente mandaria o pedido para o Control com o preço de outra tabela.
 * 2. A foto antiga `price_table_erp_code`, com a `price_column` do pedido.
 * 3. A tabela do cadastro do cliente.
 *
 * A coluna é a `price_column` da tabela escolhida. `orders.price_column` é 1
 * em quase todo pedido (padrão do banco) e não diz nada sobre a tabela.
 */
function tabelaDoPedido(row: OrderRow, tableMap: MapaDeTabelas): { codigo_erp: string | null; coluna: number } {
  if (row.price_table_id) {
    const tabela = tableMap.get(row.price_table_id);
    return { codigo_erp: tabela?.erp_code ?? null, coluna: tabela?.price_column ?? 1 };
  }
  const fotoAntiga = row.price_table_erp_code?.trim();
  if (fotoAntiga) return { codigo_erp: fotoAntiga, coluna: row.price_column ?? 1 };

  const idDoCliente = row.customer?.price_table_id;
  const doCliente = idDoCliente ? tableMap.get(idDoCliente) : undefined;
  return { codigo_erp: doCliente?.erp_code ?? null, coluna: doCliente?.price_column ?? 1 };
}

/** Texto aparado, ou null quando vazio. */
function textoOuNull(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const t = v.trim();
  return t ? t : null;
}

/**
 * O CNPJ só com dígitos — a chave do cliente entre os sistemas. `null` sem
 * documento, ou com menos de 11 dígitos (CPF): é a mesma régua do POST
 * /clientes e do /retrato, que só casam a partir de 11. Uma "chave" `123`
 * tirava a pendência e o Control nunca casaria por ela.
 */
function chaveDoCliente(cnpj: unknown): string | null {
  if (typeof cnpj !== 'string') return null;
  const digitos = cnpj.replace(/\D/g, '');
  return digitos.length >= 11 ? digitos : null;
}

/** A pendência do pedido aprovado que o financeiro ainda não mandou lançar (049). */
export const PENDENCIA_NAO_SOLICITADO = 'pedido não solicitado pelo financeiro';

/** O que o Control conhece de cada pedido (a foto da 046), por id do pedido. */
type FotosDoControl = Map<string, PedidoParaComparar>;

/**
 * O app mudou o pedido depois de o Control o conhecer? A comparação é a mesma
 * do aviso "Atualizar no ERP" da tela (`divergenciaComOErp`): peças, desconto,
 * condição e observação do pedido de hoje contra a foto. Sem número, sem foto
 * ou sem a 046: `null` (não se acusa nada).
 */
function alteradoAposImportacao(row: OrderRow, fotos: FotosDoControl | null): boolean | null {
  if (!row.erp_order_id || !fotos) return null;
  const foto = fotos.get(row.id);
  if (!foto) return null;
  const hoje: PedidoParaComparar = {
    items: (row.items ?? []).map((i) => ({
      product_id: i.product_id ?? '',
      variant_id: i.variant_id ?? null,
      quantity: Number(i.quantity ?? 0),
      unit_price: Number(i.unit_price ?? 0),
    })) as ItemDaFoto[],
    discount_percent: row.discount_percent ?? null,
    payment_condition_id: row.payment_condition_id ?? null,
    notes: row.notes,
  };
  return divergenciaComOErp(foto, hoje).mudou;
}

/** O recorte da foto (046) que a comparação usa — nunca o snapshot inteiro. */
interface LinhaDaFoto {
  order_id: string;
  itens: ItemDaFoto[] | null;
  desconto: number | string | null;
  condicao: string | null;
  observacao: string | null;
}

/**
 * As fotos do que o Control conhece (046) dos pedidos que já têm número.
 * `null` quando o banco não tem a 046 (aí `alterado_apos_importacao` sai null).
 * Erro em qualquer lote sobe (500): a reconciliação não pode sair com metade
 * dos pedidos dizendo "não mudou".
 */
async function fotosDoControl(company_id: string, rows: OrderRow[]): Promise<FotosDoControl | null> {
  const ids = rows.filter((r) => r.erp_order_id).map((r) => r.id);
  if (ids.length === 0) return new Map();
  if (!(await detectar('order_erp_sync', 'order_id'))) return null;

  const fotos: FotosDoControl = new Map();
  for (const lote of emLotes(ids)) {
    const linhas = await buscarTudoOuFalhar<LinhaDaFoto>((de, ate) =>
      supabase
        .from('order_erp_sync')
        .select(
          'order_id, itens:snapshot->items, desconto:snapshot->discount_percent, ' +
            'condicao:snapshot->>payment_condition_id, observacao:snapshot->>notes',
        )
        .eq('company_id', company_id)
        .in('order_id', lote)
        .order('order_id')
        .range(de, ate),
    );
    for (const l of linhas) {
      fotos.set(l.order_id, {
        items: Array.isArray(l.itens) ? l.itens : [],
        discount_percent: l.desconto == null ? null : Number(l.desconto),
        payment_condition_id: l.condicao ?? null,
        notes: l.observacao ?? null,
      });
    }
  }
  return fotos;
}

function mapOrder(
  row: OrderRow,
  tableMap: MapaDeTabelas,
  fotos: FotosDoControl | null,
  exigeSolicitacao: boolean,
): PartnerOrder {
  const pendencias: string[] = [];
  const customer = row.customer;

  // Na reconciliação (`incluir=todos`, com a 049) vem também o aprovado que
  // ninguém mandou lançar: o lançamento é o clique do financeiro (decisões 2 e
  // 3), então ele NÃO é importável. Na fila isto nunca acontece — o filtro já
  // exige a solicitação.
  if (exigeSolicitacao && row.status === 'approved' && !row.erp_order_id && !row.erp_requested_at) {
    pendencias.push(PENDENCIA_NAO_SOLICITADO);
  }

  // O CNPJ é a chave do cliente entre os sistemas (16/09/2026): sem código do
  // Control o pedido segue (`novo_no_control`: o Control cria o cadastro e
  // devolve o código pelo POST /clientes); sem CNPJ não há por onde casar.
  const chave = chaveDoCliente(customer?.cnpj);
  if (!chave) pendencias.push('cliente sem CNPJ');
  if (!customer?.rep_erp_id) pendencias.push('cliente sem representante vinculado no ERP');

  const tabela = tabelaDoPedido(row, tableMap);
  if (!tabela.codigo_erp) pendencias.push('pedido sem tabela de preço vinculada no ERP');

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
    solicitado_em: row.erp_requested_at ?? null,
    alterado_apos_importacao: alteradoAposImportacao(row, fotos),
    cliente: {
      codigo_erp: customer?.erp_id ?? null,
      cnpj: customer?.cnpj ?? null,
      chave,
      novo_no_control: !customer?.erp_id,
      razao_social: customer?.name ?? null,
      nome_fantasia: customer?.trade_name ?? null,
      endereco: {
        cep: textoOuNull(customer?.cep),
        logradouro: textoOuNull(customer?.logradouro),
        numero: textoOuNull(customer?.numero),
        complemento: textoOuNull(customer?.complemento),
        bairro: textoOuNull(customer?.bairro),
        cidade: textoOuNull(customer?.cidade),
        uf: textoOuNull(customer?.uf),
      },
      inscricao_estadual: textoOuNull(customer?.inscricao_estadual),
      whatsapp: textoOuNull(customer?.whatsapp),
      email: textoOuNull(customer?.email),
    },
    representante_erp: customer?.rep_erp_id ?? null,
    tabela_preco: tabela,
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
    tabelas.map((t) => [t.id, { erp_code: textoOuNull(t.erp_code), price_column: t.price_column ?? 1 }]),
  );
}

/**
 * Pedidos aprovados aguardando importação no ERP (padrão), ou todos os
 * aprovados/importados quando `incluir=todos`. `desde` filtra por
 * atualizado_em >= data (a "data que eu puxei" do parceiro).
 *
 * A fila padrão (com a 049): aprovado, sem número do Control, NÃO faturado e
 * SOLICITADO pelo financeiro (`erp_requested_at` preenchido) — o lançamento
 * continua sendo um clique dele; a API só entrega o que ele mandou. Sem a
 * 049 no banco, a fila é a de antes (todo aprovado sem número e não faturado).
 *
 * `incluir=todos` continua trazendo `approved` e `sent_erp`, faturados
 * inclusive: é a lista de reconciliação. Importar dela só o que tem
 * `pedido_erp` nulo E `faturado` false E `solicitado_em` preenchido — o resto
 * já está no Control, já foi faturado à mão, ou ninguém pediu ainda.
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
      // E só o que o financeiro SOLICITOU (049). Sem a coluna, a fila de hoje.
      if (colunas.solicitado) query = query.not('erp_requested_at', 'is', null);
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
  // Na fila nenhum pedido tem número: só a reconciliação lê as fotos.
  const fotos = await fotosDoControl(company_id, linhas);
  const exigeSolicitacao = Boolean(opts.incluirImportados) && colunas.solicitado;
  return linhas.map((row) => mapOrder(row, tableMap, fotos, exigeSolicitacao));
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
  /** Aprovado que o financeiro não solicitou ao Control (049): o lançamento é o clique dele. */
  | { outcome: 'not_requested' }
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
  /** 049. A chave só vem onde a coluna existe (o select é `*`). */
  erp_requested_at?: string | null;
}

/** `*`: traz `erp_requested_at` onde a 049 existe sem mandar coluna inexistente onde não existe. */
async function lerPedido(company_id: string, order_id: string): Promise<PedidoLido | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('*')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle<PedidoLido>();

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
  return data ?? null;
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

/**
 * O financeiro já tinha solicitado este pedido ao Control e depois CANCELOU a
 * solicitação? (revisão de 16/09/2026, à tarde)
 *
 * O app não sabe se o Control já puxou o pedido: entre o GET /pedidos (o
 * Control grava no Firebird) e o POST /confirmar o pedido continua sem número,
 * e o financeiro pode cancelar nessa janela. Recusar a confirmação deixaria o
 * pedido no Control sem o número no app — e um novo "Lançar no Control" o
 * importaria de novo. Então o número VENCE o cancelamento.
 *
 * Quem chama já sabe que o pedido está aprovado e sem `erp_requested_at`. Aqui
 * basta saber se ele JÁ FOI solicitado: só o cancelamento tira o carimbo, e o
 * rastro guarda `solicitado_ao_erp` (049) — e `solicitacao_cancelada` com a
 * 050. Sem rastro (048 ausente, ou o evento da solicitação que não gravou), a
 * resposta é a de antes: não solicitado. Soluço do banco sobe (500): o robô
 * tenta de novo, em vez de levar um 409 que ele trataria como definitivo.
 */
async function solicitacaoFoiCancelada(company_id: string, order_id: string): Promise<boolean> {
  if (!(await detectarOuFalhar('order_erp_events', 'id'))) return false;
  const { data, error } = await supabase
    .from('order_erp_events')
    .select('id, tipo')
    .eq('company_id', company_id)
    .eq('order_id', order_id)
    .in('tipo', ['solicitado_ao_erp', 'solicitacao_cancelada'])
    .limit(1);
  if (error) throw new Error(`Falha ao ler o rastro do pedido: ${error.message}`);
  return Array.isArray(data) && data.length > 0;
}

/** Pedido que já tem número: o mesmo é idempotente, outro é conflito. */
function respostaParaJaConfirmado(atual: string, numero: string): ConfirmResult {
  if (normalizarNumeroErp(atual) === numero) return { outcome: 'ok', ja_confirmado: true };
  return { outcome: 'conflict', pedido_erp_atual: atual };
}

/** A linha que o UPDATE devolveu (`.select(...)`), ou undefined. */
function primeiraAfetada(afetadas: unknown): { id: string; order_number?: number | null } | undefined {
  return Array.isArray(afetadas)
    ? (afetadas[0] as { id: string; order_number?: number | null } | undefined)
    : undefined;
}

/**
 * Confirma a importação: grava o número do pedido gerado no ERP e tira o
 * pedido da fila. Idempotente — repetir com o mesmo número responde ok.
 *
 * A ordem das checagens é contrato (15/09/2026): formato → existe → já tem
 * número → status permite → solicitado (049) → número livre → grava (só se
 * ninguém gravou no meio). O "já tem número" vem ANTES do status para
 * reconfirmar um `sent_erp` continuar idempotente.
 *
 * Solicitado (decisões 2 e 3 de 16/09/2026): com a 049 no banco, aprovado sem
 * `erp_requested_at` não é confirmado — o financeiro não mandou lançar, e só a
 * doc impedia o Control de promover a `sent_erp` um pedido da reconciliação.
 * Sem a 049, como antes. A exceção é o pedido cuja solicitação o financeiro
 * CANCELOU depois (`solicitacaoFoiCancelada`): o Control pode tê-lo puxado da
 * fila antes, e a confirmação dele é aceita — o número vence.
 *
 * `parceiro` é o nome da chave que confirmou — vai só para o rastro (048).
 */
export async function confirmOrderImport(
  company_id: string,
  order_id: string,
  pedido_erp: string,
  parceiro: string | null = null,
): Promise<ConfirmResult> {
  // Uma grafia só para o número do Control: é por ele que o faturamento acha o
  // pedido depois, e "cs-17379" não pode virar um pedido diferente de "CS17379".
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

  // A sonda só quando a leitura não trouxe a solicitação: sem a coluna, a
  // chave nem vem; soluço na sonda sobe (500) e o robô tenta de novo. O
  // aprovado cuja solicitação foi CANCELADA depois passa: o Control pode tê-lo
  // puxado antes do cancelamento, e o número dele vence.
  let confirmadoDepoisDoCancelamento = false;
  if (
    pedido.status === 'approved' &&
    !pedido.erp_requested_at &&
    (await detectarOuFalhar('orders', 'erp_requested_at'))
  ) {
    if (!(await solicitacaoFoiCancelada(company_id, order_id))) return { outcome: 'not_requested' };
    confirmadoDepoisDoCancelamento = true;
  }

  const dono = await donoDoNumero(company_id, numero, order_id);
  if (dono) return { outcome: 'number_in_use', pedido_em_uso: dono };

  const agora = new Date().toISOString();
  const patch = {
    status: 'sent_erp',
    erp_order_id: numero,
    synced_at: agora,
    updated_at: agora,
  };
  // De onde veio o número (048): sem a coluna, o patch fica igual ao de hoje.
  await gravarOrigemDoNumero(patch, 'api');
  // A sonda já foi feita pelo `donoDoNumero` e está lembrada.
  const temNumero = await detectar('orders', 'order_number');

  const { data: afetadas, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', order_id)
    .eq('company_id', company_id)
    // Só grava se ninguém gravou no meio: duas confirmações simultâneas com
    // números diferentes não podem passar as duas com a última vencendo.
    .is('erp_order_id', null)
    .select(temNumero ? 'id, order_number' : 'id');

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
  // O rastro (048). Nunca lança; sem a tabela, não grava.
  await registrarEventoErp({
    company_id,
    order_id,
    order_number: primeiraAfetada(afetadas)?.order_number ?? null,
    tipo: 'numero_gravado',
    origem: 'api',
    parceiro,
    // O rastro diz que o número chegou DEPOIS de o financeiro cancelar: é o
    // pedido que o Control já tinha puxado da fila.
    motivo: confirmadoDepoisDoCancelamento
      ? 'confirmado pelo Control depois de a solicitação ser cancelada no app'
      : null,
    antes: { erp_order_id: null, status: pedido.status },
    depois: { erp_order_id: numero, status: 'sent_erp' },
  });
  return { outcome: 'ok', ja_confirmado: false };
}

// ─── Conciliar: o passivo sent_erp sem número ────────────────────────────────

export type ConciliarResult =
  | { outcome: 'ok'; ja_conciliado: boolean }
  /** `pedido_erp` fora da máscara duas letras + até 10 dígitos. */
  | { outcome: 'invalid_number' }
  | { outcome: 'not_found' }
  /** Este pedido já tem OUTRO número do Control. */
  | { outcome: 'conflict'; pedido_erp_atual: string }
  /** Só `sent_erp` sem número é conciliado; aprovado usa o `confirmar`. */
  | { outcome: 'not_reconcilable'; situacao: string }
  /** O número já é de OUTRO pedido desta empresa. */
  | { outcome: 'number_in_use'; pedido_em_uso: { id: string; numero: number | null } | null };

function respostaParaJaConciliado(atual: string, numero: string): ConciliarResult {
  if (normalizarNumeroErp(atual) === numero) return { outcome: 'ok', ja_conciliado: true };
  return { outcome: 'conflict', pedido_erp_atual: atual };
}

/**
 * Dá número do Control a um pedido que foi para o ERP SEM número.
 *
 * É o passivo de antes da API: o financeiro lançou no Control e marcou
 * "enviado ao ERP" na tela sem digitar o número (CS 42 / PL 11 em 15/09). Sem
 * o número, o faturamento pela API não acha esses pedidos. O `confirmar` não
 * serve: ele existe para tirar pedido APROVADO da fila, e deixar ele aceitar
 * `sent_erp` abriria a porta para renumerar pedido já lançado.
 *
 * Ordem (contrato da fase 0): formato → existe → já tem número (o mesmo é
 * idempotente, outro é conflito) → status é sent_erp → número livre → grava só
 * se ninguém gravou no meio e o pedido continua sent_erp. Não mexe no status.
 */
export async function conciliarPedidoErp(
  company_id: string,
  order_id: string,
  pedido_erp: string,
  parceiro: string | null = null,
): Promise<ConciliarResult> {
  const numero = normalizarNumeroErp(pedido_erp);
  if (!numeroErpValido(numero)) return { outcome: 'invalid_number' };

  const pedido = await lerPedido(company_id, order_id);
  if (!pedido) return { outcome: 'not_found' };

  if (pedido.erp_order_id) return respostaParaJaConciliado(pedido.erp_order_id, numero);
  if (pedido.status !== 'sent_erp') return { outcome: 'not_reconcilable', situacao: pedido.status };

  const dono = await donoDoNumero(company_id, numero, order_id);
  if (dono) return { outcome: 'number_in_use', pedido_em_uso: dono };

  const agora = new Date().toISOString();
  const patch = { erp_order_id: numero, synced_at: agora, updated_at: agora };
  await gravarOrigemDoNumero(patch, 'conciliacao');
  const temNumero = await detectar('orders', 'order_number');

  const { data: afetadas, error } = await supabase
    .from('orders')
    .update(patch)
    .eq('id', order_id)
    .eq('company_id', company_id)
    // O pedido tem de continuar como estava na leitura: enviado e sem número.
    .eq('status', 'sent_erp')
    .is('erp_order_id', null)
    .select(temNumero ? 'id, order_number' : 'id');

  if (error) {
    if ((error as { code?: string }).code === CHAVE_DUPLICADA) {
      const emUso = await donoDoNumero(company_id, numero, order_id).catch(() => null);
      return { outcome: 'number_in_use', pedido_em_uso: emUso };
    }
    throw new Error(`Falha ao conciliar pedido: ${error.message}`);
  }

  if (Array.isArray(afetadas) && afetadas.length === 0) {
    // Alguém mexeu entre a leitura e a gravação: responde pelo estado de agora.
    const relido = await lerPedido(company_id, order_id);
    if (!relido) return { outcome: 'not_found' };
    if (relido.erp_order_id) return respostaParaJaConciliado(relido.erp_order_id, numero);
    if (relido.status !== 'sent_erp') return { outcome: 'not_reconcilable', situacao: relido.status };
    throw new Error('Falha ao conciliar pedido: nenhuma linha gravada');
  }

  // A foto do que o Control conhece (046) e o rastro (048). Nenhum dos dois
  // derruba a conciliação: o número já está gravado.
  await registrarNoErp(order_id, company_id, null);
  await registrarEventoErp({
    company_id,
    order_id,
    order_number: primeiraAfetada(afetadas)?.order_number ?? null,
    tipo: 'numero_conciliado',
    origem: 'api',
    parceiro,
    antes: { erp_order_id: null, status: pedido.status },
    depois: { erp_order_id: numero, status: pedido.status },
  });
  return { outcome: 'ok', ja_conciliado: false };
}

// ─── Conciliação: só contagens ───────────────────────────────────────────────

export interface ContagensDaConciliacao {
  /**
   * Aprovado, sem número, não faturado — solicitado ao Control ou não. Antes
   * da 049 era exatamente a fila do `GET /pedidos`; hoje a fila é o subconjunto
   * `aprovados_solicitados_ao_control`.
   */
  fila_aprovados_sem_numero_nao_faturados: number;
  /**
   * A fila do `GET /pedidos` depois da 049: aprovado, sem número, não faturado
   * e com o clique do financeiro em "Lançar no Control" (erp_requested_at).
   * `null` = a 049 ainda não rodou (aí a fila é a grandeza de cima).
   */
  aprovados_solicitados_ao_control: number | null;
  /** O passivo que o `/conciliar` resolve, ainda sem faturamento. */
  enviados_sem_numero_nao_faturados: number;
  /** O mesmo passivo, já faturado à mão. */
  enviados_sem_numero_faturados: number;
  /** Faturado à mão sem nunca ter ido para o Control pelo app. */
  aprovados_faturados_sem_numero: number;
  /** No Control, esperando o faturamento chegar. */
  enviados_com_numero_sem_faturamento: number;
}

interface Grandeza {
  status: 'approved' | 'sent_erp';
  comNumero: boolean;
  faturado: boolean;
  /** `true` = só os solicitados ao Control (erp_requested_at, 049). */
  solicitado?: boolean;
}

const GRANDEZAS: Record<keyof ContagensDaConciliacao, Grandeza> = {
  fila_aprovados_sem_numero_nao_faturados: { status: 'approved', comNumero: false, faturado: false },
  aprovados_solicitados_ao_control: { status: 'approved', comNumero: false, faturado: false, solicitado: true },
  enviados_sem_numero_nao_faturados: { status: 'sent_erp', comNumero: false, faturado: false },
  enviados_sem_numero_faturados: { status: 'sent_erp', comNumero: false, faturado: true },
  aprovados_faturados_sem_numero: { status: 'approved', comNumero: false, faturado: true },
  enviados_com_numero_sem_faturamento: { status: 'sent_erp', comNumero: true, faturado: false },
};

async function contarPedidos(
  company_id: string,
  g: Grandeza,
  colunas: { invoiced: boolean; solicitado: boolean },
): Promise<number | null> {
  // Sem a coluna (banco antes da 027) nenhum pedido está faturado.
  if (g.faturado && !colunas.invoiced) return 0;
  // Sem a 049 não existe "solicitado": a grandeza não tem número honesto.
  if (g.solicitado && !colunas.solicitado) return null;

  // `count: 'exact'` com `limit(0)`: o banco devolve só a contagem, nenhuma
  // linha. GET de verdade — HEAD já disse "existe" para tabela que não existia.
  let query = supabase
    .from('orders')
    .select('id', { count: 'exact' })
    .eq('company_id', company_id)
    .eq('status', g.status);
  query = g.comNumero ? query.not('erp_order_id', 'is', null) : query.is('erp_order_id', null);
  if (colunas.invoiced) {
    query = g.faturado ? query.eq('invoiced', true) : query.or('invoiced.is.null,invoiced.eq.false');
  }
  if (g.solicitado) query = query.not('erp_requested_at', 'is', null);

  const { count, error } = await query.limit(0);
  if (error) throw new Error(`Falha ao contar os pedidos da conciliação: ${error.message}`);
  // Sem contagem não há número honesto para devolver: 500, e o ERP pergunta de novo.
  if (typeof count !== 'number') {
    throw new Error('Falha ao contar os pedidos da conciliação: o banco não devolveu a contagem');
  }
  return count;
}

/**
 * As grandezas da conciliação da empresa da chave — só contagens, nenhuma
 * linha, nenhum dado de cliente. É o painel que o Fábio e o Yan olham antes de
 * ligar o canal e depois de cada rodada. Erro em qualquer contagem sobe (500).
 */
export async function contarConciliacao(company_id: string): Promise<ContagensDaConciliacao> {
  // Como na fila: sonda de `invoiced` que falha por rede não pode virar "sem
  // faturamento" e zerar as contagens de faturados em silêncio.
  const colunas = {
    invoiced: await detectarOuFalhar('orders', 'invoiced'),
    // A 049 degrada: sem ela a grandeza dos solicitados sai `null`.
    solicitado: await detectar('orders', 'erp_requested_at'),
  };
  const nomes = Object.keys(GRANDEZAS) as Array<keyof ContagensDaConciliacao>;
  const valores = await Promise.all(nomes.map((nome) => contarPedidos(company_id, GRANDEZAS[nome], colunas)));

  const contagens = {} as Record<keyof ContagensDaConciliacao, number | null>;
  nomes.forEach((nome, i) => {
    contagens[nome] = valores[i] ?? null;
  });
  return contagens as ContagensDaConciliacao;
}

// ─── Pedidos excluídos que já tinham número do Control ───────────────────────

export interface PedidoExcluidoParceiro {
  /** O id que o pedido tinha no app (o mesmo do `GET /pedidos`). */
  id: string;
  numero: number | null;
  pedido_erp: string;
  excluido_em: string;
}

interface LinhaExcluida {
  order_id: string;
  order_number: number | null;
  deleted_at: string;
  pedido_erp: string | null;
}

/**
 * Os pedidos excluídos no app que já estavam no Control (com número na cópia
 * da 040), para o ERP cancelar do lado dele.
 *
 * Nunca devolve o `snapshot` (tem cliente, peças e valores) nem quem excluiu:
 * só id, número do app, número do Control e o momento. A lista vem inteira,
 * e erro em qualquer página sobe.
 */
export async function listarExcluidosComNumero(
  company_id: string,
  desde?: string,
): Promise<PedidoExcluidoParceiro[]> {
  // Sem a 040 não existe cópia de pedido excluído. Um soluço na sonda, porém,
  // não pode virar "nenhum excluído": aí o erro sobe.
  if (!(await detectarOuFalhar('deleted_orders', 'order_id'))) return [];

  const linhas = await buscarTudoOuFalhar<LinhaExcluida>((de, ate) => {
    let query = supabase
      .from('deleted_orders')
      .select('order_id, order_number, deleted_at, pedido_erp:snapshot->>erp_order_id')
      .eq('company_id', company_id)
      .not('snapshot->>erp_order_id', 'is', null);
    if (desde) query = query.gte('deleted_at', desde);
    return query
      .order('deleted_at', { ascending: true })
      .order('id', { ascending: true })
      .range(de, ate);
  });

  const excluidos: PedidoExcluidoParceiro[] = [];
  for (const linha of linhas) {
    const pedidoErp = textoOuNull(linha.pedido_erp);
    if (!pedidoErp) continue;
    excluidos.push({
      id: linha.order_id,
      numero: linha.order_number ?? null,
      pedido_erp: pedidoErp,
      excluido_em: linha.deleted_at,
    });
  }
  return excluidos;
}

