/**
 * O código do cadastro no Control (ERP) — a ponte que liga o CRM a este app.
 *
 * O cadastro do representante e o do cliente moram AQUI (e no Control atrás),
 * não no CRM. Por isso o CSP 360 manda para cá com `?busca=<código do ERP>`, e
 * as listas de /representantes e /customers abrem já filtradas nesse código.
 *
 * Só que o mesmo código é digitado nos dois sistemas, por pessoas diferentes e
 * em momentos diferentes: o Control grava "00779" e no CRM alguém digitou
 * "779". Sem normalizar, o link cai numa lista vazia e a pessoa em campo acha
 * que o cadastro sumiu.
 *
 * É um arquivo só, exportado e com teste, porque isto é comparação de DUAS
 * pontas. Estava copiado literalmente nas duas telas: quem mexesse na regra de
 * um lado só faria o link parar de achar o registro CALADO — nada quebra, nada
 * dá erro, simplesmente não encontra, e ninguém descobre até alguém reclamar.
 */

/**
 * " 00779 " → "779". Zeros à esquerda são preenchimento do ERP, não identidade;
 * a caixa também não distingue cadastro (há código com letra).
 */
export function normalizarCodigoErp(v: string | null | undefined): string {
  return (v ?? '').trim().toLowerCase().replace(/^0+/, '');
}

/**
 * É o mesmo cadastro? A comparação é EXATA (e não "contém") de propósito: "7"
 * não pode arrastar meia lista junto.
 *
 * Código vazio nunca casa — nem com outro vazio. Cadastro que ainda não foi
 * atrelado ao Control não pode ser "achado" por uma busca em branco, senão a
 * lista inteira viraria resultado do link.
 */
export function mesmoCodigoErp(
  codigo: string | null | undefined,
  busca: string | null | undefined,
): boolean {
  const a = normalizarCodigoErp(codigo);
  return a !== '' && a === normalizarCodigoErp(busca);
}
