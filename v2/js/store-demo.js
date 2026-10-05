/* Demo backend — the whole app without Firebase. Data lives in memory and in
   this browser's localStorage, seeded from v2/seed/*.json. Used for ?demo and
   for the automated browser tests. Same interface as store-live.js. */
import { SEEDS, fetchSeed, splitSeed } from './seeds.js';

const KEY = 'afv2-demo-v1';
const ROLE_KEY = 'afv2-demo-role';

export function createDemoStore() {
  let data = { p: {}, changes: {} };
  let role = 'admin';
  try { role = localStorage.getItem(ROLE_KEY) || 'admin'; } catch (e) {}
  const listeners = new Set();
  const authCbs = new Set();
  const user = { uid: 'demo', email: 'demo@advfacade.com', name: 'Demo' };

  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(data)); } catch (e) {} };
  const emit = () => listeners.forEach(fn => fn());

  async function init() {
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) {}
    if (saved && saved.p) data = saved;
    for (const pid of SEEDS) {
      if (data.p[pid]) continue;
      try { const { meta, items } = splitSeed(await fetchSeed(pid)); data.p[pid] = { meta, items, issues: {} }; }
      catch (e) { console.warn('[demo] seed', pid, e.message); }
    }
    save();
    authCbs.forEach(cb => cb(user));
  }

  function record(pid, iid, f, from, to) {
    const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
    (data.changes[pid] = data.changes[pid] || {})[id] = { t: Date.now(), by: user.uid, n: user.name, iid, f, from: from ?? null, to: to ?? null };
  }

  return {
    mode: 'demo',
    init,
    get user() { return user; },
    onAuth(cb) { authCbs.add(cb); return () => authCbs.delete(cb); },
    access() {
      const roles = {};
      SEEDS.forEach(pid => { if (data.p[pid]) roles[pid] = role === 'exec' ? 'viewer' : role; });
      return { admin: role === 'admin', exec: role === 'exec', roles };
    },
    projectIds() { return SEEDS.filter(pid => data.p[pid]); },
    roleFor(pid) { return role === 'exec' ? 'exec' : role; },
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    project(pid) { return data.p[pid] || null; },
    changesFor(pid, iid) {
      return Object.values(data.changes[pid] || {}).filter(c => c.iid === iid).sort((a, b) => b.t - a.t).slice(0, 20);
    },
    async setStage(pid, iid, stage, d) {
      const it = data.p[pid].items[iid]; it.st = it.st || {};
      const from = it.st[stage] ? it.st[stage].d : null;
      if (d) it.st[stage] = { d, t: Date.now(), by: user.uid, n: user.name }; else delete it.st[stage];
      record(pid, iid, 'st.' + stage, from, d || null); save(); emit();
    },
    async setQty(pid, iid, n) {
      const it = data.p[pid].items[iid];
      const from = it.qd || 0; it.qd = n;
      record(pid, iid, 'qd', from, n); save(); emit();
    },
    async setIssue(pid, iid, text) {
      const cur = data.p[pid].issues[iid];
      if (text) data.p[pid].issues[iid] = { text, open: true, t: Date.now(), by: user.uid, n: user.name };
      else delete data.p[pid].issues[iid];
      record(pid, iid, 'issue', cur ? cur.text : null, text || null); save(); emit();
    },
    // demo-only
    get demoRole() { return role; },
    setDemoRole(r) { role = r; try { localStorage.setItem(ROLE_KEY, r); } catch (e) {} emit(); },
    resetDemo() { try { localStorage.removeItem(KEY); } catch (e) {} location.reload(); },
    // admin screens: nothing to load in demo
    async seedStatus() { return Object.fromEntries(SEEDS.map(p => [p, !!data.p[p]])); },
    async loadSeed() {},
    watchMembers(pid, cb) { cb({ demo: { role, email: user.email } }); return () => {}; },
    async invite() { throw new Error('Not available in the demo'); },
    legacy(cb) { cb({ cp2: { name: 'Cooper Park 2', pct: 64, ts: Date.now() - 3600e3, url: 'https://copper-park-2-install-progress-trac.vercel.app' } }); return () => {}; },
    async signOut() {}
  };
}
