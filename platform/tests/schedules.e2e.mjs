#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Design Board → Schedules (Excel) (/design/schedules.html) in a real browser,
   against an in-memory design database checked with the real
   platform/design-database.rules.json (targaryen) through e2e/fake-firebase.js.

     node platform/tests/schedules.e2e.mjs      (needs: playwright, targaryen, exceljs)

   The lead adds an Excel schedule (a red cell becomes issue #1), edits a cell;
   a drafter on another computer sees the same board, changes the issue while
   the lead keeps editing, and neither overwrites the other; the lead uploads
   a new version and exports; staff can look but not change anything.
   ───────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'projects.json'), 'utf8'));
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', REG.design.rules), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const URL_DB = REG.design.databaseURL;
const targaryen = require('targaryen');
const ExcelJS = require('exceljs');
const { chromium } = require('playwright');
const PW = 'pw-1';
const LEAD = 'spark@advfacade.com', DRAFTER = 'henry.kim@advfacade.com', STAFF = 'pm@advfacade.com';
const key = e => e.replace(/\./g, ',');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

// ─────────────────────────────────────────────────── two Excel versions ──
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'sched-'));
async function makeXlsx(v) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('WALL TYPES');
  ws.getCell('A1').value = 'TEST PROJECT — WALL TYPE SCHEDULE';
  ws.addRow([]);
  ws.addRow(['MARK', 'DESCRIPTION', 'WIDTH', 'HEIGHT', 'QTY', 'NOTES']);
  ws.getRow(3).font = { bold: true };
  [['W1', 'Storefront', `5'-0"`, `8'-0"`, 4, ''], ['W2', 'Curtain wall', `6'-0"`, `10'-0"`, 2, 'Verify with arch'],
    ['W3', 'Window', `4'-0"`, `5'-0"`, v === 2 ? 3 : 6, ''], ['W4', 'Louver', `3'-0"`, `2'-0"`, 1, '']].forEach(r => ws.addRow(r));
  if (v === 1) ws.getCell('F5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
  ws.addRow(['TOTAL', '', '', '', { formula: 'SUM(E4:E7)' }, '']);
  wb.addWorksheet('NOTES').getCell('A1').value = 'General notes';
  const f = path.join(TMP, v === 1 ? 'Wall types.xlsx' : 'Wall types rev1.xlsx');
  fs.writeFileSync(f, Buffer.from(await wb.xlsx.writeBuffer()));
  return f;
}
const X1 = await makeXlsx(1), X2 = await makeXlsx(2);

// ─────────────────────────────────────────────── in-memory database ──
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function dget(o, p) { for (const k of p.split('/').filter(Boolean)) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; }
function dset(root, p, v) {
  const ks = p.split('/').filter(Boolean);
  if (!ks.length) return v == null ? {} : v;
  let o = root;
  for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; }
  if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  return root;
}
function prune(o) { if (o && typeof o === 'object') { for (const k of Object.keys(o)) { o[k] = prune(o[k]); if (o[k] == null || (typeof o[k] === 'object' && !Object.keys(o[k]).length)) delete o[k]; } } return o; }
const sv = (v, now) => (v && typeof v === 'object' ? (v['.sv'] === 'timestamp' ? now : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sv(x, now)]))) : v);
const users = {};
const mkUser = email => { users[email] = { uid: 'u_' + email.replace(/\W/g, '_'), email, emailVerified: true, password: PW }; };
let DB = {};
let denied = 0;
function handle(op, a) {
  const now = Date.now();
  if (op === 'signIn') { const u = users[a.email]; return u && u.password === a.password ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified } : null; }
  if (op === 'user') { const u = Object.values(users).find(x => x.uid === a.uid); return u ? { emailVerified: u.emailVerified } : null; }
  if (op === 'sendVerification' || op === 'reset' || op === 'upload') return null;
  if (a.url !== URL_DB) throw new Error('page talked to another database: ' + a.url);
  const db = targaryen.database(RULES, clone(DB), now).as(a.auth || null);
  if (op === 'read') { const allowed = db.read(a.path).allowed; return { allowed, value: allowed ? clone(dget(DB, a.path)) : undefined }; }
  const value = sv(a.value, now);
  const allowed = (a.op === 'update' ? db.update(a.path, value) : db.write(a.path, value)).allowed;
  if (!allowed) { denied++; return { allowed }; }
  if (a.op === 'update') for (const k of Object.keys(value)) dset(DB, a.path + '/' + k, value[k]);
  else DB = dset(DB, a.path, value);
  prune(DB);
  return { allowed };
}

