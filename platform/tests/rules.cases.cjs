/* The cases both rules runners check (rules.local.test.cjs with targaryen,
   rules.emulator.test.mjs with the real Firebase emulator in CI).
   Each case: { name, as, op: 'read'|'set'|'update', path, value?, data?, want } */

const key = e => e.replace(/\./g, ',');
const NOW = 1790000000000;

const person = (email, verified = true, claims) => ({ uid: 'u_' + email.replace(/\W/g, '_'), email, verified, claims });
const P = {
  EDITOR:   person('leo.sun@advfacade.com'),   // staff AND on the allowlist
  FOREMAN:  person('joe.foreman@gmail.com'),   // editor by allowlist, personal email
  STAFF:    person('boss@advfacade.com'),      // staff, not on the allowlist
  STAFF_UP: person('Boss2@AdvFacade.COM'),     // staff, odd casing
  GC:       person('pm@turner.com'),           // on gcList
  VIEWER:   person('owner.rep@client.com'),    // on viewers
  STRANGER: person('someone@gmail.com'),       // signed in, no access here
  SHOP:     person('shop.lead@gmail.com', true, { shop: true }),  // on the shop list (custom claim), on no project list
  BOSS:     person('nan@advfacade.com', true, { boss: true }),    // boss (custom claim): reads every project, changes nothing
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
// 10-20: a company address alone no longer opens a project (STAFF); bosses and the shop list read all
const readers = [['EDITOR', true], ['FOREMAN', true], ['STAFF', false], ['STAFF_UP', false], ['GC', true], ['VIEWER', true],
  ['BOSS', true], ['SHOP', true], ['STRANGER', false], ['FAKE', false], ['ANON', false], ['NOBODY', false]];
for (const [who, want] of readers)
  for (const p of ['/state', '/meta', '/history', '/gcItems', '/warehouse', '/presence', '/elevGeo'])
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
c('staff on no list cannot log access (10-20)', 'STAFF', 'set', '/access/a1', { email: P.STAFF.email, ts: NOW }, false);
c('a boss logs own access', 'BOSS', 'set', '/access/a1', { email: P.BOSS.email, ts: NOW }, true);
c('a boss changes nothing', 'BOSS', 'set', '/state', st(P.BOSS, 'ac3'), false);
c('a boss cannot post to the GC inbox', 'BOSS', 'set', '/gcItems/g9', item(P.BOSS), false);
c('stranger cannot log access', 'STRANGER', 'set', '/access/a1', { email: P.STRANGER.email, ts: NOW }, false);
c('access row signed as someone else refused', 'STAFF', 'set', '/access/a1', { email: 'x@y.com', ts: NOW }, false);

// gcItems
c('gc posts own item', 'GC', 'set', '/gcItems/g2', item(P.GC), true);
c('gc cannot post as someone else', 'GC', 'set', '/gcItems/g2', item(P.EDITOR), false);
c('stranger cannot post', 'STRANGER', 'set', '/gcItems/g2', item(P.STRANGER), false);
c('gc cannot edit a posted item', 'GC', 'set', '/gcItems/g1', item(P.GC, { text: 'changed' }), false, WITH_ITEM);
c('editor triages a posted item', 'EDITOR', 'set', '/gcItems/g1', Object.assign(item(P.GC), { handled: true }), true, WITH_ITEM);
c('editor deletes a posted item', 'EDITOR', 'set', '/gcItems/g1', null, true, WITH_ITEM);

// warehouse
c('editor receives a warehouse item', 'EDITOR', 'set', '/warehouse/items/w1', { where: 'rack A', receivedAt: NOW, receivedBy: P.EDITOR.email, status: 'in_stock' }, true);
c('staff cannot receive a warehouse item', 'STAFF', 'set', '/warehouse/items/w1', { where: 'rack A', receivedAt: NOW, receivedBy: P.STAFF.email, status: 'in_stock' }, false);
// Glass Triage was removed (Leo, 2026-10-16): nothing may be read or written there.
c('/triage is closed, even to an editor', 'EDITOR', 'set', '/triage/friday/pieces/T1', { status: 'ok' }, false);
c('/triage is not readable', 'EDITOR', 'read', '/triage', undefined, false);

// elevGeo (takeoff "-> Tracker" / tracker DXF import)
const geo = (who, project, extra) => Object.assign({ key: 'SF04.1', viewBox: '0 0 10 10', takeoff: { system: '750XT' }, _project: project, _by: who.email, _ts: NOW }, extra || {});
c('editor pushes an elevation', 'EDITOR', 'set', '/elevGeo/SF04,1', geo(P.EDITOR, 'ac3'), true);
c('foreman on the allowlist pushes an elevation', 'FOREMAN', 'set', '/elevGeo/SF04,1', geo(P.FOREMAN, 'ac3'), true);
c('staff (read-only here) cannot push an elevation', 'STAFF', 'set', '/elevGeo/SF04,1', geo(P.STAFF, 'ac3'), false);
c('elevation stamped with ANOTHER project is refused', 'EDITOR', 'set', '/elevGeo/SF04,1', geo(P.EDITOR, 'lex'), false);
c('elevation signed as somebody else is refused', 'EDITOR', 'set', '/elevGeo/SF04,1', geo(P.EDITOR, 'ac3', { _by: P.STAFF.email }), false);
c('elevation with no project stamp is refused', 'EDITOR', 'set', '/elevGeo/SF04,1', geo(P.EDITOR, undefined), false);
c('editor cannot overwrite the whole elevGeo node', 'EDITOR', 'set', '/elevGeo', { x: geo(P.EDITOR, 'ac3') }, false);

// fab drawings: editors upload, our people read, the GC does not
const fab = (who, project, extra) => Object.assign({ name: '40.pdf', pdf: 'https://firebasestorage.googleapis.com/v0/b/x/o/p%2Fac3%2Ffab%2Ff1%2F40.pdf', pages: [{ img: 'https://firebasestorage.googleapis.com/i', tags: ['SF40'] }], uploadedAt: NOW, _by: who.email, _project: project }, extra || {});
for (const [who, want] of [['EDITOR', true], ['FOREMAN', true], ['STAFF', false], ['VIEWER', true], ['SHOP', true], ['BOSS', true], ['GC', false], ['STRANGER', false], ['ANON', false]])
  c(`read /fab as ${who}`, who, 'read', '/fab', undefined, want);
c('editor uploads a fab drawing', 'EDITOR', 'set', '/fab/f1', fab(P.EDITOR, 'ac3'), true);
c('foreman on the allowlist uploads a fab drawing', 'FOREMAN', 'set', '/fab/f1', fab(P.FOREMAN, 'ac3'), true);
c('staff (read-only here) cannot upload a fab drawing', 'STAFF', 'set', '/fab/f1', fab(P.STAFF, 'ac3'), false);
c('gc cannot upload a fab drawing', 'GC', 'set', '/fab/f1', fab(P.GC, 'ac3'), false);
c('fab drawing stamped with ANOTHER project is refused', 'EDITOR', 'set', '/fab/f1', fab(P.EDITOR, 'lex'), false);
c('fab drawing signed as somebody else is refused', 'EDITOR', 'set', '/fab/f1', fab(P.EDITOR, 'ac3', { _by: P.STAFF.email }), false);
c('fab drawing without its PDF link is refused', 'EDITOR', 'set', '/fab/f1', fab(P.EDITOR, 'ac3', { pdf: null }), false);
const WITH_FAB = Object.assign({}, AC3, { fab: { f1: fab(P.EDITOR, 'ac3') } });
c('editor removes a fab drawing', 'EDITOR', 'set', '/fab/f1', null, true, WITH_FAB);
c('staff cannot remove a fab drawing', 'STAFF', 'set', '/fab/f1', null, false, WITH_FAB);
c('editor adds unit numbers to a fab drawing', 'FOREMAN', 'update', '/fab/f1', { manualTags: ['SF41'], _by: P.FOREMAN.email }, true, WITH_FAB);
c('editor cannot overwrite the whole fab node', 'EDITOR', 'set', '/fab', { f1: fab(P.EDITOR, 'ac3') }, false);

// 🚚 to send: the foreman adds, the shop (staff) marks sent, the GC sees nothing
const ask = (who, project, extra) => Object.assign({ what: 'SF04 sidelite', by: who.email, at: NOW, _project: project }, extra || {});
for (const [who, want] of [['EDITOR', true], ['FOREMAN', true], ['STAFF', true], ['VIEWER', true], ['SHOP', true], ['GC', false], ['STRANGER', false], ['ANON', false]])
  c(`read /toSend as ${who}`, who, 'read', '/toSend', undefined, want);
c('foreman asks for something', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3'), true);
c('staff (not an editor) adds a request (Shop page, 2026-10-19)', 'STAFF', 'set', '/toSend/t1', ask(P.STAFF, 'ac3'), true);
c('gc cannot add a request', 'GC', 'set', '/toSend/t1', ask(P.GC, 'ac3'), false);
c('a request stamped with ANOTHER project is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'lex'), false);
c('a request in somebody else\'s name is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { by: P.EDITOR.email }), false);
c('an empty request is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { what: '' }), false);
const WITH_ASK = Object.assign({}, AC3, { toSend: { t1: ask(P.FOREMAN, 'ac3') } });
// only the shop list marks it sent (Leo 10-19: a read-only company account could)
c('the shop marks it sent', 'SHOP', 'set', '/toSend/t1/sent', { by: P.SHOP.email, at: NOW }, true, WITH_ASK);
c('staff (not on the shop list) cannot mark it sent', 'STAFF', 'set', '/toSend/t1/sent', { by: P.STAFF.email, at: NOW }, false, WITH_ASK);
c('a viewer cannot mark it sent', 'VIEWER', 'set', '/toSend/t1/sent', { by: P.VIEWER.email, at: NOW }, false, WITH_ASK);
c('an editor cannot mark it sent', 'FOREMAN', 'set', '/toSend/t1/sent', { by: P.FOREMAN.email, at: NOW }, false, WITH_ASK);
c('an editor cannot mark it sent by rewriting the request', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { sent: { by: P.FOREMAN.email, at: NOW } }), false, WITH_ASK);
c('sent in somebody else\'s name is refused', 'SHOP', 'set', '/toSend/t1/sent', { by: P.EDITOR.email, at: NOW }, false, WITH_ASK);
c('the gc cannot mark it sent', 'GC', 'set', '/toSend/t1/sent', { by: P.GC.email, at: NOW }, false, WITH_ASK);
c('staff cannot change what was asked', 'STAFF', 'set', '/toSend/t1/what', 'something else', false, WITH_ASK);
c('staff cannot remove a request', 'STAFF', 'set', '/toSend/t1', null, false, WITH_ASK);
c('marking sent cannot create a request', 'SHOP', 'set', '/toSend/t9/sent', { by: P.SHOP.email, at: NOW }, false);
const WITH_SENT = Object.assign({}, AC3, { toSend: { t1: ask(P.FOREMAN, 'ac3', { sent: { by: P.SHOP.email, at: NOW } }) } });
c('the shop undoes Sent', 'SHOP', 'set', '/toSend/t1/sent', null, true, WITH_SENT);
c('an editor cannot undo Sent', 'FOREMAN', 'set', '/toSend/t1/sent', null, false, WITH_SENT);
c('staff cannot undo Sent', 'STAFF', 'set', '/toSend/t1/sent', null, false, WITH_SENT);
c('an editor still removes a sent request', 'EDITOR', 'set', '/toSend/t1', null, true, WITH_SENT);
c('the shop cannot add requests (only Sent)', 'SHOP', 'set', '/toSend/t2', ask(P.SHOP, 'ac3'), false);
c('an editor removes a request', 'EDITOR', 'set', '/toSend/t1', null, true, WITH_ASK);
// staff's own request: they can change and remove it; the optional fields are checked
const WITH_STAFF_ASK = Object.assign({}, AC3, { toSend: { t2: ask(P.STAFF, 'ac3') } });
c('staff removes their own request', 'STAFF', 'set', '/toSend/t2', null, true, WITH_STAFF_ASK);
c('staff fixes the quantity on their own request', 'STAFF', 'set', '/toSend/t2/qty', 4, true, WITH_STAFF_ASK);
c('an unverified @advfacade account cannot add', 'FAKE', 'set', '/toSend/t1', ask(P.FAKE, 'ac3'), false);
c('a request with qty, need-by, note and photo', 'FOREMAN', 'set', '/toSend/t1',
  ask(P.FOREMAN, 'ac3', { qty: 4, need: '2026-10-22', note: 'east side, level 2', photo: 'https://firebasestorage.googleapis.com/v0/b/x/o/p%2Fac3%2Fsend%2Ft1.jpg?alt=media' }), true);
c('qty 0 is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { qty: 0 }), false);
c('a need-by that is not a date is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { need: 'next week' }), false);
c('a note over 300 characters is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { note: 'x'.repeat(301) }), false);
c('a photo that is not a web link is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { photo: 'javascript:alert(1)' }), false);
c('an unknown field is refused', 'FOREMAN', 'set', '/toSend/t1', ask(P.FOREMAN, 'ac3', { truck: 'T1' }), false);
c('a request recorded from WeChat (who asked, when)', 'STAFF', 'set', '/toSend/t1', ask(P.STAFF, 'ac3', { askedBy: '王师傅', askedAt: NOW - 3600e3, src: 'wechat', note: '王师傅: 明天要SD09 2个' }), true);
c('askedBy over 80 characters is refused', 'STAFF', 'set', '/toSend/t1', ask(P.STAFF, 'ac3', { askedBy: 'x'.repeat(81) }), false);
c('askedAt must be a time', 'STAFF', 'set', '/toSend/t1', ask(P.STAFF, 'ac3', { askedAt: 'yesterday' }), false);

module.exports = { P, cases, NOW, key };
