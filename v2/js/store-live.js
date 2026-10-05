/* Live backend — Firebase (project af-hub-8f188, the hub's own project).
   Everything v2 lives under /v2 in the Realtime Database; the old hub's
   /projects/{id}/summary is only read here (Cooper Park 2 is still on its old tracker).

   Layout (see rules/database.rules.json for who may read and write what):
     v2/admins/{uid}            true
     v2/staff/{uid}             'exec' | 'shop'      — see every project
     v2/index/{pid}             { name, code, pm, status }
     v2/members/{pid}/{uid}     { role, email }
     v2/my/{uid}/{pid}          role                 — so a person can list their projects
     v2/invitesByEmail/{ek}/{pid}  role              — claimed on sign-in (ek = email, '.' → ',')
     v2/p/{pid}/meta            name, scopes, floors, elevations …
     v2/p/{pid}/items/{iid}     the piece + st {factory|site|installed: {d,t,by,n}} + qd
     v2/p/{pid}/issues/{iid}    { text, open, t, by, n }
     v2/changes/{pid}/{cid}     append-only: { t, by, n, iid, f, from, to }

   Every write is a multi-path update that carries its change record, so a
   change and its history line land together or not at all. */
import { SEEDS, fetchSeed, splitSeed } from './seeds.js';
import { emailKey } from './model.js';

const V = '10.12.0';
const CDN = `https://www.gstatic.com/firebasejs/${V}`;

