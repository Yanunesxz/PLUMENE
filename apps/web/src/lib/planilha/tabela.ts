import type { PriceTable } from '@csb/shared';

/** Qual das três planilhas oficiais da fábrica. É o que escolhe o modelo. */
export type NumeroDaTabela = 1 | 2 | 3;

/**
 * De qual das três tabelas oficiais é esta tabela de preço.
 *
 * Em produção o `erp_code` está vazio nas quatro tabelas e os nomes são
 * "TABELA 01 - 2027", "TABELA 02 - 2027", "TABELA 03 - 2027" e "TABELA PADRAO".
 * Isso obriga a ler o nome, e a ler com cuidado: procurar "um dígito de 1 a 3
 * isolado" não acha o `1` de "01" (vem colado no zero) e ainda arrisca casar com
 * o `2` de "2027". Por isso a busca é ancorada na palavra TABELA, os zeros à
 * esquerda são consumidos, e o que vier seguido de outro dígito é descartado —
 * "TABELA 10" não é a tabela 1.
 *
 * "TABELA PADRAO" devolve `null` de propósito: ela não é nenhuma das três, e o
 * pedido que cair nela precisa aparecer como aviso, não sair calado no modelo
 * errado.
 */
export function numeroDaTabela(tabela: PriceTable): NumeroDaTabela | null {
  const codigo = (tabela.erp_code ?? '').trim();
  if (/^0*[123]$/.test(codigo)) return Number(codigo) as NumeroDaTabela;

  const doNome = tabela.name.match(/TABELA\s*0*([123])(?![0-9])/i)?.[1];
  return doNome ? (Number(doNome) as NumeroDaTabela) : null;
}
