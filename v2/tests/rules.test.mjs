/* Database rules for /v2 — run against the emulator by .github/workflows/v2-rules.yml.
   Every case is a claim about who may do what; a failing case means the rules changed
   meaning, and nothing is published until it passes. */
import { readFileSync } from 'node:fs';
import { initializeTestEnvironment, assertFails, assertSucceeds } from '@firebase/rules-unit-testing';
import { ref, get, set, update } from 'firebase/database';

const rules = readFileSync(new URL('../../firebase-database-rules.json', import.meta.url), 'utf8');
const env = await initializeTestEnvironment({ projectId: 'demo-afv2', database: { rules, host: '127.0.0.1', port: 9000 } });

const pw = (uid, email, extra = {}) => env.authenticatedContext(uid, { email, email_verified: false, firebase: { sign_in_provider: 'password' }, ...extra });
const linked = (uid, email) => env.authenticatedContext(uid, { email, email_verified: true, firebase: { sign_in_provider: 'emailLink' } });
const anon = () => env.authenticatedContext('anon1', { firebase: { sign_in_provider: 'anonymous' } });
const db = ctx => ctx.database();
const now = () => Date.now() - 1000;
const stage = uid => ({ d: '2026-10-05', t: now(), by: uid });

let pass = 0, fail = 0;
async function check(name, fn) {
  try { await fn(); pass++; console.log('PASS ', name); }
  catch (e) { fail++; console.log('FAIL ', name, '—', e.message); }
}

async function reset(withAdmin = true) {
  await env.clearDatabase();
  await env.withSecurityRulesDisabled(async ctx => {
    await set(ref(ctx.database()), {
      v2: {
        ...(withAdmin ? { admins: { leo: true } } : {}),
        staff: { boss: 'exec' },
        index: { lex: { name: 'Lex' }, ac3: { name: 'AC3' } },
        members: {
          lex: { pm1: { role: 'pm' }, ed1: { role: 'editor' }, fm1: { role: 'field' }, vw1: { role: 'viewer' }, gc1: { role: 'gc' } },
          ac3: { fm2: { role: 'field' } }
        },
        my: { fm1: { lex: 'field' } },
        invitesByEmail: { 'new,guy@gmail,com': { lex: 'field' } },
        p: {
          lex: { meta: { name: 'Lex' }, items: { SD1: { label: 'SD-1', scope: 'shower' }, GR1: { label: 'GR-1', scope: 'guardrail', qty: { n: 10 } } } },
          ac3: { meta: { name: 'AC3' }, items: { SF01: { label: 'SF01', scope: 'frame' } } }
        },
        changes: { lex: { c0: { t: 1, by: 'fm1', iid: 'SD1', f: 'st.site' } } }
      },
      projects: { cp2: { summary: { name: 'CP2', done: 1, total: 2, ts: 1 } } }
    });
  });
}

await reset();

