/* Service worker de Eco: solo recibe los avisos push y abre Eco al tocarlos. No guarda nada en caché. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let datos = {};
  try { datos = event.data ? event.data.json() : {}; } catch (e) { datos = {}; }
  event.waitUntil(self.registration.showNotification(datos.title || 'Eco', {
    body: datos.body || '',
    icon: '/images/favicon-192.png',
    tag: datos.tag || 'eco-aviso',
    data: { url: typeof datos.url === 'string' && datos.url.startsWith('/') ? datos.url : '/colaboraciones.html' },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const destino = new URL((event.notification.data && event.notification.data.url) || '/colaboraciones.html', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((ventanas) => {
    const abierta = ventanas.find((v) => 'focus' in v);
    if (abierta) { if ('navigate' in abierta) abierta.navigate(destino); return abierta.focus(); }
    return self.clients.openWindow(destino);
  }));
});
