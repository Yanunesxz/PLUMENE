import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { criarSupabaseFake, type Responder, type RespostaTabela } from './supabaseFake.js';
import {
  ORDER_STATUS,
  STATUS_QUE_CONTAM_PARA_A_META,
  contaParaAMeta,
  pedidoContaParaAMeta,
  somaParaAMetaDoMes,
  podeInativarPedido,
  podeReativarPedido,
  exibeCarimboInativo,
} from '@csb/shared';

/**
 * PEDIDO INATIVO (migração 055) e a bonificação só do que foi APROVADO.
 *
 * Pedido do Yan (15/10/2026): "a bonificação é de todos os pedidos que a
 * Larissa aprovar; todos pedidos aprovados pela fábrica viram bonificação. Mas
 * o pedido pode ter o carimbo de inativo como o de faturado: se o pedido for
 * aprovado e depois inativado a pessoa não recebe a bonificação."
 *
 * Decisões dele: enviado e ainda não aprovado NÃO conta; o mês é o do ENVIO
 * (created_at); "Inativar" é outra marca, como Faturado — não é cancelar
 * (053); quem marca é o financeiro e o admin, o representante só vê.
 *
 * O que estes testes trancam:
 *  • a regra em shared: pending_approval saiu; approved/sent_erp/error_erp
 *    contam; inativo e cancelado ficam fora; a soma é pelo mês do envio;
 *  • a rota: só financeiro e admin; 409 em pedido fora do status, faturado ou
 *    não inativo; 503 sem a 055 (e 503 diferente num soluço de rede); o
 *    reativar (e o cancelado não se reativa, 16/10/2026); faturar pedido
 *    inativo → 409; o push ao representante só no carimbo de verdade; o GET
 *    do pedido traz o nome de quem inativou;
 *  • as telas somam pela função de PEDIDO (status + carimbo), não só o status;
 *    a loja não vê o carimbo (nem na lista), e no cancelado ele some.
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
const TOKEN = {
  financeiro: assinar({ ...base, sub: 'larissa', name: 'LARISSA', role: 'financeiro' }),
  admin: assinar({ ...base, sub: 'adm-1', name: 'YAN', role: 'admin' }),
  rep: assinar({ ...base, sub: 'rep-1', name: 'REINALDO', role: 'rep' }),
  vendaInterna: assinar({ ...base, sub: 'rep-1', name: 'SIMONE', role: 'rep', venda_interna: true }),
  gerente: assinar({ ...base, sub: 'ger-1', name: 'WESLEY', role: 'manager', permissions: null }),
  relacionamento: assinar({ ...base, sub: 'bruna', name: 'BRUNA', role: 'relacionamento' }),
  loja: assinar({ ...base, sub: 'loja-1', name: 'LOJA', role: 'store', customer_id: 'c1' }),
};

const SONDA_OK: RespostaTabela = { data: [], error: null };
const SEM_COLUNA: RespostaTabela = {
  data: null,
  error: { code: '42703', message: 'column orders.inactive does not exist' },
};
const SEM_RESPOSTA: RespostaTabela = { data: null, error: { message: 'fetch failed' } };

const PEDIDO_BASE = {
  id: 'o1',
  company_id: EMPRESA,
  rep_id: 'rep-1',
  customer_id: 'c1',
  status: 'approved',
  invoiced: false,
  inactive: false,
  inactive_at: null,
  order_number: 14700,
  total: 12_000,
  created_at: '2026-10-01T12:00:00.000Z',
};

/**
 * Um banco que REAGE: a sonda da coluna (select('inactive')) responde o que o
 * teste mandar; o UPDATE devolve o pedido já com os valores gravados; o resto
 * devolve o pedido como está. É o mesmo `orders` para as três consultas.
 */
const bancoComPedido =
  (p: Record<string, unknown>, sonda: RespostaTabela = SONDA_OK): Responder =>
  (consulta) => {
    const select = consulta.filtros.find((f) => f.metodo === 'select');
    if (consulta.operacao === 'select' && select?.args[0] === 'inactive') return sonda;
    if (consulta.operacao === 'update') {
      return { data: { ...PEDIDO_BASE, ...p, ...(consulta.valores as Record<string, unknown>) }, error: null };
    }
    return { data: { ...PEDIDO_BASE, ...p }, error: null };
  };

