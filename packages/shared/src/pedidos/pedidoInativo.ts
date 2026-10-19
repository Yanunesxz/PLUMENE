import type { AuthRole } from '../constants/userRole.js';
import type { OrderStatus } from '../constants/orderStatus.js';
import { contaParaAMeta } from '../constants/bonus.js';

/**
 * PEDIDO INATIVO (migração 055) — quem marca, quem desmarca e quando.
 *
 * Pedido do Yan (15/10/2026): "o pedido pode ter o carimbo de inativo como o
 * de faturado: se o pedido for aprovado e depois inativado a pessoa não recebe
 * a bonificação". É OUTRA marca, como Faturado — não é status e não é
 * cancelar (053): o pedido continua na lista, no status que tinha, e sai da
 * bonificação do mês do envio.
 *
 * A mesma regra vale na tela (esconde o botão) e na API (recusa com 409): quem
 * decide é esta função, para o botão nunca aparecer onde a rota vai negar.
 */

/** Os papéis que marcam e desmarcam: os mesmos de Faturado, sem a venda interna. */
export const PAPEIS_QUE_INATIVAM: readonly AuthRole[] = ['financeiro', 'admin'];

export interface PedidoParaInativar {
  status: OrderStatus;
  invoiced?: boolean | null | undefined;
  inactive?: boolean | null | undefined;
}

export type PodeInativar = 'ok' | 'forbidden' | 'faturado' | 'status_nao_permite' | 'ja_inativo';
export type PodeReativar = 'ok' | 'forbidden' | 'nao_esta_inativo' | 'status_nao_permite';

/**
 * Pode ganhar o carimbo? Só financeiro e admin; só pedido aprovado (ou já
 * lançado — a mesma lista que conta para a meta) e ainda não faturado.
 * Faturado vem antes do status: a resposta certa para um lançado e faturado
 * é "desfature antes", não "status não permite".
 */
export function podeInativarPedido(pedido: PedidoParaInativar, papel: AuthRole | undefined): PodeInativar {
  if (!papel || !PAPEIS_QUE_INATIVAM.includes(papel)) return 'forbidden';
  if (pedido.inactive === true) return 'ja_inativo';
  if (pedido.invoiced === true) return 'faturado';
  if (!contaParaAMeta(pedido.status)) return 'status_nao_permite';
  return 'ok';
}

/**
 * Pode desfazer o carimbo? Os mesmos papéis, só o que está inativo — e só
 * enquanto o pedido está num status que conta. O cancelado (053) depois de
 * inativado já está fora de tudo: reativar não o devolveria a nada, e o
 * Inativar também o recusa (16/10/2026 — simétrico com `podeInativarPedido`).
 */
export function podeReativarPedido(pedido: PedidoParaInativar, papel: AuthRole | undefined): PodeReativar {
  if (!papel || !PAPEIS_QUE_INATIVAM.includes(papel)) return 'forbidden';
  if (pedido.inactive !== true) return 'nao_esta_inativo';
  if (!contaParaAMeta(pedido.status)) return 'status_nao_permite';
  return 'ok';
}

/**
 * O carimbo "Pedido inativo" aparece na tela? Só com o carimbo gravado E num
 * status que conta para a meta. O pedido inativado e DEPOIS cancelado guarda
 * o carimbo no banco (o cancelamento não mexe nele), mas na lista e no
 * detalhe ele é só "Cancelado": o selo ao lado seria ruído, e o botão
 * "Reativar pedido" já não existe nele. A regra vale para a lista e para o
 * detalhe (16/10/2026).
 */
export function exibeCarimboInativo(pedido: PedidoParaInativar): boolean {
  return pedido.inactive === true && contaParaAMeta(pedido.status);
}
