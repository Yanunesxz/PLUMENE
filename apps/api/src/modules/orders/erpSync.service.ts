import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import type { SincroniaComOErp } from '@csb/shared';

/**
 * "ATUALIZAR NO ERP" (migração 046).
 *
 * Pedido do Yan (11/09/2026): "depois que o pedido for enviado pelas vendedoras
 * internas e elas alterarem ele, temos que ter um botão depois que editou as
 * peças como 'atualizar no ERP', porque se ela mudar por lá tem que mudar no
 * ERP principal também".
 *
 * A venda interna mexe no PRÓPRIO pedido até o carimbo de faturado — inclusive
 * depois de a Larissa lançar no Control. Quando ela mexe, a fábrica continua
 * com a versão velha. Aqui mora a fotografia do que o Control CONHECE: tirada
 * no lançamento, tirada de novo quando alguém confirma que atualizou lá.
 *
 * "Está desatualizado" não é gravado: é a comparação entre as peças de hoje e a
 * foto, feita na tela. Um booleano guardado desencontraria do fato na primeira
 * vez que alguém editasse sem passar por aqui.
 */

/** `order_erp_sync` vem da 046 — o código sobe antes do SQL, como sempre. */
async function detectarTabela(): Promise<boolean> {
  return detectar('order_erp_sync', 'order_id');
}

/** As peças já com referência e tamanho: a foto não pode depender do catálogo. */
const COLUNAS_DA_FOTO =
  '*, items:order_items(*, product:products(sku, name), variant:product_variants(size))';

function contarPecas(itens: Array<{ quantity?: number | null }>): number {
  return itens.reduce((s, i) => s + Number(i.quantity ?? 0), 0);
}

async function fotografar(
  order_id: string,
  company_id: string,
): Promise<{ pedido: unknown; total: number | null; pecas: number; erp_order_id: string | null } | null> {
  const rico = await supabase
    .from('orders')
    .select(COLUNAS_DA_FOTO)
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();

  let pedido: unknown = null;
  if (!rico.error && rico.data) {
    pedido = rico.data;
  } else {
    // Banco antigo sem os embeds: melhor um retrato sem a referência do que nenhum.
    const simples = await supabase
      .from('orders')
      .select('*, items:order_items(*)')
      .eq('id', order_id)
      .eq('company_id', company_id)
      .maybeSingle();
    pedido = simples.data ?? null;
  }
  if (!pedido) return null;

  const p = pedido as {
    total?: number | null;
    erp_order_id?: string | null;
    items?: Array<{ quantity?: number | null }>;
  };
  return {
    pedido,
    total: p.total ?? null,
    pecas: contarPecas(p.items ?? []),
    erp_order_id: p.erp_order_id ?? null,
  };
}

/**
 * O Control passou a conhecer o pedido como ele está AGORA.
 *
 * Chamado em dois momentos: quando o pedido é lançado (o Control acabou de
 * importar a planilha) e quando alguém confirma que já atualizou lá. Nos dois
 * a foto é a mesma coisa — "é isto que a fábrica tem na mão".
 *
 * Nunca derruba quem chamou: é acessório do lançamento, não o lançamento.
 */
export async function registrarNoErp(
  order_id: string,
  company_id: string,
  quem?: string | null,
): Promise<'guardada' | 'sem_tabela' | 'falhou'> {
  if (!(await detectarTabela())) return 'sem_tabela';

  const foto = await fotografar(order_id, company_id);
  if (!foto) return 'falhou';

  const { error } = await supabase.from('order_erp_sync').upsert(
    {
      order_id,
      company_id,
      erp_order_id: foto.erp_order_id,
      total: foto.total,
      pecas: foto.pecas,
      snapshot: foto.pedido,
      confirmado_em: new Date().toISOString(),
      confirmado_por: quem ?? null,
      // Foto nova zera o pedido de atualização: o que foi pedido acabou de ser feito.
      pedido_em: null,
      pedido_por: null,
      observacao: null,
    },
    { onConflict: 'order_id' },
  );
  return error ? 'falhou' : 'guardada';
}

export type PedirResult =
  | { ok: true; sincronia: SincroniaComOErp }
  | { ok: false; motivo: 'sem_tabela' | 'nao_lancado' | 'not_found' | 'erro' };

/**
 * Alguém editou as peças e apertou "Atualizar no ERP": fica registrado quem
 * pediu, quando e por quê. Quem atualiza o Control de fato é uma pessoa — o
 * app só garante que ela seja avisada e que o recado não se perca.
 */
export async function pedirAtualizacao(
  order_id: string,
  company_id: string,
  quem: string,
  observacao?: string | null,
): Promise<PedirResult> {
  if (!(await detectarTabela())) return { ok: false, motivo: 'sem_tabela' };

  const { data: existente } = await supabase
    .from('order_erp_sync')
    .select('order_id')
    .eq('order_id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  // Sem foto não há o que atualizar: o pedido nunca foi para o Control.
  if (!existente) return { ok: false, motivo: 'nao_lancado' };

  const agora = new Date().toISOString();
  const { error } = await supabase
    .from('order_erp_sync')
    .update({ pedido_em: agora, pedido_por: quem, observacao: observacao?.trim() || null })
    .eq('order_id', order_id)
    .eq('company_id', company_id);
  if (error) return { ok: false, motivo: 'erro' };

  const sincronia = await lerSincronia(order_id, company_id);
  return sincronia ? { ok: true, sincronia } : { ok: false, motivo: 'erro' };
}

export type ConfirmarResult =
  | { ok: true; sincronia: SincroniaComOErp }
  | { ok: false; motivo: 'sem_tabela' | 'nao_lancado' | 'erro' };

/**
 * "Já atualizei no Control": a foto é tirada de novo, e a divergência some
 * porque ela É a comparação com a foto. Só quem mexe no Control confirma.
 */
export async function confirmarAtualizacao(
  order_id: string,
  company_id: string,
  quem: string,
): Promise<ConfirmarResult> {
  if (!(await detectarTabela())) return { ok: false, motivo: 'sem_tabela' };

  const { data: existente } = await supabase
    .from('order_erp_sync')
    .select('order_id')
    .eq('order_id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!existente) return { ok: false, motivo: 'nao_lancado' };

  const r = await registrarNoErp(order_id, company_id, quem);
  if (r !== 'guardada') return { ok: false, motivo: 'erro' };

  const sincronia = await lerSincronia(order_id, company_id);
  return sincronia ? { ok: true, sincronia } : { ok: false, motivo: 'erro' };
}

/** A foto que a tela usa para comparar. `null` = pedido que nunca foi lançado. */
export async function lerSincronia(
  order_id: string,
  company_id: string,
): Promise<SincroniaComOErp | null> {
  if (!(await detectarTabela())) return null;
  const { data } = await supabase
    .from('order_erp_sync')
    .select('erp_order_id, total, pecas, snapshot, confirmado_em, pedido_em, observacao')
    .eq('order_id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!data) return null;
  const l = data as {
    erp_order_id: string | null;
    total: number | null;
    pecas: number;
    snapshot: SincroniaComOErp['snapshot'];
    confirmado_em: string;
    pedido_em: string | null;
    observacao: string | null;
  };
  return {
    order_id,
    erp_order_id: l.erp_order_id,
    total: l.total,
    pecas: l.pecas,
    confirmado_em: l.confirmado_em,
    pedido_em: l.pedido_em,
    observacao: l.observacao,
    snapshot: l.snapshot,
  };
}
