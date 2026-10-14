/* Gives the hub page two things, and only when the page really is the hub:
   the to-do count for the round button, and Windows notices. */
const { contextBridge, ipcRenderer } = require('electron');
const arg = (process.argv || []).find(a => a.startsWith('--af-origin='));
const HUB_ORIGIN = arg ? arg.slice('--af-origin='.length) : 'https://af-hub-two.vercel.app';
if (location.origin === HUB_ORIGIN) {
  contextBridge.exposeInMainWorld('afHelper', {
    setBadge: n => ipcRenderer.send('helper:badge', Number(n) || 0),
    notify: (title, body) => ipcRenderer.send('helper:notify', { title: String(title || ''), body: String(body || '') }),
  });
}
