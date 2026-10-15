/* ============================================================
   AF Helper — the desktop helper for the design team and PMs (Windows).
   ------------------------------------------------------------
   Leona (Leo's character) lives on the desktop, on top of every window:
   she walks along the screen, drinks coffee, naps and drafts. Click her
   (or Ctrl+Shift+Space) to open the chat panel; drag her anywhere;
   right-click for options. The panel IS the hub page /assistant/, so
   everything it does is updated by updating the hub; this shell rarely
   needs a new version.

   The panel keeps its own sign-in (Firebase remembers it). It tells
   Leona the to-do count (her badge), new things for you (she says them,
   plus a Windows notice) and when it is working on a request (she
   draws). Links leave for the normal browser.

   Updates itself: checks the newest GitHub release of AF-hub (latest.yml)
   at start and every 4 hours, downloads a new version quietly, and
   installs it when the person has been away for 5 minutes with the chat
   closed (or right away from the menu, or when the app quits).
   ============================================================ */
'use strict';
const { app, BrowserWindow, Tray, Menu, globalShortcut, ipcMain, shell, Notification, nativeImage, screen, powerMonitor } = require('electron');
const path = require('path');
const fs = require('fs');

const HUB = process.env.AF_HELPER_URL || 'https://af-hub-two.vercel.app/assistant/';
const ORIGIN = new URL(HUB).origin;
const PANEL = { width: 430, height: 680 };
const PET_W = 280;
const petH = s => Math.round(225 * s) + 104;   // tallest pose + room for her speech bubble and name tag

if (!app.requestSingleInstanceLock()) { app.quit(); }
app.setAppUserModelId('com.advfacade.afhelper');   // Windows notices show "AF Helper"

let pet = null, panel = null, tray = null, badge = 0, busy = false;
const stateFile = () => path.join(app.getPath('userData'), 'helper-state.json');
function loadState() { try { return JSON.parse(fs.readFileSync(stateFile(), 'utf8')); } catch (e) { return {}; } }
function saveState(patch) { try { fs.writeFileSync(stateFile(), JSON.stringify(Object.assign(loadState(), patch))); } catch (e) {} }
const settings = () => { const s = loadState(); return { scale: s.petScale === 0.75 ? 0.75 : 1, walk: s.petWalk !== false }; };

function onScreen(x, y, w, h) {
  const a = screen.getDisplayNearestPoint({ x: x + Math.round(w / 2), y: y + Math.round(h / 2) }).workArea;
  return { x: Math.min(Math.max(x, a.x), a.x + a.width - w), y: Math.min(Math.max(y, a.y), a.y + a.height - h) };
}
const send = (ev, v) => { if (pet && !pet.isDestroyed()) pet.webContents.send('pet:' + ev, v); };

/* ---------- Leona's window ---------- */
function createPet() {
  const a = screen.getPrimaryDisplay().workArea;
  const H = petH(settings().scale);
  const st = loadState().pet || { x: a.x + a.width - PET_W - 16, y: a.y + a.height - H };
  const p = onScreen(st.x, st.y, PET_W, H);
  pet = new BrowserWindow({
    width: PET_W, height: H, x: p.x, y: p.y, frame: false, transparent: true, resizable: false, show: false,
    alwaysOnTop: true, skipTaskbar: true, hasShadow: false, maximizable: false, minimizable: false, fullscreenable: false,
    title: 'Leona', webPreferences: { preload: path.join(__dirname, 'pet-preload.js'), contextIsolation: true, sandbox: true },
  });
  pet.setAlwaysOnTop(true, 'screen-saver');
  pet.setVisibleOnAllWorkspaces(true);
  pet.setIgnoreMouseEvents(true, { forward: true });   // clicks pass through except on her (pet.js turns it off there)
  pet.loadFile(path.join(__dirname, 'pet.html'));
  pet.webContents.on('did-finish-load', () => {
    send('settings', settings()); send('badge', badge); send('busy', busy);
    if (panel) send('panel', panel.isVisible());
  });
  pet.once('ready-to-show', () => { if (!loadState().hidePet) pet.showInactive(); });
}
function savePet() { if (!pet) return; const b = pet.getBounds(); saveState({ pet: { x: b.x, y: b.y } }); }
function resizePet() {
  const b = pet.getBounds(), H = petH(settings().scale);
  const p = onScreen(b.x, b.y + b.height - H, PET_W, H);   // keep her feet where they were
  pet.setBounds({ x: p.x, y: p.y, width: PET_W, height: H });
  send('settings', settings()); savePet();
}

