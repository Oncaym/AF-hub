#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   AF Hub — project database tool. Run by .github/workflows/project-db.yml.

   MODE=dry-run   Read the project's OLD Firebase and its NEW database; print
                  what a migration would copy. Writes nothing anywhere.
   MODE=migrate   1. put the rules on the new database (before any data)
                  2. freeze the old database (rules → no reads, no writes;
                     the old rules are printed so they can be put back)
                  3. copy every node, stamp /meta/project and state._project
                  4. copy photos from the old bucket to p/<id>/legacy/… and
                     point the URLs at the copies (old files are left alone)
                  5. create logins for everyone on the project's lists
                  6. read everything back and compare
                  Refuses if the new database already has data (FORCE=1 to
                  overwrite) and ALWAYS refuses if it belongs to another project.
   MODE=rules     Put platform/project-database.rules.json on the database(s)
                  (PROJECT=all for every project in platform/projects.json).
                  PROJECT=hub is the hub's own database (overview, damage, 🚚
                  projects without a dashboard): /firebase-database-rules.json,
                  old rules kept under /_admin/rulesBefore. "all" includes it.
                  PROJECT=design is the design team's database (Design Boards):
                  it gets platform/design-database.rules.json instead, and
                  "all" includes it. It has editors and viewers, no GC.
   MODE=init      Start an empty database for a NEW project: rules + /meta +
                  EMAIL as its first editor.
   MODE=member    Add EMAIL to the project as ROLE (editor | gc | viewer), or
                  ROLE=remove to take them off every list. ROLE=staff (any
                  PROJECT, e.g. hub): a confirmed company login on no list.
                  ROLE=shop (any PROJECT): may mark 🚚 To send "Sent" on
                  every project; PROJECT=shop ROLE=remove takes that away.
                  ROLE=boss (any PROJECT): reads every project and board,
                  changes nothing; PROJECT=boss ROLE=remove takes that away.
                  PROJECT=design/<board> (e.g. design/ac3) with ROLE editor,
                  viewer or remove: one board of the Design Board (a PM).
                  ROLE=list: who is on the project's lists (emails masked).
                  Creates the login if it does not exist, so they only need
                  "First time here".

   Env: MODE, PROJECT, EMAIL, ROLE, FORCE, COPY_PHOTOS (default 1),
        HUB_SERVICE_ACCOUNT and the legacy secret named in projects.json.
   Emulator (CI test): FIREBASE_DATABASE_EMULATOR_HOST / FIREBASE_AUTH_EMULATOR_HOST /
        FIREBASE_STORAGE_EMULATOR_HOST plus EMULATOR_DB_URLS='{"ac3":"http://…?ns=x",…}'.

   The repository is public, so this never prints an email address in full.
   ───────────────────────────────────────────────────────────────────────── */
'use strict';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { initializeApp, cert, deleteApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getAuth } = require('firebase-admin/auth');
const { getStorage } = require('firebase-admin/storage');
const C = require('./core');

const ROOT = path.join(__dirname, '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'projects.json'), 'utf8'));
const RULES = fs.readFileSync(path.join(ROOT, 'project-database.rules.json'), 'utf8');
const FROZEN_RULES = '{\n  "rules": {\n    // Frozen by the AF Hub migration: this project now lives in the af-hub Firebase.\n    ".read": false,\n    ".write": false\n  }\n}\n';

/* EMAIL is read from the workflow's event file, not from env: env values are
   printed in the (public) Actions log, the event file is not. */
function input(name) {
  if (process.env[name]) return process.env[name];
  try { return String((JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH, 'utf8')).inputs || {})[name.toLowerCase()] || ''); }
  catch (e) { return ''; }
}
const MODE = (process.env.MODE || 'dry-run').trim();
const PID = (process.env.PROJECT || '').trim();
const EMAIL = input('EMAIL').trim().toLowerCase();
/* EMAIL may list several people (commas, spaces or new lines): init makes them all
   editors, member gives them all the same ROLE — one run instead of one per person. */
