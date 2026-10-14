#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   The Design Board page (/design/) in a real browser against an in-memory
   design database whose every read and write is checked with the real
   platform/design-database.rules.json (targaryen) through the stub SDK in
   e2e/fake-firebase.js.

     node platform/tests/design.e2e.mjs          (needs: playwright, targaryen, pdfjs-dist)

   Walks the AC3 pilot: create the board, import "AC3 drawing list.pdf",
   add a review comment with a pasted screenshot, the drafter marks it fixed,
   the reviewer closes it; staff see it read-only; a tracker foreman gets nothing.
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

const PW = 'pw-1';
const LEAD = 'spark@advfacade.com', DRAFTER = 'henry.kim@advfacade.com', STAFF = 'pm@advfacade.com', FOREMAN = 'joe.foreman@gmail.com';
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
const mkUser = (email, verified = true) => { users[email] = { uid: 'u_' + email.replace(/\W/g, '_'), email, emailVerified: verified, password: PW }; };
let DB = {};
let denied = 0;
const fbLog = [];
function handle(op, a) {
  const now = Date.now();
  fbLog.push(op + ' ' + (a.op || '') + ' ' + (a.path || a.email || ''));
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
  await c.route(/\/api\/design$/, async r => {
    const b = JSON.parse(r.request().postData() || '{}');
    apiCalls.push(b);
    if (!b.token) return r.fulfill({ status: 403, contentType: 'application/json', body: '{"error":"no token"}' });
    const body = b.mode === 'split'
      ? { comments: [
          { images: [0], dwg: 'AC3-103', where: 'East Glass Canopy', text: 'Write T.O.HSS for the 6\'-5" dimension', orig: '6\'5"는 저 C beam이 아니고 top HSS tube에요', reviewer: 'SPARK', owner: DRAFTER, already_fixed: true },
          { images: [], dwg: 'AC3-103', where: 'South & East', text: 'Same T.O.HSS change on South and East', orig: 'South & East도 동일하게 하겠습니다.', reviewer: 'SPARK', owner: DRAFTER },
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
mkUser(LEAD); mkUser(DRAFTER); mkUser(STAFF); mkUser(FOREMAN);
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
  await p1.setInputFiles('#ipFile', path.join(ROOT, 'AC3 drawing list.pdf'));
  await p1.waitForSelector('#ipGo:not([disabled])', { timeout: 20000 });
  const found = await p1.$$eval('input[data-ri]', els => els.length);
  ok(found === 78, `drawing list PDF: ${found} drawings found (78 on the two sheets)`);
  await p1.click('#ipGo');
  await p1.waitForFunction(() => document.querySelectorAll('tr.row').length === 78);
  await until(() => Object.keys(DB.boards.ac3.drawings).length === 78);
  const d100 = DB.boards.ac3.drawings['AC3-100'] || {};
  ok(/^MAISONETTE ENTRY ELEVATION & PLAN \(W11, W12, W12A\)$/.test(d100.title || ''), 'AC3-100 title read right: ' + d100.title);
  ok(d100.scale === '1-1/2"=1\'-0"', 'AC3-100 scale read right: ' + d100.scale);
  const d010 = DB.boards.ac3.drawings['AC3-010'] || {};
  ok(d010.title === 'KEY PLAN @ 1ST FLOOR' && d010.scale === '3/32"=1\'-0"', 'AC3-010 read right: ' + d010.title + ' / ' + d010.scale);
  ok(!Object.values(DB.boards.ac3.drawings).some(d => /OWNER|ATLANTIC CHESTNUT AFFORDABLE|ABOVE FINISH/.test(d.title)), 'no title-block or abbreviation text leaked into titles');
  if (process.env.SHOTS) fs.writeFileSync(path.join(process.env.SHOTS, 'drawings.json'), JSON.stringify(Object.values(DB.boards.ac3.drawings).map(d => [d.no, d.title, d.scale]), null, 1));

  // Hand AC3-103 to the drafter.
  await p1.selectOption('select[data-dst="AC3-103"]', 'revise');
  ok(await until(() => DB.boards.ac3.drawings['AC3-103'].status === 'revise'), 'status changed inline');

  // 2. Lead adds a review comment with a pasted screenshot.
  await p1.click('#tabs button[data-tab=review]');
  await p1.click('#addIssue');
  await p1.selectOption('#ifDwg', 'AC3-103');
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
  ok(iss.length === 1 && iss[0][1].n === 1 && iss[0][1].status === 'open' && iss[0][1].dwg === 'AC3-103', 'comment #1 saved on AC3-103, open');
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
  await p1.click('tr.row[data-dwg="AC3-103"] td.no');
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
  ok(call1.mode === 'split' && call1.board === 'ac3' && call1.images.length === 2 && call1.context.drawings.length === 78, 'split: page sends text, 2 screenshots and the drawing list');
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
  await p1.fill('#askQ', 'what is left on AC3-103?');
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

  // 4d. The desktop helper's compact view (?mini=1): badge and notices.
  console.log('helper view');
  const c6 = await ctx(); const p6 = await c6.newPage(); watch(p6);
  await p6.addInitScript(() => { window.afHelper = { setBadge: n => { window.__badge = n; }, notify: (t, b) => { (window.__notes = window.__notes || []).push(t + ' | ' + b); } }; });
  await signIn(p6, DRAFTER, BASE + '?mini=1');
  await p6.waitForSelector('#tabs button[data-tab=links]');
  ok(await p6.evaluate(() => document.body.classList.contains('mini')) && !(await p6.$('.tiles')), 'mini view: compact, no tiles');
  ok(await p6.$eval('.chip[data-mine]', e => e.classList.contains('on')), 'mini view opens on "Mine"');
  await p6.waitForFunction(() => window.__badge !== undefined);
  const before = await p6.evaluate(() => window.__badge);
  await p1.click('#addIssue');
  await p1.selectOption('#ifDwg', 'AC3-500');
  await p1.fill('#ifText', 'Add the W8X20 beam line to the 3/4" dimension');
  await p1.fill('#ifOwner', DRAFTER);
  await p1.click('#ifGo');
  await until(() => Object.keys(DB.boards.ac3.issues).length === 5);
  await p6.evaluate(() => window.__fbRefresh && window.__fbRefresh());
  await p6.waitForFunction(b => window.__badge === b + 1, before);
  ok(true, `badge went ${before} → ${before + 1} when a comment for the drafter arrived`);
  ok(/New for you: #5 \| AC3-500 Add the W8X20/.test((await p6.evaluate(() => window.__notes || [])).join('\n')), 'a Windows notice was asked for: "New for you: #5"');
  ok((await p6.evaluate(() => window.__notes.length)) === 1, 'no notices for what was already there');
  await p6.click('#tabs button[data-tab=links]');
  ok(await p6.$$eval('.links a', a => a.length) === 5, 'links tab lists the hub pages');
  if (process.env.SHOTS) { await p6.setViewportSize({ width: 430, height: 680 }); await p6.click('#tabs button[data-tab=review]'); await p6.screenshot({ path: path.join(process.env.SHOTS, 'mini.png') }); }

  // 5. Staff: read only.
  console.log('staff');
  const c3 = await ctx(); const p3 = await c3.newPage(); watch(p3);
  await signIn(p3, STAFF);
  await p3.waitForSelector('.tile');
  ok(await p3.isVisible('text=view only'), 'staff: view only');
  ok(!(await p3.$('#addIssue')), 'staff: no "+ Add comment"');
  await p3.click('.chip[data-if=all]');
  ok(await p3.$$eval('.card', e => e.length) === 5 && !(await p3.$('.card [data-act]')), 'staff sees all 5 comments, no buttons');
  ok(!(await p3.$('#askForm')) && !(await p3.$('#splitBtn')), 'staff: no Claude buttons (editors only)');

  // 6. A tracker foreman: nothing.
  console.log('foreman');
  const c4 = await ctx(); const p4 = await c4.newPage(); watch(p4);
  await signIn(p4, FOREMAN);
  await p4.waitForSelector('text=No access yet');
  ok(true, 'foreman: "No access yet"');

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
