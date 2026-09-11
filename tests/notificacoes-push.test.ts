import { describe, it, expect, vi, beforeEach } from 'vitest';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * Notificações push — o aviso que chega com o app fechado.
 *
 * O que estes testes trancam:
 *  • sem as chaves VAPID, NADA é enviado e nada quebra (push é carona);
 *  • aparelho morto (410 do navegador) é APAGADO no envio — a lista não
 *    acumula endereço furado;
 *  • o aviso de decisão não vai para quem decidiu o próprio pedido (venda
 *    interna aprovando a própria venda não apita para ela mesma).
 */

const EMPRESA = 'empresa-1';

const enviadas: Array<{ endpoint: string; corpo: string }> = [];
let falharCom: number | null = null;

async function carregar(
  respostas: Parameters<typeof criarSupabaseFake>[0],
  chaves = { publica: 'chave-pub', privada: 'chave-priv' },
) {
  vi.resetModules();
  enviadas.length = 0;
  const fake = criarSupabaseFake(respostas);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  vi.doMock('../apps/api/src/config/env.js', () => ({
    env: {
      VAPID_PUBLIC_KEY: chaves.publica,
      VAPID_PRIVATE_KEY: chaves.privada,
      VAPID_SUBJECT: 'mailto:teste@teste.local',
    },
  }));
  const webpushFalso = {
    setVapidDetails: vi.fn(),
    sendNotification: vi.fn(async (assinatura: { endpoint: string }, corpo: string) => {
      if (falharCom !== null) {
        const erro = new Error('falhou') as Error & { statusCode: number };
        erro.statusCode = falharCom;
        throw erro;
      }
      enviadas.push({ endpoint: assinatura.endpoint, corpo });
    }),
  };
  vi.doMock('../apps/api/src/modules/push/webpush.js', () => ({ webpush: webpushFalso }));
  const service = await import('../apps/api/src/modules/push/push.service.js');
  const avisos = await import('../apps/api/src/modules/push/push.avisos.js');
  return { service, avisos, fake };
}

beforeEach(() => {
  vi.resetModules();
  falharCom = null;
});

const LINHA = { endpoint: 'https://push/abc', p256dh: 'p', auth: 'a' };

describe('enviarParaUsuarios', () => {
  it('cifra e envia o aviso para cada aparelho do usuário', async () => {
    const { service } = await carregar({
      push_subscriptions: { data: [LINHA], error: null },
    });
    const n = await service.enviarParaUsuarios(EMPRESA, ['u1'], {
      title: 'Pedido #1 faturado',
      body: 'A nota saiu.',
      url: '/orders/1',
    });
    expect(n).toBe(1);
    expect(enviadas[0]?.endpoint).toBe('https://push/abc');
    expect(JSON.parse(enviadas[0]!.corpo).title).toBe('Pedido #1 faturado');
  });

  it('sem as chaves VAPID não envia nada — e não quebra', async () => {
    const { service } = await carregar(
      { push_subscriptions: { data: [LINHA], error: null } },
      { publica: '', privada: '' },
    );
    const n = await service.enviarParaUsuarios(EMPRESA, ['u1'], {
      title: 'x',
      body: 'y',
      url: '/',
    });
    expect(n).toBe(0);
    expect(enviadas).toHaveLength(0);
  });

  it('aparelho morto (410) é apagado e o resto não é derrubado', async () => {
    falharCom = 410;
    const { service, fake } = await carregar({
      push_subscriptions: [
        // O dublê pré-busca a resposta seguinte a cada from(): a sonda
        // "a tabela existe?" consome as DUAS primeiras entradas.
        { data: [], error: null },
        { data: [], error: null },
        { data: [LINHA], error: null }, // select das assinaturas (fica p/ delete tb)
      ],
    });
    const n = await service.enviarParaUsuarios(EMPRESA, ['u1'], {
      title: 'x',
      body: 'y',
      url: '/',
    });
    expect(n).toBe(0);
    const gravacao = fake.ultimaGravacao('push_subscriptions', 'delete');
    expect(gravacao).toBeTruthy();
  });
});

