import { supabase } from '../../config/supabase.js';
import { generateToken, hashToken } from '../../lib/tokens.js';
import type { ShowcaseDuration, ShowcaseLink } from '@csb/shared';

/**
 * Vitrine temporária: catálogo anônimo que expira.
 *
 * Serve para o representante mostrar a coleção a um curioso sem abrir conta.
 * Não existe usuário por trás — abrir o link gera uma sessão que morre junto
 * com ele.
 */

interface LinhaVitrine {
  id: string;
  company_id: string;
  rep_id: string;
  price_table_id: string | null;
  expires_at: string;
  revoked_at: string | null;
  opened_count: number;
  last_opened_at: string | null;
  created_at: string;
}

function statusDe(l: Pick<LinhaVitrine, 'revoked_at' | 'expires_at'>): ShowcaseLink['status'] {
  if (l.revoked_at) return 'revogado';
  if (new Date(l.expires_at) <= new Date()) return 'expirado';
  return 'ativo';
}

function paraLista(l: LinhaVitrine): ShowcaseLink {
  return {
    id: l.id,
    expires_at: l.expires_at,
    revoked_at: l.revoked_at,
    opened_count: l.opened_count,
    last_opened_at: l.last_opened_at,
    created_at: l.created_at,
    status: statusDe(l),
  };
}

export interface VitrineCriada {
  id: string;
  token: string;
  expires_at: string;
}

/** Migração 014 pendente: a tabela do link ainda não existe. */
export class RecursoIndisponivel extends Error {
  constructor() {
    super('ACESSO_INDISPONIVEL');
  }
}

/**
 * Cria a vitrine e devolve o token EM CLARO — é a única vez que ele existe
 * fora do link. A tabela de preço fica congelada aqui: se a do representante
 * mudar depois, quem abriu continua vendo o preço que foi mostrado.
 */
export async function criarVitrine(
  company_id: string,
  rep_id: string,
  price_table_id: string | null,
  horas: ShowcaseDuration,
): Promise<VitrineCriada | null> {
  const token = generateToken();
  const expires_at = new Date(Date.now() + horas * 60 * 60 * 1000).toISOString();

  const { data, error } = await supabase
    .from('showcase_links')
    .insert({
      company_id,
      rep_id,
      price_table_id,
      token_hash: hashToken(token),
      expires_at,
    })
    .select('id, expires_at')
    .single();

  // PGRST205 = tabela ausente. Sem a 014 o recurso inteiro não existe, e um
  // "não foi possível criar" genérico só geraria ligação para o suporte.
  if (error?.code === 'PGRST205') throw new RecursoIndisponivel();
  if (error || !data) return null;
  return { id: (data as { id: string }).id, token, expires_at };
}

export type AberturaVitrine =
  | { ok: true; link: LinhaVitrine }
  | { ok: false; motivo: 'invalido' | 'expirado' | 'revogado' };

/**
 * Valida o token e registra a abertura. O contador serve para o representante
 * saber se o link vazou (aberto 40 vezes = circulou onde não devia).
 */
export async function abrirVitrine(token: string): Promise<AberturaVitrine> {
  const { data } = await supabase
    .from('showcase_links')
    .select('*')
    .eq('token_hash', hashToken(token))
    .maybeSingle();

  if (!data) return { ok: false, motivo: 'invalido' };
  const link = data as LinhaVitrine;

  if (link.revoked_at) return { ok: false, motivo: 'revogado' };
  if (new Date(link.expires_at) <= new Date()) return { ok: false, motivo: 'expirado' };

  await supabase
    .from('showcase_links')
    .update({ opened_count: link.opened_count + 1, last_opened_at: new Date().toISOString() })
    .eq('id', link.id);

  return { ok: true, link };
}

export async function listarVitrines(company_id: string, rep_id: string): Promise<ShowcaseLink[]> {
  const { data, error } = await supabase
    .from('showcase_links')
    .select('*')
    .eq('company_id', company_id)
    .eq('rep_id', rep_id)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error || !data) return [];
  return (data as LinhaVitrine[]).map(paraLista);
}

/** Revoga na hora. Usado quando o representante percebe que o link circulou. */
export async function revogarVitrine(
  id: string,
  company_id: string,
  rep_id: string,
): Promise<boolean> {
  const { data } = await supabase
    .from('showcase_links')
    .update({ revoked_at: new Date().toISOString() })
    .eq('id', id)
    .eq('company_id', company_id)
    .eq('rep_id', rep_id)
    .is('revoked_at', null)
    .select('id')
    .maybeSingle();

  return !!data;
}
