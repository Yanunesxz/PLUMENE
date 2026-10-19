import type { Order } from '../types/order.js';
import {
  pedidoContaParaAMeta,
  faixaAlcancada,
  posicaoNaRegua,
  proximaFaixa,
  type FaixaDeBonus,
} from '../constants/bonus.js';
import { valorDaVenda } from '../constants/statusDoCliente.js';

/**
 * O DESEMPENHO DE UM REPRESENTANTE NUM MÊS — a linha do Dashboard do gerente
 * comercial (Yan, 19/10/2026: "visualizar em massa como está as metas dos
 * representantes, para ver desempenho").
 *
 * O "enviado" é a MESMA conta da Minha Área do representante: os pedidos do
 * mês (pela data em que foram feitos) que `pedidoContaParaAMeta` aceita —
 * desde 19/10/2026, só o APROVADO pela Larissa e sem o carimbo "Pedido
 * inativo" (055). Se a regra mudar, ela muda lá e as duas telas andam juntas:
 * o gerente nunca vê um número e o rep outro.
 */

export interface DesempenhoDoMes {
  /** Soma dos pedidos que contam para a meta, no mês. */
  enviado: number;
  /** Quantos pedidos contaram. */
  pedidos: number;
  /** Lojas diferentes atendidas nesses pedidos (vitrine sem cadastro fica fora). */
  clientes: number;
  ticketMedio: number;
  /** O que a fábrica faturou no mês (pela data da nota). */
  faturado: number;
  /** A faixa já garantida — `null` antes da primeira ou sem meta. */
  faixa: FaixaDeBonus | null;
  /** Em que faixa ele está: 1 = a primeira. 0 = nenhuma ainda. */
  numeroDaFaixa: number;
  proxima: FaixaDeBonus | null;
  /** Quanto falta para a próxima faixa (0 no teto ou sem meta). */
  falta: number;
  /** 0 a 1, em passos iguais por faixa — a mesma régua que o rep vê. */
  posicao: number;
  /**
   * Para onde ele vai no ritmo de agora: enviado ÷ dias passados × dias do mês.
   * Só no mês corrente; nos meses fechados é o próprio enviado.
   */
  projecao: number;
  /** A faixa que a projeção alcança — o "vai bater?" do gerente. */
  faixaProjetada: FaixaDeBonus | null;
}

/** "2026-10-01" → ano e mês (1–12). */
function anoMes(competencia: string): { ano: number; mes: number } {
  const [a, m] = competencia.split('-');
  return { ano: Number(a), mes: Number(m) };
}

/** A data cai no mês da competência? Pelo relógio do aparelho, como a Minha Área. */
export function noMes(iso: string | null | undefined, competencia: string): boolean {
  if (!iso) return false;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return false;
  const { ano, mes } = anoMes(competencia);
  return d.getFullYear() === ano && d.getMonth() + 1 === mes;
}

/** A competência anterior: "2026-01-01" → "2025-12-01". */
export function competenciaAnterior(competencia: string): string {
  const { ano, mes } = anoMes(competencia);
  const a = mes === 1 ? ano - 1 : ano;
  const m = mes === 1 ? 12 : mes - 1;
  return `${a}-${String(m).padStart(2, '0')}-01`;
}

/** Só o "enviado" — para comparar com o mês anterior sem calcular o resto. */
export function enviadoNoMes(pedidos: readonly Order[], competencia: string): number {
  return pedidos
    .filter((o) => noMes(o.created_at, competencia) && pedidoContaParaAMeta(o))
    .reduce((s, o) => s + (o.total ?? 0), 0);
}

export function desempenhoDoMes(
  pedidos: readonly Order[],
  faixas: readonly FaixaDeBonus[],
  competencia: string,
  hoje: Date = new Date(),
): DesempenhoDoMes {
  const contam = pedidos.filter((o) => noMes(o.created_at, competencia) && pedidoContaParaAMeta(o));
  const enviado = contam.reduce((s, o) => s + (o.total ?? 0), 0);
  const clientes = new Set(contam.map((o) => o.customer_id).filter((c): c is string => !!c)).size;
  const faturado = pedidos
    .filter((o) => o.invoiced && noMes(o.invoiced_at ?? o.created_at, competencia))
    .reduce((s, o) => s + valorDaVenda(o), 0);

  const faixa = faixaAlcancada(enviado, faixas);
  const proxima = proximaFaixa(enviado, faixas);

  const { ano, mes } = anoMes(competencia);
  const diasNoMes = new Date(ano, mes, 0).getDate();
  const mesCorrente = hoje.getFullYear() === ano && hoje.getMonth() + 1 === mes;
  const projecao = mesCorrente ? (enviado / Math.max(1, hoje.getDate())) * diasNoMes : enviado;

  return {
    enviado,
    pedidos: contam.length,
    clientes,
    ticketMedio: contam.length ? enviado / contam.length : 0,
    faturado,
    faixa,
    numeroDaFaixa: faixa ? faixas.indexOf(faixa) + 1 : 0,
    proxima,
    falta: proxima ? proxima.meta - enviado : 0,
    posicao: posicaoNaRegua(enviado, faixas),
    projecao,
    faixaProjetada: faixaAlcancada(projecao, faixas),
  };
}
