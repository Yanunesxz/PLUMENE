import type { Order, OrderItem } from '../types/order.js';

/**
 * O PEDIDO ORIGINAL × COMO ELE FOI FATURADO (migração 044).
 *
 * "Hoje o pedido original vem montado mas depois que a gente fatura pode tirar
 * algumas peças que não temos e o pedido vem com menos" (Yan, 11/09/2026).
 *
 * A comparação mora aqui, em `shared`, porque a mesma conta serve à tela do
 * pedido e a qualquer relatório que venha depois — e porque ela é pura: entram
 * duas listas de peças, sai o que mudou entre elas.
 */

/** Uma peça na foto: com a referência e o tamanho resolvidos. */
export interface ItemDaFoto extends OrderItem {
  product?: { sku: string; name: string } | null;
  variant?: { size: string } | null;
}

export interface PedidoOriginal {
  order_id: string;
  /** O total na hora da foto. */
  total: number | null;
  /** Quantas peças o pedido tinha na hora da foto. */
  pecas: number;
  /** O que provocou a foto: alguém trocou as peças, ou veio o carimbo. */
  motivo: 'edicao' | 'faturamento';
  guardado_em: string;
  snapshot: Order & { items: ItemDaFoto[] };
}

/** Uma referência+tamanho que mudou entre o original e o pedido de hoje. */
export interface LinhaDaDiferenca {
  chave: string;
  /** Referência do Control (SKU). Vazio quando a foto é de um banco antigo. */
  ref: string;
  nome: string;
  tamanho: string | null;
  /** Quantas peças tinham no original. */
  antes: number;
  /** Quantas restaram. 0 = a referência saiu inteira. */
  depois: number;
  unit_price: number;
  /** O que essa linha deixou de faturar (negativo quando ENTROU peça). */
  valor: number;
}

export interface DiferencaDoPedido {
  linhas: LinhaDaDiferenca[];
  pecasAntes: number;
  pecasDepois: number;
  /** Soma do que saiu menos o que entrou. Positivo = o pedido encolheu. */
  valorQueSaiu: number;
  /** `false` quando nada mudou — a tela não mostra bloco nenhum. */
  mudou: boolean;
}

function chaveDoItem(i: ItemDaFoto): string {
  return `${i.product_id}|${i.variant_id ?? ''}`;
}

function somar(itens: ItemDaFoto[]): number {
  return itens.reduce((s, i) => s + Number(i.quantity ?? 0), 0);
}

/**
 * O que mudou entre a foto e o pedido de hoje, referência por referência.
 *
 * Peça que ENTROU também aparece (com `antes` menor que `depois`): o corte do
 * financeiro costuma ser só para menos, mas o gerente pode ter acrescentado
 * algo na fila dele — e um comparativo que só mostra metade da história é
 * pior do que nenhum.
 */
export function compararComOOriginal(
  original: ItemDaFoto[],
  atual: ItemDaFoto[],
): DiferencaDoPedido {
  const antes = new Map<string, ItemDaFoto>();
  for (const i of original) {
    const k = chaveDoItem(i);
    const acumulado = antes.get(k);
    antes.set(k, acumulado ? { ...acumulado, quantity: acumulado.quantity + i.quantity } : i);
  }
  const depois = new Map<string, ItemDaFoto>();
  for (const i of atual) {
    const k = chaveDoItem(i);
    const acumulado = depois.get(k);
    depois.set(k, acumulado ? { ...acumulado, quantity: acumulado.quantity + i.quantity } : i);
  }

  const linhas: LinhaDaDiferenca[] = [];
  for (const chave of new Set([...antes.keys(), ...depois.keys()])) {
    const a = antes.get(chave);
    const d = depois.get(chave);
    const qtdAntes = a?.quantity ?? 0;
    const qtdDepois = d?.quantity ?? 0;
    if (qtdAntes === qtdDepois) continue;
    const referencia = a ?? d!;
    const unit_price = Number(a?.unit_price ?? d?.unit_price ?? 0);
    linhas.push({
      chave,
      ref: referencia.product?.sku ?? '',
      nome: referencia.product?.name ?? '',
      tamanho: referencia.variant?.size ?? null,
      antes: qtdAntes,
      depois: qtdDepois,
      unit_price,
      valor: Number(((qtdAntes - qtdDepois) * unit_price).toFixed(2)),
    });
  }

  // O que mais saiu primeiro: é a linha que explica o pedido ter encolhido.
  linhas.sort((x, y) => y.valor - x.valor || x.ref.localeCompare(y.ref));

  const pecasAntes = somar(original);
  const pecasDepois = somar(atual);
  return {
    linhas,
    pecasAntes,
    pecasDepois,
    valorQueSaiu: Number(linhas.reduce((s, l) => s + l.valor, 0).toFixed(2)),
    mudou: linhas.length > 0,
  };
}
