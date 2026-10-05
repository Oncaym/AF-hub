/* ============================================================
   Hillview Reservoir — Kawneer Takeoff Tool — Logic
   ============================================================ */

const STORAGE_KEY = 'hillview-kawneer-takeoff-v2';
const PARTS_DB_VERSION = 20260820;   // bump reseeds parts + accessories from systems.js
// SYSTEMS & POSITIONS derived dynamically from parts data (with fallback defaults)
const DEFAULT_SYSTEMS = ['IR501T', '450'];
const DEFAULT_POSITIONS = ['Head', 'Jamb', 'Sill', 'Horizontal', 'Vertical', 'Transom Bar', 'Door Jamb', 'Door Jamb At Transom'];

// ============================================================
//  #whitelist (#2): keep each system's detected roles inside the roles that actually
//  belong to that system. One universal geometric detector emits generic roles
//  (Transom Bar / Door Jamb At Transom / Outside 90° Corner / Subsill …); without this,
//  a system like 45TU (which has no 'Door Jamb At Transom' or 'Outside 90° Corner') keeps
//  roles that don't exist for it. Allowed roles are derived straight from SYSTEM_DEFS
//  (parts.roles ∪ accessories.positions), so it self-configures and never touches a role
//  the system legitimately defines (e.g. 750XT's (X)/(wide) variants stay untouched).
//  Anything out-of-system is remapped to the nearest in-system role via ROLE_REMAP.
const ROLE_REMAP = {
  'Door Jamb At Transom': ['Door Jamb', 'Jamb', 'Vertical'],
  'Door Jamb':            ['Door Jamb', 'Jamb', 'Vertical'],
  'Outside 90° Corner':   ['Corner', 'Vertical', 'Jamb'],
  'Corner':               ['Corner', 'Outside 90° Corner', 'Vertical', 'Jamb'],
  'Transom Bar':          ['Transom Bar', 'Head', 'Horizontal'],
  'Subsill':              ['Subsill', 'Sill'],
  // #imp1-roles-retired (2026-08-20, Leo: "frame wise 不再需要区分 jamb/jamb (IMP-1)、
  // vertical/vertical (IMP-1) —— 原来两者的区别也只有 gasket，现在不这么算 gasket 了"):
  // the (IMP-1) variants are gone from SYSTEM_DEFS, so any legacy cut/pin still holding one
  // collapses straight back to its plain base role. The chains deliberately list ONLY the base
  // role — never the (X) louver variant — so a retired IMP-1 label can't be laundered into a
  // louver-zone role by the whitelist cascade.
  'Jamb (IMP-1)':         ['Jamb'],
  'Vertical (IMP-1)':     ['Vertical'],
  'Vertical (wide IMP-1)':['Vertical (wide)'],
  'Horizontal (Glass & Glass)': ['Horizontal (Glass & Glass)', 'Horizontal'],
};
const _allowedRolesCache = new Map();
function allowedRolesForSystem(system) {
  if (_allowedRolesCache.has(system)) return _allowedRolesCache.get(system);
  const def = (window.SYSTEM_DEFS || {})[system];
  const set = new Set();
  if (def) {
    for (const p of (def.parts || [])) for (const r of (p.roles || [])) set.add(r);
    for (const a of (def.accessories || [])) for (const r of (a.positions || [])) set.add(r);
  }
  _allowedRolesCache.set(system, set);
  return set;
}
// #recognized-roles (#2, 2026-07-20, Opus — HANDOFF-FOR-OPUS Task 2): Leo can curate a per-system
// list of the roles the classifier is allowed to output — `state.recognizedRoles[system]` (a plain
// array of role strings, edited from the left-sidebar "Recognized Roles" panel). This is the
// authoritative gate on top of the SYSTEM_DEFS-derived allowed set:
//   - If a manual list EXISTS for a system, it (∪ customRoles, so manual "+ Add Role" assignment is
//     never blocked) is the recognized set. A role Leo removes from it stops being produced by the
//     whitelist AND is dropped from any stale per-piece pin (see classifyRoles' pin pass) — that
//     pin drop is what finally stops a retired role from resurfacing on every re-import.
//   - If NO manual list exists for a system, behaviour is exactly as before (SYSTEM_DEFS set only),
//     so existing projects are unaffected until Leo opts in by curating a list.
// Kept separate from customRoles/"+ Add Role" (that only makes a role AVAILABLE for manual
// assignment; this gates what the AUTO-classifier may emit) — see PROPAGATION-DESIGN.md §17.
function recognizedRolesForSystem(system) {
  const manual = (typeof state !== 'undefined' && state.recognizedRoles) ? state.recognizedRoles[system] : null;
  // #imp1-roles-retired: a curated list saved before the (IMP-1) variants were retired would keep
  // re-admitting them through the whitelist gate, so they're filtered out (and their base role
  // added in their place) at read time — no migration of stored state needed.
  if (Array.isArray(manual)) {
    const out = new Set((state && state.customRoles) || []);
    for (const r of manual) out.add(normalizeImp1RoleToBase(r));
    return out;
  }
  return allowedRolesForSystem(system);
}
function hasManualRecognizedList(system) {
  return !!(typeof state !== 'undefined' && state.recognizedRoles && Array.isArray(state.recognizedRoles[system]));
}
// Remap any cut whose role isn't recognized for `system` to the nearest role that is.
function applyRoleWhitelist(cuts, system) {
  const allowed = recognizedRolesForSystem(system);
  if (!allowed.size) return;                 // unknown system → leave as-is
  for (const c of cuts) {
    if (!c || allowed.has(c.position)) continue;
    const chain = ROLE_REMAP[c.position];
    if (!chain) continue;                     // no known target → leave visible for manual fix
    for (const cand of chain) { if (allowed.has(cand)) { c.position = cand; break; } }
  }
}
function SYSTEMS_LIST() {
  const fromParts = Array.from(new Set((state.parts||[]).map(p => p.system).filter(Boolean)));
  return fromParts.length ? fromParts : DEFAULT_SYSTEMS.slice();
}
function POSITIONS_LIST() {
  const fromParts = Array.from(new Set((state.parts||[]).flatMap(p => p.roles||[])));
  // 自定义角色(报表 "+ Add Role" 建的): 还没挂到任何 part 上也要出现在
  // 角色表和 viewer 的位置下拉里,方便先给料改 role、后配零件。
  const custom = Array.from(new Set(state.customRoles || []));
  const all = Array.from(new Set(fromParts.concat(custom)));
  return all.length ? all : DEFAULT_POSITIONS.slice();
}
// #positions-per-system (2026-08-20, Leo: "45TU edit position 选项会出现 750XT 的 role。。。只给
// 45TU 的 positions"): POSITIONS_LIST() unions the roles of EVERY system, which is right for the
// parts table (one row can belong to any system) and wrong for the viewer's Position dropdown,
// where the piece already belongs to one. Offering 750XT's roles there is not just noise — picking
// one produces a role no 45TU part covers, so the piece silently drops out of the takeoff.
// `current` is always included, so an existing odd value is never lost just by opening the menu.
function POSITIONS_FOR(system, current) {
  const set = new Set();
  for (const p of (state.parts || [])) if (p.system === system) for (const r of (p.roles || [])) set.add(r);
  for (const a of (state.accessories || [])) if (a.system === system && !ACC_PART_REF_RULES.includes(a.rule) && a.rule !== 'per_panel')
    for (const r of (a.positions || [])) set.add(r);
  for (const r of (state.customRoles || [])) set.add(r);
  if (current) set.add(current);
  const out = [...set];
  return out.length ? out : POSITIONS_LIST();
}
// Back-compat aliases (Proxy so existing SYSTEMS.map / SYSTEMS.indexOf still work)
const SYSTEMS = new Proxy([], { get(_,k){ const a=SYSTEMS_LIST(); return typeof a[k]==='function'?a[k].bind(a):a[k]; } });
const POSITIONS = new Proxy([], { get(_,k){ const a=POSITIONS_LIST(); return typeof a[k]==='function'?a[k].bind(a):a[k]; } });
function wasteFactor(){ const p = (typeof state !== 'undefined' && state && state.wastePct != null) ? +state.wastePct : 20; return 1 + ((isFinite(p) ? p : 20) / 100); }   // #1: user-selectable waste %
function wastePctVal(){ return (typeof state !== 'undefined' && state && state.wastePct != null && isFinite(+state.wastePct)) ? +state.wastePct : 20; }
const STOCK_INCHES = 288; // 24 ft

// DXF layer-name config (can be overridden via setLayerConfig({alum:'...',...}))
let LAYER_CONFIG = {
  alum: 'AF_ALUM PROFILE',
  doorSubframe: 'AF-DOOR SUBFRAME',
  saddle: 'AF_SADDLE',        // #exploded-door: the threshold — only ever drawn under a door
  outline: 'AF_OUTLINE',
  scope: 'AF SCOPE',
  door: 'A-DOOR-1',
  fallbacks: ['0','AF_X'],
};
function setLayerConfig(cfg){ LAYER_CONFIG = Object.assign({}, LAYER_CONFIG, cfg||{}); save(); }
window.setLayerConfig = setLayerConfig;


// ---------- Default seed data ----------
// Seeded from user's parts CSV. Duplicate part numbers across positions are
// consolidated to a single row with multiple roles — required for
// part-centric aggregation (e.g. 575T217 carries Head + Jamb).
// 系统数据(parts/accessories)已抽到 systems.js 的 window.SYSTEM_DEFS。
// 这里只把它摊平成 SEED_PARTS / SEED_ACCESSORIES(自动补 system; id 在 clone 时生成)。
const SEED_PARTS = [];
const SEED_ACCESSORIES = [];
(function buildSeedFromDefs() {
  const defs = (typeof window !== 'undefined' && window.SYSTEM_DEFS) || {};
  const pref = (typeof window !== 'undefined' && window.SYSTEM_ORDER) || [];
  // 按 SYSTEM_ORDER 排, 其余(未列出的)按对象顺序补在后面
  const order = pref.filter(s => defs[s]).concat(Object.keys(defs).filter(s => !pref.includes(s)));
  for (const sys of order) {
    for (const p of (defs[sys].parts || [])) SEED_PARTS.push(Object.assign({ system: sys }, p));
    for (const a of (defs[sys].accessories || [])) SEED_ACCESSORIES.push(Object.assign({ system: sys }, a));
  }
})();

const SEED_OPENINGS = [];

// ---------- State ----------
function cloneSeedAccessories() {
  return SEED_ACCESSORIES.map(a => ({ ...a, id: uid(), positions: [...a.positions] }));
}

let state = load() || {
  partsDbVersion: PARTS_DB_VERSION,
  parts: cloneSeedParts(),
  openings: SEED_OPENINGS,
  accessories: cloneSeedAccessories(),
};
if (!Array.isArray(state.accessories)) state.accessories = cloneSeedAccessories();

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

// #reset-safety: refuse to persist a state that has lost hand-made records since the last write.
// Four separate fixes went into making the pin matcher cleverer while THIS was quietly deleting
// everything; a matcher cannot help with data that is no longer there.
let _lastEditCounts = null, _editsLossFlag = false;
function editRecordCounts() {
  return { elevEdits: Object.keys(state.elevEdits || {}).length,
           rolePins: Object.keys(state.rolePins || {}).length,
           panelEdits: Object.keys(state.panelEdits || {}).length,
           roleTemplates: (state.roleTemplates || []).length };
}
function save() {
  try {
    state.partsDbVersion = PARTS_DB_VERSION;
    const now = editRecordCounts();
    const lost = _lastEditCounts ? Object.keys(now).filter(k => now[k] < _lastEditCounts[k]) : [];
    if (lost.length) {
      // Records went DOWN. Keep whatever the backup already holds — it is the fuller version — and
      // say so loudly instead of quietly overwriting it with the diminished one.
      console.warn('[state] this write drops hand-made records:',
        lost.map(k => `${k} ${_lastEditCounts[k]} → ${now[k]}`).join(', '),
        '— the fuller version is stashed; use "↺ Restore my edits" in the Parts Database header.');
      _editsLossFlag = true;
    } else {
      backupUserEdits();   // high-water mark: only ever refreshed when nothing was lost
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    _lastEditCounts = now;
  } catch(e){}
}
function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || !Array.isArray(parsed.parts) || !Array.isArray(parsed.openings)) return null;
    parsed.openings = parsed.openings.map(o => ({
      ...o,
      system: o.system === '451T' ? '450' : o.system,
    }));
    if (parsed.partsDbVersion !== PARTS_DB_VERSION) {
      parsed.parts = cloneSeedParts();
      parsed.accessories = cloneSeedAccessories();   // 配件也随版本重灌(已改为按系统分)
      parsed.partsDbVersion = PARTS_DB_VERSION;
    }
    // 旧数据兼容: 配件缺 system 字段的, 视为通用(沿用旧全局行为, 不限系统)
    if (Array.isArray(parsed.accessories)) {
      for (const a of parsed.accessories) if (a.system === undefined) a.system = '';
    }
    return parsed;
  } catch(e) { return null; }
}

function cloneSeedParts() {
  return SEED_PARTS.map(p => ({ ...p, id: uid(), roles: [...p.roles] }));
}

// ---------- ICON helper ----------
function ico(name, cls = 'ico') {
  const paths = {
    plus:    '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
    trash:   '<path d="M3 6h18M8 6V4a2 2 0 012-2h4a2 2 0 012 2v2m3 0v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6"/>',
    download:'<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M7 10l5 5 5-5M12 15V3"/>',
    copy:    '<rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 01-2-2V4a2 2 0 012-2h9a2 2 0 012 2v1"/>',
    reset:   '<path d="M3 12a9 9 0 1015.7-6.1L21 3M21 3v6h-6"/>',
    upload:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4M17 8l-5-5-5 5M12 3v12"/>',
    fileText:'<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><path d="M14 2v6h6M16 13H8M16 17H8M10 9H8"/>',
    inbox:   '<polyline points="22 12 16 12 14 15 10 15 8 12 2 12"/><path d="M5.45 5.11L2 12v6a2 2 0 002 2h16a2 2 0 002-2v-6l-3.45-6.89A2 2 0 0016.76 4H7.24a2 2 0 00-1.79 1.11z"/>',
    table:   '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M3 9h18M3 15h18M9 3v18M15 3v18"/>',
    eye:     '<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/>',
  };
  const d = paths[name] || '';
  return `<svg class="${cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="square" stroke-linejoin="miter" aria-hidden="true">${d}</svg>`;
}

// ============================================================
//  RENDER
// ============================================================
// #parts-prune (2026-08-20, Leo: "750XT 里面所有 role 里的 E1-0120 和 E1-0127 都删掉，现在用新的
// 方法算 gasket"): E1-0120/E1-0127 were hand-added to the CLOUD parts library as per-role line
// items back when the gasket was taken off by framing role. They are not in systems.js, so
// deleting them there would do nothing — the cloud copy overwrites local on every snapshot.
// This is a standing sanitizer instead of a one-shot migration for exactly that reason: it runs
// on every render, and the first time it sees the stale rows it strips them and pushes the clean
// 750XT doc back up (deferred to a macrotask so the write lands after cloud-sync's applyingRemote
// guard has cleared). Once the cloud is clean it is a no-op forever. Same pass drops the retired
// (IMP-1) role variants from any part's roles[].
// #gasket-parts-retired (2026-08-20, Leo: "part# 里为什么还有两个 gaskets / 现在使用 gasket
// diagram 里面的算法算"): the gasket part numbers were also sitting in the 750XT PARTS library
// with framing roles (HEAD (GLASS), JAMB, VERTICAL …), so the order list was billing them a
// second time off member run-length — 2,598" of E2-0120 and 6,297" of E2-0127 that have nothing
// to do with the panel takeoff. Gasket comes from the gasket diagram and ONLY from there, so all
// four numbers are struck from the parts library. (E1-0120 still appears in the takeoff, but as
// the computed door run — an accessory row, not a role-based part.)
// #setting-block-not-stock (2026-08-20): E1-3603 (setting block chair) and E2-0513 (setting block)
// were sitting in the 750XT PARTS library with roles, so the tool was cutting them out of 24′ bar —
// 48 sticks of setting block. They are loose blocks, and they are now accessory rules instead
// (run length along the lower member of each lite, per Leo). Left in the parts library they would
// be billed twice, and they would keep appearing on the cutting diagram.
// They are also the wrong part numbers for AC3: those are the 1" glazing numbers and AC3 glazing is
// 1-1/16", which YKK 04-4014-25 does not publish — the accessory rows carry the names with the
// part number deliberately blank until Leo has them.
const RETIRED_PARTS = { '750XT': ['E1-0120', 'E1-0127', 'E2-0120', 'E2-0127', 'E1-3603', 'E2-0513'] };
function pruneRetiredParts() {
  if (typeof state === 'undefined' || !Array.isArray(state.parts)) return false;
  const before = state.parts.length;
  state.parts = state.parts.filter(p => {
    const kill = RETIRED_PARTS[p.system];
    return !(kill && kill.includes(String(p.partNumber || '').trim()));
  });
  let changed = state.parts.length !== before;
  for (const p of state.parts) {
    if (!Array.isArray(p.roles)) continue;
    const next = Array.from(new Set(p.roles.map(normalizeImp1RoleToBase)));
    if (next.length !== p.roles.length || next.some((r, i) => r !== p.roles[i])) { p.roles = next; changed = true; }
  }
  return changed;
}
// #acc-wash (2026-08-20, Leo: "不用管我原来的规则，用新的规则全部洗一遍"): the 750XT accessory
// rules are owned by systems.js. Not merged with what the cloud holds, not reconciled row by row —
// replaced outright with the seeded set derived from YKK 04-4014-25.
//
// The gate is PRESENCE, not a version stamp. The version stamp was tried first and failed for a
// reason worth remembering: it made the wash strictly one-shot per browser, and that one shot fired
// at page load — BEFORE the Firestore snapshot arrived. The snapshot then put the old rows back,
// the stamp said "already washed", and the tool sat there with the stale set forever. Anything
// gated on "have I done this yet" loses that race by construction.
//
// Presence cannot lose it: if any seeded part number is missing from the 750XT set, the set is
// stale, whatever put it there and whenever it arrived — so wash and push. Once the cloud holds the
// seeded set every part number is present, the wash stops firing, and hand edits to a rule's param
// survive (presence is tested, not equality). Deleting a seeded rule outright brings it back on the
// next render — these are manual-backed rules, so that is the intended behaviour; change them in
// systems.js, or edit the param in place.
// Systems whose accessory rules systems.js owns outright. IR501T / 450 / 1600 are left alone —
// their rules were never curated here and washing them would throw away whatever is in the cloud.
const ACC_OWNED_SYSTEMS = ['750XT', '45TU'];
function washSeedAccessories() {
  if (typeof state === 'undefined' || !Array.isArray(state.accessories)) return false;
  let any = false;
  for (const sys of ACC_OWNED_SYSTEMS) any = washSeedAccessoriesFor(sys) || any;
  return any;
}
function washSeedAccessoriesFor(sysName) {
  const seed = SEED_ACCESSORIES.filter(a => a.system === sysName);
  if (!seed.length) return false;
  // The key carries the rule's STRUCTURE — which part, which rule type, what it reads — but not
  // `param`/`min`. So changing a rule in systems.js (per_lf → per_panel, or a different role list)
  // propagates to everyone, while the magnitudes stay Leo's to tune in the table. Structure from
  // systems.js, numbers from Leo.
  const sig = a => [String(a.partNumber || a.description || '').trim().toUpperCase(), a.rule,
                    (a.positions || []).map(p => String(p).trim().toLowerCase()).sort().join(',')].join('|');
  const have = new Set(state.accessories.filter(a => a.system === sysName).map(sig));
  const missing = seed.filter(d => !have.has(sig(d)));
  if (!missing.length) return false;                       // the seeded set is installed — leave it alone
  const before = state.accessories.filter(a => a.system === sysName).length;
  // Out: every rule of THIS system, and every legacy blank-system rule. Blank-system rows predate
  // per-system rules, so they apply to EVERY opening — a blank-system "Glazing Gasket" bills itself
  // on top of the per-system rule doing the same job. Other systems are untouched.
  state.accessories = state.accessories.filter(a => a.system !== sysName && String(a.system || '') !== '');
  for (const def of seed) state.accessories.push({ ...def, id: uid(), positions: [...def.positions] });
  console.log(`[accessories] ${sysName} ruleset was stale (missing/changed: ${missing.map(d => d.partNumber || d.description).join(', ')}) — `
    + `replaced ${before} row(s) with the ${seed.length} rules from systems.js`);
  return true;
}
// Standing guard: a row with no system AND no part number can never be ordered and always
// duplicates a named rule. Applies to every system, and runs whether or not the wash fired.
function pruneLegacyAccessories() {
  if (typeof state === 'undefined' || !Array.isArray(state.accessories)) return false;
  const before = state.accessories.length;
  state.accessories = state.accessories.filter(a => !(String(a.system || '') === '' && !String(a.partNumber || '').trim()));
  if (state.accessories.length === before) return false;
  console.log(`[accessories] dropped ${before - state.accessories.length} unnamed legacy row(s)`);
  return true;
}
function renderAll() {
  if (washSeedAccessories() | pruneLegacyAccessories()) {
    setTimeout(() => { try { save(); } catch (_) {} }, 0);
  }
  if (pruneRetiredParts()) {
    console.log('[parts] pruned retired 750XT gasket parts / (IMP-1) roles — pushing clean library');
    setTimeout(() => { try { save(); } catch (_) {} }, 0);
  }
  renderEditsSafety();
  renderParts();
  renderOpenings();
  renderReport();
  renderMeta();
  renderRecognizedRoles();
  renderRoleTemplates();
  save();
}

// #edits-file (2026-09-04): the browser is not a safe place to keep a month of work, and Leo's
// gaps between jobs are longer than a browser keeps anything. Everything hand-made goes out as one
// small JSON file he can keep beside the DXFs, and comes back on any machine.
function exportUserEdits() {
  const snap = snapshotUserEdits();
  const n = editRecordCounts();
  const payload = { kind: 'af-takeoff-edits', version: 1, exportedAt: new Date().toISOString(),
                    project: xlProjectName(), counts: n, data: snap };
  download(`${xlProjectName()} takeoff edits.json`, JSON.stringify(payload, null, 1), 'application/json');
  const st = document.getElementById('export-status');
  if (st) { st.textContent = `Exported ${n.elevEdits} saved elevation(s), ${n.rolePins} pinned mark(s), ${n.panelEdits} panel map(s), ${n.roleTemplates} template(s)`; st.className = 'tk-dxf__status is-ok'; }
}
function importUserEdits(text) {
  let p; try { p = JSON.parse(text); } catch (_) { alert('That file is not readable JSON.'); return; }
  if (!p || p.kind !== 'af-takeoff-edits' || !p.data) { alert('That is not a takeoff edits file.'); return; }
  const c = p.counts || {};
  if (!confirm(`Import hand-made edits exported ${new Date(p.exportedAt).toLocaleString()}?\n\n`
    + `${c.elevEdits || 0} saved elevation(s), ${c.rolePins || 0} pinned mark(s), ${c.panelEdits || 0} panel map(s), ${c.roleTemplates || 0} template(s).\n\n`
    + 'Marks in the file replace the same marks here. Marks only present here are left alone.')) return;
  for (const k of USER_AUTHORED_STATE_KEYS) {
    const v = p.data[k];
    if (v == null) continue;
    if (Array.isArray(v)) state[k] = v;
    else if (typeof v === 'object') state[k] = Object.assign({}, state[k] || {}, v);
    else state[k] = v;
  }
  save(); renderAll();
  const st = document.getElementById('export-status');
  if (st) { st.textContent = 'Edits imported — re-import the DXFs to apply them to the elevations.'; st.className = 'tk-dxf__status is-ok'; }
}

// #reset-safety: the restore control, and a standing warning when a write has dropped records.
function renderEditsSafety() {
  const host = document.getElementById('edits-safety');
  if (!host) return;
  const n = editRecordCounts();
  // One number, not four. "3 marks with role pins · 13 panel maps · 1 template" made Leo say
  // "我已经不会用了" — and he was right: a status line you have to decode is not a status line.
  const marks = new Set([...Object.keys(state.elevEdits || {}), ...Object.keys(state.rolePins || {}),
                         ...Object.keys(state.panelEdits || {})]).size;
  const b = readEditsBackup();
  const canUndo = b && b.marks > marks;
  host.innerHTML = `
    ${canUndo ? `<div style="margin:0 16px 8px;padding:10px 12px;border-radius:8px;background:#7c2d12;color:#fed7aa;font-size:13px;">
      <b>Some of your saved work is missing.</b> This browser now has ${marks} mark${marks === 1 ? '' : 's'};
      the last good copy had <b>${b.marks}</b>, from ${new Date(b.at).toLocaleString()}.
      <button class="tk-btn tk-btn--accent tk-btn--sm" id="edits-restore" style="margin-left:8px;">↺ Bring it back</button>
    </div>` : ''}
    <div style="display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:6px 16px;font-size:12px;">
      <span style="color:var(--af-fg-3,#888);">Your saved work: <b>${marks}</b> mark${marks === 1 ? '' : 's'}</span>
      <button class="tk-btn tk-btn--accent tk-btn--sm" id="edits-export" title="Save everything you have corrected by hand into one file. Keep it beside the DXFs — it does not depend on this browser.">⬇ Back up to a file</button>
      <input id="edits-file" type="file" accept=".json,application/json" hidden />
      <button class="tk-btn tk-btn--ghost tk-btn--sm" id="edits-import" title="Load a backup file made by the button on its left">⬆ Restore from a file</button>
    </div>`;
}
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (e.target.closest('#edits-restore')) { _editsLossFlag = false; restoreEditsBackup(); }
  else if (e.target.closest('#edits-export')) exportUserEdits();
  else if (e.target.closest('#edits-import')) { const f = document.getElementById('edits-file'); if (f) f.click(); }
});
document.addEventListener('change', e => {
  if (!e.target || e.target.id !== 'edits-file') return;
  const f = e.target.files && e.target.files[0];
  if (!f) return;
  const r = new FileReader();
  r.onload = () => importUserEdits(String(r.result || ''));
  r.readAsText(f);
  e.target.value = '';
});

// ---------- Recognized Roles panel (#2, 2026-07-20 Opus) ----------
let _rrSystem = null;  // which system the panel is currently showing
function renderRecognizedRoles() {
  const sel = document.getElementById('rr-system');
  const body = document.getElementById('rr-body');
  if (!sel || !body) return;
  const systems = SYSTEMS_LIST();
  if (_rrSystem == null || !systems.includes(_rrSystem)) _rrSystem = systems[0] || null;
  sel.innerHTML = systems.map(s => `<option value="${escHtml(s)}"${s === _rrSystem ? ' selected' : ''}>${escHtml(s)}</option>`).join('');
  if (!_rrSystem) { body.innerHTML = '<p class="tk-section__sub">No systems defined yet — add parts first.</p>'; return; }
  const curated = hasManualRecognizedList(_rrSystem);
  const roles = curated
    ? (state.recognizedRoles[_rrSystem] || [])
    : Array.from(allowedRolesForSystem(_rrSystem));
  const chips = roles.slice().sort().map(r =>
    `<span class="tk-chip" data-role="${escHtml(r)}" style="display:inline-flex;align-items:center;gap:6px;margin:3px;padding:4px 8px;border:1px solid var(--af-border,#ccc);border-radius:14px;font-size:12px;">
       ${escHtml(r)}
       ${curated ? `<button type="button" class="rr-del" data-role="${escHtml(r)}" title="Retire this role" style="border:none;background:none;cursor:pointer;font-size:14px;line-height:1;color:var(--af-fg-3,#999);">×</button>` : ''}
     </span>`).join('');
  body.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;align-items:center;gap:2px;">${chips || '<span class="tk-section__sub">(no roles)</span>'}</div>
    <div class="tk-addbar" style="margin-top:10px;display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
      ${curated
        ? `<input id="rr-add" type="text" class="tk-input tk-input--sm" placeholder="Add a role (exact name)" style="min-width:200px;" />
           <button class="tk-btn tk-btn--dark tk-btn--sm" id="rr-add-btn">Add role</button>
           <button class="tk-btn tk-btn--ghost tk-btn--sm" id="rr-reset" title="Revert to the full parts-derived set (removes the manual restriction)">Reset to default</button>`
        : `<span class="tk-section__sub" style="margin:0;">Showing the full parts-derived set for <b>${escHtml(_rrSystem)}</b> (uncurated).</span>
           <button class="tk-btn tk-btn--dark tk-btn--sm" id="rr-curate" title="Start curating: seeds the list from the current set so you can remove retired roles">Curate this system</button>`}
    </div>`;
}

// ---------- Template controls (#template, §16) ----------
// Row shown inside the Elevation Viewer: save this elevation as a template, and (if any saved
// template matches this elevation's fill layout) pick + apply one.
function templateControlsHtml(o) {
  if (!o || !o._bands) {
    return `<div style="margin:6px 0;font-size:11px;color:#999;">🧩 Templates need a DXF-parsed elevation (no geometry on a hand-added opening).</div>`;
  }
  const seq = openingFillSequence(o);
  const isManual = Array.isArray(o.fillLayout) && o.fillLayout.length;
  const matches = templatesMatchingOpening(o);
  let h = `<div style="margin:6px 0;font-size:12px;display:flex;flex-wrap:wrap;gap:8px;align-items:center;">
    <span style="color:#999;">🧩 Fill layout (top→bottom):</span>
    <input id="vc-fill-layout" class="tk-cell-input" value="${escAttr(seq)}" spellcheck="false" title="Fill order top→bottom, separated by > — e.g. louver>imp-1>glass>glass. Edit to correct auto-detection; this is what templates match on." style="min-width:240px;font-family:var(--af-font-mono,monospace);" />
    <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-fill-auto" title="Reset to the auto-detected fill layout">↺ Auto</button>
    <span style="color:${isManual ? '#2a8a4a' : '#999'};">(${isManual ? 'manual' : 'auto'})</span>
    <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-save-template" title="Save this elevation's fill layout + every member's role as a reusable template">💾 Save as Template</button>`;
  if (matches.length) {
    h += `<select id="vc-template-pick" class="tk-cell-select">${matches.map(t => `<option value="${escAttr(t.id)}">${escHtml(t.name)}</option>`).join('')}</select>
      <button class="tk-btn tk-btn--dark tk-btn--sm" id="vc-apply-template" title="Preview, then apply the selected template's roles to this elevation">Apply Template</button>`;
  } else {
    h += `<span style="color:#999;">(no saved template matches this layout)</span>`;
  }
  return h + `</div>`;
}

// ---------- Templates management list (#template, §16) ----------
function renderRoleTemplates() {
  const host = document.getElementById('tmpl-list');
  if (!host) return;
  const tmpls = state.roleTemplates || [];
  if (!tmpls.length) { host.innerHTML = '<p class="tk-section__sub">No templates yet. Open a correctly-classified elevation in the viewer and click "Save as Template".</p>'; return; }
  host.innerHTML = tmpls.map(t => `
    <div style="display:flex;align-items:center;gap:10px;padding:6px 4px;border-bottom:1px solid var(--af-line,#eee);font-size:12px;">
      <b>${escHtml(t.name)}</b>
      <span style="color:#999;">${escHtml(t.system)} · ${escHtml(t.fillSequence)} · ${(t.members||[]).length} slots</span>
      <button class="tk-btn tk-btn--ghost tk-btn--sm tmpl-del" data-tmpl="${escAttr(t.id)}" title="Delete this template" style="margin-left:auto;">Delete</button>
    </div>`).join('');
}

// ---------- Parts Database ----------
function partRowHtml(p) {
  return `
    <tr data-id="${p.id}">
      <td class="col-sys">
        <select class="tk-cell-select" data-field="system">
          ${SYSTEMS.map(s => `<option value="${s}" ${s===p.system?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td class="col-pn">
        <input class="tk-cell-input mono" data-field="partNumber" value="${escAttr(p.partNumber)}" placeholder="Part #" />
      </td>
      <td>
        <input class="tk-cell-input" data-field="description" value="${escAttr(p.description)}" placeholder="Description" />
      </td>
      <td class="col-roles">
        <div class="tk-roles" data-field="roles">
          <span class="tk-role ${p.continuous?'is-on':''}" data-cont="1" style="border-style:dashed;" title="Continuous part: cut lengths merged across the full run (adjacent same-row segments span mullions and merge into one, e.g. C Face Cover runs continuously over the sill). Toggle syncs with the cloud parts library.">↔ Continuous</span>
          ${POSITIONS.map(pos => `<span class="tk-role ${p.roles.includes(pos)?'is-on':''}" data-role="${pos}">${pos}</span>`).join('')}
        </div>
      </td>
      <td class="tk-rowdel">
        <button class="tk-rowdel-btn" data-action="del-part" title="Delete row">${ico('trash')}</button>
      </td>
    </tr>`;
}

// 零件表按系统折叠; 默认只展开"当前在用系统"(有 opening 的); 用户点标题可切换。
let _partsExpandInit = false;
const partsExpanded = new Set();
function renderParts() {
  const tbody = document.getElementById('parts-tbody');
  if (!state.parts.length) {
    tbody.innerHTML = `<tr class="is-empty"><td colspan="6">No parts defined — add a row to begin.</td></tr>`;
    return;
  }
  const systems = SYSTEMS_LIST();
  _partsExpandInit = true;   // #2: default all system groups collapsed (no auto-expand)
  const bySys = {};
  for (const p of state.parts) (bySys[p.system] = bySys[p.system] || []).push(p);
  const order = systems.concat(Object.keys(bySys).filter(s => !systems.includes(s)));
  let html = '';
  for (const sys of order) {
    const parts = bySys[sys];
    if (!parts || !parts.length) continue;
    const open = partsExpanded.has(sys);
    html += `<tr class="sys-group" data-sysgroup="${escAttr(sys)}"><td colspan="6" style="cursor:pointer; font-weight:600; background:var(--af-bg-2,#f1f1f1); user-select:none;">${open ? '▾' : '▸'} ${escHtml(sys || '(no system)')} <span style="color:var(--af-fg-3); font-weight:400;">· ${parts.length} parts</span></td></tr>`;
    if (open) for (const p of parts) html += partRowHtml(p);
  }
  tbody.innerHTML = html;
}

// ---------- Openings (Cut Schedule by opening) ----------
function renderOpenings() {
  const tbody = document.getElementById('openings-tbody');
  if (!state.openings.length) {
    tbody.innerHTML = `<tr class="is-empty"><td colspan="10">No openings yet — add one below, or paste a schedule into the DXF box.</td></tr>`;
    return;
  }
  tbody.innerHTML = state.openings.map(o => `
    <tr data-id="${o.id}">
      <td class="col-mark"><input class="tk-cell-input mono" data-field="mark" value="${escAttr(o.mark)}" placeholder="SF-01" /></td>
      <td class="col-sys">
        <select class="tk-cell-select" data-field="system">
          ${SYSTEMS.map(s => `<option value="${s}" ${s===o.system?'selected':''}>${s}</option>`).join('')}
        </select>
      </td>
      <td class="col-num-sm"><input class="tk-cell-input num" data-field="qty" type="number" min="1" step="1" value="${o.qty}" /></td>
      <td class="col-num"><input class="tk-cell-input num" data-field="width"  type="number" min="0" step="0.125" value="${o.width}"  /></td>
      <td class="col-num"><input class="tk-cell-input num" data-field="height" type="number" min="0" step="0.125" value="${o.height}" /></td>
      <td class="col-num-sm"><input class="tk-cell-input num" data-field="horiz" type="number" min="0" step="1" value="${o.horiz||0}" title="Intermediate horizontals (full-width cuts)" /></td>
      <td class="col-num-sm"><input class="tk-cell-input num" data-field="vert"  type="number" min="0" step="1" value="${o.vert||0}"  title="Intermediate verticals (full-height cuts)" /></td>
      <td class="col-num-sm"><input class="tk-cell-input num" data-field="lites" type="number" min="0" step="1" value="${o.lites||0}" title="Glass lites (auto from VISION GLASS MARK; editable)" /></td>
      <td class="col-num"><span class="tk-cell-input num" style="color:var(--af-fg-3); font-size:11.5px;">${formatNumber(openingTotalInches(o))}"</span></td>
      <td class="tk-rowdel">
        <button class="tk-rowdel-btn" data-action="view-opening" title="View elevation (traceback)">${ico('eye')}</button>
        <button class="tk-rowdel-btn" data-action="del-opening" title="Delete row">${ico('trash')}</button>
      </td>
    </tr>
  `).join('');
}

// ---------- Elevation Viewer (traceback: cut → source polyline) ----------
// 配色与手算图例一致
const POSITION_COLORS = {
  'Head': '#e6c700', 'Jamb': '#00b400', 'Sill': '#e00000', 'Horizontal': '#00b4b4',
  'Door Jamb At Transom': '#0000e0', 'Transom Bar': '#000000', 'Vertical': '#9898cc',
  'Door Jamb': '#e000e0', 'Outside 90° Corner': '#808080', 'Subsill': '#f26722',
  // (X)/(Lv)/(wide) 变体(AC3 louver/宽竖梃)——用未被占用的新色系,任何 system 下都不再灰。
  'Head (X)': '#8a5a2b',        // 棕
  'Sill (X)': '#6a2ca0',        // 深紫
  'Jamb (X)': '#ff7eb6',        // 粉
  'Horizontal (X)': '#9a9a00',  // 橄榄
  'Vertical (Lv)': '#37b6ff',   // 天蓝
  'Vertical (X)': '#ff8ac2',    // 粉(金属板带段)
  'Vertical (wide)': '#0e7a5a', // 墨绿
  'Vertical (wide X)': '#7a4df0', // 蓝紫
  'Sill (normal)': '#00bcd4',   // 青
};

// 1600 系统(两种尺寸):只分 4 类。Head/Sill/Transom Bar 用同一种颜色(周边横料)。
function is1600(system) { return /^1600/.test(String(system || '')); }
const COLOR_1600 = {
  'Head': '#e6c700', 'Sill': '#e6c700', 'Transom Bar': '#e6c700', // 周边横料(黄)
  'Horizontal': '#00b4b4',                                        // 中间横料(青)
  'Jamb': '#00b400',                                              // 周边竖料(绿)
  'Vertical': '#9898cc',                                          // 中间竖料(紫)
};
// 750XT(AC3):配色 = 750XT parts.xlsx 色键(与手涂范式 1.png/2.png 一致)。
const COLOR_750XT = {
  'Head': '#e6c700',                              // Top(黄)
  'Head (X)': '#21a121', 'Sill (X)': '#21a121',   // Top(X)/Sill(X)(绿)
  'Horizontal': '#f04a22',                        // 红橙
  'Horizontal (X)': '#8a5a2b',                    // 棕(含门上横档)
  'Sill': '#c9a0f0',                              // 淡紫
  'Jamb': '#e00000', 'Door Jamb': '#e00000',      // 红(Jamb/Door Jamb)
  'Jamb (X)': '#f59300',                          // 橙
  'Vertical': '#3f3fbf',                          // 靛蓝
  'Vertical (Lv)': '#f06ec8',                     // 粉
  'Vertical (X)': '#ff8ac2',                      // 粉(金属板带段,蓝粉蓝的"粉")
  'Vertical (wide)': '#0ea5a5',                   // 宽竖梃(青绿)
  'Vertical (wide X)': '#37b6ff',                 // 宽竖梃·带段(浅蓝)
  'Sill (normal)': '#00bcd4',                     // 青(金属板带上沿的窗台)
  'Subsill': '#f26722',
};
// 未映射角色(含自定义 Add Role 建的)→ 按名称哈希从备用色板取色,保证同名同色、不再一律灰
const CUSTOM_ROLE_COLORS = ['#d81b60', '#8e24aa', '#3949ab', '#00897b', '#7cb342', '#fb8c00', '#5d4037', '#00acc1'];
function customRoleColor(position) {
  let h = 0; const s = String(position || '');
  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) >>> 0;
  return CUSTOM_ROLE_COLORS[h % CUSTOM_ROLE_COLORS.length];
}
function cutColor(position, system) {
  if (state.roleColors && state.roleColors[position]) return state.roleColors[position];   // T2: renamed-role color override
  if (String(system) === '750XT') return COLOR_750XT[position] || POSITION_COLORS[position] || customRoleColor(position);
  if (is1600(system)) return COLOR_1600[position] || POSITION_COLORS[position] || customRoleColor(position);
  return POSITION_COLORS[position] || customRoleColor(position);
}

// 系统相关改名(450 与 IR501T 唯一区别都在这): 门框 transom 以上那段 ——
//   · 既是 elevation 最边 jamb → Jamb
//   · 其余(中间门框)→ 与 Vertical 同一构成, 归 Vertical(同色)
// 即 450 里没有独立的 "Door Jamb At Transom" 类。IR501T 保持 Door Jamb At Transom。
// 几何分类时已对边门框那段打了 edgeDoorJamb 标记。
function cutDisplayPosition(c, system) {
  if (system === '450' && c.position === 'Door Jamb At Transom') {
    return c.edgeDoorJamb ? 'Jamb' : 'Vertical';
  }
  return c.position;
}

// T3: stable geometry key for a cut's source (rounded to 0.1") — remembers manual role overrides across re-imports.
function srcKey(s) { return [s.x, s.y, s.w, s.h].map(n => Math.round((n || 0) * 10) / 10).join('|'); }

// ============================================================
//  #role-pins-v2 (2026-08-24, Leo: "我1个月前修改的 role position 上个礼拜导入都不见了,
//  需要我重新手改")
//
//  Root cause, reproduced: a pin was keyed by the piece's ABSOLUTE drawing coordinates
//  (`srcKey` = x|y|w|h). Move the elevation anywhere on the sheet — a re-issued drawing, a
//  re-exported view, a shifted origin — and every key changes at once. The same key is the
//  `elevGeoSig` fingerprint that guards the full saved edit-set, so BOTH persistence layers died
//  together, with no message: the import simply came back auto-classified and the work was gone.
//
//  Nothing about the elevation had actually changed. So pins are now stored RELATIVE to the
//  elevation's own origin, matched by shape-and-place with a tolerance instead of by string
//  equality, and — for pins written by the old build — the move is SOLVED FOR and the pins are
//  carried across. Three rules this code keeps:
//    1. A pin is a statement about a piece, not about a coordinate.
//    2. Never delete a pin on a read path. The old code dropped pins holding a retired role while
//       merely displaying an elevation; that is a write, and an unrecoverable one.
//    3. If a pin cannot be placed, SAY SO. Silence is what made this cost a week.
// ============================================================
const PIN_SIZE_TOL = 0.3;    // inches — a piece is "the same piece" if its size matches this close
const PIN_POS_TOL  = 1.5;    // inches — ...and it sits this close to where the pin says, relative
                             //           to the elevation's own bottom-left corner
const _pinReport = new Map();   // mark -> { matched, unmatched, shifted } for the viewer to show
const _savedRoleReport = new Map();   // mark -> { total, matched, changed } from a partial restore
function savedRoleReport(mark) { return _savedRoleReport.get(mark) || null; }

function rectsOrigin(rects) {
  const xs = [], ys = [];
  for (const r of rects) if (r) { xs.push(r.x); ys.push(r.y); }
  return xs.length ? { x: Math.min(...xs), y: Math.min(...ys) } : { x: 0, y: 0 };
}
function cutsOrigin(cuts) { return rectsOrigin((cuts || []).map(c => c && c.src).filter(Boolean)); }
// The corner every pin is measured from. Prefer the elevation's own bbox: it is fixed by the whole
// drawing, so dragging the leftmost jamb cannot move the origin out from under every other pin.
// Falls back to the cuts' own extent when there is no bbox (a hand-built opening).
function pinOrigin(cuts, bbox) {
  return (bbox && isFinite(bbox.minX) && isFinite(bbox.minY)) ? { x: bbox.minX, y: bbox.minY } : cutsOrigin(cuts);
}
function openingPinOrigin(o) { return pinOrigin(o && o.cuts, o && o._bands && o._bands.bbox); }
const _r1 = n => Math.round((n || 0) * 10) / 10;

// A pin: where the piece sits inside its own elevation, how big it is, and what Leo called it.
function makePin(src, org, role) {
  return { rx: _r1(src.x - org.x), ry: _r1(src.y - org.y), w: _r1(src.w), h: _r1(src.h), role };
}
function rolePinsFor(mark) {
  const a = state.rolePins && state.rolePins[mark];
  return Array.isArray(a) ? a : [];
}
function writeRolePins(mark, arr) {
  state.rolePins = state.rolePins || {};
  if (!arr || !arr.length) delete state.rolePins[mark];
  else state.rolePins[mark] = arr;
}

// Pair pins to cuts: exact placements first, then the nearest tolerable one, closest pair first so
// two similar pieces can't steal each other's pin. Each pin is used at most once.
// #pin-offset (2026-08-26, Leo: "when i import elevations which already have saved role pins, it
// should show saved role pins directly instead of still being auto-classified"):
// pins are stored relative to the elevation's bbox corner, and that corner is derived from ALL the
// geometry in the cluster — so a revised DXF that merely adds a dimension, a note or a bit of
// detail at the edge moves the corner, every pin shifts with it, and they all miss at once even
// though not one framing member moved. That produced "7 of 9 found no matching piece".
//
// The origin is now only a starting guess. Before matching, the shift is SOLVED: each pin votes
// for the offset that would carry it onto a same-sized cut, and the offset the most pins agree on
// is the one applied to all of them. A frame that did not move votes (0,0) and this is a no-op, so
// it runs unconditionally. What matters is the SHAPE of the elevation, never where its corner is.
function solvePinOffset(pins, cuts, org) {
  const cands = [];
  for (const p of pins) for (const c of cuts) {
    if (!c.src) continue;
    if (Math.abs(p.w - c.src.w) > PIN_SIZE_TOL || Math.abs(p.h - c.src.h) > PIN_SIZE_TOL) continue;
    cands.push({ dx: (c.src.x - org.x) - p.rx, dy: (c.src.y - org.y) - p.ry });
  }
  if (!cands.length) return null;
  let best = null, bn = -1;
  for (const a of cands) {
    let n = 0;
    for (const b of cands) if (Math.abs(a.dx - b.dx) <= PIN_SIZE_TOL && Math.abs(a.dy - b.dy) <= PIN_SIZE_TOL) n++;
    const mag = Math.hypot(a.dx, a.dy);
    if (n > bn || (n === bn && best && mag < Math.hypot(best.dx, best.dy) - 1e-9)) { best = a; bn = n; }
  }
  // Two independent pins agreeing is evidence; one is a coincidence between same-sized pieces.
  if (!best || bn < 2 || (Math.abs(best.dx) < 0.05 && Math.abs(best.dy) < 0.05)) return null;
  return { dx: best.dx, dy: best.dy, votes: bn };
}
function matchRolePins(pins, cuts, org) {
  const out = new Map();
  if (!pins.length) return { out, unmatched: [], offset: null };
  const off = solvePinOffset(pins, cuts, org);
  if (off) pins = pins.map(p => ({ ...p, rx: p.rx + off.dx, ry: p.ry + off.dy, _pin: p }));
  const cand = [];
  cuts.forEach((c, ci) => {
    if (!c.src) return;
    const rx = c.src.x - org.x, ry = c.src.y - org.y;
    pins.forEach((p, pi) => {
      if (Math.abs(p.w - c.src.w) > PIN_SIZE_TOL || Math.abs(p.h - c.src.h) > PIN_SIZE_TOL) return;
      const d = Math.hypot(rx - p.rx, ry - p.ry);
      if (d > PIN_POS_TOL) return;
      cand.push({ ci, pi, d });
    });
  });
  cand.sort((a, b) => a.d - b.d);
  const usedC = new Set(), usedP = new Set();
  for (const k of cand) {
    if (usedC.has(k.ci) || usedP.has(k.pi)) continue;
    usedC.add(k.ci); usedP.add(k.pi); out.set(k.ci, pins[k.pi]);
  }
  return { out, unmatched: pins.filter((_, i) => !usedP.has(i)).map(p => p._pin || p), offset: off };
}

// Legacy pins are absolute, so recovering them means recovering the move. Every legacy rect votes
// for the translation that would carry it onto a fresh cut of the same size; the translation the
// most rects agree on is the move that happened. An elevation that never moved votes (0,0) and
// this is a no-op — which is why it can run unconditionally.
function solveLegacyTranslation(legacyRects, cuts) {
  const cands = [];
  for (const L of legacyRects) for (const c of cuts) {
    if (!c.src) continue;
    if (Math.abs(c.src.w - L.w) > PIN_SIZE_TOL || Math.abs(c.src.h - L.h) > PIN_SIZE_TOL) continue;
    cands.push({ dx: c.src.x - L.x, dy: c.src.y - L.y });
  }
  if (!cands.length) return null;
  let best = null, bn = -1;
  for (const a of cands) {
    let n = 0;
    for (const b of cands) if (Math.abs(a.dx - b.dx) <= PIN_SIZE_TOL && Math.abs(a.dy - b.dy) <= PIN_SIZE_TOL) n++;
    const mag = Math.hypot(a.dx, a.dy);
    if (n > bn || (n === bn && best && mag < Math.hypot(best.dx, best.dy) - 1e-9)) { best = a; bn = n; }
  }
  // One vote is not evidence — with a single legacy pin, every same-sized piece in the elevation
  // is an equally good "match" and the winner is arbitrary. Two independent pins agreeing on the
  // same move is. Below that, assume the drawing did not move rather than invent a translation.
  if (!best || bn < 2) return null;
  return { dx: best.dx, dy: best.dy, votes: bn };
}

// One-time, per mark: carry `state.roleEdits` (absolute keys, written by every build before today)
// into the relative store. The legacy map is READ, never written or deleted — if this migration
// ever gets it wrong the original is still sitting there to re-run against.
function migrateLegacyRolePins(mark, cuts, org) {
  const legacy = (state.roleEdits && state.roleEdits[mark]) || null;
  if (!legacy || !Object.keys(legacy).length) return 0;
  const done = (state.rolePinsMigrated && state.rolePinsMigrated[mark]) || false;
  if (done) return 0;
  const rects = [];
  for (const k in legacy) {
    const p = String(k).split('|').map(Number);
    if (p.length !== 4 || p.some(n => !isFinite(n))) continue;
    rects.push({ x: p[0], y: p[1], w: p[2], h: p[3], role: legacy[k] });
  }
  if (!rects.length) return 0;
  const t = solveLegacyTranslation(rects, cuts) || { dx: 0, dy: 0, votes: 0 };
  const have = rolePinsFor(mark);
  const key = p => [p.rx, p.ry, p.w, p.h].join('|');
  const seen = new Set(have.map(key));
  let added = 0;
  for (const r of rects) {
    const pin = makePin({ x: r.x + t.dx, y: r.y + t.dy, w: r.w, h: r.h }, org, r.role);
    if (seen.has(key(pin))) continue;
    seen.add(key(pin)); have.push(pin); added++;
  }
  writeRolePins(mark, have);
  // A legacy key recorded when this mark sat somewhere else converts to a coordinate that is not
  // on this elevation at all. Better to drop it now than to warn about it forever.
  const junk = prunePinsOutsideElevation(mark, cuts);
  added -= junk;
  state.rolePinsMigrated = state.rolePinsMigrated || {};
  state.rolePinsMigrated[mark] = true;
  if (added) console.log(`[pins] ${mark}: recovered ${added} role pin(s) from the legacy store`
    + (Math.hypot(t.dx, t.dy) > 0.05 ? ` — the elevation had moved ${_r1(t.dx)}, ${_r1(t.dy)} on the sheet` : ''));
  return added;
}

function setRolePin(mark, org, src, role) {
  if (!mark || !src || !org) return;
  const pins = rolePinsFor(mark).slice();
  const pin = makePin(src, org, role);
  const i = pins.findIndex(p => Math.abs(p.rx - pin.rx) <= 0.05 && Math.abs(p.ry - pin.ry) <= 0.05
                             && Math.abs(p.w - pin.w) <= 0.05 && Math.abs(p.h - pin.h) <= 0.05);
  if (i >= 0) pins[i] = pin; else pins.push(pin);
  writeRolePins(mark, pins);
}
// Dragging a piece longer or shorter must carry its pin with it, or the next import silently
// reverts the role of the very piece that was just edited.
function moveRolePin(mark, org, oldSrc, newSrc) {
  if (!mark || !oldSrc || !newSrc || !org) return;
  const o0 = makePin(oldSrc, org, null);
  const pins = rolePinsFor(mark).slice();
  const i = pins.findIndex(p => Math.abs(p.rx - o0.rx) <= 0.05 && Math.abs(p.ry - o0.ry) <= 0.05
                             && Math.abs(p.w - o0.w) <= 0.05 && Math.abs(p.h - o0.h) <= 0.05);
  if (i < 0) return;
  pins[i] = makePin(newSrc, org, pins[i].role);
  writeRolePins(mark, pins);
}
function clearRolePins(mark) {
  if (state.rolePins) delete state.rolePins[mark];
  if (state.rolePinsMigrated) delete state.rolePinsMigrated[mark];
}
function rolePinReport(mark) { return _pinReport.get(mark) || null; }

// ============================================================
//  #persist (#1): manual elevation edits (splits/merges/role/length/count) survive
//  reload AND are shared across browsers/Vercel via Firestore (project elevDb,
//  collection `elevEdits`, one doc per mark). Local state.elevEdits mirrors the cloud
//  and is the offline fallback. On DXF re-import a saved edit-set is restored only when
//  its geometry signature matches the fresh parse (see parseRawDxfOpenings).
//  Note: this is also the training data #4's auto-propagation will learn from.
// ============================================================
function elevGeoSigAbs(cuts) {
  return (cuts || []).filter(c => c && c.src).map(c => srcKey(c.src)).sort().join(';');
}
function elevGeoSig(cuts) {
  // Role-independent fingerprint of the parsed source geometry for one elevation, taken RELATIVE
  // to the elevation's own origin (#role-pins-v2). The absolute form meant that moving the
  // elevation on the sheet changed the fingerprint, so the saved edit-set silently stopped
  // matching and every split, merge and length edit was thrown away along with the role pins.
  const list = (cuts || []).filter(c => c && c.src);
  const org = cutsOrigin(list);
  return list.map(c => [_r1(c.src.x - org.x), _r1(c.src.y - org.y), _r1(c.src.w), _r1(c.src.h)].join('|')).sort().join(';');
}
// A saved signature may be in either form — accept both, so today's build restores edit-sets saved
// by yesterday's. The next persist rewrites it in the new form.
function geoSigMatches(saved, cuts) {
  if (!saved) return false;
  return saved === elevGeoSig(cuts) || saved === elevGeoSigAbs(cuts);
}
function elevEditRecord(o) {
  return {
    cuts: (o.cuts || []).map(c => ({ position: c.position, length: c.length, count: c.count || 1, src: c.src ? { ...c.src } : null })),
    geoSig: o.geoSig || elevGeoSig(o.cuts),
    width: o.width, height: o.height, system: o.system || '',
    // #pins-in-cloud (2026-09-04, Leo: "修改记录是存在browser里面的吗 / 我每次间隔会超过1个礼拜"):
    // yes, and that was the hole. elevEdits has always been per-mark in Firestore, but role pins
    // lived in localStorage alone — so a browser that cleared its storage between two jobs a week
    // apart lost them with nothing to fall back on. They travel in the same doc now: one write,
    // one read, same mark, and they come back on any machine that opens the project.
    rolePins: rolePinsFor(o.mark),
  };
}
// #history (2026-07-19, Leo — SF01 data loss): keep at most this many prior versions per mark,
// newest first, nested inside the same elevEdits doc (`rec.history`) so it travels with one
// write/read — no new Firestore collection needed. This is what lets a bad overwrite (like the
// SF01 case, where an automatic reclassification silently replaced a hand-set special-case
// classification) be undone from within the app, instead of depending on an external backup that
// didn't exist for this data (the nightly GitHub Action only backs up the tracker's Realtime DB
// /state, never the takeoff tool's Firestore collections).
const ELEV_EDITS_HISTORY_LIMIT = 5;
function persistElevEdits(o) {
  if (!o || !o.mark) return;
  state.elevEdits = state.elevEdits || {};
  const rec = elevEditRecord(o);
  rec.updatedAt = Date.now();
  const prev = state.elevEdits[o.mark];
  // Only push a history entry if something actually changed (avoid piling up no-op saves).
  const prevSig = prev ? JSON.stringify((prev.cuts || []).map(c => [c.position, c.length, c.count])) : null;
  const nextSig = JSON.stringify((rec.cuts || []).map(c => [c.position, c.length, c.count]));
  if (prev && prevSig !== nextSig) {
    const prevHistory = Array.isArray(prev.history) ? prev.history : [];
    const prevEntry = { cuts: prev.cuts, geoSig: prev.geoSig, width: prev.width, height: prev.height, system: prev.system, updatedAt: prev.updatedAt || 0 };
    rec.history = [prevEntry, ...prevHistory].slice(0, ELEV_EDITS_HISTORY_LIMIT);
  } else {
    rec.history = (prev && Array.isArray(prev.history)) ? prev.history : [];
  }
  state.elevEdits[o.mark] = rec;
  save();
  const fb = window.__fb;
  if (fb && fb.setDoc) {
    try {
      fb.setDoc(fb.doc(fb.elevDb || fb.db, 'elevEdits', String(o.mark)),
        Object.assign({}, rec, { updatedAt: fb.serverTimestamp() }), { merge: true })
        .catch(err => console.warn('[elevEdits] push failed:', err));
    } catch (err) { console.warn('[elevEdits] push failed:', err); }
  }
}
// #history: restore one prior version for `mark` back to being the live edit-set. The version
// being replaced is itself pushed to history first (via persistElevEdits' own diffing), so
// restoring is never a dead end — you can always step back again.
function restoreElevEditsVersion(mark, historyIdx) {
  const rec = state.elevEdits && state.elevEdits[mark];
  const entry = rec && Array.isArray(rec.history) && rec.history[historyIdx];
  if (!entry) return false;
  const o = state.openings.find(x => x.mark === mark);
  if (!o) return false;
  o.cuts = (entry.cuts || []).map(c => ({ position: c.position, length: c.length, count: c.count || 1, src: c.src ? { ...c.src } : null }));
  o.geoSig = elevGeoSig(o.cuts);   // always re-stamped in the current (relative) form
  persistElevEdits(o);   // saves the restored version as current, pushing today's (pre-restore) version into history
  return true;
}
function clearElevEdits(mark) {
  if (!mark) return;
  if (state.roleEdits) delete state.roleEdits[mark];
  clearRolePins(mark);
  if (state.elevEdits) delete state.elevEdits[mark];
  save();
  const fb = window.__fb;
  if (fb && fb.setDoc) {
    try {
      fb.setDoc(fb.doc(fb.elevDb || fb.db, 'elevEdits', String(mark)),
        { cuts: [], geoSig: '', updatedAt: fb.serverTimestamp() }, { merge: true }).catch(() => {});
    } catch (_) {}
  }
}
function loadElevEditsFromCloud() {
  const fb = window.__fb;
  if (!fb || !fb.getDocs || !fb.collection) return;
  const _localSnapshot = Object.assign({}, state.elevEdits || {}); // #11: pre-merge snapshot, to find cloud gaps below
  fb.getDocs(fb.collection(fb.elevDb || fb.db, 'elevEdits')).then(snap => {
    state.elevEdits = state.elevEdits || {};
    const _cloudMarks = new Set();
    snap.forEach(d => {
      _cloudMarks.add(d.id);
      const data = d.data() || {};
      if (data && Array.isArray(data.cuts)) {
        if (data.cuts.length) state.elevEdits[d.id] = { cuts: data.cuts, geoSig: data.geoSig || '', width: data.width, height: data.height, system: data.system || '', updatedAt: data.updatedAt || 0, history: Array.isArray(data.history) ? data.history : [], rolePins: Array.isArray(data.rolePins) ? data.rolePins : [] };
        else delete state.elevEdits[d.id];   // a cleared mark
        // #pins-in-cloud: adopt the cloud's pins only where this browser has none — a local set is
        // either the same or newer, and silently replacing it would be the old bug wearing a hat.
        // NOTE (2026-09-04): this block was first inserted BETWEEN the if and its else above, so the
        // `else delete` re-bound to it — and every cloud doc written before rolePins existed (all of
        // them) deleted its own local elevEdits entry on page load. That is what took Leo's 35 saved
        // elevations to zero while he watched. Never split an if/else to insert anything.
        if (Array.isArray(data.rolePins) && data.rolePins.length) {
          state.rolePins = state.rolePins || {};
          if (!(state.rolePins[d.id] || []).length) state.rolePins[d.id] = data.rolePins;
        }
      }
      // #panel-gasket: per-panel type/gasket overrides ride along in the same doc.
      if (data && data.panels && typeof data.panels === 'object') {
        state.panelEdits = state.panelEdits || {};
        if (Object.keys(data.panels).length) state.panelEdits[d.id] = data.panels;
        else delete state.panelEdits[d.id];
      }
    });
    if (typeof recomputeAllGaskets === 'function') recomputeAllGaskets();
    save();
    if (typeof renderReport === 'function') renderReport();
    // #11: one-time self-heal — a mark edited locally before the elevEdits Firestore rule was
    // published/deployed only ever saved to localStorage; now that cloud is reachable, push any
    // such local-only mark up. No-op once everything's synced (skips marks the cloud already has).
    const _missing = Object.keys(_localSnapshot).filter(mark => !_cloudMarks.has(mark) && _localSnapshot[mark] && Array.isArray(_localSnapshot[mark].cuts) && _localSnapshot[mark].cuts.length);
    if (_missing.length && fb.setDoc) {
      console.log('[elevEdits] self-heal: pushing ' + _missing.length + ' local-only mark(s) to cloud:', _missing.join(', '));
      for (const mark of _missing) {
        const rec = _localSnapshot[mark];
        try {
          fb.setDoc(fb.doc(fb.elevDb || fb.db, 'elevEdits', String(mark)),
            Object.assign({}, rec, { updatedAt: fb.serverTimestamp() }), { merge: true })
            .catch(err => console.warn('[elevEdits] self-heal push failed for', mark, err));
        } catch (err) { console.warn('[elevEdits] self-heal push failed for', mark, err); }
      }
    }
  }).catch(err => console.warn('[elevEdits] load failed:', err));
}
if (typeof window !== 'undefined') {
  if (window.__fb) loadElevEditsFromCloud();
  else window.addEventListener('fb-ready', loadElevEditsFromCloud, { once: true });
}

// ============================================================
//  #panel-gasket (2026-08-20, Leo: "现在有一个 gasket diagram，但基本不能用…可以自定义每块
//  panel 是什么（glass/IMP-1)，上方 louver 不用动…glass/imp-1 你先识别出来，用现在的算法就能
//  做到，但允许我手动调整" + "glass&IMP-1 现在都是 E2-0127x1 + E2-0120x1，但还是要分，以后也许
//  会变")
//
//  The gasket takeoff is now a PANEL takeoff. Every infill cell the parser finds becomes a panel
//  with (a) a type — glass / IMP-1 — auto-detected exactly as before from the IMP-1 hatch bands,
//  and (b) its own gasket spec: a list of {part, loops}. LF for a panel = perimeter × loops, per
//  part. Type and spec are BOTH hand-overridable per panel; the auto value is kept alongside so
//  "Reset to auto" is always available and a re-import never silently discards a manual call.
//  Type is still stored even where both types currently resolve to the same gasket spec, because
//  Leo expects the two to diverge again later.
//
//  Louver and door cells are carried in the panel list (so the diagram is complete) but are NOT
//  editable and take no infill gasket — "上方 louver 不用动".
//
//  Storage: state.panelEdits[mark][panelKey] = { t0?, gaskets? }, mirrored into the SAME
//  Firestore `elevEdits/{mark}` doc under a `panels` field. Deliberately not a new collection —
//  a new one would need its own security rule published in the Firebase Console before any write
//  would land, and silently-failing writes are exactly the trap this project has hit before.
// ============================================================
// #gasket-per-system (2026-08-20, Leo: "45TU 为什么没有 gasket diagram，也得算"): the gasket model
// was written for 750XT and hard-coded its part numbers, so every other system got no panel map at
// all. It is per-system now. A system that is not listed gets no panel gasket — silence is right
// where nothing is known; inventing E2-0127 for an unknown system would be worse than a blank.
//
// 45TU: **2 loops of E2-0052 per panel**, which is EXACTLY the old per-role rule re-expressed.
// The old rules were 2×LF on the perimeter roles (Jamb/Door Jamb/Head/Sill) and 4×LF on the
// interior ones (Vertical/Corner/Horizontal). A perimeter member borders one panel and an interior
// member borders two, so summing 2 loops per panel gives 2·L for every perimeter member and
// 2·L·2 = 4·L for every interior member — the same total, now drawn and editable panel by panel.
// The two per-role E2-0052 rows were removed from systems.js at the same time; leaving both would
// have doubled the gasket.
// #gasket-any-system (2026-08-24, Leo: "I need gasket view for all systems … because this tool
// needs to be an independent tool that doesn't rely on position detection algorithm. It's expected
// to manually set panels/pieces/gaskets"):
// the gasket spec is no longer a hard-coded table of two systems — it is DATA, seeded per system
// and overridable by hand from the Accessories section. A system nobody has configured yet still
// gets a full gasket diagram: an empty spec draws no loops, and every panel's gasket is editable
// panel by panel, so the tool never depends on the detector or on a system being "known".
// Precedence: state.systemGaskets[sys]  >  SYSTEM_DEFS[sys].gasket  >  built-in seed below.
const SEED_SYSTEM_GASKET = {
  '750XT': {
    panel: {
      glass: [{ part: 'E2-0127', loops: 1 }, { part: 'E2-0120', loops: 1 }],
      panel: [{ part: 'E2-0127', loops: 1 }, { part: 'E2-0120', loops: 1 }],
      louver: [],
      // #door-gasket: a door panel takes NO loop of its own. The door's gasket is the two jambs
      // and only the two jambs (doorPart below) — a perimeter loop here would count them twice.
      door: [],
    },
    // storefront perimeter ×1 per independent zone, and the door's two jambs. Same part number
    // today, kept as separate runs so each stays auditable and they can diverge later.
    perimeterPart: 'E2-0120',
    doorPart: 'E2-0120',
  },
  '45TU': {
    panel: {
      glass: [{ part: 'E2-0052', loops: 2 }],
      panel: [{ part: 'E2-0052', loops: 2 }],
      louver: [],
      door: [],
    },
    // 45TU's schedule has no separate storefront-perimeter or door-jamb gasket run.
    perimeterPart: null,
    doorPart: null,
  },
};
(function mergeGasketDefsFromSystemsJs() {
  const defs = (typeof window !== 'undefined' && window.SYSTEM_DEFS) || {};
  for (const sys in defs) if (defs[sys] && defs[sys].gasket) SEED_SYSTEM_GASKET[sys] = defs[sys].gasket;
})();
const GASKET_PANEL_TYPES = ['glass', 'panel', 'louver', 'door'];
// Every read goes through here, so a half-filled hand-edited spec can never crash a render.
function normGasketSpec(g) {
  const src = g || {};
  const panel = {};
  for (const t of GASKET_PANEL_TYPES) {
    panel[t] = ((src.panel || {})[t] || [])
      .map(x => ({ part: String(x.part || '').trim(), loops: +x.loops || 0 }))
      .filter(x => x.part && x.loops > 0);
  }
  const pn = s0 => { const v = String(s0 == null ? '' : s0).trim(); return v || null; };
  return { panel, perimeterPart: pn(src.perimeterPart), doorPart: pn(src.doorPart) };
}
function seedSystemGasket(system) { return normGasketSpec(SEED_SYSTEM_GASKET[system]); }
function systemGasket(system) {
  const ov = (typeof state !== 'undefined' && state && state.systemGaskets) ? state.systemGaskets[system] : null;
  return ov ? normGasketSpec(ov) : seedSystemGasket(system);
}
function isSystemGasketCustom(system) { return !!((state.systemGaskets || {})[system]); }
function setSystemGasket(system, spec) {
  state.systemGaskets = state.systemGaskets || {};
  state.systemGaskets[system] = normGasketSpec(spec);
}
function resetSystemGasket(system) { if (state.systemGaskets) delete state.systemGaskets[system]; }
// "E2-0127×1, E2-0120x2" (or ×, x, *, :, or a bare part number meaning ×1) ⇄ [{part,loops}].
// A text field, not a dropdown of known parts: a system the tool has never seen must be typeable.
function parseGasketSpecText(txt) {
  return String(txt || '').split(/[,;\n]+/).map(t => t.trim()).filter(Boolean).map(t => {
    const m = t.match(/^(.+?)\s*[x×*:]\s*([0-9.]+)$/i);
    return m ? { part: m[1].trim(), loops: +m[2] } : { part: t, loops: 1 };
  }).filter(g => g.part && g.loops > 0);
}
function gasketSpecText(arr) { return (arr || []).map(g => `${g.part}×${+(+g.loops).toFixed(2)}`).join(', '); }
// Coil length per box, by part number — seeded, and extendable by hand for a part the seed has
// never heard of (otherwise a new system's gasket reports LF with no box count).
const SEED_GASKET_BOX_LF = { 'E2-0127': 250, 'E2-0120': 500, 'E2-0052': 250 };
function gasketBoxLF(part) {
  const k = String(part || '').trim().toUpperCase();
  const ov = state.gasketBoxLF || {};
  if (ov[k] != null) return +ov[k] || 0;
  for (const p0 in SEED_GASKET_BOX_LF) if (p0.toUpperCase() === k) return SEED_GASKET_BOX_LF[p0];
  return 0;
}
function gasketBoxLFText() {
  const merged = {};
  for (const p0 in SEED_GASKET_BOX_LF) merged[p0.toUpperCase()] = SEED_GASKET_BOX_LF[p0];
  for (const k in (state.gasketBoxLF || {})) merged[k] = state.gasketBoxLF[k];
  return Object.keys(merged).sort().filter(k => merged[k] > 0).map(k => `${k}:${merged[k]}`).join(', ');
}
function parseGasketBoxLFText(txt) {
  const out = {};
  for (const t of String(txt || '').split(/[,;\n]+/)) {
    const m = t.trim().match(/^(.+?)\s*[:=]\s*([0-9.]+)$/);
    if (m) out[m[1].trim().toUpperCase()] = +m[2] || 0;
  }
  return out;
}
// Which panels offer the glass↔IMP-1 type switch, vs. which simply have an editable gasket spec.
// A door is a door — you don't re-type it — but its gasket is still yours to change.
const PANEL_TYPE_CHOICES = ['glass', 'panel'];      // an AUTO-detected panel may be re-typed between these
const PANEL_ALL_TYPES = ['glass', 'panel', 'door', 'louver'];   // a HAND-DRAWN panel can be any of these
// #gasket-any-system: a louver used to be hard-locked to "no gasket, nothing to set". That was a
// 750XT fact wearing the costume of a rule — another system may well gasket its louver band, and
// now that the default is a per-system setting the panel-level editor has to be able to follow it.
// A DOOR stays locked on purpose (#door-gasket): its gasket is the two jambs and only the two
// jambs, and a loop set on the leaf would double-count them.
const PANEL_EDITABLE_TYPES = ['glass', 'panel', 'louver'];
const PANEL_TYPE_LABEL = { glass: 'Glass', panel: 'IMP-1', louver: 'Louver', door: 'Door' };
const PANEL_TYPE_FILL = { glass: '#bcd6ee', panel: '#c9c9c9', louver: '#bfe6c8', door: '#f2c48a' };
const GASKET_PART_COLOR = { 'E2-0127': '#2dd4bf', 'E2-0120': '#f97316', 'E2-0052': '#38bdf8' };
function gasketPartColor(part) { return GASKET_PART_COLOR[part] || '#a78bfa'; }

// #perimeter-outline (2026-08-20, Leo: "perimeter 永远是绕着外围的 frame 一圈你能理解吗" +
// "15.2，左右 2 个 opening 中间没有任何 frame 连接，所以算分开的"):
// the storefront perimeter is the OUTLINE OF THE FRAME ITSELF — trace the outside edge of the
// metal and that is the run. Every earlier version approximated it (a bbox rectangle, then a
// rectangle with door notches cut out) and every approximation broke on the next drawing: a
// stepped sill, a louver band, two bays that share no member. So this stops approximating and
// computes the real thing.
//
// Method: the framing members are all axis-aligned rectangles (cuts[].src). Lay their edges out
// as a grid, mark which cells the metal covers, flood the OUTSIDE, and every cell face where
// metal meets outside is a piece of the perimeter. That single computation gets, for free:
//   · disconnected zones — SF15.2's two bays share no frame member, so they are two separate
//     components and each gets its own loop; the empty space between/below them is outside,
//     not enclosed. Same mechanism makes a louver band its own zone with no special case.
//   · a stepped sill, a bay that stops short, any non-rectangular outline — traced as drawn.
//   · the door — no sill crosses a door opening, so the notch is open to the outside and the
//     outline walks down one jamb face and up the other by itself.
// Interior faces (a glass pocket, fully enclosed by metal) are NOT outside-reachable, so they are
// excluded — those pockets are the panel gasket's job, not the perimeter's.
//
// The traced path is then split into two reported runs, disjoint by construction so nothing can
// be double-counted: the vertical faces bounding a door opening are the DOOR run; everything else
// is the STOREFRONT run. The horizontal face under a door header is dropped from both — a door
// header takes no gasket (Leo).
// #parser-version (2026-08-20, Leo — SF15.2 "出来怎么是这样"): openings persist in localStorage,
// so an elevation on screen may have been parsed by an older build. Anything decided WHILE reading
// the DXF — which cells are panels, where the doors are — cannot be recomputed later from stored
// state; only a re-import fixes it. Every parse stamps this number onto the opening, and the
// viewer says so when it does not match. BUMP THIS whenever the parse changes what it produces.
const PARSER_VERSION = 20260820;   // bump when the PARSE changes what it produces (panels/doors)
const PERIM_DOOR_PAD = 10;      // inches — how far outside the leaf a door's own jamb face can sit
// A door header takes no gasket at all (Leo). Not its underside, not its top, not its ends — so
// the whole header sits in a dead band above the opening and every face in it is dropped. The band
// has to be a bit taller than the member itself: the header is drawn as its own extrusion with a
// hairline void between it and the head above, and that void is open to the door notch, so without
// the band the outline walks up and around the header and bills it as storefront.
const PERIM_DOOR_HEADER_ZONE = 6;   // inches above the opening
function perimeterRuns(bb, cuts, louverBand, doorRegions) {
  const empty = { storefront: { segs: [], inches: 0 }, door: { segs: [], inches: 0 } };
  const rects = (cuts || []).filter(c => c.src && c.src.w > 0 && c.src.h > 0)
    .map(c => ({ x1: c.src.x, y1: c.src.y, x2: c.src.x + c.src.w, y2: c.src.y + c.src.h }));
  if (!rects.length) return empty;
  // Snap the grid lines. Two members that butt together are drawn with edges that agree only to
  // float noise (2422.2200000 vs 2422.2200001); left un-snapped that pair becomes a ZERO-WIDTH
  // column of cells no rectangle can cover, and the outside floods straight through it into every
  // sealed pocket — which is exactly what made the first version trace a gold line around every
  // glass cell in the two end bays. 0.02" is far below any real gap in these drawings (the
  // smallest genuine one is the 0.5" reveal between a mullion and its neighbouring column, which
  // must stay open — that is what tells two bays apart).
  const COORD_EPS = 0.02;
  const snap = vals => { const out = []; for (const v of vals.sort((a, b) => a - b)) if (!out.length || v - out[out.length - 1] > COORD_EPS) out.push(v); return out; };
  const xs = snap(rects.flatMap(r => [r.x1, r.x2]));
  const ys = snap(rects.flatMap(r => [r.y1, r.y2]));
  const idxOf = (arr, v) => { let lo = 0, hi = arr.length - 1; while (lo < hi) { const mid = (lo + hi) >> 1; if (arr[mid] < v - COORD_EPS) lo = mid + 1; else hi = mid; } return lo; };
  const nx = xs.length - 1, ny = ys.length - 1;
  if (nx < 1 || ny < 1) return empty;
  const at = (i, j) => i * ny + j;
  const cov = new Uint8Array(nx * ny);
  for (const r of rects) {
    for (let i = idxOf(xs, r.x1); i < idxOf(xs, r.x2); i++)
      for (let j = idxOf(ys, r.y1); j < idxOf(ys, r.y2); j++) cov[at(i, j)] = 1;
  }
  // flood the outside through uncovered cells, entering from every border cell
  const outside = new Uint8Array(nx * ny);
  const stack = [];
  const push = (i, j) => { if (i < 0 || j < 0 || i >= nx || j >= ny) return; const k = at(i, j); if (cov[k] || outside[k]) return; outside[k] = 1; stack.push(i, j); };
  for (let i = 0; i < nx; i++) { push(i, 0); push(i, ny - 1); }
  for (let j = 0; j < ny; j++) { push(0, j); push(nx - 1, j); }
  while (stack.length) { const j = stack.pop(), i = stack.pop(); push(i - 1, j); push(i + 1, j); push(i, j - 1); push(i, j + 1); }
  const doors = (doorRegions || [])
    .filter(d => d.maxX > (bb ? bb.minX : -Infinity) && d.minX < (bb ? bb.maxX : Infinity))
    .map(d => ({ minX: d.minX, maxX: d.maxX, headY: d.headY != null ? d.headY : ys[ny] }));
  // Which side of the line a face falls on is decided by the CELL it faces, not by a coordinate
  // test on the merged run. A door notch is an outside cell that sits in a door's column below its
  // header; anything facing one of those cells belongs to the door. Doing it per cell — before the
  // faces are merged into long runs — is what makes a jamb split correctly: the part of its inner
  // face beside the door goes to the door, the part above the header stays with the storefront.
  // Coordinate tests on the merged run cannot do that, and got SF15.1's whole left edge wrong.
  // 'notch' = the door opening itself; 'header' = the dead band holding the door header.
  const doorZoneAt = (i, j) => {
    const cx = (xs[i] + xs[i + 1]) / 2, cy = (ys[j] + ys[j + 1]) / 2;
    for (const d of doors) {
      if (cx <= d.minX - PERIM_DOOR_PAD || cx >= d.maxX + PERIM_DOOR_PAD) continue;
      if (cy < d.headY) return 'notch';
      if (cy < d.headY + PERIM_DOOR_HEADER_ZONE) return 'header';
    }
    return null;
  };
  const faceKind = (i, j) => {
    if (i < 0 || j < 0 || i >= nx || j >= ny) return 'store';         // the sheet edge — plain outside
    const k = at(i, j);
    if (cov[k] || !outside[k]) return null;                            // metal, or an enclosed pocket
    const z = doorZoneAt(i, j);
    return z === 'header' ? 'skip' : (z === 'notch' ? 'door' : 'store');
  };
  const vStore = [], vDoor = [], hStore = [];
  for (let i = 0; i < nx; i++) for (let j = 0; j < ny; j++) {
    if (!cov[at(i, j)]) continue;
    let k = faceKind(i - 1, j); if (k && k !== 'skip') (k === 'door' ? vDoor : vStore).push([xs[i], ys[j], ys[j + 1]]);
    k = faceKind(i + 1, j);     if (k && k !== 'skip') (k === 'door' ? vDoor : vStore).push([xs[i + 1], ys[j], ys[j + 1]]);
    // horizontals facing a door notch are the header underside — a door header takes no gasket
    // (Leo), and there is never a member across the threshold, so they are simply dropped.
    k = faceKind(i, j - 1);     if (k === 'store') hStore.push([ys[j], xs[i], xs[i + 1]]);
    k = faceKind(i, j + 1);     if (k === 'store') hStore.push([ys[j + 1], xs[i], xs[i + 1]]);
  }
  // merge collinear neighbours so the drawing is a few long lines, not a thousand cell faces
  const merge = list => {
    const by = new Map();
    for (const [a, p1, p2] of list) { const k = a.toFixed(4); if (!by.has(k)) by.set(k, { a, runs: [] }); by.get(k).runs.push([p1, p2]); }
    const out = [];
    for (const { a, runs } of by.values()) {
      runs.sort((p, q) => p[0] - q[0]);
      let cur = null;
      for (const [p1, p2] of runs) {
        if (cur && p1 <= cur[1] + 1e-6) cur[1] = Math.max(cur[1], p2);
        else { if (cur) out.push([a, cur[0], cur[1]]); cur = [p1, p2]; }
      }
      if (cur) out.push([a, cur[0], cur[1]]);
    }
    return out;
  };
  const store = [], door = [];
  for (const [x, y1, y2] of merge(vStore)) store.push([x, y1, x, y2]);
  for (const [x, y1, y2] of merge(vDoor)) door.push([x, y1, x, y2]);
  for (const [y, x1, x2] of merge(hStore)) store.push([x1, y, x2, y]);
  const len = a => a.reduce((t, [x1, y1, x2, y2]) => t + Math.hypot(x2 - x1, y2 - y1), 0);
  return { storefront: { segs: store, inches: len(store) }, door: { segs: door, inches: len(door) } };
}
// #cut-drag (2026-08-20, Leo, while doing 45TU: "识别得很不好 / 增加手动 edit piece 功能，现在可以
// add 但只是文字，需要在图上可以改长，改短，新添，需要有磁吸，像画 panel 那样"): the framing view was
// read-only apart from a text form. On a system the detector reads badly, retyping numbers for every
// member is unusable — the drawing is right there, so the drawing is where the fixing should happen.
// Same interaction as the panel map: drag an end to lengthen or shorten, drag a rectangle to add,
// everything snapping to the faces of the members that are already there.
const CUT_SNAP_IN = 4;          // inches — same feel as PANEL_SNAP_IN
/* #place-chip (2026-08-27, Leo: "I enter the length and role for a piece, then when I click it
   at the bottom, the piece will show up on the canvas, then I only need to move it").
   Drawing a member freehand asks you to get its LENGTH right by dragging, which is the one
   number you already know exactly — so a chip is placed at its true length and you only supply
   the position, which is the part a drag is actually good at.
   Face width is 2" for everything except corners and the wide profiles, so 2" is the default
   and the Width box in the editor covers the rest. */
const PIECE_W_IN = 2;
function _roleIsVertical(pos) { return /jamb|vertical|corner|mullion|stile/i.test(String(pos || '')); }
/* Put a chip on the canvas at its role's natural home — sill on the bottom, head at the top,
   jambs on the sides — then step out of the way of anything already placed there. It is a
   starting point, not a guess at the design: the whole point is that you drag it from here. */
function placeCutOnCanvas(o, idx) {
  const c = o && o.cuts && o.cuts[idx];
  if (!c || c.src) return null;
  const W = +o.width, H = +o.height, L = +c.length;
  if (!(W > 0 && H > 0 && L > 0)) return null;
  const t = Math.min(PIECE_W_IN, Math.max(W, H) / 4);
  const vert = _roleIsVertical(c.position);
  const role = String(c.position || '');
  const cands = [];
  if (vert) {
    const y = Math.max(0, Math.min(H - L, 0));
    cands.push({ x: 0, y }, { x: Math.max(0, W - t), y });
    for (let k = 1; k <= 12; k++) cands.push({ x: Math.min(W - t, k * Math.max(t * 2, W / 8)), y });
  } else {
    const yFor = /sill/i.test(role) ? 0 : (/head/i.test(role) ? Math.max(0, H - t) : Math.max(0, H / 2 - t / 2));
    const x = Math.max(0, Math.min(W - L, 0));
    cands.push({ x, y: yFor });
    for (let k = 1; k <= 12; k++) cands.push({ x, y: Math.min(H - t, Math.max(0, yFor + (k % 2 ? 1 : -1) * Math.ceil(k / 2) * Math.max(t * 2, H / 8))) });
  }
  // Only a piece of the SAME orientation blocks a spot. A jamb and a sill share the bottom-left
  // corner — that is what a frame IS — so comparing origins across orientations pushed both jambs
  // off the edges they belong on.
  const taken = (o.cuts || []).filter((x, i) => i !== idx && x.src && (x.src.h >= x.src.w) === vert).map(x => x.src);
  const free = cands.find(p => !taken.some(sq => Math.abs(sq.x - p.x) < 0.6 && Math.abs(sq.y - p.y) < 0.6)) || cands[0];
  const src = { x: +free.x.toFixed(3), y: +free.y.toFixed(3),
                w: +(vert ? t : L).toFixed(3), h: +(vert ? L : t).toFixed(3), layer: '' };
  // A chip standing for several identical pieces places ONE of them and keeps the rest as a chip,
  // so clicking it twice puts both jambs up and the billed totals never change.
  if ((c.count || 1) > 1) {
    c.count = (c.count | 0) - 1;
    o.cuts.push({ position: c.position, length: c.length, count: 1, src: src });
    return o.cuts.length - 1;
  }
  c.src = src;
  return idx;
}
const CUT_HANDLE_FRAC = 0.10;   // grab-zone at each end of the selected piece, as a fraction of its length
// Snap candidates come from every OTHER member's faces — a piece must not snap to itself, or an end
// drag would stick where it started and look broken.
function cutSnapAxes(o, skipIdx) {
  const xs = [], ys = [];
  (o.cuts || []).forEach((c, i) => {
    if (i === skipIdx || !c.src) return;
    xs.push(c.src.x, c.src.x + c.src.w); ys.push(c.src.y, c.src.y + c.src.h);
  });
  // #blank-canvas: on a hand-added opening the frame outline is the only fixed reference there
  // is, so a sill or jamb drawn near an edge lands ON it instead of 1/8" off it.
  if (o && !o._bands && +o.width > 0 && +o.height > 0) { xs.push(0, +o.width); ys.push(0, +o.height); }
  return { xs, ys };
}
function snapAxis(vals, v, eps) {
  let best = v, bd = eps == null ? CUT_SNAP_IN : eps;
  for (const f of vals) { const d = Math.abs(f - v); if (d < bd) { bd = d; best = f; } }
  return best;
}
// A cut's length follows its long side; keep the two in step so the cut list never disagrees with
// the picture. Also carries the role pin across, so the piece keeps the role you gave it.
function setCutGeometry(o, idx, src) {
  const c = o.cuts[idx];
  if (!c || !c.src) return;
  const oldSrc = { ...c.src }, org = openingPinOrigin(o);
  c.src = { x: +src.x.toFixed(3), y: +src.y.toFixed(3), w: +src.w.toFixed(3), h: +src.h.toFixed(3), layer: c.src.layer };
  c.length = dxfRound(Math.max(c.src.w, c.src.h));
  moveRolePin(o.mark, org, oldSrc, c.src);
}
function panelKey(p) { return [p.x1, p.y1, p.x2, p.y2].map(n => Math.round((n || 0) * 10) / 10).join('|'); }
function defaultGasketsFor(t0, system) { return (systemGasket(system).panel[t0] || []).map(g => ({ part: g.part, loops: g.loops })); }
// #hand-drawn-panels (2026-08-20, Leo: "now classic elevations all pretty well / but if it's not,
// then many issues / allow me to draw panels and doors on gasket diagram"): the detector reads a
// regular grid of bays well and an irregular elevation badly, and no amount of tuning changes that
// — so the answer is not a better guess, it is a pencil. A mark's panel record now holds three
// things instead of one:
//   overrides — per auto-detected panel: its type / its gasket spec  (what existed before)
//   manual    — panels drawn by hand, each a rectangle with its own type and gasket spec
//   hidden    — auto-detected panels struck out, for cells the detector invented
// A hand-drawn DOOR is a real door: it feeds the door-gasket run just like a parsed one, so an
// elevation whose doors the parser missed entirely can still be taken off correctly (SF01, EL-01).
// The old flat {key: override} shape is still read, so nothing saved earlier is lost.
function panelEditRec(mark) {
  const r = (state.panelEdits && state.panelEdits[mark]) || null;
  if (!r) return { overrides: {}, manual: [], hidden: [] };
  if (r.overrides || r.manual || r.hidden)
    return { overrides: r.overrides || {}, manual: r.manual || [], hidden: r.hidden || [] };
  return { overrides: r, manual: [], hidden: [] };   // legacy flat map
}
function writePanelEditRec(mark, rec) {
  state.panelEdits = state.panelEdits || {};
  const empty = !Object.keys(rec.overrides || {}).length && !(rec.manual || []).length && !(rec.hidden || []).length;
  if (empty) delete state.panelEdits[mark];
  else state.panelEdits[mark] = { overrides: rec.overrides || {}, manual: rec.manual || [], hidden: rec.hidden || [] };
  persistPanelEdits(mark);
}
function panelOverridesFor(mark) { return panelEditRec(mark).overrides; }
// Resolve one raw parsed cell into its effective panel: auto type/spec, with any manual override
// laid on top. `autoT0`/`autoGaskets` are preserved so the UI can show what the detector said and
// offer a reset.
function resolvePanel(mark, cell, system) {
  const k = panelKey(cell);
  const ov = (panelOverridesFor(mark) || {})[k] || null;
  const autoT0 = cell.t0;
  const t0 = (ov && ov.t0 && PANEL_TYPE_CHOICES.includes(autoT0) && PANEL_TYPE_CHOICES.includes(ov.t0)) ? ov.t0 : autoT0;
  const autoGaskets = defaultGasketsFor(t0, system);
  const gaskets = (ov && Array.isArray(ov.gaskets)) ? ov.gaskets.map(g => ({ part: String(g.part || '').trim(), loops: +g.loops || 0 })).filter(g => g.part) : autoGaskets;
  return { k, x1: cell.x1, y1: cell.y1, x2: cell.x2, y2: cell.y2, t0, autoT0, gaskets, autoGaskets,
    editable: PANEL_EDITABLE_TYPES.includes(autoT0),
    typeSwitchable: PANEL_TYPE_CHOICES.includes(autoT0),
    overridden: !!(ov && (ov.t0 || ov.gaskets)) };
}
// A hand-drawn panel. Every type is allowed and everything about it is editable — it exists only
// because a person put it there, so there is no "auto" value to defer to and nothing to lock.
function resolveManualPanel(mark, m, system) {
  const t0 = PANEL_ALL_TYPES.includes(m.t0) ? m.t0 : 'glass';
  const gaskets = Array.isArray(m.gaskets)
    ? m.gaskets.map(g => ({ part: String(g.part || '').trim(), loops: +g.loops || 0 })).filter(g => g.part)
    : defaultGasketsFor(t0, system);
  return { k: m.k, x1: m.x1, y1: m.y1, x2: m.x2, y2: m.y2, t0, autoT0: t0, gaskets,
    autoGaskets: defaultGasketsFor(t0, system), editable: true, typeSwitchable: true,
    overridden: false, manual: true };
}
// The panels an elevation actually has: auto-detected minus struck-out, plus hand-drawn.
function resolvedPanels(o) {
  if (!o) return [];
  const rec = panelEditRec(o.mark);
  const hidden = new Set(rec.hidden || []);
  const autos = (o.panelCells || []).filter(c => !hidden.has(panelKey(c))).map(c => resolvePanel(o.mark, c, o.system));
  return autos.concat((rec.manual || []).map(m => resolveManualPanel(o.mark, m, o.system)));
}
// Doors the perimeter tracer must know about: the ones the DXF gave us, plus every hand-drawn
// door panel. Without this a drawn door would colour in on the diagram but bill no gasket, and
// the storefront run would still march straight across its opening.
function effectiveDoorRegions(o) {
  const parsed = ((o && o._bands && o._bands.doorRegions) || []).slice();
  for (const p of resolvedPanels(o)) if (p.t0 === 'door' && p.manual)
    parsed.push({ kind: 'DRAWN', minX: p.x1, maxX: p.x2, headY: p.y2 });
  return parsed;
}
function panelPerimeterIn(p) { return 2 * ((p.x2 - p.x1) + (p.y2 - p.y1)); }
// #gasket-in-cutting (2026-08-20, Leo: "用 gasket diagram 里面的数量加起来发在 cutting diagram 里
// … 不需要排列，只需要给我总长和就行"): the gasket diagram's OWN numbers — panel infill + storefront
// perimeter + door jambs — collapsed to one total per part number. Gasket is coil stock, so there
// is nothing to nest onto 24′ sticks; the cut list just needs the running length. Returns inches
// (what the cutting sheet is dimensioned in) with LF alongside.
function openingGasketTotals(o) {
  if (!o) return [];
  const q = o.qty || 1, m = new Map();
  const add = (part, lf) => { if (part && lf > 0) m.set(part, (m.get(part) || 0) + lf * q); };
  for (const part in (o.gasketByPart || {})) add(part, +o.gasketByPart[part] || 0);
  const sg = systemGasket(o.system);
  if (state.includePerimeterGasket !== false) add(sg.perimeterPart, +o.gasketPerimeterLF || 0);
  add(sg.doorPart, +o.gasketDoorLF || 0);
  return [...m.entries()].filter(([, lf]) => lf > 0.05).sort((a, b) => a[0].localeCompare(b[0]))
    .map(([part, lf]) => ({ part, lf: +lf.toFixed(2), inches: +(lf * 12).toFixed(1) }));
}
function allOpeningsGasketTotals() {
  const m = new Map();
  for (const o of scopedOpenings()) for (const g of openingGasketTotals(o)) m.set(g.part, (m.get(g.part) || 0) + g.lf);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([part, lf]) => ({ part, lf: +lf.toFixed(2), inches: +(lf * 12).toFixed(1) }));
}
// Sum every panel's (perimeter × loops) into a { partNumber: LF } map. This is the whole gasket
// takeoff — there is no separate glass/IMP-1 bucket any more, because the part number a panel
// consumes is now data on the panel, not a consequence of its type.
function gasketByPartFromPanels(panels) {
  const out = {};
  for (const p of panels || []) {
    const perim = panelPerimeterIn(p);
    for (const g of p.gaskets || []) {
      if (!g.part || !(g.loops > 0)) continue;
      out[g.part] = (out[g.part] || 0) + (perim * g.loops) / 12;
    }
  }
  for (const k in out) out[k] = +out[k].toFixed(2);
  return out;
}
// Re-resolve an opening's stored raw cells against the current overrides and refresh its totals.
// Called after any panel edit and after a parse, so o.gasketByPart is always in step with o.panels.
function recomputeOpeningGaskets(o) {
  if (!o || !Array.isArray(o.panelCells)) return;
  o.panels = resolvedPanels(o);
  o.gasketByPart = gasketByPartFromPanels(o.panels);
  // #perimeter-live (2026-08-20, Leo — SF15.2 "出来怎么是这样"): the perimeter and door runs are
  // RE-DERIVED here, every time, from the opening's own geometry — never read back from a value
  // frozen at import. Openings live in localStorage across reloads, so a stored number is a number
  // from whatever version of the algorithm happened to be running the day it was parsed: the
  // drawing (always recomputed) and the legend (previously stored) then disagree, which is exactly
  // what the SF15.2 screenshot showed — a picture from the new tracer next to a total from the old
  // one. One source, computed on the spot, cannot drift.
  // NOTE: what a re-derive still cannot recover is DOOR DETECTION itself — doors are found while
  // reading the DXF, so an opening parsed before a detector improvement has no doorRegions and
  // must be re-imported. `_gasketStale` marks that case for the viewer.
  const b = o._bands;
  if (b && b.bbox) {
    const runs = perimeterRuns(b.bbox, o.cuts, b.louverBand, effectiveDoorRegions(o));
    o.gasketPerimeterLF = +(runs.storefront.inches / 12).toFixed(2);
    o.gasketDoorLF = +(runs.door.inches / 12).toFixed(2);
    o._gasketStale = o._pv !== PARSER_VERSION;
  }
}
function recomputeAllGaskets() { for (const o of (state.openings || [])) recomputeOpeningGaskets(o); }
function setPanelOverride(mark, key, patch) {
  if (!mark || !key) return;
  const rec = panelEditRec(mark);
  const man = (rec.manual || []).find(m => m.k === key);
  if (man) {                                   // a hand-drawn panel stores its own state directly
    Object.assign(man, patch);
    if (man.t0 == null) man.t0 = 'glass';
    if (patch.gaskets === null) delete man.gaskets;
    writePanelEditRec(mark, rec);
    return;
  }
  const cur = rec.overrides[key] = rec.overrides[key] || {};
  Object.assign(cur, patch);
  if (cur.t0 == null && !Array.isArray(cur.gaskets)) delete rec.overrides[key];
  writePanelEditRec(mark, rec);
}
function addManualPanel(mark, rect, t0) {
  const r = { x1: Math.min(rect.x1, rect.x2), y1: Math.min(rect.y1, rect.y2),
              x2: Math.max(rect.x1, rect.x2), y2: Math.max(rect.y1, rect.y2) };
  if (r.x2 - r.x1 < 1 || r.y2 - r.y1 < 1) return null;   // a stray click, not a panel
  const rec = panelEditRec(mark);
  const m = { k: 'M' + panelKey(r), x1: +r.x1.toFixed(3), y1: +r.y1.toFixed(3),
              x2: +r.x2.toFixed(3), y2: +r.y2.toFixed(3), t0: PANEL_ALL_TYPES.includes(t0) ? t0 : 'glass' };
  if ((rec.manual || []).some(p => p.k === m.k)) return m.k;   // same rectangle twice — ignore
  rec.manual = (rec.manual || []).concat([m]);
  writePanelEditRec(mark, rec);
  return m.k;
}
function deletePanel(mark, key) {
  const rec = panelEditRec(mark);
  if ((rec.manual || []).some(m => m.k === key)) rec.manual = rec.manual.filter(m => m.k !== key);
  else if (!(rec.hidden || []).includes(key)) rec.hidden = (rec.hidden || []).concat([key]);
  delete rec.overrides[key];
  writePanelEditRec(mark, rec);
}
function clearPanelOverrides(mark) {
  if (state.panelEdits) delete state.panelEdits[mark];
  persistPanelEdits(mark);
}
function persistPanelEdits(mark) {
  const o = (state.openings || []).find(x => x.mark === mark);
  if (o) recomputeOpeningGaskets(o);
  save();
  const fb = window.__fb;
  if (fb && fb.setDoc) {
    try {
      fb.setDoc(fb.doc(fb.elevDb || fb.db, 'elevEdits', String(mark)),
        { panels: (state.panelEdits && state.panelEdits[mark]) || {}, updatedAt: fb.serverTimestamp() }, { merge: true })
        .catch(err => console.warn('[panelEdits] push failed:', err));
    } catch (err) { console.warn('[panelEdits] push failed:', err); }
  }
}

// (#LayerB learned-role propagation removed 2026-07-20 — Leo's call, error rate too high.
//  computeOpeningZones/zoneShapeOf/computeRoleSignature/roleSigKey/persistRoleRule/
//  applyLearnedRoleRules/loadRoleRulesFromCloud all deleted; state.roleRules no longer used.
//  Layer A geometric classification below is unchanged. See PROPAGATION-DESIGN.md §3/§9/§9b
//  (marked ABANDONED) and the template-based approach in §16.)
// #imp1-roles-retired (2026-08-20, Leo): the (IMP-1) role variants no longer exist — a jamb is a
// jamb whether glass or IMP-1 sits behind it, because the ONLY thing that ever differed was the
// gasket, and the gasket is now taken off per infill panel (see PANEL_* below) rather than per
// framing role. `normalizeImp1RoleToBase` is kept (not deleted) purely as the collapse path for
// legacy data: cuts, saved elevEdits snapshots and roleEdits pins written before this change all
// still carry the old labels, and every one of them must land back on its plain base role.
const IMP1_VERTICAL_ROLES = ['Jamb', 'Vertical', 'Vertical (wide)'];
const RETIRED_IMP1_ROLES = { 'Jamb (IMP-1)': 'Jamb', 'Vertical (IMP-1)': 'Vertical', 'Vertical (wide IMP-1)': 'Vertical (wide)' };
function normalizeImp1RoleToBase(position) {
  return RETIRED_IMP1_ROLES[position] || position;
}
// #imp1-roles-retired: the old Stage 1 cut a whole vertical into above/through/below at every
// IMP-1 band so the middle third could carry the (IMP-1) label. With the label gone that split is
// pure damage — one 12′ mullion would still be ordered as three short pieces. This puts already-
// split members back together: adjacent, collinear (same x and width), same-role vertical segments
// whose ends touch are fused into one cut. Only ever merges pieces that are geometrically one
// continuous member, so a genuine two-piece stack (different x, different width, or a real gap)
// is untouched. Runs on fresh parses and on restored snapshots alike, and is idempotent.
const COLLINEAR_MERGE_EPS = 0.75;   // inches — a hairline gap left by the old split, not a real break
function mergeCollinearVerticals(cuts) {
  const isVert = c => c && c.src && c.src.h > c.src.w;
  const key = c => [c.position, Math.round(c.src.x * 4) / 4, Math.round(c.src.w * 4) / 4, c.count || 1, c.src.layer || ''].join('|');
  const groups = new Map();
  const passthrough = [];
  cuts.forEach((c, i) => {
    if (!isVert(c)) { passthrough.push([i, c]); return; }
    const k = key(c);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push([i, c]);
  });
  const merged = [];
  let changed = false;
  for (const list of groups.values()) {
    list.sort((a, b) => a[1].src.y - b[1].src.y);
    let run = null;
    for (const [i, c] of list) {
      if (run && c.src.y <= run.top + COLLINEAR_MERGE_EPS) {
        run.top = Math.max(run.top, c.src.y + c.src.h);
        run.parts.push(c);
        changed = true;
      } else {
        if (run) merged.push(run);
        run = { idx: i, base: c, top: c.src.y + c.src.h, bot: c.src.y, parts: [c] };
      }
    }
    if (run) merged.push(run);
  }
  if (!changed) return false;
  const out = [];
  for (const [i, c] of passthrough) out.push([i, c]);
  for (const r of merged) {
    if (r.parts.length === 1) { out.push([r.idx, r.base]); continue; }
    const s = r.base.src;
    out.push([r.idx, {
      position: r.base.position,
      length: dxfRound(r.top - r.bot),
      count: r.base.count || 1,
      src: { x: s.x, y: dxfRound(r.bot), w: s.w, h: dxfRound(r.top - r.bot), layer: s.layer },
    }]);
  }
  out.sort((a, b) => a[0] - b[0]);
  cuts.length = 0;
  for (const [, c] of out) cuts.push(c);
  return true;
}
// #imp1-roles-retired (2026-08-20, Leo: "frame wise，不再需要区分 jamb/jamb (IMP-1)、
// vertical/vertical (IMP-1)，原来 2 者的区别也只有 gasket，现在不需要这么算 gasket 了，就可以"):
// the two-stage IMP-1 vertical split/relabel that used to live here is GONE. What replaces it is
// two much smaller passes: collapse any legacy (IMP-1) label back to its base role, then fuse the
// three-way splits that the old Stage 1 left behind so a mullion is one piece of stock again.
// The IMP-1 band geometry itself is still detected and still passed in via ctx — it is now used
// only to seed each infill panel's glass/IMP-1 type (buildElevExport), which is where the gasket
// takeoff comes from, and which Leo can override per panel.
function classifyRoles(cuts, ctx) {
  const { system, bbox, imp1Bands = [], louverBand, doorRegions, mark } = ctx;
  const inX = (b, midX) => midX >= b.minX - 6 && midX <= b.maxX + 6;
  for (const cut of cuts) cut.position = normalizeImp1RoleToBase(cut.position);
  mergeCollinearVerticals(cuts);
  // #S3-followup (2026-07-17, Leo): "if it's glass top and bottom, then it's
  // horizontal(glass&glass)". Everything that borders IMP-1 or louver already got its own
  // label above (this step only ever sees whatever is still plain 'Horizontal'), so any
  // remaining plain 'Horizontal' that does NOT touch/cross an IMP-1 band is, by construction,
  // glass on both sides. A 'Horizontal' that DOES touch/cross the band is left unrelabeled —
  // its correct label (`Horizontal (IMP-1&Glass)`) needs a firm spec from Leo first (see
  // memory.md "Horizontal (IMP-1&Glass)").
  if (system === '750XT') {
    for (const cut of cuts) {
      if (cut.position !== 'Horizontal') continue;
      const s = cut.src; if (!s) continue;
      const midX = s.x + s.w / 2;
      const bordersImp1 = imp1Bands.some(b => inX(b, midX) &&
        (Math.abs(s.y - b.maxY) < 3 || Math.abs((s.y + s.h) - b.minY) < 3 || (s.y < b.maxY && (s.y + s.h) > b.minY)));
      if (!bordersImp1) cut.position = 'Horizontal (Glass & Glass)';
    }
  }
  // #whitelist (#2): constrain roles to those that belong to this system.
  applyRoleWhitelist(cuts, system);
  // #fix (2026-07-19, Leo — SF01 data loss): a piece the user has EXPLICITLY assigned a role to
  // via the elevation viewer's Position dropdown (state.roleEdits[mark][srcKey]) must never be
  // silently overridden by the automatic Stage 1/2 IMP-1 geometry reclassification above — that
  // is exactly what happened to SF01 (a hand-classified special case): the reclassification ran
  // on every restore and clobbered a deliberate manual choice with no way to protect it. Applied
  // LAST, after every automatic step, so an explicit per-piece pin always wins. Only covers
  // pieces pinned via the dropdown (state.roleEdits) — see the "changed vs. saved" detection at
  // the elevEdits restore call site for a broader safety net that also catches non-pinned drift.
  applyRolePins(cuts, mark, system, bbox);
}
// #recognized-roles (#2, 2026-07-20, Opus): re-apply the viewer Position-dropdown pins
// (state.roleEdits[mark]), EXCEPT any pin whose role Leo has since retired from this system's
// recognized list — those pins are deleted outright so they can never resurrect the retired role
// on a future re-import (the exact "stale role keeps coming back" symptom from HANDOFF Task 2).
// Factored out of classifyRoles so the sidebar's reapply pass (applyRecognizedRolesToAll) shares
// identical logic. When a system has NO manual recognized list, `recognized` is null and this is
// byte-for-byte the old behaviour — every pin re-applied — so the SF01 pin-protection guarantee is
// fully preserved for un-curated systems. Dropping a pin only happens after Leo has explicitly
// retired that role from the list, which is his deliberate instruction, not a silent override.
// #saved-roles (2026-09-04, Leo: "saved pin 提示都不见了，显示的还是自动识别"):
// a pin only exists for a piece you explicitly re-labelled through the dropdown, but `elevEdits`
// holds EVERY piece of an elevation you have ever corrected, with its role. That record used to be
// all-or-nothing: the geometry signature had to match exactly, and one changed member threw the
// whole thing away and dropped you back to auto-classification. So the drawing gets revised, forty
// correct roles evaporate, and the handful of explicit pins are all that is left to catch you.
//
// Now a saved edit-set that does not match wholesale is still used PIECE BY PIECE: each saved cut
// becomes a pseudo-pin (shape + place within the elevation) and is matched by the same tolerant,
// offset-solving matcher the real pins use. Pieces that still exist keep the role you gave them;
// genuinely new or changed pieces fall through to auto-classification, where they belong. Explicit
// pins are applied afterwards, so they still win.
// #pin-diag (2026-09-04, Leo: "the drawing never changed"): if the drawing did not change then
// the saved edit-set should have restored wholesale and the pins should have matched exactly — so
// one of the things this code believes is false, and from the outside I cannot see which. Rather
// than guess a third time, the viewer can now dump exactly what the tool has: what is stored, what
// the fresh parse produced, and where the two stop agreeing.
// #pin-junk (2026-09-04, from Leo's EL-01 dump): 7 of his 10 pins sat at rx≈13293, ry≈7221 on an
// elevation 110" wide and 114" tall, and carried 750XT role names ("Jamb (X)", "Sill (Glass)") on a
// 45TU opening. They came out of migrateLegacyRolePins: the legacy roleEdits map for EL-01 held
// absolute keys recorded when that mark sat somewhere else entirely, solveLegacyTranslation could
// not find two that agreed, so it assumed no move and subtracted the CURRENT origin from
// coordinates that never belonged to this frame. The result can never match anything, and warned
// about it on every single import.
//
// A pin outside its own elevation is not a pin. Prune them — the legacy map is still untouched, so
// nothing that was real is lost, and the noise stops.
const PIN_OUTSIDE_MARGIN = 24;   // inches of slack beyond the frame before a pin is called junk
function prunePinsOutsideElevation(mark, cuts) {
  const pins = rolePinsFor(mark);
  if (!pins.length) return 0;
  const src = (cuts || []).map(c => c && c.src).filter(Boolean);
  if (src.length < 2) return 0;
  const org = rectsOrigin(src);   // rects, not cuts — cutsOrigin() would read c.src of a raw rect
  const W = Math.max(...src.map(r => r.x + r.w)) - org.x;
  const H = Math.max(...src.map(r => r.y + r.h)) - org.y;
  if (!(W > 0 && H > 0)) return 0;
  const ok = pins.filter(p => p.rx >= -PIN_OUTSIDE_MARGIN && p.ry >= -PIN_OUTSIDE_MARGIN
                           && p.rx <= W + PIN_OUTSIDE_MARGIN && p.ry <= H + PIN_OUTSIDE_MARGIN);
  const dropped = pins.length - ok.length;
  if (dropped) {
    writeRolePins(mark, ok);
    console.warn(`[pins] ${mark}: dropped ${dropped} pin(s) that sit outside the elevation (${_r1(W)}" × ${_r1(H)}") — stale legacy data, the original roleEdits map is untouched`);
  }
  return dropped;
}
// #pin-report-live (2026-09-04, "saved pin 提示都不见了"): the parse-time report lives in memory,
// so the banner vanished on the next page load even though nothing about the pins had changed.
// After a reload there is no parse to report on — so the viewer works it out from what is on
// screen instead of reading a Map that is empty by then.
function livePinReport(o) {
  if (!o) return null;
  const pins = rolePinsFor(o.mark);
  if (!pins.length) return null;
  const { out, unmatched, offset } = matchRolePins(pins, o.cuts, openingPinOrigin(o));
  return { total: pins.length, applied: out.size, retired: 0,
           unmatched: unmatched.length, shifted: 0,
           offset: offset ? { dx: _r1(offset.dx), dy: _r1(offset.dy) } : null, live: true };
}
function pinDiagnostics(o) {
  if (!o) return null;
  const cuts = (o.cuts || []).filter(c => c.src);
  const saved = (state.elevEdits || {})[o.mark] || null;
  const savedCuts = saved && Array.isArray(saved.cuts) ? saved.cuts.filter(c => c && c.src) : [];
  const pins = rolePinsFor(o.mark);
  const org = openingPinOrigin(o);
  const m = pins.length ? matchRolePins(pins, o.cuts, org) : null;
  const rel = list => list.slice(0, 60).map(c => [_r1(c.src.x), _r1(c.src.y), _r1(c.src.w), _r1(c.src.h)].join('|'));
  return {
    mark: o.mark, system: o.system, parserVersion: o._pv || null, buildParser: PARSER_VERSION,
    freshCuts: cuts.length, freshGeoSig: elevGeoSig(o.cuts).slice(0, 120),
    saved: !saved ? null : {
      cuts: savedCuts.length,
      storedGeoSig: String(saved.geoSig || '').slice(0, 120),
      matchesRelative: saved.geoSig === elevGeoSig(o.cuts),
      matchesAbsolute: saved.geoSig === elevGeoSigAbs(o.cuts),
      wouldRestoreWholesale: geoSigMatches(saved.geoSig, o.cuts),
    },
    savedRoleReport: savedRoleReport(o.mark),
    pinsStored: pins.length,
    pinMarksInStore: Object.keys(state.rolePins || {}),
    legacyRoleEditMarks: Object.keys(state.roleEdits || {}),
    migrated: !!((state.rolePinsMigrated || {})[o.mark]),
    pinOrigin: { x: _r1(org.x), y: _r1(org.y) },
    cutsOrigin: (() => { const c0 = cutsOrigin(o.cuts); return { x: _r1(c0.x), y: _r1(c0.y) }; })(),
    pinMatch: !m ? null : { applied: m.out.size, unmatched: m.unmatched.length, offset: m.offset },
    report: rolePinReport(o.mark),
    pins: pins.slice(0, 40),
    unmatchedPins: m ? m.unmatched.slice(0, 40) : [],
    freshRects: rel(cuts),
    savedRects: rel(savedCuts),
  };
}
function applySavedRoles(saved, cuts, mark) {
  if (!saved || !Array.isArray(saved.cuts) || !saved.cuts.length) return null;
  const src = saved.cuts.filter(c => c && c.src);
  if (!src.length) return null;
  const so = cutsOrigin(src), org = cutsOrigin(cuts);
  const pseudo = src.map(c => ({ rx: _r1(c.src.x - so.x), ry: _r1(c.src.y - so.y),
                                 w: _r1(c.src.w), h: _r1(c.src.h), role: c.position }));
  const { out } = matchRolePins(pseudo, cuts, org);
  let applied = 0;
  cuts.forEach((cut, i) => {
    const p = out.get(i);
    if (!p || !p.role) return;
    const role = normalizeImp1RoleToBase(p.role);
    if (cut.position !== role) applied++;
    cut.position = role;
  });
  return { total: pseudo.length, matched: out.size, changed: applied };
}
function applyRolePins(cuts, mark, system, bbox) {
  if (!mark || typeof state === 'undefined' || !state) return;
  const org = pinOrigin(cuts, bbox);
  migrateLegacyRolePins(mark, cuts, org);
  prunePinsOutsideElevation(mark, cuts);
  const pins = rolePinsFor(mark);
  if (!pins.length) { _pinReport.delete(mark); return; }
  const recognized = hasManualRecognizedList(system) ? recognizedRolesForSystem(system) : null;
  const { out, unmatched, offset } = matchRolePins(pins, cuts, org);
  let applied = 0, retired = 0, exact = 0;
  cuts.forEach((cut, ci) => {
    const pin = out.get(ci);
    if (!pin) return;
    // #imp1-roles-retired: a pin written before the (IMP-1) variants were retired is rewritten in
    // place to the base role rather than dropped — the user's intent was "this piece is a jamb",
    // and losing the pin entirely would re-expose the piece to automatic reclassification.
    const base = normalizeImp1RoleToBase(pin.role);
    if (base !== pin.role) { pin.role = base; if (pin._pin) pin._pin.role = base; }
    // A pin holding a role Leo has since retired is SKIPPED, not deleted. The old code deleted it
    // — on a read path — so putting the role back on the recognized list could never bring the
    // pin back. Skipping costs nothing and is reversible.
    if (recognized && !recognized.has(pin.role)) { retired++; return; }
    cut.position = pin.role;
    applied++;
    const cx = cut.src ? cut.src.x - org.x : 0, cy = cut.src ? cut.src.y - org.y : 0;
    if (Math.abs(cx - pin.rx) <= 0.05 && Math.abs(cy - pin.ry) <= 0.05) exact++;
  });
  // Re-anchor the store to what actually matched, so this is solved once and not re-solved on every
  // import — and so a later drawing revision is measured against the current frame.
  if (offset && applied) {
    writeRolePins(mark, pins.map(p => ({ ...p, rx: _r1(p.rx + offset.dx), ry: _r1(p.ry + offset.dy) })));
    console.log(`[pins] ${mark}: re-anchored by ${_r1(offset.dx)}, ${_r1(offset.dy)} — the elevation's bounding box moved, its framing did not`);
  }
  _pinReport.set(mark, { total: pins.length, applied, retired, unmatched: unmatched.length,
                         shifted: applied - exact, offset: offset ? { dx: _r1(offset.dx), dy: _r1(offset.dy) } : null });
  if (unmatched.length) console.warn(`[pins] ${mark}: ${unmatched.length} of ${pins.length} saved role pin(s) found no matching piece in this import`, unmatched);
}// #recognized-roles (#2): re-run the whitelist gate + pin pass over EVERY existing opening, so a
// change to a system's recognized list takes effect immediately on the openings already parsed
// (not only on the next DXF import). Deliberately does NOT re-run the geometric Stage 1/2 split
// (that's only needed when the DXF geometry itself changes) — it just re-gates roles and drops any
// now-retired pins. Net effect of removing a role R from system S: any cut still holding R is
// remapped via ROLE_REMAP if a chain lands in the recognized set (cascade step a); otherwise R
// stays visible as a one-time flag for manual fix (step c) but is now unpinned, so it will not
// resurface after the next re-import. (Live geometric re-derivation — cascade step b — is left to
// the next DXF re-import to avoid re-running the unverified-here split logic on live data.)
function applyRecognizedRolesToAll() {
  for (const o of (state.openings || [])) {
    if (!Array.isArray(o.cuts)) continue;
    applyRoleWhitelist(o.cuts, o.system);
    applyRolePins(o.cuts, o.mark, o.system);
  }
  save();
  if (typeof renderAll === 'function') renderAll();
}
// Programmatic curation API (also used by the sidebar UI). Pass a role array to set/replace the
// list for a system, or null to clear it (revert that system to the SYSTEM_DEFS-derived default).
function setRecognizedRoles(system, roles) {
  if (!system) return;
  state.recognizedRoles = state.recognizedRoles || {};
  if (roles == null) delete state.recognizedRoles[system];
  else state.recognizedRoles[system] = Array.from(new Set(roles.filter(Boolean)));
  applyRecognizedRolesToAll();
}
if (typeof window !== 'undefined') window.setRecognizedRoles = setRecognizedRoles;

// ============================================================
//  #template (2026-07-20, Opus — PROPAGATION-DESIGN.md §16): teach-by-example classification.
//  Leo builds a template from ONE correct reference elevation (its fill stack + the role of every
//  member), then applies it to future imports of the SAME fill layout. Matching is fill-order ONLY
//  (top→bottom sequence of louver/imp-1/glass/door), per Leo — no proportion or bay-count checks.
//  Apply is MANUAL (pick → preview → confirm) and LAYERS ON TOP of Layer A: Layer A still finds the
//  fills + members geometrically; the template only overrides ROLE labels. Templates persist in
//  state.roleTemplates + Firestore `roleTemplates` (one doc per template, same fetch-all/merge
//  pattern as elevEdits; deletion via a {deleted:true} tombstone since the fb wrapper has no
//  deleteDoc). Reuses _bands (kept on each opening) as the geometric source — the deleted Layer B
//  is NOT resurrected: matching here is a strict per-opening fill-sequence equality, not a loose
//  system-wide learned signature.
// ============================================================
// Fill stack for one opening, ordered TOP→BOTTOM. Full-width Y-bands only (louver/imp-1/glass);
// a door region contributes a 'door' band over its Y-extent. Contiguous glass merges.
function computeFillStack(bands) {
  if (!bands || !bands.bbox) return [];
  const bbox = bands.bbox, imp1Bands = bands.imp1Bands || [], louverBand = bands.louverBand, doorRegions = bands.doorRegions || [];
  const hard = [];
  if (louverBand) hard.push({ type: 'louver', minY: louverBand.minY, maxY: louverBand.maxY });
  for (const b of imp1Bands) hard.push({ type: 'imp-1', minY: b.minY, maxY: b.maxY });
  if (doorRegions.length) hard.push({ type: 'door', minY: bbox.minY, maxY: Math.max(...doorRegions.map(d => d.headY)) });
  hard.sort((a, b) => a.minY - b.minY);
  const zones = [];
  let cursor = bbox.minY;
  for (const b of hard) {
    if (b.minY - cursor > 2) zones.push({ type: 'glass', minY: cursor, maxY: b.minY });
    zones.push(b);
    cursor = Math.max(cursor, b.maxY);
  }
  if (bbox.maxY - cursor > 2) zones.push({ type: 'glass', minY: cursor, maxY: bbox.maxY });
  if (!zones.length) zones.push({ type: 'glass', minY: bbox.minY, maxY: bbox.maxY });
  return zones.slice().reverse();  // reverse bottom→top to Leo's top→bottom convention
}
function fillSequenceOf(fillStack) {
  return (fillStack || []).map(z => z.type).join('>');
}
// Auto-detected fill sequence for an opening, with dead-space glass removed: a 'glass' zone that
// contains NO framing member is empty space between/around storefronts, not a real fill. (This is
// what produced the bogus "glass>louver>glass>imp-1>glass" on SF02's stacked louver+main layout —
// the top gap and the gap between the two storefronts were counted as glass.) louver/imp-1/door
// are always kept. NOTE: auto-detect still can't know intent (e.g. whether one glass area is one
// fill or two split by a transom) — that's why the layout is manually overridable below.
function detectFillSequence(o) {
  if (!o || !o._bands) return '';
  const stack = computeFillStack(o._bands);
  const members = (o.cuts || []).filter(c => c.src);
  const kept = stack.filter(z => z.type !== 'glass' || members.some(c => { const my = c.src.y + c.src.h / 2; return my >= z.minY && my <= z.maxY; }));
  return fillSequenceOf(kept.length ? kept : stack);
}
// The fill sequence used for matching + saved on a template: Leo's MANUAL override (o.fillLayout,
// an ordered array of fill types top→bottom) if set, else the auto-detected one. Manual always
// wins — per project rule, every function must stay hand-adjustable.
function openingFillSequence(o) {
  if (o && Array.isArray(o.fillLayout) && o.fillLayout.length) return o.fillLayout.join('>');
  return detectFillSequence(o);
}
function setOpeningFillLayout(o, seqStr) {
  if (!o) return;
  const parts = String(seqStr || '').split('>').map(s => s.trim()).filter(Boolean);
  if (parts.length) o.fillLayout = parts; else delete o.fillLayout;
  save();
}
// A member's slot within a specific opening's fill stack: orientation + width class + whether it
// sits on the opening perimeter + which fill it's in + where in that fill. Scoped to ONE opening
// (not a system-wide key), so it's used only to transfer roles between same-layout elevations under
// an explicit template — never to auto-generalize (that looseness is what killed Layer B).
function memberKeyOf(cut, fillStack, bbox) {
  const s = cut && cut.src;
  if (!s || !bbox) return null;
  const orient = s.w > s.h ? 'H' : 'V';
  const widthClass = (orient === 'V' && s.w >= 3.5) ? 'wide' : 'narrow';
  const midY = s.y + s.h / 2, tol = 3;
  const atEdge = (v, e) => e != null && Math.abs(v - e) < tol;
  let region = 'interior';
  if (orient === 'H' && (atEdge(s.y, bbox.minY) || atEdge(s.y + s.h, bbox.maxY))) region = 'perimeter';
  else if (orient === 'V' && (atEdge(s.x, bbox.minX) || atEdge(s.x + s.w, bbox.maxX))) region = 'perimeter';
  const zones = fillStack || [];
  let zone = zones.find(z => midY >= z.minY && midY <= z.maxY);
  if (!zone && zones.length) zone = zones.reduce((best, z) => { const d = midY < z.minY ? z.minY - midY : midY - z.maxY; return (!best || d < best.d) ? { z, d } : best; }, null).z;
  const regionType = zone ? zone.type : 'glass';
  let regionEdge = 'through';
  if (zone) {
    if (orient === 'H') {
      const nearTop = Math.abs((s.y + s.h) - zone.maxY) < tol || Math.abs(s.y - zone.maxY) < tol;
      const nearBottom = Math.abs(s.y - zone.minY) < tol || Math.abs((s.y + s.h) - zone.minY) < tol;
      regionEdge = nearTop ? 'top' : nearBottom ? 'bottom' : 'through';
    } else {
      const overlap = Math.max(0, Math.min(s.y + s.h, zone.maxY) - Math.max(s.y, zone.minY));
      const frac = s.h > 0 ? overlap / s.h : 0;
      regionEdge = frac > 0.5 ? 'through' : (Math.abs((s.y + s.h) - zone.maxY) < Math.abs(s.y - zone.minY) ? 'top' : 'bottom');
    }
  }
  return [orient, widthClass, region, regionType, regionEdge].join('|');
}
// Build a template from a fully-correct opening: its fill sequence + one role per distinct member
// slot (first-wins; same-slot members in a valid storefront share a role, per Leo's simple model).
function buildTemplateFromOpening(o, name) {
  if (!o || !o._bands) return null;
  const fillStack = computeFillStack(o._bands), bbox = o._bands.bbox, members = [], seen = new Set();
  for (const c of (o.cuts || [])) {
    if (!c.src) continue;
    const key = memberKeyOf(c, fillStack, bbox);
    if (!key || seen.has(key)) continue;
    seen.add(key);
    members.push({ key, role: c.position });
  }
  return { id: uid(), name: String(name || o.mark || 'Template').trim(), system: o.system || '',
    fillSequence: openingFillSequence(o), members, createdAt: Date.now(), updatedAt: Date.now() };
}
// Templates that could apply to this opening: same system AND identical top→bottom fill sequence.
function templatesMatchingOpening(o) {
  if (!o || !o._bands) return [];
  const seq = openingFillSequence(o);
  return (state.roleTemplates || []).filter(t => t.system === o.system && t.fillSequence === seq);
}
// Compute (and optionally commit) the role changes a template would make to an opening. Never
// silent — the UI previews `changes` and only calls again with {commit:true} on confirm. Committing
// also pins each changed role into state.roleEdits so it survives a future re-import (reuses the #1
// pin machinery; those pins are Leo's chosen roles, so the recognized-roles gate keeps them).
function applyTemplateToOpening(o, templateId, opts) {
  opts = opts || {};
  const t = (state.roleTemplates || []).find(x => x.id === templateId);
  if (!t || !o || !o._bands) return { changes: [], applied: false };
  const fillStack = computeFillStack(o._bands), bbox = o._bands.bbox;
  const byKey = new Map(t.members.map(m => [m.key, m.role]));
  const changes = [];
  for (const c of (o.cuts || [])) {
    if (!c.src) continue;
    const role = byKey.get(memberKeyOf(c, fillStack, bbox));
    if (role && role !== c.position) changes.push({ cut: c, from: c.position, to: role });
  }
  if (opts.commit) {
    for (const ch of changes) {
      ch.cut.position = ch.to;
      if (o.mark && ch.cut.src) setRolePin(o.mark, pinOrigin(o.cuts, bbox), ch.cut.src, ch.to);
    }
    o.appliedTemplate = t.id;
    if (typeof persistElevEdits === 'function') persistElevEdits(o);
    save();
  }
  return { changes, applied: !!opts.commit };
}
// ---- template persistence (local + Firestore `roleTemplates`) ----
function saveRoleTemplate(t) {
  if (!t || !t.id) return;
  state.roleTemplates = state.roleTemplates || [];
  const i = state.roleTemplates.findIndex(x => x.id === t.id);
  if (i >= 0) state.roleTemplates[i] = t; else state.roleTemplates.push(t);
  save();
  const fb = window.__fb;
  if (fb && fb.setDoc) {
    try { fb.setDoc(fb.doc(fb.elevDb || fb.db, 'roleTemplates', String(t.id)), Object.assign({}, t, { updatedAt: fb.serverTimestamp() }), { merge: true }).catch(err => console.warn('[roleTemplates] push failed:', err)); }
    catch (err) { console.warn('[roleTemplates] push failed:', err); }
  }
}
function deleteRoleTemplate(id) {
  state.roleTemplates = (state.roleTemplates || []).filter(t => t.id !== id);
  save();
  const fb = window.__fb;
  if (fb && fb.setDoc) {   // tombstone (fb wrapper has no deleteDoc) — loader skips deleted docs
    try { fb.setDoc(fb.doc(fb.elevDb || fb.db, 'roleTemplates', String(id)), { deleted: true, members: [], updatedAt: fb.serverTimestamp() }, { merge: true }).catch(() => {}); } catch (_) {}
  }
}
function loadRoleTemplatesFromCloud() {
  const fb = window.__fb;
  if (!fb || !fb.getDocs || !fb.collection) return;
  fb.getDocs(fb.collection(fb.elevDb || fb.db, 'roleTemplates')).then(snap => {
    const cloud = [];
    snap.forEach(d => { const data = d.data() || {}; if (data && !data.deleted && Array.isArray(data.members)) cloud.push(Object.assign({}, data, { id: d.id })); });
    state.roleTemplates = cloud;
    save();
    if (typeof renderRoleTemplates === 'function') renderRoleTemplates();
  }).catch(err => console.warn('[roleTemplates] load failed:', err));
}
if (typeof window !== 'undefined') {
  if (window.__fb) loadRoleTemplatesFromCloud();
  else window.addEventListener('fb-ready', loadRoleTemplatesFromCloud, { once: true });
}

// 手动修改识别: 点立面图色块/底部 chip 选中某根料 → 内联编辑器(位置/长度/数量/删除); "+ Add cut" 新增。
let viewerOpeningId = null;
let viewerEditIdx = null;
let _viewerGeom = null;      // #2: {minX,maxY} to map a click back to src coords
let viewerSplitSrc = null;   // #2: src-coord point where the user last clicked (for precise split)
let viewerShowGasket = false;  // #gasket-viz (2026-07-19): toggle framing view ↔ gasket diagram
let viewerShowCutting = false; // #cutting-diagram (2026-07-20): toggle framing view ↔ per-elevation cutting diagram
let viewerPanelKey = null;     // #panel-gasket (2026-08-20): panelKey of the panel being edited
let viewerDrawType = null;     // #hand-drawn-panels: 'glass'|'panel'|'door'|'louver' while drawing
let viewerCutDraw = false;     // #cut-drag: drawing a NEW framing piece on the framing view
let viewerCutDrag = null;      // live drag state: { mode:'draw'|'end', idx, end, rect }
let viewerDrawRect = null;     // live rubber-band rectangle, in DXF coords
// Drag an edge to within this of a real frame face and it lands ON it. Hand-drawn panels feed the
// gasket takeoff, so "close enough by eye" is not close enough — the snap is what makes a drawn
// panel measure the same as a detected one.
const PANEL_SNAP_IN = 4;
function frameSnapAxes(o) {
  const xs = [], ys = [];
  for (const c of (o.cuts || [])) if (c.src) {
    xs.push(c.src.x, c.src.x + c.src.w); ys.push(c.src.y, c.src.y + c.src.h);
  }
  // #gasket-any-system: on an elevation with no framing to snap to (nothing parsed, or an opening
  // typed in by hand) there would be nothing magnetic at all. The canvas edges and the panels
  // already drawn are real edges too — snapping to them is how a map gets built from scratch.
  const bb = panelCanvasBox(o);
  if (bb) { xs.push(bb.minX, bb.maxX); ys.push(bb.minY, bb.maxY); }
  for (const p of (o.panels || [])) { xs.push(p.x1, p.x2); ys.push(p.y1, p.y2); }
  return { xs, ys };
}
function snapTo(vals, v) {
  let best = v, bd = PANEL_SNAP_IN;
  for (const f of vals) { const d = Math.abs(f - v); if (d < bd) { bd = d; best = f; } }
  return best;
}

// #panel-gasket: the DXF→SVG frame for one opening, shared by the panel map here and by the frame
// diagram embedded in the cutting DXF, so both always draw the same elevation.
function openingFrameBox(o) {
  const srcs = (o.cuts || []).filter(c => c.src);
  const cells = o.panelCells || [];
  if (!srcs.length && !cells.length) return null;
  const xs = [], ys = [];
  for (const c of srcs) { xs.push(c.src.x, c.src.x + c.src.w); ys.push(c.src.y, c.src.y + c.src.h); }
  for (const c of cells) { xs.push(c.x1, c.x2); ys.push(c.y1, c.y2); }
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}
// #gasket-any-system: what the PANEL MAP is drawn on. openingFrameBox() answers "what did the DXF
// give us" and stays that way (the cutting sheet's frame diagram must not invent geometry) — this
// answers "what can Leo draw on", which must never be nothing. It also counts hand-drawn panels,
// so a map built entirely by hand on a typed-in opening still frames itself correctly.
function panelCanvasBox(o) {
  if (!o) return null;
  const bb = openingFrameBox(o);
  const xs = [], ys = [];
  if (bb) { xs.push(bb.minX, bb.maxX); ys.push(bb.minY, bb.maxY); }
  for (const p of (o.panels || [])) { xs.push(p.x1, p.x2); ys.push(p.y1, p.y2); }
  if (!bb) { xs.push(0, +o.width || 48); ys.push(0, +o.height || 96); }
  return { minX: Math.min(...xs), maxX: Math.max(...xs),
           minY: Math.min(...ys), maxY: Math.max(...ys), synthetic: !bb };
}

// The editable panel map. Panels first (so framing draws over them), then the framing members as
// outlines, then one dashed loop per gasket part on each panel, then the perimeter loop.
function renderPanelSvg(o) {
  const bb = panelCanvasBox(o);
  if (!bb || !(bb.maxX > bb.minX) || !(bb.maxY > bb.minY))
    return '<div style="padding:18px;color:#888;font-size:13px;">This elevation has no size yet — give it a width and height, or import its DXF, and the panel map will open.</div>';
  const W = bb.maxX - bb.minX, H = bb.maxY - bb.minY, pad = Math.max(W, H) * 0.04 + 2;
  const sw = Math.max(W, H) * 0.0018;
  const X = v => (v - bb.minX).toFixed(2), Y = v => (bb.maxY - v).toFixed(2);
  // `inner` (optional) becomes the rect's child content — a <title> for the hover tooltip. Kept
  // as a separate argument rather than smuggled into the attribute string, which silently produced
  // `<rect …><title>…</title>/>` and broke the whole SVG.
  const rect = (x1, y1, x2, y2, attrs, inner) => {
    const head = `<rect x="${X(x1)}" y="${Y(y2)}" width="${(x2 - x1).toFixed(2)}" height="${(y2 - y1).toFixed(2)}" ${attrs}`;
    return inner ? `${head}>${inner}</rect>` : `${head}/>`;
  };
  let svg = '';
  // Nothing was parsed — draw the opening's own outline so there is something to aim at.
  if (bb.synthetic) svg += rect(bb.minX, bb.minY, bb.maxX, bb.maxY,
    `fill="none" pointer-events="none" stroke="#4b5563" stroke-width="${(sw * 3).toFixed(3)}" stroke-dasharray="${(sw * 12).toFixed(2)},${(sw * 8).toFixed(2)}"`);
  for (const p of (o.panels || [])) {
    const title = `${PANEL_TYPE_LABEL[p.t0] || p.t0} · ${formatNumber((p.x2 - p.x1))}" × ${formatNumber((p.y2 - p.y1))}"`
      + (p.gaskets.length ? ' · ' + p.gaskets.map(g => `${g.part}×${g.loops}`).join(', ') : ' · no infill gasket')
      + (p.manual ? ' · drawn by hand' : p.overridden ? ' · hand-set' : '') + (p.editable ? ' (click to edit)' : ' (locked)');
    svg += rect(p.x1, p.y1, p.x2, p.y2,
      `data-panel="${escAttr(p.k)}" fill="${PANEL_TYPE_FILL[p.t0] || '#ddd'}" fill-opacity="0.75" stroke="none" style="cursor:${viewerDrawType ? 'crosshair' : (p.editable ? 'pointer' : 'not-allowed')};"`,
      `<title>${escHtml(title)}</title>`);
  }
  for (const c of (o.cuts || [])) {
    if (!c.src) continue;
    svg += rect(c.src.x, c.src.y, c.src.x + c.src.w, c.src.y + c.src.h, `fill="#4b5563" fill-opacity="0.85" stroke="none"`);
  }
  const inset = (p, d) => [p.x1 + d, p.y1 + d, p.x2 - d, p.y2 - d];
  for (const p of (o.panels || [])) {
    let d = Math.max(0.6, Math.min(W, H) * 0.004);
    for (const g of p.gaskets) {
      if (!g.part || !(g.loops > 0)) continue;
      const [a, b, cx, cy] = inset(p, d);
      if (cx > a && cy > b) svg += rect(a, b, cx, cy, `fill="none" stroke="${gasketPartColor(g.part)}" stroke-width="${(sw * 2).toFixed(3)}" stroke-dasharray="${(sw * 6).toFixed(2)},${(sw * 4).toFixed(2)}"`);
      d += Math.max(1.2, Math.min(W, H) * 0.008);
    }
  }
  // #door-perimeter: draw the ACTUAL perimeter path (same segments the LF is summed from), not a
  // bounding rectangle — at a door it drops down the jambs and skips the threshold, visibly.
  const _sg = systemGasket(o.system);
  if (state.includePerimeterGasket !== false && (_sg.perimeterPart || _sg.doorPart)) {
    const b = (o._bands || {});
    const runs = perimeterRuns(b.bbox || bb, o.cuts, b.louverBand, effectiveDoorRegions(o));
    const draw = (segs, color) => {
      if (!segs.length) return '';
      const d = segs.map(([x1, y1, x2, y2]) => `M${X(x1)} ${Y(y1)}L${X(x2)} ${Y(y2)}`).join('');
      return `<path d="${d}" fill="none" pointer-events="none" stroke="${color}" stroke-width="${(sw * 4).toFixed(3)}" stroke-linecap="butt"/>`;
    };
    if (_sg.perimeterPart) svg += draw(runs.storefront.segs, '#eab308');   // gold  — storefront
    if (_sg.doorPart) svg += draw(runs.door.segs, '#f472b6');               // pink  — door opening
  }
  // The SELECTED panel gets an outline, and nothing else does (Leo, 2026-08-20: "画出来的没必要
  // 再加青色虚线，改过的也不用加紫色虚线"). Hand-drawn and hand-retyped panels used to carry their
  // own coloured dashes; on a real elevation that is a third and fourth dashed rectangle stacked
  // on the gasket loops already there, and the one thing that has to read instantly — which panel
  // am I editing — got lost in it. What a panel IS shows in its fill; how it got that way is in
  // the editor and the counts. Drawn LAST so the selection sits above the framing and the loops.
  for (const p of (o.panels || [])) {
    if (p.k !== viewerPanelKey) continue;
    svg += rect(p.x1, p.y1, p.x2, p.y2,
      `fill="none" pointer-events="none" stroke="#ff2d2d" stroke-width="${(sw * 7).toFixed(3)}"`);
  }
  // the rubber band, while a new panel is being dragged out
  if (viewerDrawRect) {
    const r = viewerDrawRect;
    svg += rect(Math.min(r.x1, r.x2), Math.min(r.y1, r.y2), Math.max(r.x1, r.x2), Math.max(r.y1, r.y2),
      `fill="${PANEL_TYPE_FILL[viewerDrawType] || '#fff'}" fill-opacity="0.35" pointer-events="none" stroke="#22d3ee" stroke-width="${(sw * 5).toFixed(3)}" stroke-dasharray="${(sw * 10).toFixed(2)},${(sw * 6).toFixed(2)}"`);
  }
  return `<svg id="panel-map-svg" data-x0="${bb.minX}" data-y1="${bb.maxY}" viewBox="${(-pad).toFixed(2)} ${(-pad).toFixed(2)} ${(W + 2 * pad).toFixed(2)} ${(H + 2 * pad).toFixed(2)}" style="width:100%;max-height:520px;display:block;background:#0b0e12;${viewerDrawType ? 'cursor:crosshair;' : ''}">${svg}</svg>`;
}
// #hand-drawn-panels: screen point → DXF point, via the SVG's own CTM so it works at any zoom or
// container width, then snapped to the nearest real frame face.
function panelMapPoint(evt, o, snap) {
  const svgEl = document.getElementById('panel-map-svg');
  if (!svgEl || !svgEl.getScreenCTM) return null;
  const m = svgEl.getScreenCTM(); if (!m) return null;
  const pt = svgEl.createSVGPoint(); pt.x = evt.clientX; pt.y = evt.clientY;
  const loc = pt.matrixTransform(m.inverse());
  let x = (+svgEl.dataset.x0) + loc.x, y = (+svgEl.dataset.y1) - loc.y;
  if (snap !== false) { const ax = frameSnapAxes(o); x = snapTo(ax.xs, x); y = snapTo(ax.ys, y); }
  return { x, y };
}
// Inline editor for the selected panel: what it is, and what gasket it takes. Both are free —
// the part number is a text field, not a dropdown, because Leo expects the spec to change.
function renderPanelEditor(o) {
  const p = (o.panels || []).find(x => x.k === viewerPanelKey);
  if (!p) return `<div style="margin-top:8px;font-size:11px;color:#999;">Select a panel above to edit it.</div>`;
  if (!p.editable) return `<div style="margin-top:8px;font-size:11px;color:#999;">
    <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vp-del" style="margin-right:8px;">🗑 Not a panel — remove</button>${p.t0 === 'door'
    ? (systemGasket(o.system).doorPart
        ? `A door's gasket is the two jambs (${escHtml(systemGasket(o.system).doorPart)}, full height) — counted once, in the run below the diagram. Nothing to set on the panel itself.`
        : `${escHtml(o.system)} has no door-jamb gasket run — nothing to set here.`)
    : `${escHtml(PANEL_TYPE_LABEL[p.t0] || p.t0)} panels are locked — no gasket, nothing to set.`}</div>`;
  const rows = p.gaskets.map((g, i) => `
    <div style="display:flex;align-items:center;gap:6px;">
      <input class="tk-cell-input mono" data-gpart="${i}" value="${escAttr(g.part)}" placeholder="Part #" style="width:110px;" />
      <span style="color:#888;">×</span>
      <input class="tk-cell-input num" data-gloops="${i}" type="number" min="0" step="0.5" value="${g.loops}" style="width:64px;" />
      <span style="font-size:11px;color:#888;">loop${g.loops === 1 ? '' : 's'} · ${formatNumber(panelPerimeterIn(p) * g.loops / 12)} LF</span>
      <button class="tk-btn tk-btn--ghost tk-btn--sm" data-gdel="${i}" title="Remove this gasket from this panel">×</button>
    </div>`).join('');
  return `
    <div style="margin-top:10px;padding:10px 12px;border:1px solid var(--af-line,#ddd);border-radius:8px;background:var(--af-bg-2,#f6f6f6);font-size:13px;">
      <div style="display:flex;flex-wrap:wrap;align-items:center;gap:10px;">
        <b>Panel ${formatNumber(p.x2 - p.x1)}" × ${formatNumber(p.y2 - p.y1)}"</b>
        ${p.typeSwitchable ? `<label>This panel is
          <select id="vp-type" class="tk-cell-select">
            ${(p.manual ? PANEL_ALL_TYPES : PANEL_TYPE_CHOICES).map(t => `<option value="${t}" ${t === p.t0 ? 'selected' : ''}>${PANEL_TYPE_LABEL[t]}</option>`).join('')}
          </select>
        </label>
        <span style="font-size:11px;color:#888;">${p.manual ? 'drawn by hand' : 'auto-detected: ' + escHtml(PANEL_TYPE_LABEL[p.autoT0] || p.autoT0)}</span>`
        : `<span style="font-size:12px;">${escHtml(PANEL_TYPE_LABEL[p.t0] || p.t0)} panel</span>`}
        ${p.overridden ? `<button class="tk-btn tk-btn--ghost tk-btn--sm" id="vp-reset">↺ Reset this panel to auto</button>` : ''}
        <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vp-del">🗑 ${p.manual ? 'Delete this panel' : 'Not a panel — remove'}</button>
        <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vp-close">Done</button>
      </div>
      <div style="margin-top:8px;display:flex;flex-direction:column;gap:5px;">
        ${rows || '<span style="font-size:11px;color:#888;">No gasket on this panel.</span>'}
        <div><button class="tk-btn tk-btn--ghost tk-btn--sm" id="vp-gadd">+ Add gasket</button></div>
      </div>
      <div style="margin-top:6px;font-size:11px;color:#999;">Perimeter ${formatNumber(panelPerimeterIn(p))}" — each loop takes one full perimeter. Changing the type re-seeds the gasket rows from the default for that type; edit them afterwards to override.</div>
    </div>`;
}
// #5: floating tooltip showing a role's section drawing (from role-sections.js) on hover.
function _ensureRoleTip() {
  let t = document.getElementById('role-tip');
  if (!t) {
    t = document.createElement('div');
    t.id = 'role-tip';
    t.style.cssText = 'position:fixed;z-index:9999;pointer-events:none;background:#fff;border:1px solid #ccc;border-radius:8px;box-shadow:0 4px 16px rgba(0,0,0,.18);padding:8px 10px;display:none;max-width:230px;font:12px var(--af-font-sans,system-ui);';
    document.body.appendChild(t);
  }
  return t;
}
// #sections-are-750xt-only (2026-08-20, Leo: "45TU 的 piece 鼠标浮上去显示的还是 750XT 的剖面。。。
// 你觉得合理吗"): role-sections.js and part-sections.js were both extracted from 750XT drawings and
// are keyed by ROLE NAME alone, so a 45TU 'Head' happily matched the 750XT 'Head' profile and showed
// a picture of the wrong extrusion. A wrong section drawing is worse than none — it looks
// authoritative. Gated on the system the library came from; for anything else the tooltip lists the
// part numbers that cover that role in THAT system, which is the useful answer we actually have.
const SECTION_LIBRARY_SYSTEM = '750XT';
function showRoleTip(e, cut, system) {
  if (!cut) return;
  const pos = cutDisplayPosition(cut, system);
  const sec = system === SECTION_LIBRARY_SYSTEM ? (window.ROLE_SECTIONS || {})[pos] : null;
  const parts = (state.parts || []).filter(p => p.system === system && (p.roles || []).includes(pos));
  const t = _ensureRoleTip();
  t.innerHTML = `<div style="font-weight:600;margin-bottom:4px;">${escHtml(pos)}</div>` +
    (sec ? `<div style="width:128px;height:92px;display:flex;align-items:center;justify-content:center;">${sec}</div>`
         : `<div style="color:#666;">${parts.length
              ? parts.map(p => `<div><b>${escHtml(p.partNumber)}</b> ${escHtml(p.description || '')}</div>`).join('')
              : 'no parts mapped to this role'}</div>`
           + `<div style="color:#999;margin-top:4px;font-size:11px;">no section drawing for ${escHtml(system || '?')}</div>`);
  t.style.display = 'block';
  moveRoleTip(e);
}
function moveRoleTip(e) {
  const t = document.getElementById('role-tip');
  if (!t || t.style.display === 'none') return;
  t.style.left = (e.clientX + 14) + 'px';
  t.style.top = (e.clientY + 14) + 'px';
}
function hideRoleTip() { const t = document.getElementById('role-tip'); if (t) t.style.display = 'none'; }

function renderViewer(openingId) {
  const o = state.openings.find(x => x.id === openingId);
  const sec = document.getElementById('viewer-section');
  if (!o || !sec) return;
  if (openingId !== viewerOpeningId) viewerEditIdx = null;
  viewerOpeningId = openingId;
  const box = document.getElementById('viewer-box');
  const legend = document.getElementById('viewer-legend');
  const editBox = document.getElementById('viewer-edit');
  document.getElementById('viewer-sub').textContent =
    `${o.mark} — ${o.system} · ${formatNumber(o.width)}" × ${formatNumber(o.height)}"`;
  sec.style.display = '';
  const cuts = o.cuts || (o.cuts = []);
  if (viewerEditIdx != null && (viewerEditIdx < 0 || viewerEditIdx >= cuts.length)) viewerEditIdx = null;

  // #gasket-viz (2026-07-19, Leo: "gasket takeoff is still not accurate... draw gasket lines so
  // I can know how you do the takeoff"): toggle button, always shown when this mark has an
  // exported elevation (built alongside every parse, in ELEV_EXPORTS). Framing view is default;
  // switching to the gasket diagram shows the same SVG buildElevExport pushes to the tracker
  // (infill cells colored by type + both infill gasket loops + the perimeter loop(s)) without
  // needing Firestore — this is exactly the geometry the gasketLF numbers are computed from.
  const _exExport = ELEV_EXPORTS.get(o.mark);
  const _cutGroups = viewerShowCutting ? buildOpeningPacking(o) : null;
  // #gasket-any-system: ALWAYS offered. It used to appear only where the detector had already
  // found infill cells — which is exactly backwards: the elevation the detector read badly (or did
  // not read at all) is the one that most needs a map you can draw by hand.
  const _hasPanels = Array.isArray(o.panelCells) && o.panelCells.length;
  const toggleHtml =
    `<button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-toggle-gasket" style="float:right;margin-left:6px;">${viewerShowGasket ? '📐 Framing view' : '🧵 Gasket diagram'}</button>` +
    `<button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-toggle-cutting" style="float:right;">${viewerShowCutting ? '📐 Framing view' : '📏 Cutting diagram'}</button>`;
  const subEl = document.getElementById('viewer-sub');
  if (subEl && subEl.parentElement) {
    let btnHost = document.getElementById('viewer-gasket-toggle-host');
    if (!btnHost) {
      btnHost = document.createElement('span');
      btnHost.id = 'viewer-gasket-toggle-host';
      subEl.parentElement.appendChild(btnHost);
    }
    btnHost.innerHTML = toggleHtml;
  }
  // #cutting-diagram (2026-07-20, Leo: "show me how pieces for each part align on a 24' line...
  // do this for each elevation separately... export in cad/dxf"): pure-line preview (no per-piece
  // color/label, just baseline + cut ticks — packFFDLayout/stickTickPositions are the single
  // source of truth shared with the DXF export below) scoped to THIS opening only, plus a
  // one-click DXF download for this elevation.
  if (viewerShowCutting) {
    if (!_cutGroups.length) {
      box.innerHTML = `<div style="padding:18px;color:#888;font-size:13px;">No parts with stock cuts for ${escHtml(o.mark)} yet.</div>`;
    } else {
      box.innerHTML = renderCuttingSvg(_cutGroups, o.mark, openingGasketTotals(o));
    }
    box.onmouseover = null; box.onmousemove = null; box.onmouseout = null;
    legend.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12px;align-items:center;">
        ${_cutGroups.map(g => `<span>${escHtml(g.partNumber)} · ${g.sticks.length} stick${g.sticks.length === 1 ? '' : 's'}</span>`).join('')}
        ${_cutGroups.length ? `<button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-export-cutting-dxf">⬇ Export DXF (this elevation)</button>` : ''}
      </div>
      <div style="margin-top:6px;font-size:11px;color:#999;">One bar per 24′ stick with a tick line at each cut — open on the right unless the stick is fully used (leftover length labeled). Part name to the left of each pile, stick number per row, elevation mark as the header. Layer per part number in the DXF.</div>`;
    if (editBox) editBox.innerHTML = '';
    return;
  }
  // #panel-gasket (2026-08-20, Leo: "现在有一个 gasket diagram，但基本不能用"): the gasket view is
  // now built from the opening's OWN stored panel list, not from the session-only ELEV_EXPORTS
  // payload — so it survives a reload, and every glass/IMP-1 panel is a live click target. Click a
  // panel → the editor below lets you flip its type and edit its gasket parts/loops; the LF totals
  // and the accessories table update on the spot, without re-importing the DXF.
  if (viewerShowGasket) {
    if (!Array.isArray(o.panelCells)) o.panelCells = [];
    recomputeOpeningGaskets(o);
    box.innerHTML = renderPanelSvg(o);
    box.onmouseover = null; box.onmousemove = null; box.onmouseout = null;
    const parts = o.gasketByPart || {};
    const partKeys = Object.keys(parts).sort();
    const nEdited = (o.panels || []).filter(p => p.overridden || p.manual).length;
    const nDrawn = (o.panels || []).filter(p => p.manual).length;
    const nHidden = (panelEditRec(o.mark).hidden || []).length;
    // #gasket-any-system: the two ways this diagram can be blank, each said plainly rather than
    // left as an empty black rectangle. Neither is a dead end — both are things Leo can fix here.
    const _sgNow = systemGasket(o.system);
    const _specEmpty = !GASKET_PANEL_TYPES.some(t => _sgNow.panel[t].length) && !_sgNow.perimeterPart && !_sgNow.doorPart;
    const _emptyHint = !(o.panels || []).length
      ? `<div style="margin-top:6px;padding:6px 9px;border-radius:6px;background:#1e293b;color:#cbd5e1;font-size:12px;">
           No panels here yet — the detector found none, or this opening was typed in by hand.
           Pick a type above and <b>drag rectangles</b> to build the map yourself; the takeoff follows what you draw.
         </div>`
      : _specEmpty
      ? `<div style="margin-top:6px;padding:6px 9px;border-radius:6px;background:#1e293b;color:#cbd5e1;font-size:12px;">
           <b>${escHtml(o.system)}</b> has no gasket parts set, so these panels bill nothing yet.
           Set them once for the whole system under <b>Accessories → Gasket defaults</b>, or click a panel to set just that one.
         </div>`
      : '';
    legend.innerHTML = `
      <div style="display:flex;flex-wrap:wrap;gap:14px;font-size:12px;align-items:center;">
        ${['glass', 'panel', 'louver', 'door'].map(t => `<span><span style="display:inline-block;width:12px;height:12px;background:${PANEL_TYPE_FILL[t]};margin-right:5px;"></span>${PANEL_TYPE_LABEL[t]}${t === 'louver' && !systemGasket(o.system).panel.louver.length ? ' (no gasket)' : ''}${t === 'door' && systemGasket(o.system).doorPart ? ` (gasket = 2 jambs, ${systemGasket(o.system).doorPart})` : ''}</span>`).join('')}
        ${partKeys.map(p => `<span><span style="display:inline-block;width:16px;height:0;border-top:2px dashed ${gasketPartColor(p)};margin-right:5px;vertical-align:middle;"></span>${escHtml(p)}</span>`).join('')}
        ${systemGasket(o.system).perimeterPart ? `<span><span style="display:inline-block;width:16px;height:0;border-top:2px solid #eab308;margin-right:5px;vertical-align:middle;"></span>${escHtml(systemGasket(o.system).perimeterPart)} storefront perimeter (×1 / zone)</span>` : ''}
        ${(o.gasketDoorLF || 0) > 0 && systemGasket(o.system).doorPart ? `<span><span style="display:inline-block;width:16px;height:0;border-top:2px solid #f472b6;margin-right:5px;vertical-align:middle;"></span>${escHtml(systemGasket(o.system).doorPart)} door jambs (full height, ×2)</span>` : ''}
      </div>
      <div style="margin-top:6px;font-size:11px;color:#999;">
        ${(o.panels || []).length} panel${(o.panels || []).length === 1 ? '' : 's'}${nEdited ? ` · <b>${nEdited} hand-set</b>` : ''} ·
        ${partKeys.length ? partKeys.map(p => `${escHtml(p)} ${formatNumber(parts[p])}LF`).join(' · ') : 'no infill gasket'} ·
        Perimeter ${formatNumber(o.gasketPerimeterLF || 0)}LF${(o.gasketDoorLF || 0) > 0 ? ` · Door ${formatNumber(o.gasketDoorLF)}LF` : ''}
        ${nEdited ? ` · <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-panels-reset">× reset all panels to auto</button>` : ''}
      </div>
      ${o._gasketStale ? `<div style="margin-top:6px;padding:6px 9px;border-radius:6px;background:#7c2d12;color:#fed7aa;font-size:12px;">
        ⚠ This elevation was parsed by an older build — panels and doors are worked out while reading the DXF and cannot be recovered from saved data. <b>Re-import the DXF</b> to refresh it.
      </div>` : ''}
      <div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;">
        <span style="color:#888;">✏ Draw a panel:</span>
        ${PANEL_ALL_TYPES.map(t => `<button class="tk-btn tk-btn--sm ${viewerDrawType === t ? 'tk-btn--accent' : 'tk-btn--ghost'}" data-draw="${t}">${PANEL_TYPE_LABEL[t]}</button>`).join('')}
        ${viewerDrawType ? `<button class="tk-btn tk-btn--ghost tk-btn--sm" data-draw="">✕ stop drawing</button>` : ''}
        ${nDrawn || nHidden ? `<span style="color:#888;">· ${nDrawn} drawn${nHidden ? `, ${nHidden} removed` : ''}</span>` : ''}
      </div>
      <div style="margin-top:4px;font-size:11px;color:#999;">${viewerDrawType
        ? `Drag a rectangle on the elevation to add a <b>${escHtml(PANEL_TYPE_LABEL[viewerDrawType])}</b> panel — edges snap to the nearest framing member, panel edge or opening edge within ${PANEL_SNAP_IN}". A drawn door bills the same two-jamb run as a detected one.`
        : 'Click a panel to change what it is, to change the gasket it takes, or to remove it. Use ✏ above where the detector missed a panel or a door — hand-drawn panels survive re-import.'}</div>
      ${_emptyHint}`;
    if (editBox) editBox.innerHTML = renderPanelEditor(o);
    return;
  }

  const frameTools = document.getElementById('viewer-frame-tools');
  if (frameTools) frameTools.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;font-size:12px;">
      <span style="color:#888;">✏ Framing:</span>
      <button class="tk-btn tk-btn--sm ${viewerCutDraw ? 'tk-btn--accent' : 'tk-btn--ghost'}" id="vc-draw-cut">${viewerCutDraw ? '✕ stop drawing' : 'Draw a piece'}</button>
      <span style="color:#888;">${viewerCutDraw
        ? `Drag a rectangle — a wide one becomes a horizontal, a tall one a vertical; edges snap within ${CUT_SNAP_IN}".`
        : 'Select a piece, then drag the red handle at either end to change its length.'}</span>
    </div>`;
  const srcs = cuts.filter(c => c.src);
  /* #blank-canvas (2026-08-27, Leo): an opening created by hand has no DXF geometry, so no cut
     carried a `src`, and the frame view fell straight through to the "no source geometry" note
     below. That note is a plain <div> — it is NOT <svg id="frame-map-svg">, which is the surface
     every drawing and dragging handler binds to. So "Draw a piece" was telling you to drag a
     rectangle onto something that did not exist, and pieces you added could only ever be chips.

     The canvas extent was being derived from the PIECES. It should come from the OPENING, which
     knows its own size — it is printed in the header two lines up. Same viewer, same drawing
     tool; it just has a surface now.

     `_bands` is the DXF-parsed marker (templateControlsHtml already tests it the same way). A
     PARSED opening whose pieces were all deleted deliberately keeps the old message: its
     coordinates live in DXF space, where a 0-based opening box would put the canvas nowhere
     near the geometry. */
  const blankBox = (!o._bands && +o.width > 0 && +o.height > 0)
    ? { minX: 0, maxX: +o.width, minY: 0, maxY: +o.height }
    : null;
  if (srcs.length || blankBox) {
    let minX = srcs.length ? Math.min(...srcs.map(c => c.src.x)) : blankBox.minX;
    let maxX = srcs.length ? Math.max(...srcs.map(c => c.src.x + c.src.w)) : blankBox.maxX;
    let minY = srcs.length ? Math.min(...srcs.map(c => c.src.y)) : blankBox.minY;
    let maxY = srcs.length ? Math.max(...srcs.map(c => c.src.y + c.src.h)) : blankBox.maxY;
    // Keep the opening's own box in view once pieces exist, or the canvas would collapse onto
    // the first piece drawn and everything after it would be drawn at the wrong scale.
    if (blankBox) {
      minX = Math.min(minX, blankBox.minX); maxX = Math.max(maxX, blankBox.maxX);
      minY = Math.min(minY, blankBox.minY); maxY = Math.max(maxY, blankBox.maxY);
    }
    _viewerGeom = { minX, maxY };   // #2
    const W = maxX - minX, H = maxY - minY, pad = Math.max(W, H) * 0.04 + 2;
    const minVis = Math.max(W, H) * 0.005;
    const ordered = [...srcs].sort((a, b) => (b.src.w * b.src.h) - (a.src.w * a.src.h));
    const rects = ordered.map(c => {
      const idx = cuts.indexOf(c);
      const s = c.src;
      let y0 = s.y, hh = s.h;
      if (s.h > c.length + 0.6 && (c.position === 'Door Jamb' || c.position === 'Door Jamb At Transom')) {
        hh = c.length;
        if (c.position === 'Door Jamb At Transom') y0 = s.y + s.h - c.length;
      }
      const x = s.x - minX, y = maxY - (y0 + hh); // DXF y朝上 → SVG y朝下
      const dp = cutDisplayPosition(c, o.system);
      const col = cutColor(dp, o.system);
      const sel = idx === viewerEditIdx;
      return `<rect data-cut="${idx}" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(s.w, minVis).toFixed(2)}" height="${Math.max(hh, minVis).toFixed(2)}" fill="${col}" fill-opacity="0.85" stroke="${sel ? '#ff2d2d' : '#222'}" stroke-width="${(Math.max(W, H) * (sel ? 0.006 : 0.0015)).toFixed(3)}" style="cursor:${viewerCutDraw ? 'crosshair' : 'move'};"><title>${escHtml(dp)} — ${formatNumber(c.length)}"${s.layer ? ' · ' + escHtml(s.layer) : ''}  (click to edit)</title></rect>`;
    }).join('');
    // #cut-drag: grab handles on the selected piece, and the rubber band while drawing a new one.
    let overlay = '';
    // #blank-canvas: draw the opening itself, so there is something to aim at and to snap to.
    if (blankBox) {
      const bw = blankBox.maxX - blankBox.minX, bh = blankBox.maxY - blankBox.minY;
      overlay += `<rect x="${(blankBox.minX - minX).toFixed(2)}" y="${(maxY - blankBox.maxY).toFixed(2)}" width="${bw.toFixed(2)}" height="${bh.toFixed(2)}" fill="none" stroke="#8a97a3" stroke-width="${(Math.max(W, H) * 0.004).toFixed(3)}" stroke-dasharray="${(Math.max(W, H) * 0.014).toFixed(2)},${(Math.max(W, H) * 0.009).toFixed(2)}" pointer-events="none"><title>Opening ${escHtml(formatNumber(o.width))}" \u00d7 ${escHtml(formatNumber(o.height))}"</title></rect>`;
      if (!srcs.length) {
        overlay += `<text x="${(blankBox.minX - minX + bw / 2).toFixed(2)}" y="${(maxY - blankBox.maxY + bh / 2).toFixed(2)}" text-anchor="middle" font-size="${(Math.max(W, H) * 0.05).toFixed(2)}" fill="#8a97a3" pointer-events="none">${escHtml(formatNumber(o.width))}" \u00d7 ${escHtml(formatNumber(o.height))}"</text>`;
      }
    }
    const sc = c => c.src.w > c.src.h ? 'ew-resize' : 'ns-resize';
    if (viewerEditIdx != null && cuts[viewerEditIdx] && cuts[viewerEditIdx].src) {
      const s2 = cuts[viewerEditIdx].src, horiz = s2.w > s2.h;
      const L = horiz ? s2.w : s2.h, grab = Math.max(L * CUT_HANDLE_FRAC, Math.min(W, H) * 0.012);
      const hx = Math.max(W, H) * 0.0035;
      for (const end of [0, 1]) {
        const gx = horiz ? (end ? s2.x + s2.w - grab : s2.x) : s2.x;
        const gy = horiz ? s2.y : (end ? s2.y + s2.h - grab : s2.y);
        const gw = horiz ? grab : s2.w, gh = horiz ? s2.h : grab;
        overlay += `<rect data-handle="${end}" x="${(gx - minX).toFixed(2)}" y="${(maxY - (gy + gh)).toFixed(2)}" width="${gw.toFixed(2)}" height="${gh.toFixed(2)}" fill="#ff2d2d" fill-opacity="0.55" stroke="#fff" stroke-width="${hx.toFixed(3)}" style="cursor:${sc(cuts[viewerEditIdx])};"><title>drag to lengthen or shorten</title></rect>`;
      }
    }
    if (viewerCutDrag && viewerCutDrag.rect) {
      const r = viewerCutDrag.rect;
      const rx = Math.min(r.x1, r.x2), ry = Math.min(r.y1, r.y2);
      overlay += `<rect x="${(rx - minX).toFixed(2)}" y="${(maxY - Math.max(r.y1, r.y2)).toFixed(2)}" width="${Math.abs(r.x2 - r.x1).toFixed(2)}" height="${Math.abs(r.y2 - r.y1).toFixed(2)}" fill="#22d3ee" fill-opacity="0.35" pointer-events="none" stroke="#22d3ee" stroke-width="${(Math.max(W, H) * 0.004).toFixed(3)}" stroke-dasharray="${(Math.max(W, H) * 0.01).toFixed(2)},${(Math.max(W, H) * 0.006).toFixed(2)}"/>`;
    }
    box.innerHTML = `<svg id="frame-map-svg" data-x0="${minX}" data-y1="${maxY}" viewBox="${(-pad).toFixed(2)} ${(-pad).toFixed(2)} ${(W + 2 * pad).toFixed(2)} ${(H + 2 * pad).toFixed(2)}" style="width:100%;max-height:520px;display:block;${viewerCutDraw ? 'cursor:crosshair;' : ''}">${rects}${overlay}</svg>`;
    box.onmouseover = e => { const r = e.target.closest && e.target.closest('rect[data-cut]'); if (r) showRoleTip(e, cuts[+r.getAttribute('data-cut')], o.system); };   // #5: role section on hover
    box.onmousemove = moveRoleTip;
    box.onmouseout = e => { if (e.target.closest && e.target.closest('rect[data-cut]')) hideRoleTip(); };
  } else {
    box.innerHTML = `<div style="padding:18px;color:#888;font-size:13px;">No source geometry. Edit with the chips below, or click "+ Add cut" to add a piece.</div>`;
  }

  // 无溯源料(手动加的/手填) → 可点 chip
  const manual = cuts.map((c, i) => ({ c, i })).filter(x => !x.c.src);
  let html = '';
  const _pinN = rolePinsFor(o.mark).length;
  const _elevRec = state.elevEdits && state.elevEdits[o.mark];
  const _sev = _elevRec && (_elevRec.cuts || []).length;   // #persist: full saved edit-set (synced)
  if (_sev || _pinN) {
    const _bits = [];
    if (_sev) _bits.push(`${_sev} pieces saved · synced`);
    if (_pinN) _bits.push(`${_pinN} role pin${_pinN === 1 ? '' : 's'}`);
    html += `<div style="margin:6px 0;font-size:11px;color:#999;">Manual edits on ${escHtml(o.mark)}: ${_bits.join(' · ')} · <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-clear-ov" title="Forget saved edits for this mark (next import reverts to pure auto-detection)">× clear</button> <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-pin-diag" title="Copy what the tool has stored for this mark vs what this import produced — paste it to Claude">🔍 why?</button></div>`;
  } else {
    html += `<div style="margin:6px 0;font-size:11px;color:#999;">No saved edits or role pins for ${escHtml(o.mark)} · <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-pin-diag" title="Copy what the tool has stored vs what this import produced — paste it to Claude">🔍 why?</button></div>`;
  }
  // #role-pins-v2: pins that found no piece in this import are SAID OUT LOUD. Losing them quietly
  // is the bug — an import that silently reverts a month of hand-classification looks identical to
  // one that worked, and you only find out when the numbers are already in a bid.
  const _sr = savedRoleReport(o.mark);
  if (_sr && _sr.matched) {
    html += `<div style="margin:6px 0;font-size:11px;color:#7a8;">✓ The drawing changed since you last saved ${escHtml(o.mark)} — <b>${_sr.matched} of ${_sr.total}</b> saved roles were carried across by shape${
      _sr.total > _sr.matched ? `; the other ${_sr.total - _sr.matched} had no matching piece and those were auto-classified` : ''}.</div>`;
  }
  if (prunePinsOutsideElevation(o.mark, o.cuts)) save();
  const _pr = rolePinReport(o.mark) || livePinReport(o);
  if (_pr && (_pr.unmatched || _pr.retired)) {
    html += `<div style="margin:6px 0;padding:6px 9px;border-radius:6px;background:#7c2d12;color:#fed7aa;font-size:12px;">
      ⚠ ${_pr.unmatched ? `<b>${_pr.unmatched} of ${_pr.total} saved role pin${_pr.total === 1 ? '' : 's'}</b> found no matching piece in this import` : ''}
      ${_pr.unmatched && _pr.retired ? ' · ' : ''}
      ${_pr.retired ? `${_pr.retired} pin${_pr.retired === 1 ? '' : 's'} hold a role retired from ${escHtml(o.system)} (skipped, not deleted — put the role back and they return)` : ''}
      ${_pr.unmatched ? ' — those pieces were auto-classified. The drawing may have changed shape here.' : ''}
    </div>`;
  } else if (_pr && _pr.applied && !_pr.shifted && !_pr.offset) {
    html += `<div style="margin:6px 0;font-size:11px;color:#7a8;">✓ ${_pr.applied} saved role pin${_pr.applied === 1 ? '' : 's'} applied to this elevation.</div>`;
  } else if (_pr && (_pr.shifted || _pr.offset)) {
    html += `<div style="margin:6px 0;font-size:11px;color:#7a8;">✓ ${_pr.applied} role pin${_pr.applied === 1 ? '' : 's'} re-applied${
      _pr.offset ? ` — this elevation sits ${formatNumber(_pr.offset.dx)}, ${formatNumber(_pr.offset.dy)} from where it was; the pins were matched by shape and moved with it` : ' — matched by shape and position'}.</div>`;
  }
  html += templateControlsHtml(o);   // #template (2026-07-20): Save-as / Apply template row
  // #history (2026-07-19, Leo — SF01 data loss): show the last N saved versions for this mark
  // with a one-click Restore, so an overwrite (auto-reclassification, a bad manual edit, etc.)
  // is always recoverable from inside the app — there is no external backup for this data.
  const _hist = (_elevRec && Array.isArray(_elevRec.history)) ? _elevRec.history : [];
  if (_hist.length) {
    const fmtWhen = t => { try { return new Date(t).toLocaleString(); } catch (_) { return ''; } };
    html += `<div style="margin:6px 0;font-size:11px;color:#999;">
      <details><summary style="cursor:pointer;">🕐 Version history (${_hist.length})</summary>
      <div style="margin-top:4px;display:flex;flex-direction:column;gap:4px;">
        ${_hist.map((h, i) => `<div style="display:flex;align-items:center;gap:8px;">
          <span>${fmtWhen(h.updatedAt)} · ${(h.cuts || []).length} pieces</span>
          <button class="tk-btn tk-btn--ghost tk-btn--sm" data-restore-hist="${i}" title="Restore this version (today's version is saved to history first)">↺ Restore</button>
        </div>`).join('')}
      </div></details></div>`;
  }
  // #fix (2026-07-19): visible warning when restoring a saved snapshot caused the automatic
  // classifier to change a piece that was never explicitly pinned — surfaces drift instead of
  // letting it silently overwrite the saved version on the next edit (the SF01 failure mode).
  if (o._reclassifiedDrift && o._reclassifiedDrift.length) {
    html += `<div style="margin:6px 0;padding:6px 10px;border:1px solid #d9822b;border-radius:6px;background:rgba(217,130,43,.12);font-size:11px;">
      ⚠ ${o._reclassifiedDrift.length} piece(s) changed from your saved version when reclassified:
      ${o._reclassifiedDrift.map(d => `${escHtml(d.from)} → ${escHtml(d.to)}`).join(', ')}.
      Use Version history above to restore the previous version if this wasn't intended.</div>`;
  }
  if (manual.length) {
    html += `<div style="margin-top:8px;display:flex;flex-wrap:wrap;gap:6px;font-size:12px;">`
      + manual.map(({ c, i }) => {
          const dp = cutDisplayPosition(c, o.system);
          return `<span data-cut="${i}" style="cursor:pointer;padding:2px 8px;border:1px solid ${i === viewerEditIdx ? '#ff2d2d' : '#bbb'};border-radius:10px;">${escHtml(dp)} · ${formatNumber(c.length)}″ ×${c.count || 1}</span>`;
        }).join('')
      + `</div>`;
  }
  // 选中料的编辑器
  if (viewerEditIdx != null && cuts[viewerEditIdx]) {
    const c = cuts[viewerEditIdx];
    html += `
      <div style="margin-top:10px;padding:10px 12px;border:1px solid var(--af-line,#ddd);border-radius:8px;background:var(--af-bg-2,#f6f6f6);display:flex;flex-wrap:wrap;align-items:center;gap:10px;font-size:13px;">
        <b>Edit piece #${viewerEditIdx + 1}</b>
        <label>Position <select id="vc-pos" class="tk-cell-select">${POSITIONS_FOR(o.system, c.position).map(p => `<option value="${escAttr(p)}" ${p === c.position ? 'selected' : ''}>${p}</option>`).join('')}</select></label>
        <label>Length <input id="vc-len" class="tk-cell-input num" type="number" step="0.125" value="${c.length}" style="width:84px;" />″</label>
        <label>Count <input id="vc-cnt" class="tk-cell-input num" type="number" min="1" step="1" value="${c.count || 1}" style="width:60px;" /></label>
        ${c.src ? `<label title="Face width — 2&quot; for everything except corners and the wide profiles">Width <input id="vc-wid" class="tk-cell-input num" type="number" step="0.125" min="0.125" value="${formatNumber(Math.min(c.src.w, c.src.h))}" style="width:72px;" />″</label>` : ''}
        ${c.src ? `<button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-split" title="Split this piece in two at the point you clicked">✂ Split here</button>
        <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-merge" title="Merge with the adjacent in-line piece of the same role">⧉ Merge</button>` : ''}
        <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-del">Delete piece</button>
        <button class="tk-btn tk-btn--ghost tk-btn--sm" id="vc-done">Done</button>
      </div>`;
  }
  if (editBox) editBox.innerHTML = html;

  const agg = {};
  for (const c of cuts) {
    const dp = cutDisplayPosition(c, o.system);
    if (!agg[dp]) agg[dp] = { len: 0, n: 0 };
    agg[dp].len += c.length * (c.count || 1);
    agg[dp].n += (c.count || 1);
  }
  legend.innerHTML = Object.entries(agg).map(([p, a]) =>
    `<span style="display:inline-flex;align-items:center;gap:5px;"><span style="width:12px;height:12px;border-radius:3px;border:1px solid #555;background:${cutColor(p, o.system)};"></span>${escHtml(p)} · ${a.n} pcs · ${formatNumber(a.len)}"</span>`
  ).join('');
  sec.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

function refreshAfterCutEdit() {
  save();
  if (viewerOpeningId != null) {
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o) persistElevEdits(o);   // #persist (#1): save full edit-set (local + cloud)
    renderViewer(viewerOpeningId);
  }
  renderReport(); renderMeta(); renderOpenings();
}

document.addEventListener('click', e => {
  if (!e.target || !e.target.closest) return;
  if (e.target.closest('#vc-toggle-gasket') && viewerOpeningId != null) {   // #gasket-viz: framing ↔ gasket diagram toggle
    viewerShowGasket = !viewerShowGasket;
    if (viewerShowGasket) viewerShowCutting = false;
    if (!viewerShowGasket) viewerPanelKey = null;
    renderViewer(viewerOpeningId);
    return;
  }
  // ---- #panel-gasket (2026-08-20): panel map interactions ----
  if (viewerShowGasket && viewerOpeningId != null) {
    const o = state.openings.find(x => x.id === viewerOpeningId);
    const after = () => { if (o) recomputeOpeningGaskets(o); renderReport(); renderViewer(viewerOpeningId); };
    // ✏ draw-mode toggle
    const drawBtn = e.target.closest && e.target.closest('[data-draw]');
    if (drawBtn && o) {
      const t = drawBtn.getAttribute('data-draw');
      viewerDrawType = (!t || viewerDrawType === t) ? null : t;
      viewerDrawRect = null;
      if (viewerDrawType) viewerPanelKey = null;
      renderViewer(viewerOpeningId);
      return;
    }
    if (viewerDrawType) return;   // clicks on the map belong to the rubber band, not to selection
    const pRect = e.target.closest && e.target.closest('rect[data-panel]');
    if (pRect && o) {
      const k = pRect.getAttribute('data-panel');
      const panel = (o.panels || []).find(x => x.k === k);
      if (panel) { viewerPanelKey = (viewerPanelKey === k) ? null : k; renderViewer(viewerOpeningId); }
      return;
    }
    if (e.target.closest('#vc-panels-reset') && o) { clearPanelOverrides(o.mark); viewerPanelKey = null; after(); return; }
    if (e.target.closest('#vp-close')) { viewerPanelKey = null; renderViewer(viewerOpeningId); return; }
    if (e.target.closest('#vp-reset') && o && viewerPanelKey) { setPanelOverride(o.mark, viewerPanelKey, { t0: null, gaskets: null }); after(); return; }
    if (e.target.closest('#vp-del') && o && viewerPanelKey) { deletePanel(o.mark, viewerPanelKey); viewerPanelKey = null; after(); return; }
    if (e.target.closest('#vp-gadd') && o && viewerPanelKey) {
      const panel = (o.panels || []).find(x => x.k === viewerPanelKey);
      if (panel) setPanelOverride(o.mark, viewerPanelKey, { gaskets: [...panel.gaskets, { part: '', loops: 1 }] });
      after();
      return;
    }
    const gdel = e.target.closest && e.target.closest('[data-gdel]');
    if (gdel && o && viewerPanelKey) {
      const panel = (o.panels || []).find(x => x.k === viewerPanelKey);
      if (panel) setPanelOverride(o.mark, viewerPanelKey, { gaskets: panel.gaskets.filter((_, i) => i !== +gdel.getAttribute('data-gdel')) });
      after();
      return;
    }
  }
  if (e.target.closest('#vc-toggle-cutting') && viewerOpeningId != null) {   // #cutting-diagram: framing ↔ cutting diagram toggle
    viewerShowCutting = !viewerShowCutting;
    if (viewerShowCutting) viewerShowGasket = false;
    renderViewer(viewerOpeningId);
    return;
  }
  if (e.target.closest('#vc-draw-cut') && viewerOpeningId != null) {   // #cut-drag: draw-a-piece toggle
    viewerCutDraw = !viewerCutDraw;
    viewerCutDrag = null;
    if (viewerCutDraw) viewerEditIdx = null;
    renderViewer(viewerOpeningId);
    return;
  }
  if (e.target.closest('#vc-export-cutting-dxf') && viewerOpeningId != null) {   // #cutting-diagram: export this elevation's DXF
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o) downloadCuttingDxf(o);
    return;
  }
  if (e.target.closest('#vc-fill-auto') && viewerOpeningId != null) {   // #template: reset fill layout to auto-detected
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o) { delete o.fillLayout; save(); renderViewer(viewerOpeningId); }
    return;
  }
  if (e.target.closest('#vc-save-template') && viewerOpeningId != null) {   // #template: save this elevation as a reusable template
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o && o._bands) {
      const name = prompt('Template name:', o.mark || 'Template');
      if (name) { const t = buildTemplateFromOpening(o, name); if (t) { saveRoleTemplate(t); renderRoleTemplates(); renderViewer(viewerOpeningId); } }
    } else if (o) { alert('This opening has no parsed geometry — templates need a DXF-imported elevation.'); }
    return;
  }
  if (e.target.closest('#vc-apply-template') && viewerOpeningId != null) {   // #template: preview then apply
    const o = state.openings.find(x => x.id === viewerOpeningId);
    const pick = document.getElementById('vc-template-pick');
    const id = pick && pick.value;
    if (o && id) {
      const prev = applyTemplateToOpening(o, id, { commit: false });
      if (!prev.changes.length) { alert('This template would not change any roles on this elevation.'); return; }
      const summary = prev.changes.slice(0, 12).map(c => `• ${c.from} → ${c.to}`).join('\n');
      const more = prev.changes.length > 12 ? `\n…and ${prev.changes.length - 12} more` : '';
      if (confirm(`Apply template — ${prev.changes.length} role change(s):\n\n${summary}${more}`)) {
        applyTemplateToOpening(o, id, { commit: true });
        refreshAfterCutEdit();
      }
    }
    return;
  }
  { // #template: delete a saved template from the sidebar list
    const delBtn = e.target.closest('.tmpl-del');
    if (delBtn) {
      const id = delBtn.getAttribute('data-tmpl');
      const t = (state.roleTemplates || []).find(x => x.id === id);
      if (t && confirm(`Delete template "${t.name}"?`)) { deleteRoleTemplate(id); renderRoleTemplates(); }
      return;
    }
  }
  if (e.target.closest('#viewer-close')) {
    document.getElementById('viewer-section').style.display = 'none';
    viewerEditIdx = null;
    return;
  }
  if (e.target.closest('#vc-clear-ov') && viewerOpeningId != null) {   // forget saved edits for this mark (local + cloud)
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o) { clearElevEdits(o.mark); renderViewer(viewerOpeningId); }
    return;
  }
  { // #history: restore a prior version for the mark currently open in the viewer
    const restoreBtn = e.target.closest('[data-restore-hist]');
    if (restoreBtn && viewerOpeningId != null) {
      const o = state.openings.find(x => x.id === viewerOpeningId);
      const idx = +restoreBtn.getAttribute('data-restore-hist');
      if (o && restoreElevEditsVersion(o.mark, idx)) { renderReport(); renderMeta(); renderOpenings(); renderViewer(viewerOpeningId); }
      return;
    }
  }
  if (e.target.closest('#vc-split') && viewerOpeningId != null && viewerEditIdx != null) {   // #2: split at clicked point
    const o = state.openings.find(x => x.id === viewerOpeningId); const c = o && o.cuts && o.cuts[viewerEditIdx];
    if (c && c.src) {
      const s = c.src, R = dxfRound, vertical = s.h >= s.w; let a, b;
      if (vertical) { const yc = Math.min(Math.max((viewerSplitSrc ? viewerSplitSrc.y : s.y + s.h / 2), s.y + 0.5), s.y + s.h - 0.5);
        b = { ...c, length: R(yc - s.y), count: c.count || 1, src: { ...s, y: s.y, h: R(yc - s.y) } };
        a = { ...c, length: R(s.y + s.h - yc), count: c.count || 1, src: { ...s, y: yc, h: R(s.y + s.h - yc) } }; }
      else { const xc = Math.min(Math.max((viewerSplitSrc ? viewerSplitSrc.x : s.x + s.w / 2), s.x + 0.5), s.x + s.w - 0.5);
        a = { ...c, length: R(xc - s.x), count: c.count || 1, src: { ...s, x: s.x, w: R(xc - s.x) } };
        b = { ...c, length: R(s.x + s.w - xc), count: c.count || 1, src: { ...s, x: xc, w: R(s.x + s.w - xc) } }; }
      o.cuts.splice(viewerEditIdx, 1, a, b); viewerEditIdx = null; viewerSplitSrc = null; refreshAfterCutEdit();
    }
    return;
  }
  if (e.target.closest('#vc-merge') && viewerOpeningId != null && viewerEditIdx != null) {   // #2: merge with adjacent in-line piece
    const o = state.openings.find(x => x.id === viewerOpeningId); const c = o && o.cuts && o.cuts[viewerEditIdx];
    if (c && c.src) {
      const s = c.src, vertical = s.h >= s.w, tol = 1.2, gap = 10, R = dxfRound;
      const j = o.cuts.findIndex((k, ix) => ix !== viewerEditIdx && k.src && k.position === c.position && (vertical
        ? (Math.abs(k.src.x - s.x) < tol && (Math.abs((k.src.y + k.src.h) - s.y) < gap || Math.abs((s.y + s.h) - k.src.y) < gap))
        : (Math.abs(k.src.y - s.y) < tol && (Math.abs((k.src.x + k.src.w) - s.x) < gap || Math.abs((s.x + s.w) - k.src.x) < gap))));
      if (j < 0) { alert('No adjacent in-line piece of the same role to merge.'); return; }
      const k = o.cuts[j];
      if (vertical) { const y0 = Math.min(s.y, k.src.y), y1 = Math.max(s.y + s.h, k.src.y + k.src.h); c.src = { ...s, y: y0, h: R(y1 - y0) }; c.length = R(y1 - y0); }
      else { const x0 = Math.min(s.x, k.src.x), x1 = Math.max(s.x + s.w, k.src.x + k.src.w); c.src = { ...s, x: x0, w: R(x1 - x0) }; c.length = R(x1 - x0); }
      o.cuts.splice(j, 1); if (j < viewerEditIdx) viewerEditIdx--; refreshAfterCutEdit();
    }
    return;
  }
  // 选中某根料(立面图色块 或 底部 chip)
  const cutEl = e.target.closest('[data-cut]');
  if (cutEl && (cutEl.closest('#viewer-box') || cutEl.closest('#viewer-edit')) && viewerOpeningId != null) {
    // #place-chip: a chip is a piece with no geometry. Clicking one drops it onto the canvas at
    // its own length, ready to be dragged into place, instead of only selecting it for editing.
    const _ci = parseInt(cutEl.getAttribute('data-cut'), 10);
    const _co = state.openings.find(x => x.id === viewerOpeningId);
    if (_co && _co.cuts && _co.cuts[_ci] && !_co.cuts[_ci].src && cutEl.closest('#viewer-edit')) {
      const _pi = placeCutOnCanvas(_co, _ci);
      if (_pi != null) {
        viewerEditIdx = _pi; viewerSplitSrc = null;
        if (typeof toast === 'function') toast('Placed — drag it into position');
        refreshAfterCutEdit();
        return;
      }
    }
    viewerEditIdx = _ci;
    viewerSplitSrc = null;   // #2: capture the clicked point (in src coords) for a precise split
    const svg = cutEl.ownerSVGElement;
    if (svg && _viewerGeom && svg.getScreenCTM) { try { const pt = svg.createSVGPoint(); pt.x = e.clientX; pt.y = e.clientY; const p = pt.matrixTransform(svg.getScreenCTM().inverse()); viewerSplitSrc = { x: p.x + _viewerGeom.minX, y: _viewerGeom.maxY - p.y }; } catch (_) {} }
    renderViewer(viewerOpeningId);
    return;
  }
  if (e.target.closest('#viewer-addcut') && viewerOpeningId != null) {
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o) {
      o.cuts = o.cuts || [];
      o.cuts.push({ position: 'Head', length: dxfRound(o.width || 24), count: 1 });
      viewerEditIdx = o.cuts.length - 1;
      refreshAfterCutEdit();
    }
    return;
  }
  if (e.target.closest('#vc-del') && viewerOpeningId != null && viewerEditIdx != null) {
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o && o.cuts && o.cuts[viewerEditIdx]) { o.cuts.splice(viewerEditIdx, 1); viewerEditIdx = null; refreshAfterCutEdit(); }
    return;
  }
  if (e.target.closest('#vc-done')) { viewerEditIdx = null; if (viewerOpeningId != null) renderViewer(viewerOpeningId); return; }
});

// 编辑器字段改动(位置/长度/数量)
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'vc-fill-layout' && viewerOpeningId != null) {   // #template: manual fill-layout override
    const o = state.openings.find(x => x.id === viewerOpeningId);
    if (o) { setOpeningFillLayout(o, e.target.value); renderViewer(viewerOpeningId); }
    return;
  }
  // #panel-gasket (2026-08-20): panel type / gasket-spec edits. Changing the TYPE re-seeds the
  // gasket rows from that type's default (and drops any previous per-panel gasket override), so
  // "this is actually IMP-1" does the obvious thing in one click; editing a part/loops field after
  // that pins the whole spec for this panel only.
  if (viewerShowGasket && viewerOpeningId != null && viewerPanelKey && e.target.closest && e.target.closest('#viewer-edit')) {
    const o = state.openings.find(x => x.id === viewerOpeningId);
    const panel = o && (o.panels || []).find(x => x.k === viewerPanelKey);
    if (!o || !panel) return;
    if (e.target.id === 'vp-type') {
      const t = e.target.value;
      setPanelOverride(o.mark, viewerPanelKey, { t0: (t === panel.autoT0 ? null : t), gaskets: null });
    } else if (e.target.hasAttribute('data-gpart') || e.target.hasAttribute('data-gloops')) {
      const next = panel.gaskets.map(g => ({ part: g.part, loops: g.loops }));
      const i = +(e.target.getAttribute('data-gpart') ?? e.target.getAttribute('data-gloops'));
      if (!next[i]) return;
      if (e.target.hasAttribute('data-gpart')) next[i].part = String(e.target.value || '').trim().toUpperCase();
      else next[i].loops = Math.max(0, parseFloat(e.target.value) || 0);
      setPanelOverride(o.mark, viewerPanelKey, { gaskets: next.filter(g => g.part) });
    } else return;
    recomputeOpeningGaskets(o);
    renderReport();
    renderViewer(viewerOpeningId);
    return;
  }
  if (viewerOpeningId == null || viewerEditIdx == null) return;
  if (!e.target.closest || !e.target.closest('#viewer-edit')) return;
  const o = state.openings.find(x => x.id === viewerOpeningId);
  if (!o || !o.cuts || !o.cuts[viewerEditIdx]) return;
  const c = o.cuts[viewerEditIdx];
  if (e.target.id === 'vc-pos') {
    c.position = e.target.value;
    // #role-pins-v2: remember this manual role override, keyed to where the piece sits inside
    // its own elevation — so it survives the drawing being moved, not just re-imported.
    if (c.src && o.mark) setRolePin(o.mark, openingPinOrigin(o), c.src, c.position);
  }
  else if (e.target.id === 'vc-len') {
    c.length = parseFloat(e.target.value) || 0;
    // #place-chip: once a piece is on the canvas the drawing IS the piece, so a typed length has
    // to resize it. Leaving src stale made the picture and the cut list disagree silently.
    if (c.src && c.length > 0) {
      const vert = c.src.h >= c.src.w;
      setCutGeometry(o, viewerEditIdx, vert ? { x: c.src.x, y: c.src.y, w: c.src.w, h: c.length }
                                            : { x: c.src.x, y: c.src.y, w: c.length, h: c.src.h });
    }
  }
  else if (e.target.id === 'vc-wid') {
    const wv = parseFloat(e.target.value) || 0;
    if (c.src && wv > 0) {
      const vert = c.src.h >= c.src.w;
      setCutGeometry(o, viewerEditIdx, vert ? { x: c.src.x, y: c.src.y, w: wv, h: c.src.h }
                                            : { x: c.src.x, y: c.src.y, w: c.src.w, h: wv });
    }
  }
  else if (e.target.id === 'vc-cnt') c.count = Math.max(1, parseInt(e.target.value) || 1);
  else return;
  refreshAfterCutEdit();
});

// #hand-drawn-panels: drag a rectangle on the panel map. Bound once at module level (the map is
// re-rendered constantly, so per-render listeners would leak); everything is guarded on draw mode
// being on, so with the pencil off these are three no-ops.
(function bindPanelDrawing() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  let drawing = false;
  const opening = () => (typeof state !== 'undefined' && state.openings)
    ? state.openings.find(x => x.id === viewerOpeningId) : null;
  const repaint = () => {
    const box = document.getElementById('viewer-box');
    const o = opening();
    if (box && o) box.innerHTML = renderPanelSvg(o);   // redraw the map only — the legend is stable mid-drag
  };
  document.addEventListener('mousedown', e => {
    if (!viewerShowGasket || !viewerDrawType || viewerOpeningId == null) return;
    if (!e.target.closest || !e.target.closest('#panel-map-svg')) return;
    const o = opening(); if (!o) return;
    const p = panelMapPoint(e, o); if (!p) return;
    e.preventDefault();
    drawing = true;
    viewerDrawRect = { x1: p.x, y1: p.y, x2: p.x, y2: p.y };
    repaint();
  });
  document.addEventListener('mousemove', e => {
    if (!drawing || !viewerDrawRect) return;
    const o = opening(); if (!o) return;
    const p = panelMapPoint(e, o); if (!p) return;
    viewerDrawRect.x2 = p.x; viewerDrawRect.y2 = p.y;
    repaint();
  });
  document.addEventListener('mouseup', () => {
    if (!drawing) return;
    drawing = false;
    const r = viewerDrawRect; viewerDrawRect = null;
    const o = opening();
    if (!o || !r) { repaint(); return; }
    const k = addManualPanel(o.mark, r, viewerDrawType);
    if (k) viewerPanelKey = k;                  // land in the editor on the panel just drawn
    recomputeOpeningGaskets(o);
    renderReport();
    renderViewer(viewerOpeningId);
  });
})();

// ============================================================
//  #elevation-workbook (2026-08-20, Leo: "上司要求给每一个 elevation 做一个 excel 表格，你参考
//  750XT page，帮我做一次性批量生成 excel 表格功能全放一个文件里")
//
//  One workbook, one worksheet per elevation, laid out like the 750XT page of Leo's own
//  "750XT / 45TU takeoff.xlsx" — because that sheet is what his boss already reads. Each sheet is
//  in two halves, exactly as he builds them by hand:
//    · the ORDER BLOCK up top — Part # / Detail / Total Cut Length / Stocks (FFD) / +15%, grouped
//      into the banner sections of the reference sheet (Dark Bronze extrusions, Non-Color
//      accessories, Fastener, Gasket, Hardware, Anchor).
//    · the AUDIT BLOCK below — the tool's own per-part dump with the roles that fed each number,
//      which is the only way to check the sheet above without re-running the takeoff.
//  A leading "ALL ELEVATIONS" sheet carries the pooled project totals in the same layout.
//
//  Section membership and box sizes are read straight off the reference workbook rather than
//  guessed; anything not listed there falls back to a rule of thumb AND is reported in the console
//  and in a note on the sheet, so a new part shows up as a question instead of landing silently in
//  the wrong section.
// ============================================================
const XL_SECTIONS = [
  { key: 'extrusion', title: sys => `${sys} Horizontal/Vertical / Dark Bronze` },
  { key: 'plate',     title: sys => `${sys} Horizontal/Vertical Accessories / Non - Color` },
  { key: 'fastener',  title: () => 'Fastener' },
  { key: 'gasket',    title: () => 'Gasket' },
  { key: 'hardware',  title: () => 'Hardware' },
  { key: 'anchor',    title: () => 'Anchor' },
];
// part number → section, transcribed from the 750XT page of the reference workbook
const XL_PART_SECTION = {
  'E9-1206': 'extrusion', 'BE9-3904': 'extrusion', 'BE9-3910': 'extrusion', 'E9-1660': 'extrusion',
  'E9-3162': 'extrusion', 'A': 'extrusion', 'C': 'extrusion', 'BY7-9065': 'extrusion',
  'AS-3906': 'plate', 'AS-3907': 'plate', 'AS-7110': 'plate', 'B': 'plate',
  'HF-2510-W1': 'fastener', 'FC-1220': 'fastener', 'FC-1212': 'fastener', 'HD-2516-W3-SS': 'fastener',
  'E2-0120': 'gasket', 'E2-0127': 'gasket', 'E2-0052': 'gasket',
  'E1-3504': 'hardware', 'E1-9837': 'hardware', 'E2-9942': 'hardware',
  'E1-3603': 'hardware', 'E2-0513': 'hardware',   // setting block chair / setting block
  'E1-1222': 'anchor', 'E1-1234': 'anchor',
};
// order quantity per box, also from the reference sheet. Absent → ordered as loose pieces.
// How each part is PURCHASED: `per` = how many of the takeoff's own unit come in one purchasable
// unit, `unit` = what you actually order. Transcribed from the reference workbook, except the
// setting blocks (see below). Order qty = ceil(takeoff qty / per).
const XL_ORDER_PACK = {
  'HF-2510-W1': { per: 100, unit: 'BOX' }, 'FC-1220': { per: 100, unit: 'BOX' },
  'FC-1212': { per: 100, unit: 'BOX' }, 'HD-2516-W3-SS': { per: 100, unit: 'BOX' },
  'E1-3504': { per: 50, unit: 'BOX' }, 'E1-9837': { per: 20, unit: 'BOX' }, 'E2-9942': { per: 50, unit: 'BOX' },
  'E2-0120': { per: 500, unit: 'BOX' }, 'E2-0127': { per: 250, unit: 'BOX' }, 'E2-0052': { per: 250, unit: 'BOX' },
  // E1-3603 / E2-0513 deliberately absent: the setting block and its chair are now taken off as a
  // COUNT (2 per panel, at the quarter points of the D.L.O.), not as a run length, so there is
  // nothing to divide by a 24′ stock length. They are ordered as pieces until Leo gives a block
  // length to cut from stock.
};
// Not stored on the accessory rule itself: cloud-sync's cleanAccessories keeps only
// partNumber/description/rule/positions/param/min/unit, so any extra field is dropped on the round
// trip through Firestore. This table is the place for "how is it bought".
function xlOrderPack(partNumber) {
  return XL_ORDER_PACK[String(partNumber || '').trim().toUpperCase()] || null;
}
const XL_SYSTEM_TITLE = { '750XT': 'YKK AP YCW 750XT Curtainwall', '45TU': 'YKK AP YES 45TU Storefront' };
const XL_UNKNOWN_SECTION = new Set();
function xlSectionFor(partNumber, description, isGasket) {
  const pn = String(partNumber || '').trim().toUpperCase();
  if (isGasket) return 'gasket';
  if (XL_PART_SECTION[pn]) return XL_PART_SECTION[pn];
  const d = (description || '').toLowerCase();
  if (pn) XL_UNKNOWN_SECTION.add(pn);   // a blank P/N is a known unknown (setting blocks), not a surprise
  if (/anchor/.test(d)) return 'anchor';
  if (/gasket/.test(d)) return 'gasket';
  if (/screw|fastener|hwhs|fhsms|hwhms|smd|bolt/.test(d)) return 'fastener';
  if (/pressure plate/.test(d)) return 'plate';
  if (/block|clip|shear|splice|bracket/.test(d)) return 'hardware';
  return 'extrusion';
}
const XL_STOCK_UPLIFT = 1.15;   // "Stocks +15%" — the waste/breakage allowance on the reference sheet

// Everything one elevation contributes, already grouped into the reference sheet's sections.
// `o === null` pools every opening in the project (the ALL ELEVATIONS sheet).
function xlRowsFor(o) {
  const groups = Array.isArray(o) ? buildGroupPacking(o) : o ? buildOpeningPacking(o) : buildPooledPacking();   // #cut-groups: array = one cut group, pooled
  const out = { extrusion: [], plate: [], fastener: [], gasket: [], hardware: [], anchor: [] };
  const audit = [];
  for (const g of groups) {
    const inches = g.sticks.reduce((t, st) => t + (g.stock - (st.remaining || 0)), 0);
    const ffd = g.sticks.length;
    const sec = xlSectionFor(g.partNumber, g.description, false);
    out[sec].push({ part: g.partNumber, detail: g.description || '', inches,
      qty: ffd, unit: 'PCS', order: Math.ceil(ffd * XL_STOCK_UPLIFT), orderUnit: 'PCS' });
    audit.push({ system: g.system, part: g.partNumber, desc: g.description || '',
      roles: rolesForPart(g.system, g.partNumber), inches, ffd, up: Math.ceil(ffd * XL_STOCK_UPLIFT) });
  }
  // gaskets — LF, ordered by the box
  for (const t of (Array.isArray(o) ? groupGasketTotals(o) : o ? openingGasketTotals(o) : allOpeningsGasketTotals())) {
    const pack = xlOrderPack(t.part);
    out.gasket.push({ part: t.part, detail: 'Glazing Gasket', inches: t.lf, qty: pack ? pack.per : null,
      unit: 'LF', order: pack ? Math.ceil(t.lf / pack.per) : Math.ceil(t.lf), orderUnit: pack ? pack.unit : 'LF' });
    // gasket is coil stock: the audit row carries the run, not a stick count
    audit.push({ system: Array.isArray(o) ? ((o[0] || {}).system || '') : o ? o.system : '', part: t.part, desc: `Gasket — ${formatNumber(t.lf)} LF`,
      roles: 'infill panels + storefront perimeter + door jambs', inches: +(t.inches).toFixed(1), ffd: '', up: '' });
  }
  // rule-based accessories (fasteners, blocks, anchors) — computeAccessories is project-wide, so
  // for one elevation it is re-run against that elevation alone.
  const keepOpenings = state.openings;
  if (o) state.openings = Array.isArray(o) ? o : [o];
  let accRows = [];
  try { accRows = computeAccessories().filter(r => !r.acc._computed); } finally { state.openings = keepOpenings; }
  // A row with neither a part number nor a description cannot be ordered, so it does not belong on
  // an order sheet — and with nothing to classify it, it used to fall through to the extrusion
  // section and appear as two blank lines under Dark Bronze. Counted and reported instead.
  let skipped = 0;
  for (const { acc: a, qty, basis } of accRows) {
    if (!(qty > 0)) continue;
    if (!String(a.partNumber || '').trim() && !String(a.description || '').trim()) { skipped++; continue; }
    const sec = xlSectionFor(a.partNumber, a.description, false);
    const pack = xlOrderPack(a.partNumber);
    // Stocks column = how many come in one purchasable unit. Blank when the part is ordered loose —
    // repeating the quantity there (the first attempt) read as "66 per box", which is not a thing.
    out[sec].push({ part: a.partNumber, detail: a.description || '', inches: qty,
      qty: pack ? pack.per : null, unit: (a.unit || 'ea').toUpperCase(),
      order: pack ? Math.ceil(qty / pack.per) : Math.ceil(qty),
      orderUnit: pack ? pack.unit : (a.unit || 'ea').toUpperCase(), basis });
  }
  for (const k in out) out[k].sort((a, b) => String(a.part).localeCompare(String(b.part), undefined, { numeric: true }));
  audit.sort((a, b) => String(a.part).localeCompare(String(b.part), undefined, { numeric: true }));
  return { out, audit, skipped };
}
function rolesForPart(system, partNumber) {
  return (state.parts || []).filter(p => p.system === system && p.partNumber === partNumber)
    .flatMap(p => p.roles || []).filter((v, i, a) => a.indexOf(v) === i).join(' / ');
}

// The project name printed on every sheet. Editable next to the export button and remembered with
// the rest of the state — the boss reads this line first, and it is the one thing on the sheet the
// tool cannot work out for itself.
function xlProjectName() { return (state.projectName && String(state.projectName).trim()) || 'AC3'; }
function buildElevationSheet(o, opts) {
  const XS = window.XLSX_STYLE;
  const isGroup = Array.isArray(o);   // #cut-groups: o may be an array of openings = one cut group
  const system = (isGroup ? ((o[0] || {}).system || '') : o ? o.system : '') || (opts && opts.system) || (scopedOpenings()[0] || {}).system || '';
  const rows = [], merges = [];
  const put = (r, arr) => { rows[r] = arr; };
  const band = (r, text, big) => { rows[r] = [{ v: text, s: big ? XS.BANNER : XS.BANNER_SM, h: big ? 18 : 16 }, ...Array(8).fill({ s: big ? XS.BANNER : XS.BANNER_SM })]; merges.push(`A${r + 1}:I${r + 1}`); };

  put(0, [{ v: 'Date', s: XS.LABEL }, { v: ':' }, { f: 'TODAY()', s: XS.DATE }, { v: XL_SYSTEM_TITLE[system] || (system + ' Curtainwall'), s: XS.TITLE }]);
  merges.push('D1:I2');
  put(1, [{ v: 'Project Name', s: XS.LABEL }, { v: ':' }, { v: xlProjectName() }]);
  put(2, [{ v: isGroup ? 'Elevation group' : o ? 'Elevation' : 'Scope', s: XS.LABEL }, { v: ':' },
          { v: isGroup ? `${(opts && opts.groupKey) || ''} — ${o.map(x => x.mark).join(' + ')}   (cut together, pooled onto shared ${STOCK_INCHES / 12}′ stock)`
                 : o ? `${o.mark}${(o.qty || 1) > 1 ? ` × ${o.qty}` : ''}   ${formatNumber(o.width)}" × ${formatNumber(o.height)}"`
                 : ((opts && opts.scopeText) || `ALL ELEVATIONS — ${scopedOpenings().length} mark(s)`) }]);

  const HEAD = ['Part #', 'Detail', '', '', 'Total Cut Length (in)', 'Stocks (FFD)', 'Unit', 'Stocks +15% (pcs)', 'Unit'];
  const HR = 4;
  put(HR, HEAD.map(v => ({ v, s: XS.HEAD, h: 30 })));
  merges.push(`B${HR + 1}:D${HR + 1}`);

  const { out, skipped } = xlRowsFor(o);
  let r = HR + 2;
  for (const sec of XL_SECTIONS) {
    const list = out[sec.key];
    if (!list.length) continue;
    band(r, sec.title(system), sec.key === 'extrusion' || sec.key === 'plate');
    r++;
    for (const it of list) {
      const total = +(+it.inches).toFixed(2);
      rows[r] = [
        { v: it.part, s: XS.TEXT },
        { v: it.detail, s: XS.TEXT_L }, { s: XS.TEXT_L }, { s: XS.TEXT_L },
        // whole numbers print as whole numbers — "58.00 ea" of a shear block reads like a mistake
        { v: total, s: Number.isInteger(total) ? XS.INT : XS.NUM2 },
        { v: it.qty == null ? '' : Math.round(it.qty), s: XS.INT },
        { v: it.unit, s: XS.TEXT },
        { v: Math.round(it.order), s: XS.INT },
        { v: it.orderUnit, s: XS.TEXT },
      ];
      merges.push(`B${r + 1}:D${r + 1}`);
      r++;
    }
    r++;   // a blank line between sections, same as the reference sheet
  }

  // No audit block: Leo's boss reads the order sheet, and the takeoff detail belongs in the tool
  // (viewer + report), not stapled to the bottom of every sheet. (2026-08-20: "excel doesn't need
  // to have takeoff detail".)
  r += 1;
  rows[r++] = [{ v: `Generated by the AC3 takeoff tool · stock ${STOCK_INCHES}" (${STOCK_INCHES / 12}′) · +15% uplift on stock counts · gasket from the panel takeoff`, s: XS.NOTE }];
  if (XL_UNKNOWN_SECTION.size)
    rows[r++] = [{ v: 'Not in the reference sheet, placed by rule of thumb — check the section: ' + [...XL_UNKNOWN_SECTION].join(', '), s: XS.NOTE }];
  if (skipped)
    rows[r++] = [{ v: `${skipped} accessory rule(s) skipped — they have no part number and no description. Name them in the Accessories table to get them onto this sheet.`, s: XS.NOTE }];

  return { name: isGroup ? ((opts && opts.sheetName) || (((opts && opts.groupKey) || 'GROUP') + ' group')) : o ? o.mark : ((opts && opts.sheetName) || 'ALL ELEVATIONS'),
    cols: [{ w: 21.6 }, { w: 15.9 }, { w: 24 }, { w: 36.9 }, { w: 21 }, { w: 13 }, { w: 8 }, { w: 18 }, { w: 19.6 }],
    merges, rows, freeze: `A${HR + 2}` };
}

// #export-scope: one summary sheet PER SYSTEM when the scope holds more than one. A single mixed
// summary carries one system's name in its title banner and one system's order lines underneath
// another's — it reads like a 750XT order that happens to contain 45TU parts. Shared by both
// workbooks so the group file and the per-elevation file always open on the same totals.
function summarySheetsFor(opens) {
  const syss = [...new Set(opens.map(o => o.system || ''))];
  const sheets = [];
  for (const sys of syss) {
    const keep = state.openings;
    state.openings = opens.filter(o => (o.system || '') === sys);
    try {
      sheets.push(buildElevationSheet(null, {
        system: sys,
        sheetName: syss.length > 1 ? `ALL ${sys}` : 'ALL ELEVATIONS',
        scopeText: `ALL ${syss.length > 1 ? sys + ' ' : ''}ELEVATIONS — ${state.openings.length} mark(s)`,
      }));
    } finally { state.openings = keep; }
  }
  return sheets;
}
function downloadElevationWorkbook() {
  if (!window.makeXlsx) { alert('xlsx-writer.js did not load — check index.html.'); return; }
  const opens = scopedOpenings();
  if (!opens.length) { alert('No openings in the current export scope.'); return; }
  XL_UNKNOWN_SECTION.clear();
  const sheets = summarySheetsFor(opens);
  for (const o of opens) sheets.push(buildElevationSheet(o));
  emitWorkbook(sheets, `${xlProjectName()} takeoff by elevation${scopeSuffix()}.xlsx`);
}
// #cut-groups (2026-08-21, Leo: "keep both group and separate excel"): the grouped workbook is its
// OWN file/button — downloadElevationWorkbook() above stays exactly one sheet per elevation, so the
// separate takeoff never changes shape when the grouping changes.
// (rev2, Leo: "if it's a group, only group, no separate") This workbook is the GROUP view and
// nothing else: a mark that belongs to a real group appears ONLY inside its group's pooled sheet —
// no member sheets, because the shop cutting 04.1 and 04.2 off shared stock cannot act on a
// per-elevation stick count. A mark with no sibling has no group to pool into, so it keeps its own
// sheet (that sheet IS its group of one). Same scoping as the grouped DXF: one column per group.
// The per-elevation numbers still live in the other workbook.
function downloadGroupWorkbook() {
  if (!window.makeXlsx) { alert('xlsx-writer.js did not load — check index.html.'); return; }
  const opens = scopedOpenings();
  if (!opens.length) { alert('No openings in the current export scope.'); return; }
  XL_UNKNOWN_SECTION.clear();
  const sheets = summarySheetsFor(opens);
  for (const g of groupOpeningsByMark(opens)) {
    if (g.openings.length > 1) sheets.push(buildElevationSheet(g.openings, { groupKey: g.key, sheetName: g.key + ' group' }));
    else sheets.push(buildElevationSheet(g.openings[0]));
  }
  emitWorkbook(sheets, `${xlProjectName()} takeoff by cut group${scopeSuffix()}.xlsx`);
}
// Shared tail for both workbooks — one place that turns sheets into a download + status line.
function emitWorkbook(sheets, filename) {
  const blob = window.makeXlsx(sheets);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  if (XL_UNKNOWN_SECTION.size) console.warn('[xlsx] parts not in the reference sheet, sectioned by rule of thumb:', [...XL_UNKNOWN_SECTION].join(', '));
  const st = document.getElementById('export-status');
  if (st) { st.textContent = `Exported ${sheets.length} sheet(s) · ${scopeLabel()}: ` + sheets.map(sh => sh.name).join(', ')
    + (XL_UNKNOWN_SECTION.size ? ' — check the section of: ' + [...XL_UNKNOWN_SECTION].join(', ') : ''); st.className = 'tk-dxf__status is-ok'; }
}

// #cut-drag: drag a framing piece's end to change its length, or drag out a new piece. Bound once
// at module level (the view re-renders on every change, so per-render listeners would leak). Every
// handler is guarded on the framing view being visible with a drag in progress, so this is inert
// the rest of the time.
(function bindCutDragging() {
  if (typeof document === 'undefined' || !document.addEventListener) return;
  const opening = () => (typeof state !== 'undefined' && state.openings)
    ? state.openings.find(x => x.id === viewerOpeningId) : null;
  // screen → DXF, through the SVG's own CTM so it works at any container width
  const pt = (evt, o, skipIdx) => {
    const el = document.getElementById('frame-map-svg');
    if (!el || !el.getScreenCTM) return null;
    const m = el.getScreenCTM(); if (!m) return null;
    const p = el.createSVGPoint(); p.x = evt.clientX; p.y = evt.clientY;
    const loc = p.matrixTransform(m.inverse());
    const ax = cutSnapAxes(o, skipIdx);
    return { x: snapAxis(ax.xs, (+el.dataset.x0) + loc.x), y: snapAxis(ax.ys, (+el.dataset.y1) - loc.y) };
  };
  // #move: the snapped `pt` above is right for drawing (the cursor IS the corner) but wrong for
  // moving — there the cursor is an arbitrary grab point, so the thing that must land on a snap
  // axis is the piece's own edge. This returns the raw position; the mover snaps the edges.
  const rawPt = (evt) => {
    const el = document.getElementById('frame-map-svg');
    if (!el || !el.getScreenCTM) return null;
    const m = el.getScreenCTM(); if (!m) return null;
    const q = el.createSVGPoint(); q.x = evt.clientX; q.y = evt.clientY;
    const loc = q.matrixTransform(m.inverse());
    return { x: (+el.dataset.x0) + loc.x, y: (+el.dataset.y1) - loc.y };
  };
  /* Snap whichever EDGE actually engaged, and carry the piece with it. Compare the two snap
     DELTAS, not the resulting positions: measuring "which result is closer to where I was"
     always picks the edge that did not snap (its delta is zero by definition), so a piece
     dragged up under the head would never catch it. */
  const snapSpan = (axes, lo, len) => {
    const dLo = snapAxis(axes, lo) - lo;
    const dHi = snapAxis(axes, lo + len) - (lo + len);
    const d = (dLo !== 0 && (dHi === 0 || Math.abs(dLo) <= Math.abs(dHi))) ? dLo : dHi;
    return lo + d;
  };
  const repaint = () => { if (viewerOpeningId != null) renderViewer(viewerOpeningId); };

  document.addEventListener('mousedown', e => {
    if (viewerShowGasket || viewerShowCutting || viewerOpeningId == null) return;
    if (!e.target.closest || !e.target.closest('#frame-map-svg')) return;
    const o = opening(); if (!o) return;
    const h = e.target.closest('rect[data-handle]');
    if (h && viewerEditIdx != null && o.cuts[viewerEditIdx]) {
      const p = pt(e, o, viewerEditIdx); if (!p) return;
      e.preventDefault();
      viewerCutDrag = { mode: 'end', idx: viewerEditIdx, end: +h.getAttribute('data-handle'), start: { ...o.cuts[viewerEditIdx].src } };
      return;
    }
    // #move: grab a piece anywhere on its body and slide it. This is what makes placing a chip
    // useful — you supply the position by dragging, having already supplied the length by typing.
    // Not while the pencil is on: there a drag across a piece is meant to draw a new one.
    if (!viewerCutDraw) {
      const body = e.target.closest('rect[data-cut]');
      if (body) {
        const bi = parseInt(body.getAttribute('data-cut'), 10);
        const bc = o.cuts && o.cuts[bi];
        if (bc && bc.src) {
          const g = rawPt(e); if (!g) return;
          e.preventDefault();
          viewerCutDrag = { mode: 'move', idx: bi, start: { ...bc.src }, grab: g, moved: false };
        }
      }
      return;
    }
    const p = pt(e, o, -1); if (!p) return;
    e.preventDefault();
    viewerCutDrag = { mode: 'draw', rect: { x1: p.x, y1: p.y, x2: p.x, y2: p.y } };
    repaint();
  });

  document.addEventListener('mousemove', e => {
    if (!viewerCutDrag) return;
    const o = opening(); if (!o) return;
    if (viewerCutDrag.mode === 'draw') {
      const p = pt(e, o, -1); if (!p) return;
      viewerCutDrag.rect.x2 = p.x; viewerCutDrag.rect.y2 = p.y;
      repaint();
      return;
    }
    if (viewerCutDrag.mode === 'move') {
      const g = rawPt(e); if (!g) return;
      const s0 = viewerCutDrag.start;
      const dx = g.x - viewerCutDrag.grab.x, dy = g.y - viewerCutDrag.grab.y;
      if (!viewerCutDrag.moved && Math.abs(dx) < 0.25 && Math.abs(dy) < 0.25) return;  // a click, not a drag
      viewerCutDrag.moved = true;
      const ax = cutSnapAxes(o, viewerCutDrag.idx);
      setCutGeometry(o, viewerCutDrag.idx, {
        x: snapSpan(ax.xs, s0.x + dx, s0.w), y: snapSpan(ax.ys, s0.y + dy, s0.h), w: s0.w, h: s0.h });
      repaint();
      return;
    }
    // end drag: move only the end being held, along the member's own axis, and never past the
    // other end (a zero- or negative-length member is not a thing).
    const c = o.cuts[viewerCutDrag.idx]; if (!c || !c.src) return;
    const p = pt(e, o, viewerCutDrag.idx); if (!p) return;
    const s0 = viewerCutDrag.start, horiz = s0.w > s0.h, MIN = 0.5;
    if (horiz) {
      const far = viewerCutDrag.end ? s0.x : s0.x + s0.w;
      const v = Math.min(Math.max(p.x, far === s0.x ? far + MIN : -Infinity), far === s0.x ? Infinity : far - MIN);
      setCutGeometry(o, viewerCutDrag.idx, { x: Math.min(v, far), y: s0.y, w: Math.abs(v - far), h: s0.h });
    } else {
      const far = viewerCutDrag.end ? s0.y : s0.y + s0.h;
      const v = Math.min(Math.max(p.y, far === s0.y ? far + MIN : -Infinity), far === s0.y ? Infinity : far - MIN);
      setCutGeometry(o, viewerCutDrag.idx, { x: s0.x, y: Math.min(v, far), w: s0.w, h: Math.abs(v - far) });
    }
    repaint();
  });

  document.addEventListener('mouseup', () => {
    if (!viewerCutDrag) return;
    const d = viewerCutDrag; viewerCutDrag = null;
    const o = opening();
    if (!o) { repaint(); return; }
    if (d.mode === 'move' && !d.moved) { return; }   // plain click — leave selection to the click handler
    if (d.mode === 'draw') {
      const r = d.rect;
      const x = Math.min(r.x1, r.x2), y = Math.min(r.y1, r.y2);
      const w = Math.abs(r.x2 - r.x1), h = Math.abs(r.y2 - r.y1);
      if (Math.max(w, h) < 1) { repaint(); return; }        // a stray click, not a member
      // Orientation decides the role, and the role is then yours to change in the editor below —
      // guessing further (Head vs Horizontal vs Sill) from a freehand rectangle would be noise.
      const horiz = w >= h;
      const cut = { position: horiz ? 'Horizontal' : 'Vertical', length: dxfRound(Math.max(w, h)), count: 1,
        src: { x: +x.toFixed(3), y: +y.toFixed(3), w: +Math.max(w, 0.5).toFixed(3), h: +Math.max(h, 0.5).toFixed(3), layer: '' } };
      o.cuts.push(cut);
      viewerEditIdx = o.cuts.length - 1;     // land in the editor on the piece just drawn
    }
    refreshAfterCutEdit();
  });
})();

// ---------- Accessories takeoff (rules engine) ----------
// #acc-rules-v2 (2026-08-20, Leo — fastener/anchor rules from YKK 04-4014-25 + his own takeoff
// workbook): the five original rules all measure the FRAMING (pieces, spacing, LF, lites,
// openings). The fastener rules do not work that way — they hang off ANOTHER PART:
//   "(2) HF-2510-W1 per shear block"                   → 2 × however many shear blocks there are
//   "pressure plate punched 0.281" holes at 9" O.C."   → pressure-plate inches ÷ 9
// Expressing those as framing rules meant re-deriving the shear-block count inside three separate
// rules and keeping them in step by hand — which is exactly how Leo's spreadsheet ends up with
// `=G77*2` and `=G78` pointing at each other. Two rule types make the dependency explicit instead:
//   per_part      qty = param × (pieces of the referenced part(s))
//   per_part_len  qty = (total inches of the referenced part(s)) ÷ param
// For these two the Positions column holds PART NUMBERS, not roles. The referenced part may be a
// stock part (from the cut list) or another accessory row — one level of indirection, no chains,
// so the order of evaluation can never matter.
const ACC_RULES = {
  per_piece:    { label: '/ piece',    paramLabel: 'qty per piece' },
  per_spacing:  { label: 'spacing',    paramLabel: 'o.c. inches'   },
  per_lf:       { label: '× LF',       paramLabel: 'factor'        },
  per_lite:     { label: '/ lite',     paramLabel: 'qty per lite'  },
  per_opening:  { label: '/ opening',  paramLabel: 'qty per opening' },
  per_part:     { label: '/ part qty', paramLabel: 'qty per piece of that part' },
  per_part_len: { label: '÷ part o.c.', paramLabel: 'o.c. inches along that part' },
  // #per-panel (2026-08-20, Leo): "install setting block chairs and rubber/silicone setting blocks
  // at the 1/4 points of the daylight opening (D.L.O.) along the sill or intermediate horizontal
  // member — so 2 for each panel (not just lite because imp-1 panel needs setting block too)".
  // `per_lite` cannot express that: lites are a vision-glass count, and an IMP-1 panel is not a
  // lite but still sits on setting blocks. This reads the PANEL MAP instead — the same glass /
  // IMP-1 / louver / door panels the gasket takeoff uses, including any drawn by hand — so a
  // re-typed or hand-drawn panel changes this count too. For this rule the Positions column holds
  // PANEL TYPES (Glass / IMP-1 / Louver / Door); empty means glass + IMP-1.
  per_panel:    { label: '/ panel',    paramLabel: 'qty per panel' },
};
// The Positions column means three different things depending on the rule, which is invisible in a
// bare text box. Placeholder + tooltip now say which one is expected.
const ACC_POSITIONS_HINT = {
  per_part: '(part numbers)', per_part_len: '(part numbers)',
  per_panel: 'Glass, IMP-1, Louver, Door',
};
const ACC_POSITIONS_HELP = {
  per_part: 'PART NUMBERS this rule hangs off (e.g. E1-3504) — not roles.',
  per_part_len: 'PART NUMBERS whose total length is divided by the o.c. spacing — not roles.',
  per_panel: 'PANEL TYPES: Glass, IMP-1, Louver, Door. Empty = Glass + IMP-1. Not roles, and not part numbers.',
};
const ACC_PANEL_TYPE_ALIAS = { 'glass': 'glass', 'imp-1': 'panel', 'imp1': 'panel', 'panel': 'panel', 'louver': 'louver', 'door': 'door' };
const ACC_PART_REF_RULES = ['per_part', 'per_part_len'];

function computeAccessories() {
  // 按系统聚合: 每个 system 一份 {pos, lites, openingsQty}; system '' 视为全部洞口(旧通用行为)
  const bySys = {};
  const agg = (sys) => bySys[sys] || (bySys[sys] = { pos: {}, lites: 0, openingsQty: 0, panels: {} });
  const allOpen = { pos: {}, lites: 0, openingsQty: 0, panels: {} };
  const tally = (g, o, q) => {
    g.openingsQty += q;
    g.lites += (parseFloat(o.lites) || 0) * q;
    // #per-panel: panel counts by type. Recomputed on demand — an opening restored from storage
    // has its panelCells but not necessarily the resolved panels, and a rule that silently read 0
    // would look like "this elevation needs no setting blocks".
    if (Array.isArray(o.panelCells) && !Array.isArray(o.panels)) recomputeOpeningGaskets(o);
    if (Array.isArray(o.panelCells)) g.hasPanelMap = true;
    for (const p of (o.panels || [])) g.panels[p.t0] = (g.panels[p.t0] || 0) + q;
    for (const c of expandOpeningCuts(o)) {
      const p = g.pos[c.position] || (g.pos[c.position] = { inches: 0, pieces: 0, lens: [] });
      p.inches += c.length * c.count * q;
      p.pieces += c.count * q;
      for (let i = 0; i < c.count * q; i++) p.lens.push(c.length);
    }
  };
  for (const o of scopedOpenings()) {
    const q = o.qty || 1;
    tally(agg(o.system || ''), o, q);
    tally(allOpen, o, q);
  }
  const ruleRows = (state.accessories || []).map(a => {
    if (ACC_PART_REF_RULES.includes(a.rule)) return { acc: a, qty: 0, basis: '', _deferred: true };
    const g = (a.system === '' || a.system === undefined) ? allOpen : (bySys[a.system] || { pos: {}, lites: 0, openingsQty: 0, panels: {} });
    const pos = g.pos, lites = g.lites, openingsQty = g.openingsQty, panelsByType = g.panels || {};
    const sel = (a.positions && a.positions.length) ? a.positions : Object.keys(pos);
    let inches = 0, pieces = 0, lens = [];
    for (const p of sel) if (pos[p]) {
      inches += pos[p].inches; pieces += pos[p].pieces; lens = lens.concat(pos[p].lens);
    }
    const param = parseFloat(a.param) || 0;
    const mn = parseFloat(a.min) || 0;
    let qty = 0, basis = '', warn = '';
    if (a.rule === 'per_piece') {
      qty = Math.ceil(param * pieces);
      basis = `${pieces} pcs × ${param}`;
    } else if (a.rule === 'per_lite') {
      qty = Math.ceil(param * lites);
      basis = `${formatNumber(lites)} lites × ${param}`;
    } else if (a.rule === 'per_panel') {
      const want = (a.positions && a.positions.length)
        ? a.positions.map(t => ACC_PANEL_TYPE_ALIAS[String(t).trim().toLowerCase()]).filter(Boolean)
        : ['glass', 'panel'];
      const n = want.reduce((t, k) => t + (panelsByType[k] || 0), 0);
      qty = Math.ceil(param * n);
      const bad = want.length !== (a.positions || []).length;
      basis = `${n} panel${n === 1 ? '' : 's'} (${want.map(k => PANEL_TYPE_LABEL[k] || k).join(' + ')}) × ${param}`;
      // #per-panel-zero: three different reasons a /panel rule reads 0, each with a different fix.
      if (!n) {
        if (bad || !want.length) { warn = `Positions must be panel TYPES for a / panel rule — ${PANEL_ALL_TYPES.map(t => PANEL_TYPE_LABEL[t]).join(' / ')}. "${(a.positions || []).join(', ')}" matches none.`; }
        else if (!g.hasPanelMap) { warn = 'these elevations have no panel map — re-import the DXF, or draw panels in the 🧵 Gasket diagram'; }
        else { warn = `no ${want.map(k => PANEL_TYPE_LABEL[k] || k).join(' / ')} panels in scope`; }
      }
    } else if (a.rule === 'per_opening') {
      qty = Math.ceil(param * openingsQty);
      basis = `${openingsQty} openings × ${param}`;
    } else if (a.rule === 'per_spacing') {
      qty = param > 0 ? lens.reduce((acc, L) => acc + Math.max(mn, Math.floor(L / param) + 1), 0) : 0;
      basis = `${lens.length} pcs @ ${param}" o.c., min ${mn}/pc`;
    } else if (a.rule === 'per_lf') {
      qty = Math.ceil(param * inches / 12 * 10) / 10;
      basis = `${formatNumber(inches)}" × ${param} ÷ 12`;
    }
    return { acc: a, qty, basis, warn };
  });
  // ---- second pass: rules that hang off another part's quantity ----
  // Stock parts come from the same FFD packing the cut list uses, so "pieces" here means the same
  // thing it means everywhere else in the tool; accessory rows contribute the qty just computed.
  if (ruleRows.some(r => r._deferred)) {
    const refTotals = {};       // PART NUMBER → { pieces, inches }
    const bump = (pn, pieces, inches) => {
      const k = String(pn || '').trim().toUpperCase();
      if (!k) return;
      const t = refTotals[k] || (refTotals[k] = { pieces: 0, inches: 0 });
      t.pieces += pieces; t.inches += inches;
    };
    for (const b of buildPooledPacking()) {
      const inches = b.sticks.reduce((acc, st) => acc + (b.stock - (st.remaining || 0)), 0);
      bump(b.partNumber, b.sticks.length, inches);
    }
    for (const r of ruleRows) if (!r._deferred && r.qty > 0) bump(r.acc.partNumber, r.qty, 0);
    for (const r of ruleRows) {
      if (!r._deferred) continue;
      const a = r.acc;
      const refs = (a.positions && a.positions.length) ? a.positions : [];
      const param = parseFloat(a.param) || 0;
      let pieces = 0, inches = 0;
      const named = [];
      for (const ref of refs) {
        const t = refTotals[String(ref).trim().toUpperCase()];
        named.push(String(ref).trim());
        if (t) { pieces += t.pieces; inches += t.inches; }
      }
      if (!refs.length) { r.basis = 'no part referenced — put the part number(s) in the Positions column'; continue; }
      if (a.rule === 'per_part') {
        r.qty = Math.ceil(param * pieces);
        r.basis = `${pieces} × ${named.join(' + ')} × ${param}`;
      } else {
        r.qty = param > 0 ? Math.ceil(inches / param) : 0;
        r.basis = `${formatNumber(inches)}" of ${named.join(' + ')} ÷ ${param}"`;
      }
      delete r._deferred;
    }
  }
  // #panel-gasket (2026-08-20): gaskets are now taken off PER INFILL PANEL, not per framing role
  // and not by a whole-opening perimeter formula. Every panel carries its own gasket spec (part +
  // loops), defaulted from its glass/IMP-1 type and overridable one panel at a time — so the rows
  // below are simply "sum of (panel perimeter × loops) per part number", plus the storefront
  // perimeter run which is still its own independent takeoff.
  const gsum = new Map();     // partNumber -> LF
  const addG = (part, lf) => { if (!part || !(lf > 0)) return; gsum.set(part, (gsum.get(part) || 0) + lf); };
  // Keyed by part, not a single scalar: a project can hold 750XT and 45TU openings at once, and
  // their perimeter/door runs are different parts (or, for 45TU, no run at all).
  const perimBy = new Map(), doorBy = new Map();
  const bump = (m, k, v) => { if (k && v > 0) m.set(k, (m.get(k) || 0) + v); };
  for (const o of scopedOpenings()) {
    const q = o.qty || 1, sg = systemGasket(o.system);
    const by = o.gasketByPart || null;
    if (by) for (const part in by) addG(part, (+by[part] || 0) * q);
    bump(perimBy, sg.perimeterPart, (+(o.gasketPerimeterLF || 0)) * q);
    bump(doorBy, sg.doorPart, (+(o.gasketDoorLF || 0)) * q);
  }
  const gaskRows = [...gsum.entries()].filter(([, lf]) => lf > 0.05)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([part, raw]) => {
      const lf = Math.round(raw * 10) / 10, box = gasketBoxLF(part), boxes = box ? Math.ceil(lf / box) : 0;
      return { acc: { _computed: true, partNumber: part, description: 'Gasket — infill panels (per-panel takeoff)', rule: 'panel', positions: [], param: '', min: 0, unit: 'LF', system: '750XT' },
        qty: lf, basis: box ? (boxes + ' box' + (boxes > 1 ? 'es' : '') + ' @ ' + box + "'/box") : '' };
    });
  // #door-perimeter: storefront and door are separate rows on purpose (Leo: "把 door gasket 单独
  // 算更好，这样逻辑上更顺"). They share a part number today but never share a number — the
  // storefront run skips each door's width at the sill and the door run owns its whole opening,
  // so every physical edge is counted exactly once.
  const addPerimRow = (lf0, part, desc, rule) => {
    if (rule === 'perimeter' && state.includePerimeterGasket === false) return;   // the toggle is the storefront run only — a door still needs its jambs
    if (!(lf0 > 0.05)) return;
    const lf = Math.round(lf0 * 10) / 10, box = gasketBoxLF(part), boxes = box ? Math.ceil(lf / box) : 0;
    gaskRows.push({ acc: { _computed: true, partNumber: part, description: desc, rule, positions: [], param: '', min: 0, unit: 'LF', system: '750XT' },
      qty: lf, basis: box ? (boxes + ' box' + (boxes > 1 ? 'es' : '') + ' @ ' + box + "'/box") : '' });
  };
  for (const [part, lf] of perimBy) addPerimRow(lf, part, 'Gasket — storefront perimeter ×1 (per independent zone, door width excluded)', 'perimeter');
  for (const [part, lf] of doorBy) addPerimRow(lf, part, 'Gasket — door ×1 (both jambs, full height; no header, no threshold, no panel loop)', 'door');
  return ruleRows.concat(gaskRows);
}


// ---------- Gasket defaults by system (#gasket-any-system, 2026-08-24) ----------
// Leo: "I need gasket view for all systems … this tool needs to be an independent tool that
// doesn't rely on position detection algorithm. It's expected to manually set panels/pieces/
// gaskets". So what a panel takes stopped being a fact about 750XT and 45TU baked into the code,
// and became a per-system setting anyone can type. Changing it flows straight through every
// AUTO-typed and hand-drawn panel that has no per-panel override of its own — the override layer
// is untouched, so nothing Leo set by hand is disturbed.
let _gdSystem = null;
function gdSystem() {
  const list = SYSTEMS_LIST();
  if (_gdSystem && list.includes(_gdSystem)) return _gdSystem;
  const inUse = (state.openings || []).map(o => o.system).filter(s => list.includes(s));
  return inUse[0] || list[0] || '';
}
function renderGasketDefaults() {
  const host = document.getElementById('gasket-defaults');
  if (!host) return;
  const list = SYSTEMS_LIST();
  const sys = gdSystem();
  if (!sys) { host.innerHTML = ''; return; }
  const g = systemGasket(sys), custom = isSystemGasketCustom(sys);
  const row = (t, label, hint) => `
    <label style="display:flex;align-items:center;gap:8px;">
      <span style="width:150px;flex:none;color:var(--af-fg-3,#888);">${label}</span>
      <input class="tk-cell-input mono" data-gd="${t}" value="${escAttr(gasketSpecText(g.panel[t]))}"
             placeholder="${escAttr(hint)}" style="flex:1;min-width:0;" />
    </label>`;
  host.innerHTML = `
    <details class="gd-box" ${custom ? 'open' : ''} style="margin-bottom:12px;border:1px solid var(--af-line,#ddd);border-radius:8px;background:var(--af-bg-2,#f6f6f6);">
      <summary style="padding:8px 12px;cursor:pointer;font-size:13px;">
        <b>Gasket defaults</b> — <span class="mono">${escHtml(sys)}</span>
        <span style="color:var(--af-fg-3,#888);font-size:12px;">
          · ${GASKET_PANEL_TYPES.filter(t => g.panel[t].length).map(t => `${PANEL_TYPE_LABEL[t]} ${escHtml(gasketSpecText(g.panel[t]))}`).join(' · ') || 'nothing set — panels bill no gasket'}
          ${custom ? ' · <b>edited</b>' : ''}
        </span>
      </summary>
      <div style="padding:2px 12px 12px;font-size:12px;display:grid;gap:6px;">
        <p style="margin:2px 0 6px;color:var(--af-fg-3,#888);">
          What a panel of each type takes, for every elevation on this system. Type any part number —
          a system the tool has never seen is configured here, not in the code. Per-panel edits made in
          a 🧵 Gasket diagram override these and are left alone.
        </p>
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:150px;flex:none;color:var(--af-fg-3,#888);">System</span>
          <select id="gd-system" class="tk-cell-select">${list.map(s => `<option value="${escAttr(s)}" ${s === sys ? 'selected' : ''}>${escHtml(s)}</option>`).join('')}</select>
        </label>
        ${row('glass', 'Glass panel', 'E2-0127×1, E2-0120×1')}
        ${row('panel', 'IMP-1 panel', 'E2-0127×1, E2-0120×1')}
        ${row('louver', 'Louver', '(usually none)')}
        ${row('door', 'Door panel', '(none — a door bills its two jambs below)')}
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:150px;flex:none;color:var(--af-fg-3,#888);">Storefront perimeter</span>
          <input class="tk-cell-input mono" data-gd="perimeterPart" value="${escAttr(g.perimeterPart || '')}" placeholder="(no perimeter run)" style="width:160px;" />
          <span style="color:var(--af-fg-3,#888);">×1 around each independent zone</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:150px;flex:none;color:var(--af-fg-3,#888);">Door jambs</span>
          <input class="tk-cell-input mono" data-gd="doorPart" value="${escAttr(g.doorPart || '')}" placeholder="(no door run)" style="width:160px;" />
          <span style="color:var(--af-fg-3,#888);">×2, full height — no header, no threshold</span>
        </label>
        <label style="display:flex;align-items:center;gap:8px;">
          <span style="width:150px;flex:none;color:var(--af-fg-3,#888);">Coil per box (LF)</span>
          <input class="tk-cell-input mono" id="gd-boxlf" value="${escAttr(gasketBoxLFText())}" placeholder="E2-0127:250, E2-0120:500" style="flex:1;min-width:0;" />
        </label>
        <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:4px;">
          ${custom ? `<button class="tk-btn tk-btn--ghost tk-btn--sm" id="gd-reset">↺ Reset ${escHtml(sys)} to seed</button>` : ''}
          <span style="color:var(--af-fg-3,#888);align-self:center;">Format: <span class="mono">PART×loops</span>, comma separated. A bare part number means ×1.</span>
        </div>
      </div>
    </details>`;
}
// One handler for the whole block: read every field back, write the spec, re-derive every
// opening's gasket, redraw. Cheap enough to do on each change, and it means the numbers in the
// table below never lag the field you just typed in.
function commitGasketDefaults() {
  const host = document.getElementById('gasket-defaults');
  if (!host) return;
  const sys = gdSystem();
  const spec = { panel: {}, perimeterPart: null, doorPart: null };
  for (const t of GASKET_PANEL_TYPES) {
    const el = host.querySelector(`[data-gd="${t}"]`);
    spec.panel[t] = parseGasketSpecText(el ? el.value : '');
  }
  const pEl = host.querySelector('[data-gd="perimeterPart"]'), dEl = host.querySelector('[data-gd="doorPart"]');
  spec.perimeterPart = pEl ? pEl.value.trim() : '';
  spec.doorPart = dEl ? dEl.value.trim() : '';
  const boxEl = document.getElementById('gd-boxlf');
  if (boxEl) state.gasketBoxLF = parseGasketBoxLFText(boxEl.value);
  setSystemGasket(sys, spec);
  for (const o of (state.openings || [])) if (o.system === sys) recomputeOpeningGaskets(o);
  save(); renderReport();
  if (viewerOpeningId != null) renderViewer(viewerOpeningId);
}
document.addEventListener('change', e => {
  if (!e.target.closest || !e.target.closest('#gasket-defaults')) return;
  if (e.target.id === 'gd-system') { _gdSystem = e.target.value; renderGasketDefaults(); return; }
  commitGasketDefaults();
});
document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (e.target.closest('#gd-reset')) {
    resetGasketDefaultsForCurrentSystem();
  }
});
function resetGasketDefaultsForCurrentSystem() {
  const sys = gdSystem();
  resetSystemGasket(sys);
  for (const o of (state.openings || [])) if (o.system === sys) recomputeOpeningGaskets(o);
  save(); renderGasketDefaults(); renderReport();
  if (viewerOpeningId != null) renderViewer(viewerOpeningId);
}

function renderAccessories() {
  renderGasketDefaults();
  const tbody = document.getElementById('acc-tbody');
  if (!tbody) return;
  let rows = computeAccessories();
  const sysInUse = new Set(scopedOpenings().map(o => o.system).filter(Boolean));
  if (sysInUse.size) rows = rows.filter(r => !r.acc.system || sysInUse.has(r.acc.system));
  if (!rows.length) {
    tbody.innerHTML = `<tr class="is-empty"><td colspan="9">No accessory rules — add one below.</td></tr>`;
    return;
  }
  const sysOpts = ['', ...SYSTEMS_LIST()];
  tbody.innerHTML = rows.map(({ acc: a, qty, basis, warn }) => a._computed ? `
    <tr class="acc-computed" title="Computed from imported elevations — perimeter-based gasket (auto)">
      <td class="col-sys">${escHtml(a.system || '')}</td>
      <td class="col-mark mono">${escHtml(a.partNumber || '')}</td>
      <td>${escHtml(a.description || '')}</td>
      <td class="col-sys">perimeter</td>
      <td>auto (import)</td>
      <td class="col-num-sm">—</td>
      <td class="col-num-sm">—</td>
      <td class="col-num"><span class="acc-qty mono" title="${escAttr(basis)}">${formatNumber(qty)} ${escHtml(a.unit || 'ea')}</span></td>
      <td class="tk-rowdel" title="${escAttr(basis)}">🔒</td>
    </tr>
  ` : `
    <tr data-id="${a.id}">
      <td class="col-sys"><select class="tk-cell-select" data-afield="system">${sysOpts.map(s => `<option value="${escAttr(s)}" ${s === (a.system || '') ? 'selected' : ''}>${s || '(all)'}</option>`).join('')}</select></td>
      <td class="col-mark"><input class="tk-cell-input mono" data-afield="partNumber" value="${escAttr(a.partNumber || '')}" placeholder="P/N" /></td>
      <td><input class="tk-cell-input" data-afield="description" value="${escAttr(a.description || '')}" /></td>
      <td class="col-sys">
        <select class="tk-cell-select" data-afield="rule">
          ${Object.entries(ACC_RULES).map(([k, r]) => `<option value="${k}" ${k === a.rule ? 'selected' : ''}>${r.label}</option>`).join('')}
        </select>
      </td>
      <td><input class="tk-cell-input" data-afield="positions" value="${escAttr((a.positions || []).join(', '))}" placeholder="${escAttr(ACC_POSITIONS_HINT[a.rule] || '(all positions)')}" title="${escAttr(ACC_POSITIONS_HELP[a.rule] || 'Comma-separated role names; empty = every role')}" /></td>
      <td class="col-num-sm"><input class="tk-cell-input num" data-afield="param" type="number" step="0.05" value="${a.param}" title="${(ACC_RULES[a.rule] || {}).paramLabel || 'param'}" /></td>
      <td class="col-num-sm"><input class="tk-cell-input num" data-afield="min" type="number" step="1" value="${a.min || 0}" title="min per piece (spacing rule)" /></td>
      <td class="col-num"><span class="acc-qty mono" title="${escAttr(basis)}">${formatNumber(qty)} ${escHtml(a.unit || 'ea')}</span>${
        warn ? `<div style="font-size:10px;color:#c2410c;font-weight:400;white-space:normal;line-height:1.3;margin-top:2px;">⚠ ${escHtml(warn)}</div>` : ''}</td>
      <td class="tk-rowdel"><button class="tk-rowdel-btn" data-action="del-accessory" title="Delete rule">${ico('trash')}</button></td>
    </tr>
  `).join('');
}

document.addEventListener('input', e => {
  const tr = e.target.closest && e.target.closest('#acc-tbody tr[data-id]');
  if (!tr) return;
  const a = (state.accessories || []).find(x => x.id === tr.dataset.id);
  const f = e.target.dataset.afield;
  if (!a || !f) return;
  if (f === 'positions') a.positions = e.target.value.split(/[,;、]/).map(s => s.trim()).filter(Boolean);
  else if (f === 'param' || f === 'min') a[f] = parseFloat(e.target.value) || 0;
  else a[f] = e.target.value;
  save();
  // 只刷该行的 qty,不打断输入
  const row = computeAccessories().find(r => r.acc.id === a.id);
  const cell = tr.querySelector('.acc-qty');
  if (row && cell) { cell.textContent = `${formatNumber(row.qty)} ${a.unit || 'ea'}`; cell.title = row.basis; }
});

document.addEventListener('change', e => {
  const tr = e.target.closest && e.target.closest('#acc-tbody tr[data-id]');
  if (!tr) return;
  const f = e.target.dataset.afield;
  if (f !== 'rule' && f !== 'system') return;
  const a = (state.accessories || []).find(x => x.id === tr.dataset.id);
  if (a) { a[f] = e.target.value; save(); }
  renderAccessories();   // rule/system 变了要重算并(system)重新过滤
});

document.addEventListener('click', e => {
  if (!e.target.closest) return;
  if (e.target.closest('#acc-add')) {
    const defSys = (state.openings.find(o => o.system) || {}).system || SYSTEMS_LIST()[0] || '';
    state.accessories.push({ id: uid(), system: defSys, partNumber: '', description: '', rule: 'per_piece', positions: [], param: 1, min: 0, unit: 'ea' });
    save(); renderAccessories();
    return;
  }
  const del = e.target.closest('[data-action="del-accessory"]');
  if (del) {
    const tr = del.closest('tr[data-id]');
    state.accessories = (state.accessories || []).filter(x => x.id !== tr.dataset.id);
    save(); renderAccessories();
  }
});

// 报表刷新时联动辅料表
const _renderReportBase = renderReport;
renderReport = function () {
  const r = _renderReportBase.apply(this, arguments);
  try { renderAccessories(); } catch (e) {}
  return r;
};

function openingTotalInches(o) {
  // Per single opening (NOT multiplied by qty here) — just to show row-level info
  const cuts = expandOpeningCuts(o);
  const single = cuts.reduce((acc, c) => acc + c.length, 0);
  return single * (o.qty || 1);
}

// Returns array of {position, length, count} for ONE instance of opening (multiply by qty in aggregation)
function expandOpeningCuts(o) {
  if (Array.isArray(o.cuts) && o.cuts.length) {
    return o.cuts.map(c => ({
      position: cutDisplayPosition(c, o.system),   // 450 边门框 transom 以上段 → Jamb
      length: parseFloat(c.length) || 0,
      count: parseInt(c.count) || 1,
      src: c.src || null,                          // 连续件(continuous)跑长合并要用几何
    })).filter(c => c.position && c.length > 0 && c.count > 0);
  }
  const cuts = [];
  if (o.width  > 0) cuts.push({ position: 'Head', length: o.width, count: 1 });
  if (o.width  > 0) cuts.push({ position: 'Sill', length: o.width, count: 1 });
  if (o.height > 0) cuts.push({ position: 'Jamb', length: o.height, count: 2 });
  if (o.horiz  > 0 && o.width > 0) cuts.push({ position: 'Horizontal', length: o.width, count: o.horiz });
  if (o.vert   > 0 && o.height > 0) cuts.push({ position: 'Vertical', length: o.height, count: o.vert });
  return cuts;
}

// ============================================================
//  AGGREGATION → REPORT
// ============================================================
// 一维下料装箱 — First-Fit-Decreasing (FFD):
//   长段优先,每段塞进第一根还放得下的料(回头利用任意已开料的剩余),全塞不下才开新料.
//   返回 { sticks: 根数, over: [被拼接的超长段...] }。
//   超长段(单件 > 整料)按拼接计入: floor(L/stock) 根整料 + 余段并入 FFD 池(余=0 不入)。
function packFFD(pieces, stock, eps = 1e-6) {
  const over = [];
  const fit = [];
  let fullSticks = 0;            // 超长段整除出的整根, 直接计入
  for (const p of pieces) {
    if (p > stock + eps) {
      over.push(p);
      const nFull = Math.floor((p + eps) / stock);
      fullSticks += nFull;
      const rem = p - nFull * stock;
      if (rem > eps) fit.push(rem);   // 余段入池; 余=0 不入
    } else if (p > 0) {
      fit.push(p);
    }
  }
  fit.sort((a, b) => b - a); // 长 → 短
  const rema = []; // 每根料剩余长度
  for (const p of fit) {
    let placed = false;
    for (let i = 0; i < rema.length; i++) {
      if (rema[i] + eps >= p) { rema[i] -= p; placed = true; break; }
    }
    if (!placed) rema.push(stock - p);
  }
  return { sticks: fullSticks + rema.length, over: over.sort((a, b) => b - a) };
}

// #cutting-diagram (2026-07-20): same FFD algorithm as packFFD() above (identical sort order,
// identical first-fit loop) but keeps the actual piece-to-stick assignment instead of just a
// count, so the on-screen diagram and the DXF export always match the stock numbers already
// shown in the report — never a second, diverging calculation.
// Spliced/oversize pieces (single piece > stock) are handled silently, per Leo's instruction not
// to call them out visually: each full stock consumed by the splice comes back as one stick whose
// only "piece" is the full stock length itself (no internal cut), so it just renders as a plain,
// uncut 24' line — indistinguishable from an ordinary unused stock until you look closely. Its
// leftover remainder is folded back into the normal FFD pool exactly like packFFD does.
// Returns: array of { pieces:[len,...], remaining } — one entry per stick, in the same total
// count packFFD(pieces, stock) would report.
function packFFDLayout(pieces, stock, eps = 1e-6) {
  const sticks = [];
  const fit = [];
  for (const p of pieces) {
    if (p > stock + eps) {
      const nFull = Math.floor((p + eps) / stock);
      for (let i = 0; i < nFull; i++) sticks.push({ pieces: [stock], remaining: 0 });
      const rem = p - nFull * stock;
      if (rem > eps) fit.push(rem);
    } else if (p > 0) {
      fit.push(p);
    }
  }
  fit.sort((a, b) => b - a); // 长 → 短, same order as packFFD
  for (const p of fit) {
    let placed = false;
    for (let i = 0; i < sticks.length; i++) {
      if (sticks[i].remaining + eps >= p) { sticks[i].remaining -= p; sticks[i].pieces.push(p); placed = true; break; }
    }
    if (!placed) sticks.push({ pieces: [p], remaining: stock - p });
  }
  return sticks;
}

// #cutting-diagram: pack ONE elevation's own pieces per part (not pooled across the whole
// project — Leo asked for the diagram/export scoped per elevation). Reuses the identical
// matching logic as buildReport() via collectOpeningIntoBuckets, so "what part does this cut
// belong to" never drifts between the order list and the per-elevation diagram.
// Returns: [{ system, partNumber, description, stock, sticks: [{pieces, remaining}] }]
function buildOpeningPacking(o) {
  const buckets = new Map();
  collectOpeningIntoBuckets(o, buckets, null, null);
  return [...buckets.values()]
    .filter(b => b.pieces.length)
    .map(b => {
      const stock = b.stockInches || STOCK_INCHES;
      return {
        system: b.system,
        partNumber: b.partNumber,
        description: b.description,
        stock,
        sticks: packFFDLayout(b.pieces, stock),
      };
    })
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
}

// #cutting-diagram: shared cut-boundary geometry so the on-screen SVG preview and the DXF
// export always draw identical cuts. A boundary lands only strictly before the stock's far end,
// so a spliced full-length stick (one piece == stock) draws with zero boundary markers — a
// plain uncut line, per the "don't show the splice" treatment above.
function stickTickPositions(stick, stock, eps = 1e-6) {
  const ticks = [];
  let cum = 0;
  for (const len of stick.pieces) {
    cum += len;
    if (cum < stock - eps) ticks.push(cum);
  }
  return ticks;
}

// #cutting-diagram (2026-07-20 rev2, Leo: revert the 2.5" open-box markers back to a bordered
// bar for the whole stick + plain tick lines at each cut boundary (pic2 reference), keep the
// part-name/stick-number labels, add the elevation mark as a header on the diagram. Bar height
// unchanged from the box-marker revision (STOCK_BAR_HEIGHT, was CUT_RECT_HEIGHT). Tick x-positions
// are stickTickPositions() directly — no more per-tick rectangle.
// #cutting-diagram (2026-07-20 rev3, Leo: "最后一段不要闭合...显示最后一段上哪里用到了,还有会剩
// 多长" — don't close the last segment; show where it's used to and how much is left): a stick
// with real leftover (remaining > 0) no longer draws a closing right-side border — the bar is
// only closed left/top/bottom, left open on the right, because that far end isn't a real cut, it's
// undetermined offcut. The existing tick at the used/remaining boundary (stickTickPositions
// already includes it) still marks exactly where real material stops. A text label states the
// leftover length. A stick with zero leftover (exact/spliced fill) is still drawn fully closed.
const STOCK_BAR_HEIGHT = 8;    // inches, the outlined stick bar straddles the baseline (±4)
const REMAINDER_EPS = 1e-6;

// #cutting-diagram: render one part's stack of sticks as plain SVG lines (no fill, no per-piece
// label) — one bar per stick (full stock length, closed left/top/bottom, right edge open unless
// fully used) with a tick line at each cut boundary, part name label to the left of each pile
// (group), stick number to the left of each row, leftover length labeled past the open end, and
// the elevation mark as a header above the whole diagram.
// #cutting-dxf-frame: draw a part's cross-section as plain SVG paths in the CALLER's coordinate
// system (y down), fitted into boxW × boxH. Shares window.PART_SECTION_GEO with the DXF export, so
// the on-screen preview and the exported sheet are the same drawing at a different scale.
function partSectionSvgPaths(partNumber, x0, yTop, boxW, boxH) {
  const geo = (window.PART_SECTION_GEO || {})[partNumber];
  if (!geo || !geo.paths || !geo.paths.length) return null;
  const sc = Math.min(boxW / (geo.w || 1), boxH / (geo.h || 1));
  const d = geo.paths.map(p => p.map((q, i) => (i ? 'L' : 'M') + (x0 + q[0] * sc).toFixed(2) + ' ' + (yTop + (geo.h - q[1]) * sc).toFixed(2)).join('')).join('');
  return { body: `<path d="${d}" fill="none" stroke="currentColor" stroke-width="0.6" stroke-linejoin="round" opacity="0.75"><title>${escHtml(partNumber)} section</title></path>`,
    width: geo.w * sc, height: geo.h * sc };
}
function renderCuttingSvg(groups, mark, gaskets) {
  const stockMax = Math.max(...groups.map(g => g.stock), STOCK_INCHES);
  const rowH = 18, halfH = STOCK_BAR_HEIGHT / 2, padT = 10;
  const xStickNum = 26, xPartLabel = 2, xLineStart = 96; // left-side label columns, then the line
  const headH = mark ? 22 : 0;
  let y = padT + headH;
  let body = '';
  if (mark) body += `<text x="${xPartLabel}" y="${(padT + 8).toFixed(2)}" font-size="13" font-weight="600" fill="currentColor">${escHtml(mark)}</text>`;
  for (const g of groups) {
    const yFirst = y;
    let stickIdx = 0;
    for (const s of g.sticks) {
      stickIdx++;
      const ticks = stickTickPositions(s, g.stock);
      const remaining = s.remaining || 0;
      const hasWaste = remaining > REMAINDER_EPS;
      const barTop = y - halfH, barBot = y + halfH;
      const xEnd = (xLineStart + g.stock).toFixed(2);
      body += `<text x="${xStickNum}" y="${(y + 3.5).toFixed(2)}" font-size="7" fill="currentColor" text-anchor="end">${stickIdx}</text>`;
      body += `<line x1="${xLineStart}" y1="${barTop.toFixed(2)}" x2="${xLineStart}" y2="${barBot.toFixed(2)}" stroke="currentColor" stroke-width="1.1"/>`;
      body += `<line x1="${xLineStart}" y1="${barTop.toFixed(2)}" x2="${xEnd}" y2="${barTop.toFixed(2)}" stroke="currentColor" stroke-width="1.1"/>`;
      body += `<line x1="${xLineStart}" y1="${barBot.toFixed(2)}" x2="${xEnd}" y2="${barBot.toFixed(2)}" stroke="currentColor" stroke-width="1.1"/>`;
      if (!hasWaste) body += `<line x1="${xEnd}" y1="${barTop.toFixed(2)}" x2="${xEnd}" y2="${barBot.toFixed(2)}" stroke="currentColor" stroke-width="1.1"/>`;
      body += ticks.map(t => {
        const x = (xLineStart + t).toFixed(2);
        return `<line x1="${x}" y1="${barTop.toFixed(2)}" x2="${x}" y2="${barBot.toFixed(2)}" stroke="currentColor" stroke-width="1"/>`;
      }).join('');
      if (hasWaste) body += `<text x="${(xLineStart + g.stock + 4).toFixed(2)}" y="${(y + 3.5).toFixed(2)}" font-size="7" fill="currentColor">${formatNumber(remaining)}" left</text>`;
      y += rowH;
    }
    // #cutting-dxf-frame: part number at the top of its pile with the extrusion cross-section
    // directly under it — same arrangement as the DXF export, so the screen matches the sheet.
    body += `<text x="${xPartLabel}" y="${(yFirst - 6).toFixed(2)}" font-size="8" fill="currentColor">${escHtml(g.partNumber)}</text>`;
    const sec = partSectionSvgPaths(g.partNumber, xPartLabel, yFirst + 2, xLineStart - xPartLabel - 8, 46);
    if (sec) {
      body += sec.body;
      const need = 8 + sec.height;
      const have = y - yFirst;
      if (need > have) y += (need - have);
    }
    y += rowH * 0.6; // group gap between parts
  }
  // #gasket-in-cutting: gasket is coil stock — no sticks, no nesting, just the total run.
  if (gaskets && gaskets.length) {
    y += 6;
    body += `<text x="${xPartLabel}" y="${(y + 3.5).toFixed(2)}" font-size="8" font-weight="600" fill="currentColor">GASKET — total length (coil, no nesting)</text>`;
    y += 13;
    for (const g of gaskets) {
      body += `<text x="${xPartLabel}" y="${(y + 3.5).toFixed(2)}" font-size="8" fill="currentColor">${escHtml(g.part)}</text>`;
      body += `<text x="${(xLineStart).toFixed(2)}" y="${(y + 3.5).toFixed(2)}" font-size="8" fill="currentColor">${formatNumber(g.inches)}"  (${formatNumber(g.lf)} LF)</text>`;
      y += 12;
    }
  }
  const totalH = y + padT;
  return `<svg viewBox="0 0 ${(xLineStart + stockMax + 60).toFixed(2)} ${totalH.toFixed(2)}" style="width:100%;max-height:520px;display:block;color:#333;" preserveAspectRatio="xMinYMin meet">${body}</svg>`;
}

// #cutting-diagram: minimal ASCII DXF (R12-compatible, LINE + TEXT entities, inches). One layer
// per part number so AutoCAD's layer panel groups the sticks; part-name/stick-number TEXT sits
// to the left of each pile/row (same layout as the SVG preview above).
function sanitizeDxfLayer(name) {
  const s = String(name || 'PART').replace(/[^A-Za-z0-9_\-.]/g, '_');
  return s || 'PART';
}
function dxfLine(x1, y1, x2, y2, layer) {
  return `0\nLINE\n8\n${layer}\n10\n${x1.toFixed(4)}\n20\n${y1.toFixed(4)}\n30\n0\n11\n${x2.toFixed(4)}\n21\n${y2.toFixed(4)}\n31\n0\n`;
}
function dxfRect(x1, y1, x2, y2, layer) {
  return dxfLine(x1, y1, x2, y1, layer) + dxfLine(x2, y1, x2, y2, layer) + dxfLine(x2, y2, x1, y2, layer) + dxfLine(x1, y2, x1, y1, layer);
}
function dxfText(x, y, height, value, layer) {
  return `0\nTEXT\n8\n${layer}\n10\n${x.toFixed(4)}\n20\n${y.toFixed(4)}\n30\n0\n40\n${height}\n1\n${String(value).replace(/[\r\n]/g, ' ')}\n`;
}
// #cutting-dxf-frame (2026-08-20, Leo: "每个 cutting diagram 上放上对应的 frame diagram …
// 放在料表上方，然后每个 part 名称下面也要放上对应的 diagram"): the elevation's own framing
// drawing, at true 1:1 inches, placed above that elevation's cut list. `cuts[].src` is the parsed
// DXF geometry of every member, so this is literally the same picture as the viewer's framing
// view — just re-emitted as DXF lines. Infill panels are outlined too (thin, on their own layer)
// so the shop can see which bay each stick belongs to. Returns null when the opening has no
// parsed geometry (a hand-entered opening), in which case the cut list just starts at the top.
const FRAME_GROUP_GAP = 24;        // inches between two elevations of the same cut group (#cut-groups)
const FRAME_DIAGRAM_MAX_W = 420;   // inches — wider elevations are scaled down to keep columns sane
function buildFrameDiagramBody(o, x0, yTop) {
  if (!o) return null;
  const bb = openingFrameBox(o);
  if (!bb) return null;
  const w = bb.maxX - bb.minX, h = bb.maxY - bb.minY;
  if (!(w > 0 && h > 0)) return null;
  const sc = w > FRAME_DIAGRAM_MAX_W ? FRAME_DIAGRAM_MAX_W / w : 1;
  const PX = v => x0 + (v - bb.minX) * sc;
  const PY = v => yTop - (bb.maxY - v) * sc;   // yTop is the TOP of the drawing; DXF y grows up
  let body = '';
  for (const p of (o.panels || o.panelCells || [])) {
    const t0 = p.t0 || 'glass';
    body += dxfRect(PX(p.x1), PY(p.y1), PX(p.x2), PY(p.y2), 'FRAME-' + sanitizeDxfLayer(PANEL_TYPE_LABEL[t0] || t0));
  }
  for (const c of (o.cuts || [])) {
    if (!c.src) continue;
    const s = c.src;
    body += dxfRect(PX(s.x), PY(s.y), PX(s.x + s.w), PY(s.y + s.h), 'FRAME');
  }
  if (sc !== 1) body += dxfText(x0, yTop - h * sc - 7, 4, `(frame shown at 1:${(1 / sc).toFixed(1)})`, 'FRAME');
  return { body, width: w * sc, height: h * sc + (sc !== 1 ? 9 : 0) };
}
// #cutting-dxf-frame: the extrusion cross-section for one part number, from part-sections.js
// (extracted from "new block.dxf"). Drawn under the part's name in the left-hand label gutter,
// scaled up to a readable size next to a 24′ bar — the profiles are only a couple of inches
// across, so at 1:1 they'd be invisible. Returns null for a part we have no section for; the
// export then just shows the part number, and the missing profile is reported to the user.
const PART_SECTION_BOX = 34;   // inches — the box a section is fitted into in the label gutter
const MISSING_PART_SECTIONS = new Set();
// A profile like BE9-3904 is 300+ polylines; emitting it inline at every pile blew a
// single-elevation export up to ~270KB and would have run to megabytes across 40 elevations. So
// each profile is written ONCE as a DXF BLOCK and dropped in with an INSERT (uniform scale) at
// each pile — R12-native, a fraction of the size, and in CAD it becomes one editable block per
// part rather than a thousand loose lines.
let _sectionBlocks = new Map();   // partNumber -> block name, for the run currently being built
function dxfSectionBlockName(partNumber) { return 'SEC_' + sanitizeDxfLayer(partNumber); }
function buildPartSectionBody(partNumber, x0, yTop, box) {
  const geo = (window.PART_SECTION_GEO || {})[partNumber];
  if (!geo || !geo.paths || !geo.paths.length) { if (partNumber) MISSING_PART_SECTIONS.add(partNumber); return null; }
  const size = box || PART_SECTION_BOX;
  const sc = Math.min(size / (geo.w || 1), size / (geo.h || 1));
  const name = dxfSectionBlockName(partNumber);
  _sectionBlocks.set(partNumber, name);
  const h = geo.h * sc;
  // INSERT at the section's bottom-left; block geometry is 1:1 inches with its own origin there.
  const body = `0\nINSERT\n8\n${'SECTION-' + sanitizeDxfLayer(partNumber)}\n2\n${name}\n` +
    `10\n${x0.toFixed(4)}\n20\n${(yTop - h).toFixed(4)}\n30\n0\n` +
    `41\n${sc.toFixed(6)}\n42\n${sc.toFixed(6)}\n43\n${sc.toFixed(6)}\n`;
  return { body, width: geo.w * sc, height: h };
}
// The BLOCKS section for every profile referenced during this build. Called after the entity body
// is assembled, because that is when _sectionBlocks is complete.
function buildSectionBlocksSection() {
  if (!_sectionBlocks.size) return '';
  let out = '0\nSECTION\n2\nBLOCKS\n';
  for (const [partNumber, name] of _sectionBlocks) {
    const geo = (window.PART_SECTION_GEO || {})[partNumber];
    if (!geo) continue;
    const layer = 'SECTION-' + sanitizeDxfLayer(partNumber);
    out += `0\nBLOCK\n8\n0\n2\n${name}\n70\n0\n10\n0\n20\n0\n30\n0\n3\n${name}\n`;
    for (const path of geo.paths) {
      if (path.length < 2) continue;
      // POLYLINE/VERTEX rather than one LINE per segment: R12-native and roughly half the bytes.
      out += `0\nPOLYLINE\n8\n${layer}\n66\n1\n10\n0\n20\n0\n30\n0\n70\n0\n`;
      for (const q of path) out += `0\nVERTEX\n8\n${layer}\n10\n${q[0].toFixed(4)}\n20\n${q[1].toFixed(4)}\n30\n0\n`;
      out += '0\nSEQEND\n';
    }
    out += '0\nENDBLK\n';
  }
  return out + '0\nENDSEC\n';
}
// #cutting-diagram: shared entity-body builder so a single-elevation DXF and the combined
// all-elevations DXF (buildCombinedCuttingDxf) draw identical geometry — bordered bar per stick
// (full stock length) + tick line per cut boundary, part/stick labels, elevation mark as a header.
// #cutting-dxf-landscape (2026-08-20, Leo: "导出 cutting dxf (combined, one file) 需要横向的"):
// takes an xOffset as well as a yOffset and reports the column's WIDTH, so the combined export can
// lay elevations out left-to-right instead of stacking them into one very tall strip. `opening`
// (optional) supplies the frame diagram drawn above the cut list.
function buildCuttingDxfBody(groups, mark, yOffset, xOffset, opening, gasketsOverride) {
  const x0 = xOffset || 0;
  const rowGap = 8, groupGap = 12, halfH = STOCK_BAR_HEIGHT / 2;
  const gutter = 100;                    // left-hand label column: part number + its section
  const xBar = x0 + gutter;              // stick bars start here
  const xStickNum = xBar - 14, xPartLabel = x0 + 2, textH = 5;
  let y = yOffset;
  let body = '';
  let maxRight = xBar;
  if (mark) {
    body += dxfText(xPartLabel, y + textH * 1.6, textH * 1.4, mark, 'ELEVATION');
    y -= textH * 2.6;
  }
  // #cut-groups: `opening` may be an ARRAY (a cut group) -- draw every member's frame diagram
  // left to right, each captioned with its own mark, above the one shared cut list.
  let fx = xBar, fh = 0;
  const _frames = Array.isArray(opening) ? opening : [opening];
  for (const op of _frames) {
    const frame = buildFrameDiagramBody(op, fx, y);
    if (!frame) continue;
    body += frame.body;
    if (_frames.length > 1 && op && op.mark) body += dxfText(fx, y + textH * 0.5, textH, op.mark, 'ELEVATION');
    fx += frame.width + FRAME_GROUP_GAP;
    fh = Math.max(fh, frame.height);
    maxRight = Math.max(maxRight, fx);
  }
  if (fh) y -= fh + 24;                  // clear the frame(s) before the first pile
  for (const g of groups) {
    const layer = sanitizeDxfLayer(g.partNumber);
    const yFirst = y;
    let stickIdx = 0;
    for (const s of g.sticks) {
      stickIdx++;
      const remaining = s.remaining || 0;
      const hasWaste = remaining > REMAINDER_EPS;
      const barTop = y - halfH, barBot = y + halfH;
      body += dxfText(xStickNum, y - textH / 3, textH, stickIdx, layer);
      body += dxfLine(xBar, barTop, xBar, barBot, layer);                    // left edge
      body += dxfLine(xBar, barTop, xBar + g.stock, barTop, layer);          // top
      body += dxfLine(xBar, barBot, xBar + g.stock, barBot, layer);          // bottom
      if (!hasWaste) body += dxfLine(xBar + g.stock, barTop, xBar + g.stock, barBot, layer); // right edge only if fully used
      for (const t of stickTickPositions(s, g.stock)) body += dxfLine(xBar + t, barTop, xBar + t, barBot, layer);
      if (hasWaste) body += dxfText(xBar + g.stock + 3, y - textH / 3, textH, formatNumber(remaining) + '" left', layer);
      maxRight = Math.max(maxRight, xBar + g.stock + (hasWaste ? 60 : 4));
      y -= rowGap;
    }
    // part name at the top of its pile, its cross-section immediately underneath (Leo's ask)
    body += dxfText(xPartLabel, yFirst + textH * 0.9, textH, g.partNumber, layer);   // above the first bar, clear of the stick number
    const sec = buildPartSectionBody(g.partNumber, xPartLabel, yFirst - textH * 1.8, Math.min(PART_SECTION_BOX, gutter - 8));
    if (sec) body += sec.body;
    const pileH = yFirst - (y + rowGap);
    const labelH = textH * 1.8 + (sec ? sec.height : 0);
    if (labelH > pileH) y -= (labelH - pileH);   // a tall section must not collide with the next pile
    y -= groupGap;
  }
  // #gasket-in-cutting (2026-08-20, Leo): the gasket diagram's totals, appended to the cut list
  // as plain text. Deliberately NOT packed onto stock bars — gasket comes on a coil, so a nesting
  // layout would be meaningless; the shop only needs the running length per part number.
  const gaskets = gasketsOverride || (Array.isArray(opening) ? groupGasketTotals(opening) : openingGasketTotals(opening));
  if (gaskets && gaskets.length) {
    y -= 6;
    body += dxfText(xPartLabel, y, textH * 1.1, 'GASKET - total length (coil, no nesting)', 'GASKET');
    y -= textH * 2;
    for (const g of gaskets) {
      body += dxfText(xPartLabel, y, textH, g.part, 'GASKET');
      body += dxfText(xBar, y, textH, formatNumber(g.inches) + '" (' + formatNumber(g.lf) + ' LF)', 'GASKET');
      y -= textH * 1.7;
    }
    maxRight = Math.max(maxRight, xBar + 160);
  }
  return { body, endY: y, x0, width: maxRight - x0, height: yOffset - y };
}
function buildCuttingDxf(groups, mark, opening, gasketsOverride) {
  _sectionBlocks = new Map();
  const { body } = buildCuttingDxfBody(groups, mark, 0, 0, opening, gasketsOverride);
  const header = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n'; // 1 = inches
  const entities = '0\nSECTION\n2\nENTITIES\n' + body + '0\nENDSEC\n';
  return header + buildSectionBlocksSection() + entities + '0\nEOF\n';
}
// #cutting-dxf-landscape (2026-08-20, Leo: "需要横向的"): elevations run LEFT TO RIGHT, each its
// own column (mark header → frame diagram → cut list), so the sheet comes out wide rather than as
// one endless vertical strip. Columns wrap onto a new row once the sheet gets wider than it is
// tall, which keeps the whole thing close to a landscape rectangle however many elevations there
// are — 4 elevations sit in one row, 30 wrap into a readable block instead of a 200-ft-wide line.
const CUTTING_COL_GAP = 60;    // inches between columns
const CUTTING_ROW_GAP = 90;    // inches between wrapped rows
function buildCombinedCuttingDxf(list) {
  // first pass: measure every column so the wrap width can be chosen from real sizes
  const measured = list.map(({ mark, groups, opening, gaskets }) => {
    const m = buildCuttingDxfBody(groups, mark, 0, 0, opening, gaskets);
    return { mark, groups, opening, gaskets, w: m.width, h: m.height };
  });
  // Choose how many columns go in a row so the finished sheet lands near 1.6:1 landscape.
  // Rows are as tall as their tallest column, so height ≈ rows × tallest and width ≈ perRow ×
  // column width — solving those for the target ratio gives perRow directly, which is steadier
  // than wrapping against a guessed width (that under-filled the last row and left the sheet
  // taller than wide for small elevation counts).
  const tallest = Math.max(...measured.map(m => m.h), 1);
  const avgW = measured.reduce((a, m) => a + m.w + CUTTING_COL_GAP, 0) / measured.length;
  const perRow = Math.max(1, Math.min(measured.length, Math.ceil(Math.sqrt(measured.length * (tallest + CUTTING_ROW_GAP) * 1.6 / avgW))));
  _sectionBlocks = new Map();   // reset AFTER measuring, so the blocks map reflects the real pass
  let body = '', x = 0, rowTop = 0, rowH = 0, col = 0;
  for (const m of measured) {
    if (col === perRow) { rowTop -= rowH + CUTTING_ROW_GAP; x = 0; rowH = 0; col = 0; }
    body += buildCuttingDxfBody(m.groups, m.mark, rowTop, x, m.opening, m.gaskets).body;
    x += m.w + CUTTING_COL_GAP;
    rowH = Math.max(rowH, m.h);
    col++;
  }
  const header = '0\nSECTION\n2\nHEADER\n9\n$INSUNITS\n70\n1\n0\nENDSEC\n';
  const entities = '0\nSECTION\n2\nENTITIES\n' + body + '0\nENDSEC\n';
  return header + buildSectionBlocksSection() + entities + '0\nEOF\n';
}
// #cutting-dxf-frame: parts whose cross-section isn't in part-sections.js are named in the export
// but drawn as text only. Say so once per export rather than letting a silently missing profile
// look like a bug — "没有的话问我要" (Leo).
function reportMissingPartSections() {
  if (!MISSING_PART_SECTIONS.size) return;
  const list = [...MISSING_PART_SECTIONS].sort().join(', ');
  console.warn('[cutting-dxf] no cross-section drawing for: ' + list);
  const st = document.getElementById('export-status');
  if (st) { st.textContent = 'Exported — no section drawing yet for: ' + list; st.className = 'tk-dxf__status'; }
}
function downloadCuttingDxf(o) {
  const groups = buildOpeningPacking(o);
  if (!groups.length) { alert('No parts with stock cuts for ' + (o.mark || 'this elevation') + '.'); return; }
  MISSING_PART_SECTIONS.clear();
  const dxf = buildCuttingDxf(groups, o.mark, o);
  reportMissingPartSections();
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = (o.mark || 'elevation') + '-cutting.dxf';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
function downloadAllCuttingDxf() {
  const opens = scopedOpenings().filter(o => buildOpeningPacking(o).length);
  if (!opens.length) { alert('No openings with stock cuts to export.'); return; }
  let i = 0;
  const next = () => { if (i >= opens.length) return; downloadCuttingDxf(opens[i]); i++; setTimeout(next, 350); };
  next();
}
// #cutting-diagram (2026-07-20 rev2): single combined DXF, all elevations stacked in one file —
// separate button/action from downloadAllCuttingDxf (which still downloads one file per elevation).
function downloadCombinedCuttingDxf() {
  const list = scopedOpenings()
    .map(o => ({ mark: o.mark, groups: buildOpeningPacking(o), opening: o }))
    .filter(x => x.groups.length);
  if (!list.length) { alert('No openings with stock cuts to export.'); return; }
  MISSING_PART_SECTIONS.clear();
  const dxf = buildCombinedCuttingDxf(list);
  reportMissingPartSections();
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `all-elevations-cutting-combined${scopeSuffix()}.dxf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
// #cutting-diagram (2026-07-21, Leo: "当前所有 openings 的 parts 加起来,不分 elevation,一个 dxf"):
// POOLED packing — every opening's pieces for a given part number go into ONE bucket (not per
// elevation), then FFD-packed together, so the diagram is the project-wide optimized cut list (the
// same pooling buildReport() uses for the order-list stock counts). One plain diagram, no per-mark
// sections and no source-mark labels (Leo's choice) — the shop just cuts each part to length.
// Distinct from downloadCombinedCuttingDxf (which packs each elevation separately, then stacks the
// per-elevation sections into one file).
function buildPooledPacking() {
  const buckets = new Map();
  for (const o of scopedOpenings()) collectOpeningIntoBuckets(o, buckets, null, null);
  return [...buckets.values()]
    .filter(b => b.pieces.length)
    .map(b => {
      const stock = b.stockInches || STOCK_INCHES;
      return { system: b.system, partNumber: b.partNumber, description: b.description, stock, sticks: packFFDLayout(b.pieces, stock) };
    })
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
}
function downloadPooledCuttingDxf() {
  const groups = buildPooledPacking();
  if (!groups.length) { alert('No openings with stock cuts to export.'); return; }
  MISSING_PART_SECTIONS.clear();
  // pooled = no single elevation, so no frame diagram; gasket totals are the project-wide sum
  const dxf = buildCuttingDxf(groups, `ALL OPENINGS (pooled)${isScopeAll() ? '' : ' — ' + scopeLabel()}`, null, allOpeningsGasketTotals());   // pooled = no single elevation, so no frame diagram
  reportMissingPartSections();
  const blob = new Blob([dxf], { type: 'application/dxf' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = `all-openings-pooled-cutting${scopeSuffix()}.dxf`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}

// #cut-groups (2026-08-21, Leo: "cutting diagrams per two elevations starting with the same
// number, eg 04.1&04.2 / 05.1&05.2"): a packing scope BETWEEN per-elevation and project-wide
// pooled. Sibling marks (SF04.1 / SF04.2) are fabricated as one batch, so their pieces share the
// same 24' sticks -- an offcut left on .1 gets used on .2. Group key = the mark with a trailing
// separator+number stripped (SF04.1 -> SF04); a mark with no such suffix is its own group of one.
// Per rule 4.9 that auto key is only a default guess: state.markGroups[mark] overrides it, so
// typing the same key on two marks merges them and a different key splits them (UI: "Cut groups").
function autoMarkGroupKey(mark) {
  const m = String(mark || '').trim();
  return m.replace(/[.\-_]\s*\d+[A-Za-z]?$/, '') || m;
}
function markGroupKey(mark) {
  const m = String(mark || '').trim();
  if (!m) return '';
  const ov = (state.markGroups || {})[m];
  return (ov && String(ov).trim()) || autoMarkGroupKey(m);
}
function setMarkGroup(mark, key) {
  state.markGroups = state.markGroups || {};
  const k = String(key || '').trim();
  if (!k || k === autoMarkGroupKey(mark)) delete state.markGroups[mark];
  else state.markGroups[mark] = k;
  save();
}
function clearMarkGroups() { delete state.markGroups; save(); }
// [{ key, label, openings:[o,...] }] -- every opening lands in exactly one group, marks sorted
// naturally inside it, groups sorted naturally by key.
function groupOpeningsByMark(list) {
  const map = new Map();
  // #export-scope (2026-08-26): the exports pass the scoped set; the config UI passes nothing and
  // sees every mark, because you group marks once and then export whichever system you need.
  for (const o of (list || state.openings || [])) {
    const key = markGroupKey(o.mark) || String(o.mark || '');
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(o);
  }
  return [...map.entries()].map(([key, openings]) => {
    openings.sort((a, b) => String(a.mark).localeCompare(String(b.mark), undefined, { numeric: true }));
    return { key, openings,
      label: openings.length > 1 ? key + ' (' + openings.map(o => o.mark).join(' + ') + ')' : String((openings[0] || {}).mark || key) };
  }).sort((a, b) => a.key.localeCompare(b.key, undefined, { numeric: true }));
}
// Same shape as buildOpeningPacking/buildPooledPacking, scoped to one group -- identical
// collectOpeningIntoBuckets + packFFDLayout path, so group stock counts can never drift from the
// order list. Group total sits between the per-elevation sum and the fully pooled count.
function buildGroupPacking(list) {
  const buckets = new Map();
  for (const o of (list || [])) collectOpeningIntoBuckets(o, buckets, null, null);
  return [...buckets.values()]
    .filter(b => b.pieces.length)
    .map(b => {
      const stock = b.stockInches || STOCK_INCHES;
      return { system: b.system, partNumber: b.partNumber, description: b.description, stock, sticks: packFFDLayout(b.pieces, stock) };
    })
    .sort((a, b) => a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true }));
}
function groupGasketTotals(list) {
  const m = new Map();
  for (const o of (list || [])) for (const g of openingGasketTotals(o)) m.set(g.part, (m.get(g.part) || 0) + g.lf);
  return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0]))
    .map(([part, lf]) => ({ part, lf: +lf.toFixed(2), inches: +(lf * 12).toFixed(1) }));
}
// One landscape DXF, one COLUMN per cut group: the group's elevations drawn side by side, then a
// single shared cut list underneath. Reuses buildCombinedCuttingDxf's wrap/measure layout.
function downloadGroupedCuttingDxf() {
  const list = groupOpeningsByMark(scopedOpenings())
    .map(g => ({ mark: g.label, groups: buildGroupPacking(g.openings), opening: g.openings, gaskets: groupGasketTotals(g.openings) }))
    .filter(x => x.groups.length);
  if (!list.length) { alert('No openings with stock cuts to export.'); return; }
  MISSING_PART_SECTIONS.clear();
  const dxf = buildCombinedCuttingDxf(list);
  reportMissingPartSections();
  download(`cutting-by-elevation-group${scopeSuffix()}.dxf`, dxf, 'application/dxf');
  const st = document.getElementById('export-status');
  if (st && !MISSING_PART_SECTIONS.size) {
    st.textContent = 'Exported ' + list.length + ' cut group(s): ' + list.map(x => x.mark).join(', ');
    st.className = 'tk-dxf__status is-ok';
  }
}
// Rule 4.9 override UI: one row per mark, its group key editable. Same key = cut together.
function renderCutGroupsModal() {
  const body = document.getElementById('cg-body');
  if (!body) return;
  const opens = state.openings || [];
  if (!opens.length) { body.innerHTML = '<p style="font-size:12px;color:#888;">No openings yet.</p>'; return; }
  const counts = new Map();
  for (const o of opens) { const k = markGroupKey(o.mark); counts.set(k, (counts.get(k) || 0) + 1); }
  body.innerHTML = opens.map(o => {
    const auto = autoMarkGroupKey(o.mark), cur = markGroupKey(o.mark);
    return '<label style="display:flex;align-items:center;gap:8px;font-size:12px;">'
      + '<span style="width:96px;font-weight:600;">' + escHtml(o.mark) + '</span>'
      + '<input class="cg-key" data-mark="' + escAttr(o.mark) + '" type="text" value="' + escAttr(cur) + '" style="flex:1;padding:5px;border:1px solid #ccc;border-radius:3px;" />'
      + '<span style="width:120px;color:#888;">' + (cur === auto ? 'auto' : 'auto: ' + escHtml(auto)) + ' &middot; ' + counts.get(cur) + ' mark(s)</span>'
      + '</label>';
  }).join('');
}
function initCutGroupsModal() {
  const btn = document.getElementById('cut-groups-config');
  const modal = document.getElementById('cut-groups-modal');
  if (!btn || !modal) return;
  const close = () => { modal.style.display = 'none'; };
  btn.addEventListener('click', () => { renderCutGroupsModal(); modal.style.display = 'flex'; });
  modal.addEventListener('click', e => { if (e.target === modal) close(); });
  const cancel = document.getElementById('cg-cancel');
  if (cancel) cancel.addEventListener('click', close);
  const reset = document.getElementById('cg-reset');
  if (reset) reset.addEventListener('click', () => { clearMarkGroups(); renderCutGroupsModal(); });
  const save2 = document.getElementById('cg-save');
  if (save2) save2.addEventListener('click', () => {
    for (const inp of modal.querySelectorAll('input.cg-key')) setMarkGroup(inp.getAttribute('data-mark'), inp.value);
    close();
    const st = document.getElementById('export-status');
    if (st) { st.textContent = 'Cut groups: ' + groupOpeningsByMark().map(g => g.label).join('  |  '); st.className = 'tk-dxf__status is-ok'; }
  });
}

// #cutting-diagram: factored out of buildReport() so a single opening can be
// packed on its own (per-elevation diagram/DXF export) using the exact same matching rules
// as the project-wide order list — never a second, diverging implementation.
function collectOpeningIntoBuckets(o, buckets, posTotals, unresolved) {
  const cuts = expandOpeningCuts(o);
  // 连续件跑长(如 750XT 的 C Face Cover 连续覆盖 sill,不被竖梃打断——subsill 同逻辑):
  // 同 position 同一行的相邻段合并(缝隙≤8" 即竖梃宽),跑长 = 合并后的整段跨度。
  const contRuns = pos => {
    const segs = cuts.filter(c => c.position === pos && c.src && c.src.w >= c.src.h)
      .map(c => ({ row: Math.round(c.src.y * 10) / 10, x1: c.src.x, x2: c.src.x + c.src.w }))
      .sort((a, b) => a.row - b.row || a.x1 - b.x1);
    const runs = []; let cur = null;
    for (const s of segs) {
      if (cur && s.row === cur.row && s.x1 - cur.x2 <= 8) { cur.x2 = Math.max(cur.x2, s.x2); }
      else { if (cur) runs.push(cur.x2 - cur.x1); cur = { row: s.row, x1: s.x1, x2: s.x2 }; }
    }
    if (cur) runs.push(cur.x2 - cur.x1);
    return runs;
  };
  for (const c of cuts) {
    // Every part assigned to this position needs the same cut length.
    const allMatches = state.parts.filter(p =>
      p.system === o.system &&
      Array.isArray(p.roles) &&
      p.roles.includes(c.position)
    );
    // 连续件不按单段计——除非该 cut 没有几何(手工行),才退回逐段
    const matches = allMatches.filter(p => !p.continuous || !c.src);
    const nPieces = c.count * (o.qty || 1);
    const totalLen = c.length * nPieces;
    if (!allMatches.length) {
      if (unresolved) unresolved.push({ mark: o.mark, system: o.system, position: c.position, totalInches: totalLen });
      continue;
    }
    if (posTotals) {
      const pt = posTotals[o.system] || (posTotals[o.system] = {});
      pt[c.position] = (pt[c.position] || 0) + totalLen;
    }
    for (const match of matches) {
      const key = match.system + '|' + match.partNumber;
      if (!buckets.has(key)) {
        buckets.set(key, {
          system: match.system,
          partNumber: match.partNumber,
          description: match.description,
          rolesUsed: new Set(),
          totalInches: 0,
          pieces: [],   // 单件长度清单,给摆料用
          stockInches: match.stockInches || STOCK_INCHES,
        });
      }
      const b = buckets.get(key);
      const q = (match.roleQty && +match.roleQty[c.position] > 0) ? +match.roleQty[c.position] : 1;   // #4: per-role part quantity
      b.totalInches += totalLen * q;
      for (let i = 0; i < nPieces * q; i++) b.pieces.push(c.length);
      b.rolesUsed.add(c.position);
    }
  }
  // 连续件(continuous: true, 如 C Face Cover): 每个角色按跑长出料
  for (const match of state.parts.filter(p => p.system === o.system && p.continuous && Array.isArray(p.roles))) {
    for (const role of match.roles) {
      const runs = contRuns(role);
      if (!runs.length) continue;
      const key = match.system + '|' + match.partNumber;
      if (!buckets.has(key)) {
        buckets.set(key, {
          system: match.system, partNumber: match.partNumber, description: match.description,
          rolesUsed: new Set(), totalInches: 0, pieces: [],
          stockInches: match.stockInches || STOCK_INCHES,
        });
      }
      const b = buckets.get(key);
      const q = (match.roleQty && +match.roleQty[role] > 0) ? +match.roleQty[role] : 1;   // #4: per-role part quantity
      const n = (o.qty || 1) * q;
      for (const rl of runs) { b.totalInches += rl * n; for (let i = 0; i < n; i++) b.pieces.push(rl); }
      b.rolesUsed.add(role + ' (run)');
    }
  }
}

function buildReport() {
  // Bucket: key = system + '|' + partNumber → { system, partNumber, description, roles:Set, totalInches }
  const buckets = new Map();
  const unresolved = []; // {opening, position, length}
  const posTotals = {};  // { system: { position: 总下料长(in) } } —— 角色层用

  for (const o of scopedOpenings()) collectOpeningIntoBuckets(o, buckets, posTotals, unresolved);

  const rows = [...buckets.values()].map(b => {
    const stock = b.stockInches || STOCK_INCHES;
    const { sticks, over } = packFFD(b.pieces, stock);     // 余量前: 真实摆料
    const stocksWaste = sticks > 0 ? Math.ceil(sticks * wasteFactor()) : 0; // 余量后: ceil(A × waste factor)
    return {
      ...b,
      rolesUsed: [...b.rolesUsed],
      stocks: sticks,
      stocksWaste,
      oversize: over,
    };
  });

  // Sort: IR501T first, then 450, then by partNumber
  rows.sort((a, b) => {
    const sa = SYSTEMS.indexOf(a.system);
    const sb = SYSTEMS.indexOf(b.system);
    if (sa !== sb) return sa - sb;
    return a.partNumber.localeCompare(b.partNumber, undefined, { numeric: true });
  });

  // Unresolved aggregation by sys+pos
  const unMap = new Map();
  for (const u of unresolved) {
    const k = u.system + '|' + u.position;
    if (!unMap.has(k)) unMap.set(k, { system: u.system, position: u.position, totalInches: 0, count: 0 });
    const r = unMap.get(k);
    r.totalInches += u.totalInches;
    r.count += 1;
  }

  return { rows, unresolved: [...unMap.values()], posTotals };
}

// 报表角色行展开状态(key = system|position)。默认折叠(先看角色总长)。
const reportExpanded = new Set();
document.addEventListener('click', e => {
  // "+ Add Role": 新建自定义角色 → 进 POSITIONS(角色表 + viewer 位置下拉即时可用)
  if (e.target.closest && e.target.closest('#role-add')) {
    const name = (prompt('New role name\n(after creating it, in the Elevation Viewer click a piece → Position dropdown to reassign it to this role;\nthen attach a part to it in the By-Role table)') || '').trim();
    if (name) {
      if (POSITIONS_LIST().includes(name)) { alert('Role already exists: ' + name); }
      else {
        if (!Array.isArray(state.customRoles)) state.customRoles = [];
        state.customRoles.push(name);
        save(); renderReport();
        if (viewerOpeningId != null) renderViewer(viewerOpeningId);
      }
    }
    return;
  }
  // 角色下"移出 part"(改该 part 的 roles)
  const rm = e.target.closest && e.target.closest('[data-rmrole]');
  if (rm) {
    const sp = rm.getAttribute('data-rmrole').split('|');
    const pos = sp.pop(), pid = sp.join('|');
    const p = state.parts.find(x => x.id === pid);
    if (p) { p.roles = (p.roles || []).filter(r => r !== pos); save(); renderReport(); renderMeta(); renderParts(); }
    return;
  }
  // T2: rename role (✎) — must be checked before the row-toggle below
  const ren = e.target.closest && e.target.closest('[data-renamerole]');
  if (ren) {
    const sp = ren.getAttribute('data-renamerole').split('|');
    const oldPos = sp.pop(), sys = sp.join('|');
    const next = (prompt('Rename role\n' + oldPos + '  →', oldPos) || '').trim();
    if (!next || next === oldPos) return;
    if (POSITIONS_LIST().includes(next) &&
        !confirm('Role "' + next + '" already exists — renaming will MERGE "' + oldPos + '" into it. Continue?')) return;
    renameRole(sys, oldPos, next);
    return;
  }
  // 角色行折叠/展开
  const g = e.target.closest && e.target.closest('#report-body .role-group');
  if (!g) return;
  const k = g.dataset.rolegroup;
  if (reportExpanded.has(k)) reportExpanded.delete(k); else reportExpanded.add(k);
  renderReport();
});
// 角色下"加入 part"(下拉)
document.addEventListener('change', e => {
  if (e.target && e.target.id === 'waste-pct') { state.wastePct = Math.max(0, parseFloat(e.target.value) || 0); save(); renderReport(); renderMeta(); return; }   // #1
  const rq = e.target.closest && e.target.closest('[data-roleqty]');   // #4: per-role part qty
  if (rq) {
    const sp = rq.getAttribute('data-roleqty').split('|'); const pos = sp.pop(), pid = sp.join('|');
    const p = state.parts.find(x => x.id === pid);
    if (p) { p.roleQty = p.roleQty || {}; const v = Math.max(1, parseInt(rq.value) || 1); if (v === 1) delete p.roleQty[pos]; else p.roleQty[pos] = v; save(); renderReport(); renderMeta(); renderParts(); }
    return;
  }
  const sel = e.target.closest && e.target.closest('[data-addrole]');
  if (!sel || !sel.value) return;
  const sp = sel.getAttribute('data-addrole').split('|');
  const pos = sp.pop();
  const p = state.parts.find(x => x.id === sel.value);
  if (p && !(p.roles || []).includes(pos)) { p.roles = [...(p.roles || []), pos]; save(); renderReport(); renderMeta(); renderParts(); }
});
// T2: rename a role — updates parts.roles + cuts.position (this system), the customRoles entry,
// and carries the old color forward via state.roleColors (checked first in cutColor).
// If newPos already exists it MERGES (dedupe). Parts changes push to cloud; cuts/openings are local.
function renameRole(sys, oldPos, newPos) {
  if (!newPos || newPos === oldPos) return;
  const oldColor = cutColor(oldPos, sys);
  for (const p of state.parts) {
    if (p.system !== sys || !Array.isArray(p.roles)) continue;
    if (p.roles.includes(oldPos)) p.roles = [...new Set(p.roles.map(r => r === oldPos ? newPos : r))];
  }
  for (const o of state.openings) {
    if (o.system !== sys) continue;
    for (const c of (o.cuts || [])) if (c.position === oldPos) c.position = newPos;
  }
  if (Array.isArray(state.customRoles)) {
    const i = state.customRoles.indexOf(oldPos);
    if (i >= 0) state.customRoles.splice(i, 1, newPos);
    state.customRoles = [...new Set(state.customRoles)];
  }
  if (!POSITIONS_LIST().includes(newPos)) (state.customRoles = state.customRoles || []).push(newPos);
  const mapHas = String(sys) === '750XT' ? COLOR_750XT[newPos] : is1600(sys) ? COLOR_1600[newPos] : POSITION_COLORS[newPos];
  if (!mapHas) { state.roleColors = state.roleColors || {}; state.roleColors[newPos] = oldColor; }
  save(); renderParts(); renderReport(); renderMeta();
  if (viewerOpeningId != null) renderViewer(viewerOpeningId);
}
// ============================================================
//  #export-scope (2026-08-24, Leo: "现在导出 excel / cutting diagrams 不分 system，改成导出前问
//  要哪一个 system（可以多选）")
//
//  A modal on every export button would ask the same question four times and hide the answer until
//  after you clicked. Instead the scope is a standing choice, shown as chips above the report: it
//  filters the Consolidated Takeoff ON SCREEN and every export identically, so the numbers you are
//  looking at are the numbers you are about to hand over. Nothing to remember, nothing to confirm.
//  Default and empty selection both mean "every system present" — the scope can never silently
//  export nothing.
// ============================================================
function systemsInUse() {
  const seen = [];
  for (const o of (state.openings || [])) { const s = o.system || ''; if (s && !seen.includes(s)) seen.push(s); }
  const ord = SYSTEMS_LIST();
  return seen.sort((a, b) => (ord.indexOf(a) + 1 || 99) - (ord.indexOf(b) + 1 || 99));
}
function exportScope() {
  const all = systemsInUse();
  const sel = (state.exportScope || []).filter(s => all.includes(s));
  return sel.length ? sel : all;      // empty / stale selection = everything
}
function isScopeAll() { return exportScope().length === systemsInUse().length; }
function scopeLabel() { return isScopeAll() ? 'all systems' : exportScope().join(' + '); }
// The one gate every report and every export reads. `state.openings` stays whole — nothing is
// hidden from the Openings table or the viewer, only from what gets totalled and written out.
function scopedOpenings() {
  const sel = exportScope();
  if (isScopeAll()) return state.openings || [];
  return (state.openings || []).filter(o => sel.includes(o.system || ''));
}
// A filename says what is in the file. "AC3 takeoff.xlsx" for one scope and a different set of
// numbers in the next one is how the wrong file reaches the shop.
function scopeSuffix() { return isScopeAll() ? '' : ' - ' + exportScope().join('+'); }
function renderExportScope() {
  const host = document.getElementById('export-scope');
  if (!host) return;
  const all = systemsInUse(), sel = exportScope();
  if (all.length < 2) { host.innerHTML = ''; return; }   // one system in the job — nothing to choose
  host.innerHTML = `
    <div style="display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 16px;font-size:12px;">
      <span style="color:var(--af-fg-3,#888);">Scope</span>
      <button class="tk-btn tk-btn--sm ${isScopeAll() ? 'tk-btn--accent' : 'tk-btn--ghost'}" data-scope="*">All</button>
      ${all.map(s => `<button class="tk-btn tk-btn--sm ${!isScopeAll() && sel.includes(s) ? 'tk-btn--accent' : 'tk-btn--ghost'}" data-scope="${escAttr(s)}">${escHtml(s)}</button>`).join('')}
      <span style="color:var(--af-fg-3,#888);">${isScopeAll() ? '' : `· ${scopedOpenings().length} of ${(state.openings || []).length} openings · report and every export are limited to ${escHtml(scopeLabel())}`}</span>
    </div>`;
}
document.addEventListener('click', e => {
  if (e.target.closest && e.target.closest('#vc-pin-diag')) {
    const o = state.openings.find(x => x.id === viewerOpeningId);
    const d = pinDiagnostics(o);
    const txt = JSON.stringify(d, null, 1);
    console.log('[pin-diag]', d);
    try { navigator.clipboard.writeText(txt); } catch (_) {}
    const st = document.getElementById('export-status');
    if (st) { st.textContent = 'Pin diagnostics copied to the clipboard — paste them to Claude.'; st.className = 'tk-dxf__status is-ok'; }
    return;
  }
  const b = e.target.closest && e.target.closest('#export-scope [data-scope]');
  if (!b) return;
  const v = b.dataset.scope, all = systemsInUse();
  if (v === '*') state.exportScope = [];
  else {
    let sel = isScopeAll() ? [] : exportScope().slice();
    sel = sel.includes(v) ? sel.filter(x => x !== v) : sel.concat([v]);
    state.exportScope = (!sel.length || sel.length === all.length) ? [] : sel;
  }
  save(); renderReport(); renderMeta(); renderAccessories();
});

function renderReport() {
  const wrap = document.getElementById('report-body');
  renderExportScope();
  const { rows, unresolved, posTotals } = buildReport();

  if (!rows.length && !unresolved.length) {
    wrap.innerHTML = `
      <div class="tk-report-empty">
        ${ico('inbox')}
        <div>Add openings and parts to generate the consolidated takeoff.</div>
      </div>`;
    return;
  }

  let html = `
    <div style="padding:6px 16px; display:flex; align-items:center; justify-content:space-between;">
      <span style="font:600 11px var(--af-font-sans,system-ui); letter-spacing:.12em; text-transform:uppercase; color:var(--af-fg-3,#888);">By Role — total cut length per role (expand to see which parts make it up)</span>
      <button class="tk-btn tk-btn--ghost tk-btn--sm" id="role-add" title="Create a custom role; after creating it, click a piece in the Elevation Viewer → Position dropdown to reassign">+ Add Role</button>
    </div>
    <div class="tk-table-wrap">
      <table class="tk-report-table">
        <thead>
          <tr>
            <th>Role</th>
            <th class="num">Cut Length</th>
            <th class="num"></th>
            <th class="num"></th>
          </tr>
        </thead>
        <tbody>`;

  // 系统顺序(SYSTEMS_LIST), 角色顺序(POSITIONS)
  const sysOrder = SYSTEMS_LIST().filter(s => rows.some(r => r.system === s))
    .concat([...new Set(rows.map(r => r.system))].filter(s => !SYSTEMS_LIST().includes(s)));
  for (const sys of sysOrder) {
    html += `<tr class="sys-break"><td colspan="4">${escHtml(sys)}</td></tr>`;
    const posOfSys = posTotals[sys] || {};
    const positions = POSITIONS.filter(p => (posOfSys[p] || 0) > 0 || rows.some(r => r.system === sys && r.rolesUsed.includes(p)) || (state.customRoles || []).includes(p));
    for (const pos of positions) {
      const assigned = state.parts.filter(p => p.system === sys && (p.roles || []).includes(pos));
      const key = sys + '|' + pos;
      const open = reportExpanded.has(key);
      html += `
        <tr class="role-group" data-rolegroup="${escAttr(key)}" style="cursor:pointer;">
          <td><span style="font-weight:600;">${open ? '▾' : '▸'} ${escHtml(pos)}</span> <span class="roles">· ${assigned.length} parts</span> <button class="tk-rowdel-btn" data-renamerole="${escAttr(sys + '|' + pos)}" title="Rename role" style="margin-left:6px;">✎</button></td>
          <td class="num" style="font-weight:600;">${formatNumber(posOfSys[pos] || 0)}″</td>
          <td class="num"></td><td class="num"></td>
        </tr>`;
      // 组成可改: 列出该角色下的 part(垃圾桶=移出该角色), 末行下拉=把现有 part 加入该角色
      if (open) {
        const _sec = sys === SECTION_LIBRARY_SYSTEM ? (window.ROLE_SECTIONS || {})[pos] : null;   // #5 — 750XT-only library, see showRoleTip
        if (_sec) html += `<tr class="role-part"><td colspan="4" style="padding:6px 26px;"><div style="display:flex;align-items:center;gap:12px;"><div style="min-width:128px;height:82px;display:flex;align-items:center;flex:0 0 auto;">${_sec}</div><span style="color:var(--af-fg-3,#888);font-size:11px;">Section · ${escHtml(pos)}</span></div></td></tr>`;
        for (const p of assigned) {
          html += `
            <tr class="role-part">
              <td style="padding-left:26px;">
                <span class="pn">${escHtml(p.partNumber)}</span>
                <span class="desc">${escHtml(p.description || '—')}</span>
                <label style="margin-left:6px;font-size:11px;color:var(--af-fg-3,#888);">×<input class="tk-cell-input num" data-roleqty="${escAttr(p.id + '|' + pos)}" type="number" min="1" step="1" value="${(p.roleQty && p.roleQty[pos]) || 1}" style="width:44px;" title="Qty of this part per piece in this role (use instead of adding the part twice)" /></label>
                <button class="tk-rowdel-btn" data-rmrole="${escAttr(p.id + '|' + pos)}" title="Remove this part from ${escAttr(pos)}" style="margin-left:6px;">${ico('trash')}</button>
              </td>
              <td class="num"></td><td class="num"></td><td class="num"></td>
            </tr>`;
        }
        const cands = state.parts.filter(p => p.system === sys && !(p.roles || []).includes(pos));
        if (cands.length) {
          html += `
            <tr class="role-part">
              <td style="padding-left:26px;">
                <select class="tk-cell-select" data-addrole="${escAttr(sys + '|' + pos)}" style="max-width:300px;">
                  <option value="">+ Add part…</option>
                  ${cands.map(p => `<option value="${escAttr(p.id)}">${escHtml(p.partNumber)} — ${escHtml(p.description || '')}</option>`).join('')}
                </select>
              </td>
              <td class="num"></td><td class="num"></td><td class="num"></td>
            </tr>`;
        }
      }
    }
  }

  html += `</tbody></table></div>`;

  // 按-part 订料清单: 每个 part 一行, 根数 = 该 part 所有角色叠加(只出现一次)
  html += `
    <div style="padding:14px 16px 6px; display:flex; align-items:center; justify-content:space-between; font:600 11px var(--af-font-sans,system-ui); letter-spacing:.12em; text-transform:uppercase; color:var(--af-fg-3,#888);"><span>By Part — order list (stick count = sum across all roles)</span><label style="text-transform:none; letter-spacing:0; font-weight:400;">Waste&nbsp;<input id="waste-pct" type="number" min="0" step="5" value="${wastePctVal()}" style="width:52px;" title="Waste allowance % added on top of the FFD stock count" />%</label></div>
    <div class="tk-table-wrap">
      <table class="tk-report-table">
        <thead>
          <tr>
            <th>Part #</th>
            <th class="num">Cut Length</th>
            <th class="num">24′ Stocks</th>
            <th class="num">+ ${wastePctVal()}%</th>
          </tr>
        </thead>
        <tbody>`;
  let curSys = null;
  for (const r of rows) {
    if (r.system !== curSys) { curSys = r.system; html += `<tr class="sys-break"><td colspan="4">${escHtml(r.system)}</td></tr>`; }
    html += `
      <tr>
        <td>
          <span class="pn">${escHtml(r.partNumber)}</span>
          <span class="desc">${escHtml(r.description || '—')}</span>
          <span class="roles">${r.rolesUsed.join(' · ')}</span>
        </td>
        <td class="num">${formatNumber(r.totalInches)}″</td>
        <td class="num"><span class="stocks">${r.stocks}</span></td>
        <td class="num">${r.stocksWaste}</td>
      </tr>`;
  }
  html += `</tbody></table></div>`;

  if (unresolved.length) {
    html += `
      <div style="padding: 16px 20px; background:#fff7f3; border-top:1px solid var(--af-line);">
        <div style="font-family:var(--af-font-sans); font-size:11px; font-weight:600; letter-spacing:0.14em; text-transform:uppercase; color:var(--af-danger); margin-bottom:8px;">Unresolved cuts — no part assigned for these roles</div>
        <table class="tk-report-table" style="background:transparent;">
          <thead>
            <tr><th>System</th><th>Position</th><th class="num">Total Inches</th></tr>
          </thead>
          <tbody>
            ${unresolved.map(u => `
              <tr>
                <td><span class="pn">${u.system}</span></td>
                <td>${u.position}</td>
                <td class="num">${formatNumber(u.totalInches)}″</td>
              </tr>`).join('')}
          </tbody>
        </table>
      </div>`;
  }

  wrap.innerHTML = html;
}

function renderMeta() {
  const { rows } = buildReport();
  const totalIn = rows.reduce((a, r) => a + r.totalInches, 0);
  const totalStocks = rows.reduce((a, r) => a + r.stocks, 0);
  const totalStocksWaste = rows.reduce((a, r) => a + r.stocksWaste, 0);
  document.getElementById('meta-inches').innerHTML = `${formatNumber(totalIn)}<span class="unit">in</span>`;
  document.getElementById('meta-waste').innerHTML  = `${totalStocks}<span class="unit">pcs</span>`;
  document.getElementById('meta-stocks').innerHTML = `${totalStocksWaste}<span class="unit">pcs</span>`;
  document.getElementById('meta-openings').textContent = state.openings.length;
  document.getElementById('meta-parts').textContent = state.parts.length;
  const totalQty = state.openings.reduce((a, o) => a + (parseInt(o.qty)||0), 0);
  document.getElementById('meta-totalqty').textContent = totalQty;
}

// ============================================================
//  FORMATTING / ESCAPING
// ============================================================
function formatNumber(n) {
  if (!isFinite(n)) return '—';
  return n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
function escHtml(s) {
  return String(s ?? '').replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
}
function escAttr(s) { return escHtml(s); }

// ============================================================
//  EVENT HANDLERS
// ============================================================
function onPartsChange(e) {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const p = state.parts.find(x => x.id === tr.dataset.id);
  if (!p) return;
  const field = e.target.dataset.field;
  if (!field) return;
  if (field === 'system') p.system = e.target.value;
  else if (field === 'partNumber') p.partNumber = e.target.value.trim();
  else if (field === 'description') p.description = e.target.value;
  renderReport(); renderMeta(); save();
}

function onPartsClick(e) {
  // 系统分组标题: 折叠/展开
  const grp = e.target.closest('.sys-group');
  if (grp) {
    const sys = grp.dataset.sysgroup;
    if (partsExpanded.has(sys)) partsExpanded.delete(sys); else partsExpanded.add(sys);
    renderParts();
    return;
  }
  // "↔ 连续" 开关(连续件: 下料按整跑合并, 见 buildReport 的 contRuns)
  const cont = e.target.closest('[data-cont]');
  if (cont) {
    const tr = cont.closest('tr[data-id]');
    const p = state.parts.find(x => x.id === tr.dataset.id);
    if (p) { p.continuous = !p.continuous; cont.classList.toggle('is-on'); renderReport(); renderMeta(); save(); }
    return;
  }
  // role chip toggle
  const role = e.target.closest('.tk-role');
  if (role) {
    const tr = role.closest('tr[data-id]');
    const p = state.parts.find(x => x.id === tr.dataset.id);
    const r = role.dataset.role;
    if (p.roles.includes(r)) p.roles = p.roles.filter(x => x !== r);
    else p.roles = [...p.roles, r];
    role.classList.toggle('is-on');
    renderReport(); renderMeta(); save();
    return;
  }
  const del = e.target.closest('[data-action="del-part"]');
  if (del) {
    const tr = del.closest('tr[data-id]');
    state.parts = state.parts.filter(x => x.id !== tr.dataset.id);
    renderParts(); renderReport(); renderMeta(); save();
  }
}

function onOpeningsInput(e) {
  const tr = e.target.closest('tr[data-id]');
  if (!tr) return;
  const o = state.openings.find(x => x.id === tr.dataset.id);
  if (!o) return;
  const f = e.target.dataset.field;
  if (!f) return;
  if (f === 'mark') o.mark = e.target.value;
  else if (f === 'system') {
    o.system = e.target.value;
    // 改成 1600 → 按 4 类重新归类(基于已解析几何);改完重画整表
    if (is1600(o.system) && Array.isArray(o.cuts) && o.cuts.length) { reclassify1600(o); renderOpenings(); }
  }
  else if (['qty','width','height','horiz','vert','lites'].includes(f)) o[f] = parseFloat(e.target.value) || 0;

  // Light update — only re-render report + meta + the row's total cell
  renderReport(); renderMeta();
  const totalCell = tr.querySelectorAll('td')[8];
  if (totalCell) totalCell.querySelector('span').textContent = `${formatNumber(openingTotalInches(o))}"`;
  save();
}

function onOpeningsClick(e) {
  const view = e.target.closest('[data-action="view-opening"]');
  if (view) {
    const tr = view.closest('tr[data-id]');
    renderViewer(tr.dataset.id);
    return;
  }
  const del = e.target.closest('[data-action="del-opening"]');
  if (del) {
    const tr = del.closest('tr[data-id]');
    state.openings = state.openings.filter(x => x.id !== tr.dataset.id);
    renderOpenings(); renderReport(); renderMeta(); save();
  }
}

// ---------- Add part ----------
function addPart() {
  const sys = (state.openings.find(o => o.system) || {}).system || SYSTEMS_LIST()[0] || 'IR501T';
  const p = { id: uid(), system: sys, partNumber: '', description: '', roles: [] };
  state.parts.push(p);
  partsExpanded.add(sys);   // 确保新 part 所在系统组展开, 否则被折叠藏起来看不见
  renderParts(); save();
  // focus 新行的 partNumber(按 id 精确取, 防空)
  const inp = document.querySelector(`#parts-tbody tr[data-id="${p.id}"] input[data-field="partNumber"]`);
  if (inp) inp.focus();
}

// ---------- Quick-add opening ----------
function addOpeningFromQuick() {
  const mark = document.getElementById('qa-mark').value.trim() || `SF-${String(state.openings.length+1).padStart(2,'0')}`;
  const system = document.getElementById('qa-system').value;
  const width  = parseFloat(document.getElementById('qa-width').value) || 0;
  const height = parseFloat(document.getElementById('qa-height').value) || 0;
  const qty    = parseInt(document.getElementById('qa-qty').value) || 1;
  if (width <= 0 || height <= 0) { flash('qa-status', 'Width & height required', true); return; }
  state.openings.push({ id: uid(), mark, system, qty, width, height, horiz: 0, vert: 0 });
  // clear form
  document.getElementById('qa-mark').value = '';
  document.getElementById('qa-width').value = '';
  document.getElementById('qa-height').value = '';
  document.getElementById('qa-qty').value = '1';
  renderOpenings(); renderReport(); renderMeta(); save();
  flash('qa-status', `Added ${mark}`, false);
}

function flash(id, msg, isErr) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = msg;
  el.className = 'tk-dxf__status ' + (isErr ? 'is-err' : 'is-ok');
  setTimeout(() => { el.textContent = ''; el.className = 'tk-dxf__status'; }, 2400);
}

// ============================================================
//  DXF / TEXT PASTE PARSER
//  Heuristic parser — accepts rows in flexible formats:
//    SF-01  IR501T   72   96   2
//    SF-02, 450, 60x84, qty 3
//    Mark: SF-03   System: IR501T   72" x 96"   Q: 4
//  Extracts: mark, system, width, height, qty
// ============================================================
function parseDxfText(text, opts) {
  const dxfOpenings = parseRawDxfOpenings(text, opts);
  if (dxfOpenings) return dxfOpenings;

  const forcedSystem = opts && opts.forcedSystem;
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const out = [];
  const errors = [];

  for (const raw of lines) {
    // Skip header-ish lines
    if (/^(mark|tag|opening|system|qty|width|height)\b/i.test(raw) && /\b(mark|tag|opening)\b/i.test(raw) && /\b(width|height|qty|system)\b/i.test(raw)) continue;

    // Detect system (an explicit forcedSystem wins — same #S4 rule as the geometry parser)
    let system = forcedSystem || null;
    if (!system) {
      if (/\bIR\s*501\s*T\b/i.test(raw)) system = 'IR501T';
      else if (/\b450\b/i.test(raw) || /\b451\s*T\b/i.test(raw)) system = '450';
    }

    // Width × height pattern: "72x96" "72 x 96" "72\" x 96\"" "72.5 × 96"
    let width = null, height = null;
    const wh = raw.match(/(\d+(?:\.\d+)?)\s*["”]?\s*[x×X*]\s*(\d+(?:\.\d+)?)\s*["”]?/);
    if (wh) {
      width = parseFloat(wh[1]);
      height = parseFloat(wh[2]);
    }

    // Mark: "SF-01" "F-3" "ENT-2" or first token
    let mark = null;
    const markMatch = raw.match(/\b([A-Z]{1,4}[-\s]?\d{1,3}[A-Z]?)\b/i);
    if (markMatch) mark = markMatch[1].toUpperCase().replace(/\s+/, '-');

    // Qty: "qty 3" "q: 4" "x4" "(3)" or trailing integer
    let qty = 1;
    const qtyM = raw.match(/\b(?:qty|q|count|#)\s*[:=]?\s*(\d+)\b/i)
              || raw.match(/\((\d+)\)\s*$/)
              || raw.match(/\bx\s*(\d+)\b/i);
    if (qtyM) qty = parseInt(qtyM[1]);

    // If width/height not found via WxH, try the alternate pattern:
    // tokens separated by comma/tab/pipe: mark, sys, w, h, qty
    if (!wh) {
      const tokens = raw.split(/[,\t|]/).map(t => t.trim()).filter(Boolean);
      if (tokens.length >= 4) {
        // Try to find two consecutive numeric tokens as w, h
        for (let i = 0; i < tokens.length - 1; i++) {
          const a = parseFloat(tokens[i]); const b = parseFloat(tokens[i+1]);
          if (!isNaN(a) && !isNaN(b) && a > 0 && b > 0 && tokens[i].match(/^\d+(\.\d+)?["”]?$/) && tokens[i+1].match(/^\d+(\.\d+)?["”]?$/)) {
            width = a; height = b;
            break;
          }
        }
        // First non-numeric token is mark if not found
        if (!mark) {
          const first = tokens.find(t => /[A-Za-z]/.test(t) && !/^(ir501t|450|451t)$/i.test(t));
          if (first) mark = first.toUpperCase();
        }
      }
    }

    if (!system || !width || !height) {
      errors.push(raw);
      continue;
    }
    if (!mark) mark = `SF-${String(out.length+1).padStart(2,'0')}`;
    out.push({ id: uid(), mark, system, qty, width, height, horiz: 0, vert: 0 });
  }

  return { openings: out, errors };
}

// ============================================================
//  Elevation export → tracker (云端 Firestore /elevGeo, 每 unit 一个文档)
//  几何解析(parseRawDxfOpenings)时同步生成 tracker 格式的立面数据:
//  { viewBox:"0 0 W 400", name, base:<SVG 框线>, elements:[{id,x,y,w,h,t0}] }
//  t0: glass | louver(百叶带) | door(门块) | panel(IMP board, 即 structural 横板)。
//  柱子(竖向 structural)不属于任何立面, 不导出。openings 存 localStorage 但
//  几何 payload 只留内存(LAST_ELEV_EXPORTS), 刷新后需重新 Import DXF 才能再导。
// ============================================================
let ELEV_EXPORTS = new Map();   // T4: accumulate across imports, keyed by elevGeo doc key (re-parse of same mark overwrites). Session-only (payload not persisted across reload).

function buildElevExport(mark, c, pool, louverBand, doorRegions, structuralPolys, panelStrips, byOthersZones, cuts, system) {
  const bb = c.bbox;
  // 只有"扁条"structural(h≤12,IMP 板带)才出 panel 元素——整面大小的 structural
  // 矩形(scope/backer 框)不是板,导出会盖住整个立面(SF11/12 巨型元素 bug)。
  const boards = structuralPolys.filter(p => p.width >= p.height && p.height <= 12 &&
    p.centerX >= bb.minX - 2 && p.centerX <= bb.maxX + 2 &&
    p.centerY >= bb.minY - 2 && p.centerY <= bb.maxY + 2);
  const s = 400 / bb.height;
  const X = v => +(((v - bb.minX) * s).toFixed(1));
  const Y = v => +(((bb.maxY - v) * s).toFixed(1));
  const W = v => +((v * s).toFixed(1));
  let base = '<g fill="none" stroke="#3fa0ff" stroke-width="0.6">';
  for (const p of c.polys) base += `<rect x="${X(p.minX)}" y="${Y(p.maxY)}" width="${W(p.width)}" height="${W(p.height)}"/>`;
  for (const p of boards) base += `<rect x="${X(p.minX)}" y="${Y(p.maxY)}" width="${W(p.width)}" height="${W(p.height)}"/>`;
  if (louverBand) {
    const lx1 = X(Math.max(louverBand.minX, bb.minX)), lx2 = X(Math.min(louverBand.maxX, bb.maxX));
    for (let ly = louverBand.minY + 2; ly < louverBand.maxY; ly += 4)
      base += `<line x1="${lx1}" y1="${Y(ly)}" x2="${lx2}" y2="${Y(ly)}"/>`;
  }
  base += '</g>';
  // #beam-gap (2026-08-20, Leo: "louver 和下方中间有一根 beam，上下其实是分开的两个 opening…
  // 中间那里是没有 panel 的"): one elevation mark can hold two INDEPENDENT openings stacked with
  // a structural beam between them. The grid happily fills that beam gap with cells, which then
  // took infill gasket — 5 phantom glass panels on SF06 alone. A cell only counts if its centre
  // falls inside a real opening: the main zone (Head-to-Sill, full width) or the louver band.
  // When the elevation has no classified Head/Sill (hand-entered, or a non-750XT system) the
  // main zone falls back to the whole bbox and nothing is dropped — unchanged behaviour.
  const _cuts = cuts || [];
  const headYs = _cuts.filter(cc => cc.position === 'Head' && cc.src).map(cc => cc.src.y + cc.src.h);
  const sillYs = _cuts.filter(cc => cc.position === 'Sill' && cc.src).map(cc => cc.src.y);
  const mainTop = headYs.length ? Math.max(...headYs) : bb.maxY;
  const mainBot = sillYs.length ? Math.min(...sillYs) : bb.minY;
  const ZONE_EPS = 2;
  const inAnyZone = (y1, y2) => {
    const cy = (y1 + y2) / 2;
    if (cy > mainBot - ZONE_EPS && cy < mainTop + ZONE_EPS) return true;
    if (louverBand && cy > louverBand.minY - ZONE_EPS && cy < louverBand.maxY + ZONE_EPS) return true;
    return false;
  };
  const els = []; let n = 0;
  const louverBays = new Set();   // #louver-fix: bays that already got a louver cell from the grid
  // #panel-gasket (2026-08-20): every infill cell the grid produces is recorded in DXF space as a
  // raw panel — louver and door included, so the panel map is a complete picture of the elevation
  // and a mis-detected cell can be re-typed rather than being invisible. `t0` here is the AUTO
  // type; the effective type (and therefore the gasket) is resolved later through resolvePanel(),
  // which layers Leo's per-panel overrides on top. No LF is summed in this function any more.
  const panelCells = [];
  const add = (x1, y1, x2, y2, t0) => {
    if (!inAnyZone(y1, y2)) return;   // #beam-gap: between two stacked openings — no infill here
    panelCells.push({ x1: +x1.toFixed(3), y1: +y1.toFixed(3), x2: +x2.toFixed(3), y2: +y2.toFixed(3), t0 });
    els.push({ id: mark + '-' + (++n), x: X(x1), y: Y(y2), w: W(x2 - x1), h: W(y2 - y1), t0 });
  };
  const H = pool.filter(p => p.width > p.height && p.height >= 1);
  const V = pool.filter(p => p.height > p.width && p.width >= 1);
  const vxs = [...new Set(V.map(v => Math.round(v.centerX)))].sort((a, b) => a - b);
  const inDoor = (x1, x2, y1, y2) => doorRegions.some(d =>
    x1 >= d.minX - 3 && x2 <= d.maxX + 3 && (y1 + y2) / 2 < d.headY);
  for (let i = 0; i + 1 < vxs.length; i++) {
    const xL = vxs[i], xR = vxs[i + 1], cx = (xL + xR) / 2;
    const rows = [...new Set(H.filter(h => h.minX <= cx && h.maxX >= cx).map(h => +h.centerY.toFixed(1)))].sort((a, b) => a - b);
    for (let j = 0; j + 1 < rows.length; j++) {
      const y1 = rows[j], y2 = rows[j + 1];
      if (y2 - y1 < 4) continue;                 // 太薄不是格
      if (inDoor(xL, xR, y1, y2)) continue;      // 门洞交给 door 元素
      const cy = (y1 + y2) / 2;
      const isLv = louverBand && cy >= louverBand.minY - 3 && cy <= louverBand.maxY + 3 &&
                   cx >= louverBand.minX - 10 && cx <= louverBand.maxX + 10;
      // by-others 大块区(hatch)内的格子不出元素;金属板带条内的格子 = panel
      const inZone = (byOthersZones || []).some(z => {
        const ox = Math.min(xR, z.maxX) - Math.max(xL, z.minX), oy = Math.min(y2, z.maxY) - Math.max(y1, z.minY);
        return ox > 0 && oy > 0 && (ox * oy) > 0.6 * (xR - xL) * (y2 - y1);
      });
      if (inZone) continue;
      const inStrip = (panelStrips || []).some(sp => cy >= sp.minY - 2 && cy <= sp.maxY + 2 &&
        Math.min(xR, sp.maxX) - Math.max(xL, sp.minX) > (xR - xL) * 0.5);
      const _t0 = inStrip ? 'panel' : (isLv ? 'louver' : 'glass'); if (_t0 === 'louver') louverBays.add(i); add(xL, y1, xR, y2, _t0);
    }
  }
  // #louver-fix: louver band whose top/bottom sit on the louver's own frame (AF-PANEL, excluded from the pool)
  // never forms a grid cell → emit an explicit louver element per bay across the band (bays already covered above are skipped).
  if (louverBand) { for (let i = 0; i + 1 < vxs.length; i++) { const xL = vxs[i], xR = vxs[i + 1], cx = (xL + xR) / 2; if (cx < louverBand.minX - 10 || cx > louverBand.maxX + 10) continue; if (louverBays.has(i)) continue; if (inDoor(xL, xR, louverBand.minY, louverBand.maxY)) continue; add(xL, louverBand.minY, xR, louverBand.maxY, 'louver'); } }
  for (const d of doorRegions) add(d.minX, bb.minY, d.maxX, d.headY, 'door');
  // #fix (2026-07-18, Leo §八): IMP-1 must be confirmed by HATCH signature ONLY (§二) — `boards`
  // is a pure geometric heuristic (flat structural rectangle, no hatch check) and is NOT a
  // confirmed IMP-1 signal. If a board happens to sit on a confirmed IMP-1 panelStrip, that
  // physical panel's perimeter was already counted once by the grid-cell loop above (`inStrip`)
  // — adding it again here would double-count the same panel. If it does NOT overlap a
  // confirmed panelStrip, there is no hatch confirmation at all, so it must not be assumed to
  // be IMP-1 either. Either way: still emit the visual element (elevation-view reference
  // rectangle, unchanged from before) but never let `boards` contribute to the gasket sum —
  // pushed directly instead of through `add()`, which is what accumulates G.panel/G.glass.
  for (const p of boards) els.push({ id: mark + '-' + (++n), x: X(p.minX), y: Y(p.maxY), w: W(p.maxX - p.minX), h: W(p.maxY - p.minY), t0: 'panel' });
  // #panel-gasket (2026-08-20): infill gasket LF is no longer computed here at all — it is
  // resolved from the panel list + per-panel overrides (recomputeOpeningGaskets), so a manual
  // re-type takes effect without re-importing the DXF. What IS still computed here is the
  // storefront PERIMETER run, which is a property of the opening's geometry, not of any panel.
  // #fix (2026-07-18, Leo §一/§五/§七): storefront perimeter gasket and infill gasket are TWO
  // INDEPENDENT takeoffs — must not be summed into one number (the old code added openingPerim
  // straight into the E2-0120 infill total). Perimeter is also computed PER INDEPENDENT ZONE,
  // not the whole cluster bbox: real DXFs (confirmed against south.dxf SF04.1 — see
  // PROPAGATION-DESIGN.md §12) show a louver band is its own fully-framed sub-opening (own
  // head/sill/jambs, distinct Y-range from the main glass/IMP-1 zone, separated by a structural
  // gap) even though it shares one mark/bbox with the main zone — each such zone needs its own
  // E2-0120 perimeter gasket (Louver gets a perimeter gasket despite having NO infill gasket).
  // Main-zone extent is derived from the actual classified Head/Sill member Y-positions (not the
  // (X)-suffixed louver-zone variants), falling back to the full bbox when no Head/Sill cuts
  // exist (e.g. non-750XT, or a mark with no louver split at all — matches the old behavior).
  const _perim = perimeterRuns(bb, _cuts, louverBand, doorRegions);
  const resolved = panelCells.map(cell => resolvePanel(mark, cell, system));
  const gaskets = {
    byPart: gasketByPartFromPanels(resolved),  // { partNumber: LF } — the infill takeoff, per panel
    perimeter: +(_perim.storefront.inches / 12).toFixed(2),  // storefront perimeter(s), ×1 per independent zone
    door: +(_perim.door.inches / 12).toFixed(2),             // door opening(s) — its own takeoff, no threshold
  };
  // #gasket-viz (2026-07-19, Leo): draw BOTH gasket types directly on the elevation so the
  // takeoff can be visually audited instead of trusted as a black-box number.
  //  - Infill gasket (E2-0127 glass / E2-0120 IMP-1): TWO dashed loops per counted cell —
  //    an inner ring and an outer ring, standing in for "interior + exterior" (×2) — inset from
  //    the cell edges so they read as distinct lines rather than overlapping the framing rects
  //    already drawn above. Teal = glass (E2-0127), orange = IMP-1 (E2-0120 infill).
  //  - Perimeter gasket (E2-0120, ×1 per independent zone): a single bold gold outline around
  //    each zone's own frame (main zone: full width × Head-to-Sill height; louver zone, if any:
  //    its own band extents) — these are the two "independent storefronts" from §12/§13.
  // Inset amounts are visual only (chosen to sit clearly inside a typical cell/frame without
  // overlapping); they do not affect the LF numbers, which are computed from the raw cell/zone
  // rects above, unchanged.
  let gasketViz = '';
  const inset = (x1, y1, x2, y2, d) => ({ x1: x1 + d, y1: y1 + d, x2: x2 - d, y2: y2 - d });
  const rectPath = (r, color, dash) => {
    if (r.x2 - r.x1 <= 0 || r.y2 - r.y1 <= 0) return '';
    return `<rect x="${X(r.x1)}" y="${Y(r.y2)}" width="${W(r.x2 - r.x1)}" height="${W(r.y2 - r.y1)}" fill="none" stroke="${color}" stroke-width="0.5" ${dash ? `stroke-dasharray="${dash}"` : ''}/>`;
  };
  gasketViz += '<g>';
  for (const p of resolved) {
    // one dashed loop per gasket part actually specified on this panel, inset progressively so
    // two parts on the same panel read as two distinct rings rather than one doubled line.
    let d = 0.6;
    for (const g of p.gaskets) {
      if (!g.part || !(g.loops > 0)) continue;
      gasketViz += rectPath(inset(p.x1, p.y1, p.x2, p.y2, d), gasketPartColor(g.part), '2,1');
      d += 1.6;
    }
  }
  // #perimeter-outline: the elevation pushed to the tracker draws the SAME traced path the LF is
  // summed from — gold for the storefront outline (one loop per independent frame zone), pink for
  // the door jamb faces. Previously this drew a plain bbox rectangle, which is precisely the
  // approximation that made the picture disagree with the number.
  const _pline = (segs, color, w) => segs.map(([px1, py1, px2, py2]) =>
    `<line x1="${X(px1)}" y1="${Y(py1)}" x2="${X(px2)}" y2="${Y(py2)}" stroke="${color}" stroke-width="${w}" fill="none"/>`).join('');
  gasketViz += _pline(_perim.storefront.segs, '#eab308', 1.2);
  gasketViz += _pline(_perim.door.segs, '#f472b6', 1.2);
  gasketViz += '</g>';
  base = base.replace('</g>', '</g>' + gasketViz);
  return { key: mark, data: { viewBox: `0 0 ${+(bb.width * s).toFixed(1)} 400`, name: mark, base, elements: els }, gaskets, panelCells };
}

async function exportElevationsToTracker() {
  const st = document.getElementById('export-status');
  const say = (t, err) => { if (st) { st.textContent = t; st.className = 'tk-dxf__status ' + (err ? 'is-err' : 'is-ok'); } };
  if (!ELEV_EXPORTS.size) return say('Import DXF (geometry parse) first, then export elevations', true);
  if (!window.__fb) return say('Cloud not connected — enable Firestore first (see FIRESTORE-SETUP.md)', true);
  try {
    const fb = window.__fb;
    say('Pushing…');
    // #M2-v2: merge ONLY the `.takeoff` subfield (system/cuts/gaskets) — the geometry fields
    // (viewBox/base/elements) are the tracker's own dxf-elevations.js import's responsibility
    // now; a plain merge of a doc containing just `{takeoff:{...}}` leaves sibling top-level
    // fields (viewBox/base/elements) untouched. If a mark has no takeoff data (shouldn't
    // happen — computed alongside every opening) skip it rather than writing an empty doc.
    for (const e of ELEV_EXPORTS.values()) {
      if (!e.takeoff) continue;
      await fb.setDoc(fb.doc(fb.elevDb || fb.db, 'elevGeo', String(e.key)),
        { takeoff: Object.assign({}, e.takeoff, { updatedAt: fb.serverTimestamp() }) }, { merge: true });
    }
    const marks = [...ELEV_EXPORTS.keys()].join(', ');
    if (st) st.title = marks;
    say(`Pushed ${ELEV_EXPORTS.size} elevations: ${marks}`);
  } catch (err) {
    console.error('[elevGeo] push failed:', err);
    say('Push failed: ' + ((err && err.code) || err), true);
  }
}

function parseRawDxfOpenings(text, opts) {
  if (!/\bSECTION\b/i.test(text) || !/\bENTITIES\b/i.test(text)) return null;
  // #S4: a user-confirmed system (opts.forcedSystem) must win over the per-mark guess —
  // otherwise unrecognized mark patterns (e.g. "EL-01") fall through dxfSystemForMark() to
  // SYSTEMS_LIST()[0] and get classified/whitelisted against the WRONG system for the whole
  // parse (only `o.system` got corrected afterward in appendParsedOpenings, too late to affect
  // classification). See memory.md "S4" for the full diagnosis.
  const forcedSystem = opts && opts.forcedSystem;
  const pairs = dxfPairs(text);
  const entities = dxfCollectEntities(pairs, 'ENTITIES');
  const blocks = dxfCollectBlocks(pairs);
  const allEntities = [...entities];
  // AC3 doors are placed as SINGLE DOOR (12 LWPOLYLINE / 11 LINE) or DOUBLE DOOR (22/6)
  // blocks on AF_ALUM PROFILE. Detect them by content signature, tag their exploded polys
  // (__door) so they're kept OUT of storefront frame classification + lite counting, and
  // record each door's x-span + head Y so flanking mullions can be marked Door Jamb.
  const doorRegionsAll = [];
  const louverRegionsAll = []; // `louver ele` blocks (blade LINEs, on AF-PANEL) — subframe is NOT taken into takeoff.
  const blockSig = name => { const b = blocks.get(name) || []; let lw = 0, ln = 0; for (const e of b) { if (/LWPOLYLINE/i.test(e.type)) lw++; else if (e.type === 'LINE') ln++; } return lw + '/' + ln; };
  const doorKindOf = name => { const s = blockSig(name); return s === '12/11' ? 'SINGLE' : (s === '22/6' ? 'DOUBLE' : null); };
  const isLouverBlock = name => { const b = blocks.get(name) || []; let lw = 0, ln = 0; for (const e of b) { if (/LWPOLYLINE/i.test(e.type)) lw++; else if (e.type === 'LINE') ln++; } return (lw === 0 && ln >= 24) || /louver/i.test(name); };
  for (const insert of entities.filter(e => e.type === 'INSERT').map(dxfInsertSummary)) {
    const block = blocks.get(insert.block);
    if (!block) continue;
    const kind = doorKindOf(insert.block);
    const kids = block.map(child => dxfTransformEntity(child, insert));
    for (const child of kids) { if (kind) child.__door = 1; allEntities.push(child); }
    if (kind) {
      const dp = kids.map(dxfPolylineSummary).filter(p => p && p.layer === LAYER_CONFIG.alum && (p.width > 0 || p.height > 0));
      if (dp.length) doorRegionsAll.push({ kind, minX: Math.min(...dp.map(p => p.minX)), maxX: Math.max(...dp.map(p => p.maxX)), headY: Math.max(...dp.map(p => p.maxY)) });
    } else if (isLouverBlock(insert.block)) {
      const lp = kids.map(dxfPolylineSummary).filter(p => p);
      if (lp.length) louverRegionsAll.push({ minX: Math.min(...lp.map(p => p.minX)), maxX: Math.max(...lp.map(p => p.maxX)), minY: Math.min(...lp.map(p => p.minY)), maxY: Math.max(...lp.map(p => p.maxY)) });
    }
  }
  // #exploded-door (2026-08-20, Leo — 2nd.dxf SF15.1/SF15.2 "门都没识别出来"): not every drawing
  // places its doors as blocks. In 2nd.dxf there is not a single INSERT — the doors are exploded
  // geometry — so the block-signature detector above finds nothing, the door never appears as a
  // panel, no door gasket is billed, and (worse) the door leaf's own stiles and glass-stop rails
  // get taken off as storefront Sill/Head members.
  // The threshold settles it: an AF_SADDLE polyline is only ever drawn under a door. For each
  // saddle we take the leaf outline standing on it — the widest rectangle on a leaf-bearing layer
  // whose foot is on the saddle — and that rectangle IS the door: its x-span and its top become
  // the door region, and every poly inside it is tagged __door so it drops out of the framing
  // pool, exactly the way a block door's children do.
  if (!doorRegionsAll.length) {
    const polySumm = allEntities
      .filter(e => /POLYLINE|LWPOLYLINE/i.test(e.type))
      .map(e => ({ e, s: dxfPolylineSummary(e) }))
      .filter(x => x.s && x.s.width > 0 && x.s.height > 0);
    // A leaf outline lives on the door layer, the alum layer, or a fallback layer ('0'/AF_X).
    // Deliberately NOT any layer: AF_BACKER ROD draws a rectangle over the same opening that is
    // slightly LARGER than the leaf, and would otherwise win the "widest" test.
    const leafLayer = lay => lay === LAYER_CONFIG.door || lay === LAYER_CONFIG.alum ||
                             lay === LAYER_CONFIG.doorSubframe || LAYER_CONFIG.fallbacks.includes(lay);
    const doorLeafRects = [];
    for (const sad of polySumm.filter(x => x.s.layer === LAYER_CONFIG.saddle && x.s.width >= 12 && x.s.height <= 3)) {
      const S = sad.s;
      const cands = polySumm.filter(x => x !== sad && leafLayer(x.s.layer) && x.s.height >= 24 &&
        x.s.minX >= S.minX - 3 && x.s.maxX <= S.maxX + 3 && Math.abs(x.s.minY - S.maxY) <= 3);
      if (!cands.length) continue;
      // widest candidate wins; if nothing spans most of the threshold we only found a stile, so
      // fall back to the threshold's own span rather than billing a door 3" wide.
      const widest = cands.slice().sort((a, b) => b.s.width - a.s.width)[0].s;
      const spans = widest.width >= S.width * 0.6;
      const rect = {
        minX: spans ? widest.minX : S.minX,
        maxX: spans ? widest.maxX : S.maxX,
        minY: Math.min(S.minY, ...cands.map(c => c.s.minY)),
        maxY: Math.max(...cands.map(c => c.s.maxY)),
      };
      doorLeafRects.push(rect);
      doorRegionsAll.push({ kind: 'EXPLODED', minX: rect.minX, maxX: rect.maxX, headY: rect.maxY });
    }
    for (const x of polySumm) {
      for (const r of doorLeafRects) {
        if (x.s.minX >= r.minX - 1 && x.s.maxX <= r.maxX + 1 && x.s.minY >= r.minY - 1 && x.s.maxY <= r.maxY + 1) { x.e.__door = 1; break; }
      }
    }
    if (doorLeafRects.length) console.log('[dxf] ' + doorLeafRects.length + ' exploded door(s) found via ' + LAYER_CONFIG.saddle);
  }
  const hasDoorBlocks = doorRegionsAll.length > 0;
  // AC3 hatch 检测: AF_HATCH/AF_GENERAL 的 HATCH 边界 bbox。
  //  · 扁长条(h≤12,w≥20) = 金属板带(IMP): AF_HATCH=普通板, AF_GENERAL=后有钢梁
  //  · 大块 = by-others 开口区(maisonette window 等, 不出玻璃元素)
  const hatchBoxes = [];
  for (const e of allEntities) {
    if (!/^HATCH$/i.test(e.type)) continue;
    const lay = dxfValue(e, 8);
    if (lay !== 'AF_HATCH' && lay !== 'AF_GENERAL') continue;
    const xs = [], ys = [];
    for (let k = 0; k + 1 < e.pairs.length; k++) {
      const c1 = e.pairs[k][0], c2 = e.pairs[k + 1][0];
      if ((c1 === 10 || c1 === 11) && (c2 === 20 || c2 === 21)) {
        const x = parseFloat(e.pairs[k][1]), y = parseFloat(e.pairs[k + 1][1]);
        if (Math.abs(x) > 1 && Math.abs(y) > 1) { xs.push(x); ys.push(y); }
      }
    }
    if (!xs.length) continue;
    hatchBoxes.push({ layer: lay, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
  }
  // #S3 (confirmed by Leo, 2026-07-16/17): IMP-1 metal panel is identified by a HATCH SHADE,
  // not a layer — solid-fill, AutoCAD color index 8 (gray), drawn on layer '0'. Verified
  // against the real south/north/east/west.dxf (26/6/8/2 matching entities respectively;
  // 45TU.dxf has zero HATCH entities at all — IMP-1 is 750XT-only, per Leo). This is a
  // DIFFERENT, unrelated signal from the `hatchBoxes` collection above (AF_HATCH/AF_GENERAL
  // layers) — that was the pre-this-session guess and stays only for `byOthersZones` (large
  // by-others opening blocks), not panel detection. Real per-entity boundary-path parsing
  // (`dxfHatchBoundaryBBox`) is required here — the flat x/y scan used for `hatchBoxes` above
  // produces garbage on real HATCH entities (see that function's header comment).
  const imp1HatchBoxes = [];
  for (const e of allEntities) {
    if (!/^HATCH$/i.test(e.type)) continue;
    if (dxfValue(e, 8) !== '0' || dxfValue(e, 62) !== '8' || dxfValue(e, 70) !== '1') continue;
    const bb = dxfHatchBoundaryBBox(e);
    if (bb) imp1HatchBoxes.push(bb);
  }
  // Collect ALL alum + door subframe polylines (no outline dependency)
  const profiles = allEntities
    .filter(e => /POLYLINE|LWPOLYLINE/i.test(e.type) || e.type === 'LINE')
    .map(e => { const s = dxfPolylineSummary(e); if (s && e.__door) s.__door = 1; return s; })
    .filter(p => p && p.width >= 0 && p.height >= 0);
  // Sill-flashing lines (thin wide horizontals, h<1) are commonly drawn on the
  // outline/scope layers — admit only that shape from those layers.
  const flashingLike = p => p.height < 1 && p.width > 10;
  const alumDoorPolys = profiles.filter(p =>
    p.layer === LAYER_CONFIG.alum ||
    p.layer === LAYER_CONFIG.doorSubframe ||
    LAYER_CONFIG.fallbacks.includes(p.layer) ||
    ((p.layer === LAYER_CONFIG.outline || p.layer === LAYER_CONFIG.scope) && flashingLike(p))
  );
  // Marks (Hillview: WS/WN sit above the cluster; AC3: SF on AF_ANNO, drawn in a row below).
  const labels = allEntities
    .filter(e => /^M?TEXT$/i.test(e.type))
    .map(dxfMtextSummary)
    .filter(t => t && /^(WS|WN|SF)\d+$/i.test(t.text))
    .map((t, i) => ({ ...t, id: i, text: t.text.toUpperCase() }));
  // Same-named marks (e.g. SF04 drawn as two bays) → suffix .1/.2… left-to-right by x.
  const marksByName = {};
  for (const l of labels) (marksByName[l.text] = marksByName[l.text] || []).push(l);
  for (const name in marksByName) {
    const grp = marksByName[name].sort((a, b) => a.x - b.x);
    grp.forEach((l, i) => { l.display = grp.length > 1 ? `${name}.${i + 1}` : name; });
  }
  // Structural separators (AC3-family): building columns (vertical, ≥12" wide) and
  // IMP/board panels (horizontal, ≥6" thick) are NOT profiles — drop them before
  // clustering, so they're neither taken off nor bridge two bays into one elevation
  // (e.g. the 21.5"-wide column between SF04.1 and SF04.2). Door-block polys are
  // exempt (they're wide but belong to the cluster; alumPool already excludes them).
  // #fat-poly (2026-08-20, Leo — SF06 "为什么一块panel分成了上下2块"): the ≥24" length gate
  // above let a SHORT fat rectangle through. In 6.2.dxf the bay left of the door has a
  // 21.01" x 14.61" rectangle on AF_ALUM PROFILE (an infill outline, with AF_GLASS IN LINE
  // marks inside it) — 21" long, so it missed the ≥24" gate, stayed in the framing pool, was
  // taken off as a phantom 21" Horizontal, and its centreline split that bay's panel into two.
  // The identical 39.5" x 14.61" rectangle in the next bay DID clear 24" and was correctly
  // dropped — which is exactly why only one bay split. Depth alone settles it: no extrusion in
  // any of our systems is this deep (the deepest profile in the library is BE9-3910 at 6.75"),
  // so a poly whose SHORT dimension exceeds that is an infill outline, whatever its length.
  const PROFILE_MAX_DEPTH = 8;   // inches — comfortably above BE9-3910 (6.75"), below any infill
  const isStructural = p => !p.__door && (
    (Math.max(p.width, p.height) >= 24 && (p.height > p.width ? p.width >= 12 : p.height >= 6)) ||
    Math.min(p.width, p.height) >= PROFILE_MAX_DEPTH
  );
  const structuralPolys = alumDoorPolys.filter(isStructural);  // 留给立面导出(board=panel 元素)
  const framePolys = alumDoorPolys.filter(p => !isStructural(p));
  // 聚类只认真正的框料层(alum / doorSubframe / 门块)。fallback('0'/AF_X)和 outline
  // 层的件不参与聚类——AC3 图纸 sill 下有 layer-0 的 grade LINE(解析只读起点,成了
  // 0×0 的隐形点),恰好落在两片立面中间,会把它们桥接成一个"整版"。这些件在聚类后
  // 按 x 重叠归给最近的立面,只进分类池(Subsill 等),不参与 bbox。
  const isFrameLayer = p => p.__door ||
    p.layer === LAYER_CONFIG.alum || p.layer === LAYER_CONFIG.doorSubframe;
  const clusterInput = framePolys.filter(isFrameLayer);
  // Cluster polys spatially → each cluster = 1 elevation
  const clusters = clusterPolys(clusterInput, 20);
  for (const p of framePolys) {
    if (isFrameLayer(p)) continue;
    let best = null, bestOv = 0;
    for (const c of clusters) {
      const ov = Math.max(0, Math.min(p.maxX, c.bbox.maxX) - Math.max(p.minX, c.bbox.minX));
      if (ov > bestOv) { bestOv = ov; best = c; }
    }
    if (best && bestOv > 0) best.polys.push(p);
  }
  const openings = [];
  const used = new Set();
  // T4: do NOT reset ELEV_EXPORTS — it accumulates across imports; same mark overwrites via .set below.
  for (const c of clusters) {
    // Match the mark whose x sits within the cluster (WS/WN above, SF below — both x-aligned),
    // nearest-center as tiebreak. Require x-containment so no cluster grabs a neighbor's mark.
    let best = null, bestD = 1e9;
    for (const lbl of labels) {
      if (used.has(lbl.id)) continue;
      if (lbl.x < c.bbox.minX - 3 || lbl.x > c.bbox.maxX + 3) continue;
      const d = Math.hypot(lbl.x - c.centerX, lbl.y - c.centerY);
      if (d < bestD) { bestD = d; best = lbl; }
    }
    if (best) used.add(best.id);
    const mark = best ? best.display : `EL-${String(openings.length+1).padStart(2,'0')}`;
    const system = forcedSystem || dxfSystemForMark(mark);
    // 几何识别(不分图层): 凡"真实框料"(细长矩形, min(w,h)>=1 且 max(w,h)>=10)都进分类池;
    // 薄 flashing(h<1 且宽)走 Subsill。门按几何判("底部无 sill 且跨内有 transom bar = 门")。
    // Louver: the blades sit on AF-PANEL (already outside the pool) — that IS the louver's own
    // subframe, correctly not taken off. The storefront frame AT the louver area IS taken off, as
    // (X)/(Lv) part variants (per 1.png: green Head(X)/Sill(X), orange Jamb(X), pink Vertical(Lv)).
    const louverBands = louverRegionsAll.filter(l => { const cx = (l.minX + l.maxX) / 2; return cx >= c.bbox.minX - 3 && cx <= c.bbox.maxX + 3; });
    const louverBand = louverBands.length ? {
      minX: Math.min(...louverBands.map(l => l.minX)), maxX: Math.max(...louverBands.map(l => l.maxX)),
      minY: Math.min(...louverBands.map(l => l.minY)), maxY: Math.max(...louverBands.map(l => l.maxY)),
    } : null;
    const inLouver = p => {
      if (!louverBand) return false;
      const cx = (p.minX + p.maxX) / 2;
      return cx >= louverBand.minX - 10 && cx <= louverBand.maxX + 10 &&
             p.maxY >= louverBand.minY - 5 && p.minY <= louverBand.maxY + 5;
    };
    // 750XT(AC3) 图纸有 9" 短横料(柱旁补齐段),放宽最短件阈值到 8;其他系统保持 10。
    const minLen = system === '750XT' ? 8 : 10;
    const alumPool = c.polys.filter(p => !p.__door && (
      (Math.min(p.width, p.height) >= 1 && Math.max(p.width, p.height) >= minLen) ||
      (p.height < 1 && p.width > 10)  // flashing → Subsill
    ));
    // Placed door blocks whose center falls in this cluster → drive Door Jamb classification.
    const doorRegions = doorRegionsAll.filter(d => {
      const cx = (d.minX + d.maxX) / 2; return cx >= c.bbox.minX - 3 && cx <= c.bbox.maxX + 3;
    });
    // #S3: this elevation's IMP-1 panel strips — from the confirmed hatch signal, 750XT only
    // (per Leo: 45TU has no IMP-1 at all). Louver-band strips are excluded (keeps the
    // pre-existing louver (X) logic untouched — the two regions don't overlap in practice).
    const panelStrips = system === '750XT' ? imp1HatchBoxes.filter(hb =>
      hb.minX < c.bbox.maxX && hb.maxX > c.bbox.minX && hb.minY > c.bbox.minY - 5 && hb.maxY < c.bbox.maxY + 5 &&
      !(louverBand && hb.maxY > louverBand.minY - 5 && hb.minY < louverBand.maxY + 5)) : [];
    const byOthersZones = hatchBoxes.filter(hb => (hb.maxY - hb.minY) > 12 && (hb.maxX - hb.minX) > 12 &&
      hb.minX < c.bbox.maxX && hb.maxX > c.bbox.minX && hb.minY < c.bbox.maxY && hb.maxY > c.bbox.minY);
    const cuts = dxfDetectCuts(c.bbox, alumPool, [], { useBlockDoors: hasDoorBlocks, doorRegions, system });
    // 750XT(AC3): 位置集严格按 750XT parts.xlsx——没有 Transom Bar / Door Jamb At
    // Transom / Corner 专位。门上横档 = Horizontal (X)(棕,见 2.png);门侧竖梃全高
    // 一根 Door Jamb(红,transom 分段去重合回);宽竖梃(≥3.5")= Vertical (wide),
    // louver 带内由下面 XMAP 转成 Vertical (wide X)。
    if (system === '750XT') {
      const seenSrc = new Set(), keep = [];
      for (const cut of cuts) {
        if (cut.position === 'Transom Bar') cut.position = 'Horizontal (X)';
        else if (cut.position === 'Outside 90° Corner') cut.position = 'Vertical (wide)';
        else if (cut.position === 'Door Jamb' || cut.position === 'Door Jamb At Transom') {
          const k = cut.src ? [cut.src.x, cut.src.y, cut.src.w, cut.src.h].join(',') : String(Math.random());
          if (seenSrc.has(k)) continue;            // 同一根竖梃的 transom 分段 → 全高一根
          seenSrc.add(k);
          cut.position = 'Door Jamb';
          if (cut.src) cut.length = dxfRound(cut.src.h);
        }
        if ((cut.position === 'Vertical' || cut.position === 'Jamb') && cut.src && cut.src.w >= 3.5) cut.position = 'Vertical (wide)';
        keep.push(cut);
      }
      cuts.length = 0; cuts.push(...keep);
    }
    // Louver-area members → (X)/(Lv) variants (still counted; only the part role changes).
    if (louverBand) {
      const XMAP = { 'Head': 'Head (X)', 'Sill': 'Sill (X)', 'Horizontal': 'Horizontal (X)', 'Jamb': 'Jamb (X)', 'Vertical': 'Vertical (X)', 'Vertical (wide)': 'Vertical (wide X)', 'Door Jamb': 'Vertical (X)' };
      for (const cut of cuts) {
        if (!cut.src || !XMAP[cut.position]) continue;
        const cx = cut.src.x + cut.src.w / 2;
        if (cx >= louverBand.minX - 10 && cx <= louverBand.maxX + 10 &&
            (cut.src.y + cut.src.h) >= louverBand.minY - 5 && cut.src.y <= louverBand.maxY + 5) cut.position = XMAP[cut.position];
      }
      // 750XT: louver 带最低一排横料 = Sill (X)。门立面里门框竖梃比窗台低,会把带底
      // 挤出 sill 判定、错标成 Horizontal (X)——按带内最低行统一纠正(门上横档不在带内,不受影响)。
      if (system === '750XT') {
        const bandHX = cuts.filter(k => k.position === 'Horizontal (X)' && k.src &&
          (k.src.y + k.src.h) >= louverBand.minY - 5 && k.src.y <= louverBand.maxY + 5 &&
          (k.src.x + k.src.w / 2) >= louverBand.minX - 10 && (k.src.x + k.src.w / 2) <= louverBand.maxX + 10);
        if (bandHX.length) {
          const lowest = Math.min(...bandHX.map(k => k.src.y));
          for (const k of bandHX) if (k.src.y - lowest < 2) k.position = 'Sill (X)';
        }
      }
    }
    // #S3 (confirmed 2026-07-16/17): IMP-1 panel framing logic — ONLY the verticals that fully
    // span across a panel band get relabeled: the band's own left/right boundary member →
    // `Jamb (IMP-1)`, an interior mullion crossing through the band → `Vertical (IMP-1)` (wide
    // verticals → `Vertical (wide IMP-1)`). The head (member above the panel) and the
    // horizontal below it are explicitly LEFT UNCHANGED — Leo: "do not rename it as an
    // IMP-1-specific member." (This replaces the old Sill(normal)/Head-swap + (X)-suffix
    // band-split, which used the wrong AF_HATCH/AF_GENERAL hatch signal — see memory.md "S3".)
    // Adjacent panel strips with overlapping Y merge into one band (a single physical panel is
    // often several small hatch entities side by side at the same height). Computed even when
    // empty so later steps (Horizontal Glass&Glass) can rely on it.
    const imp1Bands = [];
    for (const s of panelStrips.slice().sort((a, b) => a.minY - b.minY)) {
      const b = imp1Bands.find(bb => s.minY <= bb.maxY + 1 && s.maxY >= bb.minY - 1);
      if (b) { b.minY = Math.min(b.minY, s.minY); b.maxY = Math.max(b.maxY, s.maxY); b.minX = Math.min(b.minX, s.minX); b.maxX = Math.max(b.maxX, s.maxX); }
      else imp1Bands.push({ minX: s.minX, maxX: s.maxX, minY: s.minY, maxY: s.maxY });
    }
    // #fix (2026-07-18, Leo): classification pipeline factored into a function so it can be
    // re-applied to a RESTORED saved snapshot below, not just a fresh parse — previously a
    // saved elevEdits snapshot (from before IMP-1/Glass&Glass/Layer B existed, or just from an
    // earlier manual split) would wholesale overwrite `cuts` AFTER this pipeline ran once,
    // permanently freezing that mark's roles at save-time and masking every later detection/
    // learning improvement on every future re-import. Idempotent: the IMP-1 split step only
    // acts on a WHOLE (unsplit) vertical that fully spans a band, so already-split/relabeled
    // restored pieces pass through unchanged; only stale unsplit pieces get (re)classified.
    classifyRoles(cuts, { system, bbox: c.bbox, imp1Bands, louverBand, doorRegions, mark });
    // #persist (#1): fingerprint of THIS parse (geometry only, role-independent).
    const _freshSig = elevGeoSig(cuts);
    // If a full saved edit-set exists for this mark and the DXF geometry is unchanged,
    // restore it wholesale (splits/merges/role/length edits all survive), THEN re-run the same
    // classification pipeline on the restored cuts so role labels stay live. Otherwise fall
    // back to the lighter remembered role overrides (legacy roleEdits).
    const _saved = state.elevEdits && state.elevEdits[mark];
    let _reclassifiedDrift = null;   // #fix (2026-07-19): surfaced to the viewer — see renderViewer
    if (_saved && geoSigMatches(_saved.geoSig, cuts) && Array.isArray(_saved.cuts) && _saved.cuts.length) {
      // #role-pins-v2: the saved cuts carry ABSOLUTE rects from whenever they were saved. The
      // signature matched on RELATIVE geometry, so if the elevation has since been moved on the
      // sheet those rects are in the old coordinate space — restoring them verbatim would put the
      // whole edit-set out of register with the fresh bbox, the panel cells and the perimeter
      // tracer. Slide them onto this import's origin; an elevation that never moved shifts by 0.
      const _so = cutsOrigin(_saved.cuts), _fo = cutsOrigin(cuts);
      const _dx = _fo.x - _so.x, _dy = _fo.y - _so.y;
      if (Math.abs(_dx) > 0.05 || Math.abs(_dy) > 0.05)
        console.log(`[persist] ${mark}: saved edits re-registered — the elevation moved ${_r1(_dx)}, ${_r1(_dy)} on the sheet`);
      cuts.length = 0;
      for (const sc of _saved.cuts) cuts.push({ position: sc.position, length: sc.length, count: sc.count || 1,
        src: sc.src ? { ...sc.src, x: sc.src.x + _dx, y: sc.src.y + _dy } : null });
      const _beforeReclass = cuts.map(cc => cc.position);
      classifyRoles(cuts, { system, bbox: c.bbox, imp1Bands, louverBand, doorRegions, mark });
      // #fix (2026-07-19, Leo — SF01 data loss): the automatic reclassification above can still
      // change a piece that was never explicitly pinned via the dropdown (e.g. a hand-tuned split
      // whose role happened to match old logic but not the new geometry rule). Rather than let
      // that drift silently through a second save, record it so the viewer can show "N pieces
      // changed from your saved version" — a visible warning instead of a silent overwrite, which
      // is what let SF01 slip through uncaught.
      const drift = [];
      cuts.forEach((cc, i) => { if (_beforeReclass[i] != null && cc.position !== _beforeReclass[i]) drift.push({ src: cc.src, from: _beforeReclass[i], to: cc.position }); });
      if (drift.length) { _reclassifiedDrift = drift; console.warn('[classify] ' + drift.length + ' piece(s) in ' + mark + ' changed from the saved version on reclassify:', drift); }
      _savedRoleReport.delete(mark);
    } else {
      // #saved-roles: the signature did not match — the drawing changed. Carry over every saved
      // role that still has a piece to sit on, then let explicit pins override on top.
      const _sr = applySavedRoles(_saved, cuts, mark);
      if (_sr) console.log(`[persist] ${mark}: geometry changed — carried ${_sr.matched} of ${_sr.total} saved roles across (${_sr.changed} differ from auto)`);
      _savedRoleReport.set(mark, _sr);
      applyRolePins(cuts, mark, system, c.bbox);   // #role-pins-v2 — relative + tolerant, not an exact key
    }
    // Louver area is not glass → exclude it from vision-lite counting.
    const lites = dxfCountLites(alumPool.filter(p => !inLouver(p)));
    openings.push({
      id: uid(), mark, system, qty: 1, lites,
      width: dxfRound(c.bbox.width),
      height: dxfRound(c.bbox.height),
      horiz: cuts.filter(c => c.position === 'Horizontal').reduce((a,c) => a + c.count, 0),
      vert: cuts.filter(c => c.position === 'Vertical').reduce((a,c) => a + c.count, 0),
      cuts, geoSig: _freshSig,
      // Per-opening geometric context (bbox + detected IMP-1/louver/door bands). Local-only
      // (not part of the elevGeo/elevEdits schema pushed to the tracker/Firestore). Layer B
      // used this to recompute a signature on manual edit; that's gone (2026-07-20), but the
      // context is retained here — it's the natural input for the template-matching feature
      // (PROPAGATION-DESIGN.md §16).
      _bands: { bbox: { minX: c.bbox.minX, minY: c.bbox.minY, maxX: c.bbox.maxX, maxY: c.bbox.maxY }, imp1Bands, louverBand, doorRegions },
      // #fix (2026-07-19): non-null when reclassifying a restored saved snapshot changed a piece
      // that wasn't pinned via the dropdown — surfaced as a warning banner in the viewer instead
      // of silently overwriting the saved version. Local-only (not part of the synced schema).
      _reclassifiedDrift,
    });
    const _ex = buildElevExport(mark, c, alumPool, louverBand, doorRegions, structuralPolys, panelStrips, byOthersZones, cuts, system);
    // #M2-v2: geometry (viewBox/base/elements) is now owned by the tracker's own
    // dxf-elevations.js import; this tool's push (exportElevationsToTracker) writes ONLY
    // the `.takeoff` subfield below, so it never clobbers the tracker's geometry.
    _ex.takeoff = { system, cuts: cuts.map(cc => ({ position: cc.position, length: cc.length, count: cc.count || 1 })), gaskets: _ex.gaskets };
    ELEV_EXPORTS.set(_ex.key, _ex);
    // #panel-gasket: the raw panel list is stored ON the opening (so it survives a reload —
    // ELEV_EXPORTS is session-only) and the LF totals are derived from it through the override
    // layer. Done for EVERY system, not just 750XT (Leo: "45TU 为什么没有 gasket diagram") — the
    // panel map is how you check and correct a takeoff, and it is worth just as much on a system
    // the detector reads badly. What each system's panels actually consume is SYSTEM_GASKET's job;
    // a system with no entry there simply gets a diagram with no gasket loops on it.
    {
      const _o = openings[openings.length - 1];
      _o._pv = PARSER_VERSION;
      _o.panelCells = _ex.panelCells || [];
      _o.gasketPerimeterLF = (_ex.gaskets && _ex.gaskets.perimeter) || 0;
      _o.gasketDoorLF = (_ex.gaskets && _ex.gaskets.door) || 0;
      recomputeOpeningGaskets(_o);
    }
  }
  return { openings, errors: [] };
}

// Spatial union-find clustering of polylines by bbox proximity
function clusterPolys(polys, eps) {
  if (!polys.length) return [];
  const n = polys.length;
  const parent = Array.from({length: n}, (_, i) => i);
  function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
  function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
  const GRID = 50;
  const buckets = new Map();
  for (let i = 0; i < n; i++) {
    const p = polys[i];
    for (let bx = Math.floor(p.minX / GRID); bx <= Math.floor(p.maxX / GRID) + 1; bx++) {
      for (let by = Math.floor(p.minY / GRID); by <= Math.floor(p.maxY / GRID) + 1; by++) {
        const key = bx + ',' + by;
        if (!buckets.has(key)) buckets.set(key, []);
        buckets.get(key).push(i);
      }
    }
  }
  function near(a, b) {
    return !(a.maxX + eps < b.minX || b.maxX + eps < a.minX || a.maxY + eps < b.minY || b.maxY + eps < a.minY);
  }
  const checked = new Set();
  for (const [key, list] of buckets) {
    const [bx, by] = key.split(',').map(Number);
    for (const i of list) {
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
        const nbrs = buckets.get((bx+dx) + ',' + (by+dy));
        if (!nbrs) continue;
        for (const j of nbrs) {
          if (i >= j) continue;
          const k = i + ',' + j;
          if (checked.has(k)) continue;
          checked.add(k);
          if (near(polys[i], polys[j])) union(i, j);
        }
      }
    }
  }
  const groups = new Map();
  for (let i = 0; i < n; i++) {
    const r = find(i);
    if (!groups.has(r)) groups.set(r, []);
    groups.get(r).push(polys[i]);
  }
  const clusters = [];
  for (const members of groups.values()) {
    if (members.length < 3) continue;
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const m of members) {
      minX = Math.min(minX, m.minX); minY = Math.min(minY, m.minY);
      maxX = Math.max(maxX, m.maxX); maxY = Math.max(maxY, m.maxY);
    }
    const w = maxX - minX, h = maxY - minY;
    if (w < 5 || h < 5) continue;
    clusters.push({
      bbox: { minX, minY, maxX, maxY, width: w, height: h, centerX: (minX+maxX)/2, centerY: (minY+maxY)/2 },
      polys: members,
      centerX: (minX+maxX)/2,
      centerY: (minY+maxY)/2,
    });
  }
  return clusters;
}


// 数中梃网格的格子数 ≈ 玻璃片数(含 spandrel;门洞会多计 1 格/樘,表里可手改)。
// 竖件 xmid 定 bay 边界,跨过 bay 中心的横件定层数,每 bay 格数 = 层数 − 1。
function dxfCountLites(alumProfiles) {
  const H = alumProfiles.filter(p => p.width > p.height && p.height >= 1);
  const V = alumProfiles.filter(p => p.height > p.width && p.width >= 1);
  if (!V.length || !H.length) return 0;
  const xs = [...new Set(V.map(v => Math.round((v.minX + v.maxX) / 2)))].sort((a, b) => a - b);
  let lites = 0;
  for (let i = 0; i + 1 < xs.length; i++) {
    const cx = (xs[i] + xs[i + 1]) / 2;
    const levels = new Set(H.filter(h => h.minX <= cx && h.maxX >= cx).map(h => Math.round((h.minY + h.maxY) / 2 / 3)));
    lites += Math.max(0, levels.size - 1);
  }
  return lites;
}

function dxfDetectCuts(outline, alumProfiles, doorSubframe, opts) {
  const noDoors = !!(opts && opts.noDoors); // true: 关门检测,subframe 料按普通框料分
  // outline is a synthesized cluster bbox; we DON'T pre-add Head/Sill/Jamb
  // Classify each polyline by its position within the cluster
  const cuts = [];
  const addCut = (position, length, count = 1, src = null, extra = null) => {
    if (length > 0 && count > 0) {
      const cut = { position, length: dxfRound(length), count };
      if (src) cut.src = { x: dxfRound(src.minX), y: dxfRound(src.minY), w: dxfRound(src.width), h: dxfRound(src.height), layer: src.layer };
      if (extra) Object.assign(cut, extra);
      cuts.push(cut);
    }
  };

  // Classify alum profiles (geometric: 横件 w>h, 竖件 h>w, 薄料 h<1)
  const horizontals = alumProfiles.filter(p => p.width > p.height && p.height >= 1);
  const verticals = alumProfiles.filter(p => p.height > p.width && p.width >= 1);
  const thin = alumProfiles.filter(p => p.height < 1 && p.width > 10);

  // 750XT(AC3): by-others 开口(maisonette window 等)的竖梃会伸到 sill 以下,
  // 所以 sill/head/地面基准不能用最值——改用出现次数(众数)。
  const sysIs750 = ((opts && opts.system) || '') === '750XT';
  const byCount = ys => { const m = new Map(); for (const v of ys) m.set(v, (m.get(v) || 0) + 1); return [...m.entries()].sort((a, b) => b[1] - a[1]).map(e => e[0]); };
  const vTopList = verticals.map(v => Math.round(v.maxY * 10) / 10);
  const vBotList = verticals.map(v => Math.round(v.minY * 10) / 10);
  const headYs = sysIs750 ? new Set(byCount(vTopList).slice(0, 2))
                          : new Set([...new Set(vTopList)].sort((a, b) => b - a).slice(0, 2));
  const sillYs = sysIs750 ? new Set(byCount(vBotList).slice(0, 2))
                          : new Set([...new Set(vBotList)].sort((a, b) => a - b).slice(0, 2));
  const floor750 = sysIs750 && vBotList.length ? byCount(vBotList)[0] : null;

  // ---- 门检测 ----
  // AC3: 门由 SINGLE/DOUBLE DOOR 块给出(opts.doorRegions,门扇几何已从 alumProfiles 排除);
  //   用块的 x-span 定位门洞,门洞两侧最近的框料竖梃 = Door Jamb(门头 Y 以上段 = At Transom)。
  // 其它图纸(无门块)回退到旧几何启发式:立面按竖件列切 bay,底部无 sill 的空挡 = 门。
  const useBlockDoors = !!(opts && opts.useBlockDoors);
  const doorRegions = (opts && opts.doorRegions) || [];
  const doorHeads = [];
  if (useBlockDoors) {
    const vmids = verticals.map(v => (v.minX + v.maxX) / 2);
    for (const d of doorRegions) {
      const left = vmids.filter(x => x <= d.minX + 2);
      const right = vmids.filter(x => x >= d.maxX - 2);
      doorHeads.push({
        minX: d.minX, maxX: d.maxX, minY: d.headY, maxY: d.headY, width: d.maxX - d.minX,
        leftJambX: left.length ? Math.max(...left) : null,
        rightJambX: right.length ? Math.min(...right) : null,
      });
    }
  } else if (verticals.length >= 2) {
    // 750XT: 地面 = 多数竖件的底端(众数),否则 by-others 开口的地下延伸会把地面拉低,
    // 导致所有 bay 都"底部无 sill"而被误判成门。
    const floorY = (floor750 != null) ? floor750 : Math.min(...verticals.map(v => v.minY));
    const sillTol = Math.max(6, (outline.height || 0) * 0.06);
    const colMap = new Map();
    for (const v of verticals) {
      const k = Math.round((v.minX + v.maxX) / 2);
      if (!colMap.has(k)) colMap.set(k, []);
      colMap.get(k).push(v);
    }
    const colKeys = [...colMap.keys()].sort((a, b) => a - b);
    // #6 fix (phantom door, verified against 45TU.dxf EL-05): a bay's boundary must be the
    // FACING EDGE of its bounding vertical, not the vertical's center. A wide vertical (e.g.
    // a corner post/mullion) offsets its center from where the adjoining Head/Sill actually
    // terminates; with a center-based boundary that offset can exceed the ±2 span tolerance
    // below, so a real spanning Sill/Head reads as "missing" → the whole bay is misread as a
    // doorless gap (phantom door), and the bounding vertical gets misclassified as Door Jamb.
    const colEdge = (k, side) => {
      const vs = colMap.get(k);
      return side === 'right' ? Math.max(...vs.map(v => v.maxX)) : Math.min(...vs.map(v => v.minX));
    };
    for (let i = 0; i + 1 < colKeys.length; i++) {
      const xL = colEdge(colKeys[i], 'right'), xR = colEdge(colKeys[i + 1], 'left');
      const spans = h => h.minX <= xL + 2 && h.maxX >= xR - 2;
      // bay 底部有横料 → 窗
      if (horizontals.some(h => spans(h) && (h.minY + h.maxY) / 2 <= floorY + sillTol)) continue;
      // 空挡即门: 门头取跨该 bay、底部之上最低的横料; 没有则全高门(头取该 bay 竖件顶)
      const caps = horizontals.filter(h => spans(h) && (h.minY + h.maxY) / 2 > floorY + sillTol);
      const inBayVerts = verticals.filter(v => { const x = (v.minX + v.maxX) / 2; return x >= xL - 2 && x <= xR + 2; });
      if (!inBayVerts.length) continue;
      const headY = caps.length
        ? Math.min(...caps.map(h => (h.minY + h.maxY) / 2))
        : Math.max(...inBayVerts.map(v => v.maxY));
      doorHeads.push({ minX: xL, maxX: xR, minY: headY, maxY: headY, width: xR - xL });
    }
  }
  // Helper: 竖件属于哪个门(门洞两侧的框料竖梃 = door jamb)
  function findDoorFor(v) {
    const x = (v.minX + v.maxX) / 2;
    for (const d of doorHeads) {
      if (useBlockDoors) {
        if ((d.leftJambX != null && Math.abs(x - d.leftJambX) < 0.5) ||
            (d.rightJambX != null && Math.abs(x - d.rightJambX) < 0.5)) return d;
      } else if (Math.abs(x - d.minX) < 3 || Math.abs(x - d.maxX) < 3) return d;
    }
    return null;
  }

  // HEAD/SILL/HORIZONTAL by Y — headYs/sillYs 已在上方(门检测前)按 system 规则算好
  // 跨某个门 bay、且在该门头高度的横料 → Transom Bar(门头)。
  // 750XT: head 行永远不当门头(开口无 transom 时 cap 会落到 head 行,不能吃掉 Head)。
  const isDoorHeadBar = (h) => !(sysIs750 && [...headYs].some(y => Math.abs(h.maxY - y) < 1)) &&
    doorHeads.some(d =>
    Math.abs((h.minY + h.maxY) / 2 - d.minY) < 5 && h.minX >= d.minX - 2 && h.maxX <= d.maxX + 2);
  for (const h of horizontals) {
    // 750XT 无门块: "无 sill 开口"是 by-others 开口,上方横档 = Horizontal (X)(棕)
    if (isDoorHeadBar(h)) { addCut(sysIs750 && !useBlockDoors ? 'Horizontal (X)' : 'Transom Bar', h.width, 1, h); continue; }
    if (sysIs750) {
      // 750XT 局部判定(分区立面,如 SF01): 本跨内竖件在这根横料处"收头"→ Head,
      // "起脚"→ Sill,穿过 → Horizontal。全局最高/最低两档在分区结构下会判错。
      const inSpan = v => { const x = (v.minX + v.maxX) / 2; return x >= h.minX - 3 && x <= h.maxX + 3; };  // ±3: 宽竖梃(4")中心离料端 2"
      const endsIn = yv => yv >= h.minY - 1 && yv <= h.maxY + 1;
      const headish = verticals.some(v => inSpan(v) && endsIn(v.maxY) && !endsIn(v.minY));
      const sillish = verticals.some(v => inSpan(v) && endsIn(v.minY) && !endsIn(v.maxY));
      if (headish && !sillish) { addCut('Head', h.width, 1, h); continue; }
      if (sillish && !headish) { addCut('Sill', h.width, 1, h); continue; }
      addCut('Horizontal', h.width, 1, h); continue;
    }
    if ([...headYs].some(y => Math.abs(h.maxY - y) < 1)) { addCut('Head', h.width, 1, h); continue; }
    if ([...sillYs].some(y => Math.abs(h.minY - y) < 1)) { addCut('Sill', h.width, 1, h); continue; }
    addCut('Horizontal', h.width, 1, h);
  }

  // Vertical classification
  const vXs = [...new Set(verticals.map(v => Math.round((v.minX + v.maxX) / 2 * 10) / 10))].sort((a,b) => a - b);
  const jambXs = vXs.length ? new Set([vXs[0], vXs[vXs.length - 1]]) : new Set();
  // Typical vertical width for corner detection
  const vWidthsSorted = verticals.map(v => v.width).sort((a,b) => a - b);
  const typicalVW = vWidthsSorted.length ? vWidthsSorted[Math.floor(vWidthsSorted.length / 2)] : 2.75;
  for (const v of verticals) {
    const xmid = (v.minX + v.maxX) / 2;
    const xkey = Math.round(xmid * 10) / 10;
    // Block-door mode: verticals INTERIOR to a door span are the door leaf/panel, not
    // storefront framing (the real jambs sit at the door edges) — skip them.
    if (useBlockDoors && doorHeads.some(d => xmid > d.minX + 1 && xmid < d.maxX - 1 &&
        Math.abs(xmid - (d.leftJambX ?? -1e9)) > 0.5 && Math.abs(xmid - (d.rightJambX ?? -1e9)) > 0.5)) continue;
    const isJamb = jambXs.has(xkey);
    const myDoor = findDoorFor(v);
    // 转角料: 宽度≈普通竖通的两倍(看宽度, 不看位置), 且优先于门判定, 不被门吃掉。
    const isCorner = v.width >= 1.7 * typicalVW;
    if (isCorner) {
      addCut('Outside 90° Corner', v.height, 1, v);
    } else if (myDoor) {
      if (sysIs750 && !useBlockDoors) {
        // 750XT 无门块: 这是 by-others 开口(maisonette 等),不是门。
        // 伸到地面以下的开口侧竖梃 = Jamb (X)(pocket 条件,橙);
        // 开口上方(transom 以上)的短竖 = Jamb(红)。整根计,不劈段。
        if (floor750 != null && v.minY < floor750 - 2) addCut('Jamb (X)', v.height, 1, v);
        else addCut('Jamb', v.height, 1, v);
      } else {
        const upper = Math.max(0, v.maxY - myDoor.minY);
        const lower = Math.max(0, myDoor.minY - v.minY);
        // 边门框(同时是 elevation 最边 jamb)的 transom 以上段打标记: 450 出料时按 Jamb 计
        if (upper > 0.5) addCut('Door Jamb At Transom', upper, 1, v, isJamb ? { edgeDoorJamb: true } : null);
        if (lower > 0.5) addCut('Door Jamb', lower, 1, v);
      }
    } else if (isJamb) {
      addCut('Jamb', v.height, 1, v);
    } else {
      addCut('Vertical', v.height, 1, v);
    }
  }
  // Each drawn door head → one Transom Bar piece (synthesized heads have no drawn bar)
  // (Transom Bar 已在上面横料分类里按门头发出, 此处不再重复)
  // Subsills
  for (const s of thin) addCut('Subsill', s.width, 1, s);
  // HEAD synthesis: if no head detected, use outline width
  if (!cuts.some(c => c.position === 'Head') && verticals.length) {
    const jambW = verticals[0].width || 2.75;
    addCut('Head', Math.max(0, outline.width - 2 * jambW));
  }
  return cuts;
}

// 1600 专用归类:基于已解析的 cut.src 几何,只分 4 类,不做门检测。
// 判定原则(用户定义):"某一侧没有相邻横料 = 周边"
//   竖料: 只有一边有横料 → Jamb;两边都有 → Vertical
//   横料: 上方没有横料(本跨最顶) → Head;下方没有 → Sill;上下都有 → Horizontal
// 这样能扛阶梯底/门洞:角部抬高的底料、门头横料都按"本跨上下邻居"正确归类,
// 而不是用全局最高/最低一条线。门洞处被拆成两段的竖料(共用 src)去重合回整根。
function reclassify1600(o) {
  if (!o || !Array.isArray(o.cuts) || !o.cuts.length) return;
  const seen = new Set(), boxes = [];
  for (const c of o.cuts) {
    if (!c.src) continue;
    const s = c.src, key = [s.x, s.y, s.w, s.h].join(',');
    if (seen.has(key)) continue;
    seen.add(key); boxes.push(s);
  }
  if (!boxes.length) return;   // 无溯源几何(手填)→ 不动
  const H = o.height || 1, W = o.width || 1;
  const tx = Math.max(2, W * 0.01), ty = Math.max(2, H * 0.01);
  const mk = (s) => ({ s, x0: s.x, x1: s.x + s.w, y0: s.y, y1: s.y + s.h, xc: s.x + s.w / 2, yc: s.y + s.h / 2 });
  const horiz = boxes.filter(s => s.w >= s.h).map(mk);
  const vert  = boxes.filter(s => s.h > s.w).map(mk);
  const coversX = (h, x) => h.x0 <= x + 0.001 && h.x1 >= x - 0.001;            // 横料是否盖住某 x 点
  const ovX = (a, b) => Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0);          // x 区间重叠量
  const near = (a, b) => ovX(a, b) > Math.min(a.x1 - a.x0, b.x1 - b.x0) * 0.4; // 视为上下相邻
  const cuts = [];
  // 竖料(逐段判):在该段自己的高度范围内,左右两侧都有横料 → Vertical(中梃);
  //   只有一边(或没有)→ Jamb。于是顶部 band 段判 Vertical、下挂段的外侧边判 Jamb,
  //   门洞两侧的 mullion 因门头/门槛在门那侧也有横料 → 仍判 Vertical。
  for (const v of vert) {
    const relH = horiz.filter(h => h.y1 >= v.y0 - ty && h.y0 <= v.y1 + ty);   // y 区间相交的横料
    const left  = relH.some(h => coversX(h, v.xc - tx));
    const right = relH.some(h => coversX(h, v.xc + tx));
    cuts.push({ position: (left && right) ? 'Vertical' : 'Jamb', length: dxfRound(v.s.h), count: 1, src: { ...v.s } });
  }
  // 横料:看上方/下方(x 区间重叠)有没有横料;门头(抬高且下方无料)单列 Transom Bar
  const botRef = horiz.length ? Math.min(...horiz.map(g => g.yc)) : 0;
  for (const h of horiz) {
    const above = horiz.some(g => g !== h && g.yc > h.yc + ty && near(g, h));
    const below = horiz.some(g => g !== h && g.yc < h.yc - ty && near(g, h));
    let pos;
    if (above && below) pos = 'Horizontal';
    else if (!above && !below) pos = (h.yc > H / 2) ? 'Head' : 'Sill';         // 孤立件按上/下半场
    else if (!above) pos = 'Head';                                             // 上无下有 → 本跨最顶 = Head
    else pos = (h.yc <= botRef + H * 0.2) ? 'Sill' : 'Transom Bar';            // 上有下无 → 近底=Sill,抬高=门头(单独算)
    cuts.push({ position: pos, length: dxfRound(h.s.w), count: 1, src: { ...h.s } });
  }
  o.cuts = cuts;
  o.horiz = cuts.filter(c => c.position === 'Horizontal').length;
  o.vert  = cuts.filter(c => c.position === 'Vertical').length;
}

function dxfSystemForMark(mark) {
  const clean = String(mark || '').toUpperCase().replace(/\s+/g, '');
  const exterior = new Set([
    'WN1', 'WN2', 'WN3', 'WN4',
    'WS12', 'WS13', 'WS14', 'WS15', 'WS16', 'WS17', 'WS18', 'WS19',
    'WS20', 'WS21', 'WS22', 'WS23', 'WS24', 'WS25', 'WS26', 'WS27',
    'WS28', 'WS29', 'WS30', 'WS31', 'WS32', 'WS33', 'WS34',
    'WS46', 'WS47',
  ]);
  const interior = new Set([
    'WN5',
    'WS1', 'WS2', 'WS3', 'WS4', 'WS5', 'WS6', 'WS7', 'WS8', 'WS9',
    'WS10', 'WS11',
    'WS35', 'WS36', 'WS37', 'WS38', 'WS39', 'WS40', 'WS41', 'WS42',
    'WS43', 'WS44', 'WS45',
  ]);
  if (exterior.has(clean)) return 'IR501T';
  if (interior.has(clean)) return '450';
  if (/^SF\d/.test(clean)) return '750XT';  // AC3 storefront marks → YKK 750XT
  const sys = SYSTEMS_LIST();
  return sys[0] || 'IR501T';
}

function dxfPairs(text) {
  const lines = text.split(/\r?\n/);
  const pairs = [];
  for (let i = 0; i < lines.length - 1; i += 2) {
    const code = parseInt(lines[i].trim(), 10);
    if (!Number.isNaN(code)) pairs.push([code, lines[i + 1].trim()]);
  }
  return pairs;
}

function dxfCollectEntities(pairs, sectionName) {
  let section = null;
  let pendingSection = false;
  let current = null;
  const entities = [];

  for (const [code, value] of pairs) {
    if (code === 0 && value === 'SECTION') { pendingSection = true; continue; }
    if (pendingSection && code === 2) { section = value; pendingSection = false; continue; }
    if (code === 0 && value === 'ENDSEC') { section = null; continue; }
    if (section !== sectionName) continue;

    if (code === 0) {
      if (current) entities.push(current);
      current = { type: value, pairs: [] };
    } else if (current) {
      current.pairs.push([code, value]);
    }
  }
  if (current) entities.push(current);
  return entities;
}

function dxfCollectBlocks(pairs) {
  let section = null;
  let pendingSection = false;
  let blockName = null;
  let current = null;
  const blockEntities = [];
  const blocks = new Map();

  for (const [code, value] of pairs) {
    if (code === 0 && value === 'SECTION') { pendingSection = true; continue; }
    if (pendingSection && code === 2) { section = value; pendingSection = false; continue; }
    if (code === 0 && value === 'ENDSEC') { section = null; continue; }
    if (section !== 'BLOCKS') continue;

    if (code === 0 && value === 'BLOCK') {
      blockName = null;
      blockEntities.length = 0;
      current = null;
      continue;
    }
    if (code === 0 && value === 'ENDBLK') {
      if (current) blockEntities.push(current);
      if (blockName) blocks.set(blockName, blockEntities.map(e => ({ type: e.type, pairs: [...e.pairs] })));
      current = null;
      blockName = null;
      continue;
    }
    if (blockName === null && code === 2) {
      blockName = value;
      continue;
    }
    if (blockName === null) continue;

    if (code === 0) {
      if (current) blockEntities.push(current);
      current = { type: value, pairs: [] };
    } else if (current) {
      current.pairs.push([code, value]);
    }
  }
  return blocks;
}

function dxfValues(entity, code) {
  return entity.pairs.filter(([c]) => c === code).map(([, value]) => value);
}

function dxfValue(entity, code) {
  const values = dxfValues(entity, code);
  return values.length ? values[0] : '';
}

// #S3: real HATCH boundary-path parser (walks codes 91/92/93/72/73/10/20/11/21, per the DXF
// spec), NOT a flat x(10)/y(20) pair scan. A flat scan is wrong for HATCH: every entity also
// carries a base/elevation point (10/20/30 = 0,0,0, right after the AcDbHatch subclass marker,
// BEFORE the boundary data) and, after the boundary paths, pattern-definition/seed-point data
// that reuses the same 10/20 codes (e.g. gradient seed points under code 98) — a naive scan
// picks up both and produces garbage boxes that "start at 0,0" (see PROPAGATION-DESIGN.md §3,
// the original failed attempt). Returns the union bbox of ALL boundary-path loops (a single
// HATCH entity here is typically many small sub-loops — bolt/reveal cutouts — that together
// outline one physical panel), or null if unparseable. Only line (72=1) and arc/ellipse
// (72=2/3, approximated by their circumscribing box) edges are handled — spline (72=4)
// boundaries aren't expected in these architectural panel hatches and abort the walk safely
// (returns whatever was accumulated so far, never throws).
function dxfHatchBoundaryBBox(entity) {
  const p = entity.pairs;
  const i91 = p.findIndex(([c]) => c === 91); // number of boundary paths — marks the start of boundary data
  if (i91 === -1) return null;
  let i = i91 + 1;
  let nPaths = parseInt(p[i91][1], 10);
  if (!Number.isFinite(nPaths) || nPaths <= 0) return null;
  const xs = [], ys = [];
  const next = () => (i < p.length ? p[i] : null);
  for (let pi = 0; pi < nPaths; pi++) {
    const t92 = next(); if (!t92 || t92[0] !== 92) break; // malformed — stop, keep whatever we have
    const flag = parseInt(t92[1], 10); i++;
    const isPoly = (flag & 2) !== 0;
    if (isPoly) {
      const tBulge = next(); if (!tBulge || tBulge[0] !== 72) break;
      const hasBulge = tBulge[1] === '1'; i++;
      const tClosed = next(); if (!tClosed || tClosed[0] !== 73) break; i++;
      const tN = next(); if (!tN || tN[0] !== 93) break;
      const nverts = parseInt(tN[1], 10); i++;
      let ok = true;
      for (let v = 0; v < nverts; v++) {
        const tx = next(); if (!tx || tx[0] !== 10) { ok = false; break; }
        xs.push(parseFloat(tx[1])); i++;
        const ty = next(); if (!ty || ty[0] !== 20) { ok = false; break; }
        ys.push(parseFloat(ty[1])); i++;
        if (hasBulge && next() && next()[0] === 42) i++; // skip bulge value
      }
      if (!ok) break;
    } else {
      const tN = next(); if (!tN || tN[0] !== 93) break;
      const nedges = parseInt(tN[1], 10); i++;
      let ok = true;
      for (let ed = 0; ed < nedges; ed++) {
        const tType = next(); if (!tType || tType[0] !== 72) { ok = false; break; }
        const etype = parseInt(tType[1], 10); i++;
        if (etype === 1) { // line: 10/20 start, 11/21 end
          if (!next() || next()[0] !== 10) { ok = false; break; } xs.push(parseFloat(p[i][1])); i++;
          if (!next() || next()[0] !== 20) { ok = false; break; } ys.push(parseFloat(p[i][1])); i++;
          if (!next() || next()[0] !== 11) { ok = false; break; } xs.push(parseFloat(p[i][1])); i++;
          if (!next() || next()[0] !== 21) { ok = false; break; } ys.push(parseFloat(p[i][1])); i++;
        } else if (etype === 2 || etype === 3) { // arc/ellipse — approximate via circumscribing box
          if (!next() || next()[0] !== 10) { ok = false; break; } const cx = parseFloat(p[i][1]); i++;
          if (!next() || next()[0] !== 20) { ok = false; break; } const cy = parseFloat(p[i][1]); i++;
          let r = 0;
          if (etype === 2) { if (next() && next()[0] === 40) { r = parseFloat(p[i][1]); i++; } if (next() && next()[0] === 50) i++; if (next() && next()[0] === 51) i++; if (next() && next()[0] === 73) i++; }
          else { let mx = 0, my = 0; if (next() && next()[0] === 11) { mx = parseFloat(p[i][1]); i++; } if (next() && next()[0] === 21) { my = parseFloat(p[i][1]); i++; } r = Math.hypot(mx, my); if (next() && next()[0] === 40) i++; if (next() && next()[0] === 50) i++; if (next() && next()[0] === 51) i++; if (next() && next()[0] === 73) i++; }
          xs.push(cx - r, cx + r); ys.push(cy - r, cy + r);
        } else { ok = false; break; } // spline or unknown edge type — bail out of this path
      }
      if (!ok) break;
    }
    // 97 = number of source boundary objects; skip that many 330 handles
    const t97 = next();
    if (t97 && t97[0] === 97) {
      const nsrc = parseInt(t97[1], 10); i++;
      for (let s = 0; s < nsrc; s++) { if (next() && next()[0] === 330) i++; }
    }
  }
  if (!xs.length) return null;
  return { minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) };
}

function dxfMtextSummary(entity) {
  return {
    text: dxfValue(entity, 1).trim(),
    x: parseFloat(dxfValue(entity, 10)),
    y: parseFloat(dxfValue(entity, 20)),
  };
}

function dxfInsertSummary(entity) {
  return {
    block: dxfValue(entity, 2),
    x: parseFloat(dxfValue(entity, 10)) || 0,
    y: parseFloat(dxfValue(entity, 20)) || 0,
    scaleX: parseFloat(dxfValue(entity, 41)) || 1,
    scaleY: parseFloat(dxfValue(entity, 42)) || 1,
  };
}

function dxfTransformEntity(entity, insert) {
  return {
    type: entity.type,
    pairs: entity.pairs.map(([code, value]) => {
      if (code === 10) return [code, String(insert.x + (parseFloat(value) || 0) * insert.scaleX)];
      if (code === 20) return [code, String(insert.y + (parseFloat(value) || 0) * insert.scaleY)];
      return [code, value];
    }),
  };
}

function dxfPolylineSummary(entity) {
  const xs = dxfValues(entity, 10).map(Number);
  const ys = dxfValues(entity, 20).map(Number);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);
  return {
    handle: dxfValue(entity, 5),
    layer: dxfValue(entity, 8),
    minX,
    maxX,
    minY,
    maxY,
    width: maxX - minX,
    height: maxY - minY,
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function dxfTransformBox(box, insert) {
  const minX = insert.x + box.minX * insert.scaleX;
  const maxX = insert.x + box.maxX * insert.scaleX;
  const minY = insert.y + box.minY * insert.scaleY;
  const maxY = insert.y + box.maxY * insert.scaleY;
  return {
    ...box,
    handle: `${insert.block}:${box.handle}`,
    minX,
    maxX,
    minY,
    maxY,
    width: Math.abs(maxX - minX),
    height: Math.abs(maxY - minY),
    centerX: (minX + maxX) / 2,
    centerY: (minY + maxY) / 2,
  };
}

function dxfRound(value) {
  return Math.round(value * 1000) / 1000;
}

// ---------- System picker modal (import 追问 + 批量统一) ----------
// resolve 值: 系统名=套用该系统; null=保持自动识别(仅 import); undefined=取消(不改动)
function pickSystem({ title, msg, includeAuto } = {}) {
  return new Promise(resolve => {
    const modal = document.getElementById('system-modal');
    const choices = document.getElementById('system-modal-choices');
    if (!modal || !choices) { resolve(undefined); return; }
    document.getElementById('system-modal-title').textContent = title || 'Select System';
    document.getElementById('system-modal-msg').textContent = msg || '';
    const done = (val) => { modal.style.display = 'none'; choices.innerHTML = ''; modal.onclick = null; resolve(val); };
    choices.innerHTML = '';
    for (const s of SYSTEMS_LIST()) {
      const b = document.createElement('button');
      b.className = 'tk-btn tk-btn--dark'; b.textContent = s;
      b.onclick = () => done(s); choices.appendChild(b);
    }
    if (includeAuto) {
      const b = document.createElement('button');
      b.className = 'tk-btn tk-btn--ghost'; b.textContent = 'Keep auto-detect (per-mark)';
      b.onclick = () => done(null); choices.appendChild(b);
    }
    const c = document.createElement('button');
    c.className = 'tk-btn tk-btn--ghost'; c.textContent = 'Cancel';
    c.onclick = () => done(undefined); choices.appendChild(c);
    modal.style.display = 'flex';
    modal.onclick = (e) => { if (e.target === modal) done(undefined); };
  });
}

async function setAllOpeningsSystem() {
  if (!state.openings.length) return;
  const sys = await pickSystem({
    title: 'Unify System',
    msg: `Set the system for all ${state.openings.length} openings to:`,
    includeAuto: false,
  });
  if (!sys) return; // 取消
  state.openings.forEach(o => { o.system = sys; if (is1600(sys)) reclassify1600(o); });
  save(); renderOpenings(); renderReport(); renderMeta();
}

async function runDxfParse() {
  const ta = document.getElementById('dxf-text');
  const text = ta.value;
  // #S4: ask which system BEFORE parsing, so classification/whitelist run against the
  // confirmed system instead of a per-mark guess (see memory.md "S4").
  const sys = await pickSystem({
    title: 'Import — Select System',
    msg: `Which system is this batch? (usually one at a time; the whole batch gets it — or keep auto-detect for a mixed schedule).`,
    includeAuto: true,
  });
  if (sys === undefined) return; // cancelled — nothing parsed yet, nothing to undo
  appendParsedOpenings(parseDxfText(text, { forcedSystem: sys || undefined }), ta, sys);
}

async function appendParsedOpenings(result, sourceEl = null, presetSys) {
  const { openings, errors } = result;
  const statusEl = document.getElementById('dxf-status');
  if (!openings.length) {
    statusEl.textContent = `0 openings parsed — check format`;
    statusEl.className = 'tk-dxf__status is-err';
    return;
  }
  if (state.openings.length &&
      !confirm(`The Openings table already has ${state.openings.length} rows; import will append (not replace).\nClick OK to append; click Cancel to stop, then clear the old rows before importing.`)) {
    statusEl.textContent = 'Import cancelled — table unchanged';
    statusEl.className = 'tk-dxf__status is-err';
    return;
  }
  // #S4: callers now ask which system BEFORE parsing and pass their resolved choice as
  // presetSys, so classification already ran against the confirmed system. Only ask here as a
  // fallback if a caller didn't pre-ask (keeps this function safe to call directly elsewhere).
  const sys = presetSys !== undefined ? presetSys : await pickSystem({
    title: 'Import — Select System',
    msg: `Parsed ${openings.length} openings. Which system is this batch? (usually one at a time; the whole batch gets it)`,
    includeAuto: true,
  });
  if (sys === undefined) {
    statusEl.textContent = 'Import cancelled — table unchanged';
    statusEl.className = 'tk-dxf__status is-err';
    return;
  }
  if (sys) openings.forEach(o => { o.system = sys; }); // belt-and-suspenders relabel; cuts were already classified with forcedSystem above
  if (is1600(sys)) openings.forEach(reclassify1600);
  state.openings.push(...openings);
  renderOpenings(); renderReport(); renderMeta(); save();
  // M2: auto-push elevations parsed this batch (manual "→ Tracker" button stays as a force-re-push fallback).
  if (ELEV_EXPORTS.size && window.__fb) { try { await exportElevationsToTracker(); } catch (e) { console.warn('[M2] auto-push failed:', e); } }
  const msg = `+${openings.length} openings added` + (errors.length ? ` · ${errors.length} skipped` : '');
  statusEl.textContent = msg;
  statusEl.className = 'tk-dxf__status ' + (errors.length ? 'is-err' : 'is-ok');
  if (sourceEl) sourceEl.value = '';
}

function importDxfFile() {
  document.getElementById('dxf-file').click();
}

async function onDxfFileChange(e) {
  const file = e.target.files && e.target.files[0];
  if (!file) return;
  const statusEl = document.getElementById('dxf-status');
  try {
    const text = await file.text();
    // #S4: ask which system BEFORE parsing (same rule as runDxfParse) so classification runs
    // against the confirmed system instead of a per-mark guess.
    const sys = await pickSystem({
      title: 'Import — Select System',
      msg: `Which system is ${file.name}? (usually one at a time; the whole batch gets it — or keep auto-detect for a mixed schedule).`,
      includeAuto: true,
    });
    if (sys === undefined) { statusEl.textContent = 'Import cancelled'; statusEl.className = 'tk-dxf__status is-err'; e.target.value = ''; return; }
    const forcedSystem = sys || undefined;
    // Try real DXF geometry parse first; fall back to text/schedule parser
    let result = null;
    if (text.includes('SECTION') && text.includes('ENTITIES')) {
      try { result = parseRawDxfOpenings(text, { forcedSystem }); } catch (e) { console.warn('DXF parse failed, falling back to text:', e); }
    }
    if (!result || !result.openings || !result.openings.length) {
      result = parseDxfText(text, { forcedSystem });
    }
    await appendParsedOpenings(result, null, sys);
    statusEl.textContent = `${file.name}: ${statusEl.textContent}`;
  } catch (err) {
    statusEl.textContent = `Could not read ${file.name}`;
    statusEl.className = 'tk-dxf__status is-err';
  } finally {
    e.target.value = '';
  }
}

function loadDxfSample() {
  const sample = `SF-01  IR501T  72  96   2
SF-02, IR501T, 60x84, qty 3
ENT-1   IR501T   84" x 108"   x1
F-3   450   48 x 96    (4)
F-4   450   36 x 84    qty: 6`;
  document.getElementById('dxf-text').value = sample;
}

// ============================================================
//  EXPORT
// ============================================================
function exportCsv() {
  const { rows, unresolved } = buildReport();
  const lines = [];
  lines.push(['System','Part Number','Description','Roles','Total Cut Length (in)','Stocks (FFD, pcs)','Stocks +'+wastePctVal()+'% (pcs)','Oversize (pcs)','Oversize Lengths (in)']
    .map(csvEsc).join(','));
  for (const r of rows) {
    lines.push([
      r.system, r.partNumber, r.description, r.rolesUsed.join(' / '),
      r.totalInches.toFixed(2), r.stocks, r.stocksWaste,
      r.oversize.length, r.oversize.map(o => o.toFixed(2)).join(' / ')
    ].map(csvEsc).join(','));
  }
  if (unresolved.length) {
    lines.push('');
    lines.push('UNRESOLVED — no part assigned for these positions');
    lines.push(['System','Position','Total Cut Length (in)'].map(csvEsc).join(','));
    for (const u of unresolved) {
      lines.push([u.system, u.position, u.totalInches.toFixed(2)].map(csvEsc).join(','));
    }
  }
  const ascii = s => String(s ?? '').replace(/×/g, 'x').replace(/÷/g, '/').replace(/[″"]/g, 'in').replace(/°/g, 'deg');
  const accRows = computeAccessories().filter(r => r.qty > 0);   // #3: export only accessories actually used (qty > 0)
  if (accRows.length) {
    lines.push('');
    lines.push('ACCESSORIES');
    lines.push(['Part Number','Description','Rule','Positions','Param','Min','Qty','Unit','Basis'].map(csvEsc).join(','));
    for (const { acc: a, qty, basis } of accRows) {
      lines.push([
        a.partNumber || '', a.description || '', ascii((ACC_RULES[a.rule] || {}).label || a.rule),
        (a.positions || []).join(' / ') || '(all)', a.param, a.min || 0, qty, a.unit || 'ea', ascii(basis)
      ].map(csvEsc).join(','));
    }
  }
  download(`takeoff${scopeSuffix()}.csv`, String.fromCharCode(0xFEFF) + lines.join('\n'), 'text/csv;charset=utf-8');   // #3: UTF-8 BOM so Excel doesn't mojibake
}
function csvEsc(v) {
  const s = String(v ?? '');
  return /[,"\n]/.test(s) ? `"${s.replace(/"/g,'""')}"` : s;
}
function download(filename, content, mime) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click();
  setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 0);
}

function copyReport() {
  const { rows, unresolved } = buildReport();
  const COL = [22, 14, 38, 22, 14, 8, 8, 6];
  const pad = (s, n, right) => {
    s = String(s);
    if (s.length > n) s = s.slice(0, n-1)+'…';
    return right ? s.padStart(n) : s.padEnd(n);
  };
  const header = ['System','Part #','Description','Roles','Cut In.','Stocks','+'+wastePctVal()+'%','Over']
    .map((h,i) => pad(h, COL[i], i>=4)).join('  ');
  const rule = COL.map(n => '─'.repeat(n)).join('  ');
  const out = [header, rule];
  for (const r of rows) {
    out.push([
      pad(r.system, COL[0]),
      pad(r.partNumber, COL[1]),
      pad(r.description, COL[2]),
      pad(r.rolesUsed.join('/'), COL[3]),
      pad(formatNumber(r.totalInches), COL[4], true),
      pad(r.stocks, COL[5], true),
      pad(r.stocksWaste, COL[6], true),
      pad(r.oversize.length || '—', COL[7], true),
    ].join('  '));
  }
  if (unresolved.length) {
    out.push('');
    out.push('UNRESOLVED:');
    for (const u of unresolved) {
      out.push(`  ${u.system}  ${u.position.padEnd(12)}  ${formatNumber(u.totalInches).padStart(10)}"`);
    }
  }
  const text = out.join('\n');
  navigator.clipboard.writeText(text).then(() => {
    flash('export-status', 'Report copied to clipboard', false);
  }, () => {
    flash('export-status', 'Copy failed', true);
  });
}

// ============================================================
//  RESET
// ============================================================
function importPartList(text, format) {
  // format: 'json' (array of {system, partNumber, description, roles:[]}) or 'csv'
  // CSV columns: system, partNumber, description, role1, role2, ...
  let parts = [];
  text = (text||'').trim();
  if (!text) return { ok:false, error:'empty input' };
  if (format === 'json' || text.startsWith('[') || text.startsWith('{')) {
    try {
      const data = JSON.parse(text);
      parts = (Array.isArray(data) ? data : data.parts || []).map(p => ({
        id: uid(),
        system: String(p.system || p.System || '').trim(),
        partNumber: String(p.partNumber || p.part || p['Part #'] || p['Part'] || '').trim(),
        description: String(p.description || p.desc || p['Description'] || '').trim(),
        roles: Array.isArray(p.roles) ? p.roles : (p.role ? [p.role] : []),
      })).filter(p => p.partNumber);
    } catch (e) { return { ok:false, error:'JSON parse: '+e.message }; }
  } else {
    // CSV/TSV
    const lines = text.split(/\r?\n/).filter(l => l.trim());
    const sep = lines[0].includes('\t') ? '\t' : ',';
    const header = lines[0].split(sep).map(s => s.trim().toLowerCase());
    const iSys = header.findIndex(h => /system/i.test(h));
    const iPn  = header.findIndex(h => /part/i.test(h) && /num|#/i.test(h));
    const iDesc= header.findIndex(h => /desc/i.test(h));
    const iRoleStart = header.findIndex(h => /role|position/i.test(h));
    if (iPn < 0) return { ok:false, error:'no Part Number column' };
    for (const ln of lines.slice(1)) {
      const cols = ln.split(sep).map(s => s.trim());
      const roles = iRoleStart >= 0 ? cols.slice(iRoleStart).filter(Boolean) : [];
      parts.push({
        id: uid(),
        system: iSys >= 0 ? cols[iSys] : '',
        partNumber: cols[iPn],
        description: iDesc >= 0 ? cols[iDesc] : '',
        roles,
      });
    }
  }
  if (!parts.length) return { ok:false, error:'no rows parsed' };
  state.parts = parts;
  state.partsDbVersion = (state.partsDbVersion||0) + 1;
  save();
  renderAll();
  return { ok:true, count:parts.length };
}
window.importPartList = importPartList;

// #reset-safety (2026-09-04, Leo: "修改记录永远是保存不了的，已经五次了"):
// THIS is what was eating his work — not the pin matcher, which I spent four rounds improving.
// resetAll() replaced the whole `state` object with a fresh one holding only parts, accessories and
// an empty openings list. Every other key went with it: elevEdits (every corrected elevation and
// its version history), rolePins, roleEdits, panelEdits, roleTemplates, recognizedRoles,
// markGroups, systemGaskets — and then renderAll() called save(), writing the emptied state over
// localStorage. The button says "Reset to seed" and sits in the Parts Database header, so it reads
// like it resets the parts library. It did not say it would delete a month of hand-classification.
//
// Now it resets EXACTLY what it claims to: parts, accessories, openings. Everything a person
// authored by hand is carried across untouched, and the confirm says so.
const USER_AUTHORED_STATE_KEYS = ['elevEdits', 'rolePins', 'rolePinsMigrated', 'roleEdits',
  'panelEdits', 'roleTemplates', 'recognizedRoles', 'customRoles', 'markGroups', 'systemGaskets',
  'gasketBoxLF', 'exportScope', 'projectName', 'includePerimeterGasket', 'layerConfig'];
function resetAll() {
  const kept = USER_AUTHORED_STATE_KEYS.filter(k => state[k] != null &&
    (typeof state[k] !== 'object' || Object.keys(state[k]).length));
  const nMarks = Object.keys(state.elevEdits || {}).length;
  if (!confirm('Reset the parts library, accessories and openings to seed?\n\n'
    + `Your hand work is KEPT: saved role edits for ${nMarks} mark(s), role pins, panel edits, `
    + 'templates, cut groups and gasket defaults all stay.\n\nContinue?')) return;
  const carry = {};
  for (const k of kept) carry[k] = state[k];
  state = Object.assign({ partsDbVersion: PARTS_DB_VERSION, parts: cloneSeedParts(),
                          openings: [], accessories: cloneSeedAccessories() }, carry);
  renderAll();
}
// #reset-safety: a last line of defence under save() itself. Any code path that drops a
// user-authored record it had a moment ago is a bug, so the previous value is stashed and the
// write is refused rather than quietly committed. `Restore my edits` in the Parts header brings
// the stash back. Nothing here is clever — it just makes silent loss impossible.
const STORAGE_BACKUP_KEY = (typeof STORAGE_KEY !== 'undefined' ? STORAGE_KEY : 'takeoff') + ':edits-backup';
function snapshotUserEdits() {
  const out = {};
  for (const k of USER_AUTHORED_STATE_KEYS) if (state[k] != null) out[k] = state[k];
  return out;
}
function backupUserEdits() {
  try {
    const snap = snapshotUserEdits();
    const marks = Object.keys(snap.elevEdits || {}).length + Object.keys(snap.rolePins || {}).length;
    if (!marks) return;
    localStorage.setItem(STORAGE_BACKUP_KEY, JSON.stringify({ at: Date.now(), marks, data: snap }));
  } catch (_) {}
}
function readEditsBackup() {
  try { return JSON.parse(localStorage.getItem(STORAGE_BACKUP_KEY) || 'null'); } catch (_) { return null; }
}
function restoreEditsBackup() {
  const b = readEditsBackup();
  if (!b || !b.data) { alert('No backup of your edits was found in this browser.'); return; }
  const when = new Date(b.at).toLocaleString();
  if (!confirm(`Restore hand-made edits for ${b.marks} mark(s), backed up ${when}?\n\n`
    + 'Anything you have edited since then, for the same marks, is replaced.')) return;
  for (const k in b.data) state[k] = b.data[k];
  save(); renderAll();
  const st = document.getElementById('export-status');
  if (st) { st.textContent = `Restored edits for ${b.marks} mark(s) from ${when}`; st.className = 'tk-dxf__status is-ok'; }
}
function clearOpenings() {
  if (!state.openings.length) return;
  if (!confirm('Remove all openings? Parts database stays.')) return;
  state.openings = [];
  renderOpenings(); renderReport(); renderMeta(); save();
}

// ============================================================
//  WIRE UP
// ============================================================
function init() {
  // Parts
  const partsBody = document.getElementById('parts-tbody');
  partsBody.addEventListener('input', onPartsChange);
  partsBody.addEventListener('change', onPartsChange);
  partsBody.addEventListener('click', onPartsClick);
  document.getElementById('add-part').addEventListener('click', addPart);

  // Import Parts button → file picker
  const importPartsBtn = document.getElementById('import-parts');
  const partsFileInput = document.getElementById('parts-file');
  if (importPartsBtn && partsFileInput) {
    importPartsBtn.addEventListener('click', () => partsFileInput.click());
    partsFileInput.addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const text = await file.text();
      const fmt = file.name.toLowerCase().endsWith('.json') ? 'json' : 'csv';
      const result = importPartList(text, fmt);
      flash('qa-status', result.ok ? `Imported ${result.count} parts` : ('Error: '+result.error), !result.ok);
      e.target.value = '';
    });
  }

  // Layer Config button → open modal
  const lcBtn = document.getElementById('layer-config');
  const lcModal = document.getElementById('layer-config-modal');
  const lcOpen = () => {
    document.getElementById('lc-alum').value = LAYER_CONFIG.alum || '';
    document.getElementById('lc-doorSubframe').value = LAYER_CONFIG.doorSubframe || '';
    document.getElementById('lc-outline').value = LAYER_CONFIG.outline || '';
    document.getElementById('lc-door').value = LAYER_CONFIG.door || '';
    document.getElementById('lc-fallbacks').value = (LAYER_CONFIG.fallbacks || []).join(',');
    lcModal.style.display = 'flex';
  };
  const lcClose = () => { lcModal.style.display = 'none'; };
  if (lcBtn && lcModal) {
    lcBtn.addEventListener('click', lcOpen);
    document.getElementById('lc-cancel').addEventListener('click', lcClose);
    document.getElementById('lc-save').addEventListener('click', () => {
      setLayerConfig({
        alum: document.getElementById('lc-alum').value.trim(),
        doorSubframe: document.getElementById('lc-doorSubframe').value.trim(),
        outline: document.getElementById('lc-outline').value.trim(),
        door: document.getElementById('lc-door').value.trim(),
        fallbacks: document.getElementById('lc-fallbacks').value.split(',').map(s => s.trim()).filter(Boolean),
      });
      lcClose();
    });
    lcModal.addEventListener('click', (e) => { if (e.target === lcModal) lcClose(); });
  }


  // Openings
  const opsBody = document.getElementById('openings-tbody');
  opsBody.addEventListener('input', onOpeningsInput);
  opsBody.addEventListener('change', onOpeningsInput);
  opsBody.addEventListener('click', onOpeningsClick);
  document.getElementById('add-opening').addEventListener('click', addOpeningFromQuick);
  document.getElementById('clear-openings').addEventListener('click', clearOpenings);
  const setAllSysBtn = document.getElementById('set-all-system');
  if (setAllSysBtn) setAllSysBtn.addEventListener('click', setAllOpeningsSystem);

  // DXF
  document.getElementById('dxf-import').addEventListener('click', importDxfFile);
  document.getElementById('dxf-file').addEventListener('change', onDxfFileChange);
  document.getElementById('dxf-parse').addEventListener('click', runDxfParse);
  document.getElementById('dxf-sample').addEventListener('click', loadDxfSample);
  const exportElevBtn = document.getElementById('export-elev');
  if (exportElevBtn) exportElevBtn.addEventListener('click', exportElevationsToTracker);

  // Export
  document.getElementById('export-csv').addEventListener('click', exportCsv);
  const exportXlsxBtn = document.getElementById('export-elev-xlsx');
  if (exportXlsxBtn) exportXlsxBtn.addEventListener('click', downloadElevationWorkbook);
  const exportGroupXlsxBtn = document.getElementById('export-group-xlsx');
  if (exportGroupXlsxBtn) exportGroupXlsxBtn.addEventListener('click', downloadGroupWorkbook);
  const projNameInput = document.getElementById('xl-project-name');
  if (projNameInput) {
    projNameInput.value = xlProjectName();
    projNameInput.addEventListener('change', () => { state.projectName = projNameInput.value.trim(); save(); });
  }
  const exportCuttingAllBtn = document.getElementById('export-cutting-dxf-all');
  if (exportCuttingAllBtn) exportCuttingAllBtn.addEventListener('click', downloadAllCuttingDxf);
  const exportCuttingCombinedBtn = document.getElementById('export-cutting-dxf-combined');
  if (exportCuttingCombinedBtn) exportCuttingCombinedBtn.addEventListener('click', downloadCombinedCuttingDxf);
  const exportCuttingPooledBtn = document.getElementById('export-cutting-dxf-pooled');
  if (exportCuttingPooledBtn) exportCuttingPooledBtn.addEventListener('click', downloadPooledCuttingDxf);
  const exportCuttingGroupsBtn = document.getElementById('export-cutting-dxf-groups');
  if (exportCuttingGroupsBtn) exportCuttingGroupsBtn.addEventListener('click', downloadGroupedCuttingDxf);
  initCutGroupsModal();
  document.getElementById('copy-report').addEventListener('click', copyReport);
  document.getElementById('reset-all').addEventListener('click', resetAll);

  // #panel-gasket: the storefront perimeter run is a separate takeoff from the per-panel infill
  // gasket, so it gets its own on/off rather than being folded into a panel's spec.
  const perimChk = document.getElementById('acc-perimeter-gasket');
  if (perimChk) {
    perimChk.checked = state.includePerimeterGasket !== false;
    perimChk.addEventListener('change', () => {
      state.includePerimeterGasket = !!perimChk.checked;
      save(); renderReport();
      if (viewerOpeningId != null) renderViewer(viewerOpeningId);
    });
  }

  // Recognized Roles panel (#2, 2026-07-20 Opus)
  const rrSystemSel = document.getElementById('rr-system');
  if (rrSystemSel) rrSystemSel.addEventListener('change', e => { _rrSystem = e.target.value; renderRecognizedRoles(); });
  const rrBody = document.getElementById('rr-body');
  if (rrBody) {
    rrBody.addEventListener('click', e => {
      if (!_rrSystem) return;
      const del = e.target.closest('.rr-del');
      if (del) {
        const cur = (state.recognizedRoles && state.recognizedRoles[_rrSystem]) || [];
        setRecognizedRoles(_rrSystem, cur.filter(r => r !== del.dataset.role));
        return;
      }
      if (e.target.closest('#rr-curate')) { setRecognizedRoles(_rrSystem, Array.from(allowedRolesForSystem(_rrSystem))); return; }
      if (e.target.closest('#rr-reset'))  { setRecognizedRoles(_rrSystem, null); return; }
      if (e.target.closest('#rr-add-btn')) {
        const inp = document.getElementById('rr-add');
        const v = inp && inp.value.trim();
        if (!v) return;
        const cur = (state.recognizedRoles && state.recognizedRoles[_rrSystem]) || [];
        setRecognizedRoles(_rrSystem, [...cur, v]);
      }
    });
    rrBody.addEventListener('keydown', e => {
      if (e.key === 'Enter' && e.target.id === 'rr-add') { e.preventDefault(); document.getElementById('rr-add-btn')?.click(); }
    });
  }

  renderAll();
}

document.addEventListener('DOMContentLoaded', init);
