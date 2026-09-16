import type { OrderStatus } from '../constants/orderStatus.js';
import type { OrderSource } from './access.js';
import type { PedidoOriginal } from '../pedidos/pedidoOriginal.js';
import type { SincroniaComOErp } from '../pedidos/sincroniaErp.js';
import type { SolicitacaoErp } from './control.js';

export interface OrderItem {
  id: string;
  order_id: string;
  product_id: string;
  /** Referência à variante (tamanho+cor) escolhida */
  variant_id: string | null;
  quantity: number;
  unit_price: number;
  total: number;
}

export interface Order {
  id: string;
  company_id: string;
  /** Número sequencial legível do pedido (ex.: 14534). */
  order_number?: number | null;
  rep_id: string;
  /** Nulo em pedido de vitrine: não há cliente cadastrado por trás. */
  customer_id: string | null;
  /**
   * Tabela que precificou ESTE pedido (migração 025). Nulo nos anteriores a ela
   * — aí quem lê deduz pelo cadastro do cliente, como era antes.
   */
  price_table_id?: string | null;
  /**
   * Condição de pagamento escolhida (migração 028). NULL = ninguém escolheu —
   * a planilha do Control sai com COND PGTO em branco e a fábrica preenche,
   * como sempre foi.
   */
  payment_condition_id?: string | null;
  /**
   * A condição já resolvida (código + descrição), embutida pela API quando a
   * migração 028 está aplicada. É o que as telas mostram e o que a planilha
   * escreve — ninguém precisa refazer a busca.
   */
  payment_condition?: { code: number; description: string } | null;
  status: OrderStatus;
  /** Quem montou: representante, loja logada ou vitrine. */
  source?: OrderSource;
  /** Vitrine: contato informado no fechamento, já que não há cadastro. */
  guest_name?: string | null;
  guest_whatsapp?: string | null;
  total: number | null;
  /**
   * Desconto que o representante deu no pedido inteiro, em % (migração 029).
   * Já está aplicado no `total`; os `unit_price` dos itens seguem sendo o preço
   * de tabela, porque é assim que o formulário do Control espera — ele tem
   * campo próprio para o desconto (DESC %).
   */
  discount_percent?: number | null;
  notes: string | null;
  /** Faturado (boleto/NF emitido). */
  invoiced?: boolean;
  /** Quando foi faturado — é o que põe o pedido no mês certo dos relatórios. */
  invoiced_at?: string | null;
  /**
   * O valor que a nota fechou, informado pelo ERP (migração 027). Costuma ser
   * MENOR que `total`: o que faltou no estoque não é faturado. `null` = o ERP
   * ainda não informou; nesse caso vale o `total`. Use `valorDaVenda`.
   */
  invoiced_total?: number | null;
  /**
   * Entrega confirmada. Sem fonte ainda — nem o gerente marca, nem o ERP
   * informa. Está no contrato para o degrau "Entregue" acender no dia em que
   * existir, sem mexer nas telas de novo.
   */
  delivered?: boolean | null;
  local_id: string | null;
  synced_at: string | null;
  erp_order_id: string | null;
  /**
   * Pedido SOLICITADO ao Control (migração 049): quando o financeiro apertou
   * "Lançar no ERP" com o canal em 'api', e quem. Nulo = não solicitado, ou
   * lançado à mão. Solicitado e com `erp_order_id` nulo = esperando o Control.
   */
  erp_requested_at?: string | null;
  erp_requested_by?: string | null;
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

/**
 * Uma peça que a nota fiscal levou, como o Control informou (migração 048).
 * `produto` e `tamanho` são os mesmos códigos que o GET /partner/v1/pedidos
 * manda; `variant_id` é a variante do catálogo que o app achou para eles
 * (null quando não achou — o item continua guardado).
 */
export interface ItemDaNota {
  produto: string;
  tamanho: string;
  variant_id: string | null;
  quantidade: number;
  preco_unitario: number | null;
}

/** Uma nota fiscal do pedido (migração 048). Série vazia = o Control não mandou. */
export interface NotaDoPedido {
  numero: string;
  serie: string;
  emitida_em: string | null;
  valor: number | null;
  /** Preenchida quando a nota foi cancelada: os itens dela deixam de contar. */
  cancelada_em: string | null;
  /**
   * Nota substituída (migração 049): a nota nova que subiu por cima desta
   * (id em order_invoices) e quando. Ausentes antes da 049; nulos na nota
   * ativa. A tela usa só a nota ativa — ver `NotaSubstituida` para o rastro.
   */
  substituida_por?: string | null;
  substituida_em?: string | null;
  itens: ItemDaNota[];
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
  /**
   * A cópia do pedido como o representante fechou, quando alguém já cortou
   * peça depois disso (migração 044). Ausente = o pedido nunca encolheu, ou
   * a 044 ainda não rodou. O tipo mora em pedidos/pedidoOriginal.ts.
   */
  original?: PedidoOriginal | null;
  /**
   * O que o Control CONHECE deste pedido (migração 046). Presente só em
   * pedido já lançado. Quando as peças de hoje divergem do snapshot, a
   * fábrica está com a versão velha e alguém tem de atualizar lá.
   */
  erp_sync?: SincroniaComOErp | null;
  /**
   * As notas fiscais que o Control informou para este pedido (migração 048),
   * com os itens que cada uma faturou de verdade. Nota cancelada continua na
   * lista, com `cancelada_em`. Lista vazia = nenhuma nota chegou ainda, ou a
   * 048 ainda não rodou. Ausente no cache offline.
   */
  notas?: NotaDoPedido[];
  /**
   * O pedido foi solicitado ao Control (migração 049). Presente só com o canal
   * em 'api' e depois do clique do financeiro; é o que a tela usa para ficar
   * consultando até `erp_order_id` chegar. Nulo = nunca solicitado. Ausente no
   * cache offline e antes da 049.
   */
  solicitacao_erp?: SolicitacaoErp | null;
  /**
   * O link público do pedido (o mesmo do e-mail), montado pela API no
   * GET /orders/:id — o token é assinado no servidor. É o que o representante
   * manda no WhatsApp quando o cliente pede. Ausente no cache offline.
   */
  public_link?: string;
  /**
   * Quem vendeu, já resolvido pela API no GET /orders/:id — nome e o código
   * do representante no Control. É o que o financeiro confere antes de lançar
   * no ERP. Ausente no cache offline.
   */
  rep_info?: { name: string; erp_rep_id: string | null } | null;
}

// ─── Pedido excluído (aba do admin) ──────────────────────────────────────────
/**
 * A cópia que a API guarda um instante antes de apagar um pedido (migração
 * 040). O pedido em si some de `orders`; o que fica é isto — o cabeçalho, as
 * peças já com referência e tamanho, o cliente e o representante —, mais quem
 * apagou e quando. Só o admin lê (GET /orders/excluidos).
 */
export interface PedidoExcluido {
  id: string;
  /** O id que o pedido tinha em `orders`. */
  order_id: string;
  order_number: number | null;
  deleted_at: string;
  deleted_by_name: string | null;
  snapshot: Order & {
    items: Array<
      OrderItem & {
        product?: { sku: string; name: string } | null;
        variant?: { size: string } | null;
      }
    >;
    customer?: { name: string; cnpj: string | null } | null;
    rep?: { name: string } | null;
  };
}

// ─── Pedido na página pública (link do e-mail) ───────────────────────────────
/** Uma referência do pedido, com a grade de tamanhos que o cliente comprou. */
export interface ItemPedidoPublico {
  /** Referência (SKU) do produto. */
  ref: string;
  nome: string;
  /** Foto do catálogo. Nulo = sem foto vinculada. */
  foto: string | null;
  /** Cada tamanho pedido e sua quantidade (ex.: [{ tamanho: 'M', quantidade: 3 }]). */
  tamanhos: Array<{ tamanho: string; quantidade: number }>;
  pecas: number;
  unit_price: number;
  total: number;
}

/**
 * O que a página pública do pedido recebe. Sem login: quem tem o link (do
 * e-mail) vê. Um subconjunto seguro — nada de custo da fábrica, id interno etc.
 */
export interface PedidoPublico {
  numero: string;
  /** ISO da criação. */
  data: string;
  status: OrderStatus;
  /** Passo para a barra de progresso da página. */
  passo: 'enviado' | 'aprovado' | 'entregue' | 'recusado';
  cliente: string;
  representante: string;
  total: number;
  totalPecas: number;
  produtos: ItemPedidoPublico[];
  /** Descrição da condição de pagamento ("30/60/90 DIAS"). Nulo = não escolhida. */
  condicaoDePagamento?: string | null;
  /** `true` = o link já passou dos 7 dias após o faturamento. */
  expirado: boolean;
}

export interface CreateOrderRequest {
  /** Ignorado para loja (usa o cliente dela) e ausente na vitrine. */
  customer_id?: string | undefined;
  notes?: string | undefined;
  local_id?: string | undefined;
  /**
   * `true` = o representante fechou o pedido e ele já entra na fila do gerente
   * (`pending_approval`). `false`/ausente = rascunho, ainda em montagem.
   */
  submit?: boolean | undefined;
  /** Vitrine: quem está pedindo. Obrigatórios nesse caminho, ignorados nos outros. */
  guest_name?: string | undefined;
  guest_whatsapp?: string | undefined;
  /**
   * Desconto em % no pedido inteiro, fechado na montagem. Só o REPRESENTANTE
   * manda — o servidor descarta o campo de loja, vitrine e gerência. Vai para
   * `orders.discount_percent` e já sai aplicado no total.
   */
  discount_percent?: number | undefined;
  /**
   * O mesmo desconto, em REAIS. Mande um OU outro: o servidor converte o valor
   * em percentual usando a soma que ele mesmo calculou dos itens — nunca um
   * total vindo do aparelho. Valor maior que o pedido é ignorado.
   */
  discount_value?: number | undefined;
  /**
   * Condição de pagamento escolhida por quem montou (rep ou loja). Opcional:
   * sem ela o pedido sai como sempre saiu, com o COND PGTO em branco.
   */
  payment_condition_id?: string | undefined;
  items: Array<{
    product_id: string;
    variant_id?: string | undefined;
    quantity: number;
    unit_price: number;
  }>;
}

export interface UpdateOrderStatusRequest {
  status: OrderStatus;
  notes?: string;
  /**
   * Ao LANÇAR (sent_erp): o número que o Control deu ao pedido — duas letras
   * e a numeração ("SX14627"). Obrigatório nesse passo; quem cunha é o ERP.
   */
  erp_order_id?: string;
}

export interface OfflineSyncOrder extends CreateOrderRequest {
  local_id: string;
  created_at: string;
  updated_at: string;
}

export interface SyncRequest {
  orders: OfflineSyncOrder[];
}

export interface SyncResult {
  synced: number;
  failed: Array<{ local_id: string; error: string }>;
}
