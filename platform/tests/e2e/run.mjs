#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   End-to-end: the real tracker pages (/ac3/, /lex/) in a real browser, two
   project databases, and people with different access. Proves that a save
   lands only in its own project and that every way of pointing a page at the
   wrong database stops before anything is written.

     node platform/tests/e2e/run.mjs --backend=emulator   (CI: Firebase emulators,
                                                          real Firebase SDK)
     node platform/tests/e2e/run.mjs --backend=fake       (anywhere: in-memory
                                                          databases, rules checked
                                                          by targaryen, stub SDK)
   ───────────────────────────────────────────────────────────────────────── */
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..', '..');
const BACKEND = (process.argv.find(a => a.startsWith('--backend=')) || '--backend=fake').split('=')[1];
const RULES = fs.readFileSync(path.join(ROOT, 'platform', 'project-database.rules.json'), 'utf8');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'projects.json'), 'utf8'));
const HUB_DEFAULT = 'https://af-hub-8f188-default-rtdb.firebaseio.com';
const { chromium } = require('playwright');

// ───────────────────────────────────────────────────────────── people ──
const PW = 'test-password-1';
const LEO = 'leo.sun@advfacade.com';       // staff, editor on ac3 AND lex
const JOE = 'joe.foreman@gmail.com';       // editor on ac3 only, personal email
const BOSS = 'boss@advfacade.com';         // staff, on no list
const GC = 'pm@turner.com';                // GC on ac3
const NEWBIE = 'new.hire@advfacade.com';   // email not verified yet
const key = e => e.replace(/\./g, ',');

const seedFor = (id, editors, gcs) => ({
  meta: { project: id, name: id.toUpperCase() },
  allowlist: Object.fromEntries(editors.map(e => [key(e), true])),
  ...(gcs ? { gcList: Object.fromEntries(gcs.map(e => [key(e), true])) } : {}),
  state: {
    _clientId: 'seed', _ts: 1, _by: LEO, _project: id, updatedAt: '2026-10-01T00:00:00Z',
    // Lexington builds its board from project-config.js and keeps cloud rows by key, so it
    // gets one of its real keys; AC3 keeps whatever units the cloud holds.
    units: [id === 'lex' ? { key: 'SD0201', id: 'SD0201', status: 'pending' }
                         : { key: 'AC3-1', id: 'AC3-1', status: 'pending', level: 'GF', zone: 'N', type: 'Storefront' }],
    log: [],
  },
});

// ───────────────────────────────────────────────────────────── backends ──
function dget(o, p) { return String(p).split('/').filter(Boolean).reduce((x, k) => (x && typeof x === 'object' ? x[k] : undefined), o); }
function dset(root, p, v) {
  const ks = String(p).split('/').filter(Boolean);
  if (!ks.length) return v === null ? {} : v;
  let o = root;
  ks.slice(0, -1).forEach(k => { if (!o[k] || typeof o[k] !== 'object') o[k] = {}; o = o[k]; });
  if (v === null || v === undefined) delete o[ks[ks.length - 1]]; else o[ks[ks.length - 1]] = v;
  return root;
}
const clone = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));
function serverValues(v, now) {
  if (v && typeof v === 'object') {
    if (v['.sv'] === 'timestamp') return now;
    const o = Array.isArray(v) ? [] : {};
    for (const k of Object.keys(v)) o[k] = serverValues(v[k], now);
    return o;
  }
  return v;
}

