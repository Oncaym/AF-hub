#!/usr/bin/env node
/* The design database (Design Boards, /design/): its registry entry, the page's
   config, and platform/design-database.rules.json checked with targaryen.

     cd platform/tests && npm install && node design.test.cjs
*/
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const targaryen = require('targaryen');

const ROOT = path.join(__dirname, '..', '..');
const REG = JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'projects.json'), 'utf8'));
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) pass++; else { fail++; console.log('FAIL  ' + msg); } };

// ───────────────────────────────────────────── registry and page config ──
const D = REG.design;
ok(D && D.id === 'design' && D.folder === 'design', 'platform/projects.json has the design database');
ok(!REG.projects.some(p => p.id === 'design' || p.databaseURL === D.databaseURL), 'the design database is not a tracker project');
ok(!REG.projects.some(p => p.databaseURL === D.databaseURL), 'no tracker shares the design database');
{
  const g = { console }; vm.createContext(g); g.window = g;
  vm.runInContext(read('design/firebase-config.js'), g);
  const fc = g.FIREBASE_CONFIG || {};
  ok(fc.databaseURL === D.databaseURL, `design/firebase-config.js points at ${D.databaseURL} (got ${fc.databaseURL})`);
  ok(fc.projectId === REG.firebaseProject, 'design/firebase-config.js is the af-hub Firebase project');
  ok(!fc.authEmulatorUrl, 'design/firebase-config.js has no emulator setting');
  const html = read('design/index.html');
  ok(/src="firebase-config\.js/.test(html), 'design/index.html loads its own firebase-config.js');
  ok(!/src="\.\.\/ac3\/|src="\.\.\/lex\//.test(html), 'design/index.html loads nothing from a tracker folder');
  ok(!/af-hub-8f188-(ac3|lex)/.test(read('design/design-cloud.js') + read('design/design-app.js')), 'design code names no tracker database');
}

{
  // The AF Helper's own copy of the tracker list (platform/ is not deployed).
  const g = { console }; vm.createContext(g); g.window = g;
  vm.runInContext(read('assistant/projects.js'), g);
  const mine = JSON.stringify((g.AF_PROJECTS || []).map(p => [p.id, p.name, p.databaseURL]));
  const reg = JSON.stringify(REG.projects.map(p => [p.id, p.name, p.databaseURL]));
  ok(mine === reg, 'assistant/projects.js lists the same trackers as platform/projects.json');
  ok(/src="projects\.js/.test(read('assistant/index.html')), 'assistant/index.html loads projects.js');
}

// ──────────────────────────────────────────────────────────────── rules ──
const rules = JSON.parse(read('platform/' + D.rules).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const key = e => e.replace(/\./g, ',');
const NOW = 1790000000000;
const person = (email, verified = true) => ({ uid: 'u_' + email.replace(/\W/g, '_'), email, verified });
const P = {
  DRAFTER: person('henry.kim@advfacade.com'),  // design team, editor
  LEAD:    person('spark@advfacade.com'),      // design team, editor
  STAFF:   person('pm@advfacade.com'),         // staff, reads only
  VIEWER:  person('arch@dattner.com'),         // on viewers
  FOREMAN: person('joe.foreman@gmail.com'),    // a tracker editor, nothing here
  FAKE:    person('fake@advfacade.com', false),
  ANON:    { uid: 'anon1', anonymous: true },
};
function authOf(name) {
  const p = P[name];
  if (!p) return null;
  if (p.anonymous) return { uid: p.uid, provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } };
  return { uid: p.uid, provider: 'password', token: { email: p.email, email_verified: p.verified, firebase: { sign_in_provider: 'password' } } };
}
const stamp = (who, o) => Object.assign({ _by: P[who].email, _ts: NOW }, o);
const issue = (who, o) => stamp(who, Object.assign({ n: 1, text: 'Change TOB to T.O.HSS', status: 'open', created: NOW }, o));
const SEED = {
  meta: { project: 'design', name: 'AF Design Boards' },
  allowlist: { [key(P.DRAFTER.email)]: true, [key(P.LEAD.email)]: true },
  viewers: { [key(P.VIEWER.email)]: true },
  boardInfo: { ac3: stamp('LEAD', { name: 'Atlantic-Chestnut Building 3' }) },
  images: { ac3: { m1: stamp('LEAD', { data: 'data:image/jpeg;base64,AAAA' }) } },
  boards: {
    ac3: {
      drawings: { 'AC3-100': stamp('LEAD', { no: 'AC3-100', title: 'MAISONETTE ENTRY', status: 'drafting' }) },
      issues: {
        i1: issue('LEAD', {}),
        i2: issue('LEAD', { n: 2, status: 'fixed', fixedBy: P.DRAFTER.email, fixedAt: NOW }),
      },
      history: { h1: { ts: NOW, user: P.LEAD.email, desc: 'seed' } },
    },
  },
};
const cases = [];
const c = (name, as, op, p, value, want) => cases.push({ name, as, op, path: p, value, want });

// reading
c('drafter reads boards', 'DRAFTER', 'read', '/boards', null, true);
c('staff reads boards', 'STAFF', 'read', '/boards/ac3/issues', null, true);
c('viewer reads boards', 'VIEWER', 'read', '/boards/ac3', null, true);
c('tracker foreman reads nothing', 'FOREMAN', 'read', '/boards', null, false);
c('unverified staff reads nothing', 'FAKE', 'read', '/boards', null, false);
c('anonymous reads nothing', 'ANON', 'read', '/boards', null, false);
c('signed-out reads nothing', null, 'read', '/boards', null, false);
c('nobody reads the allowlist', 'LEAD', 'read', '/allowlist', null, false);
c('a person reads their own allowlist entry', 'DRAFTER', 'read', '/allowlist/' + key(P.DRAFTER.email), null, true);
c('staff reads the board list', 'STAFF', 'read', '/boardInfo', null, true);
c('foreman cannot read screenshots', 'FOREMAN', 'read', '/images/ac3', null, false);
c('staff reads /meta', 'STAFF', 'read', '/meta', null, true);
c('nobody writes /meta', 'LEAD', 'set', '/meta/project', 'ac3', false);

// boards
c('editor creates a board', 'LEAD', 'set', '/boardInfo/hillview', stamp('LEAD', { name: 'Hillview' }), true);
c('bad board id refused', 'LEAD', 'set', '/boardInfo/Hill View', stamp('LEAD', { name: 'x' }), false);
c('staff cannot create a board', 'STAFF', 'set', '/boardInfo/hillview', stamp('STAFF', { name: 'Hillview' }), false);
c('board info signed by someone else refused', 'DRAFTER', 'set', '/boardInfo/ac3', stamp('LEAD', { name: 'x' }), false);

// drawings
c('editor sets a drawing status', 'DRAFTER', 'update', '/boards/ac3/drawings/AC3-100', { status: 'review', _by: P.DRAFTER.email, _ts: NOW }, true);
c('unknown drawing status refused', 'DRAFTER', 'update', '/boards/ac3/drawings/AC3-100', { status: 'done', _by: P.DRAFTER.email, _ts: NOW }, false);
c('viewer cannot change a drawing', 'VIEWER', 'update', '/boards/ac3/drawings/AC3-100', { status: 'review', _by: P.VIEWER.email, _ts: NOW }, false);
c('nobody deletes a drawing', 'LEAD', 'set', '/boards/ac3/drawings/AC3-100', null, false);

// review comments: two closes
c('editor adds a comment', 'LEAD', 'set', '/boards/ac3/issues/i9', issue('LEAD', { n: 9 }), true);
c('staff cannot add a comment', 'STAFF', 'set', '/boards/ac3/issues/i9', issue('STAFF', { n: 9 }), false);
c('drafter marks fixed (first close)', 'DRAFTER', 'update', '/boards/ac3/issues/i1', { status: 'fixed', fixedBy: P.DRAFTER.email, fixedAt: NOW, _by: P.DRAFTER.email, _ts: NOW }, true);
c('fixed without who/when refused', 'DRAFTER', 'update', '/boards/ac3/issues/i1', { status: 'fixed', _by: P.DRAFTER.email, _ts: NOW }, false);
c('open comment cannot jump to closed', 'LEAD', 'update', '/boards/ac3/issues/i1', { status: 'closed', closedBy: P.LEAD.email, _by: P.LEAD.email, _ts: NOW }, false);
c('reviewer closes a fixed comment (second close)', 'LEAD', 'update', '/boards/ac3/issues/i2', { status: 'closed', closedBy: P.LEAD.email, closedAt: NOW, _by: P.LEAD.email, _ts: NOW }, true);
c('reviewer reopens a fixed comment', 'LEAD', 'update', '/boards/ac3/issues/i2', { status: 'open', _by: P.LEAD.email, _ts: NOW }, true);
c('nobody deletes a comment', 'LEAD', 'set', '/boards/ac3/issues/i1', null, false);
c('comment signed by someone else refused', 'DRAFTER', 'update', '/boards/ac3/issues/i1', { text: 'x', _by: P.LEAD.email, _ts: NOW }, false);

// screenshots and history
c('editor adds a screenshot', 'DRAFTER', 'set', '/images/ac3/m2', stamp('DRAFTER', { data: 'data:image/jpeg;base64,BBBB' }), true);
c('a screenshot cannot be replaced', 'DRAFTER', 'set', '/images/ac3/m1', stamp('DRAFTER', { data: 'data:image/jpeg;base64,CCCC' }), false);
c('a screenshot must be an image', 'DRAFTER', 'set', '/images/ac3/m3', stamp('DRAFTER', { data: 'javascript:alert(1)' }), false);
c('history is appended', 'DRAFTER', 'set', '/boards/ac3/history/h2', { ts: NOW, user: P.DRAFTER.email, desc: 'x' }, true);
c('history cannot be rewritten', 'LEAD', 'set', '/boards/ac3/history/h1', { ts: NOW, user: P.LEAD.email, desc: 'x' }, false);
c('history signed by someone else refused', 'DRAFTER', 'set', '/boards/ac3/history/h3', { ts: NOW, user: P.LEAD.email, desc: 'x' }, false);

const clean = v => (v === undefined || v === null ? v : JSON.parse(JSON.stringify(v)));
for (const k of cases) {
  const db = targaryen.database(rules, clean(SEED), NOW).with({ debug: true }).as(authOf(k.as));
  const r = k.op === 'read' ? db.read(k.path) : k.op === 'update' ? db.update(k.path, clean(k.value)) : db.write(k.path, clean(k.value));
  ok(r.allowed === k.want, `rules: ${k.name} (got ${r.allowed ? 'allowed' : 'denied'})` + (process.env.DEBUG ? '\n' + r.info : ''));
}

console.log(`design: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
