import type { FastifyRequest, FastifyReply } from 'fastify';
import { supabase } from '../../config/supabase.js';
import { competenciaDe, faixasVigentes, type FaixaDeBonus, type MetaDoRepresentante } from '@csb/shared';
import { metasDisponiveis } from './bonus.service.js';

/**
 * As metas da EQUIPE num mês — o Dashboard do gerente comercial (19/10/2026).
 *
 * Uma leitura só para todos os representantes, em vez de um GET /reps/:id/meta
 * por pessoa: com 40 reps seriam 40 idas ao servidor a cada abertura da tela.
 * A regra do mês que vale é a mesma da régua do rep (`faixasVigentes`): o mês
 * sem cadastro próprio herda o último anterior.
 */

export interface MetaDaEquipe {
  user_id: string;
  faixas: FaixaDeBonus[];
}

export async function metasDaEquipe(company_id: string, competencia: string): Promise<MetaDaEquipe[] | null> {
  if (!(await metasDisponiveis())) return null;
  const mes = `${competencia.slice(0, 7)}-01`;
  const { data, error } = await supabase
    .from('rep_bonus_tiers')
    .select('user_id, competencia, ordem, meta, bonus')
    .eq('company_id', company_id)
    .lte('competencia', mes)
    .order('competencia', { ascending: false });
  if (error) throw new Error(error.message);

  // user → competência → faixas, na ordem cadastrada.
  const porRep = new Map<string, Map<string, { ordem: number; faixa: FaixaDeBonus }[]>>();
  for (const l of (data ?? []) as {
    user_id: string;
    competencia: string;
    ordem: number;
    meta: number | string;
    bonus: number | string;
  }[]) {
    const meses = porRep.get(l.user_id) ?? new Map<string, { ordem: number; faixa: FaixaDeBonus }[]>();
    const lista = meses.get(l.competencia) ?? [];
    // NUMERIC vem como texto do PostgREST — sem o Number nenhuma faixa bateria.
    lista.push({ ordem: l.ordem, faixa: { meta: Number(l.meta), bonus: Number(l.bonus) } });
    meses.set(l.competencia, lista);
    porRep.set(l.user_id, meses);
  }

  return [...porRep.entries()].map(([user_id, meses]) => {
    const historico: MetaDoRepresentante[] = [...meses.entries()].map(([c, linhas]) => ({
      competencia: c,
      faixas: linhas.sort((a, b) => a.ordem - b.ordem).map((x) => x.faixa),
    }));
    return { user_id, faixas: faixasVigentes(historico, mes) };
  });
}

/** GET /reps/metas?competencia=AAAA-MM-01 — leitura (gerente, admin, financeiro, visualizador). */
export async function metasDaEquipeHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id } = request.user;
  const { competencia } = (request.query as { competencia?: string }) ?? {};
  const mes = competencia && /^\d{4}-\d{2}/.test(competencia) ? competencia : competenciaDe();
  try {
    const metas = await metasDaEquipe(company_id, mes);
    await reply.send({ data: { competencia: `${mes.slice(0, 7)}-01`, disponivel: metas !== null, metas: metas ?? [] } });
  } catch (e) {
    request.log.error({ err: e }, 'falha ao ler as metas da equipe');
    await reply.status(500).send({ error: 'Não foi possível ler as metas', code: 'METAS_FALHARAM', statusCode: 500 });
  }
}
