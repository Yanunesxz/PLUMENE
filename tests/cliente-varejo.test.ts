import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Cliente de VAREJO (migração 047) — visto pela rota.
 *
 * Pedido do Yan (15/09/2026): "um botão para marcar apenas nas vendedoras
 * internas para elas informarem que o cliente é cliente varejo e não ficar
 * cobrando elas para entrar em contato novamente".
 *
 * O que estes testes trancam: só rep COM venda interna passa; representante
 * comum e escritório levam 403 sem tocar no banco; a venda interna só marca
 * cliente da própria carteira; e a gravação leva quem marcou e quando.
 */

const EMPRESA = 'empresa-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const base = { email: 'x@csb.com', company_id: EMPRESA, price_table_id: 'tabela-1' };
const TOKEN_VENDA_INTERNA = assinar({ ...base, sub: 'simone', name: 'SIMONE', role: 'rep', venda_interna: true });
const TOKEN_REP_COMUM = assinar({ ...base, sub: 'rep-2', name: 'REINALDO', role: 'rep' });
const TOKEN_GERENTE = assinar({ ...base, sub: 'ger-1', name: 'FABIAN', role: 'manager' });

async function subirApp(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

beforeEach(() => {
  vi.resetModules();
});

// Sobe o app inteiro: a primeira requisição passa dos 5 s padrão sob carga.
describe('PATCH /customers/:id/varejo', { timeout: 20_000 }, () => {
  it('a venda interna marca cliente da própria carteira — com quem e quando', async () => {
    // Uma resposta só para customers: a coluna existe, o cliente está na
    // carteira e o update não dá erro.
    const { app, fake } = await subirApp({ customers: { data: { id: 'c1' }, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/customers/c1/varejo',
      headers: { authorization: `Bearer ${TOKEN_VENDA_INTERNA}` },
      payload: { varejo: true },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { varejo: boolean } }).data.varejo).toBe(true);
    const gravado = fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>;
    expect(gravado.varejo).toBe(true);
    expect(gravado.varejo_marcado_por).toBe('simone');
    expect(typeof gravado.varejo_marcado_em).toBe('string');
    // A busca do cliente foi DENTRO da carteira dela, não na empresa inteira.
    expect(fake.filtrosDe('customers', 'eq').some((f) => f.args[0] === 'rep_id' && f.args[1] === 'simone')).toBe(true);
  });

  it('desmarca também — o cliente volta para a régua', async () => {
    const { app, fake } = await subirApp({ customers: { data: { id: 'c1' }, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/customers/c1/varejo',
      headers: { authorization: `Bearer ${TOKEN_VENDA_INTERNA}` },
      payload: { varejo: false },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    expect((fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>).varejo).toBe(false);
  });

  it('representante comum leva 403 e nada é gravado', async () => {
    const { app, fake } = await subirApp({ customers: { data: { id: 'c1' }, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/customers/c1/varejo',
      headers: { authorization: `Bearer ${TOKEN_REP_COMUM}` },
      payload: { varejo: true },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect((res.json() as { code: string }).code).toBe('SO_VENDA_INTERNA');
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('gerente também não marca — é só da venda interna', async () => {
    const { app, fake } = await subirApp({ customers: { data: { id: 'c1' }, error: null } });
    const res = await app.inject({
      method: 'PATCH',
      url: '/customers/c1/varejo',
      headers: { authorization: `Bearer ${TOKEN_GERENTE}` },
      payload: { varejo: true },
    });
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('cliente fora da carteira dela é 404, sem gravar', async () => {
    // 1ª consulta (detecção da coluna) consome duas entradas da fila do dublê;
    // a 2ª (o cliente na carteira) recebe a terceira: ninguém.
    const { app, fake } = await subirApp({
      customers: [
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null },
      ],
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/customers/c-de-outro/varejo',
      headers: { authorization: `Bearer ${TOKEN_VENDA_INTERNA}` },
      payload: { varejo: true },
    });
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('sem a migração 047 aplicada responde 503 com o motivo, sem gravar', async () => {
    const { app, fake } = await subirApp({
      customers: { data: null, error: { message: 'column customers.varejo does not exist', code: '42703' } },
    });
    const res = await app.inject({
      method: 'PATCH',
      url: '/customers/c1/varejo',
      headers: { authorization: `Bearer ${TOKEN_VENDA_INTERNA}` },
      payload: { varejo: true },
    });
    await app.close();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('VAREJO_INDISPONIVEL');
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });
});
