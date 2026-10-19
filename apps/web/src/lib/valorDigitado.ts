/**
 * Um valor em reais como as pessoas DIGITAM: "50000", "50.000", "50k",
 * "50 mil", "R$ 50.000,00", "1.500,50". `null` quando não dá para ler —
 * campo vazio também é `null`.
 *
 * Existe por causa da meta de bonificação (Yan, 19/10/2026: "a meta de 50K
 * não está gerando gráfico e nem salvando"). O campo era `type="number"`: o
 * navegador joga fora "50k" e lê "50.000" de jeitos diferentes conforme o
 * aparelho — a faixa sumia da grade sem aviso, e salvar gravava "sem
 * bonificação".
 */
export function lerValorDigitado(texto: string | null | undefined): number | null {
  let t = (texto ?? '').trim().toLowerCase().replace(/r\$/g, '').replace(/\s+/g, '');
  if (!t) return null;

  let vezes = 1;
  if (/(k|mil)$/.test(t)) {
    vezes = 1000;
    t = t.replace(/(k|mil)$/, '');
  }

  if (t.includes(',')) {
    // Formato brasileiro: ponto é milhar, vírgula é decimal.
    t = t.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(t)) {
    // "50.000" / "1.500.000": só pontos de milhar.
    t = t.replace(/\./g, '');
  }

  if (!/^\d+(\.\d+)?$/.test(t)) return null;
  const valor = Number(t) * vezes;
  return Number.isFinite(valor) ? Math.round(valor * 100) / 100 : null;
}
