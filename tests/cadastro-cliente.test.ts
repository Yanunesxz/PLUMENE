import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  cpfValido,
  cnpjValido,
  documento,
  formatarDocumento,
  cepValido,
  formatarCep,
  ufValida,
  linhaDeEndereco,
} from '@csb/shared';
import crypto from 'node:crypto';
import { criarSupabaseFake } from './supabaseFake.js';

/**
 * O cadastro "mais real" (Yan, 10/09/2026): CPF/CNPJ com dígito verificador,
 * endereço com CEP obrigatório, duplicidade por documento recusada, e o
 * número do cliente no Control atrelado pelo financeiro. As regras moram em
 * packages/shared (front e API usam a MESMA) e no service de clientes.
 */

describe('CPF e CNPJ de verdade', () => {
  it('confere o dígito verificador, com ou sem máscara', () => {
    expect(cpfValido('529.982.247-25')).toBe(true);
    expect(cpfValido('52998224725')).toBe(true);
    expect(cpfValido('529.982.247-26')).toBe(false); // último dígito trocado
    expect(cnpjValido('11.222.333/0001-81')).toBe(true);
    expect(cnpjValido('11222333000181')).toBe(true);
    expect(cnpjValido('11.222.333/0001-82')).toBe(false);
  });

  it('sequência repetida passa no módulo 11 e é lixo mesmo assim', () => {
    expect(cpfValido('111.111.111-11')).toBe(false);
    expect(cnpjValido('00.000.000/0000-00')).toBe(false);
  });

  it('o que o app aceitava antes (só contagem) agora é recusado', () => {
    // fixture antiga de teste: 14 dígitos, DV errado
    expect(documento('12345678000199')).toBeNull();
    expect(documento('22.518.613/0001-58')).toEqual({ tipo: 'cnpj', digitos: '22518613000158' });
    expect(documento('529.982.247-25')).toEqual({ tipo: 'cpf', digitos: '52998224725' });
  });

  it('formata para a tela e devolve intacto o que não é documento', () => {
    expect(formatarDocumento('22518613000158')).toBe('22.518.613/0001-58');
    expect(formatarDocumento('52998224725')).toBe('529.982.247-25');
    expect(formatarDocumento('abc')).toBe('abc');
  });
});

describe('endereço como o Control pede', () => {
  it('CEP são 8 números — e não tudo igual', () => {
    expect(cepValido('36000-000')).toBe(true);
    expect(cepValido('36000000')).toBe(true);
    expect(cepValido('3600-000')).toBe(false);
    expect(cepValido('00000000')).toBe(false);
    expect(formatarCep('36000000')).toBe('36000-000');
  });

  it('UF é uma das 27', () => {
    expect(ufValida('mg')).toBe(true);
    expect(ufValida('XX')).toBe(false);
    expect(ufValida('')).toBe(false);
  });

  it('a linha única sai no MESMO formato que a API do parceiro monta', () => {
    expect(
      linhaDeEndereco({
        logradouro: 'Rua das Flores',
        numero: '123',
        complemento: 'Sala 2',
        bairro: 'Centro',
        cidade: 'Juiz de Fora',
        uf: 'mg',
        cep: '36000000',
      }),
    ).toBe('Rua das Flores, 123 Sala 2 - Centro - Juiz de Fora/MG - CEP 36000-000');
    expect(linhaDeEndereco({ logradouro: 'Av. Brasil', numero: '10' })).toBe('Av. Brasil, 10');
  });
});

// ─── O schema da rota: o que obriga e o que não ───────────────────────────────
describe('schema do cadastro pelo app', () => {
  const valido = {
    name: 'LOJA NOVA LTDA',
    cnpj: '11.222.333/0001-81',
    cep: '36000-000',
    logradouro: 'Rua das Flores',
    numero: '123',
    bairro: 'Centro',
    cidade: 'Juiz de Fora',
    uf: 'MG',
  };

  it('aceita o cadastro completo e recusa cada obrigatório faltando', async () => {
    const { createCustomerSchema } = await import('../apps/api/src/modules/customers/customers.schema.js');
    expect(createCustomerSchema.safeParse(valido).success).toBe(true);
    for (const campo of ['cep', 'logradouro', 'numero', 'bairro', 'cidade', 'uf'] as const) {
      const sem = { ...valido, [campo]: '' };
      expect(createCustomerSchema.safeParse(sem).success, `${campo} vazio deveria falhar`).toBe(false);
    }
  });

  it('documento com dígito errado é recusado com mensagem clara', async () => {
    const { createCustomerSchema } = await import('../apps/api/src/modules/customers/customers.schema.js');
    const r = createCustomerSchema.safeParse({ ...valido, cnpj: '11.222.333/0001-82' });
    expect(r.success).toBe(false);
    if (!r.success) expect(r.error.issues[0]?.message).toContain('inválido');
  });

  it('complemento, IE, WhatsApp, e-mail e observações seguem opcionais', async () => {
    const { createCustomerSchema } = await import('../apps/api/src/modules/customers/customers.schema.js');
    expect(createCustomerSchema.safeParse({ ...valido, complemento: '', inscricao_estadual: null, whatsapp: '', email: null }).success).toBe(true);
    expect(createCustomerSchema.safeParse({ ...valido, whatsapp: '123' }).success).toBe(false);
  });
});

