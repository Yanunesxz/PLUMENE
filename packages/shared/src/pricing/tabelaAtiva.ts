/**
 * Tabela de preço desativada no Control (migração 049, `price_tables.active`).
 *
 * A regra tem duas metades, e as duas importam:
 *
 *  • ninguém ESCOLHE uma tabela inativa — ela some do cadastro de cliente, da
 *    troca de tabela, do conjunto do representante e do seletor do catálogo;
 *  • quem JÁ está nela continua nela. O cliente cadastrado na tabela e o pedido
 *    precificado por ela não mudam de preço porque o Control a desligou — só
 *    passam a mostrar a marca, para ninguém achar que é uma tabela vigente.
 *
 * `active` ausente (banco sem a 049) conta como ativa: é a lista de hoje.
 */

/** O que aparece depois do nome de uma tabela desligada no Control. */
export const MARCA_DE_TABELA_INATIVA = '(inativa no Control)';

/** Ausente ou nulo conta como ativa — só `false` explícito desliga. */
export function tabelaEstaAtiva(tabela: { active?: boolean | null | undefined }): boolean {
  return tabela.active !== false;
}

/** As tabelas que podem ser OFERECIDAS numa escolha. Mantém a ordem recebida. */
export function tabelasEscolhiveis<T extends { active?: boolean | null | undefined }>(
  tabelas: readonly T[],
): T[] {
  return tabelas.filter(tabelaEstaAtiva);
}

/**
 * A tabela `id` é do conjunto e foi desligada no Control? `false` quando não
 * há id ou a tabela não é do conjunto (não dá para dizer nada dela).
 */
export function tabelaInativaNoConjunto(
  tabelas: readonly { id: string; active?: boolean | null | undefined }[],
  id: string | null | undefined,
): boolean {
  if (!id) return false;
  const tabela = tabelas.find((t) => t.id === id);
  return tabela ? !tabelaEstaAtiva(tabela) : false;
}

/**
 * Dá para TROCAR a tabela do cliente que está em `atual`?
 *
 * Com duas ou mais ativas, sempre (é a escolha de sempre). Com uma ativa só, a
 * escolha normalmente não existe — mas o cliente que ficou numa tabela
 * desligada no Control precisa poder passar para a ativa (revisão de
 * 16/09/2026): quem tinha duas tabelas e perdeu uma não pode ficar preso nela.
 * Mostrar a ativa não conta nada de novo: ele já vê as duas.
 */
export function podeTrocarTabelaDoCliente(
  tabelas: readonly { id: string; active?: boolean | null | undefined }[],
  atual: string | null | undefined,
): boolean {
  const ativas = tabelasEscolhiveis(tabelas);
  if (ativas.length >= 2) return true;
  return tabelaInativaNoConjunto(tabelas, atual) && ativas.some((t) => t.id !== atual);
}

/** O nome para exibir: o da tabela, com a marca quando o Control a desligou. */
export function rotuloDaTabela(tabela: {
  name: string;
  active?: boolean | null | undefined;
}): string {
  return tabelaEstaAtiva(tabela) ? tabela.name : `${tabela.name} ${MARCA_DE_TABELA_INATIVA}`;
}
