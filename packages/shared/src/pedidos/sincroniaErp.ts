import type { Order } from '../types/order.js';
import { compararComOOriginal, type DiferencaDoPedido, type ItemDaFoto } from './pedidoOriginal.js';

/**
 * O QUE O CONTROL CONHECE de um pedido já lançado (migração 046).
 *
 * "Depois que o pedido for enviado pelas vendedoras internas e elas alterarem
 * ele, temos que ter um botão depois que editou as peças como 'atualizar no
 * ERP', porque se ela mudar por lá tem que mudar no ERP principal também"
 * (Yan, 11/09/2026).
 *
 * A venda interna mexe no próprio pedido até o carimbo de faturado, inclusive
 * depois de a Larissa lançar. Esta é a fotografia do que a fábrica tem na mão:
 * enquanto o pedido de hoje for igual a ela, o Control está em dia.
 */
export interface SincroniaComOErp {
  order_id: string;
  /** O número do Control no momento da foto. */
  erp_order_id: string | null;
  total: number | null;
  pecas: number;
  /** Quando o Control passou a conhecer esta versão. */
  confirmado_em: string;
  /** Quando alguém apertou "Atualizar no ERP". `null` = ninguém pediu. */
  pedido_em: string | null;
  /** O recado de quem pediu ("tirei 6 peças da 0124, faltou no estoque"). */
  observacao: string | null;
  snapshot: Order & { items: ItemDaFoto[] };
}

/**
 * O pedido reduzido ao que vai para o Control e que a venda interna consegue
 * mudar depois do lançamento: as peças, o desconto (AB46 da planilha), a
 * condição de pagamento (C8) e a observação. Serve igual para a foto e para o
 * pedido de hoje.
 */
export interface PedidoParaComparar {
  items: ItemDaFoto[];
  discount_percent?: number | null | undefined;
  payment_condition_id?: string | null | undefined;
  notes?: string | null | undefined;
}

export interface DivergenciaComOErp {
  /** As peças que mudaram de quantidade, referência por referência. */
  itens: DiferencaDoPedido;
  /** O desconto em %, quando mudou. */
  desconto: { antes: number; depois: number } | null;
  condicaoMudou: boolean;
  observacaoMudou: boolean;
  /** `false` = o Control está em dia; a tela não mostra aviso nenhum. */
  mudou: boolean;
}

const texto = (s: string | null | undefined): string => (s ?? '').trim();

/**
 * O que mudou entre a foto do Control e o pedido de hoje.
 *
 * As quatro portas são as quatro rotas que o mesmo portão de edição deixa a
 * venda interna usar depois do lançamento (peças, desconto, pagamento,
 * observação). Olhar só as peças deixava passar o desconto trocado de 5% para
 * 8% — e a nota sairia com o desconto velho.
 *
 * Troca de PREÇO sozinha não conta: ela só acontece como consequência de uma
 * edição de peças (o servidor reprecifica ao salvar), e o Control precifica
 * pela própria tabela, que é a mesma que o app usou.
 */
export function divergenciaComOErp(
  noControl: PedidoParaComparar,
  hoje: PedidoParaComparar,
): DivergenciaComOErp {
  const itens = compararComOOriginal(noControl.items ?? [], hoje.items ?? []);

  const descontoAntes = Number(noControl.discount_percent ?? 0);
  const descontoDepois = Number(hoje.discount_percent ?? 0);
  const desconto =
    Math.abs(descontoAntes - descontoDepois) >= 0.001
      ? { antes: descontoAntes, depois: descontoDepois }
      : null;

  // `undefined` (foto de antes de a coluna existir) e `null` são o mesmo "sem condição".
  const condicaoMudou = (noControl.payment_condition_id ?? null) !== (hoje.payment_condition_id ?? null);
  const observacaoMudou = texto(noControl.notes) !== texto(hoje.notes);

  return {
    itens,
    desconto,
    condicaoMudou,
    observacaoMudou,
    mudou: itens.mudou || desconto !== null || condicaoMudou || observacaoMudou,
  };
}

/**
 * Uma impressão digital curta do pedido — do mesmo recorte que a divergência
 * olha.
 *
 * É o que a Larissa manda junto ao apertar "Já atualizei no Control": se a
 * venda interna mexeu de novo enquanto ela digitava no Control, a impressão do
 * servidor não bate com a da tela e a confirmação é recusada. Sem isto, a foto
 * nova engoliria a segunda edição e ninguém saberia.
 *
 * Função pura e determinística nos dois lados (tela e API): as peças são
 * somadas por produto+variante e ordenadas, então a ordem em que o banco
 * devolve as linhas não muda o resultado.
 */
export function assinaturaDoPedido(p: PedidoParaComparar): string {
  const porChave = new Map<string, number>();
  for (const i of p.items ?? []) {
    const k = `${i.product_id}|${i.variant_id ?? ''}`;
    porChave.set(k, (porChave.get(k) ?? 0) + Number(i.quantity ?? 0));
  }
  const linhas = [...porChave.entries()]
    .filter(([, q]) => q !== 0)
    .map(([k, q]) => `${k}|${q}`)
    .sort();
  const canonico = [
    ...linhas,
    `d:${Number(p.discount_percent ?? 0).toFixed(3)}`,
    `c:${p.payment_condition_id ?? ''}`,
    `o:${texto(p.notes)}`,
  ].join('\n');

  // FNV-1a de 32 bits: curto para ir no corpo, e colisão aqui só faria uma
  // confirmação passar — o mesmo que acontecia antes de existir a checagem.
  let h = 0x811c9dc5;
  for (let i = 0; i < canonico.length; i++) {
    h ^= canonico.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return `${linhas.length}-${h.toString(16).padStart(8, '0')}`;
}
