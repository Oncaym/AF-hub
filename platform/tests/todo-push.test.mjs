#!/usr/bin/env node
/* 🔔 To-do push (Leo 11-02): the Web Push encryption (RFC 8291 example), the VAPID
   signature, what rings for which change, the 2-hour reminder plan, and
   api/todo-push.mjs with the database and the push services stubbed.
     node platform/tests/todo-push.test.mjs                                   */
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const load = f => import(pathToFileURL(path.join(here, '..', '..', f)).href);
const { encrypt, vapidKeys, vapidHeader, pushHostOk } = await load('api/_webpush.mjs');
const push = await load('api/todo-push.mjs');
const handler = push.default, { describe, combine } = push;
const { plan, workHours } = await load('report/todo-remind.mjs');
let pass = 0, fail = 0; const c = (n, a, b) => { if (JSON.stringify(a) === JSON.stringify(b)) pass++; else { fail++; console.log('FAIL', n, '\n  got ', JSON.stringify(a), '\n  want', JSON.stringify(b)); } };
{ // encryption and signing
// RFC 8291 Appendix A
const out = encrypt('When I grow up, I want to be a watermelon',
  'BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4', 'BTBZMqHH6r4Tts7J_aSIgg',
  { asPrivate: 'yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw', salt: 'DGv6ra1nlYgDCS1FRnbzlw' });
c('RFC 8291 example', out.toString('base64url'), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
// round trip with a fresh browser key, decrypting the way a browser does
const ua = crypto.createECDH('prime256v1'); ua.generateKeys(); const auth = crypto.randomBytes(16);
const msg = JSON.stringify({ title: '▶ Your turn', body: '[CP2] 给 KWK 发 calc — due Nov 4' });
const body = encrypt(msg, ua.getPublicKey().toString('base64url'), auth.toString('base64url'));
const salt = body.subarray(0, 16), rs = body.readUInt32BE(16), idlen = body[20], as = body.subarray(21, 21 + idlen), ct = body.subarray(21 + idlen);
const shared = ua.computeSecret(as);
const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), as]), 32));
const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
const d = crypto.createDecipheriv('aes-128-gcm', cek, nonce); d.setAuthTag(ct.subarray(ct.length - 16));
const plain = Buffer.concat([d.update(ct.subarray(0, ct.length - 16)), d.final()]);
c('record size', rs, 4096); c('last-record delimiter', plain[plain.length - 1], 2); c('round trip', plain.subarray(0, -1).toString('utf8'), msg);
// VAPID: the JWT verifies with the public key that goes to the browser
const priv = crypto.createECDH('prime256v1'); priv.generateKeys();
const vk = vapidKeys(priv.getPrivateKey().toString('base64url'));
c('public key matches', vk.publicKey, priv.getPublicKey().toString('base64url'));
const h = vapidHeader('https://fcm.googleapis.com/fcm/send/abc', vk, 1790000000000);
const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h);
c('header shape', !!m, true);
const claims = JSON.parse(Buffer.from(m[2], 'base64url'));
c('aud is the push service origin', claims.aud, 'https://fcm.googleapis.com'); c('sub', claims.sub, 'https://af-hub-two.vercel.app'); c('exp 12h', claims.exp, 1790000000 + 43200);
const pubKey = crypto.createPublicKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', x: Buffer.from(vk.publicKey, 'base64url').subarray(1, 33).toString('base64url'), y: Buffer.from(vk.publicKey, 'base64url').subarray(33).toString('base64url') } });
c('signature verifies', crypto.verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key: pubKey, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')), true);
c('bad key refused', (() => { try { vapidKeys('abc'); return 'no'; } catch (e) { return 'refused'; } })(), 'refused');
}
c('push hosts: FCM', pushHostOk('https://fcm.googleapis.com/fcm/send/x'), true);
c('push hosts: Edge (WNS)', pushHostOk('https://wns2-bn3p.notify.windows.com/w/?token=x'), true);
c('push hosts: Apple', pushHostOk('https://web.push.apple.com/QA'), true);
c('push hosts: anything else refused', [pushHostOk('https://evil.com/fcm.googleapis.com'), pushHostOk('https://notify.windows.com.evil.com/x'), pushHostOk('http://fcm.googleapis.com/x')], [false, false, false]);
const now = 1793640000000, M = 60000;
const it = x => Object.assign({ what: 'Send CP2 calc to KWK', to: 'leo', by: 'jaesik', at: now - 2 * M, p: 'CP2', due: '2026-11-04' }, x);
// describe
c('new task for Leo', describe('a', it(), 'jaesik', 'leo', now)?.title, '📥 New from Jaesik');
c('new task body', describe('a', it({ note: 'email 11/02' }), 'jaesik', 'leo', now)?.body, '[CP2] Send CP2 calc to KWK · due Nov 4\nemail 11/02');
c('Jaesik adds one for himself: quiet', describe('a', it({ to: 'jaesik', by: 'leo', seen: now }), 'jaesik', 'leo', now), null);
c('old task: quiet', describe('a', it({ at: now - 60 * M }), 'jaesik', 'leo', now), null);
c('handed to Leo', describe('a', it({ at: now - 99 * M, log: { x: { by: 'jaesik', at: now - M, act: 'turn', turn: 'leo', text: 'please send' } } }), 'jaesik', 'leo', now), { title: '▶ Your turn — from Jaesik', body: '[CP2] Send CP2 calc to KWK · due Nov 4\nJaesik: please send', tag: 'todo-a', url: '/todo/#t=a', sticky: true });
c('note on any task', describe('a', it({ to: 'jaesik', log: { x: { by: 'jaesik', at: now - M, act: 'note', text: 'KWK called' } } }), 'jaesik', 'leo', now)?.title, '💬 Jaesik left a note');
c('closed', describe('a', it({ done: now, doneBy: 'jaesik', log: { x: { by: 'jaesik', at: now - M, act: 'close' } } }), 'jaesik', 'leo', now)?.title, '✅ Jaesik closed a task');
c('took it back, no note: quiet', describe('a', it({ to: 'jaesik', log: { x: { by: 'jaesik', at: now - M, act: 'turn', turn: 'jaesik' } } }), 'jaesik', 'leo', now), null);
c('took it back with a note: rings as a note', describe('a', it({ to: 'jaesik', log: { x: { by: 'jaesik', at: now - M, act: 'turn', turn: 'jaesik', text: 'I will do it' } } }), 'jaesik', 'leo', now)?.title, '💬 Jaesik left a note');
c('reopened, Leo\'s turn', describe('a', it({ log: { x: { by: 'jaesik', at: now - M, act: 'reopen' } } }), 'jaesik', 'leo', now)?.sticky, true);
c('last thing was Leo\'s own: quiet', describe('a', it({ log: { x: { by: 'leo', at: now - M, act: 'note', text: 'hi' } } }), 'jaesik', 'leo', now), null);
c('Got it only: quiet', describe('a', it({ seen: now, log: {} }), 'jaesik', 'leo', now), null);
c('gone task: quiet', describe('a', null, 'jaesik', 'leo', now), null);
const many = combine([1, 2, 3, 4, 5, 6].map(i => describe('t' + i, it({ what: 'task ' + i }), 'jaesik', 'leo', now)), 'jaesik');
c('a page of tasks → one notice', [many.title, many.body.split('\n').length, many.body.split('\n')[5]], ['📥 Jaesik: 6 updates for you', 6, '+ 1 more']);
// plan (reminders)
const items = { a: it({ at: now - 130 * M }), b: it({ at: now - 30 * M, p: '' , what: 'Call Forte', due: '' }), c: it({ seen: now - 5 * M }), d: it({ to: 'jaesik' }), e: it({ done: now }) };
let p = plan(items, {}, 'leo', now);
c('waiting = unseen, Leo\'s turn, open', p.waiting.sort(), ['a', 'b']);
c('rings when one waited ~2 h', p.due, true);
c('lists all waiting', p.note.body, '• [CP2] Send CP2 calc to KWK · due Nov 4\n• Call Forte');
c('title', p.note.title, '⏰ 2 tasks waiting for your Got it');
p = plan(items, { a: now - 60 * M }, 'leo', now);
c('reminded an hour ago: not yet', p.due, false);
p = plan(items, { a: now - 110 * M }, 'leo', now);
c('reminded ~2 h ago: again', p.due, true);
p = plan({ a: it({ at: now - 300 * M, log: { x: { by: 'jaesik', at: now - 20 * M, act: 'turn', turn: 'leo' } } }) }, {}, 'leo', now);
c('clock restarts when handed over again', p.due, false);
c('nothing waiting', plan({ c: items.c }, {}, 'leo', now), { waiting: [], due: false, note: null });
// work hours (New York)
c('Mon 2 Nov 2026 9:00 EST', workHours(Date.UTC(2026, 10, 2, 14, 0)), true);
c('Mon 7:30 EST', workHours(Date.UTC(2026, 10, 2, 12, 30)), false);
c('Mon 18:10 EST', workHours(Date.UTC(2026, 10, 2, 23, 10)), false);
c('Sat noon', workHours(Date.UTC(2026, 10, 7, 17, 0)), false);
c('summer: 8:20 EDT', workHours(Date.UTC(2027, 5, 1, 12, 20)), true);

