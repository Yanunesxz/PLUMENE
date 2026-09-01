/**
 * O fechamento do mês passado — e a janela em que ele fica à vista.
 *
 * O representante precisa conferir quanto a fábrica faturou no mês que
 * terminou (a nota sai depois do pedido, então o número do mês só fica
 * completo na virada). Mas isso é conferência de fechamento, não placar: a
 * partir do dia 11 o mês corrente é o que importa, e o número velho ao lado do
 * novo só confunde quem bate meta. Por isso a janela some sozinha — decisão do
 * Yan (01/09/2026): "só pode ficar até o décimo dia do mês".
 */

/** Último dia do mês em que o fechamento anterior ainda aparece. */
export const DIA_LIMITE_DO_FECHAMENTO = 10;

export interface JanelaDoFechamento {
  /** O card aparece? (dia 1 ao 10, inclusive) */
  visivel: boolean;
  /** Nome do mês que fechou: "agosto". */
  mes: string;
  /** Primeiro instante do mês passado. */
  inicio: Date;
  /** Primeiro instante do mês corrente — o fim, exclusivo. */
  fim: Date;
  /** A data (ISO) caiu no mês passado? */
  contem: (iso: string | null | undefined) => boolean;
}

export function janelaDoFechamento(hoje: Date = new Date()): JanelaDoFechamento {
  // `new Date(2026, -1, 1)` devolve dezembro de 2025 — a virada de ano se
  // resolve sozinha, sem conta de mês.
  const inicio = new Date(hoje.getFullYear(), hoje.getMonth() - 1, 1);
  const fim = new Date(hoje.getFullYear(), hoje.getMonth(), 1);
  return {
    visivel: hoje.getDate() <= DIA_LIMITE_DO_FECHAMENTO,
    mes: inicio.toLocaleDateString('pt-BR', { month: 'long' }),
    inicio,
    fim,
    contem: (iso) => {
      if (!iso) return false;
      const d = new Date(iso);
      if (Number.isNaN(d.getTime())) return false;
      return d >= inicio && d < fim;
    },
  };
}
