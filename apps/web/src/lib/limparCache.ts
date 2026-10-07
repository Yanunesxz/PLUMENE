import { db } from '../offline/db.js';

/**
 * "Limpar cache e reiniciar" — pedido do Yan (07/10/2026), para o caso em que
 * um aparelho fica diferente dos outros ("no meu PC funciona") e a saída era
 * mandar a pessoa apagar os dados do site na mão.
 *
 * O que SAI: o catálogo, os clientes e os pedidos guardados no aparelho, as
 * condições de pagamento, os arquivos do app (a versão em cache) e o service
 * worker. Na volta tudo desce de novo do servidor, fresco.
 *
 * O que FICA, de propósito:
 *  • o login (`csb-auth`) — limpar cache não é sair do app;
 *  • a FILA OFFLINE e os pedidos que ainda não subiram — perder pedido não
 *    enviado é inaceitável (ver offline/db.ts, v2);
 *  • o carrinho em montagem e o tema escolhido;
 *  • as fotos dos produtos — são centenas, e baixar tudo de novo pelo 3G da
 *    loja não conserta nada que esteja errado nos dados.
 *
 * Só com internet: sem os arquivos em cache e sem o service worker, o app
 * aberto offline não teria de onde carregar.
 */

/** Cache que sobrevive à limpeza (ver `cacheName` em vite.config.ts). */
const CACHES_MANTIDOS = new Set(['fotos-produtos']);

/** Pedidos feitos sem internet que ainda esperam subir. Ficam guardados. */
export async function pedidosEsperandoInternet(): Promise<number> {
  try {
    return await db.sync_queue.count();
  } catch {
    return 0;
  }
}

export type ResultadoDaLimpeza = { ok: true } | { ok: false; motivo: 'offline' };

export async function limparCacheEReiniciar(): Promise<ResultadoDaLimpeza> {
  if (!navigator.onLine) return { ok: false, motivo: 'offline' };

  // Dados do aparelho. Cada passo é independente: um que falhe não impede os
  // outros, e a recarga no fim acontece de qualquer jeito.
  await Promise.allSettled([
    db.products.clear(),
    db.customers.clear(),
    db.order_items.clear(),
    db.payment_conditions.clear(),
    // Só os pedidos que já estão no servidor: os locais ainda não subiram.
    db.orders.filter((o) => o._sync_status !== 'pending' && o._sync_status !== 'error').delete(),
  ]);

  if ('caches' in window) {
    try {
      const nomes = await caches.keys();
      await Promise.allSettled(nomes.filter((n) => !CACHES_MANTIDOS.has(n)).map((n) => caches.delete(n)));
    } catch {
      /* navegador sem Cache Storage acessível: segue */
    }
  }

  if ('serviceWorker' in navigator) {
    try {
      const registros = await navigator.serviceWorker.getRegistrations();
      await Promise.allSettled(registros.map((r) => r.unregister()));
    } catch {
      /* segue */
    }
  }

  try {
    sessionStorage.clear();
  } catch {
    /* segue */
  }

  // `replace` e não `reload`: volta ao início, sem a tela em que a pessoa estava
  // — que pode ser justamente a que travou.
  window.location.replace(import.meta.env.BASE_URL || '/');
  return { ok: true };
}