// ─────────────────────────────────────────────────────── static server ──
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(ROOT, u);
  if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/design/`;

const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const EXCELJS = fs.readFileSync(path.join(path.dirname(require.resolve('exceljs/package.json')), 'dist', 'exceljs.min.js'));
const FAKE = fs.readFileSync(path.join(here, 'e2e', 'fake-firebase.js'), 'utf8');
const errors = [];
async function open(email, hash = '#b=ac3') {
  const c = await browser.newContext({ viewport: { width: 1400, height: 900 }, acceptDownloads: true });
  await c.exposeFunction('__fb', (op, args) => handle(op, args));
  await c.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: /firebase-app-compat\.js$/.test(r.request().url()) ? FAKE : '' }));
  await c.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs\/4\.4\.0\/exceljs\.min\.js/, r => r.fulfill({ contentType: 'text/javascript', body: EXCELJS }));
  const page = await c.newPage();
  page.on('pageerror', e => errors.push(email + ': ' + e.message));
  await page.goto(BASE + 'schedules.html' + hash);
  await page.fill('#gEmail', email); await page.fill('#gPwd', PW);
  await page.click('#gForm button[type=submit]');
  return page;
}
async function until(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 50)); }
  return false;
}
const chunks = () => (DB.schedules && DB.schedules.ac3 && DB.schedules.ac3.chunks) || {};
const piece = k => { const v = chunks()[k]; return v ? JSON.parse(v) : undefined; };
const fileIds = () => Object.keys(chunks()).map(k => (/^f_([A-Za-z0-9]+)_m$/.exec(k) || [])[1]).filter(Boolean);
const hist = () => Object.values((DB.boards && DB.boards.ac3 && DB.boards.ac3.history) || {}).map(h => h.desc);

// ─────────────────────────────────────────────────────────────── seed ──
[LEAD, DRAFTER, STAFF].forEach(mkUser);
DB = {
  meta: { project: 'design', name: 'AF Design Boards' },
  allowlist: { [key(LEAD)]: true, [key(DRAFTER)]: true },
  boardInfo: { ac3: { name: 'Atlantic-Chestnut Building 3', _by: LEAD, _ts: 1 }, hillview: { name: 'Hillview', _by: LEAD, _ts: 1 } },
};

try {
  console.log('Schedules — lead adds an Excel file');
  const lead = await open(LEAD);
  await lead.waitForSelector('#fileBar .note', { timeout: 15000 });
  ok(/No files on this board yet/.test(await lead.textContent('#fileBar')), 'empty AC3 board: "No files on this board yet"');
  ok((await lead.inputValue('#boardSel')) === 'ac3', 'board picker opens the board in the link (#b=ac3)');
  ok(/spark/.test(await lead.textContent('#who')) && !/view only/.test(await lead.textContent('#who')), 'signed-in name shown, no name box to fill');
  ok((await lead.getAttribute('.pagetabs a[href^="./?tab=drawings"]', 'href')) === './?tab=drawings#b=ac3', 'tabs link back to this board\'s Review comments / Drawings');
  await lead.setInputFiles('#fileAdd', X1);
  ok(await until(() => fileIds().length === 1 && piece('i_1')), 'file saved to the design database as pieces; red cell F5 became issue #1');
  const fid = fileIds()[0];
  ok(piece('i_1').cells.join() === 'F5' && piece('i_1').status === 'open' && piece('b').order[0] === fid, 'issue #1 is on F5, open; board lists the file');
  ok(DB.schedules.ac3.meta._by === LEAD, 'save is signed by the lead');
  ok(await until(() => DB.scheduleFiles && DB.scheduleFiles.ac3 && DB.scheduleFiles.ac3[fid] && DB.scheduleFiles.ac3[fid].data.length > 1000), 'original .xlsx kept for export');
  ok(await until(() => hist().some(d => /Schedules: added Wall types\.xlsx/.test(d))), 'Design Board History: "Schedules: added Wall types.xlsx"');

  // the lead edits a cell
  await lead.waitForSelector('#grid td[data-a="E6"]');
  await lead.click('#grid td[data-a="E6"]');
  await lead.fill('#fbar', '5');
  await lead.press('#fbar', 'Enter');
  ok(await until(() => (piece('f_' + fid + '_log') || []).length === 1), 'cell edit saved (one step in the file\'s History)');
  const logChunkBefore = chunks()['f_' + fid + '_base'];
  if (process.env.SHOTS) await lead.screenshot({ path: path.join(process.env.SHOTS, 'schedules-lead.png') });

  console.log('Schedules — drafter on another computer');
  const dr = await open(DRAFTER);
  await dr.waitForSelector('#grid td[data-a="E6"]', { timeout: 15000 });
  ok((await dr.textContent('#grid td[data-a="E6"]')).trim() === '5', 'drafter sees the lead\'s edit (E6 = 5)');
  ok(/Issues \(1\)/.test(await dr.textContent('#sideTabs')), 'drafter sees issue #1');
  // the drafter answers the issue while the lead keeps editing: neither overwrites the other
  await lead.click('#grid td[data-a="B4"]');
  await lead.fill('#fbar', 'Storefront (thermal)');
  await lead.press('#fbar', 'Enter');
  ok(await until(() => (piece('f_' + fid + '_log') || []).length === 2), 'lead\'s second edit saved');
  await dr.evaluate(async () => { const i = window.__design.B.issues[0]; i.status = 'answered'; i.trail.push({ t: Date.now(), by: 'henry.kim', what: 'Answered' }); await window.__design.flush(); });
  ok(await until(() => piece('i_1') && piece('i_1').status === 'answered'), 'drafter\'s answer to issue #1 saved');
  ok((piece('f_' + fid + '_log') || []).length === 2, 'the drafter\'s save did not undo the lead\'s newer edit (only changed pieces are written)');
  ok(chunks()['f_' + fid + '_base'] === logChunkBefore, 'file contents were not re-sent by an issue change');
  // the lead's page picks up the drafter's change
  await lead.evaluate(() => window.__fbRefresh());
  ok(await until(async () => true) && await lead.waitForFunction(() => window.__design.B.issues[0].status === 'answered', null, { timeout: 6000 }).then(() => true, () => false), 'lead\'s page updates live with the drafter\'s answer');
  ok(/Updated by henry\.kim/.test(await lead.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')), 'toast says who changed it');
  ok((await lead.textContent('#grid td[data-a="B4"]')).includes('Storefront (thermal)'), 'lead keeps their own edits after the update');
  // the drafter's page picks up the lead's second edit
  await dr.evaluate(() => window.__fbRefresh());
  ok(await dr.waitForFunction(() => (document.querySelector('#grid td[data-a="B4"]') || {}).textContent.includes('thermal'), null, { timeout: 6000 }).then(() => true, () => false), 'drafter\'s page shows the lead\'s second edit');

  console.log('Schedules — new version and export');
  await lead.click('#fileBar [data-act="newVer"]');
  await lead.setInputFiles('#fileVer', X2);
  await lead.waitForSelector('#dlgImport[open]');
  ok(/Upload a new version/.test(await lead.textContent('#dlgImportH')), 'same tabs: offered as a new version');
  await lead.click('#btnImportOk');
  ok(await until(() => (piece('f_' + fid + '_m') || {}).versions && piece('f_' + fid + '_m').versions.length === 2), 'version 2 saved');
  ok(await until(() => piece('i_1') && piece('i_1').suggestClose), 'red color gone in v2: issue #1 gets a "close?" suggestion (nothing closes by itself)');
  ok(await until(() => hist().some(d => /new version of Wall types\.xlsx \(Wall types rev1\.xlsx\)/.test(d))), 'History: "new version of Wall types.xlsx"');
  await lead.click('#btnExport');
  await lead.waitForSelector('#dlgExport[open]');
  const [dl] = await Promise.all([lead.waitForEvent('download', { timeout: 15000 }), lead.click('#btnDoExport')]);
  const out = fs.readFileSync(await dl.path());
  ok(out.slice(0, 2).toString() === 'PK' && /Wall types/.test(dl.suggestedFilename()), 'export downloads ' + dl.suggestedFilename());
  const wb = new ExcelJS.Workbook(); await wb.xlsx.load(out);
  ok(wb.worksheets.some(w => w.name === 'Board issues') && wb.getWorksheet('WALL TYPES').getCell('E6').value === 3, 'exported file has the board issues tab and v2 values');

  console.log('Schedules — staff can look, not change');
  const before = JSON.stringify(DB.schedules);
  const deniedBefore = denied;
  const st = await open(STAFF);
  await st.waitForSelector('#grid td[data-a="E6"]', { timeout: 15000 });
  ok(/view only/.test(await st.textContent('#who')), 'staff: "view only" next to the name');
  if (process.env.SHOTS) await st.screenshot({ path: path.join(process.env.SHOTS, 'schedules-staff.png') });
  await st.click('#grid td[data-a="E6"]');
  await st.fill('#fbar', '99').catch(() => {});
  await st.press('#fbar', 'Enter').catch(() => {});
  await st.click('#btnAdd');
  ok(/View only/.test(await st.evaluate(() => (document.querySelector('.toast') || {}).textContent || '')), 'staff: "View only" when trying to change');
  await new Promise(r => setTimeout(r, 400));
  ok(JSON.stringify(DB.schedules) === before, 'staff changed nothing in the database');
  ok(denied === deniedBefore, 'the page did not even try to write for staff');

  console.log('Schedules — Design Board links here');
  await lead.goto(BASE + '#b=ac3');
  await lead.waitForSelector('#tabs a.tablink');
  ok(await lead.waitForFunction(() => /schedules\.html#b=ac3$/.test(document.querySelector('#tabs a.tablink').href), null, { timeout: 6000 }).then(() => true, () => false), 'Design Board has a "Schedules (Excel)" tab for the same board');
} catch (e) {
  fail++; console.log('  FAIL ' + (e.stack || e));
}
ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
await browser.close(); server.close();
fs.rmSync(TMP, { recursive: true, force: true });
console.log(`\nschedules e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
