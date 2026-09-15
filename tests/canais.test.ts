import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O canal oficial de cada fluxo, por empresa (migração 048, B).
 *
 * O que este teste tranca é o lado seguro: sem a 048 vale o comportamento de
 * hoje (API, sync.py e Firebird fechados); um soluço do banco NUNCA vira canal
 * aberto nem fechado em silêncio — lança, e quem chamou tenta de novo.
 */

const EMPRESA = '00000000-0000-0000-0000-00000000000a';
const OUTRA = '00000000-0000-0000-0000-00000000000b';

/** Resposta de enchimento: o dublê pré-busca a próxima resposta a cada consulta. */
const ENCHIMENTO = { data: [], error: null };
const SONDA_OK = { data: [{ canal_pedido_erp: 'manual' }], error: null };
const SEM_COLUNA = { data: null, error: { code: '42703', message: 'column companies.canal_pedido_erp does not exist' } };
const SOLUCO = { data: null, error: { code: '503', message: 'service unavailable' } };

const linha = (over: Record<string, unknown> = {}) => ({
  data: {
    canal_pedido_erp: 'api',
    canal_faturamento: 'manual',
    canal_cadastro: 'api',
    canal_retrato: 'carga',
    canal_catalogo: 'firebird',
    ...over,
  },
  error: null,
});

async function carregar(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/lib/canais.js');
  const deteccao = await import('../apps/api/src/lib/detectarColuna.js');
  mod.esquecerCanais();
  deteccao.esquecerDeteccoes();
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.useRealTimers();
  vi.doUnmock('../apps/api/src/config/supabase.js');
  vi.restoreAllMocks();
});

describe('lerCanais', () => {
  it('sem a 048: os padrões de hoje, com migracao=false, sem ler a empresa', async () => {
    const { lerCanais, fake } = await carregar({ companies: [SEM_COLUNA] });
    const canais = await lerCanais(EMPRESA);
    expect(canais).toEqual({
      pedido_erp: 'manual',
      faturamento: 'manual',
      cadastro: 'carga',
      retrato: 'carga',
      catalogo: 'carga',
      migracao: false,
    });
    // Só a sonda do schema; nenhum filtro por empresa.
    expect(fake.filtrosDe('companies', 'select')).toHaveLength(1);
    expect(fake.filtrosDe('companies', 'eq')).toHaveLength(0);
  });

  it('com a 048: lê os cinco canais da linha da empresa', async () => {
    const { lerCanais, fake } = await carregar({ companies: [SONDA_OK, ENCHIMENTO, linha()] });
    const canais = await lerCanais(EMPRESA);
    expect(canais).toEqual({
      pedido_erp: 'api',
      faturamento: 'manual',
      cadastro: 'api',
      retrato: 'carga',
      catalogo: 'firebird',
      migracao: true,
    });
    expect(fake.filtrosDe('companies', 'eq')).toEqual([{ tabela: 'companies', metodo: 'eq', args: ['id', EMPRESA] }]);
    const colunas = String(fake.filtrosDe('companies', 'select')[1]?.args[0]);
    for (const c of ['canal_pedido_erp', 'canal_faturamento', 'canal_cadastro', 'canal_retrato', 'canal_catalogo']) {
      expect(colunas).toContain(c);
    }
    expect(fake.gravacoes).toHaveLength(0);
  });

  it('guarda por 30 s por empresa; esquecerCanais e o prazo fazem ler de novo', async () => {
    vi.useFakeTimers();
    const { lerCanais, esquecerCanais, fake } = await carregar({
      companies: [SONDA_OK, ENCHIMENTO, linha()],
    });
    await lerCanais(EMPRESA);
    await lerCanais(EMPRESA);
    const leituras = () => fake.filtrosDe('companies', 'eq').length;
    expect(leituras()).toBe(1);

    // Outra empresa não usa a memória da primeira.
    await lerCanais(OUTRA);
    expect(leituras()).toBe(2);

    vi.advanceTimersByTime(31_000);
    await lerCanais(EMPRESA);
    expect(leituras()).toBe(3);

    esquecerCanais();
    await lerCanais(EMPRESA);
    expect(leituras()).toBe(4);
  });

  it('quem mexe na resposta não mexe na memória', async () => {
    const { lerCanais } = await carregar({ companies: [SONDA_OK, ENCHIMENTO, linha()] });
    const a = await lerCanais(EMPRESA);
    a.pedido_erp = 'manual';
    expect((await lerCanais(EMPRESA)).pedido_erp).toBe('api');
  });

  it('erro ao ler a empresa LANÇA e não fica guardado', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { lerCanais, fake } = await carregar({
      companies: [SONDA_OK, ENCHIMENTO, { data: null, error: { message: 'timeout' } }, ENCHIMENTO, linha()],
    });
    await expect(lerCanais(EMPRESA)).rejects.toThrow(/canais da empresa/);
    // Na próxima, pergunta de novo (e agora o banco respondeu).
    expect((await lerCanais(EMPRESA)).pedido_erp).toBe('api');
    expect(fake.filtrosDe('companies', 'eq')).toHaveLength(2);
  });

  it('banco que não respondeu sobre o schema LANÇA — soluço não abre nem fecha canal', async () => {
    const { lerCanais } = await carregar({ companies: [SOLUCO] });
    await expect(lerCanais(EMPRESA)).rejects.toThrow(/não respondeu/);
  });

  it('empresa sem linha: os padrões, com migracao=true', async () => {
    const { lerCanais } = await carregar({ companies: [SONDA_OK, ENCHIMENTO, { data: null, error: null }] });
    expect(await lerCanais(EMPRESA)).toEqual({
      pedido_erp: 'manual',
      faturamento: 'manual',
      cadastro: 'carga',
      retrato: 'carga',
      catalogo: 'carga',
      migracao: true,
    });
  });

  it('valor fora da lista (SQL à mão sem a trava) vale o padrão daquele canal', async () => {
    const erro = vi.spyOn(console, 'error').mockImplementation(() => {});
    const { lerCanais } = await carregar({
      companies: [SONDA_OK, ENCHIMENTO, linha({ canal_faturamento: 'API', canal_cadastro: null })],
    });
    const canais = await lerCanais(EMPRESA);
    expect(canais.faturamento).toBe('manual');
    expect(canais.cadastro).toBe('carga');
    expect(canais.pedido_erp).toBe('api');
    expect(erro).toHaveBeenCalledTimes(1);
  });
});

