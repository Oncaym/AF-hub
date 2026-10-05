#!/usr/bin/env node
/* Unit tests for platform/migrate/core.js (pure functions, no Firebase).
     node platform/tests/migrate.test.cjs */
const assert = require('assert');
const C = require('../migrate/core');

let pass = 0, fail = 0;
const t = (name, fn) => { try { fn(); pass++; } catch (e) { fail++; console.log('FAIL  ' + name + '\n      ' + e.message); } };

const OLD_BUCKET = 'atlantic-chestnut-3.firebasestorage.app';
const photo = (p, tok) => `https://firebasestorage.googleapis.com/v0/b/${OLD_BUCKET}/o/${encodeURIComponent(p)}?alt=media&token=${tok}`;
const SRC = {
  state: { _clientId: 'x', _ts: 1, _by: 'leo.sun@advfacade.com', units: [{ id: 'SF01', status: 'installed' }, { id: 'SF02', status: 'pending' }],
           log: [{ date: '2026-09-01', content: 'x', photos: [photo('cp2-photos/1_a.jpg', 't1'), 'data:image/jpeg;base64,AAAA'] }],
           submittals: [{ id: 'S1', pdf: photo('cp2-photos/2_b.jpg', 't2') }] },
  history: { a: { ts: 1, user: 'leo.sun@advfacade.com', desc: 'x' } },
  presence: { u1: { email: 'leo.sun@advfacade.com', since: 1 } },
  allowlist: { 'leo,sun@advfacade,com': true, 'joe@gmail,com': true },
  gcList: { 'pm@turner,com': true },
  damage: { d1: { x: 1 } },
};

t('buildTree copies known nodes, skips presence, keeps unknown nodes', () => {
  const { tree, report } = C.buildTree(SRC, { id: 'ac3', name: 'AC3', legacyURL: 'https://old', now: 1790000000000 });
  assert.deepStrictEqual(Object.keys(tree).sort(), ['allowlist', 'damage', 'gcList', 'history', 'meta', 'state'].sort());
  assert.deepStrictEqual(report.skipped, ['presence']);
  assert.deepStrictEqual(report.unknown, ['damage']);
});
t('buildTree stamps the project on state and meta', () => {
  const { tree } = C.buildTree(SRC, { id: 'ac3', name: 'AC3', legacyURL: 'https://old', now: 1790000000000 });
  assert.strictEqual(tree.state._project, 'ac3');
  assert.strictEqual(tree.meta.project, 'ac3');
  assert.strictEqual(tree.meta.migratedFrom, 'https://old');
});
t('buildTree does not modify its input', () => {
  const before = JSON.stringify(SRC);
  C.buildTree(SRC, { id: 'ac3', now: 1 });
  assert.strictEqual(JSON.stringify(SRC), before);
});
t('buildTree replaces a stale meta from the old database', () => {
  const { tree } = C.buildTree(Object.assign({}, SRC, { meta: { project: 'lex' } }), { id: 'ac3', now: 1 });
  assert.strictEqual(tree.meta.project, 'ac3');
});
t('members lists editors, GC and viewers with real addresses', () => {
  const m = C.members(SRC);
  assert.deepStrictEqual(m.map(x => x.role + ':' + x.email).sort(),
    ['editor:joe@gmail.com', 'editor:leo.sun@advfacade.com', 'gc:pm@turner.com'].sort());
});
t('emailKey matches the rules (every dot) and lower-cases', () => {
  assert.strictEqual(C.emailKey('Leo.Sun@AdvFacade.com'), 'leo,sun@advfacade,com');
});
t('maskEmail never prints the whole address', () => {
  assert.strictEqual(C.maskEmail('leo.sun@advfacade.com'), 'l***@advfacade.com');
  assert.strictEqual(C.maskEmail('bad'), '***');
});
t('storageUrls finds old-bucket URLs only (not data: URLs, not other buckets)', () => {
  const other = Object.assign({}, SRC, { x: 'https://firebasestorage.googleapis.com/v0/b/other.app/o/a.jpg?alt=media&token=z' });
  const u = C.storageUrls(other, OLD_BUCKET);
  assert.strictEqual(u.length, 2);
  assert.ok(u.every(x => x.includes(OLD_BUCKET)));
});
t('objectPath decodes the stored path', () => {
  assert.strictEqual(C.objectPath(photo('cp2-photos/1_a.jpg', 't1')), 'cp2-photos/1_a.jpg');
});
t('downloadUrl encodes the path', () => {
  assert.ok(C.downloadUrl('b.app', 'p/ac3/legacy/x y.jpg', 'tok').includes('/o/p%2Fac3%2Flegacy%2Fx%20y.jpg?alt=media&token=tok'));
});
t('rewriteUrls swaps exact strings anywhere, leaves the rest', () => {
  const map = { [photo('cp2-photos/1_a.jpg', 't1')]: 'NEW1' };
  const out = C.rewriteUrls(SRC, map);
  assert.strictEqual(out.state.log[0].photos[0], 'NEW1');
  assert.strictEqual(out.state.log[0].photos[1], 'data:image/jpeg;base64,AAAA');
  assert.strictEqual(out.state.submittals[0].pdf, SRC.state.submittals[0].pdf);
  assert.notStrictEqual(SRC.state.log[0].photos[0], 'NEW1', 'input untouched');
});
t('diff: equal trees, the way the database returns them (arrays → objects, empties dropped)', () => {
  const a = { s: { units: [{ id: 'A' }, { id: 'B' }], empty: {}, n: null, list: [] } };
  const b = { s: { units: { 0: { id: 'A' }, 1: { id: 'B' } } } };
  assert.deepStrictEqual(C.diff(a, b), []);
});
t('diff: reports a changed leaf with its path', () => {
  assert.deepStrictEqual(C.diff({ s: { a: 1, b: 2 } }, { s: { a: 1, b: 3 } }), ['/s/b']);
});
t('diff: reports a missing node', () => {
  assert.deepStrictEqual(C.diff({ s: { a: 1 }, h: { x: 1 } }, { s: { a: 1 } }), ['/h']);
});
t('batches: small tree is one root write', () => {
  assert.deepStrictEqual(C.batches({ a: 1 }), [{ path: '/', value: { a: 1 } }]);
});
t('batches: large tree splits by child, every batch under the limit', () => {
  const big = { state: { a: 'x'.repeat(600), b: 'y'.repeat(600) }, history: { h: 'z'.repeat(100) } };
  const b = C.batches(big, 1000);
  assert.ok(b.length >= 3, 'split into several writes');
  assert.ok(b.every(x => Buffer.byteLength(JSON.stringify(x.value)) <= 1000));
  const back = {};
  b.forEach(({ path, value }) => { const ks = path.split('/').filter(Boolean); let o = back; ks.slice(0, -1).forEach(k => (o = o[k] = o[k] || {})); o[ks[ks.length - 1]] = value; });
  assert.deepStrictEqual(back, big);
});
t('stateNumbers counts what the log shows', () => {
  const n = C.stateNumbers(SRC.state);
  assert.strictEqual(n.units, 2); assert.strictEqual(n.installed, 1); assert.strictEqual(n.submittals, 1); assert.strictEqual(n.dataUrlPhotos, 1);
});

console.log(`migrate core: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
