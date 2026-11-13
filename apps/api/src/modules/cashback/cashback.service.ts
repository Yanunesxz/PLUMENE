import type { AuthRole, OrderStatus, CreditoDeCashback, UsoDeCashback, ExtratoDeCashback } from '@csb/shared';
import {
  CASHBACK_PERCENTUAL,
  CASHBACK_VALIDADE_DIAS,
  creditoDoPedido,
  montarExtrato,
  observacaoComCashback,
  observacaoSemCashback,
  podeMexerNoPedido,
  podeUsarCashback,
  vencimentoDoCredito,
} from '@csb/shared';
import { supabase } from '../../config/supabase.js';
import { detectar } from '../../lib/detectarColuna.js';
import { buscarPorIdsOuFalhar, buscarTudoOuFalhar } from '../../lib/paginacao.js';
import { garantirFotoDoErp } from '../orders/erpSync.service.js';

/**
 * CASHBACK DA VENDA INTERNA (058). A regra (3%, 90 dias, o consumo do crédito
 * mais velho primeiro) mora no @csb/shared — aqui é só a leitura do banco e a
 * gravação do uso.
 *
 * O crédito é LIDO dos pedidos faturados da venda interna; nada aqui é chamado
 * por quem fatura. As leituras usam as variantes "OuFalhar": saldo é dinheiro,
 * e uma página que falhou não pode virar "o cliente tem menos" (ou "mais", que
 * deixaria abater o que não existe). Banco sem resposta = erro, a tela tenta
 * de novo.
 */

export class CashbackSemMigracao extends Error {
  constructor() {
    super('A migração 058 (cashback) ainda não rodou neste banco');
  }
}

export interface ProgramaDeCashback {
  percentual: number;
  validade_dias: number;
  /** Só pedido faturado a partir daqui gera crédito. */
  inicio: string | null;
}

export interface ClienteDoCashback {
  customer_id: string;
  nome: string;
  fantasia: string | null;
  erp_id: string | null;
}

export interface LinhaDaListaDeCashback extends ClienteDoCashback {
  saldo: number;
  total_ganho: number;
  total_usado: number;
  total_vencido: number;
  vencendo_logo: number;
  proximo_vencimento: ExtratoDeCashback['proximo_vencimento'];
}

interface PedidoLido {
  id: string;
  order_number: number | null;
  customer_id: string | null;
  rep_id: string;
  status: OrderStatus;
  invoiced: boolean | null;
  invoiced_at: string | null;
  invoiced_total: number | null;
  total: number | null;
  inactive?: boolean | null;
}

interface UsoLido {
  id: string;
  order_id: string;
  valor: number | string;
  usado_em: string;
  usado_por_nome: string | null;
}

/** A 058 rodou? (a tabela de usos é o que só ela cria) */
async function exigirMigracao(): Promise<void> {
  if (!(await detectar('cashback_usos'))) throw new CashbackSemMigracao();
}

export async function lerPrograma(company_id: string): Promise<ProgramaDeCashback> {
  await exigirMigracao();
  const { data, error } = await supabase
    .from('companies')
    .select('cashback_inicio')
    .eq('id', company_id)
    .maybeSingle();
  if (error) throw new Error(`cashback: empresa ilegível (${error.message})`);
  const inicio = (data as { cashback_inicio: string | null } | null)?.cashback_inicio ?? null;
  return { percentual: CASHBACK_PERCENTUAL, validade_dias: CASHBACK_VALIDADE_DIAS, inicio };
}

/** Os logins de venda interna da empresa — só os pedidos deles geram cashback. */
async function vendedoresInternos(company_id: string): Promise<Set<string>> {
  const linhas = await buscarTudoOuFalhar<{ id: string }>((de, ate) =>
    supabase.from('users').select('id').eq('company_id', company_id).eq('venda_interna', true).range(de, ate),
  );
  return new Set(linhas.map((l) => l.id));
}

/**
 * Os pedidos faturados da venda interna desde o início do programa, que viram
 * os créditos. Com `customer_id`, só os desse cliente.
 */
