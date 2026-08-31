import type { OrderStatus } from '../constants/orderStatus.js';

// ─── Acesso da loja e vitrine temporária ──────────────────────────────────────
// Dois caminhos para quem NÃO é da fábrica chegar ao catálogo. Nenhum dos dois
// aprova, fatura ou vê estoque: o pedido sempre cai para o representante.

/** Quem montou o pedido. */
export type OrderSource = 'rep' | 'store' | 'showcase';

/** Validades que o representante pode escolher ao gerar uma vitrine (horas). */
export const SHOWCASE_DURATIONS = [1, 6, 12, 24] as const;
export type ShowcaseDuration = (typeof SHOWCASE_DURATIONS)[number];

/** Dias de validade do convite. É link de cadastro, não filtro de curioso. */
export const INVITE_EXPIRY_DAYS = 7;

/**
 * Convite para a loja criar a conta dela. USO ÚNICO: depois de usado, morre.
 * Só existe para cliente que já está na carteira do representante.
 */
export interface StoreInvite {
  id: string;
  customer_id: string;
  /** Razão social do cliente — resolvida para a lista não precisar de outra consulta. */
  customer_name: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  /** Calculado no servidor a partir das datas acima. */
  status: 'pendente' | 'usado' | 'expirado' | 'revogado';
}

/** Vitrine temporária: catálogo que expira, amarrado a um cliente da carteira. */
export interface ShowcaseLink {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  opened_count: number;
  last_opened_at: string | null;
  created_at: string;
  /** O cliente dono do link (035). Nulo = link antigo, de visitante. */
  customer_id?: string | null;
  status: 'ativo' | 'expirado' | 'revogado';
}

export interface CreateInviteRequest {
  customer_id: string;
}

export interface CreateShowcaseLinkRequest {
  hours: ShowcaseDuration;
  /**
   * Com qual tabela o link abre. Omitido, usa a principal do representante.
   * Fica congelada no link: se o conjunto do rep mudar depois, quem recebeu
   * continua vendo o preço que foi mostrado.
   */
  price_table_id?: string | null;
}

/** Resposta das rotas que criam link — `url` só volta AQUI, uma única vez. */
export interface LinkCriado {
  id: string;
  url: string;
  expires_at: string;
}

/** O que a tela pública do convite mostra antes de pedir a senha. */
export interface ConvitePublico {
  customer_name: string;
  company_name: string;
  /**
   * Sugestão para o campo "nome da loja", já limpa do prefixo de CNPJ que a
   * razão social do ERP carrega. A loja pode corrigir: é o nome dela que vai
   * aparecer no app, e o cadastro do ERP nem sempre tem o nome pelo qual ela é
   * conhecida.
   */
  nome_sugerido: string;
}

/** Corpo do formulário que a loja preenche no convite. */
export interface AceitarConviteRequest {
  /** Como a loja quer ser chamada. Vira `users.name`. */
  name: string;
  email: string;
  password: string;
}

/** Sessão devolvida ao abrir uma vitrine. Expira junto com o link. */
export interface SessaoVitrine {
  token: string;
  expires_at: string;
  rep_name: string;
  /** O cliente dono do link — a vitrine cumprimenta e dispensa nome/zap. */
  cliente_nome?: string | null;
}

/**
 * O que a loja vê da própria conta. Tudo em leitura — cadastro é da fábrica.
 *
 * Não tem tabela de preço, e não é esquecimento: saber em qual tabela está é
 * saber que existem outras. Isso é conversa entre a loja e o representante, não
 * informação de tela.
 */
export interface MinhaContaLoja {
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  whatsapp: string | null;
  rep_name: string | null;
  /** Para a loja falar com quem responde por ela sem procurar contato. */
  rep_whatsapp: string | null;
}

/** Números da loja, todos calculados sobre pedidos que não foram recusados. */
export interface ResumoLoja {
  total_pedidos: number;
  /** Somatório das quantidades — "peças", que é como a loja conta. */
  total_pecas: number;
  total_gasto: number;
  ticket_medio: number;
  /** Data do último pedido e há quantos dias ele foi. Nulo em quem nunca pediu. */
  ultimo_pedido_em: string | null;
  dias_desde_ultimo: number | null;
  /** Quantos ainda esperam decisão (do representante ou do gerente). */
  aguardando: number;
}

/** Uma peça no histórico da loja, do que mais compra para o que menos compra. */
export interface PecaComprada {
  product_id: string;
  name: string;
  sku: string;
  image_url: string | null;
  /** Soma das quantidades em todos os pedidos. */
  quantidade: number;
  /** Quantas vezes ela entrou num pedido — recorrência, não volume. */
  vezes: number;
  ultima_compra: string;
}

/** Um pedido no histórico da loja, já resumido para caber na lista. */
export interface PedidoResumido {
  id: string;
  order_number: number | null;
  status: OrderStatus;
  total: number;
  /** Peças no pedido — a loja pergunta "quantas peças", não "quantos itens". */
  pecas: number;
  created_at: string;
}

/**
 * Tudo o que a tela "Minha área" da loja mostra, em UMA resposta.
 *
 * O agrupamento é feito no servidor de propósito: o histórico de peças exige
 * juntar `order_items` de todos os pedidos, e fazer isso no celular custaria uma
 * requisição por pedido.
 */
export interface MinhaAreaLoja {
  conta: MinhaContaLoja;
  resumo: ResumoLoja;
  /** As mais compradas primeiro. No máximo 12. */
  pecas: PecaComprada[];
  /** Os mais recentes primeiro. No máximo 10. */
  pedidos: PedidoResumido[];
  /** Itens do último pedido, prontos para repetir a compra num toque. */
  repetir: Array<{
    product_id: string;
    variant_id: string | null;
    quantity: number;
  }>;
}
