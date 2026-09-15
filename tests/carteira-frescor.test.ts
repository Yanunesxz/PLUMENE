import { describe, it, expect, afterEach } from 'vitest';
import {
  situacaoDaCompra,
  situacaoDoCliente,
  definirReguaDaCarteira,
  reguaDaCarteira,
  NOME_DO_NIVEL,
  faixaEmPalavras,
} from '../apps/web/src/lib/carteira.js';
import { REGUA_PADRAO } from '@csb/shared';

/**
 * A régua da carteira: por padrão ativo até 90 dias, atenção de 90 a 180,
 * esfriado de 180 em diante. É ela que decide quem aparece no aviso "clientes
 * sem comprar" da Minha Área e nos filtros da lista de Clientes.
 *
 * Desde 11/09/2026 os DIAS são da fábrica (migração 043) — o admin muda no
 * Painel — e o vermelho se chama ESFRIADO, não mais "inativo".
 */

const diasAtras = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString().slice(0, 10);

afterEach(() => {
  definirReguaDaCarteira(REGUA_PADRAO);
});

describe('situação da compra', () => {
  it('comprou há pouco = ativo', () => {
    expect(situacaoDaCompra(diasAtras(10)).nivel).toBe('ativo');
    expect(situacaoDaCompra(diasAtras(89)).nivel).toBe('ativo');
  });

  it('3 a 6 meses = esfriando (o amarelo de atenção)', () => {
    expect(situacaoDaCompra(diasAtras(90)).nivel).toBe('esfriando');
    expect(situacaoDaCompra(diasAtras(179)).nivel).toBe('esfriando');
  });

  it('6+ meses = parado (o vermelho, que a tela chama de Esfriado)', () => {
    expect(situacaoDaCompra(diasAtras(180)).nivel).toBe('parado');
    expect(situacaoDaCompra(diasAtras(900)).nivel).toBe('parado');
    expect(NOME_DO_NIVEL.parado).toBe('Esfriado');
  });

  it('sem data (ou data inválida) = sem registro, nunca um palpite', () => {
    expect(situacaoDaCompra(null).nivel).toBe('sem_registro');
    expect(situacaoDaCompra(undefined).nivel).toBe('sem_registro');
    expect(situacaoDaCompra('não é data').nivel).toBe('sem_registro');
  });

  it('o rótulo fala tempo humano e a cor do Yan: vermelho = Esfriado', () => {
    expect(situacaoDaCompra(diasAtras(0)).rotulo).toBe('Comprou hoje');
    expect(situacaoDaCompra(diasAtras(240)).rotulo).toMatch(/^Esfriado — sem comprar há \d+ meses$/);
    expect(situacaoDaCompra(diasAtras(120)).rotulo).toMatch(/^Atenção — sem comprar há \d+ meses$/);
  });
});

describe('a régua que o admin muda (043)', () => {
  it('a fábrica de giro rápido aperta os prazos e o mesmo cliente muda de cor', () => {
    expect(situacaoDaCompra(diasAtras(45)).nivel).toBe('ativo');

    definirReguaDaCarteira({ atencao: 30, esfriado: 60 });
    expect(reguaDaCarteira()).toEqual({ atencao: 30, esfriado: 60 });
    expect(situacaoDaCompra(diasAtras(45)).nivel).toBe('esfriando');
    expect(situacaoDaCompra(diasAtras(70)).nivel).toBe('parado');
  });

  it('régua de cabeça para baixo é recusada — a faixa de atenção não pode sumir', () => {
    definirReguaDaCarteira({ atencao: 200, esfriado: 100 });
    expect(reguaDaCarteira()).toEqual(REGUA_PADRAO);
  });

  it('conta a faixa em português, com os dias que estão valendo', () => {
    definirReguaDaCarteira({ atencao: 45, esfriado: 120 });
    expect(faixaEmPalavras('esfriando')).toBe('45 a 120 dias sem comprar');
    expect(faixaEmPalavras('parado')).toBe('120 dias ou mais sem comprar');
  });
});

describe('cliente de varejo (migração 047)', () => {
  it('marcado pela venda interna sai da régua: nem atenção, nem esfriado', () => {
    // 900 dias sem comprar seria o vermelho mais escuro da carteira.
    const s = situacaoDoCliente({ last_purchase_at: diasAtras(900), varejo: true });
    expect(s.nivel).toBe('varejo');
    expect(s.rotulo).toContain('sem cobrança de contato');
    expect(NOME_DO_NIVEL[s.nivel]).toBe('Varejo');
  });

  it('sem a marca, o mesmo cliente segue a régua de sempre', () => {
    expect(situacaoDoCliente({ last_purchase_at: diasAtras(900) }).nivel).toBe('parado');
    expect(situacaoDoCliente({ last_purchase_at: diasAtras(900), varejo: false }).nivel).toBe('parado');
    expect(situacaoDoCliente({ last_purchase_at: diasAtras(10), varejo: null }).nivel).toBe('ativo');
  });
});
