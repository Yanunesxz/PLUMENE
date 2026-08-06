/**
 * O maior número que o campo aceita.
 *
 * Não é regra de negócio: o representante não enxerga estoque, então inventar um
 * teto de peças aqui travaria um pedido que a fábrica talvez aceitasse. É guarda
 * contra acidente — cinco dígitos já é mais do que qualquer pedido real, e seis
 * é dedo preso na tecla. Sem isto, um `1111111` entra no carrinho e quebra o
 * total do pedido inteiro.
 */
const MAXIMO = 99999;

/**
 * O que o campo de quantidade de um tamanho aceita.
 *
 * Ponto único onde isso é decidido, e o motivo de ser uma função à parte: a
 * falha aqui é silenciosa. Um `NaN` escapando vira "NaN peças" no pedido e um
 * total quebrado, e ninguém percebe até a conferência.
 *
 * Só dígito conta. Sinal de menos, vírgula, ponto e letra são descartados em vez
 * de recusarem o resto — quem cola "12un" de outra tela quis dizer 12, e o
 * teclado do celular deixa passar caractere que ninguém pediu.
 */
export function quantidadeDigitada(texto: string): number {
  const digitos = texto.replace(/\D/g, '');
  if (digitos === '') return 0;

  const n = Number(digitos.slice(0, 6));
  if (!Number.isFinite(n)) return 0;

  return Math.min(MAXIMO, Math.trunc(n));
}
