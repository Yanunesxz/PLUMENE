import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * A API que o ERP do parceiro alimenta com clientes e representantes.
 *
 * O que estes testes trancam:
 *  • upsert por CÓDIGO do ERP: quem já existe é atualizado, quem não existe é
 *    criado — sem duplicar;
 *  • tolerância: registro sem código ou sem nome é ignorado COM motivo, não
 *    derruba o lote inteiro;
 *  • o endereço em pedaços vira a linha única que o app guarda;
 *  • representante é só ATUALIZADO (nome/e-mail/ativo); quem o Control tem e o
 *    app não vem em `novos`, para criação manual — nunca nasce login por POST.
 */

const EMPRESA = 'empresa-1';

async function carregar(respostas: Parameters<typeof criarSupabaseFake>[0]) {
  vi.resetModules();
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const service = await import('../apps/api/src/modules/partner/partner.sync.service.js');
  return { service, fake };
}

beforeEach(() => {
  vi.resetModules();
});

describe('clientes', () => {
  it('cria o novo, atualiza o que já existe e ignora o sem código', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-uuid', erp_code: '01' }], error: null },
      customers: [
        { data: [{ id: 'existe-1', erp_id: 'C0002' }], error: null }, // select dos existentes
        { data: null, error: null }, // insert
        { data: null, error: null }, // update
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C0001', razao_social: 'LOJA NOVA', tabela_preco: '01', representante: 'R01' },
      { codigo: 'C0002', razao_social: 'LOJA ANTIGA' },
      { razao_social: 'SEM CODIGO' } as never,
    ]);

    expect(r.recebidos).toBe(3);
    expect(r.criados).toBe(1);
    expect(r.atualizados).toBe(1);
    expect(r.ignorados).toEqual([{ codigo: null, motivo: 'sem código do ERP' }]);

    const insert = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'insert');
    const linha = (insert!.valores as Record<string, unknown>[])[0]!;
    expect(linha['erp_id']).toBe('C0001');
    expect(linha['name']).toBe('LOJA NOVA');
    expect(linha['rep_erp_id']).toBe('R01');
    expect(linha['price_table_id']).toBe('t-uuid'); // resolveu a tabela pelo código

    const update = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'update');
    expect((update!.valores as Record<string, unknown>)['name']).toBe('LOJA ANTIGA');
    // O id vai no filtro `.eq('id', ...)`, não no corpo do update.
    const filtroPorId = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id');
    expect(filtroPorId?.args[1]).toBe('existe-1');
  });


  it('enxerga o cliente que esta DEPOIS da linha 1.000 — senao a carga o duplicaria', async () => {
    // O PostgREST corta em 1.000 linhas sem avisar, e a CS tem 2.604 clientes.
    // Aqui a primeira pagina vem cheia (1.000) e o alvo esta na segunda.
    const primeiraPagina = Array.from({ length: 1000 }, (_, i) => ({
      id: `c-${i}`,
      erp_id: `X${i}`,
      cnpj: null,
    }));
    const { service, fake } = await carregar({
      price_tables: { data: [{ id: 't-uuid', erp_code: '01' }], error: null },
      customers: [
        { data: primeiraPagina, error: null },
        // O dublê adianta a próxima resposta a cada consulta; esta linha é o
        // espaço dessa antecipação, para a 2ª página cair na 2ª ida ao banco.
        { data: [], error: null },
        { data: [{ id: 'la-no-fim', erp_id: 'C9999', cnpj: null }], error: null },
        { data: null, error: null },
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C9999', razao_social: 'LOJA DA PAGINA 2' },
    ]);

    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(1);
    const filtroPorId = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id');
    expect(filtroPorId?.args[1]).toBe('la-no-fim');
  });
  it('ADOTA pelo CNPJ o cliente que existia sem código — a mesma loja não vira duas', async () => {
    // O cliente veio da carga de carteira (relatório Curva ABC, sem código do
    // Control). Quando o ERP manda o mesmo CNPJ COM código, tem de atualizar
    // aquele cadastro e gravar o código — não criar um segundo.
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        {
          data: [{ id: 'sem-codigo-1', erp_id: null, cnpj: '22.518.613/0001-58' }],
          error: null,
        },
        { data: null, error: null }, // update
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C0900', razao_social: 'SENSUALLY MODA INTIMA', cnpj_cpf: '22518613000158' },
    ]);

    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(1);
    expect(r.avisos.some((a) => a.includes('casados pelo CNPJ'))).toBe(true);

    const update = fake.gravacoes.find((g) => g.tabela === 'customers' && g.operacao === 'update');
    // O cadastro adotado APRENDE o código — daqui em diante casa pelo caminho normal.
    expect((update!.valores as Record<string, unknown>)['erp_id']).toBe('C0900');
    const filtroPorId = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'id');
    expect(filtroPorId?.args[1]).toBe('sem-codigo-1');
  });

  it('casa o código pelo miolo — "#2225", "2225" e "02225" são o mesmo cliente', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        { data: [{ id: 'existe-2', erp_id: '#2225', cnpj: null }], error: null },
        { data: null, error: null },
      ],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: '02225', razao_social: 'MESMA LOJA' },
    ]);

    expect(r.criados).toBe(0);
    expect(r.atualizados).toBe(1);
  });

  it('monta o endereço em pedaços numa linha só', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [
        { data: [], error: null },
        { data: null, error: null },
      ],
    });

    await service.receberClientes(EMPRESA, [
      {
        codigo: 'C1',
        razao_social: 'LOJA',
        endereco: {
          logradouro: 'Rua das Flores',
          numero: '123',
          complemento: 'Sala 2',
          bairro: 'Centro',
          cidade: 'Juiz de Fora',
          uf: 'MG',
          cep: '36000-000',
        },
      },
    ]);

    const insert = fake.gravacoes.find((g) => g.operacao === 'insert');
    const linha = (insert!.valores as Record<string, unknown>[])[0]!;
    expect(linha['address']).toBe('Rua das Flores, 123 Sala 2 - Centro - Juiz de Fora/MG - CEP 36000-000');
  });

  it('bloqueado aceita "S", true e 1', async () => {
    const { service, fake } = await carregar({
      price_tables: { data: [], error: null },
      customers: [{ data: [], error: null }, { data: null, error: null }],
    });

    await service.receberClientes(EMPRESA, [
      { codigo: 'A', razao_social: 'A', bloqueado: 'S' },
      { codigo: 'B', razao_social: 'B', bloqueado: true },
      { codigo: 'C', razao_social: 'C', bloqueado: 'N' },
    ]);

    const insert = fake.gravacoes.find((g) => g.operacao === 'insert');
    const linhas = insert!.valores as Record<string, unknown>[];
    expect(linhas.map((l) => l['blocked'])).toEqual([true, true, false]);
  });

  it('avisa quando a tabela de preço do cliente não existe aqui', async () => {
    const { service } = await carregar({
      price_tables: { data: [{ id: 't1', erp_code: '01' }], error: null },
      customers: [{ data: [], error: null }, { data: null, error: null }],
    });

    const r = await service.receberClientes(EMPRESA, [
      { codigo: 'C1', razao_social: 'LOJA', tabela_preco: '99' },
    ]);

    expect(r.avisos.some((a) => a.includes('99'))).toBe(true);
  });
});

