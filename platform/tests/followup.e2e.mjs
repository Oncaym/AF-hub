#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   📬 Follow-up (/followup/) in a real browser: hub database in memory, checked
   with the real /firebase-database-rules.json (targaryen) through
   e2e/fake-firebase.js; Microsoft sign-in (MSAL) and Microsoft Graph stubbed.

     node platform/tests/followup.e2e.mjs      (needs: playwright, targaryen)
     SHOTS=<dir> also saves screenshots.

   Leo signs in to the hub, saves the Microsoft app id, signs in to Outlook,
   sees per project who he's waiting on; marks one done (and undoes it),
   snoozes one, sorts an unsorted one, nudges, adds a to-do, changes the
   nudge days. Another staff member sees none of it.
   ───────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const RULES = JSON.parse(fs.readFileSync(path.join(ROOT, 'firebase-database-rules.json'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const HUB_CFG = fs.readFileSync(path.join(ROOT, 'af-hub-config.js'), 'utf8');
const URL_DB = /databaseURL:\s*"([^"]+)"/.exec(HUB_CFG)[1];
const targaryen = require('targaryen');
const { chromium } = require('playwright');
const PW = 'pw-1';
const LEO = 'leosun@advfacade.com', STAFF = 'cdu@advfacade.com';
const CID = '0a1b2c3d-1111-2222-3333-444455556666', TID = 'aaaabbbb-1111-2222-3333-444455556666';

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
  const value = a.value;
  const allowed = (a.op === 'update' ? db.update(a.path, value) : db.write(a.path, value)).allowed;
  if (!allowed) { denied++; return { allowed }; }
  if (a.op === 'update') for (const k of Object.keys(value)) dset(DB, a.path + '/' + k, value[k]);
  else DB = dset(DB, a.path, value);
  prune(DB);
  return { allowed };
}
const leoUid = () => users[LEO].uid;
const mine = () => (DB.followup && DB.followup[leoUid()]) || {};

// ─────────────────────────────────────────────── the mailbox (Graph) ──
const D = 864e5, NOW = Date.now();
const ago = (d, h = 10) => { const t = new Date(NOW - d * D); t.setHours(h, 0, 0, 0); return t.toISOString(); };
const P = (address, name) => ({ emailAddress: { address, name: name || address } });
const ME = P(LEO, 'Leo Sun');
let mid = 0;
const M = (conv, d, from, to, subject, extra) => Object.assign({
  id: 'm' + (++mid), conversationId: conv, subject, from, toRecipients: to, ccRecipients: [], receivedDateTime: ago(d, 9 + (mid % 7)), sentDateTime: ago(d, 9 + (mid % 7)),
  parentFolderId: from === ME ? 'S' : 'I', isDraft: false, isRead: true, flag: { flagStatus: 'notFlagged' },
  webLink: 'https://outlook.office365.com/owa/?ItemID=m' + mid, bodyPreview: '', inferenceClassification: 'focused',
}, extra);
const PK = P('peter.kim@broadwaybldr.com', 'Peter Kim'), JL = P('jlee@fortenyc.com', 'Jenny Lee'), CH = P('chul@advfacade.com', 'Chul Park'),
  RM = P('rmartinez@prometheanbuilders.com', 'Rosa Martinez'), BV = P('sales@bergerbldg.com', 'Berger Sales'), DW = P('dwong@monadnockny.com', 'David Wong'), AR = P('arch@studio-k.com', 'Studio K');
