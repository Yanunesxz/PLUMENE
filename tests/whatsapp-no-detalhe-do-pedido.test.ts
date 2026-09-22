import { describe, it, expect, vi, beforeEach } from 'vitest';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';
import {
  situacaoDoWhatsapp,
  mensagemDaCopiaAoRepresentante,
  linkDoWhatsApp,
} from '../apps/web/src/lib/pedido.js';

/**
 * Os botões do WhatsApp no detalhe do pedido (Yan, 22/09/2026):
 *
 *   "às vezes abre o privado, às vezes pede pra selecionar um cliente"
 *
 * O "Enviar pedido para o cliente" lia o número da cópia da carteira no
 * aparelho; cliente fora dela saía sem número. Agora o GET /orders/:id traz o
 * WhatsApp do CADASTRO — e o telefone do representante, para a "cópia ao
 * representante", que NÃO vai para o login da loja.
 */

const EMPRESA = 'empresa-1';
const REP = 'rep-1';
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts
const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto.createHmac('sha256', SEGREDO).update(`${cabecalho}.${corpo}`).digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const token = (extra: Record<string, unknown>) =>
  assinar({ sub: 'quem-olha', email: 'x@csb.com', company_id: EMPRESA, name: 'X', price_table_id: 't1', ...extra });

const PEDIDO = { id: 'o1', order_number: 14639, rep_id: REP, customer_id: 'c1', items: [] };

