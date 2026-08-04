import { ORDER_STATUS, type OrderStatus } from './orderStatus.js';

/**
 * Bonificação mensal do representante — o aviso que a fábrica manda por escrito.
 *
 *   "TODOS OS PEDIDOS ENVIADOS ENTRE AS DATAS 01 A 31 DE CADA MÊS SERÃO SOMADOS
 *    E, ATINGINDO A META, SERÁ BONIFICADO DA SEGUINTE FORMA."
 *
 * É um degrau só, não uma soma: quem envia R$ 160.000 leva R$ 3.000, não
 * 500 + 1.000 + 1.500 + 3.000. Vale sempre a faixa mais alta alcançada.
 *
 * Isto vive no pacote compartilhado porque é regra de negócio, não enfeite de
 * tela: no dia em que o servidor precisar fechar a bonificação, a tabela tem
 * de ser a mesma que o representante viu no celular o mês inteiro.
 */
export interface FaixaDeBonus {
  /** Valor em pedidos enviados a partir do qual a faixa vale. */
  meta: number;
  /** Bônus pago ao atingir a faixa. */
  bonus: number;
}

export const FAIXAS_DE_BONUS: readonly FaixaDeBonus[] = [
  { meta: 50_000, bonus: 500 },
  { meta: 80_000, bonus: 1_000 },
  { meta: 100_000, bonus: 1_500 },
  { meta: 150_000, bonus: 3_000 },
];

/**
 * O que conta como "pedido enviado".
 *
 * O que saiu da mão do representante: já foi para a fila do gerente, foi
 * aprovado ou já está no ERP. Fica de fora o rascunho, o pedido que a loja
 * mandou e ele ainda não olhou (`pending_rep`) — esse não é dele ainda — e o
 * recusado, que o aviso manda estornar de qualquer jeito.
 */
export const STATUS_QUE_CONTAM_PARA_A_META: readonly OrderStatus[] = [
  ORDER_STATUS.PENDING_APPROVAL,
  ORDER_STATUS.APPROVED,
  ORDER_STATUS.SENT_ERP,
  ORDER_STATUS.ERROR_ERP,
];

export function contaParaAMeta(status: OrderStatus): boolean {
  return STATUS_QUE_CONTAM_PARA_A_META.includes(status);
}

/** A faixa já garantida com o total enviado — ou `null` antes da primeira. */
export function faixaAlcancada(enviado: number): FaixaDeBonus | null {
  let alcancada: FaixaDeBonus | null = null;
  for (const faixa of FAIXAS_DE_BONUS) {
    if (enviado >= faixa.meta) alcancada = faixa;
  }
  return alcancada;
}

/** A próxima faixa a perseguir — `null` quando já está no teto. */
export function proximaFaixa(enviado: number): FaixaDeBonus | null {
  return FAIXAS_DE_BONUS.find((f) => enviado < f.meta) ?? null;
}

/**
 * Posição na régua, de 0 a 1.
 *
 * Cada faixa ocupa um pedaço IGUAL da régua, e não o seu tamanho em reais. Numa
 * escala linear os degraus de 80 e 100 mil ficariam colados e o trecho de 100 a
 * 150 mil ocuparia um terço da barra sozinho — o representante leria "estou
 * quase lá" onde faltam R$ 40.000. Com passos iguais, cada degrau parece o que
 * é: o próximo.
 */
export function posicaoNaRegua(enviado: number): number {
  const passo = 1 / FAIXAS_DE_BONUS.length;
  let piso = 0;
  for (let i = 0; i < FAIXAS_DE_BONUS.length; i++) {
    const teto = FAIXAS_DE_BONUS[i]!.meta;
    if (enviado < teto) {
      return (i + (enviado - piso) / (teto - piso)) * passo;
    }
    piso = teto;
  }
  return 1;
}
