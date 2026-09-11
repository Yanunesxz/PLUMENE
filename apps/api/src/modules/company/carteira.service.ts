import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { REGUA_PADRAO, reguaValida, type ReguaDaCarteira } from '@csb/shared';

/**
 * A RÉGUA DA CARTEIRA de uma fábrica — quantos dias sem comprar pintam o
 * cliente de amarelo e de vermelho (migração 043).
 *
 * Pedido do Yan (11/09/2026): "quero que o admin possa mudar isso
 * manualmente". Enquanto a 043 não roda no Supabase, a régua de sempre
 * (90/180) continua valendo e a tela do admin diz que a mudança ainda não tem
 * onde ser guardada — nada de gravar num lugar que não existe e sumir.
 */

async function temAsColunas(): Promise<boolean> {
  return detectar('companies', 'carteira_atencao_dias');
}

export async function lerRegua(company_id: string): Promise<ReguaDaCarteira> {
  if (!(await temAsColunas())) return REGUA_PADRAO;
  const { data } = await supabase
    .from('companies')
    .select('carteira_atencao_dias, carteira_esfriado_dias')
    .eq('id', company_id)
    .maybeSingle();
  const linha = data as { carteira_atencao_dias: number | null; carteira_esfriado_dias: number | null } | null;
  if (!linha) return REGUA_PADRAO;
  return reguaValida({
    atencao: linha.carteira_atencao_dias ?? REGUA_PADRAO.atencao,
    esfriado: linha.carteira_esfriado_dias ?? REGUA_PADRAO.esfriado,
  });
}

export type SalvarReguaResult =
  | { ok: true; regua: ReguaDaCarteira }
  | { ok: false; motivo: 'ordem' | 'sem_migracao' | 'erro' };

export async function salvarRegua(
  company_id: string,
  pedida: Partial<ReguaDaCarteira>,
): Promise<SalvarReguaResult> {
  // `reguaValida` devolve o padrão quando a ordem está trocada; aqui isso seria
  // enganoso — o admin digitou 200/100 e receberia 90/180 de volta sem
  // entender por quê. Então a ordem é conferida antes, e dita.
  const arrumada = reguaValida(pedida);
  const pediuOrdemImpossivel =
    typeof pedida.atencao === 'number' &&
    typeof pedida.esfriado === 'number' &&
    Math.round(pedida.esfriado) <= Math.round(pedida.atencao);
  if (pediuOrdemImpossivel) return { ok: false, motivo: 'ordem' };

  if (!(await temAsColunas())) return { ok: false, motivo: 'sem_migracao' };

  const { error } = await supabase
    .from('companies')
    .update({
      carteira_atencao_dias: arrumada.atencao,
      carteira_esfriado_dias: arrumada.esfriado,
    })
    .eq('id', company_id);
  if (error) return { ok: false, motivo: 'erro' };
  return { ok: true, regua: arrumada };
}