const FOLDERS = [
  ['I', 'Inbox', 'R'], ['S', 'Sent Items', 'R'], ['DR', 'Drafts', 'R'], ['DEL', 'Deleted Items', 'R'], ['RSS', 'RSS Feeds', 'R'], ['A', 'Archive', 'R'],
  ['CP2', 'CP2', 'R'], ['CP2_A', '01_Action Required', 'CP2'], ['CP2_W', '02_Awaiting Reply', 'CP2'], ['CP2_X', '04_Archive/Projects', 'CP2'],
  ['AC3', 'AC3', 'R'], ['AC3_X', 'Archived', 'AC3'], ['AC3_W', 'Awaiting Reply', 'AC3'], ['AC3_R', 'Reference', 'AC3'],
  ['LEX', '355 Lex', 'R'], ['LEX_X', 'Archived', 'LEX'], ['FH', 'Forest Hill', 'R'], ['FH_X', 'Archived', 'FH'],
  ['JEAN', 'JEAN', 'R'], ['JEAN_P', 'P.O.', 'JEAN'], ['PKG', 'ADA Package#7', 'R'], ['PKG_X', 'Archived', 'PKG'],
].map(([id, displayName, parentFolderId]) => ({ id, displayName, parentFolderId, childFolderCount: 0 }));
FOLDERS.forEach(f => { f.childFolderCount = FOLDERS.filter(x => x.parentFolderId === f.id).length; });
const WKMAP = { msgfolderroot: 'R', inbox: 'I', sentitems: 'S', drafts: 'DR', deleteditems: 'DEL', archive: 'A' };
const MAIL = [
  M('lintel', 9, ME, [PK], 'CP2 lintel enclosure — 4th round comments', { bodyPreview: 'Peter, attached are our responses to round 4. Please confirm we can release for fabrication.' }),
  M('cp2sov', 6, ME, [CH], 'Cooper Park 2 — SOV revision for October billing', { bodyPreview: 'Chul, please review the revised SOV before I send it to Broadway.' }),
  M('cp2mock', 1, PK, [ME], 'RE: CP2 mockup schedule', { bodyPreview: 'Leo, can your crew be on site Thursday for the mockup?', isRead: false, parentFolderId: 'CP2' }),
  M('ac3calc', 8, ME, [DW, CH], 'AC3 storefront calcs — resubmittal', { bodyPreview: 'David, attached is the revised storefront calc package for review.' }),
  M('ac3rfi', 0, ME, [DW], 'AC3 RFI 27 — sill flashing at grid C', { bodyPreview: 'David, please see RFI 27 attached.' }),
  M('fhbaba', 5, ME, [BV], 'Forest Hill gutter — BABA certification letter', { bodyPreview: 'Hi, we need a BABA compliance letter for the copper gutter on this project.' }),
  M('fhbaba', 5, BV, [ME], 'Automatic reply: Forest Hill gutter — BABA certification letter', { bodyPreview: 'I am out of the office until Monday.' }),
  M('fhsize', 3, JL, [ME], 'Forest Hill — 5" or 6" gutter?', { bodyPreview: 'Leo, the spec says 5" but your quote shows 6". Which one are we submitting?' }),
  M('lexhw', 8, ME, [RM], '355 Lex — shower door hardware finish', { bodyPreview: 'Rosa, attached are the finish samples. Let me know which one the owner picked.' }),
  M('lexthx', 2, RM, [ME], '355 Lex — L14 punch list', { bodyPreview: 'Leo, punch list attached.', parentFolderId: 'LEX' }),
  M('lexthx', 2, ME, [RM], 'RE: 355 Lex — L14 punch list', { bodyPreview: 'Thanks! Leo Sun | Advanced Facade' }),
  M('mockup', 7, ME, [AR], 'Mockup panel color — samples sent', { bodyPreview: 'Samples went out by courier today.' }),
  M('pkg7', 12, ME, [P('owner@nycsca.org', 'SCA Project Officer')], 'Package #7 closeout — O&M manuals', { bodyPreview: 'Attached are the O&M manuals for review.' }),
  M('igu', 6, ME, [P('estimator@glassco.com', 'Glass Co Estimating')], 'Quote for spare IGUs', { bodyPreview: 'Please quote 6 spare IGUs per the attached list.' }),
  M('news', 1, P('news@aamanet.org', 'AAMA'), [ME], 'AAMA weekly', { inferenceClassification: 'other' }),
  M('proc', 0, P('no-reply@procore.com', 'Procore'), [ME], 'Daily log submitted'),
];
const FLAGGED = [M('flagold', 40, JL, [ME], 'Forest Hill — warranty form to sign', { flag: { flagStatus: 'flagged' }, parentFolderId: 'FH' })];
const SAMPLES = [
  ...[1, 2, 3].map(i => M('old' + i, 60 + i, PK, [ME], 'older', { parentFolderId: 'CP2' })),
  ...[1, 2].map(i => M('olda' + i, 60 + i, AR, [ME], 'older', { parentFolderId: 'AC3' })),
];
let graphCalls = [], graphNonGet = 0;
function graph(route) {
  const req = route.request();
  if (req.method() !== 'GET') graphNonGet++;
  const u = decodeURIComponent(req.url().replace('https://graph.microsoft.com/v1.0', ''));
  graphCalls.push(u);
  const j = (b, s = 200) => route.fulfill({ status: s, contentType: 'application/json', body: JSON.stringify(b) });
  if (req.headers().authorization !== 'Bearer tok-1') return j({ error: { code: 'InvalidAuthenticationToken', message: 'no' } }, 401);
  if (u.startsWith('/me?')) return j({ mail: LEO, userPrincipalName: LEO, displayName: 'Leo Sun' });
  if (u.startsWith('/me/mailFolders?')) return j({ value: FOLDERS.filter(f => f.parentFolderId === 'R') });
  let m;
  if ((m = /^\/me\/mailFolders\/([^/?]+)\/childFolders/.exec(u))) return j({ value: FOLDERS.filter(f => f.parentFolderId === m[1]) });
  if ((m = /^\/me\/mailFolders\/(\w+)\?\$select=id$/.exec(u))) return WKMAP[m[1]] ? j({ id: WKMAP[m[1]] }) : j({ error: { code: 'ErrorFolderNotFound' } }, 404);
  if (u.startsWith('/me/messages?$filter=receivedDateTime')) return j({ value: MAIL.slice().reverse() });
  if (u.startsWith("/me/messages?$filter=flag/flagStatus eq 'flagged'")) return j({ value: FLAGGED });
  if ((m = /^\/me\/mailFolders\/([^/?]+)\/messages/.exec(u))) return j({ value: SAMPLES.filter(x => x.parentFolderId === m[1]) });
  return j({ error: { code: 'BadRequest', message: u } }, 400);
}

