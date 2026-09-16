import { supabase } from '../../config/supabase.js';
import { detectarComCerteza } from '../../lib/detectarColuna.js';
import { apenasDigitos } from '@csb/shared';
import type { ClienteExcluido, VinculosDoCliente, VinculosParaExcluir } from '@csb/shared';

/**
 * Excluir cliente — só admin (decisão do Yan, 16/09/2026, à tarde).
 *
 * O caso de uso é o cadastro em dobro: o mesmo documento no app e no Control,
 * dois clientes na carteira, pedido ora num ora no outro. Apagar um deles não
 * pode levar nada junto, e o banco levaria muita coisa:
 *
 *   users.customer_id           ON DELETE CASCADE   → apagaria o login da loja
 *   store_invites.customer_id   ON DELETE CASCADE   → apagaria os convites
 *   showcase_links.customer_id  ON DELETE SET NULL  → soltaria as vitrines
 *   rep_tasks.customer_id       ON DELETE SET NULL  → soltaria as tarefas
 *   orders.customer_id          sem ON DELETE       → recusaria o DELETE
 *
 * Então: cliente com qualquer vínculo só sai JUNTADO em outro cadastro da
 * mesma empresa, que herda tudo. E antes de mexer em qualquer coisa a linha
 * inteira vai para `deleted_customers` (migração 050) — é por ela que o CRM
 * fica sabendo que o cliente saiu e para onde foram os pedidos.
 *
 * Não há transação pelo PostgREST. Cada passo que muda o banco deixa anotado
 * como se desfaz; se um passo falha, os anteriores são desfeitos do último
 * para o primeiro e a rota responde 500.
 */

/** A pergunta "a 050 rodou?". A coluna `id` existe desde o CREATE TABLE. */
async function sondarMigracao050(): Promise<'existe' | 'nao_existe' | 'nao_sei'> {
  return detectarComCerteza('deleted_customers', 'id');
}

/** `.in('id', …)` vai na URL: lotes pequenos para não estourar o tamanho dela. */
const TAMANHO_DO_LOTE = 100;

/** O PostgREST corta leituras em 1.000 linhas sem avisar. */
const PAGINA = 1000;

function emLotes<T>(itens: T[]): T[][] {
  const lotes: T[][] = [];
  for (let i = 0; i < itens.length; i += TAMANHO_DO_LOTE) lotes.push(itens.slice(i, i + TAMANHO_DO_LOTE));
  return lotes;
}

function mensagem(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}

function ids(data: unknown): string[] {
  return (Array.isArray(data) ? (data as Array<{ id: string }>) : []).map((l) => l.id);
}

// ─── Contagens ───────────────────────────────────────────────────────────────

/** Quantas linhas desta tabela apontam para o cliente. `null` = não deu para contar. */
async function contar(
  tabela: 'orders' | 'users' | 'store_invites' | 'showcase_links' | 'rep_tasks',
  company_id: string,
  customer_id: string,
): Promise<number | null> {
  // `head: true`: só a contagem viaja.
  const { count, error } = await supabase
    .from(tabela)
    .select('id', { count: 'exact', head: true })
    .eq('company_id', company_id)
    .eq('customer_id', customer_id);
  if (error) return null;
  return count ?? 0;
}

/**
 * Tudo o que está preso ao cliente. `null` quando QUALQUER contagem falhou:
 * "não sei se tem login" não pode virar "não tem" — o DELETE apagaria o login.
 *
 * As tabelas e colunas daqui são de migrações antigas (014, 035, 037). A
 * exclusão só roda com a 050 aplicada, e a 050 só roda depois delas.
 */
export async function contarVinculos(company_id: string, customer_id: string): Promise<VinculosDoCliente | null> {
  const [pedidos, logins, convites, vitrines, tarefas] = await Promise.all([
    contar('orders', company_id, customer_id),
    contar('users', company_id, customer_id),
    contar('store_invites', company_id, customer_id),
    contar('showcase_links', company_id, customer_id),
    contar('rep_tasks', company_id, customer_id),
  ]);
  if (pedidos === null || logins === null || convites === null || vitrines === null || tarefas === null) {
    return null;
  }
  return { pedidos, logins, convites, vitrines, tarefas };
}

export function temVinculos(c: VinculosDoCliente): boolean {
  return c.pedidos + c.logins + c.convites + c.vitrines + c.tarefas > 0;
}

