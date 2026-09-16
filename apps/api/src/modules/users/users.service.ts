import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { hashPassword } from '../../lib/password.js';
import { deleteRep } from '../reps/reps.service.js';
import { TODAS_PERMISSOES } from '@csb/shared';
import type {
  UsuarioListItem,
  CriarUsuarioRequest,
  AtualizarUsuarioRequest,
  PermissaoGerente,
  UserRole,
} from '@csb/shared';

export type MotivoUsuario =
  | 'nao_encontrado'
  | 'email_em_uso'
  | 'proprio_login'
  | 'ultimo_admin'
  | 'tem_pedidos'
  | 'papel_invalido'
  | 'erro';

export type ResultadoUsuario =
  | { ok: true; usuario: UsuarioListItem; teclas_ignoradas?: boolean }
  | { ok: false; motivo: MotivoUsuario; pedidos?: number };

export type ResultadoExclusao =
  | { ok: true; clientes_sem_representante: number }
  | { ok: false; motivo: MotivoUsuario; pedidos?: number };

/** Ordem da tela: quem tem mais poder primeiro. */
const ORDEM_PAPEL: Record<UserRole, number> = { admin: 0, manager: 1, financeiro: 2, relacionamento: 3, rep: 4, store: 5 };

/**
 * `permissions` e `last_login_at` vêm da 022, que pode não estar aplicada.
 * Nomear coluna inexistente faz o PostgREST recusar a query INTEIRA — a tela
 * ficaria vazia até alguém rodar o SQL. Por isso a LEITURA usa `select('*')`,
 * que traz o que existir, e só a ESCRITA precisa saber. Mesmo padrão do
 * `detectarErpRepId` em reps.service.
 */
async function detectarColunasDeControle(): Promise<boolean> {
  return detectar('users', 'permissions, last_login_at');
}

interface LinhaUsuario {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  active: boolean;
  created_at: string;
  permissions?: string[] | null;
  last_login_at?: string | null;
}

/**
 * Linha do banco → item da tela, campo a campo.
 *
 * Explícito de propósito: `select('*')` na tabela `users` traz `password_hash`
 * junto, e espalhar a linha com spread seria o suficiente para publicar o hash
 * de todo mundo numa resposta HTTP.
 */
function paraItem(linha: LinhaUsuario): UsuarioListItem {
  return {
    id: linha.id,
    name: linha.name,
    email: linha.email,
    role: linha.role,
    active: linha.active,
    created_at: linha.created_at,
    last_login_at: linha.last_login_at ?? null,
    permissions: (linha.permissions as PermissaoGerente[] | null | undefined) ?? null,
  };
}

/** Tecla que não existe é recusada: array com lixo vira permissão que nunca liga. */
export function teclasValidas(teclas: readonly string[]): teclas is PermissaoGerente[] {
  return teclas.every((t) => (TODAS_PERMISSOES as readonly string[]).includes(t));
}

export async function listUsuarios(company_id: string): Promise<UsuarioListItem[]> {
  const { data, error } = await supabase
    .from('users')
    .select('*')
    .eq('company_id', company_id)
    .order('name');

  if (error || !data) return [];
  return (data as LinhaUsuario[])
    .map(paraItem)
    .sort(
      (a, b) => ORDEM_PAPEL[a.role] - ORDEM_PAPEL[b.role] || a.name.localeCompare(b.name, 'pt-BR'),
    );
}

/** Sobraria algum admin ativo na empresa sem contar este? */
async function sobraOutroAdmin(company_id: string, excetoId: string): Promise<boolean> {
  const { count } = await supabase
    .from('users')
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('role', 'admin')
    .eq('active', true)
    .neq('id', excetoId);
  return (count ?? 0) > 0;
}

async function buscar(company_id: string, id: string): Promise<LinhaUsuario | null> {
  const { data } = await supabase
    .from('users')
    .select('*')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  return (data as LinhaUsuario | null) ?? null;
}

export async function criarUsuario(
  company_id: string,
  body: CriarUsuarioRequest,
): Promise<ResultadoUsuario> {
  // Financeiro e relacionamento entram aqui junto: são logins da fábrica,
  // criados pelo admin como os outros. Rep e loja continuam nascendo nos
  // fluxos próprios (carteira/acesso).
  if (
    body.role !== 'admin' &&
    body.role !== 'manager' &&
    body.role !== 'financeiro' &&
    body.role !== 'relacionamento'
  ) {
    return { ok: false, motivo: 'papel_invalido' };
  }
  if (body.permissions && !teclasValidas(body.permissions)) {
    return { ok: false, motivo: 'papel_invalido' };
  }

  // Teclas só têm sentido em gerente. Gravar num admin seria um campo que
  // ninguém lê e que confunde quem for depurar isto depois.
  const guardarTeclas = body.role === 'manager' && body.permissions !== undefined;
  const colunas = guardarTeclas ? await detectarColunasDeControle() : false;

  const email = body.email.trim().toLowerCase();
  const { data: existe } = await supabase
    .from('users')
    .select('id')
    .eq('email', email)
    .maybeSingle();
  if (existe) return { ok: false, motivo: 'email_em_uso' };

  const { data, error } = await supabase
    .from('users')
    .insert({
      company_id,
      name: body.name.trim(),
      email,
      password_hash: await hashPassword(body.password),
      role: body.role,
      active: true,
      ...(guardarTeclas && colunas ? { permissions: body.permissions } : {}),
    })
    .select('*')
    .single();

  if (error || !data) {
    console.error('[users] falha ao criar login:', error?.code, error?.message);
    return { ok: false, motivo: 'erro' };
  }

  return {
    ok: true,
    usuario: paraItem(data as LinhaUsuario),
    ...(guardarTeclas && !colunas ? { teclas_ignoradas: true } : {}),
  };
}

