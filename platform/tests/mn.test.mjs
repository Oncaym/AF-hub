#!/usr/bin/env node
/* Morgan North (Benji's page hosted in the hub):
   - mn/build.mjs adds only the hub's three script lines, strips Netlify's additions,
     is idempotent, and refuses a page that no longer looks like the tracker;
   - platform/mn-database.rules.json: who reads, who changes /units and /plan.
     node platform/tests/mn.test.mjs */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..', '..');
const { build } = await import(path.join(ROOT, 'mn', 'build.mjs'));
const targaryen = require('targaryen');

let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (x !== undefined ? '  :: ' + JSON.stringify(x).slice(0, 300) : '')); } };

/* ---------- build ---------- */
const src = fs.readFileSync(path.join(here, 'fixtures', 'mn-standin.html'), 'utf8');
const r = build(src, { minSize: 0, adapter: '// adapter v1' });
const h = r.html;
ok(!/hosted on Netlify/.test(h) && !/\.netlify\/scripts/.test(h) && !/hosting-provider/.test(h), 'Netlify\'s comment, meta tags and HUD script are gone', r.removed);
const db = h.indexOf('firebase-database-compat.js'), auth = h.indexOf('firebase-auth-compat.js'), cfg = h.indexOf('src="../af-hub-config.js"'), ad = h.indexOf('src="hub-adapter.js?v=');
ok(db > 0 && auth > db && cfg > auth && ad > cfg, 'after the database SDK: auth SDK, ../af-hub-config.js, hub-adapter.js (in that order)');
ok(/firebasejs\/10\.12\.0\/firebase-auth-compat\.js/.test(h), 'the auth SDK has the same version as the page\'s own SDK');
ok(/<script defer src="hub-adapter\.js\?v=[0-9a-f]{8}"><\/script>/.test(h), 'the adapter is deferred and cache-busted by its content');
const strip = s => s.replace(/\n?<!-- AF hub \(mn\/build\.mjs\)[\s\S]*?<!-- \/AF hub -->/g, '');
const bare = src.replace(/\n?<!--\s*This site is hosted on Netlify[\s\S]*?-->/g, '').replace(/\n?<meta name="hosting-provider"[^>]*>/g, '').replace(/\n?<script\b[^>]*src="\/\.netlify\/scripts\/[^"]*"[^>]*><\/script>/g, '');
ok(strip(h) === bare, 'nothing else in Benji\'s page changes');
ok(build(h, { minSize: 0, adapter: '// adapter v1' }).html === h, 'building a built page gives the same page');
ok(build(h, { minSize: 0, adapter: '// adapter v2' }).html !== h, 'a new adapter gives a new ?v=');
const refuse = (s, what) => { try { build(s, { minSize: 0, adapter: '' }); return false; } catch (e) { return new RegExp(what).test(e.message); } };
ok(refuse(src.replace(/FIREBASE_CONFIG=/, 'X='), 'no FIREBASE_CONFIG'), 'refuses a page without FIREBASE_CONFIG');
ok(refuse(src.replace(/function fbBoot/, 'function boot'), 'no fbBoot'), 'refuses a page without fbBoot()');
ok(refuse(src.replace(/firebase-database-compat/, 'firebase-firestore-compat'), 'database-compat'), 'refuses a page without the database SDK tag');
ok(refuse('<html>Not found</html>'), 'refuses an error page');
ok(refuse(src.replace("fbDB.ref('plan').set(", "fbDB.ref('photos').set("), 'photos'), 'refuses a page that saves to a path the rules do not allow');
ok(refuse(src.replace("SYNC_FIELDS=['status','date','crew','notes']", "SYNC_FIELDS=['status','date','crew','notes','before']"), 'before'), 'refuses a page that saves a new per-pane field');
try { build(src, { adapter: '' }); ok(false, 'refuses a tiny page by default (an error page)'); } catch (e) { ok(/size/.test(e.message), 'refuses a tiny page by default (an error page)'); }

/* ---------- rules ---------- */
const rules = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'mn-database.rules.json'), 'utf8').split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const key = e => e.replace(/\./g, ',');
const who = (email, verified = true) => ({ uid: 'u_' + email.replace(/\W/g, '_'), provider: 'password', token: { email, email_verified: verified, firebase: { sign_in_provider: 'password' } } });
const EDITOR = who('benji.lee@gmail.com'), LEO = who('leosun@advfacade.com'), STAFF = who('boss@advfacade.com'), VIEWER = who('owner@client.com'),
  GC = who('pm@gc.com'), STRANGER = who('x@gmail.com'), FAKE = who('fake@advfacade.com', false);
