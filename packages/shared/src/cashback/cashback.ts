import type { AuthRole } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';

/**
 * CASHBACK DA VENDA INTERNA (migração 058). Pedido do Yan, 12/11/2026:
 *
 *   - "só vendedores internos que passam para os clientes, o valor do cashback
 *     aparece para os dois" — o crédito é do CLIENTE e nasce dos pedidos da
 *     venda interna; quem passa para o cliente é o vendedor interno, e os dois
 *     enxergam o saldo (a venda interna na área Cashback, a loja na Minha área);
 *   - calculado sobre o VALOR FATURADO (a nota), 3% "acima de qualquer valor";
 *   - "abate no próximo pedido" e "aparece na obs do pedido assim: utilizado
 *     tantos reais do cashback" — o uso NÃO mexe no desconto nem no total: vira
 *     uma linha na observação, que vai ao Control no rodapé da planilha e no
 *     `observacoes` da API;
 *   - "o cashback de um pedido de 1000 só é válido até 90 dias depois daquele
 *     pedido, e tem que avisar isso" — cada crédito tem o seu vencimento.
 *
 * O crédito NÃO é gravado: ele é lido do próprio pedido faturado (valor da
 * nota, data do carimbo). Assim nenhum dos caminhos que faturam — a tela, a
 * API de Parceiro, o desfazer — precisa saber que o cashback existe: desfez o
 * faturado, o crédito some sozinho; inativou ou cancelou, também. Só o USO é
 * gravado (tabela `cashback_usos`, um por pedido), porque ele é uma decisão de
 * alguém.
 *
 * Os 90 dias contam do FATURAMENTO: é quando o crédito passa a existir. Contar
 * da data do pedido deixaria o tempo de fábrica comer a validade.
 */

/** 3% do valor faturado (Yan, 12/11/2026: "3% acima de qualquer valor"). */
export const CASHBACK_PERCENTUAL = 3;

/** Cada crédito vale 90 dias a partir do faturamento do pedido que o gerou. */
export const CASHBACK_VALIDADE_DIAS = 90;

/** A partir de quantos dias para vencer a tela avisa "vence logo". */
export const CASHBACK_AVISO_DIAS = 15;

const DIA_MS = 24 * 60 * 60 * 1000;

/** Reais → centavos inteiros: toda a conta é feita em centavos. */
function centavos(reais: number): number {
  return Math.round(reais * 100);
}

function reaisDe(cent: number): number {
  return cent / 100;
}

/** O pedido como o cashback precisa ler. */
export interface PedidoParaCashback {
  status: OrderStatus;
  invoiced?: boolean | null;
  invoiced_at?: string | null;
  invoiced_total?: number | null;
  total?: number | null;
  inactive?: boolean | null;
  rep_id: string;
}

/**
 * Quanto este pedido gera de cashback, em reais — ou `null` quando não gera.
 *
 * Gera: faturado (o carimbo, com data), vendido por um login de VENDA INTERNA,
 * faturado a partir do início do programa, não cancelado e não inativo (055).
 * A base é o valor da NOTA (027); sem ele, o total do pedido.
 */
export function creditoDoPedido(
  p: PedidoParaCashback,
  ctx: { inicio: string | null; vendaInterna: ReadonlySet<string> },
): number | null {
  if (!p.invoiced || !p.invoiced_at) return null;
  if (p.status === 'rejected' || p.inactive === true) return null;
  if (!ctx.vendaInterna.has(p.rep_id)) return null;
  const faturadoMs = Date.parse(p.invoiced_at);
  if (Number.isNaN(faturadoMs)) return null;
  if (ctx.inicio) {
    const inicioMs = Date.parse(ctx.inicio);
    if (!Number.isNaN(inicioMs) && faturadoMs < inicioMs) return null;
  }
  const base = p.invoiced_total ?? p.total ?? 0;
  if (!(base > 0)) return null;
  const cent = Math.round(centavos(base) * (CASHBACK_PERCENTUAL / 100));
  return cent > 0 ? reaisDe(cent) : null;
}