/* walking: the whole window moves along the screen, about 45 px a second */
let walkT = null;
function stopWalk() { if (!walkT) return; clearInterval(walkT); walkT = null; savePet(); send('walked'); }
function walkBy(dx) {
  if (walkT) { clearInterval(walkT); walkT = null; }
  const b = pet.getBounds();
  const a = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea;
  const x0 = b.x, target = Math.min(Math.max(b.x + dx, a.x), a.x + a.width - b.width), dist = target - x0;
  if (Math.abs(dist) < 8) { send('walked'); return; }
  const dur = Math.max(600, Math.abs(dist) / (0.045 * settings().scale)), t0 = Date.now();
  walkT = setInterval(() => {
    if (!pet || pet.isDestroyed()) { clearInterval(walkT); walkT = null; return; }
    const k = Math.min(1, (Date.now() - t0) / dur);
    pet.setPosition(Math.round(x0 + dist * k), b.y);
    if (k >= 1) stopWalk();
  }, 16);
}

/* ---------- the chat panel ---------- */
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
  panel.on('show', () => send('panel', true));
  panel.on('hide', () => send('panel', false));
  panel.on('resized', () => { const [w, h] = panel.getSize(); saveState({ panel: { w, h } }); });
  const st = loadState().panel; if (st && st.w && st.h) panel.setSize(st.w, st.h);
}

function placePanel() {
  const [w, h] = panel.getSize();
  const b = pet.getBounds();
  const a = screen.getDisplayNearestPoint({ x: b.x + b.width / 2, y: b.y + b.height / 2 }).workArea;
  const mid = b.x + Math.round(b.width / 2), body = Math.round(70 * settings().scale);
  let x = mid - body - w;                                  // to her left…
  if (x < a.x) x = mid + body;                             // …or her right
  const p = onScreen(x, b.y + b.height - h, w, h);         // bottom lined up with her feet
  panel.setPosition(p.x, p.y);
}
function showPanel() { if (!panel.isVisible()) { stopWalk(); placePanel(); } panel.show(); panel.focus(); }
function togglePanel() { if (panel.isVisible()) panel.hide(); else showPanel(); }

function setBadge(n) {
  badge = Math.max(0, n | 0);
  send('badge', badge);
  if (tray) tray.setToolTip(badge ? `AF Helper — ${badge} to do` : 'AF Helper');
}

/* ---------- updates (GitHub release: latest.yml + the installer) ---------- */
let updater = null, ready = null, checking = null;
function ulog(m) { try { fs.appendFileSync(path.join(app.getPath('userData'), 'update.log'), new Date().toISOString() + ' ' + m + '\n'); } catch (e) {} }
function installNow() { if (!updater || !ready) return; ulog('installing ' + ready); app.isQuitting = true; updater.quitAndInstall(true, true); }
function checkUpdates(byHand) {
  if (!updater) { if (byHand) send('say', 'Updates work in the installed app only.'); return; }
  checking = byHand ? 'hand' : 'auto';
  updater.checkForUpdates().catch(e => { ulog('check failed: ' + (e && e.message)); if (byHand) send('say', 'Could not check for updates right now.'); });
}
function setupUpdates() {
  if (!app.isPackaged || process.env.AF_HELPER_NO_UPDATE) return;
  try { updater = require('electron-updater').autoUpdater; } catch (e) { ulog('no updater: ' + e.message); return; }
  updater.autoDownload = true;
  updater.autoInstallOnAppQuit = true;
  updater.disableDifferentialDownload = true;
  updater.logger = { info: ulog, warn: ulog, error: ulog, debug: () => {} };
  updater.on('update-available', i => { if (checking === 'hand') send('say', `Downloading v${i.version}…`); });
  updater.on('update-not-available', () => { if (checking === 'hand') send('say', `I'm up to date (v${app.getVersion()}).`); });
  updater.on('update-downloaded', i => {
    ready = i.version;
    send('say', `New me (v${i.version}) is ready. I'll update when you're away.`);
    if (tray) tray.setToolTip(`AF Helper — v${i.version} ready (restart to update)`);
  });
  updater.on('error', e => ulog('error: ' + (e && e.message)));
  setTimeout(() => checkUpdates(false), 30 * 1000);
  setInterval(() => checkUpdates(false), 4 * 3600 * 1000);
  // install at a quiet moment: away for 5 minutes and the chat closed
  setInterval(() => { if (ready && !(panel && panel.isVisible()) && powerMonitor.getSystemIdleTime() >= 300) installNow(); }, 60 * 1000);
}

