import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { assinaturaDoPedido, type Order, type SincroniaComOErp, type PedidoParaComparar } from '@csb/shared';

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
 * "Está desatualizado" não é gravado: é a comparação entre o pedido de hoje e a
 * foto (`divergenciaComOErp`, em shared), feita na tela. Um booleano guardado
 * desencontraria do fato na primeira vez que alguém editasse sem passar por
 * aqui.
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

interface Foto {
  pedido: unknown;
  total: number | null;
  pecas: number;
  erp_order_id: string | null;
}

async function fotografar(order_id: string, company_id: string): Promise<Foto | null> {
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

/** A linha que diz "é isto que a fábrica tem na mão", com o pedido de atualização zerado. */
function linhaDaFoto(order_id: string, company_id: string, foto: Foto, quem: string | null) {
  return {
    order_id,
    company_id,
    erp_order_id: foto.erp_order_id,
    total: foto.total,
    pecas: foto.pecas,
    snapshot: foto.pedido,
    confirmado_em: new Date().toISOString(),
    confirmado_por: quem,
    // Foto nova zera o pedido de atualização: o que foi pedido acabou de ser feito.
    pedido_em: null,
    pedido_por: null,
    observacao: null,
  };
}

/**
 * O Control passou a conhecer o pedido como ele está AGORA.
 *
 * Chamado em três momentos: quando a Larissa lança à mão, quando o ERP do
 * parceiro confirma a importação pela API, e quando alguém confirma que já
 * atualizou lá. Nos três a foto é a mesma coisa — "é isto que a fábrica tem na
 * mão".
 *
 * Nunca derruba quem chamou: é acessório do lançamento, não o lançamento. Mas
 * a falha fica escrita — foto que não grava é aviso que nunca vai aparecer.
 */
export async function registrarNoErp(
  order_id: string,
  company_id: string,
  quem?: string | null,
): Promise<'guardada' | 'sem_tabela' | 'falhou'> {
  if (!(await detectarTabela())) return 'sem_tabela';

  const foto = await fotografar(order_id, company_id);
  if (!foto) {
    console.error(`[046] sem pedido para fotografar: ${order_id}`);
    return 'falhou';
  }
  return gravarFoto(order_id, company_id, foto, quem ?? null);
}

/** Grava por cima a foto já tirada. Separado para quem confere antes (a confirmação) gravar a MESMA foto que conferiu. */
async function gravarFoto(
  order_id: string,
  company_id: string,
  foto: Foto,
  quem: string | null,
): Promise<'guardada' | 'falhou'> {
  const { error } = await supabase
    .from('order_erp_sync')
    .upsert(linhaDaFoto(order_id, company_id, foto, quem), { onConflict: 'order_id' });
  if (error) {
    console.error(`[046] falha ao gravar a foto do pedido ${order_id}: ${error.message}`);
    return 'falhou';
  }
  return 'guardada';
}

/**
 * A foto de um pedido lançado que ainda NÃO tem foto — chamada um instante
 * antes de qualquer edição (peças, desconto, pagamento, observação).
 *
 * Existe por causa dos pedidos que foram lançados antes de a 046 rodar (61 só
 * na Corpo Sensual em 11/09/2026): eles nunca passaram pelo lançamento com a
 * foto, então a primeira edição depois do deploy não teria com o que comparar
 * e o aviso nunca apareceria. A melhor informação que existe sobre o que o
 * Control conhece desses pedidos é o próprio pedido antes desta edição — foi
 * lançado assim e ninguém avisou de mudança desde então.
 *
 * Só grava se faltar: pedido que já tem foto mantém a dele, senão a edição de
 * hoje apagaria a divergência que ela mesma está criando.
 */
export async function garantirFotoDoErp(
  order: Pick<Order, 'id' | 'status'>,
  company_id: string,
): Promise<'guardada' | 'ja_tinha' | 'nao_lancado' | 'sem_tabela' | 'falhou'> {
  if (order.status !== 'sent_erp') return 'nao_lancado';
  if (!(await detectarTabela())) return 'sem_tabela';

  const { data: existente } = await supabase
    .from('order_erp_sync')
    .select('order_id')
    .eq('order_id', order.id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (existente) return 'ja_tinha';

  const foto = await fotografar(order.id, company_id);
  if (!foto) {
    console.error(`[046] sem pedido para a primeira foto: ${order.id}`);
    return 'falhou';
  }

  // INSERT, não upsert: se duas edições chegarem juntas, a primeira foto vence
  // e a segunda não sobrescreve com o pedido já editado.
  const { error } = await supabase.from('order_erp_sync').insert(linhaDaFoto(order.id, company_id, foto, null));
  if (error) {
    if ((error as { code?: string }).code === '23505') return 'ja_tinha';
    console.error(`[046] falha na primeira foto do pedido ${order.id}: ${error.message}`);
    return 'falhou';
  }
  return 'guardada';
}

/**
 * O número do Control foi corrigido depois do lançamento: a foto passa a
 * apontar o número certo. Sem isto, o cartão e o push mandariam a Larissa
 * procurar no Control um pedido com o número digitado errado.
 */
export async function atualizarNumeroNaFoto(order_id: string, company_id: string, numero: string): Promise<void> {
  if (!(await detectarTabela())) return;
  const { error } = await supabase
    .from('order_erp_sync')
    .update({ erp_order_id: numero })
    .eq('order_id', order_id)
    .eq('company_id', company_id);
  if (error) console.error(`[046] falha ao corrigir o número na foto do pedido ${order_id}: ${error.message}`);
}

export type PedirResult =
  | { ok: true; sincronia: SincroniaComOErp }
  | { ok: false; motivo: 'sem_tabela' | 'nao_lancado' | 'ja_faturado' | 'erro' };

/**
 * Alguém editou o pedido e apertou "Atualizar no ERP": fica registrado quem
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

  // Com a nota emitida, avisar a fábrica não conserta mais nada — vale para
  // qualquer papel, não só para a venda interna (a revisão de 15/09 achou o
  // escritório disparando push em pedido já faturado).
  const { data: pedido } = await supabase
    .from('orders')
    .select('invoiced')
    .eq('id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!pedido) return { ok: false, motivo: 'erro' };
  if ((pedido as { invoiced: boolean | null }).invoiced) return { ok: false, motivo: 'ja_faturado' };

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
  | { ok: false; motivo: 'sem_tabela' | 'nao_lancado' | 'mudou_de_novo' | 'ja_faturado' | 'erro' };

/**
 * "Já atualizei no Control": a foto é tirada de novo, e a divergência some
 * porque ela É a comparação com a foto. Só quem mexe no Control confirma.
 *
 * `assinaturaVista` é a impressão do pedido que a Larissa tinha na tela ao
 * apertar. Se a venda interna mexeu de novo enquanto ela digitava no Control,
 * as impressões não batem e a confirmação é recusada — a foto de agora
 * engoliria a segunda edição, e o Control ficaria com a versão do meio.
 */
export async function confirmarAtualizacao(
  order_id: string,
  company_id: string,
  quem: string,
  assinaturaVista?: string | null,
): Promise<ConfirmarResult> {
  if (!(await detectarTabela())) return { ok: false, motivo: 'sem_tabela' };

  const { data: existente } = await supabase
    .from('order_erp_sync')
    .select('order_id')
    .eq('order_id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (!existente) return { ok: false, motivo: 'nao_lancado' };

  // UMA foto só: é ela que é conferida contra o que a Larissa viu e é ELA que
  // é gravada. Conferir numa leitura e fotografar noutra deixava passar a edição
  // que caísse entre as duas — inclusive a troca de peças no meio (apagou as
  // velhas, ainda não inseriu as novas), que gravaria um pedido com zero peças.
  const foto = await fotografar(order_id, company_id);
  if (!foto) return { ok: false, motivo: 'erro' };
  if ((foto.pedido as { invoiced?: boolean | null }).invoiced) return { ok: false, motivo: 'ja_faturado' };
  if (assinaturaVista && assinaturaDoPedido(foto.pedido as PedidoParaComparar) !== assinaturaVista) {
    return { ok: false, motivo: 'mudou_de_novo' };
  }

  const r = await gravarFoto(order_id, company_id, foto, quem);
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
