import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { hashPassword } from '../../lib/password.js';
import { deleteRep } from '../reps/reps.service.js';
import { TODAS_PERMISSOES, ehPapelGerenciavel } from '@csb/shared';
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
  | 'migracao_pendente'
  | 'erro';

/**
 * O banco recusou o PAPEL — falta a migração que o acrescenta ao CHECK de
 * `users.role`.
 *
 * O código sobe antes do SQL (é a regra do CLAUDE.md), então existe uma janela
 * em que a tela de Logins já oferece "Visualizador" (054) e o banco ainda tem
 * o CHECK da 038. Nessa janela o INSERT volta com 23514 e, sem este teste, a
 * resposta era 500 "Não foi possível concluir a operação" — o admin não tem
 * como adivinhar que o que falta é colar o SQL. Agora vira 503
 * MIGRACAO_PENDENTE com a frase que diz o que fazer.
 *
 * Mesmo truque do `recusouOStatus` em orders.service: CHECK não se detecta com
 * SELECT, descobre-se tentando gravar.
 */
function recusouOPapel(error: { code?: string; message?: string } | null): boolean {
  if (!error) return false;
  return error.code === '23514' && /role/i.test(error.message ?? '');
}

export type ResultadoUsuario =
  | { ok: true; usuario: UsuarioListItem; teclas_ignoradas?: boolean }
  | { ok: false; motivo: MotivoUsuario; pedidos?: number };

export type ResultadoExclusao =
  | { ok: true; clientes_sem_representante: number }
  | { ok: false; motivo: MotivoUsuario; pedidos?: number };

/**
 * Ordem da tela: quem tem mais poder primeiro. O visualizador (054) entra
 * depois do escritório e antes de quem vende — é o último dos logins da
 * fábrica justamente porque não altera nada.
 */
const ORDEM_PAPEL: Record<UserRole, number> = {
  admin: 0,
  manager: 1,
  financeiro: 2,
  relacionamento: 3,
  visualizador: 4,
  rep: 5,
  store: 6,
};

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
  // Financeiro, relacionamento e visualizador (054) entram aqui junto: são
  // logins da fábrica, criados pelo admin como os outros. Rep e loja continuam
  // nascendo nos fluxos próprios (carteira/acesso).
  //
  // A lista é `PAPEIS_GERENCIAVEIS`, no shared: estava escrita à mão aqui e na
  // atualização logo abaixo, e sem acertar as DUAS o papel novo respondia
  // `papel_invalido` e o login não nascia.
  if (!ehPapelGerenciavel(body.role)) {
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

  if (recusouOPapel(error)) {
    console.error('[users] o banco não aceita o papel', body.role, '— falta a migração:', error?.message);
    return { ok: false, motivo: 'migracao_pendente' };
  }
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

  // Mesma lista da criação (PAPEIS_GERENCIAVEIS): o papel novo tem de passar
  // nos dois lugares, senão o admin cria o visualizador e não consegue editá-lo.
  if (body.role !== undefined && !ehPapelGerenciavel(body.role)) {
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

  if (recusouOPapel(error)) {
    // `error?.`: `recusouOPapel` não é type guard, então o TypeScript não sabe
    // que aqui `error` nunca é nulo — e `pnpm verify` parava no typecheck.
    console.error('[users] o banco não aceita o papel', update['role'], '— falta a migração:', error?.message);
    return { ok: false, motivo: 'migracao_pendente' };
  }
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