/* ---------- tray + menu ---------- */
function trayMenu() {
  const s = settings();
  const setScale = v => { saveState({ petScale: v }); resizePet(); };
  return Menu.buildFromTemplate([
    { label: 'Open AF Helper', click: showPanel },
    { label: 'Open Design Board in the browser', click: () => shell.openExternal(ORIGIN + '/design/') },
    { type: 'separator' },
    { label: 'Show Leona', type: 'checkbox', checked: pet.isVisible(), click: i => { i.checked ? pet.showInactive() : pet.hide(); saveState({ hidePet: !i.checked }); } },
    { label: 'Leona walks around', type: 'checkbox', checked: s.walk, click: i => { saveState({ petWalk: i.checked }); if (!i.checked) stopWalk(); send('settings', settings()); } },
    { label: 'Leona size', submenu: [
      { label: 'Normal', type: 'radio', checked: s.scale === 1, click: () => setScale(1) },
      { label: 'Small', type: 'radio', checked: s.scale === 0.75, click: () => setScale(0.75) },
    ] },
    { label: 'Start with Windows', type: 'checkbox', checked: app.getLoginItemSettings().openAtLogin, click: i => app.setLoginItemSettings({ openAtLogin: i.checked }) },
    { label: 'Reload', click: () => panel.loadURL(HUB) },
    { type: 'separator' },
    ready ? { label: `Restart to update (v${ready})`, click: installNow } : { label: 'Check for updates', click: () => checkUpdates(true) },
    { label: `AF Helper v${app.getVersion()}`, enabled: false },
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
const fromPet = e => pet && e.sender === pet.webContents;
let drag = null;
ipcMain.on('pet:down', (e, p) => { if (!fromPet(e)) return; stopWalk(); const b = pet.getBounds(); drag = { sx: p.x, sy: p.y, bx: b.x, by: b.y }; });
ipcMain.on('pet:move', (e, p) => {
  if (!fromPet(e) || !drag) return;
  const b = pet.getBounds();
  const q = onScreen(drag.bx + p.x - drag.sx, drag.by + p.y - drag.sy, b.width, b.height);
  pet.setPosition(q.x, q.y);
});
ipcMain.on('pet:up', (e) => {
  if (!fromPet(e) || !drag) return;
  drag = null; savePet();
  if (panel.isVisible()) placePanel();
});
ipcMain.on('pet:toggle', e => { if (fromPet(e)) togglePanel(); });
ipcMain.on('pet:menu', e => { if (fromPet(e)) trayMenu().popup({ window: pet }); });
ipcMain.on('pet:hover', (e, v) => { if (fromPet(e)) pet.setIgnoreMouseEvents(!v, { forward: true }); });
ipcMain.on('pet:walk', (e, dx) => { if (fromPet(e) && !drag && !(panel && panel.isVisible())) walkBy(Number(dx) || 0); else if (fromPet(e)) send('walked'); });
ipcMain.on('pet:stop', e => { if (fromPet(e)) stopWalk(); });
// From the hub page in the panel (only when it is the hub; see panel-preload.js).
ipcMain.on('helper:badge', (e, n) => { if (e.sender === panel.webContents) setBadge(n); });
ipcMain.on('helper:busy', (e, v) => { if (e.sender === panel.webContents) { busy = !!v; send('busy', busy); } });
ipcMain.on('helper:notify', (e, m) => {
  if (e.sender !== panel.webContents) return;
  const title = String((m && m.title) || 'AF Helper').slice(0, 120), body = String((m && m.body) || '').slice(0, 300);
  send('say', title);
  if (!Notification.isSupported()) return;
  const n = new Notification({ title, body, icon: path.join(__dirname, 'icon.png') });
  n.on('click', showPanel);
  n.show();
});

app.on('second-instance', showPanel);
app.whenReady().then(() => {
  createPet();
  createPanel();
  buildTray();
  globalShortcut.register('Control+Shift+Space', togglePanel);
  if (process.argv.includes('--show')) showPanel();
  setupUpdates();
});
app.on('before-quit', () => { app.isQuitting = true; });   // also lets Windows shut down / an update install
app.on('will-quit', () => globalShortcut.unregisterAll());
app.on('window-all-closed', () => { /* stay in the tray */ });
