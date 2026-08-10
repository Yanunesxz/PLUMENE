import {
  celulaDoTamanho,
  refDaPlanilha,
  tamanhoIgnorado,
  SUFIXO_PLUS,
  type SistemaDeGrade,
} from './colunas.js';

/**
 * De itens do pedido para linhas da planilha.
 *
 * O pedido guarda uma linha por (produto × tamanho); a planilha quer uma linha
 * por (referência × grade), com as quantidades espalhadas pelas colunas de
 * tamanho. Juntar é quase sempre reduzir — 9 tamanhos da mesma referência viram
 * uma linha só — mas a referência que pega duas grades gasta duas linhas, e é
 * essa conta que decide quando o pedido não cabe mais no arquivo.
 */

/** A grade de itens da planilha vai da linha 13 à 44. Não há uma 45ª. */
export const LINHAS_POR_FOLHA = 32;

export interface ItemParaPlanilha {
  /** SKU do produto como o sistema o guarda. Normalizado aqui. */
  sku: string;
  size: string;
  quantity: number;
  unit_price: number;
}

export interface LinhaDaPlanilha {
  ref: string;
  sistema: SistemaDeGrade;
  /** Coluna da planilha → quantidade. Ex.: `{ N: 3, Q: 2 }`. */
  quantidades: Record<string, number>;
  /** Soma das quantidades — é o que a coluna QUANT mostra. */
  pecas: number;
  unit_price: number;
}

export interface ItemForaDaGrade {
  sku: string;
  size: string;
  quantity: number;
}

export interface MontagemDeLinhas {
  linhas: LinhaDaPlanilha[];
  /** Itens cujo tamanho não tem coluna na planilha. Nunca some calado. */
  foraDaGrade: ItemForaDaGrade[];
}

export function montarLinhas(itens: readonly ItemParaPlanilha[]): MontagemDeLinhas {
  const porChave = new Map<string, LinhaDaPlanilha>();
  const foraDaGrade: ItemForaDaGrade[] = [];

  for (const item of itens) {
    if (item.quantity <= 0) continue;
    // Sai sem aviso, de propósito — ver IGNORADOS em colunas.ts.
    if (tamanhoIgnorado(item.size)) continue;

    const celula = celulaDoTamanho(item.size);
    if (!celula) {
      foraDaGrade.push({ sku: item.sku, size: item.size, quantity: item.quantity });
      continue;
    }

    // No Control a grade plus é OUTRO produto, não outro tamanho do mesmo: o
    // cadastro tem "0130" com PP→EG e "0130 PLUS" com 48→54. Foi isso que
    // derrubou a linha do 50 na primeira importação que funcionou — o produto
    // 0130 não tem tamanho 50, quem tem é o 0130 PLUS.
    //
    // A grade `numerica` é sempre a plus aqui: o catálogo não tem numeração
    // adulta 36→46: os únicos números grandes são os 48/50/52/54 das quatro
    // referências plus size.
    const base = refDaPlanilha(item.sku);
    const ref = celula.sistema === 'numerica' ? `${base}${SUFIXO_PLUS}` : base;
    const chave = `${ref}::${celula.sistema}`;
    const linha = porChave.get(chave) ?? {
      ref,
      sistema: celula.sistema,
      quantidades: {},
      pecas: 0,
      unit_price: item.unit_price,
    };

    // Somar em vez de sobrescrever: 44 e 46 caem os dois na coluna "44/46", e o
    // mesmo produto pode vir repetido quando o pedido foi montado por cor.
    linha.quantidades[celula.coluna] = (linha.quantidades[celula.coluna] ?? 0) + item.quantity;
    linha.pecas += item.quantity;
    porChave.set(chave, linha);
  }

  return { linhas: [...porChave.values()], foraDaGrade };
}

/**
 * Fatia as linhas em folhas de 32. Cada folha vira um arquivo, e o pedido que
 * passa de uma folha sai num .zip com todas.
 */
export function dividirEmFolhas(
  linhas: readonly LinhaDaPlanilha[],
  porFolha: number = LINHAS_POR_FOLHA,
): LinhaDaPlanilha[][] {
  if (linhas.length === 0) return [];
  const folhas: LinhaDaPlanilha[][] = [];
  for (let i = 0; i < linhas.length; i += porFolha) folhas.push([...linhas.slice(i, i + porFolha)]);
  return folhas;
}
