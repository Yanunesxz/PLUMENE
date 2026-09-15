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

/**
 * A variante que NÃO degrada. Existe para a coluna que é FILTRO da fila do
 * parceiro (`orders.invoiced`): ler um soluço de rede como "não existe" tiraria
 * o filtro de faturado em silêncio, e o ERP importaria de novo o que a
 * Larissa já faturou à mão.
 */
describe('detectarOuFalhar', () => {
  it('responde igual ao detectar quando o banco fala do schema: sim e não', async () => {
    const { detectarOuFalhar } = await carregar({ orders: [ok, semColuna] });
    expect(await detectarOuFalhar('orders', 'invoiced')).toBe(true);
    expect(await detectarOuFalhar('orders', 'discount_percent')).toBe(false);
  });

  it('soluço do Supabase LANÇA em vez de responder "não" — e não memoriza nada', async () => {
    const { detectarOuFalhar, fake } = await carregar({ orders: [soluco, ok] });
    await expect(detectarOuFalhar('orders', 'invoiced')).rejects.toThrow(/orders\.invoiced/);
    // Na chamada seguinte pergunta de novo, e o banco já respondeu.
    expect(await detectarOuFalhar('orders', 'invoiced')).toBe(true);
    expect(fake.filtrosDe('orders', 'select')).toHaveLength(2);
  });

  it('divide a memória com o detectar: o "sim" lembrado por um vale para o outro', async () => {
    const { detectar, detectarOuFalhar, fake } = await carregar({ orders: [ok] });
    expect(await detectar('orders', 'invoiced')).toBe(true);
    expect(await detectarOuFalhar('orders', 'invoiced')).toBe(true);
    expect(fake.filtrosDe('orders', 'select')).toHaveLength(1);
  });
});

/**
 * A dúvida não pode virar "não" para quem precisa parar diante dela: a foto do
 * "Atualizar no ERP" antes de uma edição. Com um soluço de rede tratado como
 * "tabela ausente", a edição gravava sem a foto e a mudança sumia do aviso
 * (revisão de 15/09/2026).
 */
describe('detectarComCerteza', () => {
  it('distingue existe, não existe e não sei', async () => {
    const existe = await carregar({ customers: [ok] });
    expect(await existe.detectarComCerteza('customers', 'cep')).toBe('existe');

    vi.resetModules();
    const ausente = await carregar({ customers: [semColuna] });
    expect(await ausente.detectarComCerteza('customers', 'cep')).toBe('nao_existe');

    vi.resetModules();
    const duvida = await carregar({ customers: [soluco] });
    expect(await duvida.detectarComCerteza('customers', 'cep')).toBe('nao_sei');
  });

  it('a dúvida não é memorizada: na próxima pergunta, responde de verdade', async () => {
    const { detectarComCerteza, fake } = await carregar({ customers: [soluco, ok] });
    expect(await detectarComCerteza('customers', 'cep')).toBe('nao_sei');
    expect(await detectarComCerteza('customers', 'cep')).toBe('existe');
    expect(fake.filtrosDe('customers', 'select')).toHaveLength(2);
  });

  it('o detectar de sempre continua dizendo "não" na dúvida — os 22 serviços degradam como antes', async () => {
    const { detectar } = await carregar({ customers: [soluco] });
    expect(await detectar('customers', 'cep')).toBe(false);
  });
});