describe('resolverPublico — quem recebe o aviso manual', () => {
  it('lojas_compraram: só as lojas cujos clientes fizeram pedido no período', async () => {
    const { service, fake } = await carregar({
      orders: { data: [{ customer_id: 'cli-1' }, { customer_id: 'cli-1' }, { customer_id: 'cli-2' }], error: null },
      users: { data: [{ id: 'loja-1' }, { id: 'loja-2' }], error: null },
    });
    const ids = await service.resolverPublico(EMPRESA, 'lojas_compraram', 90);
    expect(ids).toEqual(['loja-1', 'loja-2']);
    // o filtro de papel foi aplicado na consulta de usuários
    const filtroDePapel = fake
      .filtrosDe('users', 'eq')
      .some((f) => f.args[0] === 'role' && f.args[1] === 'store');
    expect(filtroDePapel).toBe(true);
  });

  it('reps: só o papel rep entra na consulta', async () => {
    const { service, fake } = await carregar({
      users: { data: [{ id: 'rep-1' }], error: null },
    });
    const ids = await service.resolverPublico(EMPRESA, 'reps');
    expect(ids).toEqual(['rep-1']);
    const filtro = fake.filtrosDe('users', 'in').find((f) => f.args[0] === 'role');
    expect(filtro?.args[1]).toEqual(['rep']);
  });

  it('escritorio: só gerência e financeiro — nem admin, nem rep, nem loja', async () => {
    const { service, fake } = await carregar({
      users: { data: [{ id: 'fabian' }, { id: 'fin-1' }], error: null },
    });
    const ids = await service.resolverPublico(EMPRESA, 'escritorio');
    expect(ids).toEqual(['fabian', 'fin-1']);
    const filtro = fake.filtrosDe('users', 'in').find((f) => f.args[0] === 'role');
    expect(filtro?.args[1]).toEqual(['manager', 'financeiro']);
  });
});

describe('avisos do fluxo', () => {
  it('quem decide o PRÓPRIO pedido não recebe aviso da própria decisão', async () => {
    const { avisos } = await carregar({
      push_subscriptions: { data: [LINHA], error: null },
    });
    avisos.avisarDecisaoAoRep(EMPRESA, { id: 'p1', order_number: 10, rep_id: 'u1' }, true, 'u1');
    // fire-and-forget: dá um tique para qualquer envio indevido aparecer
    await new Promise((r) => setTimeout(r, 10));
    expect(enviadas).toHaveLength(0);
  });

  it('a decisão da fábrica chega no dono do pedido', async () => {
    const { avisos } = await carregar({
      push_subscriptions: { data: [LINHA], error: null },
    });
    avisos.avisarDecisaoAoRep(EMPRESA, { id: 'p1', order_number: 10, rep_id: 'u1' }, true, 'gerente');
    await new Promise((r) => setTimeout(r, 10));
    expect(enviadas).toHaveLength(1);
    expect(JSON.parse(enviadas[0]!.corpo).title).toContain('#10');
  });
});

/**
 * O aviso para uma LISTA escolhida na mão (Yan, 11/09/2026): "cria uma forma
 * que eu possa escolher mandar notificação apenas para alguns clientes, e
 * colocar apenas uma lista tipo CNPJ".
 */
describe('publicoPorDocumentos', () => {
  it('acha os clientes pelo documento e devolve as contas de loja deles', async () => {
    const { service } = await carregar({
      customers: {
        data: [
          { id: 'c1', cnpj: '22.518.613/0001-58', cnpj_digits: '22518613000158' },
          { id: 'c2', cnpj: '11222333000181', cnpj_digits: '11222333000181' },
        ],
        error: null,
      },
      users: { data: [{ id: 'loja-1', customer_id: 'c1' }], error: null },
    });

    const r = await service.publicoPorDocumentos(EMPRESA, ['22.518.613/0001-58', '11222333000181']);

    expect(r.usuarios).toEqual(['loja-1']);
    // c2 existe mas ainda não tem conta no app — e isso é DITO, não engolido.
    expect(r.clientesSemConta).toBe(1);
    expect(r.naoEncontrados).toEqual([]);
  });

  it('documento que não é de nenhum cliente volta escrito, em vez de sumir', async () => {
    const { service } = await carregar({
      customers: { data: [], error: null },
      users: { data: [], error: null },
    });

    const r = await service.publicoPorDocumentos(EMPRESA, ['11222333000181']);

    expect(r.usuarios).toEqual([]);
    expect(r.naoEncontrados).toEqual(['11222333000181']);
  });

  it('lista vazia (ou só lixo) não vira consulta ao banco', async () => {
    const { service, fake } = await carregar({ customers: { data: [], error: null } });

    const r = await service.publicoPorDocumentos(EMPRESA, ['123', 'abc', '']);

    expect(r).toEqual({ usuarios: [], naoEncontrados: [], clientesSemConta: 0 });
    expect(fake.filtrosDe('customers')).toHaveLength(0);
  });
});
