import { supabase } from '../../config/supabase.js';
import { hashPassword } from '../../lib/password.js';
import type { CreateRepRequest, UpdateRepRequest, RepListItem, PriceTable } from '@csb/shared';
import { DEFAULT_COMMISSION_RATE } from '@csb/shared';

// O embed price_tables(name) pode vir como objeto (1:1) ou array, dependendo da
// inferência do supabase — normalizamos para o nome (ou null).
type EmbeddedTable = { name: string } | { name: string }[] | null | undefined;
function tableName(pt: EmbeddedTable): string | null {
  if (!pt) return null;
  return Array.isArray(pt) ? (pt[0]?.name ?? null) : pt.name;
}

interface RepRow {
  id: string;
  name: string;
  email: string;
  cpf: string | null;
  legal_name: string | null;
  phone: string | null;
  active: boolean;
  price_table_id: string | null;
  commission_rate: number | null;
  erp_rep_id?: string | null;
  created_at: string;
  price_tables: EmbeddedTable;
}

// O embed precisa NOMEAR a FK: depois da migração 018 existem dois caminhos
// entre users e price_tables — o direto (users.price_table_id) e o de
// muitos-para-muitos via rep_price_tables. Com dois, o PostgREST recusa a query
// INTEIRA (PGRST201) em vez de escolher um, e a tela de representantes ficava
// vazia com "0 cadastrados" enquanto o cadastro novo falhava ao reler o registro.
const REP_BASE =
  'id, name, email, cpf, legal_name, phone, active, price_table_id, commission_rate, created_at, price_tables!users_price_table_id_fkey(name)';

// users.erp_rep_id vem da migração 012, que pode não estar aplicada ainda.
// Pedir uma coluna inexistente faz o PostgREST recusar a query INTEIRA — a tela
// de representantes ficaria vazia até alguém rodar o SQL. Detecta uma vez e
// guarda, para o deploy não depender da ordem. (Mesmo padrão do partner.service.)
let temErpRepId: boolean | null = null;

async function detectarErpRepId(): Promise<boolean> {
  if (temErpRepId !== null) return temErpRepId;
  const { error } = await supabase.from('users').select('erp_rep_id').limit(1);
  temErpRepId = !error;
  return temErpRepId;
}

async function repSelect(): Promise<string> {
  return (await detectarErpRepId()) ? `${REP_BASE}, erp_rep_id` : REP_BASE;
}

// rep_price_tables vem da migração 018 — mesmo cuidado do erp_rep_id acima: até
// o Yan rodar o SQL, o conjunto de cada rep é a tabela única que ele já tem.
let temRepPriceTables: boolean | null = null;

async function detectarRepPriceTables(): Promise<boolean> {
  if (temRepPriceTables !== null) return temRepPriceTables;
  const { error } = await supabase.from('rep_price_tables').select('user_id').limit(1);
  temRepPriceTables = !error;
  return temRepPriceTables;
}

/**
 * Normaliza a dupla (tabela do catálogo, conjunto atribuível).
 *
 * O conjunto SEMPRE contém a tabela do catálogo: um rep cuja tabela padrão ele
 * não pode usar é estado inválido. Quando o gerente desmarca a padrão, ela vira
 * a primeira selecionada em vez de gravar essa contradição.
 */
export function normalizarTabelas(
  padraoPedido: string | null | undefined,
  conjuntoPedido: string[] | undefined,
): { padrao: string | null; conjunto: string[] } {
  const conjunto = [...new Set((conjuntoPedido ?? []).filter(Boolean))];

  if (conjunto.length === 0) {
    return padraoPedido ? { padrao: padraoPedido, conjunto: [padraoPedido] } : { padrao: null, conjunto: [] };
  }
  const padrao = padraoPedido && conjunto.includes(padraoPedido) ? padraoPedido : conjunto[0]!;
  return { padrao, conjunto };
}

/** Conjunto de cada rep, em uma consulta só. Chave: user_id. */
async function tabelasPorRep(
  company_id: string,
  userIds: string[],
): Promise<Map<string, string[]>> {
  const mapa = new Map<string, string[]>();
  if (userIds.length === 0 || !(await detectarRepPriceTables())) return mapa;

  const { data } = await supabase
    .from('rep_price_tables')
    .select('user_id, price_table_id')
    .eq('company_id', company_id)
    .in('user_id', userIds);

  for (const linha of (data ?? []) as Array<{ user_id: string; price_table_id: string }>) {
    mapa.set(linha.user_id, (mapa.get(linha.user_id) ?? []).concat(linha.price_table_id));
  }
  return mapa;
}