const ANON = { uid: 'anon', provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } };
const DATA = {
  meta: { project: 'mn', name: 'Morgan North' },
  allowlist: { [key('benji.lee@gmail.com')]: true, [key('leosun@advfacade.com')]: true },
  viewers: { [key('owner@client.com')]: true }, gcList: { [key('pm@gc.com')]: true },
  units: { '10-1~35~1': { status: 'replaced', date: '2026-10-01', crew: 'A', notes: '' } },
  plan: { rev: 3, windows: [{ id: '10-1', replace: [1, 2] }] },
};
const as = a => targaryen.database(rules, DATA, 1790000000000).as(a);
const pane = { status: 'sealant', date: '2026-10-19', crew: 'B', notes: 'east' };
for (const [n, a, want] of [['editor', EDITOR, true], ['staff', STAFF, true], ['viewer', VIEWER, true], ['GC', GC, true], ['stranger', STRANGER, false], ['unverified', FAKE, false], ['anonymous', ANON, false]]) {
  ok(as(a).read('/units').allowed === want && as(a).read('/plan').allowed === want, `${n} ${want ? 'reads' : 'cannot read'} units and plan`);
}
ok(as(EDITOR).update('/units', { '10-1~35~2': pane }).allowed, 'an editor logs a pane (update, as the page does)');
ok(as(EDITOR).update('/units', { '10-1~35~1': null }).allowed, 'an editor resets a pane to original (removed)');
ok(!as(STAFF).update('/units', { '10-1~35~2': pane }).allowed, 'staff (not on the list) cannot change it');
ok(!as(VIEWER).update('/units', { '10-1~35~2': pane }).allowed, 'a viewer cannot change it');
ok(!as(GC).update('/units', { '10-1~35~2': pane }).allowed, 'the GC cannot change it');
ok(!as(EDITOR).update('/units', { '10-1~35~2': Object.assign({ photo: 'data:...' }, pane) }).allowed, 'an unknown field is refused (photos are not in the database)');
ok(!as(EDITOR).update('/units', { '10-1~35~2': { date: '2026-10-19' } }).allowed, 'a pane without a status is refused');
ok(!as(EDITOR).update('/units', { '10-1~35~2': Object.assign({}, pane, { notes: 'x'.repeat(2001) }) }).allowed, 'notes over 2000 characters are refused');
ok(as(EDITOR).write('/plan', { rev: 4, building: 'Morgan North', windows: [{ id: '10-1', replace: [1] }] }).allowed, 'an editor publishes the plan');
ok(!as(EDITOR).write('/plan', null).allowed, 'the plan cannot be deleted from a page');
ok(!as(EDITOR).write('/plan', { rev: 4 }).allowed, 'a plan without windows is refused');
ok(!as(VIEWER).write('/plan', { rev: 4, windows: [] }).allowed, 'a viewer cannot publish the plan');
ok(!as(EDITOR).write('/meta/project', 'ac3').allowed, 'no page can change /meta');
ok(as(LEO).write('/toSend/t1', { what: 'GL-4 IGU', by: 'leosun@advfacade.com', at: 1, _project: 'mn' }).allowed, '🚚 To send works here too (stamped mn)');
ok(!as(LEO).write('/toSend/t1', { what: 'GL-4 IGU', by: 'leosun@advfacade.com', at: 1, _project: 'ac3' }).allowed, '… and refuses another project\'s stamp');
ok(!as(EDITOR).write('/somethingElse', 1).allowed, 'nothing else can be written');
const SHOP = who('shop.lead@gmail.com'); SHOP.token.shop = true;
const withAsk = targaryen.database(rules, Object.assign({}, DATA, { toSend: { t1: { what: 'GL-4', by: 'leosun@advfacade.com', at: 1, _project: 'mn' } } }), 1790000000000);
ok(withAsk.as(SHOP).write('/toSend/t1/sent', { by: 'shop.lead@gmail.com', at: 2 }).allowed && !withAsk.as(LEO).write('/toSend/t1/sent', { by: 'leosun@advfacade.com', at: 2 }).allowed,
   'only the shop list marks a Morgan North request sent');

console.log(`morgan north: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
