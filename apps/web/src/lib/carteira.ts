/**
 * A régua da carteira: quem está comprando, quem esfriou, quem parou.
 *
 * A data vem do retrato do Control (Curva ABC) e é empurrada para frente por
 * todo pedido FATURADO no app — ver a migração 036. Por isso o selo sempre
 * mostra a data junto ("última compra em 12/03/26"): um retrato velho nunca
 * engana, está escrito de quando é.
 */

export type Frescor = 'ativo' | 'esfriando' | 'parado' | 'sem_registro';

/** Dias sem comprar que separam as faixas. */
const ESFRIANDO_APOS_DIAS = 90;
const PARADO_APOS_DIAS = 180;

export interface SituacaoDaCompra {
  nivel: Frescor;
  /** Pronto para a tela: "Parado há 8 meses", "Comprou há 12 dias"… */
  rotulo: string;
  /** Dias desde a última compra. `null` sem registro. */
  dias: number | null;
}

function rotuloDeTempo(dias: number): string {
  if (dias < 1) return 'hoje';
  if (dias === 1) return 'ontem';
  if (dias < 60) return `há ${dias} dias`;
  const meses = Math.floor(dias / 30);
  if (meses < 24) return `há ${meses} meses`;
  return `há ${Math.floor(meses / 12)} anos`;
}

export function situacaoDaCompra(lastPurchaseAt: string | null | undefined): SituacaoDaCompra {
  if (!lastPurchaseAt) {
    return { nivel: 'sem_registro', rotulo: 'Sem compra registrada', dias: null };
  }
  const dias = Math.floor((Date.now() - new Date(lastPurchaseAt).getTime()) / 86_400_000);
  if (Number.isNaN(dias)) {
    return { nivel: 'sem_registro', rotulo: 'Sem compra registrada', dias: null };
  }
  if (dias >= PARADO_APOS_DIAS) return { nivel: 'parado', rotulo: `Parado ${rotuloDeTempo(dias)}`, dias };
  if (dias >= ESFRIANDO_APOS_DIAS) return { nivel: 'esfriando', rotulo: `Esfriando — ${rotuloDeTempo(dias)}`, dias };
  return { nivel: 'ativo', rotulo: `Comprou ${rotuloDeTempo(dias)}`, dias };
}

/** Cor do selo, no vocabulário do Badge. */
export const VARIANTE_DO_FRESCOR: Record<Frescor, 'gray' | 'yellow' | 'green' | 'red' | 'brand'> = {
  ativo: 'green',
  esfriando: 'yellow',
  parado: 'red',
  sem_registro: 'gray',
};
