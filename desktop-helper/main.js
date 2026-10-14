/* ============================================================
   AF Helper — the design team's desktop helper (Windows).
   ------------------------------------------------------------
   A small round button that stays on top of every window. Click it
   (or Ctrl+Shift+Space) to open a compact panel. The panel IS the
   hub page /design/?mini=1, so everything it does (my to-do, paste
   screenshots, drawing status, ask Claude, hub links) is updated by
   updating the hub; this shell rarely needs a new version.

   The panel keeps its own sign-in (Firebase remembers it), shows the
   to-do count on the button, and turns "new for you" into a Windows
   notice. Links leave for the normal browser.
   ============================================================ */
'use strict';
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, Notification, nativeImage, screen } = require('electron');
const path = require('path');
const fs = require('fs');

const HUB = process.env.AF_HELPER_URL || 'https://af-hub-two.vercel.app/design/?mini=1';
const ORIGIN = new URL(HUB).origin;
const BUBBLE = 64;
const PANEL = { width: 430, height: 680 };

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('com.advfacade.afhelper');   // Windows notices show "AF Helper"

let bubble = null, panel = null, tray = null, badge = 0;
const stateFile = () => path.join(app.getPath('userData'), 'helper-state.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; } }
function saveState(patch) { try { fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(loadState(), patch))); } catch (e) {} }

function onScreen(x, y, w, h) {
  const a = screen.getDisplayNearestPoint({ x, y }).workArea;
  return { x: Math.min(Math.max(x, a.x), a.x + a.width - w), y: Math.min(Math.max(y, a.y), a.y + a.height - h) };
}

function createBubble() {
  const a = screen.getPrimaryDisplay().workArea;
  const st = loadState().bubble || { x: a.x + a.width - BUBBLE - 24, y: a.y + a.height - BUBBLE - 40 };
  const p = onScreen(st.x, st.y, BUBBLE, BUBBLE);
  bubble = new BrowserWindow({
    width: BUBBLE, height: BUBBLE, x: p.x, y: p.y, frame: false, transparent: true, resizable: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, maximizable: false, minimizable: false, fullscreenable: false,
    webPreferences: { preload: path.join(__dirname, 'bubble-preload.js'), contextIsolation: true, sandbox: true },
  });
  bubble.setAlwaysOnTop(true, 'screen-saver');
  bubble.setVisibleOnAllWorkspaces(true);
  bubble.loadFile(path.join(__dirname, 'bubble.html'));
  bubble.webContents.on('did-finish-load', () => bubble.webContents.send('badge', badge));
}

function createPanel() {
  panel = new BrowserWindow({
    width: PANEL.width, height: PANEL.height, show: false, title: 'AF Helper', icon: path.join(__dirname, 'icon.png'),
    alwaysOnTop: true, autoHideMenuBar: true, minWidth: 340, minHeight: 420,
    webPreferences: {
      preload: path.join(__dirname, 'panel-preload.js'), contextIsolation: true, sandbox: true,
      partition: 'persist:afhub', additionalArguments: ['--af-origin=' + ORIGIN],
    },
  });
  panel.loadURL(HUB);
  // Only the hub runs inside the panel; every other link opens in the normal browser.
  panel.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:/.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  panel.webContents.on('will-navigate', (e, url) => { if (new URL(url).origin !== ORIGIN) { e.preventDefault(); shell.openExternal(url); } });
  panel.webContents.on('did-fail-load', (e, code, desc) => {
    if (code === -3) return;   // aborted (a redirect); not a failure
    panel.loadFile(path.join(__dirname, 'offline.html'), { query: { url: HUB, why: desc } });
  });
  panel.on('close', e => { if (!app.isQuitting) { e.preventDefault(); panel.hide(); } });
  panel.on('resized', () => { const [w, h] = panel.getSize(); saveState({ panel: { w, h } }); });
  const st = loadState().panel; if (st && st.w && st.h) panel.setSize(st.w, st.h);
}

function placePanel() {
  const [w, h] = panel.getSize();
  const b = bubble.getBounds();
  const a = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea;
  let x = b.x + b.width - w, y = b.y - h - 8;                  // above the button…
  if (y < a.y) y = b.y + b.height + 8;                         // …or below it
  if (x < a.x) x = b.x;
  const p = onScreen(x, y, w, h);
  panel.setPosition(p.x, p.y);
}
function showPanel() { if (!panel.isVisible()) placePanel(); panel.show(); panel.focus(); }
function togglePanel() { if (panel.isVisible()) panel.hide(); else showPanel(); }

function setBadge(n) {
  badge = Math.max(0, n | 0);
  if (bubble) bubble.webContents.send('badge', badge);
  if (tray) tray.setToolTip(badge ? `AF Helper — ${badge} to do` : 'AF Helper');
}

function trayMenu() {
  return Menu.buildFromTemplate([
    { label: 'Open AF Helper', click: showPanel },
    { label: 'Open Design Board in the browser', click: () => shell.openExternal(HUB.replace(/\?.*$/, '')) },
    { type: 'separator' },
    { label: 'Show the round button', type: 'checkbox', checked: bubble.isVisible(), click: i => { i.checked ? bubble.show() : bubble.hide(); saveState({ hideBubble: !i.checked }); } },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Reload', click: () => panel.loadURL(HUB) },
    { type: 'separator' },
    { label: 'Quit AF Helper', click: () => { app.isQuitting = true; app.quit(); } },
  ]);
}
function buildTray() {
  tray = new Tray(nativeImage.createFromPath(path.join(__dirname, 'tray.png')));
  tray.setToolTip('AF Helper');
  tray.on('click', togglePanel);
  tray.on('right-click', () => tray.popUpContextMenu(trayMenu()));
}

// ------------------------------------------------------------------ IPC --
let drag = null;
ipcMain.on('bubble:down', (e, p) => { drag = { sx: p.x, sy: p.y, bx: bubble.getBounds().x, by: bubble.getBounds().y }; });
ipcMain.on('bubble:move', (e, p) => {
  if (!drag) return;
  const q = onScreen(drag.bx + p.x - drag.sx, drag.by + p.y - drag.sy, BUBBLE, BUBBLE);
  bubble.setPosition(q.x, q.y);
});
ipcMain.on('bubble:up', (e, p) => {
  if (!drag) return;
  const moved = Math.abs(p.x - drag.sx) + Math.abs(p.y - drag.sy) > 4;
  drag = null;
  if (moved) { const b = bubble.getBounds(); saveState({ bubble: { x: b.x, y: b.y } }); if (panel.isVisible()) placePanel(); }
  else togglePanel();
});
ipcMain.on('bubble:menu', () => trayMenu().popup({ window: bubble }));
// From the hub page in the panel (only when it is the hub; see panel-preload.js).
ipcMain.on('helper:badge', (e, n) => { if (e.sender === panel.webContents) setBadge(n); });
ipcMain.on('helper:notify', (e, m) => {
  if (e.sender !== panel.webContents || !Notification.isSupported()) return;
  const n = new Notification({ title: String((m && m.title) || 'AF Helper').slice(0, 120), body: String((m && m.body) || '').slice(0, 300), icon: path.join(__dirname, 'icon.png') });
  n.on('click', showPanel);
  n.show();
});

app.on('second-instance', showPanel);
app.whenReady().then(() => {
  createBubble();
  createPanel();
  buildTray();
  if (loadState().hideBubble) bubble.hide();
  globalShortcut.register('Control+Shift+Space', togglePanel);
  if (process.argv.includes('--show')) showPanel();
});
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* stay in the tray */ });