/**
 * Sobe o app com o banco de mentira e com o aviso push ao representante
 * trocado por um espião: o teste confere QUANDO o controller avisa (só no
 * carimbo de verdade), não o envio em si — esse é o tests/notificacoes-push.
 */
async function subirApp(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  const aviso = vi.fn();
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  vi.doMock('../apps/api/src/modules/push/push.avisos.js', async (importar) => ({
    ...(await importar<Record<string, unknown>>()),
    avisarPedidoInativoAoRep: aviso,
  }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake, aviso };
}

const inativar = (token: string, payload: unknown = { inactive: true }) => ({
  method: 'PATCH' as const,
  url: '/orders/o1/inativo',
  headers: { authorization: `Bearer ${token}` },
  payload,
});

const faturar = (token: string) => ({
  method: 'PATCH' as const,
  url: '/orders/o1/invoice',
  headers: { authorization: `Bearer ${token}` },
  payload: { invoiced: true },
});

beforeEach(() => {
  vi.resetModules();
});

// ─── A regra (shared) ────────────────────────────────────────────────────────

describe('o que conta para a bonificação (regra do Yan, 15/10/2026)', () => {
  it('só depois de aprovado: pending_approval saiu; approved, sent_erp e error_erp contam', () => {
    expect([...STATUS_QUE_CONTAM_PARA_A_META]).toEqual([
      ORDER_STATUS.APPROVED,
      ORDER_STATUS.SENT_ERP,
      ORDER_STATUS.ERROR_ERP,
    ]);
    expect(contaParaAMeta(ORDER_STATUS.PENDING_APPROVAL)).toBe(false);
    expect(contaParaAMeta(ORDER_STATUS.APPROVED)).toBe(true);
    expect(contaParaAMeta(ORDER_STATUS.SENT_ERP)).toBe(true);
    // Aprovado com problema no ERP continua aprovado.
    expect(contaParaAMeta(ORDER_STATUS.ERROR_ERP)).toBe(true);
  });

  it('o pedido inativo não conta, mesmo aprovado; cancelado e na fila também não', () => {
    expect(pedidoContaParaAMeta({ status: 'approved' })).toBe(true);
    expect(pedidoContaParaAMeta({ status: 'sent_erp', inactive: false })).toBe(true);
    expect(pedidoContaParaAMeta({ status: 'approved', inactive: true })).toBe(false);
    expect(pedidoContaParaAMeta({ status: 'sent_erp', inactive: true })).toBe(false);
    expect(pedidoContaParaAMeta({ status: 'rejected' })).toBe(false);
    expect(pedidoContaParaAMeta({ status: 'pending_approval' })).toBe(false);
    // Sem a 055 a coluna não vem: ninguém está inativo.
    expect(pedidoContaParaAMeta({ status: 'approved', inactive: undefined })).toBe(true);
    expect(pedidoContaParaAMeta({ status: 'approved', inactive: null })).toBe(true);
  });

  it('a soma é pelo mês do ENVIO: enviado 30/09 e aprovado 02/10 conta em setembro', () => {
    const setembro = new Date(2026, 8, 15, 12);
    const pedidos = [
      // enviado 30/09, aprovado depois: conta em setembro, pelo total do pedido
      { status: 'approved' as const, created_at: '2026-09-30T12:00:00-03:00', total: 10_000 },
      // enviado em outubro: é do mês que vem
      { status: 'approved' as const, created_at: '2026-10-02T12:00:00-03:00', total: 50_000 },
      // na fila do financeiro: ainda não
      { status: 'pending_approval' as const, created_at: '2026-09-20T12:00:00-03:00', total: 7_000 },
      // aprovado e depois inativado: fora
      { status: 'approved' as const, inactive: true, created_at: '2026-09-10T12:00:00-03:00', total: 9_000 },
      // cancelado: fora
      { status: 'rejected' as const, created_at: '2026-09-11T12:00:00-03:00', total: 3_000 },
      // lançado e com problema no ERP: aprovados os dois
      { status: 'sent_erp' as const, created_at: '2026-09-12T12:00:00-03:00', total: 2_000 },
      { status: 'error_erp' as const, created_at: '2026-09-13T12:00:00-03:00', total: 500 },
      // rascunho e triagem da loja: fora
      { status: 'draft' as const, created_at: '2026-09-14T12:00:00-03:00', total: 1_000 },
      { status: 'pending_rep' as const, created_at: '2026-09-14T12:00:00-03:00', total: 1_000 },
      // sem total ainda (offline): conta zero, não quebra
      { status: 'approved' as const, created_at: '2026-09-15T12:00:00-03:00', total: null },
    ];
    expect(somaParaAMetaDoMes(pedidos, setembro)).toBe(12_500);
    expect(somaParaAMetaDoMes(pedidos, new Date(2026, 9, 15, 12))).toBe(50_000);
    expect(somaParaAMetaDoMes([], setembro)).toBe(0);
  });

  it('quem inativa e quando: financeiro e admin, só pedido aprovado e não faturado', () => {
    expect(podeInativarPedido({ status: 'approved' }, 'financeiro')).toBe('ok');
    expect(podeInativarPedido({ status: 'sent_erp' }, 'admin')).toBe('ok');
    expect(podeInativarPedido({ status: 'error_erp' }, 'financeiro')).toBe('ok');
    expect(podeInativarPedido({ status: 'approved' }, 'rep')).toBe('forbidden');
    expect(podeInativarPedido({ status: 'approved' }, 'manager')).toBe('forbidden');
    expect(podeInativarPedido({ status: 'approved' }, 'relacionamento')).toBe('forbidden');
    expect(podeInativarPedido({ status: 'approved' }, 'store')).toBe('forbidden');
    expect(podeInativarPedido({ status: 'approved' }, undefined)).toBe('forbidden');
    expect(podeInativarPedido({ status: 'approved', invoiced: true }, 'financeiro')).toBe('faturado');
    expect(podeInativarPedido({ status: 'pending_approval' }, 'financeiro')).toBe('status_nao_permite');
    expect(podeInativarPedido({ status: 'rejected' }, 'admin')).toBe('status_nao_permite');
    expect(podeInativarPedido({ status: 'draft' }, 'admin')).toBe('status_nao_permite');
    expect(podeInativarPedido({ status: 'approved', inactive: true }, 'financeiro')).toBe('ja_inativo');
    // Reativar: os mesmos papéis, e só o que está inativo.
    expect(podeReativarPedido({ status: 'approved', inactive: true }, 'financeiro')).toBe('ok');
    expect(podeReativarPedido({ status: 'approved', inactive: true }, 'admin')).toBe('ok');
    expect(podeReativarPedido({ status: 'approved', inactive: true }, 'rep')).toBe('forbidden');
    expect(podeReativarPedido({ status: 'approved' }, 'financeiro')).toBe('nao_esta_inativo');
  });

  it('o cancelado depois de inativado não se reativa — e o carimbo some da tela (16/10/2026)', () => {
    // Inativar já recusava o cancelado; reativar passa a recusar também, pelo
    // mesmo motivo: o botão "Reativar pedido" não aparece num pedido que não
    // volta a contar para nada.
    expect(podeReativarPedido({ status: 'rejected', inactive: true }, 'financeiro')).toBe('status_nao_permite');
    expect(podeReativarPedido({ status: 'rejected', inactive: true }, 'admin')).toBe('status_nao_permite');
    // O papel vem antes do status; o "não está inativo" também.
    expect(podeReativarPedido({ status: 'rejected', inactive: true }, 'rep')).toBe('forbidden');
    expect(podeReativarPedido({ status: 'rejected' }, 'financeiro')).toBe('nao_esta_inativo');
    // O carimbo aparece só com a marca gravada E num status que conta.
    expect(exibeCarimboInativo({ status: 'approved', inactive: true })).toBe(true);
    expect(exibeCarimboInativo({ status: 'sent_erp', inactive: true })).toBe(true);
    expect(exibeCarimboInativo({ status: 'error_erp', inactive: true })).toBe(true);
    expect(exibeCarimboInativo({ status: 'rejected', inactive: true })).toBe(false);
    expect(exibeCarimboInativo({ status: 'approved', inactive: false })).toBe(false);
    expect(exibeCarimboInativo({ status: 'approved' })).toBe(false);
    expect(exibeCarimboInativo({ status: 'approved', inactive: null })).toBe(false);
  });
});

// ─── A rota ──────────────────────────────────────────────────────────────────

// Sobe o app inteiro: a primeira requisição passa dos 5 s padrão sob carga.
describe('PATCH /orders/:id/inativo', { timeout: 20_000 }, () => {
  it('o financeiro inativa um pedido aprovado: grava o carimbo, quem, quando, a nota — e o rastro', async () => {
    const { app, fake, aviso } = await subirApp({ orders: bancoComPedido({ status: 'sent_erp' }) });
    const res = await app.inject(inativar(TOKEN.financeiro, { inactive: true, note: 'Inativado no Control em 14/10' }));
    await app.close();

    expect(res.statusCode).toBe(200);
    // O representante dono fica sabendo que o pedido saiu da bonificação —
    // como fica do faturado: a empresa, o pedido gravado e quem marcou.
    expect(aviso).toHaveBeenCalledTimes(1);
    expect(aviso).toHaveBeenCalledWith(
      EMPRESA,
      expect.objectContaining({ id: 'o1', rep_id: 'rep-1', inactive: true }),
      'larissa',
    );
    const corpo = res.json() as { data: Record<string, unknown> };
    expect(corpo.data['inactive']).toBe(true);

    const gravado = fake.ultimaGravacao('orders', 'update')?.valores as Record<string, unknown>;
    expect(gravado).toMatchObject({
      inactive: true,
      inactive_by: 'larissa',
      inactive_note: 'Inativado no Control em 14/10',
    });
    expect(typeof gravado['inactive_at']).toBe('string');
    expect(typeof gravado['updated_at']).toBe('string');
    // Só grava se o pedido CONTINUA aprovado, não faturado e ainda não inativo.
    expect(fake.filtrosDe('orders', 'in').some((f) => f.args[0] === 'status')).toBe(true);
    expect(fake.filtrosDe('orders', 'or').map((f) => f.args[0])).toEqual(
      expect.arrayContaining(['invoiced.is.null,invoiced.eq.false', 'inactive.is.null,inactive.eq.false']),
    );
    // O rastro, como o Faturado deixa: tipo próprio, quem, e a nota como motivo.
    const evento = fake.ultimaGravacao('order_erp_events', 'insert')?.valores as Record<string, unknown>;
    expect(evento).toMatchObject({
      tipo: 'pedido_inativado',
      origem: 'tela',
      por: 'larissa',
      por_nome: 'LARISSA',
      motivo: 'Inativado no Control em 14/10',
      antes: { inactive: false, inactive_at: null },
    });
    expect((evento['depois'] as Record<string, unknown>)['inactive']).toBe(true);
  });

  it('o admin reativa: limpa carimbo, quem, quando e nota, e deixa o rastro — sem avisar o representante', async () => {
    const { app, fake, aviso } = await subirApp({
      orders: bancoComPedido({ inactive: true, inactive_at: '2026-10-14T10:00:00.000Z', inactive_by: 'larissa' }),
    });
    const res = await app.inject(inativar(TOKEN.admin, { inactive: false }));
    await app.close();

    expect(res.statusCode).toBe(200);
    // Reativar é desfazer: nenhum aviso (como o Desmarcar do faturado).
    expect(aviso).not.toHaveBeenCalled();
    expect(fake.ultimaGravacao('orders', 'update')?.valores).toMatchObject({
      inactive: false,
      inactive_at: null,
      inactive_by: null,
      inactive_note: null,
    });
    expect(fake.filtrosDe('orders', 'eq').some((f) => f.args[0] === 'inactive' && f.args[1] === true)).toBe(true);
    expect(fake.ultimaGravacao('order_erp_events', 'insert')?.valores).toMatchObject({
      tipo: 'pedido_reativado',
      por: 'adm-1',
      antes: { inactive: true, inactive_at: '2026-10-14T10:00:00.000Z' },
      depois: { inactive: false, inactive_at: null },
    });
  });

  it('representante, venda interna, gerente, relacionamento e loja: 403, nada gravado', async () => {
    for (const token of [TOKEN.rep, TOKEN.vendaInterna, TOKEN.gerente, TOKEN.relacionamento, TOKEN.loja]) {
      vi.resetModules();
      const { app, fake } = await subirApp({ orders: bancoComPedido({}) });
      const res = await app.inject(inativar(token));
      await app.close();
      expect(res.statusCode).toBe(403);
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    }
  });

  it('pedido na fila, cancelado ou rascunho não se inativa — 409 STATUS_NAO_PERMITE', async () => {
    for (const status of ['pending_approval', 'rejected', 'draft', 'pending_rep']) {
      vi.resetModules();
      const { app, fake } = await subirApp({ orders: bancoComPedido({ status }) });
      const res = await app.inject(inativar(TOKEN.financeiro));
      await app.close();
      expect(res.statusCode).toBe(409);
      expect((res.json() as { code: string }).code).toBe('STATUS_NAO_PERMITE');
      expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    }
  });

  it('o cancelado depois de inativado não se reativa — 409 STATUS_NAO_PERMITE, nada gravado (16/10/2026)', async () => {
    // Antes: o financeiro inativava um lançado, cancelava com motivo (o
    // cancelamento não mexe no carimbo) e o detalhe mostrava "Cancelado" +
    // "Pedido inativo" + o botão de reativar — e o PATCH respondia 200 num
    // pedido que não volta a contar para nada. Agora é simétrico com o inativar.
    const { app, fake, aviso } = await subirApp({
      orders: bancoComPedido({ status: 'rejected', inactive: true, inactive_at: '2026-10-14T10:00:00.000Z' }),
    });
    const res = await app.inject(inativar(TOKEN.financeiro, { inactive: false }));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('STATUS_NAO_PERMITE');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
    expect(aviso).not.toHaveBeenCalled();
  });

  it('pedido faturado não se inativa — 409 JA_FATURADO ("desfature antes")', async () => {
    const { app, fake } = await subirApp({ orders: bancoComPedido({ status: 'sent_erp', invoiced: true }) });
    const res = await app.inject(inativar(TOKEN.financeiro));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string; error: string }).code).toBe('JA_FATURADO');
    expect((res.json() as { error: string }).error).toMatch(/desfa/i);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('reativar pedido que não está inativo — 409 NAO_ESTA_INATIVO', async () => {
    const { app, fake } = await subirApp({ orders: bancoComPedido({}) });
    const res = await app.inject(inativar(TOKEN.financeiro, { inactive: false }));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('NAO_ESTA_INATIVO');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('inativar de novo o já inativo: 200 sem gravar nem avisar (idempotente, como o Faturado)', async () => {
    const { app, fake, aviso } = await subirApp({ orders: bancoComPedido({ inactive: true }) });
    const res = await app.inject(inativar(TOKEN.admin));
    await app.close();

    expect(res.statusCode).toBe(200);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
    expect(fake.ultimaGravacao('order_erp_events', 'insert')).toBeUndefined();
    // O recarimbo não apita de novo no celular do representante.
    expect(aviso).not.toHaveBeenCalled();
  });

  it('sem a 055 (coluna ausente): 503 MIGRACAO_PENDENTE, nada gravado', async () => {
    const { app, fake } = await subirApp({ orders: bancoComPedido({}, SEM_COLUNA) });
    const res = await app.inject(inativar(TOKEN.financeiro));
    await app.close();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string; error: string }).code).toBe('MIGRACAO_PENDENTE');
    expect((res.json() as { error: string }).error).toMatch(/055/);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('soluço de rede na sonda NÃO vira "migração pendente": 503 de outro código, nada gravado', async () => {
    const { app, fake } = await subirApp({ orders: bancoComPedido({}, SEM_RESPOSTA) });
    const res = await app.inject(inativar(TOKEN.financeiro));
    await app.close();

    expect(res.statusCode).toBe(503);
    expect((res.json() as { code: string }).code).toBe('BANCO_INDISPONIVEL');
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });

  it('nota com mais de 500 letras ou corpo sem `inactive`: 400', async () => {
    const { app } = await subirApp({ orders: bancoComPedido({}) });
    const longa = await app.inject(inativar(TOKEN.financeiro, { inactive: true, note: 'x'.repeat(501) }));
    const semCampo = await app.inject(inativar(TOKEN.financeiro, { note: 'só a nota' }));
    await app.close();

    expect(longa.statusCode).toBe(400);
    expect(semCampo.statusCode).toBe(400);
  });

  it('pedido não encontrado (ou de outra empresa): 404', async () => {
    const orders: Responder = (consulta) => {
      const select = consulta.filtros.find((f) => f.metodo === 'select');
      if (select?.args[0] === 'inactive') return SONDA_OK;
      return { data: null, error: null };
    };
    const { app } = await subirApp({ orders });
    const res = await app.inject(inativar(TOKEN.financeiro));
    await app.close();

    expect(res.statusCode).toBe(404);
  });
});

describe('GET /orders/:id com o carimbo', { timeout: 20_000 }, () => {
  it('devolve o nome de quem inativou (inactive_by_name), como faz com quem cancelou', async () => {
    // `orders` responde o pedido inativado nas leituras de uma linha e "ok" nas
    // sondas de coluna; `users` responde pelo id pedido — o de quem inativou e
    // o do representante são consultas diferentes e não podem se misturar.
    const NOMES: Record<string, string> = { larissa: 'LARISSA', 'rep-1': 'REINALDO' };
    const orders: Responder = (consulta) =>
      consulta.umaLinha
        ? {
            data: {
              ...PEDIDO_BASE,
              status: 'sent_erp',
              inactive: true,
              inactive_at: '2026-10-14T10:00:00.000Z',
              inactive_by: 'larissa',
              inactive_note: 'Inativado no Control',
              items: [],
            },
            error: null,
          }
        : SONDA_OK;
    const users: Responder = (consulta) => {
      const id = consulta.filtros.find((f) => f.metodo === 'eq' && f.args[0] === 'id')?.args[1] as string;
      return { data: { id, name: NOMES[id] ?? null, erp_rep_id: null, phone: null }, error: null };
    };
    const { app, fake } = await subirApp({ orders, users });
    const res = await app.inject({
      method: 'GET',
      url: '/orders/o1',
      headers: { authorization: `Bearer ${TOKEN.rep}` },
    });
    await app.close();

    expect(res.statusCode).toBe(200);
    const dados = (res.json() as { data: Record<string, unknown> }).data;
    expect(dados['inactive']).toBe(true);
    expect(dados['inactive_by']).toBe('larissa');
    expect(dados['inactive_by_name']).toBe('LARISSA');
    expect(dados['inactive_note']).toBe('Inativado no Control');
    // O representante do pedido continua sendo ele — o nome não foi trocado
    // pelo de quem inativou.
    expect((dados['rep_info'] as { name: string }).name).toBe('REINALDO');
    expect(fake.filtrosDe('users', 'eq').some((f) => f.args[0] === 'id' && f.args[1] === 'larissa')).toBe(true);
  });
});

describe('faturar pedido inativo', { timeout: 20_000 }, () => {
  it('"Marcar faturado" num pedido inativo é recusado — 409 PEDIDO_INATIVO ("reative antes"), nada gravado', async () => {
    const { app, fake } = await subirApp({ orders: bancoComPedido({ status: 'sent_erp', inactive: true }) });
    const res = await app.inject(faturar(TOKEN.financeiro));
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { code: string }).code).toBe('PEDIDO_INATIVO');
    expect((res.json() as { error: string }).error).toMatch(/reativ/i);
    expect(fake.ultimaGravacao('orders', 'update')).toBeUndefined();
  });
});

