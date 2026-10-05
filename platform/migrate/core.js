/* Pure helpers for platform/migrate/run.js — no Firebase in here, so they are
   unit-tested locally (platform/tests/migrate.test.cjs). */
'use strict';

// Nodes a tracker database may hold, and what the migration does with each.
const COPY_NODES = ['state', 'history', 'access', 'gcItems', 'triage', 'warehouse', 'allowlist', 'gcList', 'viewers'];
const SKIP_NODES = ['presence', 'meta'];   // presence is live-only; meta is written fresh

const emailKey = e => String(e || '').trim().toLowerCase().replace(/\./g, ',');
const keyEmail = k => String(k || '').replace(/,/g, '.');

/* Public repo → public Actions logs: never print a whole address. */
function maskEmail(e) {
  const s = String(e || '');
  const at = s.indexOf('@');
  if (at < 1) return '***';
  return s[0] + '***' + s.slice(at);
}
const isStaff = e => /@advfacade\.com$/i.test(String(e || ''));

/* Build the tree the project database will hold. Returns { tree, report }. */
function buildTree(src, { id, name, legacyURL, now }) {
  src = src || {};
  const tree = {};
  const report = { copied: {}, skipped: [], unknown: [] };
  for (const k of Object.keys(src)) {
    if (COPY_NODES.includes(k)) { tree[k] = clone(src[k]); report.copied[k] = describe(src[k]); }
    else if (SKIP_NODES.includes(k)) report.skipped.push(k);
    else { tree[k] = clone(src[k]); report.unknown.push(k); }   // kept, but no page can read it
  }
  if (tree.state && typeof tree.state === 'object') tree.state._project = id;
  tree.meta = { project: id, name: name || id, createdAt: now, migratedFrom: legacyURL || null, migratedAt: new Date(now).toISOString() };
  return { tree, report };
}

function describe(v) {
  if (v == null) return 'empty';
  if (typeof v !== 'object') return typeof v;
  const n = Array.isArray(v) ? v.length : Object.keys(v).length;
  const bytes = Buffer.byteLength(JSON.stringify(v));
  return `${n} entries, ${fmtBytes(bytes)}`;
}
function fmtBytes(b) { return b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(1) + ' KB' : (b / 1048576).toFixed(1) + ' MB'; }
function clone(v) { return v == null ? v : JSON.parse(JSON.stringify(v)); }

/* What a tracker's state holds, in numbers (for the log). */
function stateNumbers(state) {
  const s = state || {};
  const arr = v => (Array.isArray(v) ? v : v && typeof v === 'object' ? Object.values(v) : []);
  return {
    units: arr(s.units).length,
    installed: arr(s.units).filter(u => u && u.status === 'installed').length,
    log: arr(s.log).length,
    submittals: arr(s.submittals).length,
    rfis: arr(s.projectRfis || s.rfis).length,
    materials: arr(s.materials).length,
    elevations: s.elevations && typeof s.elevations === 'object' ? Object.keys(s.elevations).length : 0,
    dataUrlPhotos: (JSON.stringify(s).match(/"data:image\//g) || []).length,
  };
}

/* People on the project's lists, by role. */
function members(src) {
  const out = [];
  for (const [node, role] of [['allowlist', 'editor'], ['gcList', 'gc'], ['viewers', 'viewer']]) {
    const v = (src && src[node]) || {};
    for (const k of Object.keys(v)) if (v[k]) out.push({ email: keyEmail(k), key: k, role });
  }
  return out;
}

/* Storage download URLs that point at the OLD bucket. */
function storageUrls(tree, bucket) {
  const found = new Set();
  const esc = bucket.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp('https://firebasestorage\\.googleapis\\.com/v0/b/' + esc + '/o/[^"\\s\\\\]+', 'g');
  const json = JSON.stringify(tree);
  let m;
  while ((m = re.exec(json))) found.add(m[0]);
  return [...found];
}
/* Object path inside the bucket, from a download URL. */
function objectPath(url) {
  const m = /\/o\/([^?]+)/.exec(url);
  return m ? decodeURIComponent(m[1]) : null;
}
function downloadUrl(bucket, path, token) {
  return `https://firebasestorage.googleapis.com/v0/b/${bucket}/o/${encodeURIComponent(path)}?alt=media&token=${token}`;
}
/* Replace every old URL with its new one, anywhere in the tree (strings only). */
function rewriteUrls(tree, map) {
  if (!map || !Object.keys(map).length) return tree;
  const walk = v => {
    if (typeof v === 'string') return Object.prototype.hasOwnProperty.call(map, v) ? map[v] : v;
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') { const o = {}; for (const k of Object.keys(v)) o[k] = walk(v[k]); return o; }
    return v;
  };
  return walk(tree);
}

/* Order-independent comparison of two JSON trees. Returns a list of paths that differ.
   RTDB stores arrays as objects with numeric keys and drops empty values, so both
   sides are normalised the way the database would store them first. */
function normalise(v) {
  if (v === null || v === undefined || v === '') return v === '' ? '' : undefined;
  if (Array.isArray(v)) {
    const o = {};
    v.forEach((x, i) => { const n = normalise(x); if (n !== undefined) o[i] = n; });
    return Object.keys(o).length ? o : undefined;
  }
  if (typeof v === 'object') {
    const o = {};
    for (const k of Object.keys(v)) { const n = normalise(v[k]); if (n !== undefined) o[k] = n; }
    return Object.keys(o).length ? o : undefined;
  }
  return v;
}
function diff(a, b, path = '', out = [], limit = 50) {
  a = normalise(a); b = normalise(b);
  if (out.length >= limit) return out;
  if (a === undefined && b === undefined) return out;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) {
    if (a !== b) out.push(path || '/');
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) diff(a[k], b[k], path + '/' + k, out, limit);
  return out;
}

/* Split a large object into write batches under maxBytes each (the SDK refuses
   single writes over 16 MB). Returns [{ path, value }] relative to the given base. */
function batches(obj, maxBytes = 8 * 1048576, base = '') {
  const size = Buffer.byteLength(JSON.stringify(obj === undefined ? null : obj));
  if (size <= maxBytes || obj === null || typeof obj !== 'object') return [{ path: base || '/', value: obj }];
  const out = [];
  for (const k of Object.keys(obj)) out.push(...batches(obj[k], maxBytes, base + '/' + k));
  return out;
}

module.exports = { COPY_NODES, SKIP_NODES, emailKey, keyEmail, maskEmail, isStaff, buildTree, stateNumbers, members,
  storageUrls, objectPath, downloadUrl, rewriteUrls, diff, normalise, batches, fmtBytes, describe };
