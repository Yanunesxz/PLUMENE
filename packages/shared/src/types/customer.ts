import type { OrderStatus } from '../constants/orderStatus.js';

// ─── Tabela de preço ──────────────────────────────────────────────────────────
export interface PriceTable {
  id: string;
  company_id: string;
  /** Código ERP — TABELA_PRECO.TABELA_PRECO */
  erp_code: string | null;
  name: string;
  /**
   * Coluna de preço a usar (1–6) — campo COLUNA_TABELA_PRECO do pedido ERP.
   * Corresponde a PRECO1…PRECO6 na ITENS_TABELA_PRECO.
   * Padrão: 1
   */
  price_column: number;
}

// ─── Cliente ──────────────────────────────────────────────────────────────────
export interface Customer {
  id: string;
  company_id: string;
  /** Código ERP — CLIENTE.CLIENTE (CHAR 5) */
  erp_id: string | null;
  /** Razão Social — CLIENTE.RAZAO_SOCIAL */
  name: string;
  /** Nome Fantasia — CLIENTE.NOME_FANTASIA */
  trade_name: string | null;
  /** CNPJ ou CPF */
  cnpj: string | null;
  /** Código do representante vinculado — CLIENTE.REPRESENTANTE */
  rep_erp_id: string | null;
  price_table_id: string | null;
  /** CLIENTE.BLOQUEADO = 'S' */
  blocked: boolean;
  /** CLIENTE.TEXTO_BLOQUEIO (blob) */
  block_reason: string | null;
  /** Limite de crédito — CLIENTE.LIMITE_CREDITO */
  credit_limit: number | null;
  /** WhatsApp principal */
  whatsapp: string | null;
  /** E-mail */
  email: string | null;
  /** Endereço em UMA linha — montado dos campos abaixo (ver linhaDeEndereco). */
  address: string | null;
  /**
   * Cadastro real (migração 041): o endereço como o Control pede, em campos
   * separados, mais a Inscrição Estadual e as observações que o Control
   * insere no pedido. Opcionais no TIPO porque cliente vindo do ERP/cargas
   * antigas não tem; obrigatórios no cadastro novo pelo app (schema da API).
   */
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  inscricao_estadual?: string | null;
  /** "Observações (será inserido no pedido)" — o campo do Control. */
  observacoes?: string | null;
  /** Quem atrelou o código do ERP a um cliente nascido no app, e quando. */
  erp_linked_by?: string | null;
  erp_linked_at?: string | null;
  /**
   * Última compra (migração 036): retrato do Control (Curva ABC) empurrado
   * para frente por todo pedido FATURADO no app. NULL = sem registro.
   */
  last_purchase_at?: string | null;
  /** R$ Total Comprado do Control — retrato, o app não atualiza. */
  total_purchased?: number | null;
  /** R$ Vencido do Control — retrato, o app não atualiza. */
  overdue_amount?: number | null;
  /**
   * Controle de inatividade (migração 039): quando o cliente fica VERMELHO
   * (180+ dias sem comprar), o rep ou o relacionamento registram o porquê.
   */
  inactivity_reason?: string | null;
  /** Observação com as palavras de quem apurou. */
  inactivity_note?: string | null;
  inactivity_updated_at?: string | null;
  updated_at: string;
}

/**
 * Cliente como a lista do app recebe. Subconjunto deliberado de `Customer`: são
 * os campos que as telas realmente usam. A lista completa (1.353 clientes em
 * produção) vai inteira para o cache offline, então cada coluna a mais é peso
 * no 3G do representante — mandar `Customer` inteiro custava 5× isto.
 */
export interface CustomerListItem
  extends Pick<
    Customer,
    | 'id'
    | 'name'
    | 'trade_name'
    | 'cnpj'
    | 'blocked'
    | 'block_reason'
    | 'credit_limit'
    | 'whatsapp'
    // Qual tabela precifica este cliente. Custa 36 caracteres por linha e evita
    // uma segunda requisição por cartão; o rep com duas tabelas ou mais precisa
    // ver isso na lista para saber o que está prestes a mudar.
    | 'price_table_id'
    // O código do cliente NO CONTROL. Pesa ~5 caracteres e é o que o
    // financeiro confere no pedido antes de lançar no ERP.
    | 'erp_id'
    // A carteira inteligente: a data diz quem parou de comprar, o vencido diz
    // quem precisa de cobrança. ~15 caracteres por linha, e é o que transforma
    // a lista de clientes numa ferramenta de trabalho do representante.
    | 'last_purchase_at'
    | 'overdue_amount'
    // O controle por cores: cliente vermelho SEM motivo é pendência visível na
    // lista — é o que cobra o preenchimento sem precisar de relatório.
    | 'inactivity_reason'
  > {}