// MSAL stand-in: loginRedirect "goes to Microsoft" and comes back with #code=…
const FAKE_MSAL = `window.msal = (function () {
  const ACC = { username: ${JSON.stringify(LEO)}, homeAccountId: 'h1' };
  class InteractionRequiredAuthError extends Error {}
  class PublicClientApplication {
    constructor(cfg) { this.cfg = cfg; window.__msalCfg = cfg; }
    async initialize() {}
    async handleRedirectPromise() {
      if (/code=fake/.test(location.hash)) { history.replaceState(null, '', location.pathname); localStorage.setItem('fakemsal', '1'); return { account: ACC }; }
      return null;
    }
    getActiveAccount() { return localStorage.getItem('fakemsal') ? ACC : null; }
    getAllAccounts() { return localStorage.getItem('fakemsal') ? [ACC] : []; }
    setActiveAccount() {}
    async loginRedirect(req) { localStorage.setItem('fakemsal_req', JSON.stringify(req)); history.replaceState(null, '', this.cfg.auth.redirectUri + '#code=fake'); location.reload(); }
    async acquireTokenSilent(req) { return { accessToken: 'tok-1' }; }
    async acquireTokenRedirect() {}
    async logoutRedirect() { localStorage.removeItem('fakemsal'); location.reload(); }
  }
  return { PublicClientApplication, InteractionRequiredAuthError };
})();`;

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
const BASE = `http://127.0.0.1:${server.address().port}/followup/`;

