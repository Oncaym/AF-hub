#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AF Helper chat (/assistant/) in a real browser: the design database and
   the AC3 tracker database in memory, every read/write checked with the real
   rules files (targaryen), the Firebase SDK stubbed (e2e/fake-firebase.js)
   and /api/agent replaced by a scripted "Claude" that calls the tools.

     node platform/tests/assistant.e2e.mjs        (needs playwright, targaryen)

   Shows: reads go through the person's session; a proposed change is saved
   only after Confirm, signed by that person; the tracker write passes the
   project rules (_project stamp); someone who is only a viewer of AC3 gets
   no Confirm button; the desktop helper's old URL opens the chat.
   ───────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'projects.json'), 'utf8'));
const rulesOf = f => JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', f), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const DESIGN = REG.design.databaseURL, AC3 = REG.projects.find(p => p.id === 'ac3').databaseURL, LEX = REG.projects.find(p => p.id === 'lex').databaseURL;
const RULES = { [DESIGN]: rulesOf(REG.design.rules), [AC3]: rulesOf('project-database.rules.json'), [LEX]: rulesOf('project-database.rules.json') };
const targaryen = require('targaryen');
const { chromium } = require('playwright');
const ExcelJS = require('exceljs');
import os from 'node:os';

const PW = 'pw-1', LEO = 'leosun@advfacade.com', HENRY = 'henry.kim@advfacade.com';
const key = e => e.replace(/\./g, ',');

// two versions of an Excel schedule: v1 has a red cell (→ issue), v2 changes a qty and drops the red
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'helper-x-'));
async function makeXlsx(v) {
  const wb = new ExcelJS.Workbook(); const ws = wb.addWorksheet('WALL TYPES');
  ws.getCell('A1').value = 'TEST — WALL TYPE SCHEDULE'; ws.addRow([]); ws.addRow(['MARK', 'DESCRIPTION', 'WIDTH', 'HEIGHT', 'QTY', 'NOTES']);
  [['W1', 'Storefront', `5'-0"`, `8'-0"`, 4, ''], ['W2', 'Curtain wall', `6'-0"`, `10'-0"`, 2, 'Verify with arch'], ['W3', 'Window', `4'-0"`, `5'-0"`, v === 2 ? 3 : 6, '']].forEach(r => ws.addRow(r));
  if (v === 1) ws.getCell('F5').fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFF0000' } };
  wb.addWorksheet('NOTES').getCell('A1').value = 'notes';
  const f = path.join(TMP, v === 1 ? 'Wall types.xlsx' : 'Wall types rev1.xlsx'); fs.writeFileSync(f, Buffer.from(await wb.xlsx.writeBuffer())); return f;
}
const X1 = await makeXlsx(1), X2 = await makeXlsx(2);
const EXCELJS_MIN = fs.readFileSync(path.join(path.dirname(require.resolve('exceljs/package.json')), 'dist', 'exceljs.min.js'));
const SHEETJS_STUB = 'window.XLSX={read:function(){return{SheetNames:["WALL TYPES"],Sheets:{"WALL TYPES":{}}}},utils:{sheet_to_csv:function(){return "MARK,DESCRIPTION,QTY\\nW1,Storefront,4"}}};';
const attNo = (msgs, name) => { const m = JSON.stringify(msgs).match(new RegExp('attachment (\\d+) \\(' + name.replace(/[.]/g, '\\.'))); return m ? +m[1] : 0; };
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };
async function until(fn, ms = 5000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 50)); } return false; }

