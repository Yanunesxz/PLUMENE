/**
 * QUANTO VALE UM "SINCRONIZAR AGORA" (decisão do Yan, 16/09/2026 à tarde).
 *
 * O botão da tela de integração grava `companies.sync_solicitado_em` (049) e o
 * Control lê `sincronizar_agora` no GET /partner/v1/status. Se o Control não
 * responde — robô parado, servidor do Fábio desligado —, o carimbo ficava de pé
 * para sempre: o Control que voltasse dias depois rodaria uma "sincronização
 * agora" que ninguém mais esperava, e a tela mostraria "pedido registrado" sem
 * fim, com o botão travado.
 *
 * Então o pedido EXPIRA: passados 15 minutos sem o aviso de concluída, o
 * `/status` do parceiro devolve `sincronizar_agora: false` (o `solicitado_em`
 * continua saindo, para diagnóstico), a tela mostra "pedido expirado" e o
 * botão pode pedir de novo.
 *
 * É a MESMA regra nas duas rotas — por isso mora aqui, num lugar só, e é
 * aplicada por `lerSolicitacaoDeSync` (integracao.service.ts), a leitura que
 * as duas rotas fazem.
 */

/** 15 minutos: depois disso, o pedido de sincronização não vale mais. */
export const EXPIRACAO_DO_PEDIDO_DE_SYNC_MS = 15 * 60 * 1000;

/**
 * O pedido feito em `solicitado_em` já expirou em `agoraMs`?
 *
 * Sem pedido, nada expira (`false`). Até 15 minutos inclusive, vale. Um
 * carimbo que não dá para ler como data não é "de até 15 minutos atrás" —
 * conta como expirado: melhor o Control seguir o horário dele que rodar uma
 * rodada inteira por um valor que ninguém sabe de quando é. Carimbo no futuro
 * (relógio adiantado) vale.
 */
export function pedidoDeSyncExpirado(
  solicitado_em: string | null | undefined,
  agoraMs: number = Date.now(),
): boolean {
  if (!solicitado_em) return false;
  const momento = Date.parse(solicitado_em);
  if (Number.isNaN(momento)) return true;
  return agoraMs - momento > EXPIRACAO_DO_PEDIDO_DE_SYNC_MS;
}