// ─── O service: duplicidade e o número do Control ─────────────────────────────
const EMPRESA = 'empresa-1';

async function carregarServico(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const mod = await import('../apps/api/src/modules/customers/customers.service.js');
  return { ...mod, fake };
}

beforeEach(() => {
  vi.resetModules();
});

// O app de verdade, para conferir o que a ROTA responde — o service sozinho
// não sabe quem está perguntando, e é disso que depende o 409 desta tela.
const SEGREDO = 'segredo-de-teste-nao-usar-em-producao'; // igual ao tests/setup.ts

const b64 = (o: unknown) => Buffer.from(JSON.stringify(o)).toString('base64url');

function assinar(payload: Record<string, unknown>): string {
  const cabecalho = b64({ alg: 'HS256', typ: 'JWT' });
  const agora = Math.floor(Date.now() / 1000);
  const corpo = b64({ ...payload, iat: agora, exp: agora + 3600 });
  const assinatura = crypto
    .createHmac('sha256', SEGREDO)
    .update(`${cabecalho}.${corpo}`)
    .digest('base64url');
  return `${cabecalho}.${corpo}.${assinatura}`;
}

const TOKEN_REP = assinar({
  sub: 'rep-1',
  email: 'rep@csb.com',
  company_id: EMPRESA,
  name: 'SIMONE',
  role: 'rep',
  price_table_id: 'tabela-1',
});

async function subirApp(respostas: Record<string, unknown>) {
  const fake = criarSupabaseFake(respostas as never);
  vi.doMock('../apps/api/src/config/supabase.js', () => ({ supabase: fake.cliente }));
  const { buildApp } = await import('../apps/api/src/app.js');
  const app = await buildApp();
  await app.ready();
  return { app, fake };
}


describe('createCustomer — o cadastro real', () => {
  const body = {
    name: 'LOJA NOVA LTDA',
    cnpj: '11.222.333/0001-81',
    cep: '36000-000',
    logradouro: 'Rua das Flores',
    numero: '123',
    bairro: 'Centro',
    cidade: 'Juiz de Fora',
    uf: 'mg',
  };

  it('recusa documento que já está na base, dizendo de quem é', async () => {
    const { createCustomer } = await carregarServico({
      customers: [
        { data: [], error: null }, // detecção da 041: coluna cep existe
        { data: [{ id: 'c-velho', name: 'LOJA ANTIGA', erp_id: '05836' }], error: null }, // já tem o CNPJ
      ],
    });
    const r = await createCustomer(EMPRESA, 'rep-1', body, 'tabela-1');
    expect(r).toEqual({ duplicado: { id: 'c-velho', name: 'LOJA ANTIGA', erp_id: '05836' } });
  });

  it('grava o documento só em dígitos, o endereço em campos E a linha montada', async () => {
    const { createCustomer, fake } = await carregarServico({
      customers: [
        { data: [], error: null }, // 041 presente
        { data: [], error: null }, // ninguém com este CNPJ
        { data: { id: 'c-novo', name: 'LOJA NOVA LTDA' }, error: null },
      ],
    });
    const r = await createCustomer(EMPRESA, 'rep-1', body, 'tabela-1');
    expect('id' in r && r.id).toBe('c-novo');
    const gravado = fake.ultimaGravacao('customers', 'insert')?.valores as Record<string, unknown>;
    expect(gravado.cnpj).toBe('11222333000181');
    expect(gravado.cep).toBe('36000000');
    expect(gravado.uf).toBe('MG');
    expect(gravado.address).toBe('Rua das Flores, 123 - Centro - Juiz de Fora/MG - CEP 36000-000');
    expect(gravado.erp_id).toBeUndefined(); // nasce sem código do Control
  });

  it('sem a migração 041 aplicada, grava só a linha — não derruba o cadastro', async () => {
    const { createCustomer, fake } = await carregarServico({
      customers: [
        { data: null, error: { message: 'column customers.cep does not exist' } }, // sem 041
        { data: [], error: null },
        { data: { id: 'c-novo', name: 'LOJA NOVA LTDA' }, error: null },
      ],
    });
    await createCustomer(EMPRESA, 'rep-1', body, 'tabela-1');
    const gravado = fake.ultimaGravacao('customers', 'insert')?.valores as Record<string, unknown>;
    expect(gravado.address).toContain('Juiz de Fora/MG');
    expect(gravado).not.toHaveProperty('cep');
  });
});