describe('representantes', () => {
  it('atualiza o que existe e lista o novo, sem criar login', async () => {
    const { service, fake } = await carregar({
      users: [
        { data: [{ id: 'u1', erp_rep_id: 'R01' }], error: null }, // select
        { data: null, error: null }, // update do R01
      ],
    });

    const r = await service.receberRepresentantes(EMPRESA, [
      { codigo: 'R01', nome: 'SIMONE', email: 'SIMONE@CS.COM', ativo: 'S' },
      { codigo: 'R99', nome: 'REP NOVO' },
      { nome: 'SEM CODIGO' } as never,
    ]);

    expect(r.atualizados).toBe(1);
    expect(r.criados).toBe(0);
    expect(r.novos).toEqual([{ codigo: 'R99', nome: 'REP NOVO' }]);
    expect(r.ignorados).toEqual([{ codigo: null, motivo: 'sem código do ERP' }]);

    const update = fake.gravacoes.find((g) => g.tabela === 'users' && g.operacao === 'update');
    const campos = update!.valores as Record<string, unknown>;
    expect(campos['name']).toBe('SIMONE');
    expect(campos['email']).toBe('simone@cs.com'); // minúsculo
    expect(campos['active']).toBe(true);
    // Nunca mexe em senha.
    expect(campos['password_hash']).toBeUndefined();
  });

  it('nunca insere na tabela users — login não nasce por POST', async () => {
    const { service, fake } = await carregar({
      users: [{ data: [], error: null }],
    });

    await service.receberRepresentantes(EMPRESA, [{ codigo: 'R01', nome: 'NOVO' }]);

    expect(fake.gravacoes.some((g) => g.tabela === 'users' && g.operacao === 'insert')).toBe(false);
  });

  it('`ativo` vazio ("") é "não veio": não mexe no acesso do rep', async () => {
    // Um CHAR nulo do Firebird costuma sair como "" no JSON gerado à mão. Antes,
    // "" contava como "veio" e virava active=false — desligava o login a cada envio.
    const { service, fake } = await carregar({
      users: [
        { data: [{ id: 'u1', erp_rep_id: 'R01' }], error: null },
        { data: null, error: null },
      ],
    });

    const r = await service.receberRepresentantes(EMPRESA, [{ codigo: 'R01', nome: 'SIMONE', ativo: '' }]);

    expect(r.atualizados).toBe(1);
    const update = fake.gravacoes.find((g) => g.tabela === 'users' && g.operacao === 'update');
    expect('active' in (update!.valores as Record<string, unknown>)).toBe(false);
  });

  it('`ativo: "N"` (ou false) desativa; `"S"` (ou true) reativa', async () => {
    const { service, fake } = await carregar({
      users: [
        { data: [{ id: 'u1', erp_rep_id: 'R01' }, { id: 'u2', erp_rep_id: 'R02' }], error: null },
        { data: null, error: null },
        { data: null, error: null },
      ],
    });

    await service.receberRepresentantes(EMPRESA, [
      { codigo: 'R01', nome: 'SIMONE', ativo: 'N' },
      { codigo: 'R02', nome: 'CARLA', ativo: true },
    ]);

    const updates = fake.gravacoes.filter((g) => g.tabela === 'users' && g.operacao === 'update');
    expect(updates.map((u) => (u.valores as Record<string, unknown>)['active'])).toEqual([false, true]);
  });
});
