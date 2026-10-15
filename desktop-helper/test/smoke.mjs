#!/usr/bin/env node
/* Smoke test of the helper shell (Linux, under xvfb-run): Leona's window and
   the panel open, the hub page can set her badge, make her "work" and say a
   notice, she walks (the window moves), a page from another origin gets no
   afHelper, and links leave the panel.
     xvfb-run -a node test/smoke.mjs      (needs playwright)                      */
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(process.env.PW_FROM || import.meta.url);
const { _electron: electron } = require('playwright');
const here = path.dirname(fileURLToPath(import.meta.url));

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
const page = (body) => `<!doctype html><meta charset=utf-8><body>${body}</body>`;
const srv = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'text/html' });
  if (req.url.startsWith('/assistant/')) res.end(page(`<p id=t>hub chat</p><a id=ext href="https://example.com/" target=_blank>x</a>
    <script>document.getElementById('t').dataset.helper = String(!!window.afHelper); if (window.afHelper) window.afHelper.setBadge(3);</script>`));
  else res.end(page('<p>other</p>'));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const HUB = `http://127.0.0.1:${srv.address().port}/assistant/`;

const app = await electron.launch({ executablePath: require(path.join(here, '..', 'node_modules', 'electron')), args: [path.join(here, '..'), '--no-sandbox', '--show'], env: Object.assign({}, process.env, { AF_HELPER_URL: HUB }) });
try {
  const wins = async () => app.windows();
  let panel, pet;
  for (let i = 0; i < 50 && (!panel || !pet); i++) {
    for (const w of await wins()) { const u = w.url(); if (u.includes('/assistant/')) panel = w; if (u.endsWith('pet.html')) pet = w; }
    await new Promise(r => setTimeout(r, 200));
  }
  ok(!!panel && !!pet, 'two windows: Leona and the chat panel');
  await panel.waitForSelector('#t');
  ok(await panel.$eval('#t', e => e.dataset.helper) === 'true', 'the hub page gets window.afHelper');
  await pet.waitForFunction(() => document.getElementById('badge').textContent === '3');
  ok(true, 'the hub page set Leona\'s badge to 3');
  const imgs = await pet.evaluate(() => [...document.images].map(i => i.complete && i.naturalWidth > 0));
  ok(imgs.length && imgs.every(Boolean), 'her picture loads (packaged assets)');
  await panel.evaluate(() => window.afHelper.busy(true));
  await pet.waitForFunction(() => window.__pet.state === 'draw' && /working on your request/.test(document.getElementById('doing').textContent));
  ok(true, 'while the chat works, Leona draws ("working on your request")');
  await panel.evaluate(() => window.afHelper.busy(false));
  await panel.evaluate(() => window.afHelper.notify('#5 is fixed — please check', 'AC3'));
  await pet.waitForFunction(() => document.getElementById('say').classList.contains('show') && /#5 is fixed/.test(document.getElementById('say').textContent));
  ok(true, 'a notice is said in her speech bubble too');
  if (process.env.SHOTS) { await new Promise(r => setTimeout(r, 400)); await pet.screenshot({ path: path.join(process.env.SHOTS, 'leona.png') }); }
  await app.evaluate(({ BrowserWindow }) => { BrowserWindow.getAllWindows().forEach(w => { if (w.getTitle() === 'AF Helper') w.hide(); }); });
  const x0 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('pet.html')).getBounds().x);
  await pet.evaluate(() => window.__pet.walk(-150));
  await new Promise(r => setTimeout(r, 4200));
  const x1 = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith('pet.html')).getBounds().x);
  ok(x0 - x1 > 100, `she walks: the window moved left ${x0 - x1}px`);
  const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.isAlwaysOnTop()));
  ok(onTop.every(Boolean), 'both windows stay on top');
  const opened = await app.evaluate(async ({ shell }) => { global.__opened = []; shell.openExternal = u => { global.__opened.push(u); return Promise.resolve(); }; return true; });
  await panel.click('#ext');
  await new Promise(r => setTimeout(r, 300));
  ok((await app.evaluate(() => global.__opened)).includes('https://example.com/'), 'a link opens in the normal browser, not in the panel');
  const other = HUB.replace('127.0.0.1', 'localhost').replace('/assistant/', '/other/');   // another origin
  await panel.evaluate(u => { location.href = u; }, other);
  await new Promise(r => setTimeout(r, 500));
  ok(panel.url().includes('/assistant/') && (await app.evaluate(() => global.__opened)).includes(other), 'another site never loads inside the panel; it goes to the browser');
  const leak = await app.evaluate(async ({ BrowserWindow, app }, u) => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload: app.getAppPath() + '/panel-preload.js', sandbox: true, contextIsolation: true, additionalArguments: ['--af-origin=http://127.0.0.1:1'] } });
    await w.loadURL(u); const r = await w.webContents.executeJavaScript('typeof window.afHelper'); w.destroy(); return r;
  }, HUB);
  ok(leak === 'undefined', 'the preload gives afHelper only to the hub origin');
} catch (e) { fail++; console.log('  FAIL ' + (e.stack || e.message)); }
finally { await app.evaluate(({ app }) => { app.isQuitting = true; app.exit(0); }).catch(() => {}); srv.close(); }
console.log(`helper smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