const EMAILS = [...new Set(EMAIL.split(/[\s,;]+/).filter(Boolean))];
const isEmail = e => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e);
const ROLE = (process.env.ROLE || '').trim();
const FORCE = process.env.FORCE === '1' || process.env.FORCE === 'true';
const COPY_PHOTOS = !(process.env.COPY_PHOTOS === '0' || process.env.COPY_PHOTOS === 'false');
const EMU = !!process.env.FIREBASE_DATABASE_EMULATOR_HOST;
const EMU_URLS = process.env.EMULATOR_DB_URLS ? JSON.parse(process.env.EMULATOR_DB_URLS) : {};

const log = (...a) => console.log(...a);
const die = (msg) => { console.error('\n✗ ' + msg); process.exit(1); };

function sa(name) {
  if (EMU) return undefined;
  const raw = process.env[name];
  if (!raw) die(`GitHub secret ${name} is missing (Settings → Secrets and variables → Actions).`);
  try { return cert(JSON.parse(raw)); } catch (e) { die(`secret ${name} is not a service-account JSON: ${e.message}`); }
}
function appFor(name, databaseURL, secret, storageBucket) {
  const opts = { databaseURL: EMU_URLS[name] || databaseURL };
  if (EMU) opts.projectId = 'demo-afhub'; else opts.credential = sa(secret);
  if (storageBucket) opts.storageBucket = storageBucket;
  return initializeApp(opts, name);
}
/* The hub's own database (overview summaries, damage, 🚚 projects without a dashboard).
   Rules mode only: PROJECT=hub (or all) puts /firebase-database-rules.json on it, after
   keeping a copy of the rules it had under /_admin/rulesBefore/<time> (no page can read it). */
const HUB = { id: 'hub', name: 'AF Hub overview database', hub: true,
  databaseURL: `https://${REG.firebaseProject}-default-rtdb.firebaseio.com`, rules: '../firebase-database-rules.json' };
function entry(id) {
  if (id === HUB.id) return HUB;
  if (REG.design && id === REG.design.id) return REG.design;
  const h = (REG.hosted || []).find(x => x.id === id);
  if (h) return Object.assign({ hosted: true }, h);
  const p = REG.projects.find(x => x.id === id);
  if (!p) die(`PROJECT "${id}" is not in platform/projects.json (have: ${REG.projects.map(x => x.id).concat(REG.design ? [REG.design.id] : [], (REG.hosted || []).map(x => x.id), [HUB.id]).join(', ')})`);
  return p;
}
/* Which rules file a database gets: trackers share project-database.rules.json;
   the design database names its own. */
function rulesFor(p) {
  return p.rules ? fs.readFileSync(path.join(ROOT, p.rules), 'utf8') : RULES;
}

/* Rules go through REST: Admin SDK setRules where available, the emulator's
   owner token in CI. */
async function putRules(app, text) {
  if (EMU) {
    const u = new URL(app.options.databaseURL);
    const ns = u.searchParams.get('ns');
    const r = await fetch(`http://${process.env.FIREBASE_DATABASE_EMULATOR_HOST}/.settings/rules.json?ns=${ns}`,
      { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: text });
    if (!r.ok) throw new Error('emulator rules: HTTP ' + r.status + ' ' + await r.text());
    return;
  }
  await getDatabase(app).setRules(text);
}
async function getRules(app) {
  if (EMU) return null;
  try { return await getDatabase(app).getRules(); } catch (e) { return null; }
}

async function readRoot(app) { return (await getDatabase(app).ref('/').once('value')).val(); }
async function writeTree(app, tree) {
  const db = getDatabase(app);
  const parts = C.batches(tree);
  for (const b of parts) {
    if (b.path === '/') await db.ref('/').set(b.value);
    else await db.ref(b.path).set(b.value);
  }
  return parts.length;
}

async function ensureUser(auth, email) {
  try {
    const u = await auth.getUserByEmail(email);
    if (!u.emailVerified) { await auth.updateUser(u.uid, { emailVerified: true }); return 'verified existing'; }
    return 'exists';
  } catch (e) {
    if (e.code !== 'auth/user-not-found') throw e;
    await auth.createUser({ email, emailVerified: true });
    return 'created';
  }
}

