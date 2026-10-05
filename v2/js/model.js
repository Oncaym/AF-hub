/* Pure functions over a project's data. No DOM, no Firebase — tested in Node.

   An item's lifecycle (design decisions, 2026-10-02):
     factory  — in our factory (everything except glass goes through it)
     site     — delivered to site
     installed
   Each stage is { d: 'YYYY-MM-DD', t: epoch ms, by: uid, n?: name }.
   A count item (guardrail posts, screen panels) also has qd = how many installed. */

export const STAGES = ['factory', 'site', 'installed'];

export function stageOf(item) {
  const st = (item && item.st) || {};
  if (st.installed) return 'installed';
  if (st.site) return 'site';
  if (st.factory) return 'factory';
  return 'none';
}

/* 0..1 — how much of this item is installed. A count item can be part-way. */
export function fractionOf(item) {
  if (!item) return 0;
  if (item.st && item.st.installed) return 1;
  const n = item.qty && item.qty.n;
  if (n > 0) return Math.max(0, Math.min(1, (Number(item.qd) || 0) / n));
  return 0;
}

export function scopesFor(meta) {
  return (meta && Array.isArray(meta.scopes)) ? meta.scopes : [];
}

/* Per-scope numbers. Counts are ITEMS (rows); a count scope also reports
   units (posts / panels) installed out of total. */
export function progress(meta, items) {
  const list = Object.values(items || {});
  const scopes = scopesFor(meta).map(s => ({
    key: s.key, label: s.label, labelZh: s.labelZh || s.label, factory: s.factory !== false, count: s.count || '',
    total: 0, installed: 0, site: 0, factory_: 0, none: 0, units: 0, unitsDone: 0, frac: 0
  }));
  const byKey = Object.fromEntries(scopes.map(s => [s.key, s]));
  let frac = 0;
  for (const it of list) {
    const s = byKey[it.scope];
    if (!s) continue;
    s.total++;
    const stage = stageOf(it);
    if (stage === 'installed') s.installed++;
    else if (stage === 'site') s.site++;
    else if (stage === 'factory') s.factory_++;
    else s.none++;
    const f = fractionOf(it);
    s.frac += f; frac += f;
    if (it.qty && it.qty.n) { s.units += it.qty.n; s.unitsDone += Math.round(f * it.qty.n); }
  }
  const total = scopes.reduce((a, s) => a + s.total, 0);
  return {
    scopes: scopes.filter(s => s.total > 0).concat(scopes.filter(s => s.total === 0)),
    total,
    installed: scopes.reduce((a, s) => a + s.installed, 0),
    site: scopes.reduce((a, s) => a + s.site, 0),
    factory: scopes.reduce((a, s) => a + s.factory_, 0),
    pct: total ? Math.round(100 * frac / total) : 0
  };
}

/* Installs in the last 7 days, by scope (by the stage's own date). */
export function thisWeek(meta, items, now = Date.now()) {
  const out = {};
  for (const it of Object.values(items || {})) {
    const d = it.st && it.st.installed && it.st.installed.d;
    if (!d) continue;
    const age = now - Date.parse(d);
    if (age >= 0 && age < 7 * 864e5) out[it.scope] = (out[it.scope] || 0) + 1;
  }
  return out;
}

export function today(now = new Date()) {
  const p = n => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;   // local date, what the crew means
}

/* Group items for the card list: by floor, then zone. */
export function groupItems(items, { floor, elev, q } = {}) {
  const needle = (q || '').trim().toLowerCase();
  const groups = new Map();
  for (const [id, it] of Object.entries(items || {})) {
    if (floor && it.floor !== floor) continue;
    if (elev && it.elev !== elev) continue;
    if (needle && !String(it.label).toLowerCase().includes(needle) && !id.toLowerCase().includes(needle)) continue;
    const g = it.zone || '—';
    if (!groups.has(g)) groups.set(g, []);
    groups.get(g).push([id, it]);
  }
  const natural = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true });
  for (const arr of groups.values()) arr.sort((a, b) => natural(a[1].label, b[1].label));
  return [...groups.entries()].sort((a, b) => natural(a[0], b[0]));
}

/* What a role may do. Mirrors the database rules — the rules are the real gate. */
export function can(role, action) {
  const R = {
    admin:  ['read', 'mark', 'edit', 'members', 'issues'],
    pm:     ['read', 'mark', 'edit', 'members', 'issues'],
    editor: ['read', 'mark', 'edit', 'issues'],
    field:  ['read', 'mark', 'issues'],
    viewer: ['read', 'issues:read'],
    exec:   ['read', 'issues:read'],
    gc:     []
  };
  return (R[role] || []).includes(action);
}

export const emailKey = e => String(e || '').trim().toLowerCase().replace(/\./g, ',');