// ───────────────────────────────────────────────────── in-memory databases ──
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function dget(o, p) { for (const k of p.split('/').filter(Boolean)) { if (o == null || typeof o !== 'object') return undefined; o = o[k]; } return o; }
function dset(root, p, v) { const ks = p.split('/').filter(Boolean); if (!ks.length) return v == null ? {} : v; let o = root; for (let i = 0; i < ks.length - 1; i++) { if (o[ks[i]] == null || typeof o[ks[i]] !== 'object') o[ks[i]] = {}; o = o[ks[i]]; } if (v == null) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v; return root; }
const sv = (v, now) => (v && typeof v === 'object' ? (v['.sv'] === 'timestamp' ? now : Array.isArray(v) ? v.map(x => sv(x, now)) : Object.fromEntries(Object.entries(v).map(([k, x]) => [k, sv(x, now)]))) : v);
const users = { [LEO]: { uid: 'u_leo', email: LEO, emailVerified: true, password: PW }, [HENRY]: { uid: 'u_henry', email: HENRY, emailVerified: true, password: PW } };
const DB = {
  [DESIGN]: {
    meta: { project: 'design' },
    allowlist: { [key(LEO)]: true, [key(HENRY)]: true },
    boardInfo: { ac3: { name: 'Atlantic-Chestnut Building 3', _by: LEO, _ts: 1 } },
    boards: { ac3: {
      drawings: { 'AC3-103': { no: 'AC3-103', title: 'CURTAIN WALL SECTION (SF-01)', status: 'revise', owner: HENRY, rev: '2', _by: LEO, _ts: 1 },
                  'AC3-500': { no: 'AC3-500', title: 'CURTAIN WALL PLAN DETAILS', status: 'drafting', _by: LEO, _ts: 1 } },
      issues: { i1: { n: 1, dwg: 'AC3-103', text: 'Change TOB to T.O.HSS', status: 'open', owner: HENRY, reviewer: 'spark', created: 1, _by: LEO, _ts: 1 } },
    } },
  },
  [AC3]: {
    meta: { project: 'ac3' },
    allowlist: { [key(LEO)]: true },
    state: { _clientId: 'x', _ts: 1, _by: LEO, _project: 'ac3', updatedAt: '2026-10-14',
      units: [{ key: 'SF11A__1', id: 'SF11A', zone: 'L1', status: 'pending' }, { key: 'SF12__1', id: 'SF12', zone: 'L1', status: 'installed', date: '2026-10-10' }],
      log: [{ date: '2026-10-10', category: 'glass', content: 'SF12 glass in' }],
      submittals: [{ id: 's1', number: '6', title: 'Storefront Shop Drawings', status: 'revise-resubmit', rev: '1' }] },
  },
  [LEX]: { meta: { project: 'lex' } },
};
let denied = 0;
function handle(op, a) {
  const now = Date.now();
  if (op === 'signIn') { const u = users[a.email]; return u && u.password === a.password ? { uid: u.uid, email: u.email, emailVerified: true } : null; }
  if (op === 'user') return { emailVerified: true };
  if (op === 'sendVerification' || op === 'reset' || op === 'upload') return null;
  if (!RULES[a.url]) throw new Error('unknown database ' + a.url);
  const db = targaryen.database(RULES[a.url], clone(DB[a.url]), now).as(a.auth || null);
  if (op === 'read') { const allowed = db.read(a.path).allowed; return { allowed, value: allowed ? clone(dget(DB[a.url], a.path)) : undefined }; }
  const value = sv(a.value, now);
  const allowed = (a.op === 'update' ? db.update(a.path, value) : db.write(a.path, value)).allowed;
  if (!allowed) { denied++; return { allowed }; }
  if (a.op === 'update') for (const k of Object.keys(value)) dset(DB[a.url], a.path + '/' + k, value[k]);
  else DB[a.url] = dset(DB[a.url], a.path, value);
  return { allowed };
}

