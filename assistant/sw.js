/* AF Helper as an installed browser app (Edge / Chrome "Install").
   Nothing is cached: every request goes to the network as usual. When the
   network is gone, opening the app shows a short "offline" page instead of
   the browser's error. */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));
self.addEventListener('fetch', e => {
  if (e.request.mode !== 'navigate') return;
  e.respondWith(fetch(e.request).catch(() => new Response(
    '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>AF Helper</title>' +
    '<body style="margin:0;display:grid;place-items:center;height:100vh;background:#0f1419;color:#e6edf3;font:15px Segoe UI,sans-serif;text-align:center">' +
    '<div><img src="leona/sleep.webp" width="200" alt=""><p>No connection. Leona is waiting — reopen when you are back online.</p></div>',
    { headers: { 'Content-Type': 'text/html; charset=utf-8' } })));
});
