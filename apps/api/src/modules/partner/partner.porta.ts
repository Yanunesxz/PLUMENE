/**
 * A PORTA das rotas do parceiro — o que todo handler faz antes do trabalho:
 * validar a chave, conferir o canal, ler o corpo, anotar o registro.
 *
 * Um lugar só, usado por partner.controller.ts, partner.cadastros.controller.ts,
 * partner.catalogo.controller.ts, partner.retrato.controller.ts e
 * partner.sincronizacao.controller.ts. Antes de 16/09/2026 cada arquivo tinha
 * a sua cópia; uma mudança na ordem das checagens (chave → canal → corpo) tinha
 * de ser feita em três lugares.
 */
import type { FastifyReply, FastifyRequest } from 'fastify';
import { requirePartner, type Partner } from './partner.auth.js';
import { anotarChamada } from './partner.chamada.js';
import { corpoCanalFechado, exigirCanal, type NomeDoCanal, type ValorDoCanal } from '../../lib/canais.js';

/**
 * Máximo por requisição nas rotas de lote. Mantém o corpo bem abaixo do limite
 * de 1 MB do Fastify; o parceiro divide em lotes (a spec recomenda 500). Passar
 * disso é 400, não um 413 críptico no meio do envio.
 */
export const MAX_POR_LOTE = 1000;

/**
 * Momento com fuso: `2026-09-15T13:00:00Z` ou `...-03:00`. Sem fuso, o mesmo
 * texto é uma hora no Railway (UTC) e outra no ERP (Brasília).
 */
const MOMENTO_COM_FUSO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d{1,6})?)?(Z|[+-]\d{2}:?\d{2})$/i;

export function momentoComFuso(v: string): boolean {
  return MOMENTO_COM_FUSO.test(v) && !Number.isNaN(Date.parse(v));
}

/**
 * Aceita `{ <chave>: [...] }` (uma ou mais chaves aceitas), `{ dados: [...] }`
 * ou a lista pura no corpo.
 */
export function extrairLista<T>(body: unknown, chave: string | readonly string[]): T[] | null {
  if (Array.isArray(body)) return body as T[];
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const chaves = typeof chave === 'string' ? [chave] : chave;
    for (const nome of [...chaves, 'dados']) {
      const lista = obj[nome];
      if (Array.isArray(lista)) return lista as T[];
    }
  }
  return null;
}

/** Valida a chave e deixa anotado de quem ela é, para o registro da chamada. */
export async function autenticar(request: FastifyRequest, reply: FastifyReply): Promise<Partner | null> {
  const partner = await requirePartner(request, reply);
  // Recusada na porta (401/503): o `code` entra no registro pelo montarChamada,
  // porque a resposta já saiu quando o `requirePartner` volta.
  if (partner) anotarChamada(request, { company_id: partner.company_id, parceiro: partner.name });
  return partner;
}

/** Responde e anota o `code` da resposta no registro da chamada. */
export async function responder(
  request: FastifyRequest,
  reply: FastifyReply,
  status: number,
  corpo: Record<string, unknown>,
): Promise<void> {
  if (typeof corpo['code'] === 'string') anotarChamada(request, { detalhe: { code: corpo['code'] } });
  await reply.status(status).send(corpo);
}

/**
 * O canal da empresa está ligado para a API? Se não, responde 409 CANAL_FECHADO
 * e devolve true (o handler encerra). Erro ao ler o canal sobe (500): um
 * soluço do banco não abre nem fecha canal.
 */
export async function recusouPorCanal(
  request: FastifyRequest,
  reply: FastifyReply,
  company_id: string,
  canal: NomeDoCanal,
): Promise<boolean> {
  // 'api' é valor válido nos cinco canais.
  const recusa = await exigirCanal(company_id, canal, 'api' as ValorDoCanal<typeof canal>);
  if (!recusa) return false;
  const corpo = corpoCanalFechado(recusa);
  anotarChamada(request, { detalhe: { canal: recusa.canal, valor_atual: recusa.valor_atual } });
  await responder(request, reply, 409, corpo);
  return true;
}

