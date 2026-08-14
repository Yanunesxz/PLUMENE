import {
  celulaDoTamanho,
  refDaPlanilha,
  nucleoDaRef,
  tamanhoIgnorado,
  SUFIXO_PLUS,
  COLUNAS_PLUS,
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
  /**
   * O que vai na coluna OBSERVAÇÃO da linha — hoje, a COR do produto ("Azul").
   * É o campo que a fábrica lê na separação: cada cor é um produto próprio no
   * catálogo, então uma linha da planilha tem uma cor só.
   */
  observacao?: string | undefined;
}

export interface LinhaDaPlanilha {
  ref: string;
  sistema: SistemaDeGrade;
  /** Coluna da planilha → quantidade. Ex.: `{ N: 3, Q: 2 }`. */
  quantidades: Record<string, number>;
  /** Soma das quantidades — é o que a coluna QUANT mostra. */
  pecas: number;
  unit_price: number;
  /** A OBSERVAÇÃO da linha (coluna B) — a cor, quando o produto tem uma. */
  observacao?: string | undefined;
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
    // cadastro tem "0130" com PP→GG e "0130 PLUS" com 48→54. Foi isso que
    // derrubou a linha do 50 na primeira importação que funcionou — o produto
    // 0130 não tem tamanho 50, quem tem é o 0130 PLUS.
    //
    // O que decide a linha plus é a COLUNA, não o sistema. Qualquer peça que
    // cai na faixa Q→T é do produto plus — venha ela como 48 (numérica) ou como
    // XG/EG (letras). Mandar só o 48 para a linha plus e deixar o XG junto do
    // base era o bug: o Control recusava a linha do "2130" com XG, porque o 2130
    // não tem esse tamanho — quem tem é o "2130 PLUS". A linha plus é sempre
    // numérica (48→54), que é como o Control lê as colunas Q→T.
    const base = refDaPlanilha(item.sku);
    const ehPlus = COLUNAS_PLUS.has(celula.coluna);
    const ref = ehPlus ? `${base}${SUFIXO_PLUS}` : base;
    const sistema: SistemaDeGrade = ehPlus ? 'numerica' : celula.sistema;
    const chave = `${ref}::${sistema}`;
    const linha = porChave.get(chave) ?? {
      ref,
      sistema,
      quantidades: {},
      pecas: 0,
      unit_price: item.unit_price,
    };

    // Somar em vez de sobrescrever: 44 e 46 caem os dois na coluna "44/46", e o
    // mesmo produto pode vir repetido quando o pedido foi montado por cor.
    linha.quantidades[celula.coluna] = (linha.quantidades[celula.coluna] ?? 0) + item.quantity;
    linha.pecas += item.quantity;
    // A cor: uma por linha (a linha é um produto, o produto tem uma cor). O
    // primeiro item com cor manda; os demais são o mesmo produto.
    linha.observacao ??= item.observacao?.trim() || undefined;
    porChave.set(chave, linha);
  }

  // O formulário da fábrica lista o par JUNTO: "0130" e, logo abaixo, a linha
  // plus. O Map guarda na ordem em que cada linha apareceu — o que jogava todos
  // os PLUS para o fim do arquivo quando o pedido é montado produto a produto.
  // Reordena: grupos pela primeira aparição da referência (base ou plus, o que
  // vier antes), e dentro do grupo o base na frente do PLUS. A ordenação é
  // estável, então linhas do mesmo grupo que não são par (0080 infantil +
  // 0080 juvenil) ficam como entraram.
  const ordemDoGrupo = new Map<string, number>();
  for (const linha of porChave.values()) {
    const grupo = nucleoDaRef(linha.ref);
    if (!ordemDoGrupo.has(grupo)) ordemDoGrupo.set(grupo, ordemDoGrupo.size);
  }
  const linhas = [...porChave.values()].sort((a, b) => {
    const ga = ordemDoGrupo.get(nucleoDaRef(a.ref)) ?? 0;
    const gb = ordemDoGrupo.get(nucleoDaRef(b.ref)) ?? 0;
    if (ga !== gb) return ga - gb;
    return Number(a.ref.endsWith(SUFIXO_PLUS)) - Number(b.ref.endsWith(SUFIXO_PLUS));
  });

  return { linhas, foraDaGrade };
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
