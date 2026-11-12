import type { ExtratoDeCashback, UsoDeCashback } from '@csb/shared';
import type { ErroDaApi } from '../../services/api.js';

/**
 * O contrato das rotas /cashback (apps/api/src/modules/cashback). Espelhado
 * aqui de propósito: é só desta área e dos dois cartões.
 */

export interface ProgramaDeCashback {
  percentual: number;
  validade_dias: number;
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

export interface ListaDeCashback {
  programa: ProgramaDeCashback;
  clientes: LinhaDaListaDeCashback[];
}

export interface ExtratoDoCliente {
  programa: ProgramaDeCashback;
  cliente: ClienteDoCashback | null;
  extrato: ExtratoDeCashback;
}

export type MotivoSemUso = 'sem_permissao' | 'pedido_fechado' | 'sem_cliente' | 'sem_saldo' | 'ja_usado';

export interface CashbackDoPedido {
  programa: ProgramaDeCashback;
  cliente: ClienteDoCashback | null;
  extrato: ExtratoDeCashback | null;
  uso: UsoDeCashback | null;
  limite: number;
  sem_uso: MotivoSemUso | null;
  pode_desfazer: boolean;
}

const DIA = new Intl.DateTimeFormat('pt-BR', {
  timeZone: 'America/Sao_Paulo',
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
});

/** "12/02/2027" no fuso da fábrica. */
export function dataCurta(iso: string | null | undefined): string {
  if (!iso) return '—';
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? '—' : DIA.format(new Date(ms));
}

/** "vence hoje", "vence amanhã", "vence em 12 dias". */
export function prazoPorExtenso(dias: number): string {
  if (dias <= 0) return 'vence hoje';
  if (dias === 1) return 'vence amanhã';
  return `vence em ${dias} dias`;
}

/** A migração 058 ainda não rodou neste banco? */
export function faltaMigracao(e: unknown): boolean {
  return (e as ErroDaApi | null)?.code === 'MIGRACAO_PENDENTE';
}

/** O nome que aparece: a fantasia quando houver, senão a razão social. */
export function nomeDoCliente(c: ClienteDoCashback): string {
  return c.fantasia?.trim() || c.nome;
}