/**
 * Substitui o conjunto do rep. Devolve `false` quando a 018 ainda não rodou —
 * quem chama PRECISA propagar isso: gravar em silêncio e devolver "salvo com
 * sucesso" faria o gerente acreditar que atribuiu duas tabelas quando não
 * atribuiu nenhuma.
 */
async function gravarConjunto(
  company_id: string,
  user_id: string,
  conjunto: string[],
): Promise<boolean> {
  if (!(await detectarRepPriceTables())) return false;

  await supabase.from('rep_price_tables').delete().eq('user_id', user_id);
  if (conjunto.length === 0) return true;

  const { error } = await supabase
    .from('rep_price_tables')
    .insert(conjunto.map((price_table_id) => ({ company_id, user_id, price_table_id })));
  return !error;
}

function toRepListItem(row: RepRow, conjunto?: string[]): RepListItem {
  const padrao = row.price_table_id ?? null;
  // Sem a 018, ou rep ainda sem linhas: o conjunto é a tabela que ele já tem.
  const ids = conjunto?.length ? conjunto : padrao ? [padrao] : [];
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    cpf: row.cpf ?? null,
    legal_name: row.legal_name ?? null,
    phone: row.phone ?? null,
    active: row.active,
    price_table_id: padrao,
    price_table_name: tableName(row.price_tables),
    price_table_ids: ids,
    commission_rate: row.commission_rate ?? DEFAULT_COMMISSION_RATE,
    erp_rep_id: row.erp_rep_id ?? null,
    created_at: row.created_at,
  };
}

export async function listReps(company_id: string): Promise<RepListItem[]> {
  const { data, error } = await supabase
    .from('users')
    .select(await repSelect())
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .order('name');

  if (error || !data) return [];
  const linhas = data as unknown as RepRow[];
  const conjuntos = await tabelasPorRep(
    company_id,
    linhas.map((r) => r.id),
  );
  return linhas.map((r) => toRepListItem(r, conjuntos.get(r.id)));
}

/**
 * As tabelas que ESTE representante pode atribuir. É a rota que o app do rep
 * consome: com uma tabela só ele recebe uma, e nunca fica sabendo das outras.
 */
export async function listRepPriceTables(
  company_id: string,
  user_id: string,
): Promise<PriceTable[]> {
  const todas = await listPriceTables(company_id);

  if (!(await detectarRepPriceTables())) {
    const { data: rep } = await supabase
      .from('users')
      .select('price_table_id')
      .eq('id', user_id)
      .maybeSingle();
    const padrao = (rep as { price_table_id: string | null } | null)?.price_table_id;
    return padrao ? todas.filter((t) => t.id === padrao) : [];
  }

  const conjunto = (await tabelasPorRep(company_id, [user_id])).get(user_id) ?? [];
  return todas.filter((t) => conjunto.includes(t.id));
}

/** O rep pode atribuir esta tabela? Revalidação de servidor — a tela não protege. */
export async function repPodeUsarTabela(
  company_id: string,
  user_id: string,
  price_table_id: string,
): Promise<boolean> {
  const permitidas = await listRepPriceTables(company_id, user_id);
  return permitidas.some((t) => t.id === price_table_id);
}

export async function listPriceTables(company_id: string): Promise<PriceTable[]> {
  const { data, error } = await supabase
    .from('price_tables')
    .select('*')
    .eq('company_id', company_id)
    .order('name');

  if (error || !data) return [];
  return data as PriceTable[];
}

export type CreateRepResult =
  | { ok: true; rep: RepListItem; conjunto_ignorado?: boolean }
  | { ok: false; reason: 'email_taken' | 'error' };

export async function createRep(
  company_id: string,
  body: CreateRepRequest,
): Promise<CreateRepResult> {
  const email = body.email.trim().toLowerCase();

  const { data: existing } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existing) return { ok: false, reason: 'email_taken' };

  const { padrao, conjunto } = normalizarTabelas(body.price_table_id, body.price_table_ids);

  const { data, error } = await supabase
    .from('users')
    .insert({
      company_id,
      name: body.name.trim(),
      email,
      password_hash: await hashPassword(body.password),
      role: 'rep',
      active: true,
      cpf: body.cpf.trim(),
      legal_name: body.legal_name?.trim() || null,
      phone: body.phone?.trim() || null,
      price_table_id: padrao,
      commission_rate: body.commission_rate ?? DEFAULT_COMMISSION_RATE,
      ...((await detectarErpRepId()) ? { erp_rep_id: body.erp_rep_id?.trim() || null } : {}),
    })
    .select(await repSelect())
    .single();

  if (error || !data) {
    // "Não foi possível criar o representante" sozinho não diz nada a quem vai
    // consertar. O PGRST201 do embed ambíguo passou despercebido justamente
    // assim: a tela dizia isso e o motivo real ficava invisível.
    console.error('[reps] falha ao criar representante:', error?.code, error?.message);
    return { ok: false, reason: 'error' };
  }

  const linha = data as unknown as RepRow;
  const gravou = await gravarConjunto(company_id, linha.id, conjunto);
  // Sem a 018 o rep fica com a tabela única — é isso que o item devolvido diz.
  return {
    ok: true,
    rep: toRepListItem(linha, gravou ? conjunto : undefined),
    ...(gravou ? {} : { conjunto_ignorado: conjunto.length > 1 }),
  };
}

