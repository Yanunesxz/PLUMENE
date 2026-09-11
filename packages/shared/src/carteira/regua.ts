/**
 * A RÉGUA DA CARTEIRA — quantos dias sem comprar separam verde, amarelo e
 * vermelho.
 *
 * Era número escrito no código (90 e 180). Virou configuração da fábrica a
 * pedido do Yan (11/09/2026): "quero que o admin possa mudar isso
 * manualmente". Cada marca tem um giro diferente — quem vende pijama de
 * inverno não pode ser medido com a régua de quem vende o ano inteiro.
 *
 * Mora aqui em `shared` porque a MESMA conta roda em três lugares: o selo do
 * cliente no app, o relatório da carteira na API e a fila de tarefas. Régua
 * duplicada é régua que diverge.
 */

export interface ReguaDaCarteira {
  /** Dias sem comprar para ficar AMARELO (atenção). */
  atencao: number;
  /** Dias sem comprar para ficar VERMELHO (esfriado). */
  esfriado: number;
}

/** O que valia antes de a régua ser configurável — e o que a fábrica nova herda. */
export const REGUA_PADRAO: ReguaDaCarteira = { atencao: 90, esfriado: 180 };

/** Limites de sanidade: um ano e meio de carência já é abandono, não régua. */
export const MENOR_PRAZO = 1;
export const MAIOR_PRAZO = 3650;

/**
 * Arruma o que veio do banco ou da tela. O amarelo TEM de vir antes do
 * vermelho: fora dessa ordem a faixa do meio some e o cliente pula de verde
 * para vermelho sem ninguém ser avisado no caminho.
 */
export function reguaValida(regua: Partial<ReguaDaCarteira> | null | undefined): ReguaDaCarteira {
  const atencao = inteiroNaFaixa(regua?.atencao, REGUA_PADRAO.atencao);
  const esfriado = inteiroNaFaixa(regua?.esfriado, REGUA_PADRAO.esfriado);
  return esfriado > atencao ? { atencao, esfriado } : REGUA_PADRAO;
}

function inteiroNaFaixa(valor: unknown, padrao: number): number {
  const n = typeof valor === 'number' ? valor : Number(valor);
  if (!Number.isFinite(n)) return padrao;
  return Math.min(MAIOR_PRAZO, Math.max(MENOR_PRAZO, Math.round(n)));
}

/** O que a tela mostra: a mesma palavra no selo, no filtro e no relatório. */
export type Frescor = 'ativo' | 'esfriando' | 'parado' | 'sem_registro';

/**
 * Em que faixa caem `dias` sem comprar.
 *
 * Os nomes internos são os de sempre (`esfriando` = amarelo, `parado` =
 * vermelho): eles estão em link salvo e em filtro de URL. O que mudou em
 * 11/09/2026 foi o que a pessoa LÊ — "Inativo" virou "Esfriado".
 */
export function frescorPorDias(dias: number, regua: ReguaDaCarteira = REGUA_PADRAO): Frescor {
  if (!Number.isFinite(dias)) return 'sem_registro';
  if (dias >= regua.esfriado) return 'parado';
  if (dias >= regua.atencao) return 'esfriando';
  return 'ativo';
}

/** Dias inteiros desde a data da última compra. `null` quando não há registro. */
export function diasSemComprar(
  lastPurchaseAt: string | null | undefined,
  agora: number = Date.now(),
): number | null {
  if (!lastPurchaseAt) return null;
  const dias = Math.floor((agora - new Date(lastPurchaseAt).getTime()) / 86_400_000);
  return Number.isNaN(dias) ? null : dias;
}
