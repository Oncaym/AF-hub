/* ============================================================
   🔔 To-do push (Leo 11-02: "需要 notifications 像 app 那样")
   ============================================================
   GET  /api/todo-push            → { key }  the public key a browser subscribes with
   POST /api/todo-push { token, ids: [taskId…] }
        Called by the page right after someone adds, hands over, notes or closes a task.
        Rings the other person's devices — today only Leo's (Leo 11-02: "先只给我").
   POST /api/todo-push { token, test: deviceId }   → a test notice to that one device
   POST /api/todo-push { token, call: 'ring' }     → 📣 Jaesik's "come to my office": rings Leo now
        (his page asks again every minute until Leo answers, at most 10 times)
   POST /api/todo-push { token, call: 'reply' }    → Leo's answer (on my way / 2 minutes / away
        from my desk) rings Jaesik's devices (Leo 11-06)

   What rings (Leo 11-02): a new task for him or one handed to him, any note Jaesik
   leaves, a task Jaesik closes (and a task Jaesik reopens that is Leo's turn).
   The message is built from the database, not from the request, and only for
   things done in the last 15 minutes by the person who calls.

   Who may call: whoever may read the shared list (the hub database rules decide —
   today only Leo and Jaesik). Devices are kept at todo/leo-jaesik/push/<who>/<deviceId>.
   env VAPID_PRIVATE_KEY (also a GitHub secret, for the reminders every ~2 h).
   ============================================================ */
import { vapidKeys, sendPush } from './_webpush.mjs';

const HUB_DB = 'https://af-hub-8f188-default-rtdb.firebaseio.com';
const LIST = 'todo/leo-jaesik';
const PEOPLE = { leo: { name: 'Leo', email: 'leosun@advfacade.com' }, jaesik: { name: 'Jaesik', email: 'jchang@advfacade.com' } };
export const PUSH_TO = ['leo'];          // whose devices ring (add 'jaesik' when he wants it too)
const FRESH = 15 * 60 * 1000;
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ID = /^[-A-Za-z0-9_]{1,40}$/;
// 📣 who calls whom (Leo 11-06: Jaesik calls Leo to his office)
export const CALLER = 'jaesik', CALLEE = 'leo';
const CALL_OPEN = 15 * 60 * 1000, RING_GAP = 45 * 1000, MAX_RINGS = 10;
export const REPLIES = {
  way: { title: '🏃 Leo: on my way' },
  two: { title: '⏱ Leo: there in 2 minutes' },
  away: { title: '🚶 Leo: away from my desk — coming as soon as I\'m back' },
};
const clock = ms => new Date(ms).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

/** The notice for an open call (n = rings so far), or null if there is nothing to ring for. */
export function callNotice(call, actor, now) {
  if (!call || call.by !== actor || actor !== CALLER || call.to !== CALLEE) return null;
  if (call.reply || call.closed || now - (call.at || 0) > CALL_OPEN) return null;
  const n = +call.rings || 0;
  if (n >= MAX_RINGS || (call.ringAt && now - call.ringAt < RING_GAP)) return null;
  return {
    title: '📣 ' + PEOPLE[CALLER].name + ': come to my office',
    body: (n ? 'Called at ' + clock(call.at) + ' · still waiting (' + (n + 1) + ')' : 'Called at ' + clock(call.at)) + '\nTap to answer: on my way / 2 minutes / away',
    tag: 'todo-call', url: '/todo/#call', sticky: true,
  };
}
/** The notice for Leo's answer, once per answer. */
export function replyNotice(call, actor, now) {
  if (!call || actor !== CALLEE || call.to !== actor || !REPLIES[call.reply] || call.replyBy !== actor) return null;
  if (call.closed || !call.replyAt || now - call.replyAt > 2 * 60 * 1000 || call.replyPushed === call.replyAt) return null;
  return { title: REPLIES[call.reply].title, body: 'Answered at ' + clock(call.replyAt) + ' (you called at ' + clock(call.at) + ')', tag: 'todo-call-reply', url: '/todo/#call', sticky: true };
}

