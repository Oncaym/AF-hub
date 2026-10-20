#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The Design Board page (/design/) in a real browser against an in-memory
   design database whose every read and write is checked with the real
   platform/design-database.rules.json (targaryen) through the stub SDK in
   e2e/fake-firebase.js.

     node platform/tests/design.e2e.mjs          (needs: playwright, targaryen, pdfjs-dist)

   Walks the AC3 pilot: create the board, import "AC3 drawing list.pdf",
   add a review comment with a pasted screenshot, the drafter marks it fixed,
   the reviewer closes it; a boss sees it read-only; the project's PM edits that
   board only; other staff and a tracker foreman see no board (Leo 10-20).
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
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', REG.design.rules), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const URL_DB = REG.design.databaseURL;
const targaryen = require('targaryen');
const { chromium } = require('playwright');

/* The drawing list: the real AC3 one when it is next to the code (Leo's computer;
   it is git-ignored: client data), else a made-up sheet with the same layout traps. */
const REAL_PDF = path.join(ROOT, 'AC3 drawing list.pdf');
const REAL = !process.env.DESIGN_FIXTURE && fs.existsSync(REAL_PDF);
const PDF = REAL ? REAL_PDF : path.join(here, 'fixtures', 'drawing-list-sample.pdf');
const NDWG = REAL ? 78 : 7;
const D1 = REAL ? 'AC3-103' : 'SMP-100A';   // the drawing the review comments are on
const D2 = REAL ? 'AC3-500' : 'SMP-500';
const PW = 'pw-1';
const LEAD = 'spark@advfacade.com', DRAFTER = 'henry.kim@advfacade.com', STAFF = 'haodong@advfacade.com', FOREMAN = 'joe.foreman@gmail.com';
const BOSS = 'nan@advfacade.com', PM = 'cdu@advfacade.com';
const key = e => e.replace(/\./g, ',');

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) { pass++; console.log('  ok   ' + m); } else { fail++; console.log('  FAIL ' + m); } };

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
const mkUser = (email, verified = true, claims) => { users[email] = { uid: 'u_' + email.replace(/\W/g, '_'), email, emailVerified: verified, password: PW, claims }; };
let DB = {};
let denied = 0;
const fbLog = [];
function handle(op, a) {
  const now = Date.now();
  fbLog.push(op + ' ' + (a.op || '') + ' ' + (a.path || a.email || ''));
  if (op === 'signIn') { const u = users[a.email]; return u && u.password === a.password ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified, claims: u.claims } : null; }
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
  const type = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.pdf': 'application/pdf' }[path.extname(f)] || 'application/octet-stream';
  res.writeHead(200, { 'Content-Type': type }); res.end(fs.readFileSync(f));
});
await new Promise(r => server.listen(0, '127.0.0.1', r));
const BASE = `http://127.0.0.1:${server.address().port}/design/`;

