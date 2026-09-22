import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';
import { MOTIVOS_DE_INATIVO, CHAVES_DE_MOTIVO, motivoExigeNota, rotuloDoMotivo } from '@csb/shared';

/**
 * Cliente INATIVO (migração 052) — visto pela rota.
 *
 * Pedido do Yan (22/09/2026): aba de inativos, cliente que não compra mais
 * sai da régua, motivo SELECIONADO numa lista de 5 (nada escrito). As chaves
 * são as do CRM ("Perdido manual"), para a sincronia casar.
 *
 * O que estes testes trancam: marcar exige motivo válido; "outro" exige nota;
 * desmarcar limpa tudo; rep só na própria carteira, gerência em qualquer uma;
 * financeiro não marca; sem a coluna, 503 com motivo.
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
const TOKEN_REP = assinar({ ...base, sub: 'rep-1', name: 'REINALDO', role: 'rep' });
const TOKEN_GERENTE = assinar({ ...base, sub: 'ger-1', name: 'FABIAN', role: 'manager' });
const TOKEN_FINANCEIRO = assinar({ ...base, sub: 'fin-1', name: 'LARISSA', role: 'financeiro' });

async function subirApp(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}

// Cliente ESFRIADO (vermelho): só ele pode virar inativo (Yan, 22/09/2026).
const ESFRIADO = { data: { id: 'c1', last_purchase_at: '2024-01-15' }, error: null };
// Cliente que comprou há pouco: não é para encerrar, é para vender.
const ATIVO = { data: { id: 'c1', last_purchase_at: new Date().toISOString().slice(0, 10) }, error: null };

const marcar = (token: string, payload: unknown, id = 'c1') => ({
  method: 'PATCH' as const,
  url: `/customers/${id}/inativo`,
  headers: { authorization: `Bearer ${token}` },
  payload,
});

beforeEach(() => {
  vi.resetModules();
});

describe('a lista fechada de motivos', () => {
  it('tem 5 motivos, com as chaves do CRM, e só "outro" exige nota', () => {
    expect(MOTIVOS_DE_INATIVO).toHaveLength(5);
    expect(CHAVES_DE_MOTIVO).toEqual([
      'fechou-a-loja',
      'mudou-de-segmento',
      'nao-quer-relacionamento',
      'reativacao-esgotada',
      'outro',
    ]);
    expect(motivoExigeNota('outro')).toBe(true);
    expect(motivoExigeNota('fechou-a-loja')).toBe(false);
    expect(rotuloDoMotivo('mudou-de-segmento')).toBe('Não trabalha mais com pijama');
    expect(rotuloDoMotivo('qualquer-coisa')).toBeNull();
  });
});

// Sobe o app inteiro: a primeira requisição passa dos 5 s padrão sob carga.
describe('PATCH /customers/:id/inativo', { timeout: 20_000 }, () => {
  it('o representante marca cliente da própria carteira — com motivo, quem e quando', async () => {
    const { app, fake } = await subirApp({ customers: ESFRIADO });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'fechou-a-loja' }));
    await app.close();

    expect(res.statusCode).toBe(200);
    expect((res.json() as { data: { inativo: boolean; inativo_motivo: string } }).data).toMatchObject({
      inativo: true,
      inativo_motivo: 'fechou-a-loja',
    });
    const gravado = fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>;
    expect(gravado.inativo).toBe(true);
    expect(gravado.inativo_motivo).toBe('fechou-a-loja');
    expect(gravado.inativo_nota).toBeNull();
    expect(gravado.inativo_marcado_por).toBe('rep-1');
    expect(gravado.inativo_origem).toBe('app');
    // updated_at junto: é por ele que o CRM percebe e espelha.
    expect(typeof gravado.updated_at).toBe('string');
    // A busca foi DENTRO da carteira dele.
    expect(fake.filtrosDe('customers', 'eq').some((f) => f.args[0] === 'rep_id' && f.args[1] === 'rep-1')).toBe(true);
  });

  it('cliente ATIVO não vira inativo: 409 e nada gravado — só o esfriado', async () => {
    const { app, fake } = await subirApp({ customers: ATIVO });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'fechou-a-loja' }));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('CLIENTE_NAO_ESFRIADO');
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('reativar vale sempre, mesmo com compra recente', async () => {
    const { app, fake } = await subirApp({ customers: ATIVO });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: false }));
    await app.close();

    expect(res.statusCode).toBe(200);
    expect((fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>).inativo).toBe(false);
  });

  it('motivo fora da lista ou texto livre é recusado (400), sem gravar', async () => {
    const { app, fake } = await subirApp({ customers: ESFRIADO });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'trocou de fornecedor' }));
    await app.close();

    expect(res.statusCode).toBe(400);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('marcar sem motivo é recusado; "outro" sem nota também', async () => {
    const { app, fake } = await subirApp({ customers: ESFRIADO });
    const semMotivo = await app.inject(marcar(TOKEN_REP, { inativo: true }));
    const outroSemNota = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'outro' }));
    const outroComNota = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'outro', nota: 'virou papelaria' }));
    await app.close();

    expect(semMotivo.statusCode).toBe(400);
    expect(outroSemNota.statusCode).toBe(400);
    expect(outroComNota.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>;
    expect(gravado.inativo_nota).toBe('virou papelaria');
  });

  it('desmarcar limpa motivo e nota — o cliente volta para a régua', async () => {
    const { app, fake } = await subirApp({ customers: ESFRIADO });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: false }));
    await app.close();

    expect(res.statusCode).toBe(200);
    const gravado = fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>;
    expect(gravado).toMatchObject({ inativo: false, inativo_motivo: null, inativo_nota: null });
  });

  it('gerente marca em qualquer carteira (sem filtro de rep)', async () => {
    const { app, fake } = await subirApp({ customers: ESFRIADO });
    const res = await app.inject(marcar(TOKEN_GERENTE, { inativo: true, motivo: 'mudou-de-segmento' }));
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(fake.filtrosDe('customers', 'eq').some((f) => f.args[0] === 'rep_id')).toBe(false);
  });

  it('financeiro só lê: 403 e nada gravado', async () => {
    const { app, fake } = await subirApp({ customers: ESFRIADO });
    const res = await app.inject(marcar(TOKEN_FINANCEIRO, { inativo: true, motivo: 'fechou-a-loja' }));
    await app.close();

    expect(res.statusCode).toBe(403);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('cliente fora da carteira do representante é 404, sem gravar', async () => {
    // 1ª consulta (detecção da coluna) consome duas entradas da fila do dublê;
    // a 2ª (o cliente na carteira) recebe a terceira: ninguém.
    const { app, fake } = await subirApp({
      customers: [
        { data: [], error: null },
        { data: [], error: null },
        { data: null, error: null },
      ],
    });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'fechou-a-loja' }, 'c-de-outro'));
    await app.close();

    expect(res.statusCode).toBe(404);
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });

  it('sem a migração 052 aplicada responde 503 com o motivo, sem gravar', async () => {
    const { app, fake } = await subirApp({
      customers: { data: null, error: { message: 'column customers.inativo does not exist', code: '42703' } },
    });
    const res = await app.inject(marcar(TOKEN_REP, { inativo: true, motivo: 'fechou-a-loja' }));
    await app.close();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('INATIVO_INDISPONIVEL');
    expect(fake.ultimaGravacao('customers', 'update')).toBeUndefined();
  });
});