export type LeituraDosVinculos =
  | { ok: true; vinculos: VinculosParaExcluir }
  | { ok: false; motivo: 'cliente_nao_encontrado' | 'erro' };

/** O que o diálogo de exclusão mostra antes de o admin confirmar. */
export async function lerVinculosParaExcluir(company_id: string, customer_id: string): Promise<LeituraDosVinculos> {
  const { data: cliente, error } = await supabase
    .from('customers')
    .select('id')
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) return { ok: false, motivo: 'erro' };
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  const contagens = await contarVinculos(company_id, customer_id);
  if (!contagens) return { ok: false, motivo: 'erro' };

  // Na dúvida (banco sem resposta) não diz "migração pendente": a exclusão
  // pergunta de novo e responde 503 se o banco continuar mudo.
  const migracao = await sondarMigracao050();
  return { ok: true, vinculos: { contagens, migracao_pendente: migracao === 'nao_existe' } };
}

// ─── A exclusão ──────────────────────────────────────────────────────────────

export type ExclusaoDeCliente =
  | { ok: true; resultado: ClienteExcluido }
  | {
      ok: false;
      motivo: 'migracao_pendente' | 'banco_indisponivel' | 'cliente_nao_encontrado' | 'juntar_em_invalido';
    }
  | { ok: false; motivo: 'com_vinculos'; contagens: VinculosDoCliente }
  /** Nada foi alterado: falhou antes do primeiro passo que grava. */
  | { ok: false; motivo: 'erro'; detalhe: string }
  /** Falhou depois de começar a gravar; `desfeito` diz se voltou tudo. */
  | { ok: false; motivo: 'falhou_no_meio'; desfeito: boolean; detalhe: string };

export interface PedidoDeExclusao {
  juntar_em?: string | null | undefined;
  motivo?: string | null | undefined;
}

export interface QuemExclui {
  id: string;
  nome: string;
}

interface PassoDesfeito {
  nome: string;
  desfazer: () => Promise<void>;
}

interface LoginDeLoja {
  id: string;
  active: boolean | null;
  last_login_at: string | null;
}

/** Joga o erro do PostgREST para o `catch` da exclusão, com o passo no texto. */
function exigir(passo: string, error: { message: string } | null): void {
  if (error) throw new Error(`${passo}: ${error.message}`);
}

/** Os ids dos pedidos do cliente, em páginas — um cliente antigo pode passar de 1.000. */
async function idsDosPedidos(company_id: string, customer_id: string): Promise<string[]> {
  const todos: string[] = [];
  for (let de = 0; ; de += PAGINA) {
    const { data, error } = await supabase
      .from('orders')
      .select('id')
      .eq('company_id', company_id)
      .eq('customer_id', customer_id)
      .order('id')
      .range(de, de + PAGINA - 1);
    exigir('ler os pedidos do cliente', error);
    const pagina = ids(data);
    todos.push(...pagina);
    if (pagina.length < PAGINA) break;
  }
  return todos;
}

/**
 * Apaga um cliente, juntando antes em `juntar_em` tudo o que aponta para ele.
 *
 * Ordem (cada passo que grava anota como se desfaz):
 *   1. a cópia em deleted_customers — antes de tudo, é o rastro
 *   2. pedidos → juntar_em (com updated_at, que é como o CRM percebe)
 *   3. convites → juntar_em (revogando o pendente do que sai se o que fica já
 *      tem um: o índice único só deixa um pendente por cliente)
 *   4. vitrines e tarefas → juntar_em
 *   5. login de loja: o que fica herda o de acesso mais recente, se não tiver
 *      login; os outros são desligados (active=false, sem cliente) — nunca
 *      apagados, e o índice único idx_users_customer só aceita um por cliente
 *   6. updated_at do que fica
 *   7. DELETE do cliente
 */
