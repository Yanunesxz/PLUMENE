/**
 * As cinco rotas do CATÁLOGO na API de Parceiro (decisão 6, 16/09/2026):
 *
 *   POST /partner/v1/tabelas-preco         (a) tabelas de preço
 *   POST /partner/v1/condicoes-pagamento   (b) condições de pagamento
 *   POST /partner/v1/produtos              (c) produtos e tamanhos
 *   POST /partner/v1/precos                (d) preço por tabela
 *   POST /partner/v1/estoque               (e) estoque por tamanho
 *
 * Todas exigem `companies.canal_catalogo = 'api'` (409 CANAL_FECHADO se não),
 * aceitam `{ <nome>: [...] }`, `{ dados: [...] }` ou a lista pura no corpo,
 * no máximo 1000 registros, e respondem `{ ok, recebidos, criados,
 * atualizados, sem_mudanca, ignorados, avisos, servidor_hora }`. O trabalho
 * está em partner.catalogo.service.ts; aqui é só porta, canal e registro
 * (a porta em si — chave, canal, corpo, registro — mora em partner.porta.ts).
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import {
  receberCondicoesDePagamento,
  receberEstoque,
  receberPrecos,
  receberProdutos,
  receberTabelasDePreco,
  type ResultadoCatalogo,
} from './partner.catalogo.service.js';
import { anotarLote, autenticar, lerLote, recusouPorCanal } from './partner.porta.js';

interface RotaDeLote {
  /** As chaves aceitas no corpo (além de `dados`). A primeira vai na mensagem de erro. */
  chaves: readonly [string, ...string[]];
  /** Como a mensagem de erro chama os registros ("tabelas de preço"). */
  nome: string;
  receber: (company_id: string, lista: readonly unknown[]) => Promise<ResultadoCatalogo>;
}

/**
 * O esqueleto comum: chave, canal, corpo, tamanho do lote, serviço, registro.
 * Cada rota só diz qual chave aceita e qual serviço chama.
 */
function rotaDeLote(rota: RotaDeLote) {
  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const partner = await autenticar(request, reply);
    if (!partner) return;
    if (await recusouPorCanal(request, reply, partner.company_id, 'catalogo')) return;

    const lista = await lerLote<unknown>(request, reply, rota.chaves, rota.nome);
    if (!lista) return;

    const resultado = await rota.receber(partner.company_id, lista);
    anotarLote(request, resultado);
    await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
  };
}

/** POST /partner/v1/tabelas-preco — o Control manda as tabelas de preço. */
export const partnerTabelasPrecoHandler = rotaDeLote({
  chaves: ['tabelas_preco', 'tabelas'],
  nome: 'tabelas de preço',
  receber: receberTabelasDePreco,
});

/** POST /partner/v1/condicoes-pagamento — o Control manda as condições de pagamento. */
export const partnerCondicoesPagamentoHandler = rotaDeLote({
  chaves: ['condicoes_pagamento', 'condicoes'],
  nome: 'condições de pagamento',
  receber: receberCondicoesDePagamento,
});

/** POST /partner/v1/produtos — o Control manda os produtos e a grade de tamanhos. */
export const partnerProdutosHandler = rotaDeLote({
  chaves: ['produtos'],
  nome: 'produtos',
  receber: receberProdutos,
});

/** POST /partner/v1/precos — o Control manda o preço de cada produto em cada tabela. */
export const partnerPrecosHandler = rotaDeLote({
  chaves: ['precos'],
  nome: 'preços',
  receber: receberPrecos,
});

/** POST /partner/v1/estoque — o Control manda o estoque por tamanho. */
export const partnerEstoqueHandler = rotaDeLote({
  chaves: ['estoque'],
  nome: 'itens de estoque',
  receber: receberEstoque,
});