export async function createLiveStore(cfg) {
  const [{ initializeApp }, A, D] = await Promise.all([
    import(`${CDN}/firebase-app.js`), import(`${CDN}/firebase-auth.js`), import(`${CDN}/firebase-database.js`)
  ]);
  const app = initializeApp(cfg, 'afv2');
  const auth = A.getAuth(app);
  const db = D.getDatabase(app);
  const R = p => D.ref(db, p);

  let user = null, acc = { admin: false, exec: false, roles: {} }, visible = [];
  const proj = {};                 // pid -> { meta, items, issues }
  const changes = {};              // pid -> { cid: change }
  const subs = [];                 // unsubscribe fns for the signed-in session
  const listeners = new Set();
  const authCbs = new Set();
  const emit = () => listeners.forEach(fn => fn());
  const on = (path, cb, err) => { const off = D.onValue(R(path), s => cb(s.val()), e => { console.warn('[v2] read', path, e.code || e.message); if (err) err(e); }); subs.push(off); return off; };

  function watchProject(pid) {
    if (proj[pid]) return;
    proj[pid] = { meta: null, items: {}, issues: {} };
    on(`v2/p/${pid}/meta`, v => { proj[pid].meta = v; emit(); });
    on(`v2/p/${pid}/items`, v => { proj[pid].items = v || {}; emit(); });
    on(`v2/p/${pid}/issues`, v => { proj[pid].issues = v || {}; emit(); }, () => {});
    on(`v2/changes/${pid}`, v => { changes[pid] = v || {}; emit(); }, () => {});
  }
  function setVisible(list) {
    visible = list.filter(Boolean);
    visible.forEach(watchProject);
    emit();
  }

  /* Invites are keyed by email; a verified sign-in turns them into membership. */
  async function claimInvites() {
    if (!user.email || !user.emailVerified) return;
    const ek = emailKey(user.email);
    const snap = await D.get(R(`v2/invitesByEmail/${ek}`)).catch(() => null);
    const inv = snap && snap.val();
    if (!inv) return;
    const upd = {};
    for (const [pid, role] of Object.entries(inv)) {
      if (acc.roles[pid] === role) continue;
      upd[`v2/members/${pid}/${user.uid}`] = { role, email: user.email.toLowerCase() };
      upd[`v2/my/${user.uid}/${pid}`] = role;
    }
    if (Object.keys(upd).length) await D.update(R('/'), upd).catch(e => console.warn('[v2] claim', e.code || e.message));
  }

  function startSession() {
    let admin = false, exec = false, mine = {}, index = {};
    const recompute = () => {
      acc = { admin, exec, roles: { ...mine } };
      setVisible((admin || exec) ? Object.keys(index).sort((a, b) => SEEDS.indexOf(a) - SEEDS.indexOf(b)) : Object.keys(mine));
    };
    on(`v2/admins/${user.uid}`, v => { admin = v === true; if (admin || exec) watchIndex(); recompute(); }, () => {});
    on(`v2/staff/${user.uid}`, v => { exec = v === 'exec'; if (admin || exec) watchIndex(); recompute(); }, () => {});
    on(`v2/my/${user.uid}`, v => { mine = v || {}; recompute(); }, () => {});
    let indexOn = false;
    function watchIndex() { if (indexOn) return; indexOn = true; on('v2/index', v => { index = v || {}; recompute(); }, () => {}); }
    claimInvites();
  }

  /* Email-link sign-in comes back to this page with the code in the URL. */
  async function completeLinkIfAny(askEmail) {
    if (!A.isSignInWithEmailLink(auth, location.href)) return false;
    let email = null;
    try { email = localStorage.getItem('afv2-link-email'); } catch (e) {}
    if (!email) email = await askEmail();
    if (!email) return false;
    await A.signInWithEmailLink(auth, email, location.href);
    try { localStorage.removeItem('afv2-link-email'); } catch (e) {}
    history.replaceState(null, '', location.pathname + '#/');
    return true;
  }

  function record(pid, iid, f, from, to) {
    const key = D.push(R(`v2/changes/${pid}`)).key;
    return [`v2/changes/${pid}/${key}`, { t: D.serverTimestamp(), by: user.uid, n: user.name, iid, f, from: from ?? null, to: to ?? null }];
  }
  const write = upd => D.update(R('/'), upd);

  return {
    mode: 'live',
    async init({ askEmail } = {}) {
      await A.setPersistence(auth, A.browserLocalPersistence).catch(() => {});
      await completeLinkIfAny(askEmail).catch(e => console.warn('[v2] link', e.code || e.message));
      return new Promise(resolve => {
        let first = true;
        A.onAuthStateChanged(auth, u => {
          subs.splice(0).forEach(off => off());
          Object.keys(proj).forEach(k => delete proj[k]);
          user = (u && !u.isAnonymous) ? { uid: u.uid, email: u.email || '', name: u.displayName || (u.email || '').split('@')[0], emailVerified: u.emailVerified } : null;
          acc = { admin: false, exec: false, roles: {} }; visible = [];
          if (user) startSession();
          authCbs.forEach(cb => cb(user));
          emit();
          if (first) { first = false; resolve(); }
        });
      });
    },
    get user() { return user; },
    onAuth(cb) { authCbs.add(cb); return () => authCbs.delete(cb); },
    access() { return acc; },
    projectIds() { return visible; },
    roleFor(pid) { return acc.admin ? 'admin' : (acc.roles[pid] || (acc.exec ? 'exec' : null)); },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    project(pid) { return proj[pid] || null; },
    changesFor(pid, iid) {
      return Object.values(changes[pid] || {}).filter(c => c.iid === iid).sort((a, b) => (b.t || 0) - (a.t || 0)).slice(0, 20);
    },

    async setStage(pid, iid, stage, d) {
      const cur = proj[pid] && proj[pid].items[iid] && proj[pid].items[iid].st && proj[pid].items[iid].st[stage];
      const val = d ? { d, t: D.serverTimestamp(), by: user.uid, n: user.name } : null;
      const [ck, cv] = record(pid, iid, 'st.' + stage, cur ? cur.d : null, d || null);
      await write({ [`v2/p/${pid}/items/${iid}/st/${stage}`]: val, [ck]: cv });
    },
    async setQty(pid, iid, n) {
      const cur = proj[pid] && proj[pid].items[iid] && proj[pid].items[iid].qd;
      const [ck, cv] = record(pid, iid, 'qd', cur || 0, n);
      await write({ [`v2/p/${pid}/items/${iid}/qd`]: n, [ck]: cv });
    },
    async setIssue(pid, iid, text) {
      const cur = proj[pid] && proj[pid].issues[iid];
      const val = text ? { text, open: true, t: D.serverTimestamp(), by: user.uid, n: user.name } : null;
      const [ck, cv] = record(pid, iid, 'issue', cur ? cur.text : null, text || null);
      await write({ [`v2/p/${pid}/issues/${iid}`]: val, [ck]: cv });
    },

    // sign-in
    async sendLink(email) {
      await A.sendSignInLinkToEmail(auth, email, { url: location.origin + location.pathname, handleCodeInApp: true });
      try { localStorage.setItem('afv2-link-email', email); } catch (e) {}
    },
    signInPassword: (email, pw) => A.signInWithEmailAndPassword(auth, email, pw),
    signOut: () => A.signOut(auth),

    // admin
    async seedStatus() {
      const out = {};
      for (const pid of SEEDS) {
        const s = await D.get(R(`v2/index/${pid}`)).catch(() => null);
        out[pid] = !!(s && s.exists());
      }
      return out;
    },
    /* Loads a project from its seed — refuses if the project already exists, so a
       second click can never wipe real progress. */
    async loadSeed(pid) {
      const exists = await D.get(R(`v2/p/${pid}/meta`));
      if (exists.exists()) throw new Error(`${pid} is already loaded`);
      const { meta, items } = splitSeed(await fetchSeed(pid));
      await write({
        [`v2/p/${pid}/meta`]: { ...meta, loadedAt: D.serverTimestamp(), loadedBy: user.uid },
        [`v2/p/${pid}/items`]: items,
        [`v2/index/${pid}`]: { name: meta.name, code: meta.code, pm: meta.pm || '', status: meta.status || 'not-started' }
      });
    },
    watchMembers(pid, cb) { return on(`v2/members/${pid}`, v => cb(v || {}), () => cb({})); },
    async invite(pid, email, role) {
      await write({ [`v2/invitesByEmail/${emailKey(email)}/${pid}`]: role });
    },
    /* Bootstrap: the very first admin. The rules allow it once, for Leo's address only. */
    async claimFirstAdmin() { await D.set(R(`v2/admins/${user.uid}`), true); },

    legacy(cb) {
      const out = {};
      return on('projects/cp2/summary', v => { if (v) out.cp2 = v; cb(out); }, () => cb(out));
    }
  };
}