/** O vencimento de um crédito: o faturamento + 90 dias (ISO). */
export function vencimentoDoCredito(faturadoEm: string): string {
  return new Date(Date.parse(faturadoEm) + CASHBACK_VALIDADE_DIAS * DIA_MS).toISOString();
}

/** Um crédito: o pedido faturado que o gerou. */
export interface CreditoDeCashback {
  order_id: string;
  order_number: number | null;
  faturado_em: string;
  /** A base do cálculo: o valor da nota. */
  valor_faturado: number;
  /** O cashback que o pedido gerou (3% da base). */
  valor: number;
  vence_em: string;
}

/** Um uso: o abatimento escrito na observação de um pedido. */
export interface UsoDeCashback {
  id: string;
  order_id: string;
  order_number: number | null;
  valor: number;
  usado_em: string;
  usado_por_nome: string | null;
}

/** O crédito no extrato, depois de descontados os usos. */
export interface CreditoNoExtrato extends CreditoDeCashback {
  /** Quanto dele já foi usado. */
  usado: number;
  /** Quanto dele ainda está disponível (0 quando venceu). */
  restante: number;
  /** Quanto dele se perdeu por vencer sem uso. */
  perdido: number;
  vencido: boolean;
  /** Dias até vencer (null quando já venceu). */
  dias_para_vencer: number | null;
}

export interface ExtratoDeCashback {
  /** O disponível agora: soma do que resta dos créditos não vencidos. */
  saldo: number;
  total_ganho: number;
  total_usado: number;
  total_vencido: number;
  /** Do mais novo para o mais velho. */
  creditos: CreditoNoExtrato[];
  /** Do mais novo para o mais velho. */
  usos: UsoDeCashback[];
  /** A próxima parcela do saldo a vencer — o aviso dos 90 dias. */
  proximo_vencimento: { valor: number; vence_em: string; dias: number } | null;
  /** Quanto do saldo vence nos próximos CASHBACK_AVISO_DIAS dias. */
  vencendo_logo: number;
}

/**
 * O extrato do cliente: os créditos, os usos e o saldo de agora.
 *
 * O uso consome primeiro o crédito que vence ANTES (o mais velho), e só o que
 * estava valendo na hora do uso — é o que a pessoa esperaria ("usa o que vai
 * vencer"). O que sobra de um crédito depois do vencimento se perde.
 *
 * Um uso maior que o disponível na hora (o pedido que gerou o crédito foi
 * desfaturado depois, por exemplo) consome o que dá; o resto não vira saldo
 * negativo — o abatimento já foi escrito no pedido e é o financeiro quem
 * decide.
 */