class FakeBackend {
  constructor() {
    this.targaryen = require('targaryen');
    this.rules = JSON.parse(RULES.split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
    this.dbs = {}; this.users = {}; this.ruled = new Set();
  }
  async start() {}
  async stop() {}
  url(id) { return REG.projects.find(p => p.id === id).databaseURL; }
  hubUrl() { return HUB_DEFAULT; }
  async seed(url, tree, withRules = true) { this.dbs[url] = clone(tree); if (withRules) this.ruled.add(url); }
  async read(url, p) { return clone(dget(this.dbs[url] || {}, p)); }
  async createUser(email, verified) { this.users[email] = { uid: 'u_' + email.replace(/\W/g, '_'), email, emailVerified: !!verified, password: PW }; }
  async verify(email) { this.users[email].emailVerified = true; }
  handle(op, a) {
    const now = Date.now();
    if (op === 'signIn') { const u = this.users[a.email]; return u && u.password === a.password ? { uid: u.uid, email: u.email, emailVerified: u.emailVerified } : null; }
    if (op === 'user') { const u = Object.values(this.users).find(x => x.uid === a.uid); return u ? { emailVerified: u.emailVerified } : null; }
    if (op === 'sendVerification' || op === 'reset' || op === 'upload') return null;
    const data = this.dbs[a.url] = this.dbs[a.url] || {};
    const ruled = this.ruled.has(a.url);
    const db = ruled ? this.targaryen.database(this.rules, clone(data), now).as(a.auth || null) : null;
    if (op === 'read') {
      const allowed = ruled ? db.read(a.path).allowed : true;
      return { allowed, value: allowed ? clone(dget(data, a.path)) : undefined };
    }
    if (op === 'write') {
      const value = serverValues(a.value, now);
      let allowed = true;
      if (ruled) allowed = (a.op === 'update' ? db.update(a.path, value) : db.write(a.path, value)).allowed;
      if (allowed) {
        if (a.op === 'update') for (const k of Object.keys(value)) dset(data, a.path + '/' + k, value[k]);
        else this.dbs[a.url] = dset(data, a.path, value);
      }
      return { allowed };
    }
    throw new Error('fake backend: unknown op ' + op);
  }
  async attach(context) {
    await context.exposeFunction('__fb', (op, args) => this.handle(op, args));
    const fake = fs.readFileSync(path.join(here, 'fake-firebase.js'), 'utf8');
    await context.route(/gstatic\.com\/firebasejs\//, r => r.fulfill({ contentType: 'text/javascript',
      body: /firebase-app-compat\.js$/.test(r.request().url()) ? fake : '/* fake SDK: see firebase-app-compat */' }));
    const chart = path.join(path.dirname(require.resolve('chart.js')), 'chart.umd.js');
    await context.route(/cdnjs\.cloudflare\.com\/.*chart.*\.js/i, r => r.fulfill({ contentType: 'text/javascript', body: fs.readFileSync(chart, 'utf8') }));
  }
  config(url) { return { databaseURL: url }; }
  configExtra() { return ''; }
  async refresh(page) { await page.evaluate(() => window.__fbRefresh && window.__fbRefresh()); }
}

class EmulatorBackend {
  constructor() {
    this.A = require('firebase-admin/app');
    this.D = require('firebase-admin/database');
    this.U = require('firebase-admin/auth');
    this.host = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
    this.authHost = process.env.FIREBASE_AUTH_EMULATOR_HOST || '127.0.0.1:9099';
    this.apps = {};
  }
  async start() {}
  async stop() { await Promise.all(this.A.getApps().map(a => this.A.deleteApp(a))); }
  ns(id) { return 'af-hub-8f188-' + id; }
  url(id) { return `http://${this.host}/?ns=${this.ns(id)}`; }
  hubUrl() { return `http://${this.host}/?ns=af-hub-8f188-default-rtdb`; }
  app(url) {
    if (!this.apps[url]) this.apps[url] = this.A.initializeApp({ projectId: 'demo-afhub', databaseURL: url }, 'a' + Object.keys(this.apps).length);
    return this.apps[url];
  }
  async seed(url, tree, withRules = true) {
    const ns = new URL(url).searchParams.get('ns');
    const rules = withRules ? RULES : '{"rules":{".read":true,".write":true}}';
    const r = await fetch(`http://${this.host}/.settings/rules.json?ns=${ns}`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: rules });
    if (!r.ok) throw new Error('rules: ' + r.status + ' ' + await r.text());
    await this.D.getDatabase(this.app(url)).ref('/').set(tree);
  }
  async read(url, p) { return (await this.D.getDatabase(this.app(url)).ref(p).once('value')).val() ?? undefined; }
  authAdmin() { return this.U.getAuth(this.apps.__auth = this.apps.__auth || this.A.initializeApp({ projectId: 'demo-afhub' }, 'auth')); }
  async createUser(email, verified) {
    // The migration test that runs before this one may already have made the account.
    const a = this.authAdmin();
    try { const u = await a.getUserByEmail(email); await a.updateUser(u.uid, { password: PW, emailVerified: !!verified }); }
    catch (e) { if (e.code !== 'auth/user-not-found') throw e; await a.createUser({ email, password: PW, emailVerified: !!verified }); }
  }
  async verify(email) { const u = await this.authAdmin().getUserByEmail(email); await this.authAdmin().updateUser(u.uid, { emailVerified: true }); }
  async attach(context) {
    // Belt and braces: a test must never reach the real Firebase project.
    await context.route(/\.firebaseio\.com|firebasedatabase\.app|identitytoolkit\.googleapis\.com|securetoken\.googleapis\.com/, r => r.abort());
  }
  config(url) { return { databaseURL: url }; }
  /* Appended to every routed config file: point the real Auth SDK at the emulator the
     first time any page asks for it (tracker, chat, warehouse, recover alike). */
  configExtra() {
    return `(function(){var o=firebase.auth,u='http://${this.authHost}';firebase.auth=function(){var a=o.apply(this,arguments);` +
      `if(!a.__emu){a.__emu=1;try{a.useEmulator(u,{disableWarnings:true});}catch(e){}}return a;};Object.assign(firebase.auth,o);})();`;
  }
  async refresh() {}
}

