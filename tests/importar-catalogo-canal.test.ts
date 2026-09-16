import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { criarSupabaseFake, type RespostaTabela } from './supabaseFake.js';

/**
 * A importação de catálogo por planilha (POST /products/import) respeita o
 * canal de catálogo (048) — revisão de 16/09/2026.
 *
 * Com `canal_catalogo = 'api'` o Control manda tabelas, produtos, preço e
 * estoque e SOBRESCREVE (decisão 6). A planilha regravava `product_prices.price`
 * e as variantes por cima: dois escritores no mesmo fluxo, e a próxima carga
 * desfazia o preço do Control. O que fica trancado:
 *
 *   1. canal em 'api' (ou qualquer um que não seja 'carga'): 409 CANAL_FECHADO,
 *      sem chamar a importação;
 *   2. canal 'carga', ou banco sem a 048: importa como sempre;
 *   3. banco que não respondeu sobre o canal: 503 CANAL_INDISPONIVEL, nada importado.
 *
 * Dados fictícios de propósito.
 */

const EMPRESA = 'empresa-1';
const SUPABASE = '../apps/api/src/config/supabase.js';
const SERVICO = '../apps/api/src/modules/catalog/import.service.js';
const CONTROLLER = '../apps/api/src/modules/catalog/import.controller.js';

const ENCHIMENTO: RespostaTabela = { data: [], error: null };
const SONDA_OK: RespostaTabela = { data: [{ canal_pedido_erp: 'manual' }], error: null };
const SEM_048: RespostaTabela = {
  data: null,
  error: { code: '42703', message: 'column companies.canal_pedido_erp does not exist' },
};

const canais = (catalogo: string): RespostaTabela => ({
  data: {
    canal_pedido_erp: 'manual',
    canal_faturamento: 'manual',
    canal_cadastro: 'carga',
    canal_retrato: 'carga',
    canal_catalogo: catalogo,
  },
  error: null,
});

const CORPO = { products: [{ sku: '0706', name: 'PRODUTO TESTE', price: 10 }] };

function replyFalso() {
  const enviado: { status: number; corpo: unknown } = { status: 200, corpo: undefined };
  const reply = {
    status(codigo: number) {
      enviado.status = codigo;
      return reply;
    },
    send(corpo: unknown) {
      enviado.corpo = corpo;
      return Promise.resolve();
    },
  };
  return { reply: reply as unknown as FastifyReply, enviado };
}

const requisicao = () =>
  ({
    body: CORPO,
    user: { company_id: EMPRESA },
    log: { error: () => undefined },
  }) as unknown as FastifyRequest;

async function carregar(companies: RespostaTabela[]) {
  const fake = criarSupabaseFake({ companies });
  vi.doMock(SUPABASE, () => ({ supabase: fake.cliente }));
  const importProducts = vi.fn().mockResolvedValue({ products_created: 1 });
  vi.doMock(SERVICO, () => ({ importProducts }));
  const controller = await import(CONTROLLER);
  return { ...controller, importProducts, fake };
}

beforeEach(() => {
  vi.resetModules();
});
afterEach(() => {
  vi.doUnmock(SUPABASE);
  vi.doUnmock(SERVICO);
});

describe('POST /products/import — o canal de catálogo', () => {
  it.each([['api'], ['firebird']])('canal %s: 409 CANAL_FECHADO e a planilha não é importada', async (valor) => {
    const { importProductsHandler, importProducts } = await carregar([SONDA_OK, ENCHIMENTO, canais(valor)]);
    const { reply, enviado } = replyFalso();

    await importProductsHandler(requisicao(), reply);

    expect(enviado.status).toBe(409);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_FECHADO', statusCode: 409, canal: 'catalogo', valor_atual: valor });
    expect(importProducts).not.toHaveBeenCalled();
  });

  it('canal carga, e banco sem a 048: importa como sempre', async () => {
    const carga = await carregar([SONDA_OK, ENCHIMENTO, canais('carga')]);
    const r1 = replyFalso();
    await carga.importProductsHandler(requisicao(), r1.reply);
    expect(r1.enviado.status).toBe(200);
    expect(carga.importProducts).toHaveBeenCalledWith(EMPRESA, CORPO.products);

    vi.resetModules();
    const sem048 = await carregar([SEM_048]);
    const r2 = replyFalso();
    await sem048.importProductsHandler(requisicao(), r2.reply);
    expect(r2.enviado.status).toBe(200);
    expect(sem048.importProducts).toHaveBeenCalled();
  });

  it('banco sem resposta sobre o canal: 503 CANAL_INDISPONIVEL e nada importado', async () => {
    const { importProductsHandler, importProducts } = await carregar([
      { data: null, error: { code: '503', message: 'service unavailable' } },
    ]);
    const { reply, enviado } = replyFalso();

    await importProductsHandler(requisicao(), reply);

    expect(enviado.status).toBe(503);
    expect(enviado.corpo).toMatchObject({ code: 'CANAL_INDISPONIVEL' });
    expect(importProducts).not.toHaveBeenCalled();
  });
});
