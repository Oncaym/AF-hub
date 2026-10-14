#!/usr/bin/env node
/* Smoke test of the helper shell (Linux, under xvfb-run): the panel loads the
   hub URL, the hub page can set the button's badge, a page from another origin
   gets no afHelper, and links leave the panel.
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
  if (req.url.startsWith('/design/')) res.end(page(`<p id=t>hub mini</p><a id=ext href="https://example.com/" target=_blank>x</a>
    <script>document.getElementById('t').dataset.helper = String(!!window.afHelper); if (window.afHelper) window.afHelper.setBadge(3);</script>`));
  else res.end(page('<p>other</p>'));
});
await new Promise(r => srv.listen(0, '127.0.0.1', r));
const HUB = `http://127.0.0.1:${srv.address().port}/design/?mini=1`;

const app = await electron.launch({ executablePath: require(path.join(here, '..', 'node_modules', 'electron')), args: [path.join(here, '..'), '--no-sandbox', '--show'], env: Object.assign({}, process.env, { AF_HELPER_URL: HUB }) });
try {
  const wins = async () => app.windows();
  let panel, bubble;
  for (let i = 0; i < 50 && (!panel || !bubble); i++) {
    for (const w of await wins()) { const u = w.url(); if (u.includes('/design/')) panel = w; if (u.endsWith('bubble.html')) bubble = w; }
    await new Promise(r => setTimeout(r, 200));
  }
  ok(!!panel && !!bubble, 'two windows: the round button and the panel');
  await panel.waitForSelector('#t');
  ok(await panel.$eval('#t', e => e.dataset.helper) === 'true', 'the hub page gets window.afHelper');
  await bubble.waitForFunction(() => document.getElementById('n').textContent === '3');
  ok(true, 'the hub page set the badge on the round button to 3');
  const onTop = await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.isAlwaysOnTop()));
  ok(onTop.every(Boolean), 'both windows stay on top');
  const opened = await app.evaluate(async ({ shell }) => { global.__opened = []; shell.openExternal = u => { global.__opened.push(u); return Promise.resolve(); }; return true; });
  await panel.click('#ext');
  await new Promise(r => setTimeout(r, 300));
  ok((await app.evaluate(() => global.__opened)).includes('https://example.com/'), 'a link opens in the normal browser, not in the panel');
  const other = HUB.replace('127.0.0.1', 'localhost').replace('/design/?mini=1', '/other/');   // another origin
  await panel.evaluate(u => { location.href = u; }, other);
  await new Promise(r => setTimeout(r, 500));
  ok(panel.url().includes('/design/') && (await app.evaluate(() => global.__opened)).includes(other), 'another site never loads inside the panel; it goes to the browser');
  const leak = await app.evaluate(async ({ BrowserWindow, app }, u) => {
    const w = new BrowserWindow({ show: false, webPreferences: { preload: app.getAppPath() + '/panel-preload.js', sandbox: true, contextIsolation: true, additionalArguments: ['--af-origin=http://127.0.0.1:1'] } });
    await w.loadURL(u); const r = await w.webContents.executeJavaScript('typeof window.afHelper'); w.destroy(); return r;
  }, HUB);
  ok(leak === 'undefined', 'the preload gives afHelper only to the hub origin');
} catch (e) { fail++; console.log('  FAIL ' + (e.stack || e.message)); }
finally { await app.evaluate(({ app }) => { app.isQuitting = true; app.exit(0); }).catch(() => {}); srv.close(); }
console.log(`helper smoke: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