// ── who can read ────────────────────────────────────────────────────────────
await check('anonymous cannot read v2 items', () => assertFails(get(ref(db(anon()), 'v2/p/lex/items'))));
await check('field reads own project items', () => assertSucceeds(get(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items'))));
await check('field cannot read another project', () => assertFails(get(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/ac3/items'))));
await check('viewer reads items', () => assertSucceeds(get(ref(db(pw('vw1', 'vw1@x.com')), 'v2/p/lex/items'))));
await check('gc reads meta', () => assertSucceeds(get(ref(db(pw('gc1', 'gc@turner.com')), 'v2/p/lex/meta'))));
await check('gc cannot read items', () => assertFails(get(ref(db(pw('gc1', 'gc@turner.com')), 'v2/p/lex/items'))));
await check('gc cannot read issues', () => assertFails(get(ref(db(pw('gc1', 'gc@turner.com')), 'v2/p/lex/issues'))));
await check('gc cannot read history', () => assertFails(get(ref(db(pw('gc1', 'gc@turner.com')), 'v2/changes/lex'))));
await check('exec reads every project', async () => {
  await assertSucceeds(get(ref(db(pw('boss', 'boss@x.com')), 'v2/p/lex/items')));
  await assertSucceeds(get(ref(db(pw('boss', 'boss@x.com')), 'v2/p/ac3/items')));
  await assertSucceeds(get(ref(db(pw('boss', 'boss@x.com')), 'v2/index')));
});
await check('non-member reads nothing', () => assertFails(get(ref(db(pw('nobody', 'n@x.com')), 'v2/p/lex/meta'))));
await check('index is admin/exec only', () => assertFails(get(ref(db(pw('fm1', 'fm1@x.com')), 'v2/index'))));
await check('a person reads only their own project list', async () => {
  await assertSucceeds(get(ref(db(pw('fm1', 'fm1@x.com')), 'v2/my/fm1')));
  await assertFails(get(ref(db(pw('fm1', 'fm1@x.com')), 'v2/my/pm1')));
});

// ── marking stages ──────────────────────────────────────────────────────────
await check('field marks installed with change record (one update)', () => assertSucceeds(update(ref(db(pw('fm1', 'fm1@x.com'))), {
  'v2/p/lex/items/SD1/st/installed': stage('fm1'),
  'v2/changes/lex/c1': { t: now(), by: 'fm1', iid: 'SD1', f: 'st.installed', from: null, to: '2026-10-05' }
})));
await check('field clears a stage', () => assertSucceeds(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/SD1/st/installed'), null)));
await check('field cannot mark in another project', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/ac3/items/SF01/st/installed'), stage('fm1'))));
await check('field cannot edit an item itself', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/SD1/label'), 'X')));
await check('editor edits an item', () => assertSucceeds(set(ref(db(pw('ed1', 'ed1@x.com')), 'v2/p/lex/items/SD1/note'), 'fixed')));
await check('viewer cannot mark', () => assertFails(set(ref(db(pw('vw1', 'vw1@x.com')), 'v2/p/lex/items/SD1/st/site'), stage('vw1'))));
await check('stamp must carry the writer', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/SD1/st/site'), stage('ed1'))));
await check('date must be YYYY-MM-DD', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/SD1/st/site'), { ...stage('fm1'), d: '10/5/2026' })));
await check('unknown stage rejected', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/SD1/st/painted'), stage('fm1'))));
await check('count within 0..n', async () => {
  await assertSucceeds(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/GR1/qd'), 4));
  await assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/items/GR1/qd'), 11));
});
await check('anonymous cannot mark', () => assertFails(set(ref(db(anon()), 'v2/p/lex/items/SD1/st/site'), stage('anon1'))));

// ── issues and history ──────────────────────────────────────────────────────
await check('field raises an issue', () => assertSucceeds(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/p/lex/issues/SD1'), { text: 'chipped', t: now(), by: 'fm1', open: true })));
await check('history is append-only', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/changes/lex/c0'), { t: now(), by: 'fm1', iid: 'SD1', f: 'x' })));
await check('history line must be your own', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/changes/lex/c9'), { t: now(), by: 'ed1', iid: 'SD1', f: 'x' })));
await check('admin cannot rewrite history either', () => assertFails(set(ref(db(pw('leo', 'leosun@advfacade.com')), 'v2/changes/lex/c0'), null)));

// ── people ──────────────────────────────────────────────────────────────────
await check('pm invites to own project', () => assertSucceeds(set(ref(db(pw('pm1', 'pm1@x.com')), 'v2/invitesByEmail/a,b@x,com/lex'), 'field')));
await check('pm cannot invite to another project', () => assertFails(set(ref(db(pw('pm1', 'pm1@x.com')), 'v2/invitesByEmail/a,b@x,com/ac3'), 'field')));
await check('pm cannot make a pm', () => assertFails(set(ref(db(pw('pm1', 'pm1@x.com')), 'v2/members/lex/zz'), { role: 'pm' })));
await check('field cannot add members', () => assertFails(set(ref(db(pw('fm1', 'fm1@x.com')), 'v2/members/lex/zz'), { role: 'field' })));
await check('verified invitee claims own membership', () => assertSucceeds(update(ref(db(linked('newguy', 'New.Guy@gmail.com'))), {
  'v2/members/lex/newguy': { role: 'field', email: 'new.guy@gmail.com' }, 'v2/my/newguy/lex': 'field'
})));
await reset();
await check('unverified invitee cannot claim', () => assertFails(set(ref(db(pw('newguy', 'new.guy@gmail.com')), 'v2/members/lex/newguy'), { role: 'field' })));
await check('invitee cannot claim a bigger role', () => assertFails(set(ref(db(linked('newguy', 'new.guy@gmail.com')), 'v2/members/lex/newguy'), { role: 'editor' })));
await check('invitee cannot claim another project', () => assertFails(set(ref(db(linked('newguy', 'new.guy@gmail.com')), 'v2/members/ac3/newguy'), { role: 'field' })));

// ── admin ───────────────────────────────────────────────────────────────────
await check('admin loads a project', () => assertSucceeds(set(ref(db(pw('leo', 'leosun@advfacade.com')), 'v2/p/fh'), { meta: { name: 'FH' }, items: {} })));
await check('pm cannot load a project', () => assertFails(set(ref(db(pw('pm1', 'pm1@x.com')), 'v2/p/zz'), { meta: { name: 'Z' } })));
await check('nobody else becomes admin', () => assertFails(set(ref(db(pw('pm1', 'pm1@x.com')), 'v2/admins/pm1'), true)));
await reset(false);
await check('first admin: only Leo, only once', async () => {
  await assertFails(set(ref(db(pw('x', 'someone@x.com')), 'v2/admins/x'), true));
  await assertSucceeds(set(ref(db(pw('leo', 'leosun@advfacade.com')), 'v2/admins/leo'), true));
  await assertFails(set(ref(db(pw('leo2', 'leosun@advfacade.com')), 'v2/admins/leo2'), true));
});

// ── the old hub keeps working ───────────────────────────────────────────────
await reset();
await check('old trackers still push summaries anonymously', () => assertSucceeds(set(ref(db(anon()), 'projects/cp2/summary'), { name: 'CP2', done: 2, total: 2, ts: now() })));
await check('old hub still readable by a real account', () => assertSucceeds(get(ref(db(pw('boss', 'boss@x.com')), 'projects'))));

await env.cleanup();
console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