async function creditosLidos(
  company_id: string,
  programa: ProgramaDeCashback,
  customer_id?: string,
): Promise<Map<string, CreditoDeCashback[]>> {
  const internos = await vendedoresInternos(company_id);
  const porCliente = new Map<string, CreditoDeCashback[]>();
  if (internos.size === 0) return porCliente;

  // O carimbo de inativo (055) pode ainda não existir no banco: sem ele,
  // ninguém está inativo.
  const comInativo = await detectar('orders', 'inactive');
  const colunas = `id, order_number, customer_id, rep_id, status, invoiced, invoiced_at, invoiced_total, total${comInativo ? ', inactive' : ''}`;

  const pedidos = await buscarPorIdsOuFalhar<PedidoLido>([...internos], (lote, de, ate) => {
    let q = supabase
      .from('orders')
      .select(colunas)
      .eq('company_id', company_id)
      .eq('invoiced', true)
      .in('rep_id', lote)
      .not('customer_id', 'is', null);
    if (programa.inicio) q = q.gte('invoiced_at', programa.inicio);
    if (customer_id) q = q.eq('customer_id', customer_id);
    return q.order('invoiced_at', { ascending: true }).range(de, ate);
  });

  for (const p of pedidos) {
    if (!p.customer_id || !p.invoiced_at) continue;
    const valor = creditoDoPedido(
      {
        status: p.status,
        invoiced: p.invoiced,
        invoiced_at: p.invoiced_at,
        invoiced_total: p.invoiced_total == null ? null : Number(p.invoiced_total),
        total: p.total == null ? null : Number(p.total),
        inactive: p.inactive ?? false,
        rep_id: p.rep_id,
      },
      { inicio: programa.inicio, vendaInterna: internos },
    );
    if (valor == null) continue;
    const lista = porCliente.get(p.customer_id) ?? [];
    lista.push({
      order_id: p.id,
      order_number: p.order_number,
      faturado_em: p.invoiced_at,
      valor_faturado: Number(p.invoiced_total ?? p.total ?? 0),
      valor,
      vence_em: vencimentoDoCredito(p.invoiced_at),
    });
    porCliente.set(p.customer_id, lista);
  }
  return porCliente;
}

/**
 * Os usos de cashback da empresa, por cliente. O cliente é o DO PEDIDO (o uso
 * não guarda cliente), e o uso em pedido cancelado não conta — o cashback volta.
 */
async function usosLidos(company_id: string, customer_id?: string): Promise<Map<string, UsoDeCashback[]>> {
  const usos = await buscarTudoOuFalhar<UsoLido>((de, ate) =>
    supabase
      .from('cashback_usos')
      .select('id, order_id, valor, usado_em, usado_por_nome')
      .eq('company_id', company_id)
      .order('usado_em', { ascending: true })
      .range(de, ate),
  );
  const porCliente = new Map<string, UsoDeCashback[]>();
  if (usos.length === 0) return porCliente;

  const pedidos = await buscarPorIdsOuFalhar<{ id: string; customer_id: string | null; order_number: number | null; status: OrderStatus }>(
    [...new Set(usos.map((u) => u.order_id))],
    (lote, de, ate) =>
      supabase
        .from('orders')
        .select('id, customer_id, order_number, status')
        .eq('company_id', company_id)
        .in('id', lote)
        .range(de, ate),
  );
  const pedidoPorId = new Map(pedidos.map((p) => [p.id, p]));

  for (const u of usos) {
    const p = pedidoPorId.get(u.order_id);
    if (!p?.customer_id || p.status === 'rejected') continue;
    if (customer_id && p.customer_id !== customer_id) continue;
    const lista = porCliente.get(p.customer_id) ?? [];
    lista.push({
      id: u.id,
      order_id: u.order_id,
      order_number: p.order_number,
      valor: Number(u.valor),
      usado_em: u.usado_em,
      usado_por_nome: u.usado_por_nome,
    });
    porCliente.set(p.customer_id, lista);
  }
  return porCliente;
}

