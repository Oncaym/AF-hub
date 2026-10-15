/* Gives the hub page a few things, and only when the page really is the hub:
   the to-do count (Leona's badge), Windows notices (Leona says them too), and
   "working on it" while the chat runs a request (Leona draws). */
const { contextBridge, ipcRenderer } = require('electron');
const arg = (process.argv || []).find(a => a.startsWith('--af-origin='));
const HUB_ORIGIN = arg ? arg.slice('--af-origin='.length) : 'https://af-hub-two.vercel.app';
if (location.origin === HUB_ORIGIN) {
  contextBridge.exposeInMainWorld('afHelper', {
    setBadge: n => ipcRenderer.send('helper:badge', Number(n) || 0),
    notify: (title, body) => ipcRenderer.send('helper:notify', { title: String(title || ''), body: String(body || '') }),
    busy: v => ipcRenderer.send('helper:busy', !!v),
  });
}
