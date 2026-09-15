/**
 * A lista que quem mexe no Control CONFERIU, guardada no aparelho.
 *
 * O cartão "Atualizar no ERP" congela a impressão do pedido (`assinaturaDoPedido`)
 * no momento em que o aviso aparece para a Larissa. Se ficasse só na memória da
 * tela, se perderia justamente quando mais importa: o app se recarrega sozinho
 * para instalar versão nova quando a aba sai da frente — e a aba sai da frente
 * quando ela vai digitar no Control, que é outro programa. Na volta, o cartão
 * congelaria a versão NOVA e a confirmação engoliria a mudança que ela não viu
 * (revisão de 15/09/2026).
 *
 * `localStorage`, não `sessionStorage`: tocar no aviso do celular pode abrir o
 * pedido noutra aba, e a lista conferida tem de valer lá também.
 *
 * A chave leva a data da foto: quando alguém confirma, a foto é nova, a chave é
 * outra, e a lista conferida da versão anterior deixa de valer sozinha.
 */

const PREFIXO = 'csb.lista-conferida:';

const chave = (orderId: string, confirmadoEm: string) => `${PREFIXO}${orderId}:${confirmadoEm}`;

/** Armazenamento do navegador, ou nada (aba anônima com cota zero, navegador antigo). */
function armazenamento(): Storage | null {
  try {
    return typeof localStorage === 'undefined' ? null : localStorage;
  } catch {
    return null;
  }
}

export function lerListaConferida(orderId: string, confirmadoEm: string): string | null {
  try {
    return armazenamento()?.getItem(chave(orderId, confirmadoEm)) ?? null;
  } catch {
    return null;
  }
}

/**
 * Guarda a impressão conferida e apaga as de fotos anteriores do mesmo pedido,
 * para o aparelho não acumular uma chave por confirmação.
 */
export function guardarListaConferida(orderId: string, confirmadoEm: string, assinatura: string): void {
  const a = armazenamento();
  if (!a) return;
  try {
    const doPedido = `${PREFIXO}${orderId}:`;
    for (let i = a.length - 1; i >= 0; i--) {
      const k = a.key(i);
      if (k && k.startsWith(doPedido) && k !== chave(orderId, confirmadoEm)) a.removeItem(k);
    }
    a.setItem(chave(orderId, confirmadoEm), assinatura);
  } catch {
    // Cota cheia: a conferência vale só enquanto a tela estiver aberta.
  }
}

export function esquecerListaConferida(orderId: string, confirmadoEm: string): void {
  try {
    armazenamento()?.removeItem(chave(orderId, confirmadoEm));
  } catch {
    /* nada a fazer */
  }
}
