import type { ClienteExcluido, CustomerListItem, VinculosDoCliente } from '@csb/shared';
import { apenasDigitos } from '@csb/shared';

/**
 * As contas do diálogo "Excluir cliente" (só admin), fora do componente para
 * serem testadas sem navegador.
 */

export function totalDeVinculos(c: VinculosDoCliente): number {
  return c.pedidos + c.logins + c.convites + c.vitrines + c.tarefas;
}

function contar(n: number, um: string, varios: string): string {
  return `${n} ${n === 1 ? um : varios}`;
}

/** "2 pedidos", "1 login de loja"… — só o que existe, na ordem do que mais pesa. */
export function frasesDosVinculos(c: VinculosDoCliente): string[] {
  const frases: string[] = [];
  if (c.pedidos) frases.push(contar(c.pedidos, 'pedido', 'pedidos'));
  if (c.logins) frases.push(contar(c.logins, 'login de loja', 'logins de loja'));
  if (c.convites) frases.push(contar(c.convites, 'convite de acesso', 'convites de acesso'));
  if (c.vitrines) frases.push(contar(c.vitrines, 'vitrine', 'vitrines'));
  if (c.tarefas) frases.push(contar(c.tarefas, 'tarefa', 'tarefas'));
  return frases;
}

/**
 * Os cadastros que podem ficar no lugar deste: outros clientes, nunca ele
 * mesmo. Com `documento`, só os do MESMO documento (a API já filtra; aqui é a
 * segunda trava, para uma resposta antiga não oferecer cliente de outro CNPJ).
 */
export function candidatosAFicar(
  lista: CustomerListItem[],
  customer_id: string,
  documento?: string | null,
): CustomerListItem[] {
  const digitos = documento ? apenasDigitos(documento) : '';
  return lista.filter(
    (c) => c.id !== customer_id && (!digitos || apenasDigitos(c.cnpj) === digitos),
  );
}

/** O aviso que a lista de clientes mostra depois de excluir. */
export function avisoDaExclusao(nome: string, r: ClienteExcluido, nomeQueFica: string | null): string {
  if (!r.juntado_em) return `${nome} foi excluído.`;
  const movidos = frasesDosVinculos({
    pedidos: r.pedidos_movidos,
    logins: r.login_herdado ? 1 : 0,
    convites: r.convites_movidos,
    vitrines: r.vitrines_movidas,
    tarefas: r.tarefas_movidas,
  });
  const destino = nomeQueFica ?? 'o cadastro escolhido';
  const extra = r.logins_desligados
    ? ` ${contar(r.logins_desligados, 'login de loja foi desligado', 'logins de loja foram desligados')}.`
    : '';
  return movidos.length
    ? `${nome} foi excluído e juntado em ${destino}, que ficou com ${emLista(movidos)}.${extra}`
    : `${nome} foi excluído e juntado em ${destino}.${extra}`;
}

/** "a", "a e b", "a, b e c". */
function emLista(itens: string[]): string {
  if (itens.length <= 1) return itens.join('');
  return `${itens.slice(0, -1).join(', ')} e ${itens[itens.length - 1]}`;
}