async function detalhe(
  respostas: Record<string, unknown>,
  extraDoToken: Record<string, unknown>,
  pedido: Record<string, unknown> = PEDIDO,
) {
  vi.resetModules();
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  vi.doMock('../apps/api/src/modules/orders/orders.service.js', async (importar) => ({
    ...(await importar<Record<string, unknown>>()),
    getOrderById: vi.fn(async () => pedido),
  }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  const res = await app.inject({
    method: 'GET',
    url: '/orders/o1',
    headers: { authorization: `Bearer ${token(extraDoToken)}` },
  });
  await app.close();
  return { res, fake, dados: (res.json() as { data: Record<string, unknown> }).data };
}

beforeEach(() => {
  vi.resetModules();
});

describe('GET /orders/:id — os números dos botões do WhatsApp', { timeout: 20_000 }, () => {
  it('traz o WhatsApp do CADASTRO do cliente e o telefone do representante para o escritório', async () => {
    const { res, fake, dados } = await detalhe(
      {
        users: { data: { name: 'WELINGTHON NATAL SOARES', erp_rep_id: '05194', phone: '32 99911-2233' }, error: null },
        customers: { data: { whatsapp: '(32) 98888-7777' }, error: null },
      },
      { role: 'financeiro' },
    );
    expect(res.statusCode).toBe(200);
    expect(dados['customer_whatsapp']).toBe('(32) 98888-7777');
    expect(dados['rep_info']).toEqual({ name: 'WELINGTHON NATAL SOARES', erp_rep_id: '05194', phone: '32 99911-2233' });
    // O cliente é lido DENTRO da empresa de quem pede.
    const porEmpresa = fake.filtrosDe('customers', 'eq').find((f) => f.args[0] === 'company_id');
    expect(porEmpresa?.args[1]).toBe(EMPRESA);
  });

  it('o login da loja não recebe o telefone do representante (nem pede a coluna)', async () => {
    const { res, fake, dados } = await detalhe(
      {
        users: { data: { name: 'WELINGTHON NATAL SOARES', erp_rep_id: '05194' }, error: null },
        customers: { data: { whatsapp: '(32) 98888-7777' }, error: null },
      },
      { role: 'store', customer_id: 'c1' },
    );
    expect(res.statusCode).toBe(200);
    expect((dados['rep_info'] as Record<string, unknown>)['phone']).toBeUndefined();
    const colunas = fake.filtrosDe('users', 'select')[0]?.args[0];
    expect(String(colunas)).not.toContain('phone');
  });

  it('cliente sem WhatsApp no cadastro vem como null — a tela avisa, não inventa', async () => {
    const { dados } = await detalhe(
      { users: { data: { name: 'REP', erp_rep_id: null, phone: null }, error: null }, customers: { data: { whatsapp: null }, error: null } },
      { role: 'admin' },
    );
    expect(dados['customer_whatsapp']).toBeNull();
  });

  it('sem resposta do cadastro, o campo NÃO vem — a tela usa a cópia do aparelho em vez de dizer "sem WhatsApp"', async () => {
    const { res, dados } = await detalhe(
      {
        users: { data: { name: 'REP', erp_rep_id: null, phone: null }, error: null },
        customers: { data: null, error: { message: 'timeout' } },
      },
      { role: 'admin' },
    );
    expect(res.statusCode).toBe(200);
    expect('customer_whatsapp' in dados).toBe(false);
  });

  it('pedido de vitrine (sem cliente cadastrado) não consulta o cadastro', async () => {
    const { fake, dados } = await detalhe(
      { users: { data: { name: 'REP', erp_rep_id: null, phone: null }, error: null } },
      { role: 'admin' },
      { ...PEDIDO, customer_id: null, guest_whatsapp: '32999990000' },
    );
    expect(fake.filtrosDe('customers').length).toBe(0);
    expect('customer_whatsapp' in dados).toBe(false);
  });
});

describe('o que o botão do WhatsApp vai fazer com o número', () => {
  it('DDD + linha abre a conversa, com ou sem o 55', () => {
    expect(situacaoDoWhatsapp('(32) 98888-7777')).toBe('ok');
    expect(situacaoDoWhatsapp('(11) 1734-0709')).toBe('ok');
    expect(situacaoDoWhatsapp('+55 32 98888-7777')).toBe('ok');
  });

  it('sem número o WhatsApp pede o contato — a tela avisa antes', () => {
    expect(situacaoDoWhatsapp(null)).toBe('sem');
    expect(situacaoDoWhatsapp('')).toBe('sem');
    expect(situacaoDoWhatsapp('  ')).toBe('sem');
  });

  it('número sem DDD ou faltando dígito é "incompleto" (os casos reais da base)', () => {
    expect(situacaoDoWhatsapp('12360633')).toBe('incompleto');
    expect(situacaoDoWhatsapp('12*3622275')).toBe('incompleto');
    expect(situacaoDoWhatsapp('2136-1800')).toBe('incompleto');
    expect(situacaoDoWhatsapp('MANUELA')).toBe('sem');
  });
});

describe('a cópia do pedido para o representante', () => {
  it('chama pelo primeiro nome e leva número, cliente, marca e o link público', () => {
    const texto = mensagemDaCopiaAoRepresentante({
      representante: 'WELINGTHON NATAL SOARES',
      numero: 14639,
      cliente: 'SUPER CASA PRESENTES LTDA',
      marca: 'Corpo Sensual',
      link: 'https://app.com/pedido/abc.def',
    });
    expect(texto).toBe(
      'Olá, Welingthon! Segue a cópia do pedido #14639 de SUPER CASA PRESENTES LTDA (Corpo Sensual): https://app.com/pedido/abc.def',
    );
    // O link vai inteiro e codificado no wa.me.
    expect(linkDoWhatsApp('32 99911-2233', texto)).toContain(encodeURIComponent('https://app.com/pedido/abc.def'));
    expect(linkDoWhatsApp('32 99911-2233', texto).startsWith('https://wa.me/5532999112233?text=')).toBe(true);
  });

  it('sem nome nem número não sai "Olá, !" nem "#"', () => {
    const texto = mensagemDaCopiaAoRepresentante({
      representante: null,
      numero: null,
      cliente: 'LOJA',
      marca: 'Plumene',
      link: 'https://x/p/1',
    });
    expect(texto).toBe('Olá! Segue a cópia do pedido de LOJA (Plumene): https://x/p/1');
  });
});
