import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A pergunta "esta coluna já existe?" — feita por 22 serviços, porque as
 * migrações rodam à mão e o código sobe antes do SQL.
 *
 * O que este teste tranca é o dia da migração: o Yan roda o SQL às 14h com a
 * API de pé desde as 9h. Com o cache antigo (memorizar para sempre), a API
 * continuava dizendo "não existe" até alguém reiniciar o Railway — e todo
 * cadastro feito no meio gravava sem as colunas novas, em silêncio.
 */

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/lib/detectarColuna.js');
  mod.esquecerDeteccoes();
  return { ...mod, fake };
}

const ok = { data: [{ id: 'x' }], error: null };
const semColuna = { data: null, error: { code: '42703', message: 'column customers.cep does not exist' } };
const soluco = { data: null, error: { code: '503', message: 'service unavailable' } };

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
});

describe('detectar coluna', () => {
  it('coluna que existe é memorizada — não pergunta duas vezes', async () => {
    const { detectar, fake } = await carregar({ customers: [ok] });
    expect(await detectar('customers', 'cep')).toBe(true);
    expect(await detectar('customers', 'cep')).toBe(true);
    expect(fake.filtrosDe('customers', 'select')).toHaveLength(1);
  });

  it('"ainda não existe" vale por pouco tempo — a migração pode rodar a qualquer momento', async () => {
    vi.useFakeTimers();
    // A fila do fake: primeiro "não existe", depois o SQL aplicado.
    const { detectar, fake } = await carregar({ customers: [semColuna, ok] });
    expect(await detectar('customers', 'cep')).toBe(false);
    // Logo em seguida, não incomoda o banco de novo.
    expect(await detectar('customers', 'cep')).toBe(false);
    expect(fake.filtrosDe('customers', 'select')).toHaveLength(1);

    // Passado o intervalo, pergunta outra vez — e agora o SQL já rodou. Isto é
    // o dia da migração: ninguém reiniciou a API e ela se corrige sozinha.
    vi.advanceTimersByTime(31_000);
    expect(await detectar('customers', 'cep')).toBe(true);
    expect(fake.filtrosDe('customers', 'select')).toHaveLength(2);

    // E o "sim" fica para sempre.
    vi.advanceTimersByTime(10 * 60_000);
    expect(await detectar('customers', 'cep')).toBe(true);
    expect(fake.filtrosDe('customers', 'select')).toHaveLength(2);
  });

  it('soluço do Supabase não desliga o recurso — não vira "não existe" permanente', async () => {
    const { detectar, fake } = await carregar({ customers: [soluco, ok] });
    expect(await detectar('customers', 'cep')).toBe(false); // degrada nesta chamada
    expect(await detectar('customers', 'cep')).toBe(true); // e já se corrige na seguinte
    expect(fake.filtrosDe('customers', 'select')).toHaveLength(2);
  });

  it('tabela inteira que não existe também conta como ausente', async () => {
    const semTabela = { data: null, error: { code: '42P01', message: 'relation "rep_tasks" does not exist' } };
    const { detectar } = await carregar({ rep_tasks: [semTabela] });
    expect(await detectar('rep_tasks', 'id')).toBe(false);
  });

  it('cada coluna tem memória própria — uma ausente não desliga a outra', async () => {
    const { detectar } = await carregar({ customers: [ok, semColuna] });
    expect(await detectar('customers', 'cep')).toBe(true);
    expect(await detectar('customers', 'inactivity_reason')).toBe(false);
    expect(await detectar('customers', 'cep')).toBe(true);
  });
});
