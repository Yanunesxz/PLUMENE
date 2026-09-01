/**
 * Os ouvidos do push — importado pelo service worker gerado (importScripts).
 *
 * `push` mostra a notificação; `notificationclick` abre o app na rota que o
 * servidor mandou (o "toque para ver o pedido"). Arquivo de service worker:
 * sem import/export de módulo, sem novidade de sintaxe.
 */
self.addEventListener('push', (event) => {
  let dados = {};
  try {
    dados = event.data ? event.data.json() : {};
  } catch (_e) {
    dados = { body: event.data ? event.data.text() : '' };
  }
  const titulo = dados.title || 'Aviso';
  const opcoes = {
    body: dados.body || '',
    icon: '/pwa-192x192.png',
    badge: '/pwa-192x192.png',
    data: { url: dados.url || '/' },
  };
  if (dados.tag) opcoes.tag = dados.tag;
  event.waitUntil(self.registration.showNotification(titulo, opcoes));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((janelas) => {
      for (const janela of janelas) {
        if ('focus' in janela) {
          if ('navigate' in janela) janela.navigate(url);
          return janela.focus();
        }
      }
      return self.clients.openWindow(url);
    }),
  );
});
