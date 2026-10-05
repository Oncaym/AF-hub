/* The migration tool (platform/migrate/run.js) against the Firebase emulators:
   a fake "old AC3" database and bucket are moved into a fake project database,
   then every safety stop is tried. Runs in CI (platform-tests.yml). */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { initializeApp, deleteApp, getApps } = require('firebase-admin/app');
const { getDatabase } = require('firebase-admin/database');
const { getStorage } = require('firebase-admin/storage');
const { getAuth } = require('firebase-admin/auth');
const here = path.dirname(fileURLToPath(import.meta.url));
const RUN = path.join(here, '..', 'migrate', 'run.js');
const RULES = fs.readFileSync(path.join(here, '..', 'project-database.rules.json'), 'utf8');
const DBH = process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000';
const url = ns => `http://${DBH}/?ns=${ns}`;
const URLS = { legacy: url('legacy-ac3'), ac3: url('af-hub-8f188-ac3'), lex: url('af-hub-8f188-lex') };
const OLD_BUCKET = 'atlantic-chestnut-3.firebasestorage.app';
const HUB_BUCKET = 'af-hub-8f188.firebasestorage.app';

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) { pass++; console.log('  ✓ ' + m); } else { fail++; console.log('  ✗ ' + m + (x ? '\n      ' + x : '')); } };
const app = (name, u) => initializeApp({ projectId: 'demo-afhub', databaseURL: u, storageBucket: OLD_BUCKET }, name);
const legacy = app('t-legacy', URLS.legacy), ac3 = app('t-ac3', URLS.ac3), lex = app('t-lex', URLS.lex);
const read = async (a, p) => (await getDatabase(a).ref(p).once('value')).val();
const rulesOf = async ns => (await fetch(`http://${DBH}/.settings/rules.json?ns=${ns}`, { headers: { Authorization: 'Bearer owner' } })).text();
function run(env) {
  const r = spawnSync(process.execPath, [RUN], { encoding: 'utf8',
    env: Object.assign({}, process.env, { EMULATOR_DB_URLS: JSON.stringify(URLS), GITHUB_EVENT_PATH: '' }, env) });
  return { code: r.status, out: (r.stdout || '') + (r.stderr || '') };
}

