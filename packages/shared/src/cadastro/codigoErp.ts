/**
 * O código de um cadastro no Control (cliente, representante, tabela de preço).
 *
 * O mesmo código chega escrito de jeitos diferentes: o Control grava "02225",
 * a planilha traz "2225", alguém digitou "#2225" ou " 02225 ". São o MESMO
 * cadastro. Havia quatro normalizações espalhadas (API do parceiro, serviço de
 * clientes, tela e script de carga), cada uma com um detalhe diferente — e
 * quando duas pontas discordam o casamento falha CALADO: nasce um cliente
 * duplicado ou o link não acha ninguém.
 *
 * Duas funções, dois usos:
 *
 *   • codigoMiolo    → para CASAR. Nunca é gravado.
 *   • codigoCanonico → para GRAVAR. Uma grafia só no banco.
 *
 * A regra do miolo existe também no banco, em public.codigo_miolo() (migração
 * 048), que sustenta o índice único de price_tables.erp_code. As duas precisam
 * ser idênticas: tests/codigo-miolo.test.ts confere a paridade com os casos da
 * consulta de conferência da 048.
 */

/**
 * Espaços que o `[[:space:]]` do Postgres reconhece. Explícitos (e não `\s`)
 * para o app e o banco tirarem exatamente os mesmos caracteres.
 */
const SEM_CERQUILHA_E_ESPACO = /[#\t\n\v\f\r ]/g;

/** Texto da entrada sem "#" e sem espaço nenhum (nas pontas ou no meio), em maiúscula. */
function limpar(v: unknown): string {
  if (v == null) return '';
  return String(v).toUpperCase().replace(SEM_CERQUILHA_E_ESPACO, '');
}

/**
 * O miolo do código, para casar grafias diferentes do mesmo cadastro.
 *
 * Tira "#" e espaços, passa para maiúscula e tira os zeros à esquerda.
 * Só zeros vira "0" (é um código, não um vazio). Vazio vira `null`.
 *
 *   "#02225" → "2225"   " 00779 " → "779"   "cs 779" → "CS779"
 *   "000"    → "0"      "#"       → null    ""       → null
 */
export function codigoMiolo(v: unknown): string | null {
  const s = limpar(v);
  if (s === '') return null;
  const semZeros = s.replace(/^0+/, '');
  return semZeros === '' ? '0' : semZeros;
}

/**
 * A grafia que vai para o banco.
 *
 * Só dígitos → o miolo completado com zeros à esquerda até 5 ("779" e
 * "0000779" gravam "00779"; código com mais de 5 dígitos fica como está, sem
 * os zeros de sobra). Com letra → maiúscula, sem "#" e sem espaços ("cs 779"
 * grava "CS779"; os zeros de um código com letra são mantidos). Vazio → `null`.
 *
 * Dois códigos com o mesmo miolo só-dígitos sempre gravam igual.
 */
export function codigoCanonico(v: unknown): string | null {
  const s = limpar(v);
  if (s === '') return null;
  if (/^\d+$/.test(s)) return (codigoMiolo(s) ?? '0').padStart(5, '0');
  return s;
}

/** É o mesmo cadastro? Vazio nunca casa, nem com outro vazio. */
export function mesmoCodigo(a: unknown, b: unknown): boolean {
  const ma = codigoMiolo(a);
  return ma !== null && ma === codigoMiolo(b);
}
