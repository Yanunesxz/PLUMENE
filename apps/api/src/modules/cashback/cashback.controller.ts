import type { FastifyReply, FastifyRequest } from 'fastify';
import { z } from 'zod';
import { veAreaDeCashback } from '@csb/shared';
import { parseBody } from '../../lib/validation.js';
import {
  CashbackSemMigracao,
  cashbackDoPedido,
  desfazerUsoDeCashback,
  extratoDoCliente,
  listarClientesComCashback,
  usarCashback,
  type Quem,
} from './cashback.service.js';

/**
 * As rotas da área Cashback (058). Todo erro de banco vira 503 com uma frase:
 * saldo é dinheiro, e "deu pau, mostra zero" seria mentira.
 */

const SEM_MIGRACAO = {
  error: 'A migração 058 (cashback) ainda não rodou neste banco.',
  code: 'MIGRACAO_PENDENTE',
  statusCode: 503,
} as const;

const BANCO_INDISPONIVEL = {
  error: 'Não deu para ler o cashback agora. Tente de novo em instantes.',
  code: 'BANCO_INDISPONIVEL',
  statusCode: 503,
} as const;

const SO_VENDA_INTERNA = {
  error: 'O cashback é da venda interna.',
  code: 'FORBIDDEN',
  statusCode: 403,
} as const;

function quem(request: FastifyRequest): Quem {
  return {
    id: request.user.sub,
    role: request.user.role,
    venda_interna: request.user.venda_interna === true,
    nome: request.user.name,
  };
}

/** Corre a leitura/escrita e traduz a falta da 058 e o banco sem resposta. */
async function comGuarda(request: FastifyRequest, reply: FastifyReply, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof CashbackSemMigracao) {
      await reply.status(503).send(SEM_MIGRACAO);
      return;
    }
    request.log.error({ err }, 'cashback sem resposta do banco');
    await reply.status(503).send(BANCO_INDISPONIVEL);
  }
}

/** A guarda da área: o representante comum não entra (o requireRole deixa o papel passar). */
async function exigirArea(request: FastifyRequest, reply: FastifyReply): Promise<boolean> {
  if (veAreaDeCashback(request.user.role, request.user.venda_interna === true)) return true;
  await reply.status(403).send(SO_VENDA_INTERNA);
  return false;
}

/** GET /cashback/clientes — todo cliente com cashback e o saldo de agora. */
export async function listarHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await exigirArea(request, reply))) return;
  await comGuarda(request, reply, async () => {
    const r = await listarClientesComCashback(request.user.company_id);
    await reply.send({ data: r });
  });
}

/** GET /cashback/clientes/:id — o extrato de um cliente. */
export async function extratoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await exigirArea(request, reply))) return;
  const { id } = request.params as { id: string };
  await comGuarda(request, reply, async () => {
    const r = await extratoDoCliente(request.user.company_id, id);
    if (!r.cliente) {
      await reply.status(404).send({ error: 'Cliente não encontrado', code: 'NOT_FOUND', statusCode: 404 });
      return;
    }
    await reply.send({ data: r });
  });
}

/** GET /cashback/meu — a loja vê o próprio cashback (Minha área). */
export async function meuHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const customer_id = request.user.customer_id;
  if (!customer_id) {
    await reply.status(403).send({ error: 'Login sem cliente.', code: 'FORBIDDEN', statusCode: 403 });
    return;
  }
  await comGuarda(request, reply, async () => {
    const r = await extratoDoCliente(request.user.company_id, customer_id);
    await reply.send({ data: r });
  });
}

/** GET /cashback/pedidos/:id — o cartão de cashback na tela do pedido. */
export async function pedidoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  if (!(await exigirArea(request, reply))) return;
  const { id } = request.params as { id: string };
  await comGuarda(request, reply, async () => {
    const r = await cashbackDoPedido(id, request.user.company_id, quem(request));
    if (!r) {
      await reply.status(404).send({ error: 'Pedido não encontrado', code: 'NOT_FOUND', statusCode: 404 });
      return;
    }
    await reply.send({ data: r });
  });
}

const usarSchema = z.object({
  valor: z
    .number({ invalid_type_error: 'Informe o valor do cashback' })
    .positive('O valor do cashback precisa ser maior que zero')
    .max(10_000_000, 'Valor fora do normal'),
});

const RECUSAS: Record<string, { status: number; error: string }> = {
  not_found: { status: 404, error: 'Pedido não encontrado' },
  sem_permissao: { status: 403, error: 'Só a venda interna (ou o financeiro) usa o cashback neste pedido.' },
  pedido_fechado: { status: 409, error: 'Este pedido não aceita mais mudança na observação.' },
  sem_cliente: { status: 409, error: 'Pedido sem cliente não tem cashback.' },
  sem_saldo: { status: 409, error: 'O cliente não tem cashback disponível.' },
  ja_usado: { status: 409, error: 'Este pedido já tem cashback usado. Desfaça antes de usar outro valor.' },
  acima_do_saldo: { status: 409, error: 'O valor passa do cashback disponível do cliente.' },
  acima_do_total: { status: 409, error: 'O valor passa do total do pedido.' },
  sem_uso: { status: 409, error: 'Este pedido não tem cashback usado.' },
  falhou: { status: 503, error: 'Não deu para gravar agora. Tente de novo em instantes.' },
};

async function recusar(reply: FastifyReply, reason: string): Promise<void> {
  const r = RECUSAS[reason] ?? { status: 400, error: 'Não deu para usar o cashback.' };
  await reply.status(r.status).send({ error: r.error, code: reason.toUpperCase(), statusCode: r.status });
}

/** POST /cashback/pedidos/:id/uso { valor } — abate no pedido e escreve na observação. */
export async function usarHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  const body = await parseBody(usarSchema, request.body, reply);
  if (!body) return;
  await comGuarda(request, reply, async () => {
    const r = await usarCashback(id, request.user.company_id, quem(request), body.valor);
    if (!r.ok) {
      await recusar(reply, r.reason);
      return;
    }
    await reply.status(201).send({ data: { uso: r.uso, notes: r.notes } });
  });
}

/** DELETE /cashback/pedidos/:id/uso — desfaz: tira a linha e devolve o saldo. */
export async function desfazerHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const { id } = request.params as { id: string };
  await comGuarda(request, reply, async () => {
    const r = await desfazerUsoDeCashback(id, request.user.company_id, quem(request));
    if (!r.ok) {
      await recusar(reply, r.reason);
      return;
    }
    await reply.send({ data: { notes: r.notes } });
  });
}
