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

/** Vitrine temporária: catálogo anônimo que expira. */
export interface ShowcaseLink {
  id: string;
  expires_at: string;
  revoked_at: string | null;
  opened_count: number;
  last_opened_at: string | null;
  created_at: string;
  status: 'ativo' | 'expirado' | 'revogado';
}

export interface CreateInviteRequest {
  customer_id: string;
}

export interface CreateShowcaseLinkRequest {
  hours: ShowcaseDuration;
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
}

/** Corpo do formulário que a loja preenche no convite. */
export interface AceitarConviteRequest {
  email: string;
  password: string;
}

/** Sessão devolvida ao abrir uma vitrine. Expira junto com o link. */
export interface SessaoVitrine {
  token: string;
  expires_at: string;
  rep_name: string;
}

/** O que a loja vê da própria conta. Tudo em leitura — cadastro é da fábrica. */
export interface MinhaContaLoja {
  name: string;
  trade_name: string | null;
  cnpj: string | null;
  whatsapp: string | null;
  price_table_name: string | null;
  rep_name: string | null;
}
