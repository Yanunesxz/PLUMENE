import type { FastifyRequest, FastifyReply } from 'fastify';
import {
  getCustomers,
  createCustomer,
  atualizarTabelaDoCliente,
  obterCliente,
  marcarInatividade,
} from './customers.service.js';
import { z } from 'zod';
import { resolverTabelaEscolhida } from '../reps/reps.service.js';
import { parseBody } from '../../lib/validation.js';
import { createCustomerSchema, trocarTabelaDoClienteSchema } from './customers.schema.js';

const inatividadeSchema = z.object({
  motivo: z.string().trim().min(2).max(200),
  observacao: z.string().trim().max(2000).optional(),
});

export async function listCustomers(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { search, include_blocked } = request.query as {
    search?: string;
    include_blocked?: string;
  };

  const customers = await getCustomers(
    company_id,
    role,
    rep_id,
    search,
    include_blocked !== 'false',
    erp_rep_id,
  );
  await reply.send({ data: customers });
}

/**
 * A ficha de um cliente: cadastro, tabela e histórico.
 *
 * 404 tanto para cliente inexistente quanto para cliente de outra carteira —
 * distinguir os dois contaria ao representante que a loja existe e é de outro.
 */
export async function getCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };

  const cliente = await obterCliente(company_id, id, {
    rep_id,
    erp_rep_id: erp_rep_id ?? null,
    irrestrito:
      role === 'manager' || role === 'admin' || role === 'financeiro' || role === 'relacionamento',
  });

  if (!cliente) {
    await reply.status(404).send({
      error: 'Cliente não encontrado na sua carteira',
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    return;
  }
  await reply.send({ data: cliente });
}

/**
 * Traduz a recusa do resolvedor em resposta.
 *
 * O 403 não diz se a tabela existe: quem pediu uma tabela que não é dele está
 * chamando a API por fora da tela, e a resposta não é lugar de confirmar que a
 * tabela da região vizinha existe.
 */
async function recusarTabela(
  reply: FastifyReply,
  motivo: 'fora_do_conjunto' | 'escolha_obrigatoria',
): Promise<void> {
  if (motivo === 'escolha_obrigatoria') {
    await reply.status(400).send({
      error: 'Escolha a tabela de preço.',
      code: 'PRICE_TABLE_REQUIRED',
      statusCode: 400,
    });
    return;
  }
  await reply.status(403).send({
    error: 'Esta tabela de preço não está disponível para você.',
    code: 'FORBIDDEN',
    statusCode: 403,
  });
}

export async function createCustomerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub: rep_id, role } = request.user;
  const body = await parseBody(createCustomerSchema, request.body, reply);
  if (!body) return;

  const tabela = await resolverTabelaEscolhida(company_id, rep_id, role, body.price_table_id);
  if (!tabela.ok) {
    await recusarTabela(reply, tabela.motivo);
    return;
  }

  const customer = await createCustomer(
    company_id,
    rep_id,
    {
      name: body.name,
      trade_name: body.trade_name ?? null,
      cnpj: body.cnpj ?? null,
      whatsapp: body.whatsapp ?? null,
      email: body.email ?? null,
      address: body.address ?? null,
    },
    tabela.price_table_id,
  );
  if ('erro' in customer) {
    await reply.status(500).send({
      error: `Não foi possível criar o cliente: ${customer.erro}`,
      code: 'CREATE_FAILED',
      statusCode: 500,
    });
    return;
  }
  await reply.status(201).send({ data: customer });
}

/**
 * Troca a tabela de preço de um cliente que já existe — a maioria veio do ERP
 * com a tabela dele, e é aqui que o representante corrige.
 *
 * Duas travas independentes: a tabela pedida é do conjunto dele, e o cliente é
 * da carteira dele. Passar em uma só não basta.
 */
export async function trocarTabelaDoClienteHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(trocarTabelaDoClienteSchema, request.body, reply);
  if (!body) return;

  const tabela = await resolverTabelaEscolhida(company_id, rep_id, role, body.price_table_id);
  if (!tabela.ok) {
    await recusarTabela(reply, tabela.motivo);
    return;
  }
  // O schema exige o campo, então o resolvedor nunca devolve null aqui.
  if (!tabela.price_table_id) {
    await recusarTabela(reply, 'fora_do_conjunto');
    return;
  }

  const resultado = await atualizarTabelaDoCliente(company_id, id, tabela.price_table_id, {
    rep_id,
    erp_rep_id: erp_rep_id ?? null,
    irrestrito: role === 'manager' || role === 'admin' || role === 'financeiro',
  });

  if (!resultado.ok) {
    if (resultado.motivo === 'cliente_nao_encontrado') {
      await reply.status(404).send({
        error: 'Cliente não encontrado na sua carteira',
        code: 'NOT_FOUND',
        statusCode: 404,
      });
      return;
    }
    await reply.status(500).send({
      error: 'Não foi possível trocar a tabela',
      code: 'UPDATE_FAILED',
      statusCode: 500,
    });
    return;
  }

  await reply.send({ data: resultado.cliente });
}

/** O porquê do cliente vermelho: motivo + observação de quem apurou. */
export async function marcarInatividadeHandler(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const { company_id, sub: rep_id, role, erp_rep_id } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(inatividadeSchema, request.body, reply);
  if (!body) return;

  const r = await marcarInatividade(
    company_id,
    id,
    {
      rep_id,
      erp_rep_id: erp_rep_id ?? null,
      // O rep explica os clientes DELE; relacionamento e gerência, qualquer um.
      irrestrito: role === 'manager' || role === 'admin' || role === 'relacionamento',
    },
    rep_id,
    body,
  );

  if (r.ok) {
    await reply.send({ data: { ok: true } });
    return;
  }
  if (r.motivo === 'sem_migracao') {
    await reply.status(503).send({
      error: 'O controle de inatividade precisa da migração 039',
      code: 'INATIVIDADE_INDISPONIVEL',
      statusCode: 503,
    });
    return;
  }
  if (r.motivo === 'cliente_nao_encontrado') {
    await reply.status(404).send({
      error: 'Cliente não encontrado na sua carteira',
      code: 'NOT_FOUND',
      statusCode: 404,
    });
    return;
  }
  await reply.status(500).send({
    error: 'Não foi possível salvar o motivo',
    code: 'UPDATE_FAILED',
    statusCode: 500,
  });
}
