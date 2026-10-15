/* Leona's window: drag, click, hover (only her body catches the mouse), walking, menu. */
const { contextBridge, ipcRenderer } = require('electron');
const EVENTS = ['walked', 'badge', 'say', 'busy', 'panel', 'settings', 'quote'];
contextBridge.exposeInMainWorld('pet', {
  down: (x, y) => ipcRenderer.send('pet:down', { x, y }),
  move: (x, y) => ipcRenderer.send('pet:move', { x, y }),
  up: (x, y) => ipcRenderer.send('pet:up', { x, y }),
  toggle: () => ipcRenderer.send('pet:toggle'),
  menu: () => ipcRenderer.send('pet:menu'),
  hover: v => ipcRenderer.send('pet:hover', !!v),
  walk: dx => ipcRenderer.send('pet:walk', Number(dx) || 0),
  stop: () => ipcRenderer.send('pet:stop'),
  on: (ev, cb) => { if (EVENTS.includes(ev)) ipcRenderer.on('pet:' + ev, (e, v) => cb(v)); },
});
