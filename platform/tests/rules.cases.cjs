/* The cases both rules runners check (rules.local.test.cjs with targaryen,
   rules.emulator.test.mjs with the real Firebase emulator in CI).
   Each case: { name, as, op: 'read'|'set'|'update', path, value?, data?, want } */

const key = e => e.replace(/\./g, ',');
const NOW = 1790000000000;

const person = (email, verified = true) => ({ uid: 'u_' + email.replace(/\W/g, '_'), email, verified });
const P = {
  EDITOR:   person('leo.sun@advfacade.com'),   // staff AND on the allowlist
  FOREMAN:  person('joe.foreman@gmail.com'),   // editor by allowlist, personal email
  STAFF:    person('boss@advfacade.com'),      // staff, not on the allowlist
  STAFF_UP: person('Boss2@AdvFacade.COM'),     // staff, odd casing
  GC:       person('pm@turner.com'),           // on gcList
  VIEWER:   person('owner.rep@client.com'),    // on viewers
  STRANGER: person('someone@gmail.com'),       // signed in, no access here
  FAKE:     person('fake@advfacade.com', false), // self-signup, unverified
  ANON:     { uid: 'anon1', anonymous: true },
  NOBODY:   null,
};

const seed = (project) => ({
  meta: { project, name: project.toUpperCase() },
  allowlist: { [key(P.EDITOR.email)]: true, [key(P.FOREMAN.email)]: true },
  gcList: { [key(P.GC.email)]: true },
  viewers: { [key(P.VIEWER.email)]: true },
  state: { _clientId: 'x', _ts: 1, _by: P.EDITOR.email, _project: project, units: [{ id: 'SF01', status: 'pending' }] },
  history: { h1: { ts: 1, user: P.EDITOR.email, desc: 'seed' } },
});
const AC3 = seed('ac3');
const NO_META = { allowlist: AC3.allowlist };
const WITH_ITEM = Object.assign({}, AC3, { gcItems: { g1: { by: P.GC.email, ts: 1, text: 'hello' } } });

const st = (who, project, extra) => Object.assign(
  { _clientId: 'c1', _ts: NOW, _by: who.email, _project: project, units: [{ id: 'SF01', status: 'installed' }] }, extra || {});
const item = (who, extra) => Object.assign({ by: who.email, ts: NOW, text: 'hello' }, extra || {});

const cases = [];
const c = (name, as, op, path, value, want, data) => cases.push({ name, as, op, path, value, want, data: data || AC3 });

// reads
const readers = [['EDITOR', true], ['FOREMAN', true], ['STAFF', true], ['STAFF_UP', true], ['GC', true], ['VIEWER', true],
  ['STRANGER', false], ['FAKE', false], ['ANON', false], ['NOBODY', false]];
for (const [who, want] of readers)
  for (const p of ['/state', '/meta', '/history', '/gcItems', '/triage', '/warehouse', '/presence'])
    c(`read ${p} as ${who}`, who, 'read', p, undefined, want);
c('root not readable even by an editor', 'EDITOR', 'read', '/', undefined, false);
c('allowlist not listable', 'EDITOR', 'read', '/allowlist', undefined, false);
c('own allowlist entry readable', 'FOREMAN', 'read', '/allowlist/' + key(P.FOREMAN.email), undefined, true);
c("someone else's allowlist entry not readable", 'FOREMAN', 'read', '/allowlist/' + key(P.EDITOR.email), undefined, false);
c('own gcList entry readable', 'GC', 'read', '/gcList/' + key(P.GC.email), undefined, true);
c('gcList not listable', 'STAFF', 'read', '/gcList', undefined, false);
c('own viewers entry readable', 'VIEWER', 'read', '/viewers/' + key(P.VIEWER.email), undefined, true);
c('access log hidden from staff', 'STAFF', 'read', '/access', undefined, false);
c('access log readable by an editor', 'EDITOR', 'read', '/access', undefined, true);

// state: who may save
c('editor saves state', 'EDITOR', 'set', '/state', st(P.EDITOR, 'ac3'), true);
c('foreman on the allowlist saves state', 'FOREMAN', 'set', '/state', st(P.FOREMAN, 'ac3'), true);
for (const who of ['STAFF', 'GC', 'VIEWER', 'STRANGER', 'FAKE'])
  c(`${who} cannot save state`, who, 'set', '/state', st(P[who], 'ac3'), false);
c('anonymous cannot save state', 'ANON', 'set', '/state', st(P.EDITOR, 'ac3'), false);
c('signed out cannot save state', 'NOBODY', 'set', '/state', st(P.EDITOR, 'ac3'), false);

