/**
 * O RESUMO DE CADA CHAMADA DO PARCEIRO, montado durante a requisição.
 *
 * O registro em `erp_sync_log` (partner.log.ts) é gravado por UM lugar só: o
 * hook `onResponse` do `partnerRouter`, depois que a resposta saiu. O hook sabe
 * a rota, o método e o status HTTP; o que ele não sabe — de quem é a chave,
 * quantos registros chegaram, quantos gravaram, por que um foi ignorado — o
 * handler deixa anotado em `request.partnerLog` com `anotarChamada`.
 *
 * Chamada que morre antes da anotação (401, 503, 429, exceção no meio) grava
 * mesmo assim, com o que houver: `company_id` e `parceiro` nulos quando a chave
 * não passou. A exceção é a requisição SEM chave nenhuma (`vaiParaOLog`): essa
 * não vira linha no banco.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import type { ChamadaDoParceiro } from './partner.log.js';

export interface ResumoDaChamada {
  company_id?: string | null | undefined;
  parceiro?: string | null | undefined;
  /** Quando a requisição chegou (ISO com fuso). Anotado no `onRequest`. */
  started_at?: string | null | undefined;
  recebidos?: number | null | undefined;
  gravados?: number | null | undefined;
  sem_mudanca?: number | null | undefined;
  ignorados?: number | null | undefined;
  /** Só códigos, contagens e motivos — nunca dado de cliente nem a chave. */
  detalhe?: Record<string, unknown> | null | undefined;
}

declare module 'fastify' {
  interface FastifyRequest {
    /** O resumo desta chamada do parceiro (ver partner.chamada.ts). */
    partnerLog?: ResumoDaChamada | null;
  }
}

/**
 * Acrescenta ao resumo da chamada. Chaves de `detalhe` se somam às que já
 * estavam (a de canal fechado não apaga a do início, por exemplo).
 */
export function anotarChamada(request: FastifyRequest, parcial: ResumoDaChamada): void {
  const atual = request.partnerLog ?? {};
  const detalhe =
    parcial.detalhe === undefined
      ? atual.detalhe
      : parcial.detalhe === null
        ? null
        : { ...(atual.detalhe ?? {}), ...parcial.detalhe };
  request.partnerLog = { ...atual, ...parcial, detalhe };
}

/** O PADRÃO da rota ('/partner/v1/pedidos/:id/confirmar'), nunca a URL com o id. */
function rotaDaRequisicao(request: FastifyRequest): string {
  const padrao = (request as { routeOptions?: { url?: string } }).routeOptions?.url;
  if (typeof padrao === 'string' && padrao) return padrao;
  // Sem rota casada não há padrão; a URL sem query string é o melhor que há.
  return String(request.url ?? '').split('?')[0] ?? '';
}

/** O `code` das recusas do `requirePartner` (partner.auth.ts). */
const PORTA: Partial<Record<number, string>> = {
  401: 'PARTNER_UNAUTHORIZED',
  503: 'PARTNER_API_DISABLED',
};

/**
 * Esta chamada merece uma linha em `erp_sync_log`?
 *
 * Requisição que nem mandou o header `X-API-Key` é varredura de robô: as URLs
 * de produção estão numa página pública, e registrar cada batida daria a
 * qualquer um do mundo uma escrita no banco — a tabela que o Yan e o Fábio leem
 * para diagnosticar o Control ficaria afogada em ruído.
 *
 * Chave ERRADA continua registrada: aí alguém está tentando usar a API, e é
 * exatamente o que interessa ver.
 */
export function vaiParaOLog(request: FastifyRequest): boolean {
  if (typeof request.headers['x-api-key'] === 'string' && request.headers['x-api-key'].length > 0) return true;
  // Sem header, só entra o que já se identificou por outro caminho (nunca hoje).
  return Boolean(request.partnerLog?.company_id);
}

/** O que o hook `onResponse` manda para `registrarChamada`. */
export function montarChamada(request: FastifyRequest, reply: FastifyReply): ChamadaDoParceiro {
  const resumo = request.partnerLog ?? {};
  let detalhe = resumo.detalhe;
  // Recusada na porta (a chave não passou): o `requirePartner` responde antes de
  // o handler poder anotar, então o porquê é deduzido do status aqui.
  const codigoDaPorta = PORTA[reply.statusCode];
  if (!resumo.company_id && codigoDaPorta && typeof detalhe?.['code'] !== 'string') {
    detalhe = { ...(detalhe ?? {}), code: codigoDaPorta };
  }
  return {
    company_id: resumo.company_id ?? null,
    parceiro: resumo.parceiro ?? null,
    rota: rotaDaRequisicao(request),
    metodo: request.method,
    http_status: reply.statusCode,
    recebidos: resumo.recebidos,
    gravados: resumo.gravados,
    sem_mudanca: resumo.sem_mudanca,
    ignorados: resumo.ignorados,
    detalhe,
    started_at: resumo.started_at,
  };
}