export async function atualizarUsuario(
  company_id: string,
  quemPede: string,
  id: string,
  body: AtualizarUsuarioRequest,
): Promise<ResultadoUsuario> {
  // O admin logado mexendo no próprio login: bloquear, excluir ou virar gerente
  // são os três caminhos para ele se trancar fora sem tela para desfazer.
  const seMutila =
    id === quemPede && (body.active === false || (body.role !== undefined && body.role !== 'admin'));
  if (seMutila) return { ok: false, motivo: 'proprio_login' };

  const alvo = await buscar(company_id, id);
  if (!alvo) return { ok: false, motivo: 'nao_encontrado' };

  if (
    body.role !== undefined &&
    body.role !== 'admin' &&
    body.role !== 'manager' &&
    body.role !== 'financeiro' &&
    body.role !== 'relacionamento'
  ) {
    return { ok: false, motivo: 'papel_invalido' };
  }
  if (body.permissions != null && !teclasValidas(body.permissions)) {
    return { ok: false, motivo: 'papel_invalido' };
  }

  // Tirar o último admin ativo deixa a fábrica sem ninguém que possa criar
  // outro — só SQL no banco resolveria.
  const perdeAdmin =
    alvo.role === 'admin' &&
    (body.active === false || (body.role !== undefined && body.role !== 'admin'));
  if (perdeAdmin && !(await sobraOutroAdmin(company_id, id))) {
    return { ok: false, motivo: 'ultimo_admin' };
  }

  const update: Record<string, unknown> = {};

  if (body.email !== undefined) {
    const email = body.email.trim().toLowerCase();
    const { data: existe } = await supabase
      .from('users')
      .select('id')
      .eq('email', email)
      .neq('id', id)
      .maybeSingle();
    if (existe) return { ok: false, motivo: 'email_em_uso' };
    update['email'] = email;
  }
  if (body.name !== undefined) update['name'] = body.name.trim();
  if (body.active !== undefined) update['active'] = body.active;
  if (body.role !== undefined) update['role'] = body.role;
  if (body.password) update['password_hash'] = await hashPassword(body.password);

  const querTeclas = body.permissions !== undefined;
  const colunas = querTeclas ? await detectarColunasDeControle() : false;
  if (querTeclas && colunas) update['permissions'] = body.permissions;

  if (Object.keys(update).length === 0) {
    return {
      ok: true,
      usuario: paraItem(alvo),
      ...(querTeclas && !colunas ? { teclas_ignoradas: true } : {}),
    };
  }

  // `users.updated_at` vem da 048 (sem gatilho): só vai com a coluna no banco,
  // senão o PostgREST recusaria a edição inteira do login.
  if (await detectar('users', 'updated_at')) update['updated_at'] = new Date().toISOString();

  const { data, error } = await supabase
    .from('users')
    .update(update)
    .eq('id', id)
    .eq('company_id', company_id)
    .select('*')
    .maybeSingle();

  if (error) {
    console.error('[users] falha ao atualizar login:', error.code, error.message);
    return { ok: false, motivo: 'erro' };
  }
  if (!data) return { ok: false, motivo: 'nao_encontrado' };

  return {
    ok: true,
    usuario: paraItem(data as LinhaUsuario),
    ...(querTeclas && !colunas ? { teclas_ignoradas: true } : {}),
  };
}

export async function excluirUsuario(
  company_id: string,
  quemPede: string,
  id: string,
): Promise<ResultadoExclusao> {
  if (id === quemPede) return { ok: false, motivo: 'proprio_login' };

  const alvo = await buscar(company_id, id);
  if (!alvo) return { ok: false, motivo: 'nao_encontrado' };

  if (alvo.role === 'admin' && !(await sobraOutroAdmin(company_id, id))) {
    return { ok: false, motivo: 'ultimo_admin' };
  }

  // Representante tem regra própria — carteira que fica sem dono, pedido que
  // segura a exclusão. Chamar o que já existe em vez de reescrever aqui.
  if (alvo.role === 'rep') {
    const r = await deleteRep(company_id, id);
    if (r.ok) return { ok: true, clientes_sem_representante: r.unassigned_customers };
    if (r.reason === 'has_orders') {
      return { ok: false, motivo: 'tem_pedidos', pedidos: r.orders ?? 0 };
    }
    if (r.reason === 'not_found') return { ok: false, motivo: 'nao_encontrado' };
    return { ok: false, motivo: 'erro' };
  }

  // `orders.created_by` e `orders.approved_by` são NOT NULL sem ON DELETE: o
  // banco recusaria a exclusão com erro de FK. Melhor perguntar antes e devolver
  // uma frase que diz o que fazer do que traduzir violação de chave estrangeira.
  const { count } = await supabase
    .from('orders')
    .select('id', { count: 'exact', head: true })
    .or(`created_by.eq.${id},approved_by.eq.${id},rep_id.eq.${id}`);
  if ((count ?? 0) > 0) return { ok: false, motivo: 'tem_pedidos', pedidos: count ?? 0 };

  const { error } = await supabase.from('users').delete().eq('id', id).eq('company_id', company_id);
  if (error) {
    console.error('[users] falha ao excluir login:', error.code, error.message);
    return { ok: false, motivo: 'erro' };
  }
  return { ok: true, clientes_sem_representante: 0 };
}