async function copyPhotos(tree, p, legacyApp, hubApp, dry) {
  const urls = C.storageUrls(tree, p.legacy.storageBucket);
  log(`\nPhotos stored in the old bucket and referenced by the data: ${urls.length}`);
  if (!urls.length || dry || !COPY_PHOTOS) {
    if (urls.length && !COPY_PHOTOS) log('  COPY_PHOTOS=0 → left on the old bucket (their URLs keep working while that project exists).');
    return { tree, copied: 0, failed: 0 };
  }
  const from = getStorage(legacyApp).bucket(p.legacy.storageBucket);
  const to = getStorage(hubApp).bucket(REG.storageBucket);
  const map = {};
  let failed = 0;
  for (const url of urls) {
    const src = C.objectPath(url);
    const dst = `p/${p.id}/legacy/${src}`;
    try {
      const [buf] = await from.file(src).download();
      const [meta] = await from.file(src).getMetadata();
      const token = crypto.randomUUID();
      await to.file(dst).save(buf, { resumable: false, contentType: meta.contentType || 'image/jpeg',
        metadata: { metadata: { firebaseStorageDownloadTokens: token, migratedFrom: p.legacy.storageBucket } } });
      map[url] = C.downloadUrl(REG.storageBucket, dst, token);
    } catch (e) {
      failed++;
      log(`  ! could not copy one photo (${e.code || e.message}) — its old URL is kept`);
    }
  }
  log(`  copied ${Object.keys(map).length}, kept ${failed} old URL(s)`);
  return { tree: C.rewriteUrls(tree, map), copied: Object.keys(map).length, failed };
}

async function legacyUsers(legacyApp) {
  if (EMU) return [];
  const out = [];
  let token;
  try {
    do {
      const r = await getAuth(legacyApp).listUsers(1000, token);
      r.users.forEach(u => u.email && out.push(u.email.toLowerCase()));
      token = r.pageToken;
    } while (token);
  } catch (e) { log(`  (could not list the old project's accounts: ${e.code || e.message})`); }
  return out;
}

function printMembers(list, oldAccounts, hadGcList) {
  const by = r => list.filter(m => m.role === r);
  log(`\nPeople on this project's lists: ${by('editor').length} editor(s), ${by('gc').length} GC, ${by('viewer').length} viewer(s)`);
  list.forEach(m => log(`  ${m.role.padEnd(6)} ${C.maskEmail(m.email)}`));
  const listed = new Set(list.map(m => m.email.toLowerCase()));
  const others = oldAccounts.filter(e => !listed.has(e) && !C.isStaff(e));
  if (others.length) {
    log(`\n${others.length} other account(s) could sign in to the OLD tracker but are on no list and are not @advfacade.com.`);
    log(hadGcList
      ? '  They saw the full board read-only. After the move they see nothing until added (MODE=member, ROLE=viewer or gc):'
      : '  The old database had no gcList, so the old page showed them the GC view. After the move they see nothing until added (MODE=member, ROLE=gc or viewer):');
    others.forEach(e => log('  ' + C.maskEmail(e)));
  }
  const staff = oldAccounts.filter(e => !listed.has(e) && C.isStaff(e));
  if (staff.length) log(`\n${staff.length} @advfacade.com account(s) not on a list: they keep read-only access automatically.`);
}