// ───────────────────────────────────────────────────────────── server ──
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.png': 'image/png', '.svg': 'image/svg+xml' };
function serve(port) {
  return new Promise(res => {
    const s = http.createServer((q, r) => {
      let u = decodeURIComponent(q.url.split('?')[0]);
      if (u.endsWith('/')) u += 'index.html';
      const f = path.join(ROOT, u);
      if (!f.startsWith(ROOT)) { r.writeHead(403); return r.end(); }
      fs.readFile(f, (e, b) => { if (e) { r.writeHead(404); return r.end(); } r.writeHead(200, { 'content-type': TYPES[path.extname(f)] || 'application/octet-stream' }); r.end(b); });
    }).listen(port, '127.0.0.1', () => res(s));
  });
}

// ───────────────────────────────────────────────────────────── scenarios ──
let pass = 0, fail = 0;
const ok = (cond, msg, extra) => { if (cond) { pass++; console.log('  ✓ ' + msg); } else { fail++; console.log('  ✗ ' + msg + (extra ? '\n      ' + extra : '')); } };
const sleep = ms => new Promise(r => setTimeout(r, ms));
// SHOTS=<folder> saves a screenshot at each step (for docs and debugging).
const SHOTS = process.env.SHOTS || '';
async function shot(page, name) { if (SHOTS) { fs.mkdirSync(SHOTS, { recursive: true }); await page.screenshot({ path: path.join(SHOTS, name + '.png') }); } }
async function until(fn, ms = 15000) { const t0 = Date.now(); while (Date.now() - t0 < ms) { try { if (await fn()) return true; } catch (e) {} await sleep(150); } return false; }

const B = BACKEND === 'emulator' ? new EmulatorBackend() : new FakeBackend();
const AC3 = B.url('ac3'), LEX = B.url('lex');
const BASE = 'http://127.0.0.1:8833';