const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
const label = it => (it.p ? '[' + it.p + '] ' : '') + short(it.what, 110);
const dueWord = iso => { const m = /^\d{4}-(\d\d)-(\d\d)$/.exec(iso || ''); return m ? ' · due ' + MON[+m[1] - 1] + ' ' + +m[2] : ''; };

/** Who signed in, from a token the database has just accepted. */
function whoIs(token) {
  try {
    const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
    const email = String(p.email || '').toLowerCase();
    return Object.keys(PEOPLE).find(k => PEOPLE[k].email === email) || null;
  } catch (e) { return null; }
}

/** What `actor` just did on task `it`, as a notice for `to` — or null if nothing to ring for. */
export function describe(id, it, actor, to, now) {
  if (!it || !it.what) return null;
  const who = PEOPLE[actor].name, url = '/todo/#t=' + id;
  const log = Object.values(it.log || {}).filter(e => e && e.at).sort((a, b) => a.at - b.at);
  const last = log[log.length - 1];
  if (last && last.at >= (it.at || 0)) {
    if (last.by !== actor || now - last.at > FRESH) return null;
    const said = last.text ? '\n' + who + ': ' + short(last.text, 300) : '';
    if (last.act === 'turn' && last.turn === to) return { title: '▶ Your turn — from ' + who, body: label(it) + dueWord(it.due) + said, tag: 'todo-' + id, url, sticky: true };
    if (last.act === 'close') return { title: '✅ ' + who + ' closed a task', body: label(it) + said, tag: 'todo-' + id, url };
    if (last.act === 'reopen') return it.to === to && !it.done ? { title: '↩ ' + who + ' reopened it — your turn', body: label(it), tag: 'todo-' + id, url, sticky: true } : null;
    if (last.text) return { title: '💬 ' + who + ' left a note', body: label(it) + said, tag: 'todo-' + id, url };
    return null;
  }
  // a new task: only one meant for `to`, written by the caller (a task you write for yourself is seen at once)
  if (it.to !== to || it.seen || it.done || it.by !== actor || now - (it.at || 0) > FRESH) return null;
  return { title: '📥 New from ' + who, body: label(it) + dueWord(it.due) + (it.note ? '\n' + short(it.note, 200) : ''), tag: 'todo-' + id, url, sticky: true };
}

/** Several at once (a handwritten page) → one notice. */
export function combine(list, actor) {
  if (list.length <= 1) return list[0] || null;
  const who = PEOPLE[actor].name;
  const lines = list.slice(0, 5).map(n => n.body.split('\n')[0]);
  if (list.length > 5) lines.push('+ ' + (list.length - 5) + ' more');
  return { title: '📥 ' + who + ': ' + list.length + ' updates for you', body: lines.join('\n'), tag: 'todo-batch', url: '/todo/', sticky: list.some(n => n.sticky) };
}

const get = (path, token) => fetch(`${HUB_DB}/${path}.json?auth=${encodeURIComponent(token)}`);

