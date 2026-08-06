import { describe, it, expect } from 'vitest';
import { quantidadeDigitada } from '../apps/web/src/lib/quantidade.js';

/**
 * O que o campo de quantidade aceita.
 *
 * A falha que importa aqui é silenciosa: um `NaN` entrando no carrinho vira
 * "NaN peças" no pedido e um total quebrado, e ninguém vê até a conferência.
 */
describe('quantidadeDigitada', () => {
  it('lê o número escrito', () => {
    expect(quantidadeDigitada('30')).toBe(30);
    expect(quantidadeDigitada('1')).toBe(1);
    expect(quantidadeDigitada('144')).toBe(144);
  });

  it('zero zera o tamanho — é como se tira a linha sem trinta toques no menos', () => {
    expect(quantidadeDigitada('0')).toBe(0);
    expect(quantidadeDigitada('00')).toBe(0);
  });

  it('campo vazio vira zero, nunca NaN', () => {
    expect(quantidadeDigitada('')).toBe(0);
    expect(quantidadeDigitada('   ')).toBe(0);
  });

  it('texto sem dígito vira zero, nunca NaN', () => {
    expect(quantidadeDigitada('abc')).toBe(0);
    expect(quantidadeDigitada('-')).toBe(0);
    expect(quantidadeDigitada('.')).toBe(0);
    expect(Number.isNaN(quantidadeDigitada('abc'))).toBe(false);
  });

  it('descarta o que não é dígito em vez de recusar o resto', () => {
    // O teclado do celular e o colar de outra tela trazem lixo junto.
    // Letra é descartada, não convertida: "3o" é 3, não 30.
    expect(quantidadeDigitada('3o')).toBe(3);
    expect(quantidadeDigitada('1 2')).toBe(12);
    expect(quantidadeDigitada('12un')).toBe(12);
  });

  it('não existe quantidade negativa nem quebrada', () => {
    expect(quantidadeDigitada('-5')).toBe(5);
    expect(quantidadeDigitada('2.7')).toBe(27);
    expect(quantidadeDigitada('2,5')).toBe(25);
  });

  it('número grande passa: o rep não vê estoque, então teto aqui seria inventado', () => {
    expect(quantidadeDigitada('9999')).toBe(9999);
  });

  it('corta o exagero que só pode ser dedo preso na tecla', () => {
    // Seis dígitos não é pedido, é acidente. Fica no maior valor plausível em
    // vez de gravar 1.111.111 peças e quebrar o total do pedido.
    expect(quantidadeDigitada('1111111')).toBe(99999);
  });
});