const browser = await chromium.launch(process.env.PW_EXEC ? { executablePath: process.env.PW_EXEC } : {});
const FAKE = fs.readFileSync(path.join(here, 'e2e', 'fake-firebase.js'), 'utf8');
const errors = [], outside = [];
async function open(email, viewport) {
  const c = await browser.newContext({ viewport: viewport || { width: 1200, height: 1000 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await c.exposeFunction('__fb', (op, args) => handle(op, args));
  await c.addInitScript(() => { window.__opened = []; window.open = (u) => { window.__opened.push(u); return null; }; });
  await c.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript', body: /firebase-app-compat\.js$/.test(r.request().url()) ? FAKE : '' }));
  await c.route(/\/followup\/msal-browser-4\.30\.0\.min\.js$/, r => r.fulfill({ contentType: 'text/javascript', body: FAKE_MSAL }));
  await c.route(/graph\.microsoft\.com/, graph);
  await c.route(u => !/^http:\/\/127\.0\.0\.1/.test(u.href) && !/gstatic\.com|graph\.microsoft\.com/.test(u.href), r => { outside.push(r.request().url()); r.abort(); });
  const page = await c.newPage();
  page.on('pageerror', e => errors.push(email + ': ' + e.message));
  page.on('crash', () => errors.push(email + ': page crashed'));
  if (process.env.DEBUG) page.on('console', m => console.log('    [console] ' + m.text()));
  await page.goto(BASE);
  await page.fill('#email', email); await page.fill('#pw', PW);
  await page.click('#go');
  return page;
}
async function until(fn, ms = 6000) {
  const t0 = Date.now();
  while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await new Promise(r => setTimeout(r, 50)); }
  return false;
}
const rowOf = (page, text) => page.locator('.fu-row', { hasText: text }).first();
const groupText = async (page, name) => page.locator('section.grp', { has: page.locator('h3', { hasText: name }) }).first().textContent();

[LEO, STAFF].forEach(mkUser);
DB = { admins: {} };

try {
  console.log('Follow-up — first time: the Microsoft app id');
  const leo = await open(LEO);
  await leo.waitForSelector('#setup:not([hidden])', { timeout: 15000 });
  ok(/\/followup\/$/.test(await leo.textContent('#redir')), 'setup shows the redirect URI to register (…/followup/)');
  await leo.fill('#cid', 'not-an-id'); await leo.click('#saveMs');
  ok(/looks like/.test(await leo.textContent('#setupErr')) && !mine().cfg, 'a wrong app id is caught before saving');
  await leo.fill('#cid', CID); await leo.fill('#tid', TID); await leo.click('#saveMs');
  ok(await until(() => mine().cfg && mine().cfg.ms && mine().cfg.ms.clientId === CID && mine().cfg.ms.tenant === TID), 'app id + tenant saved in my own list (/followup/<uid>/cfg/ms)');
  await leo.waitForSelector('#connect:not([hidden])');
  ok(await leo.evaluate(() => window.__msalCfg.auth.authority) === 'https://login.microsoftonline.com/' + TID, 'MSAL signs in against the company tenant');
  if (process.env.SHOTS) await leo.screenshot({ path: path.join(process.env.SHOTS, 'followup-connect.png') });

  console.log('Follow-up — sign in to Outlook');
  await leo.click('#msLogin');
  await leo.waitForSelector('.fu-row', { timeout: 15000 });
  const req = JSON.parse(await leo.evaluate(() => localStorage.getItem('fakemsal_req')));
  ok(req.scopes.join() === 'User.Read,Mail.Read' && req.loginHint === LEO, 'asks Microsoft only for Mail.Read + User.Read, with my email filled in');
  ok(graphNonGet === 0 && graphCalls.length > 10 && graphCalls.every(u => !/\/(send|move|copy|reply|replyAll|forward)\b/.test(u.split('?')[0])), 'only reads Graph (GET), never sends / moves / deletes');
  ok(!outside.length, 'no other website contacted: ' + outside.join(' '));
  const groups = await leo.locator('section.grp h3').allTextContents();
  ok(groups.some(t => /^CP2/.test(t)) && groups.some(t => /^AC3/.test(t)) && groups.some(t => /^Forest Hill/.test(t)) && groups.some(t => /^355 Lex/.test(t)), 'grouped by project folder: CP2, AC3, Forest Hill, 355 Lex', );
  ok(/Not sorted/.test(groups[groups.length - 1]), '"Not sorted" last');
  const cp2 = await groupText(leo, 'CP2');
  ok(/lintel enclosure/.test(cp2) && /SOV revision/.test(cp2) && /mockup schedule/.test(cp2), 'CP2: waiting on Peter (lintel), on Chul (SOV), and Peter\'s question to answer');
  ok(await rowOf(leo, 'lintel enclosure').locator('.fu-badge.wait.red').count() === 1, 'lintel (9 days) is due a nudge — red');
  ok(/To Peter Kim/.test(await rowOf(leo, 'lintel enclosure').textContent()), 'shows who I\'m waiting on');
  ok(await rowOf(leo, 'mockup schedule').locator('.fu-badge.reply').count() === 1 && /unread/.test(await rowOf(leo, 'mockup schedule').textContent()), 'Peter\'s unread question → ↩ To reply');
  const fh = await groupText(leo, 'Forest Hill');
  ok(/BABA certification/.test(fh) && /5" or 6"/.test(fh) && /warranty form/.test(fh), 'Forest Hill: BABA letter (out-of-office is not an answer), Jenny\'s question, old flagged email');
  const lex = await groupText(leo, '355 Lex');
  ok(/hardware finish/.test(lex) && !/punch list/.test(lex), '355 Lex: waiting on Rosa; my "Thanks!" reply is not waiting');
  ok(!(await leo.textContent('#fuList')).match(/AAMA|Procore/), 'newsletters / no-reply mail left out');
  ok(/1 “thanks” replies left out/.test(await leo.textContent('#fuStatus')), 'status line says one "thanks" reply was left out');
  ok(await until(async () => /RFI 27/.test(await leo.textContent('#fuList')) === false), 'today\'s RFI 27 is folded under "sent recently — not due" in AC3');
  await leo.locator('section.grp', { has: leo.locator('h3', { hasText: 'AC3' }) }).locator('.fu-more').click();
  ok(/RFI 27/.test(await groupText(leo, 'AC3')), '…and opens when clicked');
  if (process.env.SHOTS) await leo.screenshot({ path: path.join(process.env.SHOTS, 'followup-desktop.png'), fullPage: true });

  console.log('Follow-up — done, undo, snooze, sort, nudge');
  await rowOf(leo, 'SOV revision').locator('[data-a=done]').click();
  ok(await until(() => Object.values(mine().marks || {}).some(m => m.s === 'done')), 'Done saved as a mark (no mail content stored)');
  ok(await until(async () => !/SOV revision/.test(await leo.textContent('#fuList'))), 'the row leaves the list');
  ok(/Done in the last 7 days 1/.test(await leo.textContent('#fuDone summary')), 'shows under "Done in the last 7 days"');
  const markJson = JSON.stringify(mine().marks);
  ok(!/SOV|Chul|chul/.test(markJson), 'the mark holds no subject or address: ' + markJson);
  await leo.click('#fuDone summary');
  await leo.locator('#fuDone [data-a=undo]').click();
  ok(await until(async () => /SOV revision/.test(await leo.textContent('#fuList'))), 'Undo brings it back');
  await rowOf(leo, 'Package #7 closeout').locator('select[data-a=snooze]').selectOption('mon');
  ok(await until(() => Object.values(mine().marks || {}).some(m => m.s === 'snooze' && /^\d{4}-\d\d-\d\d$/.test(m.until))), 'Snooze → next Monday saved');
  ok(await until(async () => !/Package #7 closeout/.test(await leo.textContent('#fuList'))), 'snoozed row hidden');
  ok(/Snoozed 1/.test(await leo.textContent('#fuSnoozed summary')), '"Snoozed 1" shown');
  ok(/Mockup panel color/.test(await groupText(leo, 'AC3')) && /guessed/.test(await rowOf(leo, 'Mockup panel color').textContent()), 'Studio K email (no keyword) → AC3, guessed from the people (Studio K is in AC3\'s folder)');
  ok(/Quote for spare IGUs/.test(await groupText(leo, 'Not sorted')), 'Glass Co quote: no folder, keyword or people → Not sorted');
  await rowOf(leo, 'Quote for spare IGUs').locator('select[data-a=proj]').selectOption('CP2');
  ok(await until(async () => /Quote for spare IGUs/.test(await groupText(leo, 'CP2'))), 'picked CP2 on the row → moves to CP2');
  ok(Object.values(mine().marks || {}).some(m => m.p === 'CP2' && !m.s), 'the pick is saved (project only)');
  await rowOf(leo, 'lintel enclosure').locator('[data-a=nudge]').click();
  ok(await until(async () => /Reminder copied/.test(await leo.textContent('#fuToast'))), 'Nudge: "Reminder copied" toast');
  ok((await leo.evaluate(() => navigator.clipboard.readText())).startsWith('Hi Peter,'), 'reminder text on the clipboard, addressed to Peter');
  ok((await leo.evaluate(() => window.__opened))[0] === MAIL[0].webLink, 'and the email opens in Outlook');

  console.log('Follow-up — to-do and settings');
  await leo.click('#fuAdd summary');
  await leo.fill('#fuWhat', 'Call Forte about BABA letters');
  await leo.selectOption('#fuWhatP', 'Forest Hill');
  await leo.click('#fuAddForm button[type=submit]');
  ok(await until(() => Object.values(mine().todos || {}).some(t => t.what === 'Call Forte about BABA letters' && t.p === 'Forest Hill')), 'to-do saved');
  ok(await until(async () => /Call Forte about BABA letters/.test(await groupText(leo, 'Forest Hill'))), 'to-do shows under Forest Hill');
  await leo.click('#fuSet summary');
  await leo.fill('#fuDays', '10');
  await leo.click('[data-a=save-set]');
  ok(await until(() => mine().cfg.days === 10), 'nudge after 10 working days saved');
  ok(await until(async () => (await rowOf(leo, 'lintel enclosure').count()) === 0 || (await leo.locator('.fu-row', { hasText: 'lintel enclosure' }).locator('.fu-badge.red').count()) === 0), 'lintel (7 working days) no longer due');
  if (process.env.SHOTS) {
    const ph = await open(LEO, { width: 390, height: 844 });
    await ph.waitForSelector('#connect:not([hidden])', { timeout: 15000 });
    await ph.click('#msLogin');
    await ph.waitForSelector('.fu-row', { timeout: 15000 });
    await ph.screenshot({ path: path.join(process.env.SHOTS, 'followup-phone.png'), fullPage: false });
  }

  console.log('Follow-up — someone else');
  const cdu = await open(STAFF);
  await cdu.waitForSelector('#setup:not([hidden])', { timeout: 15000 });
  ok(true, 'another staff member gets their own empty setup — not Leo\'s list');
  const peek = await cdu.evaluate(uid => new Promise(res => firebase.database().ref('followup/' + uid).once('value').then(() => res('read'), e => res(e.code))), leoUid());
  ok(peek === 'PERMISSION_DENIED', 'and cannot read Leo\'s list (' + peek + ')');

  ok(!errors.length, 'no page errors' + (errors.length ? ': ' + errors.join(' | ') : ''));
} catch (e) {
  fail++; console.log('  FAIL ' + (e.stack || e));
} finally {
  await browser.close();
  server.close();
}
console.log(`follow-up page (e2e): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