// ─────────────────────────────────────────────────────── scripted "Claude" ──
const calls = [];
function claude(body) {
  calls.push(body);
  const msgs = body.messages, last = msgs[msgs.length - 1];
  const blocks = Array.isArray(last.content) ? last.content : [{ type: 'text', text: last.content }];
  const results = blocks.filter(b => b.type === 'tool_result');
  const text = blocks.filter(b => b.type === 'text').map(b => b.text).join(' ');
  const use = (name, input) => ({ content: [{ type: 'tool_use', id: 'tu_' + calls.length, name, input }], stop_reason: 'tool_use' });
  const say = t => ({ content: [{ type: 'text', text: t }], stop_reason: 'end_turn' });
  if (results.length) {
    const r = results[0].content;
    const prevUse = msgs[msgs.length - 2].content.find(b => b.type === 'tool_use');
    if (prevUse.name === 'get_tracker' && /SF11A__1/.test(r)) return use('propose_tracker_update', { project: 'ac3', unit_updates: [{ key: 'SF11A__1', status: 'installed', date: '2026-10-15', note: 'Framing 10-15' }], log_entries: [{ date: '2026-10-15', category: 'framing', content: 'SF11A installed' }], summary: 'SF11A installed 10/15' });
    if (prevUse.name === 'get_schedules' && /"id":1/.test(r)) return use('propose_schedule_issue_changes', { board: 'ac3', changes: [{ id: 1, status: 'asked', owner: 'Architect', reply: 'Asked the architect in RFI 12' }, { id: 9, status: 'closed' }], summary: 'issue 1 asked' });
    if (prevUse.name.startsWith('propose_')) return say('请确认上面的卡片。');
    return say('**AC3** 还有 1 条没改：\n- #1 AC3-103 Change TOB to T.O.HSS（for henry.kim）\n\nTool said: ' + r.slice(0, 120));
  }
  if (/还剩/.test(text)) return use('get_design', { board: 'ac3', status: 'active' });
  if (/新版本/.test(text)) return use('propose_schedule_import', { board: 'ac3', attachment: attNo(msgs, 'Wall types rev1.xlsx') });
  if (/导入/.test(text)) return use('propose_schedule_import', { board: 'ac3', attachment: attNo(msgs, 'Wall types.xlsx') });
  if (/Excel 表/.test(text)) return use('get_schedules', { board: 'ac3', part: 'issues' });
  if (/记成意见/.test(text)) return use('propose_design_comments', { board: 'ac3', comments: [{ dwg: 'AC3-500', where: 'Residential canopy plan', text: 'Dimension 3/4" from the W8X20 beam line', orig: '3/4"가 beam부터라는게 잘 안느껴져요', reviewer: 'SPARK', owner: HENRY, attachments: [1] }], summary: 'from Discord' });
  if (/installed/i.test(text)) return use('get_tracker', { project: 'ac3', part: 'units', filter: 'SF11A' });
  if (/rev 3/.test(text)) return use('propose_design_changes', { board: 'ac3', changes: [{ kind: 'comment', n: 1, status: 'fixed', rev: '3' }, { kind: 'comment', n: 2, status: 'closed' }], summary: '#1 fixed in rev 3' });
  return say('OK');
}

