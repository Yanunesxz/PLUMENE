/**
 * O número do pedido NO CONTROL — duas letras e a numeração ("SX14627").
 *
 * Quem cunha esse número é o ERP do Fábio, nunca o app. Quando a Larissa lança
 * o pedido (importa a planilha no Control), ela digita aqui o número que o
 * Control deu — e o app ajuda a seguir a ordem de lá: sugere o próximo a partir
 * do último lançado e avisa quando o digitado anda para trás. (Yan,
 * 10/09/2026: "no Fábio costuma ser duas letras e a numeração na frente; toda
 * vez que ela for lançar tem que seguir o padrão e a ordem de lá".)
 */

const FORMATO = /^([A-Z]{2})(\d{1,10})$/;

/** "sx 14627" → "SX14627". Não valida — só limpa. */
export function normalizarNumeroErp(v: string | null | undefined): string {
  return (v ?? '').toUpperCase().replace(/[\s.\-/]/g, '');
}

export function numeroErpValido(v: string | null | undefined): boolean {
  return FORMATO.test(normalizarNumeroErp(v));
}

export interface NumeroErp {
  prefixo: string;
  numero: number;
}

export function lerNumeroErp(v: string | null | undefined): NumeroErp | null {
  const m = FORMATO.exec(normalizarNumeroErp(v));
  if (!m) return null;
  return { prefixo: m[1]!, numero: Number(m[2]) };
}

/**
 * O próximo da sequência: mesmo prefixo, número + 1, com os zeros à esquerda
 * que o último tinha ("SX00099" → "SX00100"). Sem último, não há o que sugerir.
 */
export function proximoNumeroErp(ultimo: string | null | undefined): string {
  const lido = lerNumeroErp(ultimo);
  if (!lido) return '';
  const digitos = normalizarNumeroErp(ultimo).slice(2);
  return `${lido.prefixo}${String(lido.numero + 1).padStart(digitos.length, '0')}`;
}

/**
 * O digitado respeita a ordem de lá? `null` quando não dá para comparar
 * (prefixos diferentes ou sem último) — aí não se avisa nada.
 */
export function seguemAOrdem(ultimo: string | null | undefined, digitado: string): boolean | null {
  const a = lerNumeroErp(ultimo);
  const b = lerNumeroErp(digitado);
  if (!a || !b || a.prefixo !== b.prefixo) return null;
  return b.numero > a.numero;
}
