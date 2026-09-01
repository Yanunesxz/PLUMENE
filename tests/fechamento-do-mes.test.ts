import { describe, it, expect } from 'vitest';
import { janelaDoFechamento, DIA_LIMITE_DO_FECHAMENTO } from '../apps/web/src/lib/fechamento.js';

/**
 * A janela do fechamento: o valor faturado no mês PASSADO fica à vista para o
 * representante só até o dia 10. Depois some — o mês corrente é o que importa.
 */

// Meio-dia local: evita que o fuso empurre a data para o dia vizinho.
const dia = (ano: number, mes1a12: number, d: number) => new Date(ano, mes1a12 - 1, d, 12);

describe('janela do fechamento', () => {
  it('aparece do dia 1 ao 10 e some no 11', () => {
    expect(janelaDoFechamento(dia(2026, 9, 1)).visivel).toBe(true);
    expect(janelaDoFechamento(dia(2026, 9, DIA_LIMITE_DO_FECHAMENTO)).visivel).toBe(true);
    expect(janelaDoFechamento(dia(2026, 9, 11)).visivel).toBe(false);
    expect(janelaDoFechamento(dia(2026, 9, 30)).visivel).toBe(false);
  });

  it('em setembro, o mês que fechou é agosto', () => {
    const j = janelaDoFechamento(dia(2026, 9, 3));
    expect(j.mes).toBe('agosto');
    expect(j.contem('2026-08-15T12:00:00.000Z')).toBe(true);
    // Setembro é o mês corrente: entra no outro card, não neste.
    expect(j.contem('2026-09-01T12:00:00.000Z')).toBe(false);
    // Julho já passou da conferência.
    expect(j.contem('2026-07-31T12:00:00.000Z')).toBe(false);
  });

  it('o mês é o do CALENDÁRIO daqui, não o do UTC', () => {
    // Faturamento à meia-noite UTC do dia 1º ainda é dia 31 do mês anterior no
    // Brasil (UTC-3) — e é assim que tem de contar, senão a virada do mês
    // mudaria de valor conforme o fuso de quem abre a tela. Datas construídas
    // no relógio local para o teste valer em qualquer máquina.
    const j = janelaDoFechamento(dia(2026, 9, 3));
    expect(j.contem(dia(2026, 8, 1).toISOString())).toBe(true); // 1º de agosto, meio-dia daqui
    expect(j.contem(dia(2026, 8, 31).toISOString())).toBe(true); // 31 de agosto, meio-dia daqui
    expect(j.contem(new Date(2026, 8, 1, 0, 1).toISOString())).toBe(false); // 1º de setembro, 00h01
  });

  it('a virada de ano não quebra: em janeiro, o fechamento é dezembro', () => {
    const j = janelaDoFechamento(dia(2027, 1, 5));
    expect(j.mes).toBe('dezembro');
    expect(j.inicio.getFullYear()).toBe(2026);
    expect(j.contem('2026-12-20T12:00:00.000Z')).toBe(true);
    expect(j.contem('2027-01-02T12:00:00.000Z')).toBe(false);
  });

  it('pedido sem data de faturamento nunca entra no fechamento', () => {
    const j = janelaDoFechamento(dia(2026, 9, 3));
    expect(j.contem(null)).toBe(false);
    expect(j.contem(undefined)).toBe(false);
    expect(j.contem('rabisco')).toBe(false);
  });
});
