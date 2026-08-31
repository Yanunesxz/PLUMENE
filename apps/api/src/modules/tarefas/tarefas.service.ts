/**
 * Tarefas do representante — o escritório manda, o rep executa.
 *
 * O Fabian (gerência) marca o que fazer; a Bruna (interna, dona da carteira de
 * inativos) liga para o cliente parado e marca a visita COM HORÁRIO — e o
 * representante dá o OK. Ciclo: pendente → confirmada (OK no horário) → feita.
 *
 * Tolera a migração 037 não aplicada: leitura devolve vazio, escrita falha com
 * motivo — o app continua vendendo sem depender da ordem do deploy.
 */
import { supabase } from '../../config/supabase.js';
import type { TarefaDoRep } from '@csb/shared';

let temTarefas: boolean | null = null;

export async function detectarTarefas(): Promise<boolean> {
  if (temTarefas !== null) return temTarefas;
  const { error } = await supabase.from('rep_tasks').select('id').limit(1);
  temTarefas = !error;
  return temTarefas;
}

/** Nomes de usuários e clientes, resolvidos à parte — rep_id e created_by são
 *  duas FKs para users, e o embed do PostgREST se perde com FK dupla. */
async function comNomes(linhas: Record<string, unknown>[]): Promise<TarefaDoRep[]> {
  const userIds = [...new Set(linhas.flatMap((t) => [t.rep_id, t.created_by]))].filter(Boolean);
  const custIds = [...new Set(linhas.map((t) => t.customer_id))].filter(Boolean);
  const [users, custs] = await Promise.all([
    userIds.length
      ? supabase.from('users').select('id, name').in('id', userIds as string[])
      : Promise.resolve({ data: [] }),
    custIds.length
      ? supabase.from('customers').select('id, name').in('id', custIds as string[])
      : Promise.resolve({ data: [] }),
  ]);
  const nomeUser = new Map((users.data ?? []).map((u) => [u.id as string, u.name as string]));
  const nomeCust = new Map((custs.data ?? []).map((c) => [c.id as string, c.name as string]));
  return linhas.map((t) => ({
    id: t.id as string,
    rep_id: t.rep_id as string,
    rep_nome: nomeUser.get(t.rep_id as string) ?? null,
    criado_por_nome: nomeUser.get(t.created_by as string) ?? null,
    customer_id: (t.customer_id as string | null) ?? null,
    cliente_nome: t.customer_id ? (nomeCust.get(t.customer_id as string) ?? null) : null,
    titulo: t.titulo as string,
    prazo: (t.prazo as string | null) ?? null,
    local: (t.local as string | null) ?? null,
    observacoes: (t.observacoes as string | null) ?? null,
    status: t.status as TarefaDoRep['status'],
    created_at: t.created_at as string,
  }));
}

/** Rep vê as SUAS; gerência/financeiro veem as da empresa inteira. */
export async function listarTarefas(
  company_id: string,
  escopo: { rep_id?: string | null },
): Promise<TarefaDoRep[]> {
  if (!(await detectarTarefas())) return [];
  let q = supabase
    .from('rep_tasks')
    .select('*')
    .eq('company_id', company_id)
    .order('status', { ascending: true }) // abertas antes de feitas? ordem alfabética serve: confirmada, feita, pendente — reordenado no app
    .order('prazo', { ascending: true, nullsFirst: false })
    .limit(500);
  if (escopo.rep_id) q = q.eq('rep_id', escopo.rep_id);
  const { data, error } = await q;
  if (error || !data) return [];
  return comNomes(data as Record<string, unknown>[]);
}

export type CriarTarefaResult =
  | { ok: true; tarefa: TarefaDoRep }
  | { ok: false; reason: 'sem_migracao' | 'rep_invalido' | 'falha' };

export async function criarTarefa(
  company_id: string,
  created_by: string,
  body: {
    rep_id?: string | null | undefined;
    customer_id?: string | null | undefined;
    titulo: string;
    prazo?: string | null | undefined;
    local?: string | null | undefined;
    observacoes?: string | null | undefined;
  },
): Promise<CriarTarefaResult> {
  if (!(await detectarTarefas())) return { ok: false, reason: 'sem_migracao' };

  let rep_id = body.rep_id ?? null;
  // Visita a cliente sem rep escolhido: o dono da carteira é o alvo natural —
  // é o fluxo da Bruna, que parte da ficha do cliente parado.
  if (!rep_id && body.customer_id) {
    const { data: cli } = await supabase
      .from('customers')
      .select('rep_erp_id, rep_id')
      .eq('id', body.customer_id)
      .eq('company_id', company_id)
      .maybeSingle();
    const c = cli as { rep_erp_id: string | null; rep_id: string | null } | null;
    if (c?.rep_id) rep_id = c.rep_id;
    else if (c?.rep_erp_id) {
      const { data: rep } = await supabase
        .from('users')
        .select('id')
        .eq('company_id', company_id)
        .eq('role', 'rep')
        .eq('erp_rep_id', c.rep_erp_id)
        .maybeSingle();
      rep_id = (rep as { id: string } | null)?.id ?? null;
    }
  }
  if (!rep_id) return { ok: false, reason: 'rep_invalido' };

  const { data: alvo } = await supabase
    .from('users')
    .select('id, role')
    .eq('id', rep_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!alvo || (alvo as { role: string }).role !== 'rep') return { ok: false, reason: 'rep_invalido' };

  const { data, error } = await supabase
    .from('rep_tasks')
    .insert({
      company_id,
      rep_id,
      created_by,
      customer_id: body.customer_id ?? null,
      titulo: body.titulo.trim(),
      prazo: body.prazo ?? null,
      local: body.local?.trim() || null,
      observacoes: body.observacoes?.trim() || null,
    })
    .select()
    .single();
  if (error || !data) return { ok: false, reason: 'falha' };
  const [tarefa] = await comNomes([data as Record<string, unknown>]);
  return { ok: true, tarefa: tarefa! };
}

export type MudarTarefaResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'forbidden' };

/** O rep dá OK (confirmada) e marca feita — só nas DELE. */
export async function mudarStatusDaTarefa(
  id: string,
  company_id: string,
  rep_id: string,
  status: 'confirmada' | 'feita',
): Promise<MudarTarefaResult> {
  const { data } = await supabase
    .from('rep_tasks')
    .select('id, rep_id')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!data) return { ok: false, reason: 'not_found' };
  if ((data as { rep_id: string }).rep_id !== rep_id) return { ok: false, reason: 'forbidden' };

  const { error } = await supabase
    .from('rep_tasks')
    .update({ status, updated_at: new Date().toISOString() })
    .eq('id', id);
  return error ? { ok: false, reason: 'not_found' } : { ok: true };
}

/** Quem pediu (ou a gerência) desfaz uma tarefa que não vale mais. */
export async function excluirTarefa(
  id: string,
  company_id: string,
  user_id: string,
  irrestrito: boolean,
): Promise<MudarTarefaResult> {
  const { data } = await supabase
    .from('rep_tasks')
    .select('id, created_by')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!data) return { ok: false, reason: 'not_found' };
  if (!irrestrito && (data as { created_by: string }).created_by !== user_id) {
    return { ok: false, reason: 'forbidden' };
  }
  const { error } = await supabase.from('rep_tasks').delete().eq('id', id);
  return error ? { ok: false, reason: 'not_found' } : { ok: true };
}