export async function excluirCliente(
  company_id: string,
  customer_id: string,
  pedido: PedidoDeExclusao,
  quem: QuemExclui,
): Promise<ExclusaoDeCliente> {
  // Sem a 050 não há onde guardar a cópia — e sem cópia não se apaga nada.
  const migracao = await sondarMigracao050();
  if (migracao === 'nao_existe') return { ok: false, motivo: 'migracao_pendente' };
  if (migracao === 'nao_sei') return { ok: false, motivo: 'banco_indisponivel' };

  // A linha inteira: é ela que vai no snapshot.
  const { data: cliente, error: erroDoCliente } = await supabase
    .from('customers')
    .select('*')
    .eq('id', customer_id)
    .eq('company_id', company_id)
    .maybeSingle<Record<string, unknown>>();
  if (erroDoCliente) return { ok: false, motivo: 'erro', detalhe: erroDoCliente.message };
  if (!cliente) return { ok: false, motivo: 'cliente_nao_encontrado' };

  const juntar_em = pedido.juntar_em || null;
  if (juntar_em) {
    if (juntar_em === customer_id) return { ok: false, motivo: 'juntar_em_invalido' };
    // Da MESMA empresa: um id de outra empresa responde como inexistente.
    const { data: alvo, error } = await supabase
      .from('customers')
      .select('id')
      .eq('id', juntar_em)
      .eq('company_id', company_id)
      .maybeSingle();
    if (error) return { ok: false, motivo: 'erro', detalhe: error.message };
    if (!alvo) return { ok: false, motivo: 'juntar_em_invalido' };
  }

  const contagens = await contarVinculos(company_id, customer_id);
  if (!contagens) return { ok: false, motivo: 'erro', detalhe: 'não deu para contar os vínculos do cliente' };
  if (temVinculos(contagens) && !juntar_em) return { ok: false, motivo: 'com_vinculos', contagens };

  const agora = new Date().toISOString();
  const motivo = pedido.motivo?.trim() || null;
  const cnpj_digits =
    typeof cliente['cnpj_digits'] === 'string' && cliente['cnpj_digits']
      ? cliente['cnpj_digits']
      : apenasDigitos(typeof cliente['cnpj'] === 'string' ? cliente['cnpj'] : '') || null;

  // ─── 1. O rastro ───────────────────────────────────────────────────────────
  const { data: rastro, error: erroDoRastro } = await supabase
    .from('deleted_customers')
    .insert({
      company_id,
      customer_id,
      erp_id: (cliente['erp_id'] as string | null | undefined) ?? null,
      cnpj_digits,
      juntado_em: juntar_em,
      snapshot: cliente,
      pedidos_movidos: juntar_em ? contagens.pedidos : 0,
      deleted_by: quem.id,
      deleted_by_name: quem.nome,
      motivo,
    })
    .select('id')
    .single();
  if (erroDoRastro || !rastro) {
    return { ok: false, motivo: 'erro', detalhe: erroDoRastro?.message ?? 'a cópia do cliente não voltou do banco' };
  }
  const rastro_id = (rastro as { id: string }).id;

  const feitos: PassoDesfeito[] = [];
  const resultado: ClienteExcluido = {
    customer_id,
    juntado_em: juntar_em,
    pedidos_movidos: 0,
    convites_movidos: 0,
    convites_revogados: 0,
    vitrines_movidas: 0,
    tarefas_movidas: 0,
    login_herdado: false,
    logins_desligados: 0,
  };

  try {
    if (juntar_em) {
      // ─── 2. Pedidos ────────────────────────────────────────────────────────
      // Pelos ids lidos, em lotes, com o cliente de origem na condição: o que
      // chegar depois da leitura fica no cliente que sai e o DELETE falha
      // (orders não tem ON DELETE) — aí tudo é desfeito, nada muda de dono
      // pela metade. Pedido com número do Control muda de dono igual.
      const pedidosMovidos: string[] = [];
      for (const lote of emLotes(await idsDosPedidos(company_id, customer_id))) {
        const { data, error } = await supabase
          .from('orders')
          .update({ customer_id: juntar_em, updated_at: agora })
          .eq('company_id', company_id)
          .eq('customer_id', customer_id)
          .in('id', lote)
          .select('id');
        exigir('mover os pedidos', error);
        const movidos = ids(data);
        pedidosMovidos.push(...movidos);
        feitos.push({
          nome: 'devolver os pedidos',
          desfazer: async () => {
            const { error: e } = await supabase
              .from('orders')
              .update({ customer_id, updated_at: new Date().toISOString() })
              .eq('company_id', company_id)
              .in('id', movidos);
            exigir('devolver os pedidos', e);
          },
        });
      }
      resultado.pedidos_movidos = pedidosMovidos.length;

      // A cópia foi gravada com a contagem; se a realidade mudou no meio, vale
      // o que de fato mudou de dono.
      if (resultado.pedidos_movidos !== contagens.pedidos) {
        const { error } = await supabase
          .from('deleted_customers')
          .update({ pedidos_movidos: resultado.pedidos_movidos, updated_at: agora })
          .eq('id', rastro_id)
          .eq('company_id', company_id);
        exigir('corrigir a contagem de pedidos na cópia', error);
      }

      // ─── 3. Convites ───────────────────────────────────────────────────────
      const { data: pendenteDoQueFica, error: erroDoPendente } = await supabase
        .from('store_invites')
        .select('id')
        .eq('company_id', company_id)
        .eq('customer_id', juntar_em)
        .is('used_at', null)
        .is('revoked_at', null)
        .limit(1);
      exigir('ler os convites do cadastro que fica', erroDoPendente);
      if (ids(pendenteDoQueFica).length > 0) {
        const { data, error } = await supabase
          .from('store_invites')
          .update({ revoked_at: agora })
          .eq('company_id', company_id)
          .eq('customer_id', customer_id)
          .is('used_at', null)
          .is('revoked_at', null)
          .select('id');
        exigir('revogar o convite pendente', error);
        const revogados = ids(data);
        resultado.convites_revogados = revogados.length;
        if (revogados.length > 0) {
          feitos.push({
            nome: 'reabrir o convite revogado',
            desfazer: async () => {
              const { error: e } = await supabase
                .from('store_invites')
                .update({ revoked_at: null })
                .eq('company_id', company_id)
                .in('id', revogados);
              exigir('reabrir o convite revogado', e);
            },
          });
        }
      }
      resultado.convites_movidos = (
        await moverPorCliente('store_invites', 'os convites', company_id, customer_id, juntar_em, {}, feitos)
      ).length;

      // ─── 4. Vitrines e tarefas ─────────────────────────────────────────────
      resultado.vitrines_movidas = (
        await moverPorCliente('showcase_links', 'as vitrines', company_id, customer_id, juntar_em, {}, feitos)
      ).length;
      resultado.tarefas_movidas = (
        await moverPorCliente('rep_tasks', 'as tarefas', company_id, customer_id, juntar_em, { updated_at: agora }, feitos)
      ).length;

      // ─── 5. Login de loja ──────────────────────────────────────────────────
      const { data: dosQueSaem, error: erroDosLogins } = await supabase
        .from('users')
        .select('id, active, last_login_at')
        .eq('company_id', company_id)
        .eq('customer_id', customer_id);
      exigir('ler os logins do cliente', erroDosLogins);
      const { data: doQueFica, error: erroDoLoginQueFica } = await supabase
        .from('users')
        .select('id')
        .eq('company_id', company_id)
        .eq('customer_id', juntar_em)
        .limit(1);
      exigir('ler o login do cadastro que fica', erroDoLoginQueFica);

      // O de acesso mais recente primeiro; quem nunca entrou vai para o fim.
      const logins = (Array.isArray(dosQueSaem) ? (dosQueSaem as LoginDeLoja[]) : []).sort((a, b) =>
        (b.last_login_at ?? '').localeCompare(a.last_login_at ?? ''),
      );
      const herdeiro = ids(doQueFica).length === 0 ? logins[0] : undefined;

      if (herdeiro) {
        const { error } = await supabase
          .from('users')
          .update({ customer_id: juntar_em })
          .eq('id', herdeiro.id)
          .eq('company_id', company_id);
        exigir('passar o login para o cadastro que fica', error);
        resultado.login_herdado = true;
        feitos.push({
          nome: 'devolver o login herdado',
          desfazer: async () => {
            const { error: e } = await supabase
              .from('users')
              .update({ customer_id })
              .eq('id', herdeiro.id)
              .eq('company_id', company_id);
            exigir('devolver o login herdado', e);
          },
        });
      }

      for (const login of logins.filter((l) => l !== herdeiro)) {
        const { error } = await supabase
          .from('users')
          .update({ active: false, customer_id: null })
          .eq('id', login.id)
          .eq('company_id', company_id);
        exigir('desligar o login', error);
        resultado.logins_desligados += 1;
        feitos.push({
          nome: 'religar o login',
          desfazer: async () => {
            const { error: e } = await supabase
              .from('users')
              .update({ active: login.active ?? true, customer_id })
              .eq('id', login.id)
              .eq('company_id', company_id);
            exigir('religar o login', e);
          },
        });
      }

      // ─── 6. O que fica mudou ───────────────────────────────────────────────
      // Sem desfazer: um updated_at adiantado só faz o CRM reler o cadastro.
      const { error: erroDoToque } = await supabase
        .from('customers')
        .update({ updated_at: agora })
        .eq('id', juntar_em)
        .eq('company_id', company_id);
      exigir('marcar o cadastro que fica como alterado', erroDoToque);
    }

    // ─── 7. O DELETE ─────────────────────────────────────────────────────────
    const { error: erroDoDelete } = await supabase
      .from('customers')
      .delete()
      .eq('id', customer_id)
      .eq('company_id', company_id);
    exigir('apagar o cliente', erroDoDelete);
  } catch (e) {
    const detalhe = mensagem(e);
    const desfeito = await desfazerTudo(feitos, { company_id, customer_id, rastro_id, motivo }, detalhe);
    return { ok: false, motivo: 'falhou_no_meio', desfeito, detalhe };
  }

  return { ok: true, resultado };
}

