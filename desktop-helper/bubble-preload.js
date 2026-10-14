const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('bubble', {
  down: (x, y) => ipcRenderer.send('bubble:down', { x, y }),
  move: (x, y) => ipcRenderer.send('bubble:move', { x, y }),
  up: (x, y) => ipcRenderer.send('bubble:up', { x, y }),
  menu: () => ipcRenderer.send('bubble:menu'),
  onBadge: cb => ipcRenderer.on('badge', (e, c) => cb(c)),
});