// state: the cross-project guard
c('save stamped with ANOTHER project is refused', 'EDITOR', 'set', '/state', st(P.EDITOR, 'lex'), false);
c('save with no project stamp is refused', 'EDITOR', 'set', '/state', st(P.EDITOR, undefined), false);
c('save into a database without /meta is refused', 'EDITOR', 'set', '/state', st(P.EDITOR, 'ac3'), false, NO_META);
c('save signed as somebody else is refused', 'EDITOR', 'set', '/state', st(P.EDITOR, 'ac3', { _by: P.STAFF.email }), false);
c('deleting the whole state is refused', 'EDITOR', 'set', '/state', null, false);
c('a partial save signed by someone else is refused', 'FOREMAN', 'update', '/state', { units: [{ id: 'SF01', status: 'issue' }] }, false);

// meta and membership: console / Admin SDK only
c('editor cannot rewrite /meta', 'EDITOR', 'set', '/meta/project', 'lex', false);
c('editor cannot add to the allowlist', 'EDITOR', 'set', '/allowlist/' + key(P.STRANGER.email), true, false);
c('editor cannot add to gcList', 'EDITOR', 'set', '/gcList/x', true, false);
c('editor cannot add viewers', 'EDITOR', 'set', '/viewers/x', true, false);
c('editor cannot write the root', 'EDITOR', 'set', '/', { meta: { project: 'ac3' } }, false);
c('editor cannot invent a top-level node', 'EDITOR', 'set', '/elsewhere', { a: 1 }, false);

// history
c('editor appends own history row', 'EDITOR', 'set', '/history/h2', { ts: NOW, user: P.EDITOR.email, desc: 'x' }, true);
c('history row signed as someone else refused', 'EDITOR', 'set', '/history/h2', { ts: NOW, user: 'x@y.com', desc: 'x' }, false);
c('history rows cannot be rewritten', 'EDITOR', 'set', '/history/h1', { ts: NOW, user: P.EDITOR.email, desc: 'changed' }, false);
c('history rows cannot be deleted', 'EDITOR', 'set', '/history/h1', null, false);
c('staff cannot append history', 'STAFF', 'set', '/history/h3', { ts: NOW, user: P.STAFF.email, desc: 'x' }, false);

// presence / access
c('editor writes own presence', 'EDITOR', 'set', '/presence/' + P.EDITOR.uid, { email: P.EDITOR.email, since: NOW }, true);
c("editor cannot write another uid's presence", 'EDITOR', 'set', '/presence/other', { email: P.EDITOR.email, since: NOW }, false);
c('staff cannot write presence (the read-only signal)', 'STAFF', 'set', '/presence/' + P.STAFF.uid, { email: P.STAFF.email, since: NOW }, false);
c('staff logs own access', 'STAFF', 'set', '/access/a1', { email: P.STAFF.email, ts: NOW }, true);
c('stranger cannot log access', 'STRANGER', 'set', '/access/a1', { email: P.STRANGER.email, ts: NOW }, false);
c('access row signed as someone else refused', 'STAFF', 'set', '/access/a1', { email: 'x@y.com', ts: NOW }, false);

// gcItems
c('gc posts own item', 'GC', 'set', '/gcItems/g2', item(P.GC), true);
c('gc cannot post as someone else', 'GC', 'set', '/gcItems/g2', item(P.EDITOR), false);
c('stranger cannot post', 'STRANGER', 'set', '/gcItems/g2', item(P.STRANGER), false);
c('gc cannot edit a posted item', 'GC', 'set', '/gcItems/g1', item(P.GC, { text: 'changed' }), false, WITH_ITEM);
c('editor triages a posted item', 'EDITOR', 'set', '/gcItems/g1', Object.assign(item(P.GC), { handled: true }), true, WITH_ITEM);
c('editor deletes a posted item', 'EDITOR', 'set', '/gcItems/g1', null, true, WITH_ITEM);

// warehouse / triage
c('editor receives a warehouse item', 'EDITOR', 'set', '/warehouse/items/w1', { where: 'rack A', receivedAt: NOW, receivedBy: P.EDITOR.email, status: 'in_stock' }, true);
c('staff cannot receive a warehouse item', 'STAFF', 'set', '/warehouse/items/w1', { where: 'rack A', receivedAt: NOW, receivedBy: P.STAFF.email, status: 'in_stock' }, false);
c('editor sets a triage piece', 'EDITOR', 'set', '/triage/friday/pieces/T1', { status: 'ok' }, true);
c('gc cannot set a triage piece', 'GC', 'set', '/triage/friday/pieces/T1', { status: 'ok' }, false);

module.exports = { P, cases, NOW, key };
