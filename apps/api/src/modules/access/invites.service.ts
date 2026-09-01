import { supabase } from '../../config/supabase.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import { hashPassword } from '../../lib/password.js';
import { INVITE_EXPIRY_DAYS, type StoreInvite } from '@csb/shared';

/**
 * Convite para a loja criar a conta dela.
 *
 * USO ÚNICO: assim que a loja define a senha, o convite morre. E só existe para
 * cliente que JÁ está na carteira do representante — é de lá que vêm a tabela
 * de preço, o CNPJ e o dono do pedido.
 */

interface DadosCliente {
  name: string;
  trade_name?: string | null;
}

interface LinhaConvite {
  id: string;
  company_id: string;
  customer_id: string;
  rep_id: string;
  expires_at: string;
  used_at: string | null;
  revoked_at: string | null;
  created_at: string;
  customers?: DadosCliente | DadosCliente[] | null;
}

function dadosCliente(c: LinhaConvite['customers']): DadosCliente | null {
  if (!c) return null;
  return Array.isArray(c) ? (c[0] ?? null) : c;
}

function nomeCliente(c: LinhaConvite['customers']): string {
  return dadosCliente(c)?.name ?? 'Cliente';
}

/**
 * O nome que a loja reconhece como sendo dela.
 *
 * A razão social vem do ERP com o CNPJ na frente — "28.566.837 LUIS RICARDO
 * BUSCARIOLI". Preencher o cadastro com isso faz a loja se ver no app com um
 * nome que ela não usa. Prefere o nome fantasia, tira o prefixo numérico, e se
 * não sobrar nada apresentável devolve vazio: melhor o campo em branco do que
 * um nome errado que ninguém repara e fica para sempre.
 */
function nomeSugerido(c: LinhaConvite['customers']): string {
  const dados = dadosCliente(c);
  if (!dados) return '';
  for (const candidato of [dados.trade_name, dados.name]) {
    const limpo = (candidato ?? '').replace(/^[\d.\-/\s]+/, '').trim();
    if (limpo.length >= 2) return limpo;
  }
  return '';
}

function statusDe(l: LinhaConvite): StoreInvite['status'] {
  if (l.used_at) return 'usado';
  if (l.revoked_at) return 'revogado';
  if (new Date(l.expires_at) <= new Date()) return 'expirado';
  return 'pendente';
}

export interface ConviteCriado {
  id: string;
  token: string;
  expires_at: string;
}

export type CriarConviteResultado =
  | { ok: true; convite: ConviteCriado }
  | { ok: false; motivo: 'cliente_nao_encontrado' | 'ja_tem_login' | 'convite_pendente' | 'erro' };

/**
 * O cliente é da carteira DESTE representante? Mesma regra de `getCustomers`:
 * dono no app (`rep_id`) OU carteira do ERP (`rep_erp_id`). Gerente e admin
 * passam por qualquer cliente da empresa. Compartilhada entre o convite e a
 * vitrine — as duas portas amarram link a cliente.
 */
export async function clienteDaCarteira(
  company_id: string,
  rep_id: string,
  customer_id: string,
  opcoes: { erp_rep_id?: string | null; irrestrito?: boolean } = {},
): Promise<boolean> {
  let consulta = supabase
    .from('customers')
    .select('id')
    .eq('id', customer_id)
    .eq('company_id', company_id);

  if (!opcoes.irrestrito) {
    consulta = opcoes.erp_rep_id
      ? consulta.or(`rep_id.eq.${rep_id},rep_erp_id.eq.${opcoes.erp_rep_id}`)
      : consulta.eq('rep_id', rep_id);
  }

  const { data: cliente } = await consulta.maybeSingle();
  return Boolean(cliente);
}

/** O representante só convida cliente da própria carteira. */
export async function criarConvite(
  company_id: string,
  rep_id: string,
  customer_id: string,
  opcoes: { erp_rep_id?: string | null; irrestrito?: boolean } = {},
): Promise<CriarConviteResultado> {
  const daCarteira = await clienteDaCarteira(company_id, rep_id, customer_id, opcoes);
  if (!daCarteira) return { ok: false, motivo: 'cliente_nao_encontrado' };

  // Uma loja tem no máximo um login (índice único na 014, checado aqui para dar
  // mensagem em vez de erro 500).
  const { data: jaTem } = await supabase
    .from('users')
    .select('id')
    .eq('customer_id', customer_id)
    .maybeSingle();
  if (jaTem) return { ok: false, motivo: 'ja_tem_login' };

  const { data: pendente } = await supabase
    .from('store_invites')
    .select('id')
    .eq('customer_id', customer_id)
    .is('used_at', null)
    .is('revoked_at', null)
    .maybeSingle();
  if (pendente) return { ok: false, motivo: 'convite_pendente' };

  const token = generateToken();
  const expires_at = new Date(Date.now() + INVITE_EXPIRY_DAYS * 86400_000).toISOString();

  const { data, error } = await supabase
    .from('store_invites')
    .insert({ company_id, customer_id, rep_id, token_hash: hashToken(token), expires_at })
    .select('id, expires_at')
    .single();

  if (error || !data) return { ok: false, motivo: 'erro' };
  return { ok: true, convite: { id: (data as { id: string }).id, token, expires_at } };
}

