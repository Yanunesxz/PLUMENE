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
 * A referência como a planilha a escreve: quatro dígitos com zero à esquerda e um
 * "E" no fim — "130" e "0130" viram "0130E".
 *
 * A Plan2 lista a mesma peça nas duas formas, com preços diferentes ("130" custa
 * R$ 43,90 e "0130E", R$ 53,90), e é a forma com E que o Yan usa. Quem não é
 * número (um SKU tipo "PIJ001") passa intocado — o VLOOKUP vai devolver "-" e
 * `refConhecida` avisa antes de o arquivo sair.
 */
export function refDaPlanilha(sku: string): string {
  const cru = sku.trim().toUpperCase();
  const nucleo = cru.replace(/E$/, '').replace(/^0+/, '');
  if (!/^\d+$/.test(nucleo)) return cru;
  return `${nucleo.padStart(4, '0')}E`;
}