/**
 * Anota as contagens de uma rota de lote (faturamento, clientes, catálogo…) a
 * partir do que o service devolveu. Lê os campos com tolerância: cada service
 * tem os seus contadores (`criados`/`atualizados`, `sem_mudanca`/`inalterados`).
 */
export function anotarLote(request: FastifyRequest, resultado: object): void {
  const r = resultado as Record<string, unknown>;
  const numero = (chave: string): number | undefined => {
    const v = r[chave];
    return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
  };
  const ignorados = Array.isArray(r['ignorados']) ? (r['ignorados'] as unknown[]) : [];
  const avisos = Array.isArray(r['avisos']) ? r['avisos'].length : undefined;
  anotarChamada(request, {
    recebidos: numero('recebidos'),
    gravados: (numero('criados') ?? 0) + (numero('atualizados') ?? 0),
    sem_mudanca: numero('sem_mudanca') ?? numero('inalterados'),
    ignorados: ignorados.length,
    detalhe: {
      // Só a referência e o motivo de cada ignorado — nada do registro.
      ignorados: ignorados.map((i) => {
        const item = (i && typeof i === 'object' ? i : {}) as Record<string, unknown>;
        return {
          referencia:
            item['pedido'] ?? item['codigo'] ?? item['pedido_erp'] ?? item['cliente'] ?? item['id'] ?? null,
          motivo: item['motivo'] ?? null,
        };
      }),
      ...(avisos === undefined ? {} : { avisos }),
    },
  });
}

/**
 * O `desde` da query: `undefined` quando não veio, o texto quando é um momento
 * com fuso, `null` quando veio errado (o handler responde 400 INVALID_DESDE).
 */
export function lerDesde(query: unknown): string | null | undefined {
  const bruto = query && typeof query === 'object' ? (query as { desde?: unknown }).desde : undefined;
  if (bruto === undefined || bruto === null) return undefined;
  if (typeof bruto !== 'string') return null;
  const desde = bruto.trim();
  if (desde === '') return undefined;
  return momentoComFuso(desde) ? desde : null;
}

export const CORPO_DESDE_INVALIDO = {
  error: 'Parâmetro "desde" deve ser uma data ISO com fuso (ex.: 2026-09-15T00:00:00Z ou 2026-09-15T00:00:00-03:00)',
  code: 'INVALID_DESDE',
  statusCode: 400,
};

export const CORPO_NAO_ENCONTRADO = {
  error: 'Pedido não encontrado',
  code: 'ORDER_NOT_FOUND',
  statusCode: 404,
};

export const CORPO_ERRO_INTERNO = {
  error: 'Erro interno do servidor',
  code: 'INTERNAL_ERROR',
  statusCode: 500,
};

/**
 * As checagens comuns de um POST de lista: corpo no formato (400 INVALID_BODY)
 * e tamanho (400 BATCH_TOO_LARGE). Devolve a lista, ou `null` depois de
 * responder.
 */
export async function lerLote<T>(
  request: FastifyRequest,
  reply: FastifyReply,
  chave: string | readonly string[],
  nome: string,
): Promise<T[] | null> {
  const primeira = typeof chave === 'string' ? chave : chave[0];
  const lista = extrairLista<T>(request.body, chave);
  if (!lista) {
    await responder(request, reply, 400, {
      error: `Envie { "${primeira}": [...] } ou uma lista no corpo`,
      code: 'INVALID_BODY',
      statusCode: 400,
    });
    return null;
  }
  if (lista.length > MAX_POR_LOTE) {
    anotarChamada(request, { recebidos: lista.length });
    await responder(request, reply, 400, {
      error: `Máximo ${MAX_POR_LOTE} ${nome} por requisição — divida em lotes (recomendado 500)`,
      code: 'BATCH_TOO_LARGE',
      statusCode: 400,
    });
    return null;
  }
  return lista;
}
