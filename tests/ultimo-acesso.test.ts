import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';
import { descreverUltimoAcesso } from '../apps/web/src/lib/ultimoAcesso.js';

const AGORA = new Date('2026-08-06T15:00:00.000Z');

beforeAll(() => {
  vi.useFakeTimers();
  vi.setSystemTime(AGORA);
});
afterAll(() => {
  vi.useRealTimers();
});

const horasAtras = (h: number) => new Date(AGORA.getTime() - h * 3600_000).toISOString();

describe('descreverUltimoAcesso', () => {
  it('quem nunca entrou é dito com todas as letras', () => {
    expect(descreverUltimoAcesso(null)).toBe('nunca entrou');
  });

  it('há poucos minutos vira "agora há pouco"', () => {
    expect(descreverUltimoAcesso(new Date(AGORA.getTime() - 5 * 60_000).toISOString())).toBe(
      'agora há pouco',
    );
  });

  it('conta horas no mesmo dia', () => {
    expect(descreverUltimoAcesso(horasAtras(3))).toBe('há 3 horas');
    expect(descreverUltimoAcesso(horasAtras(1))).toBe('há 1 hora');
  });

  it('conta dias', () => {
    expect(descreverUltimoAcesso(horasAtras(24))).toBe('ontem');
    expect(descreverUltimoAcesso(horasAtras(24 * 3))).toBe('há 3 dias');
  });

  it('acima de um mês vira data, que é mais útil que "há 47 dias"', () => {
    expect(descreverUltimoAcesso('2026-05-02T10:00:00.000Z')).toBe('em 02/05/2026');
  });
});