async function clientesPorId(company_id: string, ids: string[]): Promise<Map<string, ClienteDoCashback>> {
  if (ids.length === 0) return new Map();
  const linhas = await buscarPorIdsOuFalhar<{ id: string; name: string; trade_name: string | null; erp_id: string | null }>(
    ids,
    (lote, de, ate) =>
      supabase.from('customers').select('id, name, trade_name, erp_id').eq('company_id', company_id).in('id', lote).range(de, ate),
  );
  return new Map(
    linhas.map((c) => [c.id, { customer_id: c.id, nome: c.name, fantasia: c.trade_name, erp_id: c.erp_id }]),
  );
}

/** A área Cashback: todo cliente que já ganhou cashback, com o saldo de agora. */
export async function listarClientesComCashback(
  company_id: string,
  agora: Date = new Date(),
): Promise<{ programa: ProgramaDeCashback; clientes: LinhaDaListaDeCashback[] }> {
  const programa = await lerPrograma(company_id);
  const [creditos, usos] = await Promise.all([creditosLidos(company_id, programa), usosLidos(company_id)]);
  const ids = [...creditos.keys()];
  const clientes = await clientesPorId(company_id, ids);

  const linhas: LinhaDaListaDeCashback[] = [];
  for (const id of ids) {
    const cliente = clientes.get(id);
    if (!cliente) continue;
    const e = montarExtrato(creditos.get(id) ?? [], usos.get(id) ?? [], agora);
    linhas.push({
      ...cliente,
      saldo: e.saldo,
      total_ganho: e.total_ganho,
      total_usado: e.total_usado,
      total_vencido: e.total_vencido,
      vencendo_logo: e.vencendo_logo,
      proximo_vencimento: e.proximo_vencimento,
    });
  }
  // Quem tem saldo primeiro; entre eles, o que vence antes.
  linhas.sort((a, b) => {
    if ((b.saldo > 0 ? 1 : 0) !== (a.saldo > 0 ? 1 : 0)) return (b.saldo > 0 ? 1 : 0) - (a.saldo > 0 ? 1 : 0);
    const va = a.proximo_vencimento ? Date.parse(a.proximo_vencimento.vence_em) : Infinity;
    const vb = b.proximo_vencimento ? Date.parse(b.proximo_vencimento.vence_em) : Infinity;
    return va - vb || a.nome.localeCompare(b.nome, 'pt-BR');
  });
  return { programa, clientes: linhas };
}

/** O extrato de UM cliente (a área, a Minha área da loja e o cartão do pedido). */
export async function extratoDoCliente(
  company_id: string,
  customer_id: string,
  agora: Date = new Date(),
): Promise<{ programa: ProgramaDeCashback; cliente: ClienteDoCashback | null; extrato: ExtratoDeCashback }> {
  const programa = await lerPrograma(company_id);
  const [creditos, usos, clientes] = await Promise.all([
    creditosLidos(company_id, programa, customer_id),
    usosLidos(company_id, customer_id),
    clientesPorId(company_id, [customer_id]),
  ]);
  return {
    programa,
    cliente: clientes.get(customer_id) ?? null,
    extrato: montarExtrato(creditos.get(customer_id) ?? [], usos.get(customer_id) ?? [], agora),
  };
}

// ─── O cashback no pedido ────────────────────────────────────────────────────

interface PedidoParaUso {
  id: string;
  order_number: number | null;
  customer_id: string | null;
  rep_id: string;
  status: OrderStatus;
  invoiced: boolean | null;
  total: number | null;
  notes: string | null;
}

async function lerPedido(id: string, company_id: string): Promise<PedidoParaUso | null> {
  const { data, error } = await supabase
    .from('orders')
    .select('id, order_number, customer_id, rep_id, status, invoiced, total, notes')
    .eq('id', id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) throw new Error(`cashback: pedido ilegível (${error.message})`);
  return (data as PedidoParaUso | null) ?? null;
}

