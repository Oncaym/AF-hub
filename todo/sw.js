/* 🔔 To-do notifications (Leo 11-02). Shows what api/todo-push.mjs and the
   2-hour reminder send, and opens the task when the notice is tapped.
   Nothing is cached: the page always loads fresh from the hub. */
'use strict';
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', e => e.waitUntil(self.clients.claim()));

self.addEventListener('push', e => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch (er) { d = { body: e.data ? e.data.text() : '' }; }
  e.waitUntil(self.registration.showNotification(d.title || 'To-do', {
    body: d.body || '',
    tag: d.tag || 'todo',
    renotify: true,
    requireInteraction: !!d.sticky,     // on a PC: stays on screen until you close it
    icon: '/todo/icon-192.png',
    data: { url: d.url || '/todo/' },
  }));
});

self.addEventListener('notificationclick', e => {
  e.notification.close();
  const url = new URL((e.notification.data && e.notification.data.url) || '/todo/', self.location.origin).href;
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(list => {
    const open = list.find(c => new URL(c.url).pathname.startsWith('/todo/'));
    if (open) { open.postMessage({ open: url }); return open.focus(); }
    return self.clients.openWindow(url);
  }));
});
