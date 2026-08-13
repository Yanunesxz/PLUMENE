import type { OrderStatus } from '../constants/orderStatus.js';
import type { OrderSource } from './access.js';

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
  created_by: string;
  approved_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OrderWithItems extends Order {
  items: OrderItem[];
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
