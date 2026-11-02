/* ============================================================
   Web Push, no packages (Leo 11-02: To-do notifications like an app)
   ============================================================
   Encrypts a message for one browser subscription (RFC 8291, aes128gcm)
   and signs the request with the hub's VAPID key (RFC 8292).
   Used by api/todo-push.mjs (right away, when Jaesik gives Leo a task) and
   report/todo-remind.mjs (every ~2 h until Leo taps Got it).

   The underscore keeps Vercel from serving this file as an endpoint.
   env VAPID_PRIVATE_KEY — 32 bytes, base64url (the public key is worked out from it).
   ============================================================ */
import crypto from 'node:crypto';

export const SUBJECT = 'https://af-hub-two.vercel.app';
const b64u = buf => Buffer.from(buf).toString('base64url');
const unb64u = s => Buffer.from(String(s || '').trim().replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_'), 'base64url');

/** { publicKey (base64url, 65 bytes), key (KeyObject for signing) } from the private key. */
export function vapidKeys(privateKey) {
  const d = unb64u(privateKey);
  if (d.length !== 32) throw new Error('VAPID_PRIVATE_KEY must be 32 bytes in base64url');
  const ecdh = crypto.createECDH('prime256v1');
  ecdh.setPrivateKey(d);
  const pub = ecdh.getPublicKey();
  const key = crypto.createPrivateKey({ format: 'jwk', key: { kty: 'EC', crv: 'P-256', d: b64u(d), x: b64u(pub.subarray(1, 33)), y: b64u(pub.subarray(33, 65)) } });
  return { publicKey: b64u(pub), key };
}

/** The Authorization header for one push service. */
export function vapidHeader(endpoint, vk, now = Date.now()) {
  const enc = o => b64u(JSON.stringify(o));
  const head = enc({ typ: 'JWT', alg: 'ES256' });
  const body = enc({ aud: new URL(endpoint).origin, exp: Math.floor(now / 1000) + 12 * 3600, sub: SUBJECT });
  const sig = crypto.sign('sha256', Buffer.from(head + '.' + body), { key: vk.key, dsaEncoding: 'ieee-p1363' });
  return 'vapid t=' + head + '.' + body + '.' + b64u(sig) + ', k=' + vk.publicKey;
}

/** One aes128gcm record for the browser with keys p256dh / auth. `fixed` is only for the RFC test. */
export function encrypt(text, p256dh, authSecret, fixed) {
  const ua = unb64u(p256dh), auth = unb64u(authSecret);
  if (ua.length !== 65 || auth.length !== 16) throw new Error('bad subscription keys');
  const eph = crypto.createECDH('prime256v1');
  if (fixed && fixed.asPrivate) eph.setPrivateKey(unb64u(fixed.asPrivate)); else eph.generateKeys();
  const as = eph.getPublicKey();
  const shared = eph.computeSecret(ua);
  const salt = fixed && fixed.salt ? unb64u(fixed.salt) : crypto.randomBytes(16);
  const ikm = Buffer.from(crypto.hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua, as]), 32));
  const cek = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(crypto.hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const c = crypto.createCipheriv('aes-128-gcm', cek, nonce);
  const sealed = Buffer.concat([c.update(Buffer.concat([Buffer.from(text, 'utf8'), Buffer.from([2])])), c.final(), c.getAuthTag()]);
  const head = Buffer.alloc(21);
  salt.copy(head, 0); head.writeUInt32BE(4096, 16); head[20] = as.length;
  return Buffer.concat([head, as, sealed]);
}

// Only the browsers' own push services (Chrome/Edge via FCM or WNS, Safari/iPad via Apple, Firefox).
const PUSH_HOSTS = /(^|\.)(fcm\.googleapis\.com|android\.googleapis\.com|notify\.windows\.com|push\.apple\.com|push\.services\.mozilla\.com)$/;
export const pushHostOk = endpoint => { try { const u = new URL(endpoint); return u.protocol === 'https:' && PUSH_HOSTS.test(u.hostname); } catch (e) { return false; } };

/** Send one message. sub = { endpoint, p256dh, auth }. Returns { ok, status, gone } (gone = forget this device). */
export async function sendPush(sub, message, vk, opts = {}) {
  if (!pushHostOk(sub.endpoint)) return { ok: false, status: 0, gone: true };
  const text = typeof message === 'string' ? message : JSON.stringify(message);
  if (Buffer.byteLength(text) > 3000) throw new Error('message too long');
  const r = await (opts.fetch || fetch)(sub.endpoint, {
    method: 'POST',
    headers: {
      Authorization: vapidHeader(sub.endpoint, vk),
      'Content-Encoding': 'aes128gcm',
      'Content-Type': 'application/octet-stream',
      TTL: String(opts.ttl || 86400),
      Urgency: opts.urgency || 'high',
    },
    body: encrypt(text, sub.p256dh, sub.auth),
  });
  return { ok: r.status >= 200 && r.status < 300, status: r.status, gone: r.status === 404 || r.status === 410 };
}
