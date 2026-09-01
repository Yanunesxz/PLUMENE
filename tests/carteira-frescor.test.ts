import { describe, it, expect } from 'vitest';
import { situacaoDaCompra } from '../apps/web/src/lib/carteira.js';

/**
 * A régua da carteira: ativo até 90 dias, esfriando de 90 a 180, parado de 180
 * em diante. É ela que decide quem aparece no aviso "clientes sem comprar" da
 * Minha Área e nos filtros da lista de Clientes.
 */

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

describe('situação da compra', () => {
  it('comprou há pouco = ativo', () => {
    expect(situacaoDaCompra(diasAtras(10)).nivel).toBe('ativo');
    expect(situacaoDaCompra(diasAtras(89)).nivel).toBe('ativo');
  });

  it('3 a 6 meses = esfriando', () => {
    expect(situacaoDaCompra(diasAtras(90)).nivel).toBe('esfriando');
    expect(situacaoDaCompra(diasAtras(179)).nivel).toBe('esfriando');
  });

  it('6+ meses = parado', () => {
    expect(situacaoDaCompra(diasAtras(180)).nivel).toBe('parado');
    expect(situacaoDaCompra(diasAtras(900)).nivel).toBe('parado');
  });

  it('sem data (ou data inválida) = sem registro, nunca um palpite', () => {
    expect(situacaoDaCompra(null).nivel).toBe('sem_registro');
    expect(situacaoDaCompra(undefined).nivel).toBe('sem_registro');
    expect(situacaoDaCompra('não é data').nivel).toBe('sem_registro');
  });

  it('o rótulo fala tempo humano e a cor do Yan: vermelho = Inativo', () => {
    expect(situacaoDaCompra(diasAtras(0)).rotulo).toBe('Comprou hoje');
    expect(situacaoDaCompra(diasAtras(240)).rotulo).toMatch(/^Inativo — parado há \d+ meses$/);
    expect(situacaoDaCompra(diasAtras(120)).rotulo).toMatch(/^Atenção — sem comprar há \d+ meses$/);
  });
});
