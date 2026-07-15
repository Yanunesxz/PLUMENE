/**
 * Autenticação da API de Parceiro (integração ERP externa).
 *
 * Parceiros (fábricas/ERPs) autenticam com uma chave fixa no header
 * `X-API-Key`. As chaves ficam na env PARTNER_API_KEYS como JSON:
 *   [{"name":"corposensual","key":"<hex>","company_id":"<uuid>"}]
 *
 * Cada chave é amarrada a uma empresa — o parceiro só enxerga os dados dela.
 */
import { timingSafeEqual } from 'node:crypto';
import type { FastifyRequest, FastifyReply } from 'fastify';

export interface Partner {
  name: string;
  key: string;
  company_id: string;
}

let cachedPartners: Partner[] | null = null;

function loadPartners(): Partner[] {
  if (cachedPartners) return cachedPartners;
  const raw = process.env['PARTNER_API_KEYS'];
  if (!raw) {
    cachedPartners = [];
    return cachedPartners;
  }
  try {
    const parsed = JSON.parse(raw) as Partner[];
    cachedPartners = parsed.filter((p) => p.name && p.key && p.company_id);
  } catch {
    console.error('[Partner] PARTNER_API_KEYS não é um JSON válido — API de parceiro desabilitada');
    cachedPartners = [];
  }
  return cachedPartners;
}

function safeEquals(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

/**
 * Valida o X-API-Key e retorna o parceiro. Responde 401/503 e retorna null
 * quando inválido — o handler deve encerrar nesse caso.
 */
export async function requirePartner(
  request: FastifyRequest,
  reply: FastifyReply,
): Promise<Partner | null> {
  const partners = loadPartners();
  if (partners.length === 0) {
    await reply.status(503).send({
      error: 'API de parceiro não configurada',
      code: 'PARTNER_API_DISABLED',
      statusCode: 503,
    });
    return null;
  }

  const key = request.headers['x-api-key'];
  const partner =
    typeof key === 'string' ? partners.find((p) => safeEquals(p.key, key)) : undefined;

  if (!partner) {
    await reply.status(401).send({
      error: 'Chave de API inválida ou ausente (header X-API-Key)',
      code: 'PARTNER_UNAUTHORIZED',
      statusCode: 401,
    });
    return null;
  }
  return partner;
}