export default async function handler(req, res) {
  const priv = process.env.VAPID_PRIVATE_KEY;
  let vk = null;
  try { vk = priv ? vapidKeys(priv) : null; } catch (e) { vk = null; }
  if (req.method === 'GET') {
    res.setHeader('Cache-Control', 'no-store');
    return vk ? res.status(200).json({ key: vk.publicKey }) : res.status(500).json({ error: 'VAPID_PRIVATE_KEY is not set in the Vercel project' });
  }
  if (req.method !== 'POST') return res.status(405).json({ error: 'GET or POST' });
  if (!vk) return res.status(500).json({ error: 'VAPID_PRIVATE_KEY is not set in the Vercel project' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }
  const { token, ids, test, call } = body || {};
  if (!token || typeof token !== 'string' || token.length > 5000) return res.status(403).json({ error: 'Sign in again with your hub account.' });

  try {
    const pr = await get(LIST + '/push', token);   // also the check that this person may use the list
    if (!pr.ok) return res.status(403).json({ error: 'Sign in again with your hub account.' });
    const devices = (await pr.json()) || {};
    const actor = whoIs(token);
    if (!actor) return res.status(403).json({ error: 'This list is only for Leo and Jaesik.' });
    const now = Date.now();
    const ring = async (to, note, ttl) => {
      const subs = Object.entries(devices[to] || {}).filter(([sid, s]) => ID.test(sid) && s && s.endpoint);
      let sent = 0, gone = 0; const names = [];
      await Promise.all(subs.map(async ([sid, s]) => {
        try {
          const r = await sendPush(s, note, vk, { ttl });
          if (r.ok) { sent++; if (s.ua && !names.includes(s.ua)) names.push(String(s.ua).slice(0, 40)); }
          else if (r.gone) { gone++; await fetch(`${HUB_DB}/${LIST}/push/${to}/${sid}.json?auth=${encodeURIComponent(token)}`, { method: 'DELETE' }); }
          else console.error('push refused', r.status, new URL(s.endpoint).host);
        } catch (e) { console.error('push failed', e.message); }
      }));
      return { sent, gone, devices: subs.length, names };
    };
    const patchCall = v => fetch(`${HUB_DB}/${LIST}/call.json?auth=${encodeURIComponent(token)}`, { method: 'PATCH', body: JSON.stringify(v) });

    if (call === 'ring' || call === 'reply') {   // 📣 come to my office / the answer
      const cr = await get(LIST + '/call', token);
      const c = cr.ok ? await cr.json() : null;
      if (call === 'ring') {
        const note = callNotice(c, actor, now);
        if (!note) return res.status(200).json({ sent: 0, skipped: true });
        const r = await ring(CALLEE, note, 600);
        await patchCall({ ringAt: now, rings: (+c.rings || 0) + 1, sentTo: r.names.join(', ').slice(0, 200) });
        return res.status(200).json(r);
      }
      const note = replyNotice(c, actor, now);
      if (!note) return res.status(200).json({ sent: 0, skipped: true });
      const r = await ring(CALLER, note, 600);
      await patchCall({ replyPushed: c.replyAt });
      return res.status(200).json(r);
    }

    if (test) {   // "is this device on?" — only your own device
      const s = ID.test(String(test)) && (devices[actor] || {})[test];
      if (!s) return res.status(404).json({ error: 'This device is not saved yet. Tap 🔔 again.' });
      const body = actor === CALLER && !PUSH_TO.includes(actor)
        ? 'This device will ring when ' + PEOPLE[CALLEE].name + ' answers your call.'
        : 'This device will ring when ' + PEOPLE[actor === 'leo' ? 'jaesik' : 'leo'].name + ' gives you a task, leaves a note or closes one' + (actor === CALLEE ? ', or calls you to his office.' : '.');
      const r = await ring(actor, { title: '🔔 To-do notifications are on', body, tag: 'todo-test', url: '/todo/' }, 600);
      return res.status(200).json(r);
    }

    const list = (Array.isArray(ids) ? ids : []).map(String).filter(id => ID.test(id)).slice(0, 30);
    const targets = PUSH_TO.filter(k => k !== actor);
    if (!list.length || !targets.length) return res.status(200).json({ sent: 0 });
    const tasks = await Promise.all(list.map(id => get(LIST + '/items/' + id, token).then(r => (r.ok ? r.json() : null)).catch(() => null)));
    const out = {};
    for (const to of targets) {
      const notes = list.map((id, i) => describe(id, tasks[i], actor, to, now)).filter(Boolean);
      const note = combine(notes, actor);
      out[to] = note ? await ring(to, note, 86400) : { sent: 0 };
    }
    return res.status(200).json(out);
  } catch (e) {
    console.error('todo-push error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