// ─────────────────────────────────────────────────────────────── modes ──
async function dryRunOrMigrate(dry) {
  const p = entry(PID);
  if (!p.legacy) die(`"${p.id}" has no old database to move (use MODE=init to start it)`);
  if (p.hosted) return hostedCopy(p, dry);
  const legacyApp = appFor('legacy', p.legacy.databaseURL, p.legacy.secret, p.legacy.storageBucket);
  const hubApp = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT', REG.storageBucket);
  log(`${dry ? 'DRY RUN' : 'MIGRATE'} — ${p.name} (${p.id})`);
  log(`  from ${p.legacy.databaseURL}`);
  log(`  to   ${p.databaseURL}`);

  // The new database: must exist, must be empty (or FORCE), must not belong to another project.
  let target;
  try { target = await readRoot(hubApp); }
  catch (e) { die(`cannot read the new database (${e.code || e.message}). Did you create "${new URL(p.databaseURL).hostname.split('.')[0]}" in the Firebase console (Realtime Database → Create database)?`); }
  const tMeta = target && target.meta && target.meta.project;
  if (tMeta && tMeta !== p.id) die(`the new database says it belongs to "${tMeta}", not "${p.id}". Stopping — nothing written.`);
  const tKeys = target ? Object.keys(target) : [];
  log(`\nNew database now: ${tKeys.length ? tKeys.join(', ') : 'empty'}`);
  if (tKeys.length && !FORCE) {
    const msg = 'the new database already has data. Run with force only if you mean to replace it.';
    if (dry) log('  ! ' + msg); else die(msg);
  }

  // Freeze the old one first, so nothing changes while we copy. Its rules are kept
  // (not printed: GitHub masks every { and } in a log because the service-account
  // secret contains them, which would make a printed copy useless).
  let oldRules = null;
  if (!dry) {
    oldRules = await getRules(legacyApp);
    await putRules(hubApp, RULES);                      // new database closed before any data lands
    log('✓ rules put on the new database');
    await putRules(legacyApp, FROZEN_RULES);
    log('✓ old database frozen (no page can read or write it now)');
  }

  const src = await readRoot(legacyApp);
  if (!src) die('the old database is empty — nothing to move.');
  const now = Date.now();
  let { tree, report } = C.buildTree(src, { id: p.id, name: p.name, legacyURL: p.legacy.databaseURL, now });
  log('\nOld database:');
  Object.entries(report.copied).forEach(([k, d]) => log(`  ${k.padEnd(10)} ${d}  → copy`));
  const WHY = { presence: 'live-only', triage: 'Glass Triage was removed' };
  report.skipped.forEach(k => log(`  ${k.padEnd(10)} → skip (${WHY[k] || 'not carried over'})`));
  report.unknown.forEach(k => log(`  ${k.padEnd(10)} ${C.describe(src[k])}  → copy, but no page reads it`));
  const nums = C.stateNumbers(src.state);
  log(`  state: ${nums.units} units (${nums.installed} installed), ${nums.log} log entries, ${nums.submittals} submittals, ` +
      `${nums.rfis} RFIs, ${nums.materials} materials, ${nums.elevations} elevations, ${nums.dataUrlPhotos} inline photo(s)`);

  const list = C.members(src);
  printMembers(list, await legacyUsers(legacyApp), !!src.gcList);

  const photos = await copyPhotos(tree, p, legacyApp, hubApp, dry);
  tree = photos.tree;

  if (dry) { log('\nDRY RUN finished — nothing was written. Run again with mode "migrate" to move it.'); return; }

  const n = await writeTree(hubApp, tree);
  log(`\n✓ copied (${n} write${n > 1 ? 's' : ''})`);

  const auth = getAuth(hubApp);
  for (const m of list) {
    try { log(`  login ${C.maskEmail(m.email)}: ${await ensureUser(auth, m.email)}`); }
    catch (e) { log(`  ! login ${C.maskEmail(m.email)}: ${e.code || e.message}`); }
  }

  const back = await readRoot(hubApp);
  const d = C.diff(tree, back);
  if (d.length) die(`read-back differs from what was written at ${d.length} place(s): ${d.slice(0, 10).join(', ')}`);
  log('\n✓ VERIFIED — the new database holds exactly what was copied.');
  if (oldRules) {
    // Kept where no page can read it (no rule grants /_admin); visible in the Firebase console.
    await getDatabase(hubApp).ref('_admin/legacyRules').set({ from: p.legacy.databaseURL, savedAt: new Date().toISOString(), text: oldRules });
  }
  log('\nTo undo the freeze of the old database: Firebase console → this project\'s NEW database → Data → _admin → legacyRules → text,\n' +
      'copy it into the OLD project\'s Realtime Database → Rules → Publish. (The same rules are in the old tracker repo: firebase-database-rules.json.)');
  log(`\nNext: open ${(REG.projects.find(x => x.id === p.id) || {}).folder ? 'https://af-hub-two.vercel.app/' + p.folder + '/' : 'the tracker'} and sign in.`);
}

