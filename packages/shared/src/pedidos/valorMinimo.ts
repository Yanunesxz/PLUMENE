/**
 * Pedido mínimo da condição de pagamento (migração 049,
 * `payment_conditions.valor_minimo`).
 *
 * Decisão do Yan (16/09/2026): o mínimo AVISA, não bloqueia. Nem a tela nem o
 * servidor seguram o pedido por causa dele — quem decide se aceita um pedido
 * abaixo do mínimo é o escritório, na conferência. O que a tela faz é não
 * deixar o representante enviar sem saber.
 */

export interface AvisoDeValorMinimo {
  /** O mínimo que a condição pede, em reais. */
  minimo: number;
  /** O total do pedido que ficou abaixo dele, em reais. */
  total: number;
  /** A frase pronta para a tela. */
  mensagem: string;
}

/**
 * Real com centavos, montado à mão: "R$ 1.234,56".
 *
 * Sem `Intl` de propósito — o texto do aviso sai igual no Node dos testes e em
 * qualquer navegador, sem depender do pacote de idiomas instalado.
 */
export function reaisDoAviso(valor: number): string {
  const centavos = Math.round(Math.abs(valor) * 100);
  const inteiro = Math.floor(centavos / 100)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const resto = String(centavos % 100).padStart(2, '0');
  return `${valor < 0 && centavos > 0 ? '-' : ''}R$ ${inteiro},${resto}`;
}

/**
 * O mínimo que vale conferir: número positivo, ou `null` (sem mínimo).
 *
 * Nulo, vazio, zero, negativo ou ilegível = sem mínimo. Aceita texto porque o
 * NUMERIC do Postgres pode chegar assim por algum caminho (cache antigo, outro
 * cliente HTTP).
 */
export function minimoDaCondicao(valor: number | string | null | undefined): number | null {
  if (valor == null || valor === '') return null;
  const minimo = Number(valor);
  return Number.isFinite(minimo) && minimo > 0 ? minimo : null;
}

/**
 * O aviso de pedido mínimo, ou `null` quando não há o que avisar.
 *
 * Não avisa quando: não há condição escolhida; a condição não tem mínimo
 * (ver `minimoDaCondicao`); o total alcança o mínimo. A comparação é em
 * centavos — R$ 499,999999 da soma em ponto flutuante é R$ 500,00 na tela, e
 * avisar "o total está em R$ 500,00" contra um mínimo de R$ 500,00 seria mentira.
 */
export function avisoDeValorMinimo(
  condicao: { valor_minimo?: number | string | null | undefined } | null | undefined,
  total: number,
): AvisoDeValorMinimo | null {
  const minimo = minimoDaCondicao(condicao?.valor_minimo);
  if (minimo == null) return null;
  if (!Number.isFinite(total)) return null;
  if (Math.round(total * 100) >= Math.round(minimo * 100)) return null;

  return {
    minimo,
    total,
    mensagem: `Esta condição pede pedido mínimo de ${reaisDoAviso(minimo)}; o total está em ${reaisDoAviso(total)}`,
  };
}