describe('exigirCanal e corpoCanalFechado', () => {
  it('canal certo devolve null; errado devolve o canal e o valor que vale', async () => {
    const { exigirCanal } = await carregar({ companies: [SONDA_OK, ENCHIMENTO, linha()] });
    expect(await exigirCanal(EMPRESA, 'pedido_erp', 'api')).toBeNull();
    expect(await exigirCanal(EMPRESA, 'faturamento', 'api')).toEqual({ canal: 'faturamento', valor_atual: 'manual' });
    expect(await exigirCanal(EMPRESA, 'catalogo', 'firebird')).toBeNull();
    expect(await exigirCanal(EMPRESA, 'cadastro', 'firebird')).toEqual({ canal: 'cadastro', valor_atual: 'api' });
  });

  it('sem a 048 nenhum canal da API está ligado', async () => {
    const { exigirCanal } = await carregar({ companies: [SEM_COLUNA] });
    expect(await exigirCanal(EMPRESA, 'pedido_erp', 'api')).toEqual({ canal: 'pedido_erp', valor_atual: 'manual' });
    expect(await exigirCanal(EMPRESA, 'faturamento', 'api')).toEqual({ canal: 'faturamento', valor_atual: 'manual' });
    expect(await exigirCanal(EMPRESA, 'cadastro', 'api')).toEqual({ canal: 'cadastro', valor_atual: 'carga' });
    expect(await exigirCanal(EMPRESA, 'catalogo', 'firebird')).toEqual({ canal: 'catalogo', valor_atual: 'carga' });
  });

  it('o 409 das rotas do parceiro', async () => {
    const { corpoCanalFechado } = await carregar({});
    expect(corpoCanalFechado({ canal: 'pedido_erp', valor_atual: 'manual' })).toEqual({
      error: 'Canal de pedidos ainda não está ligado para a API nesta empresa',
      code: 'CANAL_FECHADO',
      statusCode: 409,
      canal: 'pedido_erp',
      valor_atual: 'manual',
    });
    expect(corpoCanalFechado({ canal: 'faturamento', valor_atual: 'manual' }).error).toBe(
      'Canal de faturamento ainda não está ligado para a API nesta empresa',
    );
    expect(corpoCanalFechado({ canal: 'cadastro', valor_atual: 'carga' }).error).toBe(
      'Canal de cadastro ainda não está ligado para a API nesta empresa',
    );
  });
});
