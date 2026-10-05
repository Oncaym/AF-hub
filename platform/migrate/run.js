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
   MODE=init      Start an empty database for a NEW project: rules + /meta +
                  EMAIL as its first editor.
   MODE=member    Add EMAIL to the project as ROLE (editor | gc | viewer), or
                  ROLE=remove to take them off every list. Creates the login if
                  it does not exist, so they only need "First time here".

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
function entry(id) {
  const p = REG.projects.find(x => x.id === id);
  if (!p) die(`PROJECT "${id}" is not in platform/projects.json (have: ${REG.projects.map(x => x.id).join(', ')})`);
  return p;
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
  report.skipped.forEach(k => log(`  ${k.padEnd(10)} → skip (live-only)`));
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

async function rulesMode() {
  const ids = PID === 'all' ? REG.projects.map(x => x.id) : [PID];
  for (const id of ids) {
    const p = entry(id);
    const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
    const meta = (await getDatabase(app).ref('meta/project').once('value')).val();
    if (meta && meta !== p.id) die(`${p.databaseURL} says it belongs to "${meta}", not "${p.id}"`);
    await putRules(app, RULES);
    log(`✓ rules put on ${p.id} (${p.databaseURL})${meta ? '' : ' — note: no /meta yet, so no page can save there'}`);
  }
}

async function initMode() {
  const p = entry(PID);
  if (!EMAIL) die('EMAIL (the first editor) is required for init');
  const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const root = await readRoot(app);
  if (root && Object.keys(root).length && !FORCE) die(`the database already has data (${Object.keys(root).join(', ')})`);
  await putRules(app, RULES);
  await getDatabase(app).ref('meta').set({ project: p.id, name: p.name, createdAt: Date.now() });
  await getDatabase(app).ref('allowlist/' + C.emailKey(EMAIL)).set(true);
  log(`✓ ${p.id} ready: rules, /meta, editor ${C.maskEmail(EMAIL)} (${await ensureUser(getAuth(app), EMAIL)})`);
}

async function memberMode() {
  const p = entry(PID);
  if (!EMAIL || !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(EMAIL)) die('EMAIL is missing or not an email address');
  const node = { editor: 'allowlist', gc: 'gcList', viewer: 'viewers' }[ROLE];
  if (!node && ROLE !== 'remove') die('ROLE must be editor, gc, viewer or remove');
  const app = appFor(p.id, p.databaseURL, 'HUB_SERVICE_ACCOUNT');
  const meta = (await getDatabase(app).ref('meta/project').once('value')).val();
  if (meta !== p.id) die(`${p.databaseURL} is not set up as "${p.id}" (meta: ${meta})`);
  const k = C.emailKey(EMAIL);
  const upd = { ['allowlist/' + k]: null, ['gcList/' + k]: null, ['viewers/' + k]: null };
  if (node) upd[node + '/' + k] = true;
  await getDatabase(app).ref().update(upd);
  if (node) log(`✓ ${C.maskEmail(EMAIL)} is now ${ROLE} on ${p.id}; login ${await ensureUser(getAuth(app), EMAIL)}. ` +
                `They open the tracker, enter their email and tap "First time here" to set a password.`);
  else log(`✓ ${C.maskEmail(EMAIL)} removed from every list on ${p.id} (their login stays; it opens nothing here now)`);
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