async function usoDoPedido(order_id: string, company_id: string): Promise<UsoLido | null> {
  const { data, error } = await supabase
    .from('cashback_usos')
    .select('id, order_id, valor, usado_em, usado_por_nome')
    .eq('order_id', order_id)
    .eq('company_id', company_id)
    .maybeSingle();
  if (error) throw new Error(`cashback: uso ilegível (${error.message})`);
  return (data as UsoLido | null) ?? null;
}

export interface Quem {
  id: string;
  role: AuthRole;
  venda_interna: boolean;
  nome: string;
}

/** Por que o botão "Usar cashback" não aparece / a rota recusa. */
export type MotivoSemUso = 'sem_permissao' | 'pedido_fechado' | 'sem_cliente' | 'sem_saldo' | 'ja_usado';

function motivoParaUsar(p: PedidoParaUso, quem: Quem): MotivoSemUso | null {
  if (!podeUsarCashback(quem.role, quem.venda_interna)) return 'sem_permissao';
  if (!p.customer_id) return 'sem_cliente';
  const acesso = podeMexerNoPedido(p, quem.role, quem.id, quem.venda_interna);
  if (acesso === 'forbidden') return 'sem_permissao';
  if (acesso !== 'ok') return 'pedido_fechado';
  return null;
}

export interface CashbackDoPedido {
  programa: ProgramaDeCashback;
  cliente: ClienteDoCashback | null;
  extrato: ExtratoDeCashback | null;
  uso: UsoDeCashback | null;
  /** O teto do "Usar": o menor entre o saldo e o total do pedido. */
  limite: number;
  /** null = pode usar agora. */
  sem_uso: MotivoSemUso | null;
  /** Pode desfazer o uso deste pedido (mesma janela de mexer na observação). */
  pode_desfazer: boolean;
}

/** O cartão de cashback na tela do pedido. `null` = pedido não existe. */
export async function cashbackDoPedido(
  order_id: string,
  company_id: string,
  quem: Quem,
): Promise<CashbackDoPedido | null> {
  const programa = await lerPrograma(company_id);
  const p = await lerPedido(order_id, company_id);
  if (!p) return null;
  const usoLido = await usoDoPedido(order_id, company_id);
  const uso: UsoDeCashback | null = usoLido
    ? {
        id: usoLido.id,
        order_id: usoLido.order_id,
        order_number: p.order_number,
        valor: Number(usoLido.valor),
        usado_em: usoLido.usado_em,
        usado_por_nome: usoLido.usado_por_nome,
      }
    : null;

  if (!p.customer_id) {
    return { programa, cliente: null, extrato: null, uso, limite: 0, sem_uso: 'sem_cliente', pode_desfazer: false };
  }
  const { cliente, extrato } = await extratoDoCliente(company_id, p.customer_id);
  const motivo = motivoParaUsar(p, quem);
  const limite = Math.min(extrato.saldo, Math.max(0, Number(p.total ?? 0)));
  const sem_uso: MotivoSemUso | null = uso ? 'ja_usado' : (motivo ?? (limite > 0 ? null : 'sem_saldo'));
  return { programa, cliente, extrato, uso, limite, sem_uso, pode_desfazer: !!uso && motivo === null };
}

export type ResultadoDoUso =
  | { ok: true; uso: UsoDeCashback; notes: string }
  | { ok: false; reason: 'not_found' | MotivoSemUso | 'acima_do_saldo' | 'acima_do_total' | 'falhou' };

/**
 * Usa o cashback do cliente neste pedido: grava o uso (um por pedido — o
 * UNIQUE segura o toque duplo) e escreve "Utilizado R$ X do cashback" na
 * observação. Se a observação não grava, o uso é desfeito.
 */