/** O rep (ou o relacionamento) explica o cliente vermelho. */
export interface MarcarInatividadeRequest {
  motivo: string;
  observacao?: string;
}

/**
 * O cadastro de cliente pelo app — "mais real", igual ao do Control (Yan,
 * 10/09/2026): CPF/CNPJ com dígito verificador, endereço estruturado com CEP
 * obrigatório. Os campos ficam opcionais NO TIPO (o service é chamado por
 * cargas e testes que não têm tudo); quem obriga é o schema da rota.
 */
export interface CreateCustomerRequest {
  name: string;
  trade_name?: string | null;
  cnpj?: string | null;
  inscricao_estadual?: string | null;
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  whatsapp?: string | null;
  email?: string | null;
  observacoes?: string | null;
  /** Linha pronta. Só para quem não tem os campos separados (cargas antigas). */
  address?: string | null;
  /**
   * Tabela do cliente. Só quem tem duas ou mais escolhe — para os outros o
   * servidor usa a única que o rep tem. Sempre revalidada contra o conjunto
   * dele: o que vem daqui é pedido, não permissão.
   */
  price_table_id?: string | null;
}

/**
 * A única edição de cliente que o app permite hoje.
 *
 * Deliberadamente estreita: trocar a tabela muda o preço de tudo que a loja
 * comprar dali para frente, e é um risco diferente do de corrigir um telefone.
 */
export interface UpdateCustomerTableRequest {
  price_table_id: string;
}

/**
 * O financeiro atrela o número do cliente NO ERP a um cadastro nascido no app.
 * "Quando conectar no sistema vai ter que ter número dos clientes, e esses
 * números vão ter que ser incluídos e atrelados" (Yan, 10/09/2026). O código é
 * normalizado no servidor: "#2225", "2225" e "02225" viram "02225".
 */
export interface AtrelarCodigoErpRequest {
  erp_id: string;
}

/** Um pedido na ficha do cliente. Sem contagem de peças de propósito: somar
 *  peças exige cruzar `order_items` de todos os pedidos, e a ficha não mostra
 *  isso — seriam duas consultas grandes para um número que ninguém lê aqui. */
export interface PedidoDoCliente {
  id: string;
  order_number: number | null;
  status: OrderStatus;
  total: number;
  created_at: string;
}

/**
 * A ficha do cliente, como o representante a vê.
 *
 * Diferente de `MinhaAreaLoja` em uma coisa que importa: aqui a tabela de preço
 * APARECE. Para a loja ela é escondida (saber que está na 03 é saber que
 * existem 01 e 02); para quem vende, é o dado que decide o preço e precisa
 * estar à vista antes de começar o pedido.
 */
export interface CustomerDetail {
  id: string;
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  whatsapp: string | null;
  email: string | null;
  address: string | null;
  credit_limit: number | null;
  blocked: boolean;
  block_reason: string | null;
  price_table_id: string | null;
  /** O número do cliente no Control. Nulo = nasceu no app e ainda não foi atrelado. */
  erp_id?: string | null;
  /** Cadastro real (migração 041). */
  cep?: string | null;
  logradouro?: string | null;
  numero?: string | null;
  complemento?: string | null;
  bairro?: string | null;
  cidade?: string | null;
  uf?: string | null;
  inscricao_estadual?: string | null;
  observacoes?: string | null;
  erp_linked_at?: string | null;
  /** Última compra (migração 036) — a ficha mostra a cor do cliente. */
  last_purchase_at?: string | null;
  /** Controle de inatividade (migração 039). */
  inactivity_reason?: string | null;
  inactivity_note?: string | null;
  inactivity_updated_at?: string | null;
  /** Do mais recente para o mais antigo. */
  pedidos: PedidoDoCliente[];
}
