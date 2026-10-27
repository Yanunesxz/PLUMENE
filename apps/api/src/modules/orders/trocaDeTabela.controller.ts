import type { FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { parseBody } from '../../lib/validation.js';
import { avisarTabelaTrocadaAoRep } from '../push/push.avisos.js';
import { listPriceTables } from '../reps/reps.service.js';
import { supabase } from '../../config/supabase.js';
import { tabelaEstaAtiva } from '@csb/shared';
import { trocarTabelaDoPedido } from './orders.service.js';

const trocarSchema = z.object({
  price_table_id: z.string().uuid(),
  simular: z.boolean().optional(),
});

const RESPOSTAS = {
  not_found: { status: 404, error: 'Pedido não encontrado', code: 'NOT_FOUND' },
  tabela_nao_encontrada: { status: 404, error: 'Tabela de preço não encontrada', code: 'TABELA_NAO_ENCONTRADA' },
  tabela_inativa: {
    status: 409,
    error: 'Essa tabela foi desligada no Control — escolha uma tabela ativa',
    code: 'TABELA_INATIVA',
  },
  sem_coluna: {
    status: 503,
    error: 'O banco ainda não guarda a tabela do pedido (migração 025)',
    code: 'MIGRACAO_PENDENTE',
  },
  price_not_found: {
    status: 409,
    error: 'Alguma peça do pedido não tem preço nessa tabela — nada foi alterado',
    code: 'PRECO_NAO_ENCONTRADO',
  },
  save_failed: { status: 500, error: 'Não foi possível trocar a tabela — nada foi alterado', code: 'UPDATE_FAILED' },
  original_nao_guardado: {
    status: 503,
    error: 'Não deu para guardar a cópia do pedido original — tente de novo',
    code: 'ORIGINAL_NAO_GUARDADO',
  },
  faturado: { status: 409, error: 'Pedido faturado não troca de tabela — a nota já saiu', code: 'PEDIDO_FATURADO' },
  cancelado: { status: 409, error: 'Pedido cancelado não troca de tabela', code: 'PEDIDO_CANCELADO' },
  ja_lancado: {
    status: 409,
    error: 'O financeiro já lançou o pedido no Control — agora quem troca a tabela é o financeiro',
    code: 'JA_LANCADO',
  },
  forbidden: { status: 403, error: 'Você não pode trocar a tabela deste pedido', code: 'FORBIDDEN' },
} as const;

/** PATCH /orders/:id/tabela { price_table_id, simular? } */
export async function trocarTabelaHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, sub, role, venda_interna } = request.user;
  const { id } = request.params as { id: string };
  const body = await parseBody(trocarSchema, request.body, reply);
  if (!body) return;

  // A tabela nova: da empresa de quem pede e ATIVA no Control.
  const { data: tabela } = await supabase
    .from('price_tables')
    .select('*')
    .eq('id', body.price_table_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!tabela) {
    const resp = RESPOSTAS.tabela_nao_encontrada;
    await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
    return;
  }
  if (!tabelaEstaAtiva(tabela as { active?: boolean | null })) {
    const resp = RESPOSTAS.tabela_inativa;
    await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
    return;
  }

  const r = await trocarTabelaDoPedido(
    id,
    company_id,
    { id: sub, role, venda_interna: venda_interna === true },
    body.price_table_id,
    body.simular === true,
  );
  if (!r.ok) {
    const resp = RESPOSTAS[r.reason];
    await reply.status(resp.status).send({ error: resp.error, code: resp.code, statusCode: resp.status });
    return;
  }

  // Quem não é o dono trocou: o representante fica sabendo (o push é carona).
  if (r.mudou && r.order.rep_id !== sub) {
    avisarTabelaTrocadaAoRep(
      company_id,
      r.order,
      (tabela as { name?: string }).name ?? 'outra tabela',
      r.total_depois,
      sub,
    );
  }
  await reply.send({
    data: r.order,
    meta: {
      tabela_antes: r.tabela_antes,
      tabela_depois: r.tabela_depois,
      total_antes: r.total_antes,
      total_depois: r.total_depois,
      mudou: r.mudou,
      ja_no_control: r.ja_no_control,
    },
  });
}

/**
 * GET /orders/tabelas-para-trocar — as tabelas ATIVAS da empresa, para o
 * seletor. Só quem pode trocar: financeiro e admin, e a venda interna (que
 * escolhe entre todas as ativas — o representante comum não vê esta lista).
 */
export async function tabelasParaTrocarHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { company_id, role, venda_interna } = request.user;
  if (role === 'rep' && venda_interna !== true) {
    await reply.status(403).send({
      error: 'Só a venda interna troca a tabela do pedido',
      code: 'FORBIDDEN',
      statusCode: 403,
    });
    return;
  }
  const tabelas = await listPriceTables(company_id, { incluirInativas: false });
  await reply.send({ data: tabelas });
}
