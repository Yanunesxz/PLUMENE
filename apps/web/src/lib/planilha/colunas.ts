/**
 * De que coluna da planilha oficial é cada tamanho.
 *
 * A planilha reaproveita as MESMAS colunas para grades diferentes. A coluna Q é
 * "XG" quando se lê a linha 11 e "48" quando se lê a linha 12; a M é "P", "38" e
 * "2" ao mesmo tempo. Quem abre o arquivo — o Control — decide como ler a linha
 * inteira, então uma linha nunca pode misturar duas grades: se ela tem peça em
 * letras e peça em número, não há como saber se o 3 na coluna Q é XG ou 48.
 *
 * É por isso que `celulaDoTamanho` devolve o SISTEMA junto com a coluna. Quem
 * monta as linhas separa por sistema, e a mesma referência sai duas vezes quando
 * o pedido pega as duas grades — que é exatamente o caso das quatro peças plus
 * size (0130, 0703, 0705, 0706: letras PP→GG mais a numérica 48→54).
 */

export type SistemaDeGrade = 'letras' | 'numerica' | 'infantil' | 'juvenil';

/**
 * Faixas da linha 9 da planilha: L:P é "INFANTIL / ADULTO", Q:T é "PLUS" e U:X é
 * "JUVENIL". As letras ocupam L→T; a numérica adulta ocupa as mesmas L→T; o
 * infantil mora em M→P e o juvenil, sozinho, em U→X.
 */
const COLUNAS: Record<SistemaDeGrade, Readonly<Record<string, string>>> = {
  letras: {
    PP: 'L',
    P: 'M',
    M: 'N',
    G: 'O',
    GG: 'P',
    XG: 'Q',
    XG2: 'R',
    XG3: 'S',
    XG4: 'T',
    // O cadastro escreve os mesmos quatro como EG/EGG/EGGG (ver SIZE_RANK em
    // components/comercial/grade.ts). São o mesmo corpo, a mesma coluna.
    EG: 'Q',
    EGG: 'R',
    EGGG: 'S',
  },
  numerica: {
    '36': 'L',
    '38': 'M',
    '40': 'N',
    '42': 'O',
    // A planilha tem UMA coluna rotulada "44/46": os dois tamanhos somam ali.
    '44': 'P',
    '46': 'P',
    '44/46': 'P',
    '48': 'Q',
    '50': 'R',
    '52': 'S',
    '54': 'T',
  },
  infantil: { '2': 'M', '4': 'N', '6': 'O', '8': 'P' },
  juvenil: { '10': 'U', '12': 'V', '14': 'W', '16': 'X' },
};

const SISTEMAS: readonly SistemaDeGrade[] = ['letras', 'numerica', 'infantil', 'juvenil'];

/**
 * "08" e "8" são o mesmo tamanho — a fábrica manda com zero à esquerda em parte
 * do catálogo (ver tests/grade.test.ts). "44/46" não é número e passa inteiro.
 */
function normalizar(size: string): string {
  const t = size.trim().toUpperCase().replace(/\s+/g, '');
  return /^\d+$/.test(t) ? String(Number(t)) : t;
}

export interface CelulaDoTamanho {
  sistema: SistemaDeGrade;
  coluna: string;
}

/** `null` quando o tamanho não existe na planilha (ex.: o "U" de tamanho único). */
export function celulaDoTamanho(size: string): CelulaDoTamanho | null {
  const t = normalizar(size);
  for (const sistema of SISTEMAS) {
    const coluna = COLUNAS[sistema][t];
    if (coluna) return { sistema, coluna };
  }
  return null;
}

/**
 * O miolo da referência, para comparar formas diferentes da mesma peça: sem o
 * "E" do fim e sem os zeros da frente. "130", "0130" e "0130E" viram "130".
 */
export function nucleoDaRef(valor: string): string {
  const cru = valor.trim().toUpperCase();
  const nucleo = cru.replace(/E$/, '').replace(/^0+/, '');
  return /^\d+$/.test(nucleo) ? nucleo : cru;
}

/**
 * A referência como o Control a conhece: quatro dígitos com zero à esquerda e
 * SEM o "E" — "130" e "0130E" viram "0130".
 *
 * O formato saiu de duas evidências. A primeira, do preço: a Plan2 lista a mesma
 * peça como "130" a R$ 43,90 e "0130E" a R$ 53,90, e os preços do sistema batem
 * com a primeira (Tabela 01, conferida no banco: 43,90 no 0130, 28,50 no 0703,
 * 34,90 no 0705, 37,90 no 0706). As linhas com "E" são outra lista de preço, que
 * o sistema não usa. A segunda, do próprio Control: importando "0130E" ele
 * respondeu "NÃO ENCONTRADO!!!" em todas as linhas.
 *
 * É `0130` e não `130` porque é assim que o Control cadastra o produto — e é
 * também como o `sku` chega do ERP. Por isso a célula vai como TEXTO: escrita
 * como número, o Excel comeria o zero da frente.
 *
 * Consequência aceita: `0130` não existe na Plan2 (lá é "130", numérico), então
 * o VLOOKUP da coluna UNIT não resolve. Não é problema no arquivo entregue —
 * `preencherModelo` grava o preço do sistema no valor da célula, e é esse que o
 * Control lê. Só reaparece como "-" se alguém abrir no Excel e forçar recálculo.
 */
export function refDaPlanilha(sku: string): string {
  const nucleo = nucleoDaRef(sku);
  return /^\d+$/.test(nucleo) ? nucleo.padStart(4, '0') : nucleo;
}