export async function usarCashback(
  order_id: string,
  company_id: string,
  quem: Quem,
  valorPedido: number,
): Promise<ResultadoDoUso> {
  await exigirMigracao();
  const p = await lerPedido(order_id, company_id);
  if (!p) return { ok: false, reason: 'not_found' };
  const motivo = motivoParaUsar(p, quem);
  if (motivo) return { ok: false, reason: motivo };
  if (await usoDoPedido(order_id, company_id)) return { ok: false, reason: 'ja_usado' };

  const valor = Math.round(valorPedido * 100) / 100;
  const { extrato } = await extratoDoCliente(company_id, p.customer_id as string);
  if (valor > extrato.saldo) return { ok: false, reason: 'acima_do_saldo' };
  if (valor > Number(p.total ?? 0)) return { ok: false, reason: 'acima_do_total' };

  const { data: gravado, error } = await supabase
    .from('cashback_usos')
    .insert({ company_id, order_id, valor, usado_por: quem.id, usado_por_nome: quem.nome })
    .select('id, order_id, valor, usado_em, usado_por_nome')
    .single();
  if (error || !gravado) {
    // 23505 = o UNIQUE do pedido: outro toque gravou primeiro.
    if ((error as { code?: string } | null)?.code === '23505') return { ok: false, reason: 'ja_usado' };
    return { ok: false, reason: 'falhou' };
  }
  const uso = gravado as UsoLido;

  // Pedido já lançado sem a foto do que o Control conhece: ela sai antes de
  // mexer, para o "Atualizar no ERP" acusar a linha nova. Falhou, segue (a
  // regra de 23/09/2026: nada trava a venda).
  if ((await garantirFotoDoErp(p, company_id)) === 'falhou') {
    console.error(`[058] sem foto do Control para o pedido ${p.id}; o cashback segue sem ela`);
  }

  const notes = observacaoComCashback(p.notes, valor);
  const { error: erroNotas } = await supabase
    .from('orders')
    .update({ notes, updated_at: new Date().toISOString() })
    .eq('id', order_id)
    .eq('company_id', company_id);
  if (erroNotas) {
    await supabase.from('cashback_usos').delete().eq('id', uso.id);
    return { ok: false, reason: 'falhou' };
  }

  return {
    ok: true,
    notes,
    uso: {
      id: uso.id,
      order_id,
      order_number: p.order_number,
      valor: Number(uso.valor),
      usado_em: uso.usado_em,
      usado_por_nome: uso.usado_por_nome,
    },
  };
}

export type ResultadoDoDesfazer = { ok: true; notes: string } | { ok: false; reason: 'not_found' | 'sem_uso' | MotivoSemUso | 'falhou' };

/**
 * Desfaz o uso: tira a linha da observação e só então apaga o uso — se o
 * apagar falhar, a observação volta. A ordem é a que nunca dá o cashback em
 * dobro (linha no pedido + saldo de volta).
 */
export async function desfazerUsoDeCashback(order_id: string, company_id: string, quem: Quem): Promise<ResultadoDoDesfazer> {
  await exigirMigracao();
  const p = await lerPedido(order_id, company_id);
  if (!p) return { ok: false, reason: 'not_found' };
  const uso = await usoDoPedido(order_id, company_id);
  if (!uso) return { ok: false, reason: 'sem_uso' };
  const motivo = motivoParaUsar(p, quem);
  if (motivo && motivo !== 'sem_cliente') return { ok: false, reason: motivo };

  if ((await garantirFotoDoErp(p, company_id)) === 'falhou') {
    console.error(`[058] sem foto do Control para o pedido ${p.id}; desfazer o cashback segue sem ela`);
  }

  const notes = observacaoSemCashback(p.notes);
  const agora = new Date().toISOString();
  const { error: erroNotas } = await supabase
    .from('orders')
    .update({ notes: notes || null, updated_at: agora })
    .eq('id', order_id)
    .eq('company_id', company_id);
  if (erroNotas) return { ok: false, reason: 'falhou' };

  const { error } = await supabase.from('cashback_usos').delete().eq('id', uso.id);
  if (error) {
    await supabase.from('orders').update({ notes: p.notes, updated_at: agora }).eq('id', order_id).eq('company_id', company_id);
    return { ok: false, reason: 'falhou' };
  }
  return { ok: true, notes };
}
