#!/usr/bin/env node
/* ============================================================
   ⏰ To-do: ring again until Got it (Leo 11-02: "每 2 小时再响一次")
   ------------------------------------------------------------
   Run every hour by .github/workflows/todo-remind.yml. On weekdays 8:00–18:00
   New York, if a task has been Leo's turn for about 2 hours (since it was handed
   to him, or since the last reminder) and he has not tapped Got it, his devices
   ring once more with everything still waiting. Times are kept at
   todo/leo-jaesik/nudge/<taskId>.

   env  HUB_SERVICE_ACCOUNT  service account of af-hub-8f188
        HUB_DATABASE_URL     (optional) the hub database
        VAPID_PRIVATE_KEY    the same key as in the Vercel project
        DRY_RUN=1            say what would ring, send nothing
        ANYTIME=1            ignore the work-hours window (for a test)
   The repository is public, so the log shows counts only, never task text.
   ============================================================ */
import { pathToFileURL } from 'node:url';
import { vapidKeys, sendPush } from '../api/_webpush.mjs';

const LIST = 'todo/leo-jaesik';
const PUSH_TO = ['leo'];                 // same as api/todo-push.mjs
const EVERY = 105 * 60 * 1000;           // "every 2 hours", with room for GitHub starting late
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

export function workHours(now) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', weekday: 'short', hour: 'numeric', hourCycle: 'h23' })
    .formatToParts(new Date(now)).map(p => [p.type, p.value]));
  const h = +parts.hour;
  return !['Sat', 'Sun'].includes(parts.weekday) && h >= 8 && h < 18;
}

/** When the task last became `to`'s turn. */
function handedAt(it, to) {
  let t = it.at || 0;
  Object.values(it.log || {}).forEach(e => { if (e && ((e.act === 'turn' && e.turn === to) || e.act === 'reopen') && e.at > t) t = e.at; });
  return t;
}

/** { waiting: [ids], due: bool, note } for one person. */
export function plan(items, nudge, to, now) {
  const waiting = Object.entries(items || {})
    .filter(([, it]) => it && it.what && it.to === to && !it.done && !it.seen)
    .map(([id, it]) => ({ id, it, last: Math.max(handedAt(it, to), +((nudge || {})[id]) || 0) }));
  const due = waiting.some(w => now - w.last >= EVERY);
  if (!due) return { waiting: waiting.map(w => w.id), due: false, note: null };
  waiting.sort((a, b) => (a.it.due || '9999') < (b.it.due || '9999') ? -1 : (a.it.due || '9999') > (b.it.due || '9999') ? 1 : a.it.at - b.it.at);
  const lines = waiting.slice(0, 4).map(w => {
    const m = /^\d{4}-(\d\d)-(\d\d)$/.exec(w.it.due || '');
    return '• ' + (w.it.p ? '[' + w.it.p + '] ' : '') + short(w.it.what, 90) + (m ? ' · due ' + MON[+m[1] - 1] + ' ' + +m[2] : '');
  });
  if (waiting.length > 4) lines.push('+ ' + (waiting.length - 4) + ' more');
  const one = waiting.length === 1;
  return {
    waiting: waiting.map(w => w.id), due: true,
    note: { title: '⏰ ' + waiting.length + ' task' + (one ? '' : 's') + ' waiting for your Got it', body: lines.join('\n'), tag: 'todo-nudge', url: one ? '/todo/#t=' + waiting[0].id : '/todo/', sticky: true },
  };
}

async function main() {
  const now = Date.now(), dry = !!process.env.DRY_RUN;
  if (!process.env.ANYTIME && !workHours(now)) { console.log('Outside 8:00–18:00 New York on a weekday: nothing to do.'); return; }
  const raw = process.env.HUB_SERVICE_ACCOUNT;
  if (!raw) throw new Error('HUB_SERVICE_ACCOUNT is not set');
  const vk = vapidKeys(process.env.VAPID_PRIVATE_KEY || '');
  const { default: admin } = await import('firebase-admin');
  const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), databaseURL: process.env.HUB_DATABASE_URL || 'https://af-hub-8f188-default-rtdb.firebaseio.com' }, 'todo-remind');
  const root = app.database().ref(LIST);
  try {
    const [items, devices, nudge] = await Promise.all(['items', 'push', 'nudge'].map(k => root.child(k).once('value').then(s => s.val() || {})));
    const updates = {};
    // forget reminder times for tasks nobody is waiting on any more
    Object.keys(nudge).forEach(id => { const it = items[id]; if (!it || it.done || it.seen) updates['nudge/' + id] = null; });
    for (const to of PUSH_TO) {
      const p = plan(items, nudge, to, now);
      const subs = Object.entries(devices[to] || {}).filter(([, s]) => s && s.endpoint);
      console.log(`${to}: ${p.waiting.length} waiting for Got it, ${p.due ? 'time to ring' : 'not yet'}, ${subs.length} device(s)`);
      if (!p.due || !subs.length) continue;
      if (dry) { console.log('Dry run: nothing sent.'); continue; }
      let sent = 0;
      for (const [sid, s] of subs) {
        try {
          const r = await sendPush(s, p.note, vk, { ttl: 3600 });
          if (r.ok) sent++; else if (r.gone) updates['push/' + to + '/' + sid] = null; else console.log('a push service said', r.status);
        } catch (e) { console.log('push failed:', e.message); }
      }
      console.log(`rang ${sent} device(s)`);
      if (sent) p.waiting.forEach(id => { updates['nudge/' + id] = now; });
    }
    if (Object.keys(updates).length && !dry) await root.update(updates);
  } finally { await app.delete(); }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) main().catch(e => { console.error(e.message || e); process.exit(1); });