// ─── As telas ────────────────────────────────────────────────────────────────

const ler = (rel: string) => readFileSync(path.resolve(__dirname, '..', rel), 'utf8');

describe('as telas usam a regra de PEDIDO (status + carimbo), não só o status', () => {
  const MINHA_AREA = ler('apps/web/src/modules/minha-area/PaginaMinhaArea.tsx');
  const ALERTAS = ler('apps/web/src/hooks/useAlertas.ts');
  const REGUA = ler('apps/web/src/components/comercial/ReguaDaMeta.tsx');
  const TEXTOS = ler('apps/web/src/lib/alertas.ts');
  const DETALHE = ler('apps/web/src/modules/pedidos/PaginaDetalhePedido.tsx');
  const LISTA = ler('apps/web/src/modules/pedidos/PaginaPedidos.tsx');

  it('Minha Área e os alertas somam pela função de pedido, nunca por contaParaAMeta(status)', () => {
    for (const fonte of [MINHA_AREA, ALERTAS]) {
      expect(fonte).toMatch(/somaParaAMetaDoMes\(/);
      expect(fonte).not.toMatch(/(?<![A-Za-z])contaParaAMeta\(/);
    }
    // Nenhum outro lugar da web soma pedido para a meta pelo status sozinho.
    for (const arquivo of [
      'apps/web/src/components/comercial/ReguaDaMeta.tsx',
      'apps/web/src/components/comercial/PainelDaMeta.tsx',
      'apps/web/src/hooks/useMinhaMeta.ts',
      'apps/web/src/modules/representantes/PaginaRepresentantes.tsx',
    ]) {
      expect(ler(arquivo)).not.toMatch(/(?<![A-Za-z])contaParaAMeta\(/);
    }
  });

  it('os textos dizem que conta o que a fábrica APROVOU do que foi enviado, e que inativo e cancelado ficam fora', () => {
    expect(REGUA).toMatch(/aprov/i);
    expect(REGUA).toMatch(/inativo/i);
    expect(REGUA).toMatch(/cancelado/i);
    expect(TEXTOS).toMatch(/aprovou/);
    expect(TEXTOS).not.toMatch(/Você enviou/);
    expect(MINHA_AREA).not.toMatch(/label="Enviado no mês"/);
  });

  it('o rótulo é "Pedido inativo" / "Inativar pedido" / "Reativar pedido" — nunca "Inativo" sozinho', () => {
    expect(DETALHE).toContain('Pedido inativo');
    expect(DETALHE).toContain('Inativar pedido');
    expect(DETALHE).toContain('Reativar pedido');
    expect(LISTA).toContain('Pedido inativo');
    for (const fonte of [DETALHE, LISTA]) {
      expect(fonte).not.toMatch(/>\s*Inativo\s*</);
      expect(fonte).not.toMatch(/['"]Inativo['"]/);
    }
    // Nada de nome de pessoa no que foi escrito agora: o diálogo fala do financeiro.
    expect(ler('apps/web/src/components/comercial/InativarPedido.tsx')).not.toMatch(/Larissa/);
  });

  it('o detalhe atualiza o cache do aparelho ao inativar — é ele que alimenta a meta do representante', () => {
    expect(DETALHE).toMatch(/db\.orders\s*\.update\(id,\s*\{\s*inactive/);
  });

  it('a loja não vê o carimbo na lista (o detalhe já escondia) e, no cancelado, ele some das duas telas', () => {
    // A lista: só quem não é loja, e só pela regra de PEDIDO (status + carimbo)
    // — a mesma do detalhe. Antes o cartão mostrava "Pedido inativo" para a
    // loja e o detalhe do mesmo pedido escondia tudo dela.
    expect(LISTA).toMatch(/\{!ehLoja && exibeCarimboInativo\(order\) && <Badge variant="gray">Pedido inativo<\/Badge>\}/);
    // O detalhe: o selo ao lado do faturado e o bloco com o botão de reativar
    // passam pela mesma função; nenhum dos dois olha `order.inactive` sozinho.
    expect(DETALHE).toMatch(/\{exibeCarimboInativo\(order\) && <Badge variant="gray">Pedido inativo<\/Badge>\}/);
    expect(DETALHE).toMatch(/\{exibeCarimboInativo\(order\) && !ehLoja && \(/);
    for (const fonte of [LISTA, DETALHE]) {
      expect(fonte).not.toMatch(/\{order\.inactive && (!ehLoja && )?<Badge/);
      expect(fonte).not.toMatch(/\{order\.inactive && !ehLoja && \(/);
    }
  });
});