/* A hosted page (Morgan North = Benji's tracker): copy its data nodes (units, plan) from its
   own Firebase into its af-hub database. Its old database is open (no login), so it is read
   without a key; it is NOT frozen from here (no access) — its owner locks it after the move.
   Re-running replaces those nodes only: /meta, the member lists and /toSend stay.
   EMAIL = people to make editors (added, never removed). */
async function readOpen(url, node) {
  if (EMU) return (await getDatabase(appFor('legacy', url)).ref(node).once('value')).val();
  const r = await fetch(`${url.replace(/\/$/, '')}/${node}.json`);
  if (r.status === 401 || r.status === 403) die(`the old database refuses to be read without a login now (HTTP ${r.status}) — it is probably locked already. Ask its owner to open it for reading for one copy, or to export the JSON.`);
  if (!r.ok) die(`${node}: HTTP ${r.status} from the old database`);
  return r.json();
}
async function hostedCopy(p, dry) {
  const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const nodes = p.legacy.nodes || ['units', 'plan'];
  log(`${dry ? 'DRY RUN' : 'COPY'} — ${p.name} (${p.id}), a page hosted as-is`);
  log(`  from ${p.legacy.databaseURL}  (${nodes.join(', ')})`);
  log(`  to   ${p.databaseURL}`);
  let target;
  try { target = await readRoot(app); }
  catch (e) { die(`cannot read the new database (${e.code || e.message}). Did you create "${new URL(p.databaseURL).hostname.split('.')[0]}" in the Firebase console (Realtime Database → Create database)?`); }
  const tMeta = target && target.meta && target.meta.project;
  if (tMeta && tMeta !== p.id) die(`the new database says it belongs to "${tMeta}", not "${p.id}". Stopping — nothing written.`);
  const has = nodes.filter(n => target && target[n] != null);
  log(`\nNew database now: ${target ? Object.keys(target).join(', ') : 'empty'}`);
  if (has.length && !FORCE) {
    const msg = `the new database already has ${has.join(', ')}. Run with force to replace them with the old database's (meta, member lists and To send stay).`;
    if (dry) log('  ! ' + msg); else die(msg);
  }
  const src = {};
  for (const n of nodes) src[n] = await readOpen(p.legacy.databaseURL, n);
  log('\nOld database:');
  nodes.forEach(n => log(`  ${n.padEnd(8)} ${C.describe(src[n])}`));
  if (src.units) {
    const st = Object.values(src.units).reduce((m, u) => { const k = (u && u.status) || '?'; m[k] = (m[k] || 0) + 1; return m; }, {});
    log(`  units by status: ${Object.entries(st).map(([k, v]) => k + ' ' + v).join(', ')}`);
  }
  if (src.plan && src.plan.windows) log(`  plan: ${Object.keys(src.plan.windows).length} windows (rev ${src.plan.rev || 0})`);
  if (!nodes.some(n => src[n] != null)) die('the old database has none of ' + nodes.join(', ') + ' — nothing to copy.');
  const bad = EMAILS.filter(e => !isEmail(e));
  if (bad.length) die(`not an email address: ${bad.map(C.maskEmail).join(', ')}`);
  if (dry) { log(`\nDRY RUN finished — nothing was written.${EMAILS.length ? ` Editors to add: ${EMAILS.map(C.maskEmail).join(', ')}` : ''}`); return; }

  await putRules(app, rulesFor(p));
  log('✓ rules put on the new database');
  const db = getDatabase(app);
  const now = Date.now();
  if (!tMeta) await db.ref('meta').set({ project: p.id, name: p.name, createdAt: now, migratedFrom: p.legacy.databaseURL, migratedAt: new Date(now).toISOString() });
  else await db.ref('meta/migratedAt').set(new Date(now).toISOString());
  for (const n of nodes) await db.ref(n).set(src[n] == null ? null : src[n]);
  log(`✓ copied ${nodes.join(', ')}`);
  if (EMAILS.length) {
    await db.ref('allowlist').update(Object.fromEntries(EMAILS.map(e => [C.emailKey(e), true])));
    const auth = getAuth(app);
    for (const e of EMAILS) {
      try { log(`  editor ${C.maskEmail(e)}: ${await ensureUser(auth, e)}`); }
      catch (er) { log(`  ! editor ${C.maskEmail(e)}: ${er.code || er.message}`); }
    }
  }
  for (const n of nodes) {
    const back = (await db.ref(n).once('value')).val();
    const d = C.diff(src[n] == null ? null : src[n], back);
    if (d.length) die(`${n}: read-back differs from what was written at ${d.length} place(s): ${d.slice(0, 10).join(', ')}`);
  }
  log('\n✓ VERIFIED — the new database holds exactly what was copied.');
  log(`\nNext: open https://af-hub-two.vercel.app/${p.folder}/ and sign in.` +
      `\nThe old database (${p.legacy.databaseURL}) is still open and still in use by the old page: when everyone has moved,` +
      `\nits owner locks it (Firebase console → Realtime Database → Rules → ".read": false, ".write": false).`);
}