export type AberturaConvite =
  | {
      ok: true;
      convite: LinhaConvite;
      customer_name: string;
      company_name: string;
      nome_sugerido: string;
    }
  | { ok: false; motivo: 'invalido' | 'expirado' | 'usado' | 'revogado' };

/** Valida sem consumir — a tela pública chama isto antes de mostrar o formulário. */
export async function abrirConvite(token: string): Promise<AberturaConvite> {
  const { data } = await supabase
    .from('store_invites')
    .select('*, customers(name, trade_name), companies(name)')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!data) return { ok: false, motivo: 'invalido' };
  const convite = data as LinhaConvite & { companies?: { name: string } | { name: string }[] | null };

  if (convite.used_at) return { ok: false, motivo: 'usado' };
  if (convite.revoked_at) return { ok: false, motivo: 'revogado' };
  if (new Date(convite.expires_at) <= new Date()) return { ok: false, motivo: 'expirado' };

  const empresa = convite.companies;
  return {
    ok: true,
    convite,
    customer_name: nomeCliente(convite.customers),
    nome_sugerido: nomeSugerido(convite.customers),
    company_name: !empresa ? '' : Array.isArray(empresa) ? (empresa[0]?.name ?? '') : empresa.name,
  };
}

export type UsoConvite =
  | { ok: true; user_id: string }
  | { ok: false; motivo: 'invalido' | 'expirado' | 'usado' | 'revogado' | 'email_em_uso' | 'erro' };

/**
 * `users.rep_id` vem da migração 015. Mandar coluna inexistente no INSERT faz o
 * PostgREST recusar a criação INTEIRA — a loja não conseguiria aceitar o
 * convite até alguém rodar o SQL. Detecta uma vez e guarda. (Mesmo padrão de
 * `orders.service.ts` e `reps.service.ts`.)
 */
let temColunaDono: boolean | null = null;

async function detectarColunaDono(): Promise<boolean> {
  if (temColunaDono !== null) return temColunaDono;
  const { error } = await supabase.from('users').select('rep_id').limit(1);
  temColunaDono = !error;
  return temColunaDono;
}

/**
 * Consome o convite e cria a conta.
 *
 * O `used_at` é gravado com a condição `is('used_at', null)`, então duas
 * requisições simultâneas com o mesmo token só resultam em UMA conta: a
 * segunda não encontra linha para atualizar e para antes de criar o usuário.
 */
export async function usarConvite(
  token: string,
  email: string,
  senha: string,
  nome?: string,
): Promise<UsoConvite> {
  const abertura = await abrirConvite(token);
  if (!abertura.ok) return { ok: false, motivo: abertura.motivo };

  const emailNormalizado = email.trim().toLowerCase();
  const { data: emailExistente } = await supabase
    .from('users')
    .select('id')
    .eq('email', emailNormalizado)
    .maybeSingle();
  if (emailExistente) return { ok: false, motivo: 'email_em_uso' };

  const { convite } = abertura;

  const { data: marcado } = await supabase
    .from('store_invites')
    .update({ used_at: new Date().toISOString() })
    .eq('id', convite.id)
    .is('used_at', null)
    .select('id')
    .maybeSingle();
  if (!marcado) return { ok: false, motivo: 'usado' };

  const { data: usuario, error } = await supabase
    .from('users')
    .insert({
      company_id: convite.company_id,
      customer_id: convite.customer_id,
      // O nome que a LOJA informou. A razão social do ERP só entra se ela não
      // mandar nada — é ela quem sabe como quer ser chamada.
      name: nome?.trim() || abertura.customer_name,
      email: emailNormalizado,
      password_hash: await hashPassword(senha),
      role: 'store',
      active: true,
      // Quem convidou é quem responde por esta loja: recebe os pedidos dela e
      // empresta a própria tabela de preço quando o cliente não tem uma.
      ...((await detectarColunaDono()) ? { rep_id: convite.rep_id } : {}),
    })
    .select('id')
    .single();

  if (error || !usuario) {
    // Devolve o convite: sem isto, uma falha aqui queimaria o link e a loja
    // ficaria sem conta e sem convite.
    await supabase.from('store_invites').update({ used_at: null }).eq('id', convite.id);
    return { ok: false, motivo: 'erro' };
  }

  return { ok: true, user_id: (usuario as { id: string }).id };
}

export async function listarConvites(company_id: string, rep_id: string): Promise<StoreInvite[]> {
  const { data, error } = await supabase
    .from('store_invites')
    .select('*, customers(name)')
    .eq('company_id', company_id)
    .eq('rep_id', rep_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return (data as LinhaConvite[]).map((l) => ({
    id: l.id,
    customer_id: l.customer_id,
    customer_name: nomeCliente(l.customers),
    expires_at: l.expires_at,
    used_at: l.used_at,
    revoked_at: l.revoked_at,
    created_at: l.created_at,
    status: statusDe(l),
  }));
}

export async function revogarConvite(
  id: string,
  company_id: string,
  rep_id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('store_invites')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('rep_id', rep_id)
    .is('used_at', null)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  return !!data;
}