describe('atrelar o número do Control (financeiro)', () => {
  it('normaliza "#2225", "2225" e "02225" para "02225"', async () => {
    const { normalizarCodigoErp } = await carregarServico({});
    expect(normalizarCodigoErp('#2225')).toBe('02225');
    expect(normalizarCodigoErp('2225')).toBe('02225');
    expect(normalizarCodigoErp('02225')).toBe('02225');
    expect(normalizarCodigoErp('')).toBeNull();
    expect(normalizarCodigoErp('000')).toBeNull();
    expect(normalizarCodigoErp('123456')).toBeNull();
  });

  it('código com LETRA é recusado, não tem a letra jogada fora', async () => {
    const { normalizarCodigoErp } = await carregarServico({});
    // Os 1.350 códigos da CS são cinco dígitos. Se um dia alguém digitar
    // "C0001", virar "00001" em silêncio atrelaria o cliente ao cadastro
    // errado — e só o faturamento descobriria.
    expect(normalizarCodigoErp('C0001')).toBeNull();
    expect(normalizarCodigoErp('2225A')).toBeNull();
  });

  it('grava o código normalizado em cliente SEM código, com quem e quando', async () => {
    const { atrelarCodigoErp, fake } = await carregarServico({
      customers: [
        { data: { id: 'c1', erp_id: null }, error: null }, // o alvo
        { data: [], error: null }, // ninguém com este código
        { data: [], error: null }, // 041 presente
        { data: null, error: null }, // update
      ],
    });
    const r = await atrelarCodigoErp(EMPRESA, 'c1', '#2225', 'fin-1');
    expect(r).toEqual({ ok: true, erp_id: '02225' });
    const gravado = fake.ultimaGravacao('customers', 'update')?.valores as Record<string, unknown>;
    expect(gravado.erp_id).toBe('02225');
    expect(gravado.erp_linked_by).toBe('fin-1');
  });

  it('recusa código que já é de outro cliente, em qualquer grafia', async () => {
    const { atrelarCodigoErp } = await carregarServico({
      customers: [
        { data: { id: 'c1', erp_id: null }, error: null },
        { data: [{ id: 'c-outro', name: 'OUTRA LOJA' }], error: null },
      ],
    });
    const r = await atrelarCodigoErp(EMPRESA, 'c1', '2225', 'fin-1');
    expect(r).toEqual({ ok: false, motivo: 'codigo_em_uso', detalhe: 'OUTRA LOJA' });
  });

  it('cliente que veio do ERP já tem código — quem muda é o Control', async () => {
    const { atrelarCodigoErp } = await carregarServico({
      customers: [{ data: { id: 'c1', erp_id: '05836' }, error: null }],
    });
    const r = await atrelarCodigoErp(EMPRESA, 'c1', '1', 'fin-1');
    expect(r).toEqual({ ok: false, motivo: 'ja_tem_codigo' });
  });
});

/**
 * O 409 de documento repetido, visto de fora (pela rota).
 *
 * O representante só enxerga a carteira dele. Quando o CNPJ que ele digitou já
 * é de um cliente de OUTRA carteira, dizer o nome não o ajuda (ele não vai
 * achar o cadastro) e entrega a loja do colega. O escritório, que é quem vai
 * procurar, continua recebendo o nome e o código.
 */
describe('POST /customers — o duplicado de outra carteira', () => {
  const CORPO = {
    name: 'LOJA NOVA LTDA',
    cnpj: '11.222.333/0001-81',
    cep: '36000-000',
    logradouro: 'Rua das Flores',
    numero: '123',
    bairro: 'Centro',
    cidade: 'Juiz de Fora',
    uf: 'MG',
  };

  const respostas = (dono: string | null) => ({
    users: { data: { id: 'rep-1', price_table_id: 'tabela-1' }, error: null },
    rep_price_tables: { data: [], error: null },
    customers: [
      { data: [], error: null }, // detecção da 041
      { data: [{ id: 'c-velho', name: 'LOJA DO COLEGA', erp_id: '05836', rep_id: dono }], error: null },
    ],
  });

  it('não diz de quem é quando o cliente está fora da carteira do representante', async () => {
    const { app } = await subirApp(respostas('rep-2'));
    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: CORPO,
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    const corpo = res.json() as { error: string };
    expect(corpo.error).not.toContain('LOJA DO COLEGA');
    expect(corpo.error).not.toContain('05836');
    expect(corpo.error).toContain('outra carteira');
  });

  it('diz o nome e o código quando o cliente É da carteira dele — aí ele acha', async () => {
    const { app } = await subirApp(respostas('rep-1'));
    const res = await app.inject({
      method: 'POST',
      url: '/customers',
      headers: { authorization: `Bearer ${TOKEN_REP}` },
      payload: CORPO,
    });
    await app.close();

    expect(res.statusCode).toBe(409);
    expect((res.json() as { error: string }).error).toContain('LOJA DO COLEGA');
  });
});