async function rulesMode() {
  const ids = PID === 'all' ? REG.projects.map(x => x.id).concat(REG.design ? [REG.design.id] : [], (REG.hosted || []).map(x => x.id), [HUB.id]) : [PID];
  for (const id of ids) {
    const p = entry(id);
    const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
    if (p.hub) {
      const before = await getRules(app);
      if (before) await getDatabase(app).ref('_admin/rulesBefore/' + Date.now()).set(before);
      await putRules(app, rulesFor(p));
      log(`✓ rules put on the hub database (${p.databaseURL})${before ? '; the old rules are kept under /_admin/rulesBefore' : ''}`);
      continue;
    }
    const meta = (await getDatabase(app).ref('meta/project').once('value')).val();
    if (meta && meta !== p.id) die(`${p.databaseURL} says it belongs to "${meta}", not "${p.id}"`);
    await putRules(app, rulesFor(p));
    log(`✓ rules put on ${p.id} (${p.databaseURL})${meta ? '' : ' — note: no /meta yet, so no page can save there'}`);
  }
}

async function initMode() {
  const p = entry(PID);
  if (!EMAILS.length) die('EMAIL (the first editor) is required for init');
  const bad = EMAILS.filter(e => !isEmail(e));
  if (bad.length) die(`not an email address: ${bad.map(C.maskEmail).join(', ')}`);
  const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const root = await readRoot(app);
  if (root && Object.keys(root).length && !FORCE) die(`the database already has data (${Object.keys(root).join(', ')})`);
  await putRules(app, rulesFor(p));
  await getDatabase(app).ref('meta').set({ project: p.id, name: p.name, createdAt: Date.now() });
  await getDatabase(app).ref('allowlist').update(Object.fromEntries(EMAILS.map(e => [C.emailKey(e), true])));
  log(`✓ ${p.id} ready: rules, /meta`);
  for (const e of EMAILS) log(`  editor ${C.maskEmail(e)} (${await ensureUser(getAuth(app), e)})`);
}

/* ROLE=staff: a company (@advfacade.com) login only — confirmed, on no list. Staff read the
   overview and every project already; what they lack is a login whose email is confirmed.
   An account made in the Firebase console (or self-made) is NOT confirmed, and the email
   with the link does not always arrive (10-19). This makes or fixes it without any email. */
async function staffMode() {
  if (!EMAILS.length) die('EMAIL is missing');
  const bad = EMAILS.filter(e => !isEmail(e));
  if (bad.length) die(`not an email address: ${bad.map(C.maskEmail).join(', ')} (nothing was changed)`);
  const outside = EMAILS.filter(e => !C.isStaff(e));
  if (outside.length) die(`role "staff" is only for @advfacade.com addresses (${outside.map(C.maskEmail).join(', ')}): add them to a project as editor, viewer or gc instead. Nothing was changed.`);
  const auth = getAuth(appFor(HUB.id, HUB.databaseURL, 'HUB_SERVICE_ACCOUNT'));
  for (const e of EMAILS) log(`✓ ${C.maskEmail(e)}: company login ${await ensureUser(auth, e)} (email confirmed; no list changed).`);
  log('They read the hub overview and use the 🚚 Shop page. A project or design board opens only once they are on its list (10-20). First time: open the hub, enter their email and tap "Forgot password" to set one.');
}