export type DeleteRepResult =
  | { ok: true; unassigned_customers: number }
  | { ok: false; reason: 'not_found' | 'has_orders' | 'error'; orders?: number };

/**
 * Exclui um representante. Só é permitido quando ele NÃO tem pedidos —
 * pedidos referenciam o rep (histórico/comissões) e o banco bloqueia via FK.
 * Clientes da carteira dele ficam sem representante (FK ON DELETE SET NULL).
 */
export async function deleteRep(company_id: string, id: string): Promise<DeleteRepResult> {
  const { data: rep } = await supabase
    .from('users')
    .select('id')
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .maybeSingle();
  if (!rep) return { ok: false, reason: 'not_found' };

  const { count: orders } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', id);
  if ((orders ?? 0) > 0) return { ok: false, reason: 'has_orders', orders: orders ?? 0 };

  const { count: customers } = await supabase
    .from('customers')
    .select('id', { count: 'exact', head: true })
    .eq('rep_id', id);

  const { error } = await supabase
    .from('users')
    .delete()
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('role', 'rep');
  if (error) return { ok: false, reason: 'error' };

  return { ok: true, unassigned_customers: customers ?? 0 };
}

export type UpdateRepResult =
  | { ok: true; rep: RepListItem; conjunto_ignorado?: boolean }
  | { ok: false; reason: 'email_taken' | 'not_found' | 'error' };

export async function updateRep(
  company_id: string,
  id: string,
  body: UpdateRepRequest,
): Promise<UpdateRepResult> {
  const update: Record<string, unknown> = {};

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    const { data: existing } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', id)
      .maybeSingle();
    if (existing) return { ok: false, reason: 'email_taken' };
    update.email = email;
  }
  if (body.name !== undefined) update.name = body.name.trim();
  if (body.cpf !== undefined) update.cpf = body.cpf.trim() || null;
  if (body.legal_name !== undefined) update.legal_name = body.legal_name?.trim() || null;
  if (body.phone !== undefined) update.phone = body.phone?.trim() || null;
  if (body.commission_rate !== undefined) update.commission_rate = body.commission_rate;

  // Conjunto e padrão andam juntos: mexer em um sem olhar o outro é o que
  // produziria um rep cuja tabela de catálogo ele não tem permissão de usar.
  let conjuntoNovo: string[] | null = null;
  if (body.price_table_ids !== undefined) {
    const atualPadrao =
      body.price_table_id !== undefined
        ? body.price_table_id
        : ((
            await supabase.from('users').select('price_table_id').eq('id', id).maybeSingle()
          ).data as { price_table_id: string | null } | null)?.price_table_id;

    const { padrao, conjunto } = normalizarTabelas(atualPadrao, body.price_table_ids);
    update.price_table_id = padrao;
    conjuntoNovo = conjunto;
  } else if (body.price_table_id !== undefined) {
    update.price_table_id = body.price_table_id || null;
  }
  if (body.erp_rep_id !== undefined && (await detectarErpRepId())) {
    update.erp_rep_id = body.erp_rep_id?.trim() || null;
  }
  if (body.active !== undefined) update.active = body.active;
  if (body.password) update.password_hash = await hashPassword(body.password);

  if (Object.keys(update).length === 0) return { ok: false, reason: 'error' };

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('role', 'rep')
    .select(await repSelect())
    .maybeSingle();

  if (error) {
    console.error('[reps] falha ao atualizar representante:', error.code, error.message);
    return { ok: false, reason: 'error' };
  }
  if (!data) return { ok: false, reason: 'not_found' };

  const linha = data as unknown as RepRow;

  let gravou = true;
  if (conjuntoNovo) gravou = await gravarConjunto(company_id, id, conjuntoNovo);

  const conjunto = gravou
    ? (conjuntoNovo ?? (await tabelasPorRep(company_id, [id])).get(id))
    : undefined;

  return {
    ok: true,
    rep: toRepListItem(linha, conjunto),
    ...(gravou ? {} : { conjunto_ignorado: (conjuntoNovo?.length ?? 0) > 1 }),
  };
}