// handler with a fake database and a fake push service
const vapid = crypto.createECDH('prime256v1'); vapid.generateKeys(); process.env.VAPID_PRIVATE_KEY = vapid.getPrivateKey().toString('base64url');
const ua = crypto.createECDH('prime256v1'); ua.generateKeys();
const sub = { endpoint: 'https://fcm.googleapis.com/fcm/send/dev1', p256dh: ua.getPublicKey().toString('base64url'), auth: crypto.randomBytes(16).toString('base64url'), at: 1 };
const deadSub = Object.assign({}, sub, { endpoint: 'https://web.push.apple.com/dead' });
const tok = email => 'h.' + Buffer.from(JSON.stringify({ email })).toString('base64url') + '.s';
const realNow = Date.now;
const db = { push: { leo: { dev1abcdefghij: sub, dev2abcdefghij: deadSub } }, items: { a: it({ at: realNow() - M }) } };
const calls = [];
global.fetch = async (url, opts = {}) => {
  calls.push([opts.method || 'GET', url.replace(/\?.*/, '')]);
  if (url.startsWith('https://af-hub-8f188')) {
    if (/auth=bad/.test(url)) return { ok: false, status: 401, json: async () => ({}) };
    const path = url.replace(/^https:\/\/[^/]+\/todo\/leo-jaesik\//, '').replace(/\.json.*/, '');
    if (opts.method === 'DELETE') return { ok: true, status: 200, json: async () => null };
    const v = path.split('/').reduce((o, k) => o && o[k], db);
    return { ok: true, status: 200, json: async () => v === undefined ? null : v };
  }
  if (url.includes('/dead')) return { status: 410 };
  if (url.includes('fcm.googleapis.com')) { calls.push(['AUTH', opts.headers.Authorization.slice(0, 8), opts.headers['Content-Encoding'], opts.headers.TTL]); return { status: 201 }; }
  return { status: 500 };
};
const run = async (method, body) => { let out; const res = { status(s) { out = { s }; return this; }, json(j) { out.j = j; return this; }, setHeader() {} }; await handler({ method, body }, res); return out; };
let r = await run('GET');
c('GET gives the public key', r.j.key, vapid.getPublicKey().toString('base64url'));
r = await run('POST', { token: 'bad', ids: ['a'] });
c('a token the database refuses → 403', r.s, 403);
r = await run('POST', { token: tok('someone@advfacade.com'), ids: ['a'] });
c('not Leo or Jaesik → 403', r.s, 403);
calls.length = 0;
r = await run('POST', { token: tok('JChang@AdvFacade.com'), ids: ['a', '../x'] });
c('Jaesik adds a task → rings Leo\'s working device', r.j, { leo: { sent: 1, gone: 1, devices: 2 } });
c('the dead device is forgotten', calls.some(x => x[0] === 'DELETE' && x[1].endsWith('/push/leo/dev2abcdefghij.json')), true);
c('signed VAPID, encrypted, 24 h', calls.find(x => x[0] === 'AUTH'), ['AUTH', 'vapid t=', 'aes128gcm', '86400']);
c('a bad id is not read', calls.some(x => x[1].includes('..')), false);
r = await run('POST', { token: tok('leosun@advfacade.com'), ids: ['a'] });
c('Leo acting rings nobody', r.j, { sent: 0 });
delete db.push.leo.dev2abcdefghij;
r = await run('POST', { token: tok('leosun@advfacade.com'), test: 'dev1abcdefghij' });
c('test notice to my own device', r.j, { sent: 1, gone: 0, devices: 1 });
r = await run('POST', { token: tok('jchang@advfacade.com'), test: 'dev1abcdefghij' });
c('cannot test someone else\'s device', r.s, 404);
delete process.env.VAPID_PRIVATE_KEY;
r = await run('GET');
c('no key set → says so', [r.s, /VAPID_PRIVATE_KEY/.test(r.j.error)], [500, true]);
console.log(`todo push: ${pass} passed, ${fail} failed`); process.exit(fail ? 1 : 0);