// ───────────────────────────────────────────────────────────── server ──
const server = http.createServer((req, res) => {
  const u = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  let f = path.join(ROOT, u); if (f.endsWith('/')) f += 'index.html';
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); res.end(); return; }
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}`;
const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const errors = [];
async function open(email, url) {
  const c = await browser.newContext({ viewport: { width: 430, height: 760 } });
  await c.exposeFunction('__fb', (op, args) => handle(op, args));
  const fake = fs.readFileSync(path.join(here, 'e2e', 'fake-firebase.js'), 'utf8');
  await c.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: /firebase-app-compat\.js$/.test(r.request().url()) ? fake : '' }));
  await c.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/exceljs\/4\.4\.0\/exceljs\.min\.js/, r => r.fulfill({ contentType: 'text/javascript', body: EXCELJS_MIN }));
  await c.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/xlsx\//, r => r.fulfill({ contentType: 'text/javascript', body: SHEETJS_STUB }));
  await c.route(/\/api\/agent$/, r => { const b = JSON.parse(r.request().postData()); r.fulfill({ status: b.token ? 200 : 403, contentType: 'application/json', body: JSON.stringify(b.token ? claude(b) : { error: 'no token' }) }); });
  const p = await c.newPage(); p.on('pageerror', e => errors.push(e.message));
  await p.addInitScript(() => { window.afHelper = { setBadge: n => { window.__badge = n; }, notify: t => { (window.__notes = window.__notes || []).push(t); } }; });
  await p.goto(BASE + (url || '/assistant/'));
  await p.fill('#gEmail', email); await p.fill('#gPwd', PW); await p.click('#gForm button[type=submit]');
  await p.waitForSelector('#msg');
  return p;
}
const lastBot = p => p.$$eval('.msg.bot .b', els => els.length ? els[els.length - 1].innerText : '');

try {
  console.log('Leo (design editor, AC3 editor)');
  const p = await open(LEO, '/design/?mini=1');
  ok(/\/assistant\/$/.test(new URL(p.url()).pathname), 'the helper\'s old URL (/design/?mini=1) opens the chat');
  await p.waitForSelector('.hello .chip');
  ok(true, 'greeting with suggestions');

  // 1. a question → get_design → answer
  await p.fill('#msg', 'AC3 还剩哪些意见没改？'); await p.keyboard.press('Enter');
  await p.waitForFunction(() => /还有 1 条没改/.test(document.querySelector('#chat').innerText));
  const tr = calls[calls.length - 1].messages.slice(-1)[0].content[0];
  ok(tr.type === 'tool_result' && /"n":1/.test(tr.content) && /comments_by_status/.test(tr.content), 'get_design ran in the page and returned comment #1 with exact counts');
  ok(/<li>/.test(await p.innerHTML('#chat')), 'the answer is rendered (list)');
  ok(calls[0].context.boards[0].id === 'ac3' && calls[calls.length - 1].context.projects.some(x => x.id === 'ac3' && x.role === 'editor'), 'context tells Claude the boards and that Leo is an AC3 editor');

  // 2. paste a picture + "记成意见" → card → confirm → saved with the picture
  await p.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 300; c.height = 200; const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 300, 200); g.strokeStyle = '#f0f'; g.lineWidth = 5; g.strokeRect(30, 30, 100, 80);
    const blob = await new Promise(r => c.toBlob(r, 'image/png')); const dt = new DataTransfer(); dt.items.add(new File([blob], 'markup.png', { type: 'image/png' }));
    document.dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await p.waitForSelector('#atts .att');
  await p.fill('#msg', '把这张截图记成意见'); await p.keyboard.press('Enter');
  await p.waitForSelector('.pcard [data-yes]');
  const sentImg = calls.find(c => JSON.stringify(c.messages).includes('"type":"image"'));
  ok(!!sentImg && /attachment 1 \(markup\.png\)/.test(JSON.stringify(sentImg.messages)), 'the picture went to Claude labelled "attachment 1"');
  const nBefore = Object.keys(DB[DESIGN].boards.ac3.issues).length;
  ok(nBefore === 1, 'nothing saved before Confirm');
  await p.click('.pcard [data-yes]');
  await p.waitForSelector('.pcard.done');
  const i2 = Object.values(DB[DESIGN].boards.ac3.issues).find(i => i.n === 2) || {};
  ok(i2.dwg === 'AC3-500' && i2._by === LEO && i2.source === 'claude' && Object.keys(i2.imgs || {}).length === 1, 'confirmed: #2 on AC3-500, signed by Leo, with the picture');
  ok(Object.keys(DB[DESIGN].images.ac3).length === 1, 'picture stored once under /images');

  // 3. design changes: #1 fixed (ok) and #2 closed (refused: not fixed yet)
  await p.fill('#msg', '#1 Henry 改好了 rev 3，#2 关掉'); await p.keyboard.press('Enter');
  await p.waitForSelector('.pcard:not(.done) [data-yes]');
  ok(/must be marked fixed before it can be closed/.test(await p.innerText('.pcard:not(.done)')), 'closing #2 before it is fixed is flagged, not proposed');
  ok(/\(Since your last reply: The person confirmed and it was saved/.test(JSON.stringify(calls[calls.length - 2].messages)), 'Claude is told the earlier card was confirmed');
  await p.click('.pcard:not(.done) [data-yes]');
  ok(await until(() => DB[DESIGN].boards.ac3.issues.i1.status === 'fixed' && DB[DESIGN].boards.ac3.issues.i1.fixedRev === '3'), '#1 fixed in rev 3 after Confirm');

  // 4. tracker: "SF11A installed today" → read units → card → confirm → /state written with stamps
  await p.fill('#msg', 'SF11A installed today'); await p.keyboard.press('Enter');
  await p.waitForSelector('.pcard:not(.done) [data-yes]');
  ok(/SF11A[\s\S]*pending[\s\S]*installed/.test(await p.innerText('.pcard:not(.done)')), 'the card shows SF11A pending → installed');
  ok(DB[AC3].state.units[0].status === 'pending', 'tracker untouched before Confirm');
  await p.click('.pcard:not(.done) [data-yes]');
  ok(await until(() => DB[AC3].state.units[0].status === 'installed'), 'after Confirm SF11A is installed');
  const st = DB[AC3].state;
  ok(st._project === 'ac3' && st._by === LEO && st.log.length === 2 && st.log[1].categories[0] === 'framing' && st.units.length === 2 && st.submittals.length === 1, 'state saved whole, stamped for AC3 by Leo, log added, nothing else lost');
  ok(await until(() => Object.values(DB[AC3].history || {}).some(h => /SF11A installed/.test(h.desc))), 'tracker history row written');

  // 4b. Excel schedules: attach an .xlsx, "导入" → card → confirm → on the board's Schedules (cloud)
  const sch = () => (DB[DESIGN].schedules && DB[DESIGN].schedules.ac3 && DB[DESIGN].schedules.ac3.chunks) || {};
  const piece = k => (sch()[k] ? JSON.parse(sch()[k]) : undefined);
  const fids = () => Object.keys(sch()).map(k => (/^f_([A-Za-z0-9]+)_m$/.exec(k) || [])[1]).filter(Boolean);
  await p.setInputFiles('#fileIn', X1);
  await p.waitForSelector('#atts .att');
  await p.fill('#msg', '把这个 Excel 导入 AC3'); await p.keyboard.press('Enter');
  await p.waitForSelector('.pcard:not(.done) [data-yes]');
  const impCard = await p.innerText('.pcard:not(.done)');
  ok(/Add Wall types\.xlsx as a new file/.test(impCard) && /1 new issue/.test(impCard), 'import card: add Wall types.xlsx, 1 new issue from the red cell');
  ok(!fids().length, 'nothing on the board before the button');
  await p.click('.pcard:not(.done) [data-yes]');
  ok(await until(() => fids().length === 1 && piece('i_1') && piece('i_1').cells.join() === 'F5'), 'after the button: file on AC3 Schedules, issue #1 on F5');
  ok(await until(() => DB[DESIGN].scheduleFiles && Object.keys(DB[DESIGN].scheduleFiles.ac3 || {}).length === 1), 'original .xlsx stored for export');
  ok(DB[DESIGN].schedules.ac3.meta._by === LEO && piece('f_' + fids()[0] + '_m').addedBy === 'leosun', 'saved and signed by Leo');
  await p.fill('#msg', 'AC3 的 Excel 表有哪些问题？'); await p.keyboard.press('Enter');
  await p.waitForSelector('.pcard:not(.done) [data-yes]');
  const gs = calls[calls.length - 2].messages.slice(-1)[0].content.find(b => b.type === 'tool_result');
  ok(gs && /"open_issues":1/.test(gs.content) && /Verify with arch|F5/.test(gs.content), 'get_schedules returned the issue log with exact counts');
  const ic = await p.innerText('.pcard:not(.done)');
  ok(/Open[\s\S]*Asked/.test(ic) && /RFI 12/.test(ic) && /issue 9 does not exist/.test(ic), 'issue card: #1 Open → Asked, reply shown; unknown #9 flagged');
  await p.click('.pcard:not(.done) [data-yes]');
  ok(await until(() => piece('i_1').status === 'asked' && piece('i_1').owner === 'Architect' && piece('i_1').thread.length === 1), 'after the button: #1 asked, owner Architect, reply in its thread');
  await p.setInputFiles('#fileIn', X2);
  await p.waitForFunction(() => document.querySelectorAll('#atts .att').length === 1);
  await p.fill('#msg', '这是新版本'); await p.keyboard.press('Enter');
  await p.waitForSelector('.pcard:not(.done) [data-yes]');
  const vc = await p.innerText('.pcard:not(.done)');
  ok(/new version of Wall types\.xlsx/.test(vc) && /version 2/.test(vc) && /row|cell/.test(vc), 'same tab names: card offers version 2 of Wall types.xlsx and lists what changed');
  await p.click('.pcard:not(.done) [data-yes]');
  ok(await until(() => fids().length === 1 && (piece('f_' + fids()[0] + '_m').versions || []).length === 2), 'after the button: version 2 saved, still one file');
  ok(await until(() => Object.values(DB[DESIGN].boards.ac3.history || {}).some(h => /Schedules: new version of Wall types\.xlsx/.test(h.desc))), 'Design Board History shows the new version');

  if (process.env.SHOTS) await p.screenshot({ path: path.join(process.env.SHOTS, 'helper-chat.png') });

  // 5. badge: Henry's to-do count reaches his helper
  console.log('Henry (design editor, AC3 viewer only)');
  const h = await open(HENRY);
  await h.waitForFunction(() => typeof window.__badge === 'number');
  ok(await h.evaluate(() => window.__badge) === 1, 'Henry\'s helper badge = 1 (#2 for him; #1 is fixed and waits for the reviewer)');
  await h.fill('#msg', 'SF11A installed today'); await h.keyboard.press('Enter');
  await h.waitForSelector('.pcard .pf .warn');
  ok(!(await h.$('.pcard [data-yes]')), 'Henry is only a viewer of AC3: the card has no Confirm');

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  ok(denied === 0, `no write refused by the rules (${denied})`);
} catch (e) { fail++; console.log('  FAIL ' + (e.stack || e.message)); }
finally { await browser.close(); server.close(); fs.rmSync(TMP, { recursive: true, force: true }); }
console.log(`assistant e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