/** Move para `para` as linhas desta tabela que apontam para `de`, anotando como devolver. */
async function moverPorCliente(
  tabela: 'store_invites' | 'showcase_links' | 'rep_tasks',
  oQue: string,
  company_id: string,
  de: string,
  para: string,
  extra: Record<string, unknown>,
  feitos: PassoDesfeito[],
): Promise<string[]> {
  const { data, error } = await supabase
    .from(tabela)
    .update({ customer_id: para, ...extra })
    .eq('company_id', company_id)
    .eq('customer_id', de)
    .select('id');
  exigir(`mover ${oQue}`, error);
  const movidos = ids(data);
  if (movidos.length > 0) {
    feitos.push({
      nome: `devolver ${oQue}`,
      desfazer: async () => {
        for (const lote of emLotes(movidos)) {
          const extraDeVolta = 'updated_at' in extra ? { updated_at: new Date().toISOString() } : {};
          const { error: e } = await supabase
            .from(tabela)
            .update({ customer_id: de, ...extraDeVolta })
            .eq('company_id', company_id)
            .in('id', lote);
          exigir(`devolver ${oQue}`, e);
        }
      },
    });
  }
  return movidos;
}

/**
 * Desfaz do último passo para o primeiro. Um passo que falha não para os
 * outros: devolver o máximo possível é melhor que parar no primeiro erro.
 *
 * A cópia em deleted_customers só sai quando TUDO voltou — aí o cliente
 * continua existindo e a cópia mentiria ao CRM. Se algo ficou pela metade, a
 * cópia fica (é o único registro de onde vieram os pedidos movidos) e ganha no
 * motivo o aviso de que a exclusão não terminou.
 */