const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const pdfjsDir = path.dirname(require.resolve('pdfjs-dist/package.json'));
async function ctx() {
  const c = await browser.newContext({ viewport: { width: 1200, height: 900 } });
  await c.exposeFunction('__fb', (op, args) => handle(op, args));
  const fake = fs.readFileSync(path.join(here, 'e2e', 'fake-firebase.js'), 'utf8');
  await c.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: /firebase-app-compat\.js$/.test(r.request().url()) ? fake : '' }));
  await c.route(/cdnjs\.cloudflare\.com\/ajax\/libs\/pdf\.js\/3\.11\.174\/(pdf(\.worker)?)\.min\.js/, r => {
    const m = r.request().url().match(/(pdf(\.worker)?)\.min\.js/);
    r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(path.join(pdfjsDir, 'build', m[1] + '.min.js')) });
  });
  /* 🔍 Check DXF: a stand-in for Python-in-the-browser (the real one is ~10 MB from jsdelivr;
     design/review_selftest.py checks the checker itself). It answers like review.run(). */
  await c.route(/cdn\.jsdelivr\.net\/pyodide\/v0\.26\.4\/full\/pyodide\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: `
    self.loadPyodide = async () => { const fs = {}; return {
      loadPackage: async () => {}, pyimport: () => ({ install: async () => {} }), toPy: x => x, globals: { set() {} },
      FS: { mkdirTree() {}, writeFile(p, d) { fs[p] = d; } },
      runPython(src) {
        if (!/review\\.run/.test(src)) return;
        const got = Object.keys(fs).filter(p => p.startsWith('/check/in/')).map(p => p.split('/').pop());
        return 'Drawing review\\n\\nAC3-202  (' + got.join(', ') + ')\\n  ✗ Title block says AC3-203, but this sheet is AC3-202.\\n'
          + '  ⚠ "OFF THE SHEET" runs off the sheet.\\n  (checker: ' + (fs['/check/review.py'] ? 'review.py loaded' : 'no review.py') + ')\\n';
      } }; };` }));
  await c.route(/\/api\/design$/, async r => {
    const b = JSON.parse(r.request().postData() || '{}');
    apiCalls.push(b);
    if (!b.token) return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"no token"}' });
    if (b.mode === 'pull') {
      const png = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
      return r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({
        comments: [{ images: [0], dwg: D2, where: 'Residential Typ. Canopy Plan Details', text: 'Dimension the 3/4" from the W8X20 beam line', orig: '3/4"가 beam부터라는게 잘 안느껴져요', reviewer: 'SPARK', owner: DRAFTER }],
        note: '', images: [png], last_id: b.after ? '2002' : '2001', more: false, transcript: 'SPARK: 이렇게 바꿔주세요 [screenshot 0]' }) });
    }
    const body = b.mode === 'split'
      ? { comments: [
          { images: [0], dwg: D1, where: 'East Glass Canopy', text: 'Write T.O.HSS for the 6\'-5" dimension', orig: '6\'5"는 저 C beam이 아니고 top HSS tube에요', reviewer: 'SPARK', owner: DRAFTER, already_fixed: true },
          { images: [], dwg: D1, where: 'South & East', text: 'Same T.O.HSS change on South and East', orig: 'South & East도 동일하게 하겠습니다.', reviewer: 'SPARK', owner: DRAFTER },
          { images: [1], dwg: 'NOT-A-DWG', where: 'Section 2nd FL to T.O.HSS', text: '10\'-3 3/4" circled, no words', reviewer: 'SPARK', unclear: true, question: 'What should change at 10\'-3 3/4"?' },
        ], note: '✅ reactions were read as "seen", not "fixed".' }
      : { answer: '#3 is still to fix (South & East).', actions: [{ kind: 'comment_status', id: Object.entries(DB.boards.ac3.issues).find(([, v]) => v.n === 3)[0], status: 'fixed', rev: '3', why: 'Mark #3 fixed in rev 3' }] };
    r.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body) });
  });
  return c;
}
const apiCalls = [];
async function signIn(page, email, url) {
  await page.goto(url || BASE);
  await page.fill('#gEmail', email); await page.fill('#gPwd', PW);
  await page.click('#gForm button[type=submit]');
}
const errors = [];
/* The page's writes reach this process through an exposed binding; wait for the
   database to show them instead of assuming the DOM and the store move together. */
async function until(fn, ms = 5000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 50)); }
  return false;
}
const watch = page => { page.on('pageerror', e => errors.push(e.message)); };

// ─────────────────────────────────────────────────────────────── seed ──
mkUser(LEAD); mkUser(DRAFTER); mkUser(STAFF); mkUser(FOREMAN); mkUser(BOSS, true, { boss: true }); mkUser(PM);
DB = { meta: { project: 'design', name: 'AF Design Boards' }, allowlist: { [key(LEAD)]: true, [key(DRAFTER)]: true } };

