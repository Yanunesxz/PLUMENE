/**
 * POST /partner/v1/retrato — o Control manda o retrato do cliente
 * (última compra, total comprado, vencido, pendência financeira, títulos
 * vencidos), com a referência de quando é. Ver partner.retrato.service.ts.
 *
 * Exige o canal de retrato em 'api' (409 CANAL_FECHADO). Corpo
 * `{ "retrato": [...] }`, `{ "dados": [...] }` ou a lista pura; máximo de
 * 1000 por requisição.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { anotarChamada } from './partner.chamada.js';
import { autenticar, lerLote, recusouPorCanal } from './partner.porta.js';
import { receberRetrato, type RetratoParceiro } from './partner.retrato.service.js';

export async function partnerRetratoHandler(request: FastifyRequest, reply: FastifyReply): Promise<void> {
  const partner = await autenticar(request, reply);
  if (!partner) return;
  if (await recusouPorCanal(request, reply, partner.company_id, 'retrato')) return;

  const lista = await lerLote<RetratoParceiro>(request, reply, 'retrato', 'clientes');
  if (!lista) return;

  const resultado = await receberRetrato(partner.company_id, lista);
  anotarChamada(request, {
    recebidos: resultado.recebidos,
    gravados: resultado.atualizados,
    sem_mudanca: resultado.sem_mudanca,
    ignorados: resultado.ignorados.length,
    detalhe: {
      // Só a referência (código ou CNPJ, mascarado pelo registro) e o motivo.
      ignorados: resultado.ignorados.map((i) => ({ referencia: i.cliente, motivo: i.motivo })),
      ...(resultado.avisos.length > 0 ? { avisos: resultado.avisos.length } : {}),
    },
  });
  await reply.send({ ok: true, ...resultado, servidor_hora: new Date().toISOString() });
}