async function desfazerTudo(
  feitos: PassoDesfeito[],
  alvo: { company_id: string; customer_id: string; rastro_id: string; motivo: string | null },
  detalhe: string,
): Promise<boolean> {
  const { company_id, customer_id, rastro_id } = alvo;
  const falhas: string[] = [];
  for (const passo of [...feitos].reverse()) {
    try {
      await passo.desfazer();
    } catch (e) {
      falhas.push(`${passo.nome}: ${mensagem(e)}`);
    }
  }

  if (falhas.length === 0) {
    const { error } = await supabase
      .from('deleted_customers')
      .delete()
      .eq('id', rastro_id)
      .eq('company_id', company_id);
    if (!error) return true;
    falhas.push(`apagar a cópia da exclusão que não aconteceu: ${error.message}`);
  }

  // A cópia ficou: diz nela mesma que a exclusão não terminou, para o CRM (e
  // quem abrir a tabela) não tratar o cliente como excluído sem conferir.
  const { error: erroDaAnotacao } = await supabase
    .from('deleted_customers')
    .update({
      motivo: `${alvo.motivo ? `${alvo.motivo} | ` : ''}EXCLUSÃO NÃO CONCLUÍDA (${detalhe}). Desfazer incompleto: ${falhas.join('; ')}`,
      updated_at: new Date().toISOString(),
    })
    .eq('id', rastro_id)
    .eq('company_id', company_id);
  if (erroDaAnotacao) falhas.push(`anotar a cópia: ${erroDaAnotacao.message}`);

  // Só ids no log: nada de nome ou documento de cliente.
  console.error(
    `[excluir-cliente] cliente ${customer_id}: falhou em "${detalhe}" e o desfazer ficou incompleto — ${falhas.join('; ')}`,
  );
  return false;
}
