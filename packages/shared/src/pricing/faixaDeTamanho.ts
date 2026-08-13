/**
 * De que FAIXA DE PREÇO é cada tamanho.
 *
 * A tabela oficial da fábrica (PDF "TABELA DE PREÇO") lista cada referência em
 * duas linhas, com preços diferentes:
 *
 *     0706  Pijama De Manga Feminino   P AO GG        R$ 41,90
 *     0706  Pijama De Manga Feminino   48-50-52-54    R$ 52,90
 *
 * A segunda linha é a FAIXA MAIOR: o corpo maior gasta mais tecido e custa mais.
 * Ela aparece com três rótulos diferentes no PDF — `EG`, `XG` e `48-50-52-54` —
 * mas é sempre a mesma faixa comercial.
 *
 * Essa faixa não é invenção nossa: é a mesma coisa que a planilha oficial do
 * Control chama de **PLUS** nas colunas Q:T (ver `apps/web/src/lib/planilha/
 * colunas.ts`, que mapeia EG/EGG/EGGG e 48/50/52/54 exatamente para Q:T). O
 * próprio ERP trata a faixa maior como outra lista de preço, com o sufixo "E" na
 * referência: lá o 0130 sai a R$ 43,90 e o 0130E, a R$ 53,90.
 *
 * Mora em `shared` porque as duas pontas precisam da MESMA regra: a API para
 * gravar o preço certo no pedido, e o app para mostrar o preço certo na tela.
 * Se as duas divergirem, o representante vende por um valor e a fábrica fatura
 * por outro.
 */

export type FaixaDeTamanho = 'normal' | 'maior';

/**
 * Os tamanhos da faixa maior.
 *
 * Letras: o cadastro escreve EG/EGG/EGGG e o Control, XG/XG2/XG3/XG4 — são o
 * mesmo corpo com nomes diferentes, e os dois conjuntos entram.
 * Números: 48 a 54 é a grade plus das quatro referências que a têm (0130, 0703,
 * 0705 e 0706). A grade numérica normal (36 a 46) NÃO é faixa maior.
 */
const MAIORES: ReadonlySet<string> = new Set([
  'EG',
  'EGG',
  'EGGG',
  'XG',
  'XG2',
  'XG3',
  'XG4',
  '48',
  '50',
  '52',
  '54',
]);

/** "08" e "8" são o mesmo tamanho; a fábrica manda com zero à esquerda em parte do catálogo. */
function normalizar(size: string): string {
  const t = size.trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

export function faixaDoTamanho(size: string | null | undefined): FaixaDeTamanho {
  if (!size) return 'normal';
  return MAIORES.has(normalizar(size)) ? 'maior' : 'normal';
}

/**
 * O preço de UM tamanho, dadas as duas faixas da tabela.
 *
 * A faixa maior cai na normal quando o produto não tem preço maior cadastrado —
 * é o caso das 55 referências infantis/juvenis, que no PDF têm uma linha só.
 * Nunca o contrário: um tamanho normal jamais paga o preço da faixa maior.
 *
 * `null` = produto sem preço nesta tabela; quem chama decide o que fazer (o
 * catálogo esconde, o pedido recusa).
 */
export function precoDoTamanho(
  size: string | null | undefined,
  price: number | null,
  price_larger: number | null,
): number | null {
  if (faixaDoTamanho(size) === 'maior' && price_larger != null) return price_larger;
  return price;
}
