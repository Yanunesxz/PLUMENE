import { supabase } from '../../config/supabase.js';
import {
  MAX_FAIXAS_DE_BONUS,
  competenciaDe,
  faixasVigentes,
  normalizarFaixas,
  type FaixaDeBonus,
  type MetaDoRepresentante,
} from '@csb/shared';

/**
 * Metas de bonificação por representante (migração 021).
 *
 * A tabela pode não existir ainda — mesmo cuidado do resto deste módulo: pedir
 * uma relação que o PostgREST não conhece derruba a requisição inteira, e a
 * tela de representantes ficaria quebrada até alguém rodar o SQL. Aqui a falta
 * da migração significa "ninguém tem meta cadastrada", que é verdade.
 */
let temTabela: boolean | null = null;

async function detectarTabela(): Promise<boolean> {
  if (temTabela !== null) return temTabela;
  const { error } = await supabase.from('rep_bonus_tiers').select('id').limit(1);
  temTabela = !error;
  return temTabela;
}

/** A migração 021 já está no banco? A tela usa isto para avisar o gerente. */
export async function metasDisponiveis(): Promise<boolean> {
  return detectarTabela();
}

interface LinhaDeFaixa {
  competencia: string;
  ordem: number;
  meta: number;
  bonus: number;
}

function agrupar(linhas: LinhaDeFaixa[]): MetaDoRepresentante[] {
  const porMes = new Map<string, FaixaDeBonus[]>();
  for (const l of [...linhas].sort((a, b) => a.ordem - b.ordem)) {
    // O PostgREST devolve NUMERIC como string; sem o Number a régua compararia
    // "80000" com 80000 e nenhuma faixa seria alcançada.
    const faixa = { meta: Number(l.meta), bonus: Number(l.bonus) };
    porMes.set(l.competencia, [...(porMes.get(l.competencia) ?? []), faixa]);
  }
  return [...porMes.entries()]
    .map(([competencia, faixas]) => ({ competencia, faixas }))
    .sort((a, b) => b.competencia.localeCompare(a.competencia));
}

/** Todo o histórico de metas de um representante, do mês mais novo para o mais velho. */
export async function listarMetas(
  company_id: string,
  user_id: string,
): Promise<MetaDoRepresentante[]> {
  if (!(await detectarTabela())) return [];
  const { data, error } = await supabase
    .from('rep_bonus_tiers')
    .select('competencia, ordem, meta, bonus')
    .eq('company_id', company_id)
    .eq('user_id', user_id)
    .order('competencia', { ascending: false });
  if (error) return [];
  return agrupar((data ?? []) as LinhaDeFaixa[]);
}

/** As faixas que valem para este representante no mês corrente. */
export async function metaVigente(
  company_id: string,
  user_id: string,
  competencia: string = competenciaDe(),
): Promise<FaixaDeBonus[]> {
  return faixasVigentes(await listarMetas(company_id, user_id), competencia);
}

/**
 * Grava as faixas de um mês, substituindo o que havia.
 *
 * Apaga antes de gravar: o gerente pode ter reduzido de quatro faixas para duas,
 * e um upsert deixaria as duas antigas para trás — o representante veria
 * bolinhas que o gerente acabou de tirar.
 *
 * Lista vazia é uma ordem válida: significa "este mês não tem bonificação", e
 * apaga o cadastro do mês. A régua some da tela do representante, que é o certo.
 */
export async function salvarMeta(
  company_id: string,
  user_id: string,
  competencia: string,
  faixas: readonly Partial<FaixaDeBonus>[],
): Promise<{ faixas: FaixaDeBonus[]; disponivel: boolean }> {
  const limpas = normalizarFaixas(faixas);
  if (!(await detectarTabela())) return { faixas: limpas, disponivel: false };

  const mes = competencia.slice(0, 7) + '-01';

  const { error: erroApagar } = await supabase
    .from('rep_bonus_tiers')
    .delete()
    .eq('company_id', company_id)
    .eq('user_id', user_id)
    .eq('competencia', mes);
  if (erroApagar) throw new Error(erroApagar.message);

  if (limpas.length > 0) {
    const linhas = limpas.slice(0, MAX_FAIXAS_DE_BONUS).map((f, ordem) => ({
      company_id,
      user_id,
      competencia: mes,
      ordem,
      meta: f.meta,
      bonus: f.bonus,
    }));
    const { error } = await supabase.from('rep_bonus_tiers').insert(linhas);
    if (error) throw new Error(error.message);
  }

  return { faixas: limpas, disponivel: true };
}