export function montarExtrato(
  creditos: readonly CreditoDeCashback[],
  usos: readonly UsoDeCashback[],
  agora: Date = new Date(),
): ExtratoDeCashback {
  const agoraMs = agora.getTime();
  const fichas = [...creditos]
    .map((c) => ({
      c,
      faturadoMs: Date.parse(c.faturado_em),
      venceMs: Date.parse(c.vence_em),
      resta: centavos(c.valor),
      usado: 0,
    }))
    .sort((a, b) => a.venceMs - b.venceMs || a.faturadoMs - b.faturadoMs);

  const usosEmOrdem = [...usos].sort((a, b) => Date.parse(a.usado_em) - Date.parse(b.usado_em));
  for (const uso of usosEmOrdem) {
    const usoMs = Date.parse(uso.usado_em);
    let falta = centavos(uso.valor);
    for (const f of fichas) {
      if (falta <= 0) break;
      if (f.resta <= 0 || f.faturadoMs > usoMs || f.venceMs <= usoMs) continue;
      const tira = Math.min(f.resta, falta);
      f.resta -= tira;
      f.usado += tira;
      falta -= tira;
    }
  }

  let saldo = 0;
  let vencido = 0;
  let vencendoLogo = 0;
  let proximo: ExtratoDeCashback['proximo_vencimento'] = null;
  const noExtrato: CreditoNoExtrato[] = fichas.map((f) => {
    const venceu = f.venceMs <= agoraMs;
    const dias = venceu ? null : Math.ceil((f.venceMs - agoraMs) / DIA_MS);
    if (venceu) {
      vencido += f.resta;
    } else {
      saldo += f.resta;
      if (f.resta > 0) {
        if (dias !== null && dias <= CASHBACK_AVISO_DIAS) vencendoLogo += f.resta;
        if (!proximo && dias !== null) {
          proximo = { valor: reaisDe(f.resta), vence_em: f.c.vence_em, dias };
        }
      }
    }
    return {
      ...f.c,
      usado: reaisDe(f.usado),
      restante: venceu ? 0 : reaisDe(f.resta),
      perdido: venceu ? reaisDe(f.resta) : 0,
      vencido: venceu,
      dias_para_vencer: dias,
    };
  });

  return {
    saldo: reaisDe(saldo),
    total_ganho: reaisDe(fichas.reduce((s, f) => s + centavos(f.c.valor), 0)),
    total_usado: reaisDe(usos.reduce((s, u) => s + centavos(u.valor), 0)),
    total_vencido: reaisDe(vencido),
    creditos: noExtrato.sort((a, b) => Date.parse(b.faturado_em) - Date.parse(a.faturado_em)),
    usos: usosEmOrdem.reverse(),
    proximo_vencimento: proximo,
    vencendo_logo: reaisDe(vencendoLogo),
  };
}

/** "R$ 1.234,56" sem espaço especial — a linha vai para a planilha do Control. */
export function reaisNaObservacao(valor: number): string {
  const [inteiro = '0', decimal = '00'] = (Math.round(valor * 100) / 100).toFixed(2).split('.');
  return `R$ ${inteiro.replace(/\B(?=(\d{3})+(?!\d))/g, '.')},${decimal}`;
}

/** A linha que o uso escreve na observação do pedido (o texto do Yan). */
export function linhaDoCashback(valor: number): string {
  return `Utilizado ${reaisNaObservacao(valor)} do cashback`;
}

const LINHA_DO_CASHBACK = /^\s*Utilizado R\$ [\d.]+,\d{2} do cashback\s*$/i;

/** A linha é a que o uso do cashback escreveu? */
export function ehLinhaDoCashback(linha: string): boolean {
  return LINHA_DO_CASHBACK.test(linha);
}

/** A observação com a linha do cashback no fim (substitui a anterior, se houver). */
export function observacaoComCashback(notes: string | null | undefined, valor: number): string {
  const sem = observacaoSemCashback(notes);
  return sem ? `${sem}\n${linhaDoCashback(valor)}` : linhaDoCashback(valor);
}

/** A observação sem a linha do cashback — ao desfazer o uso. */
export function observacaoSemCashback(notes: string | null | undefined): string {
  return (notes ?? '')
    .split('\n')
    .filter((l) => !ehLinhaDoCashback(l))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/**
 * Quem abre a área Cashback: a venda interna (é quem passa o cashback ao
 * cliente) e o escritório — gerente, admin, financeiro e o visualizador, que
 * só lê. O representante comum não: o programa é da venda interna.
 */
export function veAreaDeCashback(role: AuthRole | null | undefined, vendaInterna: boolean): boolean {
  if (role === 'rep') return vendaInterna;
  return role === 'admin' || role === 'manager' || role === 'financeiro' || role === 'visualizador';
}

/**
 * Quem USA o cashback num pedido: a venda interna e, como apoio, o financeiro
 * e o admin. A janela é a mesma de mexer na observação (podeMexerNoPedido).
 */
export function podeUsarCashback(role: AuthRole | null | undefined, vendaInterna: boolean): boolean {
  if (role === 'rep') return vendaInterna;
  return role === 'admin' || role === 'financeiro';
}