/* ROLE=shop: the people who mark 🚚 To send requests "Sent ✓" (Leo 10-19: only them, on every
   project). A custom claim on the login (shop = true) that every database's rules check, so it
   is one list for all projects, company email or not. PROJECT=shop with ROLE=remove takes it
   away. It reaches a signed-in page within an hour, or at the next sign-in. */
/* ROLE=boss (Leo 10-20: chul, nan): reads every project and every design board, changes
   nothing. Same mechanism as shop: a claim (boss = true) the rules check. */
const CLAIMS = {
  shop: { on: 'is on the shop list (marks 🚚 Sent ✓ on every project)', off: 'is off the shop list (can no longer mark Sent)',
          after: 'Shop page: https://af-hub-two.vercel.app/send/' },
  boss: { on: 'is a boss (reads every project and design board, changes nothing)', off: 'is no longer a boss (sees only the projects whose lists they are on)',
          after: 'Hub: https://af-hub-two.vercel.app/' },
};
async function claimMode(name, on) {
  if (!EMAILS.length) die('EMAIL is missing');
  const bad = EMAILS.filter(e => !isEmail(e));
  if (bad.length) die(`not an email address: ${bad.map(C.maskEmail).join(', ')} (nothing was changed)`);
  const auth = getAuth(appFor(HUB.id, HUB.databaseURL, 'HUB_SERVICE_ACCOUNT'));
  for (const e of EMAILS) {
    let how = 'exists';
    if (on) how = await ensureUser(auth, e);
    let u;
    try { u = await auth.getUserByEmail(e); } catch (er) { log(`  ${C.maskEmail(e)}: no login, nothing to remove`); continue; }
    const claims = Object.assign({}, u.customClaims || {});
    if (on) claims[name] = true; else delete claims[name];
    await auth.setCustomUserClaims(u.uid, claims);
    log(`✓ ${C.maskEmail(e)} ${on ? CLAIMS[name].on + '; login ' + how : CLAIMS[name].off}.`);
  }
  log(on ? 'It works at their next sign-in, or within an hour. ' + CLAIMS[name].after : 'It takes effect at their next sign-in, or within an hour.');
}
const shopMode = on => claimMode('shop', on);

/* PROJECT=design/<board>: one Design Board only (a PM). members/<board>/<key> = editor | viewer.
   The design team (/allowlist) already edits every board; this is for everyone else. */
async function boardMemberMode(board) {
  const d = entry('design');
  if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(board)) die(`"${board}" is not a board id (e.g. design/ac3)`);
  if (!EMAILS.length) die('EMAIL is missing');
  const bad = EMAILS.filter(e => !isEmail(e));
  if (bad.length) die(`not an email address: ${bad.map(C.maskEmail).join(', ')} (nothing was changed)`);
  if (!['editor', 'viewer', 'remove'].includes(ROLE)) die('a board takes ROLE editor, viewer or remove');
  const app = appFor(d.id, d.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const db = getDatabase(app);
  if ((await db.ref('meta/project').once('value')).val() !== 'design') die(`${d.databaseURL} is not the design database`);
  const boards = (await db.ref('boardInfo').once('value')).val() || {};
  if (!boards[board]) die(`no board "${board}". Boards: ${Object.keys(boards).join(', ') || 'none'} (nothing was changed)`);
  const upd = {};
  EMAILS.forEach(e => { upd['members/' + board + '/' + C.emailKey(e)] = ROLE === 'remove' ? null : ROLE; });
  await db.ref().update(upd);
  for (const e of EMAILS) {
    if (ROLE === 'remove') log(`✓ ${C.maskEmail(e)} is off the ${board} board (the design team list and bosses are not changed here).`);
    else log(`✓ ${C.maskEmail(e)} is now ${ROLE} of the ${board} board only; login ${await ensureUser(getAuth(app), e)}.`);
  }
  if (ROLE !== 'remove') log(`They open https://af-hub-two.vercel.app/design/#b=${board} and sign in with their hub account.`);
}

/* ROLE=list: who is on this project's lists, emails masked (the log is public), and the
   company logins that will see nothing of it. */
