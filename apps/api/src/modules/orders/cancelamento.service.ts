import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { podeCancelarPedido, podeInformarMotivo, type MotivoDeCancelamento, type PodeCancelar } from '@csb/shared';
import type { AuthRole, Order } from '@csb/shared';

/**
 * CANCELAR PEDIDO com motivo (migração 053).
 *
 * Pedido da Larissa pelo Yan (30/09/2026). O pedido vai a 'rejected' — o
 * status que filas, meta e CRM já tratam como fora do caminho — e ganha o
 * porquê: o motivo da lista do admin (guardado pelo texto da hora), a
 * observação opcional, quem e quando.
 */

async function temAsColunas(): Promise<boolean> {
  return detectar('orders', 'cancelled_at');
}

async function temOsMotivos(): Promise<boolean> {
  return detectar('order_cancel_reasons', 'id');
}

// ─── Motivos (o admin mantém) ────────────────────────────────────────────────

export async function listarMotivos(
  company_id: string,
  incluirInativos: boolean,
): Promise<MotivoDeCancelamento[] | null> {
  if (!(await temOsMotivos())) return null;
  let q = supabase
    .from('order_cancel_reasons')
    .select('id, label, active, sort_order')
    .eq('company_id', company_id)
    .order('sort_order')
    .order('label');
  if (!incluirInativos) q = q.eq('active', true);
  const { data, error } = await q;
  if (error) return null;
  return (data ?? []) as MotivoDeCancelamento[];
}

export type ResultadoDoMotivo =
  | { ok: true; motivo: MotivoDeCancelamento }
  | { ok: false; motivo: 'sem_migracao' | 'nao_encontrado' | 'repetido' | 'erro' };

function limpar(label: string): string {
  return label.replace(/\s+/g, ' ').trim().toUpperCase();
}

async function jaExiste(company_id: string, label: string, fora?: string): Promise<boolean> {
  const { data } = await supabase
    .from('order_cancel_reasons')
    .select('id, label')
    .eq('company_id', company_id);
  return ((data ?? []) as { id: string; label: string }[]).some(
    (m) => m.id !== fora && limpar(m.label) === limpar(label),
  );
}

export async function criarMotivo(company_id: string, label: string): Promise<ResultadoDoMotivo> {
  if (!(await temOsMotivos())) return { ok: false, motivo: 'sem_migracao' };
  const texto = limpar(label);
  if (await jaExiste(company_id, texto)) return { ok: false, motivo: 'repetido' };
  const { data: ultimos } = await supabase
    .from('order_cancel_reasons')
    .select('sort_order')
    .eq('company_id', company_id)
    .order('sort_order', { ascending: false })
    .limit(1);
  const proxima = (((ultimos ?? []) as { sort_order: number }[])[0]?.sort_order ?? 0) + 1;
  const { data, error } = await supabase
    .from('order_cancel_reasons')
    .insert({ company_id, label: texto, sort_order: proxima })
    .select('id, label, active, sort_order')
    .single();
  if (error || !data) return { ok: false, motivo: 'erro' };
  return { ok: true, motivo: data as MotivoDeCancelamento };
}

export async function editarMotivo(
  company_id: string,
  id: string,
  mudanca: { label?: string | undefined; active?: boolean | undefined },
): Promise<ResultadoDoMotivo> {
  if (!(await temOsMotivos())) return { ok: false, motivo: 'sem_migracao' };
  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (mudanca.label !== undefined) {
    const texto = limpar(mudanca.label);
    if (await jaExiste(company_id, texto, id)) return { ok: false, motivo: 'repetido' };
    patch['label'] = texto;
  }
  if (mudanca.active !== undefined) patch['active'] = mudanca.active;
  const { data, error } = await supabase
    .from('order_cancel_reasons')
    .update(patch)
    .eq('id', id)
    .eq('company_id', company_id)
    .select('id, label, active, sort_order')
    .maybeSingle();
  if (error) return { ok: false, motivo: 'erro' };
  if (!data) return { ok: false, motivo: 'nao_encontrado' };
  return { ok: true, motivo: data as MotivoDeCancelamento };
}

// ─── Cancelar ────────────────────────────────────────────────────────────────

export type ResultadoDoCancelamento =
  | { ok: true; order: Order; soOMotivo: boolean }
  | {
      ok: false;
      reason: 'not_found' | 'sem_migracao' | 'motivo_invalido' | 'erro' | Exclude<PodeCancelar, 'ok'>;
    };

export async function cancelarPedido(
  id: string,
  company_id: string,
  user_id: string,
  role: AuthRole,
  vendaInterna: boolean,
  body: { reason_id: string; note?: string | undefined },
): Promise<ResultadoDoCancelamento> {
  if (!(await temAsColunas()) || !(await temOsMotivos())) return { ok: false, reason: 'sem_migracao' };

  const { data: lido } = await supabase
    .from('orders')
    .select('id, rep_id, status, invoiced, order_number, guest_name')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!lido) return { ok: false, reason: 'not_found' };
  const o = lido as unknown as Order;

  // Pedido já cancelado (inclusive o recusado antes da 053, sem porquê): o
  // financeiro e o admin informam ou trocam o motivo, sem mexer no status.
  const soOMotivo = podeInformarMotivo(o, role);
  const acesso = soOMotivo ? 'ok' : podeCancelarPedido(o, role, user_id, vendaInterna);
  if (acesso !== 'ok') return { ok: false, reason: acesso };

  const { data: motivo } = await supabase
    .from('order_cancel_reasons')
    .select('id, label, active')
    .eq('id', body.reason_id)
    .eq('company_id', company_id)
    .maybeSingle();
  const m = motivo as { id: string; label: string; active: boolean } | null;
  if (!m || !m.active) return { ok: false, reason: 'motivo_invalido' };

  const agora = new Date().toISOString();
  // Só cancela quem ainda não foi faturado nem cancelado: dois toques ao mesmo
  // tempo, ou a nota chegando no meio, não passam por cima um do outro. No
  // caminho "só o motivo", o pedido TEM de continuar cancelado.
  let gravar = supabase
    .from('orders')
    .update({
      status: 'rejected',
      cancel_reason_id: m.id,
      cancel_reason_label: m.label,
      cancel_note: body.note?.trim() || null,
      cancelled_at: agora,
      cancelled_by: user_id,
      updated_at: agora,
    })
    .eq('id', id)
    .eq('company_id', company_id);
  gravar = soOMotivo ? gravar.eq('status', 'rejected') : gravar.neq('status', 'rejected');
  const { data, error } = await gravar
    .or('invoiced.is.null,invoiced.eq.false')
    .select('*')
    .maybeSingle();
  if (error) return { ok: false, reason: 'erro' };
  if (!data) return { ok: false, reason: 'ja_cancelado' };
  return { ok: true, order: data as unknown as Order, soOMotivo };
}

/** O nome de quem cancelou, para o detalhe do pedido dizer "por Larissa". */
export async function nomeDeQuemCancelou(user_id: string | null | undefined): Promise<string | null> {
  if (!user_id) return null;
  const { data } = await supabase.from('users').select('name').eq('id', user_id).maybeSingle();
  return (data as { name: string } | null)?.name ?? null;
}