async function newContext(browser, { lexPointsAt } = {}) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 860 } });
  await B.attach(context);
  // Each page gets its project's database; optionally point /lex/ at another one.
  const cfg = (folder, url) => `window.FIREBASE_CONFIG = ${JSON.stringify(Object.assign({
    apiKey: 'fake-api-key', authDomain: 'demo-afhub.firebaseapp.com', projectId: 'demo-afhub',
    storageBucket: 'af-hub-8f188.firebasestorage.app', appId: '1:1:web:1' }, B.config(url)))};\n${B.configExtra()}`;
  await context.route(/\/ac3\/firebase-config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: cfg('ac3', AC3) }));
  await context.route(/\/lex\/firebase-config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: cfg('lex', lexPointsAt || LEX) }));
  // The hub summary writer must hit the test hub database, never the real one.
  await context.route(/\/af-hub-config\.js/, r => r.fulfill({ contentType: 'text/javascript', body: `window.AF_HUB_FIREBASE = ${JSON.stringify(Object.assign({
    apiKey: 'fake-api-key', authDomain: 'demo-afhub.firebaseapp.com', projectId: 'demo-afhub', appId: '1:1:web:2' }, B.config(B.hubUrl())))};` }));
  await context.route(/fonts\.(googleapis|gstatic)\.com/, r => r.abort());
  return context;
}
async function open(context, folder) {
  const page = await context.newPage();
  page.on('pageerror', e => { if (!/ResizeObserver|Chart/.test(e.message)) console.log('    [pageerror]', e.message.slice(0, 160)); });
  await page.goto(`${BASE}/${folder}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#cs-auth-gate', { state: 'attached', timeout: 20000 });
  return page;
}
async function open2(context, rel) {
  const page = await context.newPage();
  page.on('pageerror', e => console.log('    [pageerror ' + rel + ']', e.message.slice(0, 160)));
  await page.goto(`${BASE}/${rel}`, { waitUntil: 'domcontentloaded' });
  return page;
}
async function signIn(page, email) {
  await page.waitForSelector('#cs-email', { state: 'visible', timeout: 20000 });
  await page.fill('#cs-email', email);
  await page.fill('#cs-password', PW);
  await page.click('#cs-auth-submit');
}
const gateVisible = page => page.evaluate(() => { const g = document.getElementById('cs-auth-gate'); return !!g && getComputedStyle(g).display !== 'none'; });
const gateText = page => page.evaluate(() => (document.getElementById('cs-auth-msg') || {}).innerText || '');
async function edit(page, status) {
  return page.evaluate(s => { const u = typeof state !== "undefined" && state && state.units && state.units[0]; if (!u) return false; u.status = s; window.saveState(); return true; }, status);
}

(async () => {
  console.log(`end-to-end (${BACKEND} backend)`);
  await B.start();
  const server = await serve(8833);
  await B.seed(AC3, seedFor('ac3', [LEO, JOE], [GC]));
  await B.seed(LEX, seedFor('lex', [LEO]));
  await B.seed(B.hubUrl(), {}, false);
  for (const e of [LEO, JOE, BOSS, GC]) await B.createUser(e, true);
  await B.createUser(NEWBIE, false);
  const lexBefore = JSON.stringify(await B.read(LEX, 'state'));
  const browser = await chromium.launch();

  try {
    console.log('\n1. An editor saves on AC3 — the save lands in AC3 only, stamped "ac3"');
    let ctx = await newContext(browser);
    let page = await open(ctx, 'ac3');
    await page.waitForSelector('#cs-email', { state: 'visible', timeout: 20000 });
    await shot(page, '1-sign-in');
    await signIn(page, LEO);
    ok(await until(async () => !(await gateVisible(page))), 'sign-in opens the AC3 board');
    ok(await until(() => page.evaluate(() => window.CloudSync.role() === 'editor')), 'Leo is an editor on AC3');
    await sleep(800); await shot(page, '2-ac3-board');
    await until(() => page.evaluate(() => !!(typeof state !== "undefined" && state && state.units && state.units.length)));
    ok(await edit(page, 'installed'), 'mark the first unit installed');
    ok(await until(async () => ((await B.read(AC3, 'state/units/0/status')) === 'installed')), 'AC3 database has the change');
    ok((await B.read(AC3, 'state/_project')) === 'ac3', 'the save carries _project = "ac3"');
    ok((await B.read(AC3, 'state/_by')) === LEO, 'the save is signed by Leo');
    ok(JSON.stringify(await B.read(LEX, 'state')) === lexBefore, 'Lexington database untouched');

    console.log('\n2. Same login, Lexington page — Leo is an editor there too, saves land in Lexington');
    const page2 = await open(ctx, 'lex');
    ok(await until(async () => !(await gateVisible(page2))), 'no second sign-in needed (one login for every project)');
    await until(() => page2.evaluate(() => window.CloudSync.role() === 'editor'));
    await until(() => page2.evaluate(() => !!(typeof state !== "undefined" && state && state.units && state.units.some(u => u.key === 'SD0201'))));
    const lexKeys = await page2.evaluate(() => state.units.map(u => u.key));
    ok(lexKeys.includes('SD0201') && !lexKeys.includes('AC3-1'), 'the Lexington board shows Lexington data and none of AC3\'s', JSON.stringify(lexKeys.slice(0, 5)) + ' … ' + lexKeys.length);
    await edit(page2, 'issue');
    ok(await until(async () => ((await B.read(LEX, 'state/units/0/status')) === 'issue')), 'Lexington database has its change');
    ok((await B.read(LEX, 'state/_project')) === 'lex', 'stamped "lex"');
    ok((await B.read(AC3, 'state/units/0/status')) === 'installed', 'AC3 still has its own value');

    console.log('\n2b. The other pages of a project (warehouse, chat) open for an editor');
    const wh = await open2(ctx, 'ac3/warehouse.html');
    ok(await until(() => wh.evaluate(() => document.getElementById('connPill').classList.contains('live'))), 'warehouse page: connected as editor');
    const ch = await open2(ctx, 'ac3/chat.html');
    ok(await until(() => ch.evaluate(() => /Signed in as/.test(document.body.innerText))), 'chat page: signed in and loaded');
    ok(!(await ch.evaluate(() => /Stopped/.test(document.body.innerText))), 'chat page: no project warning');
    await ctx.close();

    console.log('\n3. A page pointed at the WRONG database stops before anything is written');
    const ac3Before = JSON.stringify(await B.read(AC3, 'state'));
    ctx = await newContext(browser, { lexPointsAt: AC3 });   // lex page, AC3 database
    page = await open(ctx, 'lex');
    await signIn(page, LEO);
    ok(await until(async () => /do not match/.test(await gateText(page))), 'red "this page and its database do not match" message', await gateText(page));
    await shot(page, '3-wrong-database');
    ok(await gateVisible(page), 'the board stays locked');
    await edit(page, 'issue');
    await page.evaluate(() => window.CloudSync && window.CloudSync.flush());
    await sleep(1500);
    ok(JSON.stringify(await B.read(AC3, 'state')) === ac3Before, 'AC3 database untouched by the misconfigured page');
    // Even a page that skipped the check is refused by the server (rules compare _project).
    const refused = await page.evaluate(async () => {
      try { await firebase.database().ref('state').set({ _clientId: 'x', _ts: 1, _by: 'leo.sun@advfacade.com', _project: 'lex', units: [] }); return false; }
      catch (e) { return /permission/i.test(e.code || e.message); }
    });
    ok(refused, 'a direct save stamped "lex" into the AC3 database is refused by the rules');
    ok(JSON.stringify(await B.read(AC3, 'state')) === ac3Before, 'AC3 database still untouched');
    const wh3 = await open2(ctx, 'lex/warehouse.html');
    ok(await until(() => wh3.evaluate(() => /Stopped/.test(document.getElementById('gateMsg').textContent))), 'warehouse page pointed at the wrong database stops too');
    const ch3 = await open2(ctx, 'lex/chat.html');
    ok(await until(() => ch3.evaluate(() => /Stopped/.test(document.body.innerText))), 'chat page pointed at the wrong database stops too');
    await ctx.close();

    console.log('\n4. A foreman on AC3 only cannot open Lexington');
    ctx = await newContext(browser);
    page = await open(ctx, 'lex');
    await signIn(page, JOE);
    ok(await until(async () => /No access/.test(await gateText(page))), '"No access" message', await gateText(page));
    await shot(page, '4-no-access');
    ok(await gateVisible(page), 'nothing of Lexington is shown');
    await ctx.close();

    console.log('\n5. Staff (@advfacade.com, on no list) can view, cannot change');
    const lexNow = JSON.stringify(await B.read(LEX, 'state'));
    ctx = await newContext(browser);
    page = await open(ctx, 'lex');
    await signIn(page, BOSS);
    ok(await until(async () => !(await gateVisible(page))), 'the board opens');
    ok(await until(() => page.evaluate(() => window.CloudSync.role() === 'viewer' && window.CloudSync.isReadOnly())), 'read-only viewer');
    await until(() => page.evaluate(() => !!(typeof state !== "undefined" && state && state.units && state.units.some(u => u.key === 'SD0201'))));
    await edit(page, 'pending');
    await sleep(1500);
    ok(JSON.stringify(await B.read(LEX, 'state')) === lexNow, 'their edit is not saved');
    await ctx.close();

    console.log('\n6. The GC sees the GC view of AC3, read-only');
    ctx = await newContext(browser);
    page = await open(ctx, 'ac3');
    await signIn(page, GC);
    ok(await until(async () => !(await gateVisible(page))), 'the board opens');
    ok(await until(() => page.evaluate(() => window.CloudSync.isGC() && window.CloudSync.isReadOnly())), 'GC, read-only');
    await ctx.close();

    console.log('\n7. An unverified address is asked to confirm it first');
    ctx = await newContext(browser);
    page = await open(ctx, 'ac3');
    await signIn(page, NEWBIE);
    ok(await until(async () => /Confirm your email/.test(await gateText(page))), '"Confirm your email first" step', await gateText(page));
    await shot(page, '5-confirm-email');
    await B.verify(NEWBIE);
    await page.click('#cs-auth-msg button:has-text("I opened the link")');
    ok(await until(async () => !(await gateVisible(page))), 'after confirming, staff can view AC3');
    ok(await until(() => page.evaluate(() => window.CloudSync.isReadOnly())), '…read-only');
    await ctx.close();
  } finally {
    await browser.close();
    server.close();
    await B.stop();
  }
  console.log(`\nend-to-end (${BACKEND}): ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
