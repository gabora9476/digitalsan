/* DigitalSAN — Service worker: notificaciones y base para instalar la app (PWA) */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

// Preparado para notificaciones push enviadas desde un servidor (opcional a futuro)
self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (err) {}
  e.waitUntil(self.registration.showNotification(d.titulo || 'DigitalSAN', {
    body: d.texto || '', icon: './assets/img/icon-192.png', badge: './assets/img/favicon-32.png',
    vibrate: [120, 60, 120], data: { url: d.url || './' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const destino = (e.notification.data && e.notification.data.url) || './';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lista) => {
    for (const c of lista) { if ('focus' in c) return c.focus(); }
    return self.clients.openWindow(destino);
  }));
});
