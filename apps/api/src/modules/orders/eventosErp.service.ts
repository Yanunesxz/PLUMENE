import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';

/**
 * O RASTRO DO PEDIDO COM O CONTROL (migração 048, C e D).
 *
 * O número do Control tem quatro escritores (lançar na tela, corrigir na tela,
 * API de parceiro, sync.py) e o faturado tem três. Quando um pedido aparece com
 * o número errado, ou faturado sem ninguém ter faturado, a pergunta é sempre a
 * mesma: quem gravou, por onde e quando. Até aqui a resposta não existia.
 *
 * Duas peças:
 *   • `gravarOrigemDoNumero` — no próprio UPDATE que grava erp_order_id, diz a
 *     origem (erp_order_source/set_at/set_by). Fica no pedido, é o "de onde veio".
 *   • `registrarEventoErp` — uma linha em order_erp_events por acontecimento.
 *     Acumula e sobrevive à exclusão do pedido. É o "o que aconteceu".
 *
 * As duas sobem antes do SQL: sem a 048, a origem não entra no update (o update
 * fica igual ao de hoje) e o evento não é gravado. E o evento NUNCA derruba
 * quem chamou — o acontecimento em si (o número, o faturado) já foi gravado.
 */

/**
 * Os tipos aceitos pelo CHECK de order_erp_events.tipo. A lista da 048 e esta
 * precisam ser as mesmas (tests/migracao-048.test.ts confere).
 */
export const TIPOS_DE_EVENTO_ERP = [
  'numero_gravado',
  'numero_corrigido',
  'numero_conciliado',
  'faturado',
  'faturamento_alterado',
  'faturamento_desfeito',
  'nota_registrada',
  'nota_cancelada',
  'excluido',
  'recusado_pelo_erp',
  'alterado_antes_da_confirmacao',
] as const;
export type TipoEventoErp = (typeof TIPOS_DE_EVENTO_ERP)[number];

/** Por onde o acontecimento entrou (CHECK de order_erp_events.origem). */
export const ORIGENS_DE_EVENTO_ERP = ['api', 'tela', 'script', 'sync_py'] as const;
export type OrigemEventoErp = (typeof ORIGENS_DE_EVENTO_ERP)[number];

/** De onde veio o número do Control (CHECK de orders.erp_order_source). */
export const ORIGENS_DO_NUMERO = ['api', 'lancamento', 'correcao', 'conciliacao', 'sync_py'] as const;
export type OrigemDoNumero = (typeof ORIGENS_DO_NUMERO)[number];

/**
 * O que pode ir em `antes` e `depois`: só o estado do pedido com o Control e
 * da nota. Qualquer outra chave é descartada — dado de cliente não entra no
 * rastro nem por descuido de quem chamou.
 */
export const CAMPOS_DO_RASTRO = [
  'erp_order_id',
  'status',
  'invoiced',
  'invoiced_at',
  'invoiced_total',
  'numero',
  'serie',
  'chave',
  'emitida_em',
  'valor',
  'cancelada_em',
  'pecas',
] as const;

export interface EventoErp {
  company_id: string;
  order_id: string;
  order_number?: number | null | undefined;
  tipo: TipoEventoErp;
  origem: OrigemEventoErp;
  /** Nome do parceiro da chave, quando veio pela API. */
  parceiro?: string | null | undefined;
  /** Usuário do app, quando veio pela tela. */
  por?: string | null | undefined;
  por_nome?: string | null | undefined;
  motivo?: string | null | undefined;
  antes?: Record<string, unknown> | null | undefined;
  depois?: Record<string, unknown> | null | undefined;
}

function soCamposDoRastro(v: Record<string, unknown> | null | undefined): Record<string, unknown> | null {
  if (v == null) return null;
  const saida: Record<string, unknown> = {};
  for (const campo of CAMPOS_DO_RASTRO) {
    if (Object.prototype.hasOwnProperty.call(v, campo)) saida[campo] = v[campo] ?? null;
  }
  return saida;
}

/**
 * Grava um acontecimento em order_erp_events. Nunca lança.
 *
 * 'gravado' | 'sem_tabela' (048 ausente, ou o banco não respondeu sobre ela) |
 * 'falhou' (o banco recusou; fica no console). Quem chama não precisa olhar.
 */
export async function registrarEventoErp(evento: EventoErp): Promise<'gravado' | 'sem_tabela' | 'falhou'> {
  try {
    if (!(await detectar('order_erp_events', 'id'))) return 'sem_tabela';

    const agora = new Date().toISOString();
    const { error } = await supabase.from('order_erp_events').insert({
      company_id: evento.company_id,
      order_id: evento.order_id,
      order_number: evento.order_number ?? null,
      tipo: evento.tipo,
      origem: evento.origem,
      parceiro: evento.parceiro ?? null,
      por: evento.por ?? null,
      por_nome: evento.por_nome ?? null,
      motivo: evento.motivo ?? null,
      antes: soCamposDoRastro(evento.antes),
      depois: soCamposDoRastro(evento.depois),
      created_at: agora,
      updated_at: agora,
    });
    if (error) {
      console.error(
        `[048] falha ao registrar o evento ${evento.tipo} do pedido ${evento.order_id}: ${error.message}`,
      );
      return 'falhou';
    }
    return 'gravado';
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error(`[048] falha ao registrar o evento ${evento.tipo} do pedido ${evento.order_id}: ${msg}`);
    return 'falhou';
  }
}

export interface CamposDaOrigemDoNumero {
  erp_order_source: OrigemDoNumero;
  erp_order_set_at: string;
  erp_order_set_by: string | null;
}

/**
 * Acrescenta a origem do número ao objeto do UPDATE que grava erp_order_id —
 * SE a coluna existir (048). Sem ela o objeto volta intocado e o update fica
 * igual ao de hoje.
 *
 * Muda o próprio `patch` e devolve o mesmo objeto, para caber no fluxo:
 *
 *   const patch = { erp_order_id, synced_at: agora, updated_at: agora };
 *   await gravarOrigemDoNumero(patch, 'api');
 *   await supabase.from('orders').update(patch)...
 *
 * `erp_order_set_at` reaproveita `patch.updated_at` quando ele é texto, para o
 * pedido não ter dois "agora" diferentes na mesma gravação. `por` é o usuário
 * do app (null pela API e pelo sync.py).
 *
 * Nunca lança: na dúvida sobre a coluna, não acrescenta (detectar devolve não).
 */
export async function gravarOrigemDoNumero<T extends object>(
  patch: T,
  origem: OrigemDoNumero,
  por?: string | null,
): Promise<T & Partial<CamposDaOrigemDoNumero>> {
  let existe = false;
  try {
    existe = await detectar('orders', 'erp_order_source');
  } catch {
    existe = false;
  }
  if (!existe) return patch;

  const alvo = patch as T & Partial<CamposDaOrigemDoNumero> & { updated_at?: unknown };
  alvo.erp_order_source = origem;
  alvo.erp_order_set_at = typeof alvo.updated_at === 'string' ? alvo.updated_at : new Date().toISOString();
  alvo.erp_order_set_by = por ?? null;
  return alvo;
}