async function listMode() {
  const p = entry(PID);
  if (p === HUB) die('list: pick a project (ac3, cp2, lex, mn, design)');
  const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const db = getDatabase(app);
  const keys = async n => Object.keys((await db.ref(n).once('value')).val() || {}).map(C.keyEmail);
  const seen = new Set();
  for (const [n, label] of [['allowlist', 'editors'], ['gcList', 'GC'], ['viewers', 'viewers']]) {
    const l = await keys(n); l.forEach(e => seen.add(e.toLowerCase()));
    if (l.length || n !== 'gcList') log(`${label} (${l.length}): ${l.map(C.maskEmail).join(', ') || '—'}`);
  }
  if (p.id === 'design') {
    const m = (await db.ref('members').once('value')).val() || {};
    Object.entries(m).forEach(([b, v]) => log(`board ${b}: ` + Object.entries(v).map(([k, r]) => `${C.maskEmail(C.keyEmail(k))} ${r}`).join(', ')));
  }
  const special = [], none = [];
  let page;
  do {
    page = await getAuth(app).listUsers(1000, page && page.pageToken);
    page.users.forEach(u => {
      const e = String(u.email || '').toLowerCase(), c = u.customClaims || {};
      if (c.boss || c.shop) special.push(`${C.maskEmail(e)} ${[c.boss && 'boss', c.shop && 'shop'].filter(Boolean).join('+')}`);
      else if (C.isStaff(e) && !seen.has(e)) none.push(C.maskEmail(e));
    });
  } while (page.pageToken);
  log(`read everything by claim (${special.length}): ${special.join(', ') || '—'}`);
  log(`company logins that see nothing of ${p.id} (${none.length}): ${none.join(', ') || '—'}`);
}

async function memberMode() {
  if (ROLE === 'list') return listMode();
  if (PID.startsWith('design/')) return boardMemberMode(PID.slice(7));
  if (ROLE === 'boss') return claimMode('boss', true);
  if (ROLE === 'remove' && PID === 'boss') return claimMode('boss', false);

  if (ROLE === 'staff') return staffMode();
  if (ROLE === 'shop') return shopMode(true);
  if (ROLE === 'remove' && PID === 'shop') return shopMode(false);
  const p = entry(PID);
  if (!EMAILS.length) die('EMAIL is missing');
  const bad = EMAILS.filter(e => !isEmail(e));
  if (bad.length) die(`not an email address: ${bad.map(C.maskEmail).join(', ')} (nothing was changed)`);
  const node = { editor: 'allowlist', gc: 'gcList', viewer: 'viewers' }[ROLE];
  if (!node && ROLE !== 'remove') die('ROLE must be editor, gc, viewer, staff, shop, boss, list or remove');
  if (p.rules && ROLE === 'gc') die(`"${p.id}" has no GC list: use editor or viewer`);
  const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const meta = (await getDatabase(app).ref('meta/project').once('value')).val();
  if (meta !== p.id) die(`${p.databaseURL} is not set up as "${p.id}" (meta: ${meta})`);
  const upd = {};
  for (const e of EMAILS) {
    const k = C.emailKey(e);
    Object.assign(upd, { ['allowlist/' + k]: null, ['gcList/' + k]: null, ['viewers/' + k]: null });
    if (node) upd[node + '/' + k] = true;
  }
  await getDatabase(app).ref().update(upd);
  for (const e of EMAILS) {
    if (node) log(`✓ ${C.maskEmail(e)} is now ${ROLE} on ${p.id}; login ${await ensureUser(getAuth(app), e)}.`);
    else log(`✓ ${C.maskEmail(e)} removed from every list on ${p.id} (their login stays; it opens nothing here now)`);
  }
  if (node) log(`They open the ${p.rules ? 'page (/' + p.folder + '/)' : 'tracker'}, enter their email and tap "First time here" to set a password.`);
}

(async () => {
  if (!PID) die('PROJECT is required');
  if (MODE === 'dry-run') await dryRunOrMigrate(true);
  else if (MODE === 'migrate') await dryRunOrMigrate(false);
  else if (MODE === 'rules') await rulesMode();
  else if (MODE === 'init') await initMode();
  else if (MODE === 'member') await memberMode();
  else die(`unknown MODE "${MODE}"`);
  await Promise.all(getApps().map(a => deleteApp(a)));
})().catch(e => die(e.stack || e.message));