try {
  // 1. Lead: create the AC3 board, import the drawing list.
  console.log('lead');
  const c1 = await ctx(); const p1 = await c1.newPage(); watch(p1);
  await signIn(p1, LEAD);
  await p1.waitForSelector('#firstBoard');
  ok(await p1.isVisible('text=editor'), 'lead is an editor');
  await p1.click('#firstBoard');
  await p1.fill('#nbName', 'Atlantic-Chestnut Building 3');
  await p1.fill('#nbId', 'ac3');
  await p1.click('#nbGo');
  await p1.waitForSelector('#view .tiles');
  const boardOk = await until(() => DB.boardInfo.ac3._by === LEAD);
  if (!boardOk) console.log('    DB now:', JSON.stringify(DB).slice(0, 500), '| toast:', await p1.textContent('#toast'), '| errors:', errors, '| calls:', fbLog.slice(-8));
  ok(boardOk, 'board ac3 saved, signed by the lead');

  await p1.click('#tabs button[data-tab=drawings]');
  await p1.click('#importPdf');
  await p1.setInputFiles('#ipFile', PDF);
  await p1.waitForSelector('#ipGo:not([disabled])', { timeout: 20000 });
  const found = await p1.$$eval('input[data-ri]', els => els.length);
  ok(found === NDWG, `drawing list PDF (${REAL ? 'real AC3' : 'sample'}): ${found} drawings found, want ${NDWG}`);
  await p1.click('#ipGo');
  await p1.waitForFunction(n => document.querySelectorAll('tr.row').length === n, NDWG);
  await until(() => Object.keys(DB.boards.ac3.drawings).length === NDWG);
  const dw = k => DB.boards.ac3.drawings[k] || {};
  if (REAL) {
    ok(dw('AC3-100').title === 'MAISONETTE ENTRY ELEVATION & PLAN (W11, W12, W12A)' && dw('AC3-100').scale === '1-1/2"=1\'-0"', 'AC3-100 read right: ' + dw('AC3-100').title + ' / ' + dw('AC3-100').scale);
    ok(dw('AC3-010').title === 'KEY PLAN @ 1ST FLOOR' && dw('AC3-010').scale === '3/32"=1\'-0"', 'AC3-010 read right');
    ok(dw('AC3-CS').title === 'COVER SHEET' && dw('AC3-620').title === 'CURTAIN WALL SF 16 METAL PANEL SECTION DETAILS', 'first and last sheet read right');
  } else {
    ok(dw('SMP-100').title === 'CURTAIN WALL ELEVATION & PLAN (CW-01, CW-02)' && dw('SMP-100').scale === '1-1/2"=1\'-0"', 'SMP-100 read right: ' + dw('SMP-100').title + ' / ' + dw('SMP-100').scale);
    ok(dw('SMP-CS').title === 'COVER SHEET' && dw('SMP-600').title === 'CURTAIN WALL SECTION DETAILS @ METAL PANEL', 'a number with no digit (SMP-CS) and the second sheet read right');
  }
  ok(!Object.values(DB.boards.ac3.drawings).some(d => /OWNER|ATLANTIC CHESTNUT AFFORDABLE|ABOVE FINISH|TITLE BLOCK|REVISION|SIMILAR/.test(d.title)), 'no title-block or abbreviation text leaked into titles');
  if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, 'drawings.json'), JSON.stringify(Object.values(DB.boards.ac3.drawings).map(d => [d.no, d.title, d.scale]), null, 1));

  // Hand AC3-103 to the drafter.
  await p1.selectOption(`select[data-dst="${D1}"]`, 'revise');
  ok(await until(() => DB.boards.ac3.drawings[D1].status === 'revise'), 'status changed inline');

  // 2. Lead adds a review comment with a pasted screenshot.
  await p1.click('#tabs button[data-tab=review]');
  await p1.click('#addIssue');
  await p1.selectOption('#ifDwg', D1);
  await p1.fill('#ifWhere', 'Typ. Perimeter Section @ West Sunshade');
  await p1.fill('#ifText', 'Write T.O.HSS instead of TOB; 6\'-5" is to the top HSS tube, not the C beam.');
  await p1.fill('#ifOrig', 'tob 대신에 t.o.hss 로 적어주세요');
  await p1.fill('#ifRev', LEAD);
  await p1.fill('#ifOwner', DRAFTER);
  await p1.evaluate(async () => {
    const c = document.createElement('canvas'); c.width = 400; c.height = 300;
    const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 400, 300); g.strokeStyle = '#f0f'; g.lineWidth = 6; g.strokeRect(50, 50, 200, 120);
    const blob = await new Promise(r => c.toBlob(r, 'image/png'));
    const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
    document.querySelector('#modalBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
  });
  await p1.waitForSelector('#ifPics img');
  await p1.click('#ifGo');
  await p1.waitForSelector('.card');
  await until(() => Object.keys(DB.boards.ac3.issues).length === 1);
  const iss = Object.entries(DB.boards.ac3.issues || {});
  ok(iss.length === 1 && iss[0][1].n === 1 && iss[0][1].status === 'open' && iss[0][1].dwg === D1, 'comment #1 saved on ' + D1 + ', open');
  ok(Object.keys(iss[0][1].imgs || {}).length === 1 && Object.keys(DB.images.ac3).length === 1, 'screenshot saved under /images, linked from the comment');
  await p1.waitForFunction(() => { const i = document.querySelector('.card img[data-img]'); return i && i.src.startsWith('data:image/jpeg'); });
  ok(true, 'screenshot thumbnail shows');

  // 3. Drafter: sees it in "Mine", marks it fixed in rev 3.
  console.log('drafter');
  const c2 = await ctx(); const p2 = await c2.newPage(); watch(p2);
  await signIn(p2, DRAFTER);
  await p2.waitForSelector('.card');
  await p2.click('.tile[data-mine]');
  ok(await p2.$$eval('.card', e => e.length) === 1, 'drafter: the comment is in My to-do');
  await p2.click('.card [data-act=fix]');
  await p2.fill('#fxRev', '3');
  await p2.fill('#fxNote', 'Changed on West, South and East');
  await p2.click('#fxGo');
  await p2.waitForFunction(() => !document.querySelector('.card'));   // left the drafter's to-do
  await until(() => Object.values(DB.boards.ac3.issues)[0].status === 'fixed');
  const i1 = Object.values(DB.boards.ac3.issues)[0];
  if (i1.status !== 'fixed' || i1.fixedRev !== '3') console.log('    issue now:', JSON.stringify(Object.assign({}, i1, { thread: undefined })), 'denied', denied, errors, await p2.textContent('#toast'));
  ok(i1.status === 'fixed' && i1.fixedBy === DRAFTER && i1.fixedRev === '3', 'first close: fixed by the drafter in rev 3');
  ok(Object.keys(i1.thread || {}).length === 1, 'the fix note is in the thread');
  await p2.click('.tile[data-mine]');
  await p2.waitForSelector('.card .pill.i-fixed');
  ok(!(await p2.$('.card [data-act=fix]')), 'no second "mark fixed"');

  // 4. Lead: it is now in the lead's to-do; closes it. (The stub SDK only pushes
  //    changes to the page that wrote them, so poke the lead's page.)
  await p1.evaluate(() => window.__fbRefresh && window.__fbRefresh());
  await p1.waitForSelector('.card .pill.i-fixed');
  await p1.click('.tile[data-mine]');
  ok(await p1.$$eval('.card', e => e.length) === 1, 'lead: the fixed comment is in My to-do (to check)');
  await p1.click('.card [data-act=close]');
  await p1.waitForFunction(() => !document.querySelector('.card'));   // Not closed filter hides it
  ok(await until(() => Object.values(DB.boards.ac3.issues)[0].status === 'closed'), 'second close: checked by the lead');
  await p1.click('.chip[data-mine]');   // Mine off (it applies on both tabs)
  await p1.click('#tabs button[data-tab=drawings]');
  await p1.click(`tr.row[data-dwg="${D1}"] td.no`);
  await p1.waitForSelector('#modalBox h2');
  ok(/Rev 3[\s\S]*#1/.test(await p1.textContent('#modalBox')), 'drawing view lists #1 under "what changed in rev 3"');
  await p1.keyboard.press('Escape');

  // 4b. Lead: paste a Discord conversation; Claude (stubbed) splits it.
  console.log('claude');
  await p1.click('.chip[data-mine]');   // Mine off
  await p1.click('#tabs button[data-tab=review]');
  await p1.click('#splitBtn');
  await p1.fill('#spTx', 'SPARK: tob 대신에 t.o.hss 로 적어주세요\nAF_Henry: 네, 이거는 고쳤습니다.\nAF_Henry: South & East도 동일하게 하겠습니다.');
  for (const color of ['#f0f', '#0ff']) {
    await p1.evaluate(async color => {
      const c = document.createElement('canvas'); c.width = 300; c.height = 200;
      const g = c.getContext('2d'); g.fillStyle = '#000'; g.fillRect(0, 0, 300, 200); g.strokeStyle = color; g.lineWidth = 5; g.strokeRect(40, 40, 120, 80);
      const blob = await new Promise(r => c.toBlob(r, 'image/png'));
      const dt = new DataTransfer(); dt.items.add(new File([blob], 'shot.png', { type: 'image/png' }));
      document.querySelector('#modalBox').dispatchEvent(new ClipboardEvent('paste', { clipboardData: dt, bubbles: true }));
    }, color);
  }
  await p1.waitForFunction(() => document.querySelectorAll('#spPics img').length === 2);
  await p1.click('#spGo');
  await p1.waitForSelector('[data-pi="2"]');
  const call1 = apiCalls[apiCalls.length - 1];
  ok(call1.mode === 'split' && call1.board === 'ac3' && call1.images.length === 2 && call1.context.drawings.length === NDWG, 'split: page sends text, 2 screenshots and the drawing list');
  ok(await p1.$eval('[data-pi="2"] .spDwg', e => e.value) === '', 'a drawing number Claude made up is not kept');
  ok(await p1.$eval('[data-pi="0"] .spSt', e => e.value) === 'fixed' && await p1.$eval('[data-pi="2"] .spSt', e => e.value) === 'ask', 'already-fixed → "fixed · to check", unclear → "ask reviewer"');
  await p1.click('#spAdd');
  await p1.waitForFunction(() => document.querySelector('#modal').hidden);
  await until(() => Object.keys(DB.boards.ac3.issues).length === 4);
  const byN = n => Object.values(DB.boards.ac3.issues).find(v => v.n === n) || {};
  ok(byN(2).status === 'fixed' && byN(2).fixedBy === DRAFTER && byN(3).status === 'open' && byN(4).status === 'ask', 'three comments added as #2 fixed, #3 to fix, #4 ask reviewer');
  ok(Object.keys(byN(2).imgs || {}).length === 1 && Object.keys(byN(4).imgs || {}).length === 1 && !byN(3).imgs && Object.keys(DB.images.ac3).length === 3, 'each comment got its own screenshot; each screenshot saved once');
  ok(byN(2).orig && /top HSS tube/.test(byN(2).orig), 'the reviewer\'s own words are kept');

  // 4c. Ask Claude; the proposed change needs a press.
  await p1.fill('#askQ', 'what is left on ' + D1 + '?');
  await p1.click('#askForm button[type=submit]');
  await p1.waitForSelector('[data-doact="0"]');
  ok(/still to fix/.test(await p1.textContent('#askOut')), 'ask: the answer shows');
  ok(byN(3).status === 'open', 'nothing changed before the press');
  await p1.click('[data-doact="0"]');
  ok(await until(() => byN(3).status === 'fixed' && byN(3).fixedRev === '3' && byN(3).fixedBy === LEAD), 'after the press: #3 fixed in rev 3, signed by the person who pressed');

  if (process.env.SHOTS) {   // pictures for a person to look at, not assertions
    await p1.click('#tabs button[data-tab=review]');
    await p1.click('.chip[data-if=all]');
    await p1.screenshot({ path: path.join(process.env.SHOTS, 'review.png') });
    await p1.click('#addIssue');
    await p1.screenshot({ path: path.join(process.env.SHOTS, 'add.png') });
    await p1.keyboard.press('Escape');
    await p1.click('#tabs button[data-tab=drawings]');
    await p1.screenshot({ path: path.join(process.env.SHOTS, 'drawings.png') });
    await p1.setViewportSize({ width: 390, height: 800 });
    await p1.click('#tabs button[data-tab=review]');
    await p1.screenshot({ path: path.join(process.env.SHOTS, 'phone.png') });
    await p1.setViewportSize({ width: 1200, height: 900 });
  }

  // 4c2. Pull from Discord (stubbed): the comment arrives with its screenshot; the board remembers where it stopped.
  await p1.click('#splitBtn');
  await p1.click('#spPull');
  await p1.waitForSelector('[data-pi="0"]');
  ok(/이렇게 바꿔주세요/.test(await p1.$eval('#spTx', e => e.value)), 'pull: what was read from Discord is shown');
  const nBefore = Object.keys(DB.boards.ac3.issues).length;
  await p1.click('#spAdd');
  await p1.waitForFunction(() => document.querySelector('#modal').hidden);
  ok(await until(() => DB.boardInfo.ac3.discordLast === '2001' && Object.keys(DB.boards.ac3.issues).length === nBefore + 1), 'pull: comment added and the last message id saved on the board');
  const pulledIssue = Object.values(DB.boards.ac3.issues).find(v => /W8X20 beam line/.test(v.text) && v.source === 'discord') || {};
  ok(Object.keys(pulledIssue.imgs || {}).length === 1, 'pull: the Discord screenshot is kept with the comment');
  await p1.click('#splitBtn');
  await p1.click('#spPull');
  await p1.waitForSelector('[data-pi="0"]');
  ok(apiCalls[apiCalls.length - 1].after === '2001', 'pull again: starts after the last pulled message');
  await p1.keyboard.press('Escape');
  // the earlier comments are untouched by the pull; drop the extra one from the count used below
  const extra = Object.keys(DB.boards.ac3.issues).length - 4;

  await p1.click('#helpBtn');
  ok(/closes <b>twice<\/b>|closes twice/i.test(await p1.innerHTML('#modalBox')), 'help window explains the two closes');
  await p1.keyboard.press('Escape');

  // 4d. The desktop helper's old address (?mini=1) now opens the chat (assistant.e2e.mjs tests the chat).
  console.log('helper address');
  const c6 = await ctx(); const p6 = await c6.newPage(); watch(p6);
  await p6.goto(BASE + '?mini=1');
  await p6.waitForURL(/\/assistant\/$/);
  ok(true, '/design/?mini=1 → /assistant/');
  await p1.click('#addIssue');
  await p1.selectOption('#ifDwg', D2);
  await p1.fill('#ifText', 'Add the W8X20 beam line to the 3/4" dimension');
  await p1.fill('#ifOwner', DRAFTER);
  await p1.click('#ifGo');
  ok(await until(() => Object.keys(DB.boards.ac3.issues).length === 5 + extra), 'another comment added from the board page');

  // A second project's board, and AC3's PM on the AC3 board only (Leo 10-20).
  DB.boardInfo.hillview = { name: 'Hillview', _by: LEAD, _ts: 1 };
  DB.members = { ac3: { [key(PM)]: 'editor' } };

  // 5. A boss: every board, read only.
  console.log('boss');
  const c3 = await ctx(); const p3 = await c3.newPage(); watch(p3);
  await signIn(p3, BOSS, BASE + '#b=ac3');
  await p3.waitForSelector('.tile');
  ok(await p3.isVisible('text=view only'), 'boss: view only');
  ok(await p3.$$eval('#boardPick option', o => o.map(x => x.value).sort().join()) === 'ac3,hillview', 'boss: sees every board, cannot make one');
  ok(!(await p3.$('#addIssue')), 'boss: no "+ Add comment"');
  await p3.click('.chip[data-if=all]');
  ok(await p3.$$eval('.card', e => e.length) === 6 && !(await p3.$('.card [data-act]')), 'boss sees all 6 comments, no buttons');
  ok(!(await p3.$('#askForm')) && !(await p3.$('#splitBtn')), 'boss: no Claude buttons (editors only)');
  await p3.click('#tabs button[data-tab=drawings]');
  ok(!(await p3.$('#importPdf')) && !!(await p3.$('#checkDxf')), 'boss: no import, but 🔍 Check DXF is there for everyone');
  await p3.click('#checkDxf');
  await p3.waitForSelector('#rvDrop');
  await p3.setInputFiles('#rvFiles', { name: 'notes.txt', mimeType: 'text/plain', buffer: Buffer.from('x') });
  ok(/not DXF/.test(await p3.textContent('#rvStatus')), 'a file that is not DXF: says how to save one');
  await p3.setInputFiles('#rvFiles', { name: 'AC3-202.dxf', mimeType: 'application/dxf', buffer: Buffer.from('0\nEOF\n') });
  ok(await p3.waitForSelector('#rvOut:not([hidden])', { timeout: 15000 }).then(() => true, () => false), 'the check runs in the page and shows its report');
  const rv = await p3.textContent('#rvOut');
  ok(/AC3-202 {2}\(AC3-202\.dxf\)/.test(rv) && /review\.py loaded/.test(rv), 'the worker got the file and design/review.py');
  ok(await p3.$eval('#rvOut', el => [...el.querySelectorAll('span')].some(s => /✗/.test(s.textContent) && s.style.color) && !!el.querySelector('b')), 'mistakes in red, the sheet name bold');
  ok(await p3.isVisible('#rvDl'), 'review.txt can be downloaded');
  await p3.click('#modalBox [data-x]');

  // 5b. AC3's PM: edits the AC3 board, does not see Hillview.
  console.log('PM');
  const c7 = await ctx(); const p7 = await c7.newPage(); watch(p7);
  await signIn(p7, PM, BASE + '#b=hillview');
  await p7.waitForSelector('.tile');
  ok(await p7.$$eval('#boardPick option', o => o.map(x => x.value).join()) === 'ac3', 'PM: only the AC3 board in the list (no Hillview, no "+ New board")');
  ok(/No access to the Hillview board/.test(await p7.textContent('#toast')), 'PM: a link to another board says no access');
  ok(await p7.isVisible('#who >> text=editor'), 'PM: editor of AC3');
  await p7.click('#addIssue');
  await p7.selectOption('#ifDwg', D2);
  await p7.fill('#ifText', 'PM: GC asks for the canopy drain location');
  await p7.click('#ifGo');
  ok(await until(() => Object.values(DB.boards.ac3.issues).some(i => i._by === PM)), 'PM adds a comment to AC3 (the rules let a board editor write)');

  // 6. Other staff and a tracker foreman: no board at all.
  console.log('staff / foreman');
  const c8 = await ctx(); const p8 = await c8.newPage(); watch(p8);
  await signIn(p8, STAFF, BASE + '#b=ac3');
  await p8.waitForSelector('text=No project board is open');
  ok(!(await p8.$('.tile')) && await p8.isHidden('#boardPick'), 'staff on no list: no board, no list of boards to pick');
  const c4 = await ctx(); const p4 = await c4.newPage(); watch(p4);
  await signIn(p4, FOREMAN);
  await p4.waitForSelector('text=No project board is open');
  ok(true, 'foreman: no board');

  // 7. A database that is not the design database: stop.
  console.log('wrong database');
  const saved = DB; DB = { meta: { project: 'ac3' }, allowlist: { [key(LEAD)]: true } };
  const c5 = await ctx(); const p5 = await c5.newPage(); watch(p5);
  await signIn(p5, LEAD);
  await p5.waitForSelector('text=Wrong database');
  ok(true, 'a database that says "ac3" stops the page');
  DB = saved;

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
  ok(denied === 0, `no write was refused by the rules during normal use (${denied})`);
} catch (e) {
  fail++; console.log('  FAIL ' + (e.stack || e.message));
} finally {
  await browser.close(); server.close();
}
console.log(`design e2e: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