(async () => {
  console.log('migration tool (emulators)');
  // ---- an "old AC3": data, a photo in the old bucket, membership ----
  const file = getStorage(legacy).bucket(OLD_BUCKET).file('cp2-photos/1_door.jpg');
  await file.save(Buffer.from('fake-jpeg'), { contentType: 'image/jpeg', metadata: { metadata: { firebaseStorageDownloadTokens: 'oldtok' } } });
  const oldUrl = `https://firebasestorage.googleapis.com/v0/b/${OLD_BUCKET}/o/${encodeURIComponent('cp2-photos/1_door.jpg')}?alt=media&token=oldtok`;
  const OLD = {
    state: { _clientId: 'c', _ts: 1, _by: 'leo.sun@advfacade.com', updatedAt: '2026-09-30',
             units: [{ key: 'SF01', status: 'installed' }, { key: 'SF02', status: 'pending' }],
             log: [{ date: '2026-09-29', content: 'doors late', photos: [oldUrl] }],
             submittals: [{ id: 'S-1', title: 'Shop drawings', status: 'approved' }] },
    history: { h1: { ts: 1, user: 'leo.sun@advfacade.com', desc: 'x' } },
    presence: { u1: { email: 'x@y.com', since: 1 } },
    allowlist: { 'leo,sun@advfacade,com': true, 'joe,foreman@gmail,com': true },
    gcList: { 'pm@turner,com': true },
  };
  await fetch(`http://${DBH}/.settings/rules.json?ns=legacy-ac3`, { method: 'PUT', headers: { Authorization: 'Bearer owner' }, body: '{"rules":{".read":"auth != null",".write":"auth != null"}}' });
  await getDatabase(legacy).ref('/').set(OLD);
  await getDatabase(ac3).ref('/').set(null);
  await getDatabase(lex).ref('/').set({ meta: { project: 'lex' } });

  console.log('\n1. dry run writes nothing');
  let r = run({ MODE: 'dry-run', PROJECT: 'ac3' });
  ok(r.code === 0, 'dry run succeeds', r.out.slice(-600));
  ok(/state\s+.*→ copy/.test(r.out) && /presence\s+→ skip/.test(r.out), 'it lists what would be copied and skipped');
  ok(/2 units \(1 installed\)/.test(r.out) && /1 submittals/.test(r.out), 'it counts units and submittals');
  ok(!/leo\.sun@advfacade\.com|joe\.foreman@gmail\.com/.test(r.out), 'no full email address in the log', r.out.match(/\S+@\S+/g));
  ok((await read(ac3, '/')) === null, 'the new database is still empty');
  ok(/"\.write":\s*"auth != null"/.test(await rulesOf('legacy-ac3')), 'the old database is not frozen');

  console.log('\n2. migrate');
  r = run({ MODE: 'migrate', PROJECT: 'ac3' });
  ok(r.code === 0, 'migration succeeds', r.out.slice(-1500));
  ok(/VERIFIED/.test(r.out), 'it reads everything back and it matches');
  ok((await read(ac3, 'meta/project')) === 'ac3', '/meta/project = "ac3"');
  ok((await read(ac3, 'state/_project')) === 'ac3', 'state stamped "ac3"');
  ok((await read(ac3, 'state/units/0/status')) === 'installed' && (await read(ac3, 'state/submittals/0/title')) === 'Shop drawings', 'units and submittals arrived');
  ok((await read(ac3, 'history/h1/desc')) === 'x', 'history arrived');
  ok((await read(ac3, 'presence')) === null, 'presence was not copied');
  ok((await read(ac3, 'allowlist/joe,foreman@gmail,com')) === true && (await read(ac3, 'gcList/pm@turner,com')) === true, 'membership arrived');
  const newUrl = await read(ac3, 'state/log/0/photos/0');
  ok(typeof newUrl === 'string' && newUrl.includes('/b/' + HUB_BUCKET + '/') && newUrl.includes(encodeURIComponent('p/ac3/legacy/cp2-photos/1_door.jpg')), 'the photo URL points at the copy in the hub bucket', newUrl);
  const [exists] = await getStorage(ac3).bucket(HUB_BUCKET).file('p/ac3/legacy/cp2-photos/1_door.jpg').exists();
  ok(exists, 'the photo was copied');
  const [stillOld] = await file.exists();
  ok(stillOld, 'the old photo is left where it was');
  ok((await rulesOf('af-hub-8f188-ac3')).replace(/\s/g, '') === RULES.replace(/\s/g, ''), 'the new database has the project rules');
  ok(/"\.write":\s*false/.test(await rulesOf('legacy-ac3')) && /"\.read":\s*false/.test(await rulesOf('legacy-ac3')), 'the old database is frozen');
  const auth = getAuth(initializeApp({ projectId: 'demo-afhub' }, 't-auth'));
  for (const e of ['leo.sun@advfacade.com', 'joe.foreman@gmail.com', 'pm@turner.com']) {
    let u = null; try { u = await auth.getUserByEmail(e); } catch (x) {}
    ok(u && u.emailVerified, `login exists and is verified for ${e[0]}***`);
  }
  ok((await read(legacy, 'state/units/0/status')) === 'installed', 'the old data is still there (nothing deleted)');

  console.log('\n3. safety stops');
  r = run({ MODE: 'migrate', PROJECT: 'ac3' });
  ok(r.code !== 0 && /already has data/.test(r.out), 'a second migration refuses to overwrite');
  await getDatabase(ac3).ref('state/units/1/status').set('issue');
  r = run({ MODE: 'migrate', PROJECT: 'ac3', FORCE: '1' });
  ok(r.code === 0 && (await read(ac3, 'state/units/1/status')) === 'pending', 'with force it replaces the data from the old database');
  r = run({ MODE: 'init', PROJECT: 'lex', EMAIL: 'leo.sun@advfacade.com', FORCE: '1' });
  ok(r.code === 0, 'init on lex (force)', r.out.slice(-400));
  await getDatabase(lex).ref('meta/project').set('ac3');
  r = run({ MODE: 'rules', PROJECT: 'lex' });
  ok(r.code !== 0 && /belongs to "ac3"/.test(r.out), 'a database that says it is another project is refused');
  await getDatabase(lex).ref('meta/project').set('lex');

  console.log('\n4. members');
  r = run({ MODE: 'member', PROJECT: 'ac3', EMAIL: 'Owner.Rep@Client.com', ROLE: 'viewer' });
  ok(r.code === 0 && (await read(ac3, 'viewers/owner,rep@client,com')) === true, 'add a viewer (address lower-cased)', r.out.slice(-300));
  r = run({ MODE: 'member', PROJECT: 'ac3', EMAIL: 'owner.rep@client.com', ROLE: 'editor' });
  ok((await read(ac3, 'viewers/owner,rep@client,com')) === null && (await read(ac3, 'allowlist/owner,rep@client,com')) === true, 'changing role moves them between lists');
  r = run({ MODE: 'member', PROJECT: 'ac3', EMAIL: 'owner.rep@client.com', ROLE: 'remove' });
  ok((await read(ac3, 'allowlist/owner,rep@client,com')) === null, 'remove takes them off');
  r = run({ MODE: 'member', PROJECT: 'ac3', EMAIL: 'not-an-email', ROLE: 'viewer' });
  ok(r.code !== 0, 'a bad address is refused');

  await Promise.all(getApps().map(a => deleteApp(a)));
  console.log(`\nmigration tool: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})().catch(e => { console.error(e); process.exit(1); });
