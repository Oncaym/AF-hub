#!/usr/bin/env node
/* Static checks that keep projects apart, run on every push (no Firebase needed):

   - each project folder's firebase-config.js points at ITS database (from
     platform/projects.json) and its project-config.js says the same project id;
   - no two projects share a database;
   - every page that saves /state stamps _project (the rules refuse it otherwise);
   - project pages load the shared engine from /core, not a stale local copy;
   - files are stored under p/<project>/ in the shared bucket;
   - the hourly report reads each project from the right database.

     node platform/tests/config.test.cjs
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..', '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'projects.json'), 'utf8'));
const REPORT = JSON.parse(fs.readFileSync(path.join(ROOT, 'report', 'projects.json'), 'utf8'));

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + msg); } };
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const exists = f => fs.existsSync(path.join(ROOT, f));
function run(files) {
  const g = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(g); g.window = g;
  files.forEach(f => vm.runInContext(read(f), g, { filename: f }));
  return g;
}

const ids = REG.projects.map(p => p.id);
ok(new Set(ids).size === ids.length, 'project ids are unique');
const urls = REG.projects.map(p => p.databaseURL);
ok(new Set(urls).size === urls.length, 'each project has its own database');
ok(!urls.some(u => /default-rtdb/.test(u)), 'no project uses the hub\'s default database');

const SHARED_PAGES = ['chat.html', 'warehouse.html', 'recover.html'];
const firstCopy = {};

for (const p of REG.projects) {
  const F = p.folder;
  ok(exists(F + '/index.html'), `${F}/index.html exists`);
  const g = run([F + '/firebase-config.js', F + '/project-config.js']);
  const fc = g.FIREBASE_CONFIG || {}, P = g.PROJECT || {};
  ok(fc.databaseURL === p.databaseURL, `${F}/firebase-config.js databaseURL is ${p.databaseURL} (got ${fc.databaseURL})`);
  ok(fc.projectId === REG.firebaseProject, `${F}/firebase-config.js is the ${REG.firebaseProject} Firebase project (got ${fc.projectId})`);
  ok(fc.storageBucket === REG.storageBucket, `${F}/firebase-config.js uses the shared bucket`);
  ok(!fc.authEmulatorUrl, `${F}/firebase-config.js has no emulator setting`);
  ok(P.hubId === p.id, `${F}/project-config.js hubId is "${p.id}" (got "${P.hubId}")`);
  ok(P.storageKey && !REG.projects.some(o => o !== p && exists(o.folder + '/project-config.js') &&
     run([o.folder + '/project-config.js']).PROJECT.storageKey === P.storageKey), `${F} has its own localStorage key`);

  const html = read(F + '/index.html');
  for (const core of ['cloud-sync.js', 'app-log.js', 'app.js'])
    ok(new RegExp(`src="\\.\\./core/${core.replace('.', '\\.')}`).test(html), `${F}/index.html loads ../core/${core}`);
  for (const core of ['cloud-sync.js', 'app-log.js', 'app.js'])
    ok(!exists(F + '/' + core), `${F}/${core} must not exist (the engine lives in /core)`);
  ok(/src="firebase-config\.js/.test(html) && /src="project-config\.js/.test(html), `${F}/index.html loads its own two config files`);
  ok(!/href="\/(?!\/)/.test(html), `${F}/index.html has no site-root links (they would leave the project)`);
  ok(!/af-hub-two\.vercel\.app/.test(html), `${F}/index.html loads hub files from the same site`);

  for (const page of SHARED_PAGES) {
    if (!exists(F + '/' + page)) { ok(false, `${F}/${page} exists`); continue; }
    const s = read(F + '/' + page);
    ok(/src="project-config\.js"/.test(s), `${F}/${page} loads project-config.js (it stamps saves with the project id)`);
    if (firstCopy[page] === undefined) firstCopy[page] = { F, s };
    else ok(firstCopy[page].s === s, `${F}/${page} is identical to ${firstCopy[page].F}/${page} (copy the newer one over)`);
  }

  // Every file in the folder that saves the whole state must stamp _project.
  for (const f of fs.readdirSync(path.join(ROOT, F))) {
    if (!/\.(html|js)$/.test(f)) continue;
    const s = read(F + '/' + f);
    if (/ref\(\s*["']state["']\s*\)\.set\(/.test(s)) ok(/_project\s*:/.test(s), `${F}/${f} saves /state with _project`);
    ok(!/cp2-photos\/|[Ss]torage(\(\))?\.ref\(\s*["'`](?!p\/)/.test(s), `${F}/${f} stores files under p/<project>/`);
  }

  const rp = REPORT.find(x => x.id === p.id);
  ok(!!rp, `report/projects.json lists ${p.id}`);
  if (rp) {
    ok(rp.databaseURL === p.databaseURL, `report reads ${p.id} from ${p.databaseURL}`);
    ok(rp.url === `https://af-hub-two.vercel.app/${F}/`, `report links ${p.id} to /${F}/`);
    ok(rp.secret === 'HUB_SERVICE_ACCOUNT', `report reads ${p.id} with the hub service account`);
  }
}

// The engine stamps and checks the project.
const cs = read('core/cloud-sync.js');
ok(/_project:\s*\(window\.PROJECT \|\| \{\}\)\.hubId/.test(cs), 'core/cloud-sync.js stamps _project on every save');
ok(/meta\/project/.test(cs) && /if \(!projectOk\) return;/.test(cs), 'core/cloud-sync.js checks /meta/project and never pushes before it matched');
ok(/p\/\$\{pid\}\/photos\//.test(read('core/app.js')), 'core/app.js stores photos under p/<project>/photos/');

// The takeoff tool's project picker lists every project, and only ids that have a database.
{
  const m = read('takeoff/app.js').match(/const HUB_PROJECTS = \[([\s\S]*?)\];/);
  const ids = m ? [...m[1].matchAll(/id:\s*'([^']+)'/g)].map(x => x[1]).sort() : [];
  ok(JSON.stringify(ids) === JSON.stringify(REG.projects.map(p => p.id).sort()), `takeoff/app.js HUB_PROJECTS (${ids}) matches platform/projects.json`);
}

console.log(`config: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
