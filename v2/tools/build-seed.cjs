#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   v2 seed builder — turns the old trackers' own files into v2 project seeds.

     node v2/tools/build-seed.cjs <folder holding the tracker folders>

   Reads (never writes) each tracker's project-config.js / elevations.js and
   copies its plan images. Writes v2/seed/<pid>.json and v2/plans/<pid>/…

   One seed = one project: meta (name, floors, scopes, elevations) + items.
   An ITEM is one trackable piece — a shower door, a guardrail unit, one
   glass lite on an elevation. Its key is the old tracker's key, so a later
   import of cloud progress joins on it.
   ───────────────────────────────────────────────────────────────────────── */
const fs = require('fs'), path = require('path'), vm = require('vm');

const ROOT = process.argv[2] || path.resolve(__dirname, '../../../..');
const OUT  = path.resolve(__dirname, '..');
const POST_SPACING_FT = 4;                       // Leo, 2026-10-05: guardrail posts every 4 ft

function load(dir, files) {
  const g = { console: { log() {}, warn() {}, error() {} } };
  vm.createContext(g); g.window = g.self = g;
  for (const f of files) {
    const p = path.join(dir, f);
    if (fs.existsSync(p)) vm.runInContext(fs.readFileSync(p, 'utf8'), g, { filename: p });
  }
  const ELEV = vm.runInContext('typeof ELEVATIONS !== "undefined" ? ELEVATIONS : undefined', g) || g.ELEVATIONS || {};
  return { P: g.PROJECT, ELEV };
}
const firstDir = (...c) => c.map(d => path.join(ROOT, d)).find(d => fs.existsSync(path.join(d, 'project-config.js')));
const safe = s => String(s).replace(/[.#$\[\]\/]/g, '_');
const r5 = n => Math.round(n * 1e5) / 1e5;
const copy = (from, pid, name) => {
  const dst = path.join(OUT, 'plans', pid);
  fs.mkdirSync(dst, { recursive: true });
  fs.copyFileSync(from, path.join(dst, name));
  return `plans/${pid}/${name}`;
};
const write = (seed) => {
  fs.writeFileSync(path.join(OUT, 'seed', seed.id + '.json'), JSON.stringify(seed));
  const n = Object.keys(seed.items).length;
  const by = {};
  Object.values(seed.items).forEach(i => { by[i.scope] = (by[i.scope] || 0) + 1; });
  console.log(`${seed.id}: ${n} items  ${JSON.stringify(by)}  floors ${seed.floors.length}`);
};

/* ── 355 Lexington ─────────────────────────────────────────────────────── */
function lexington() {
  const dir = firstDir('355-lexington-tracker', 'Lexington/355-lexington-tracker');
  if (!dir) return console.log('lex: tracker folder not found — skipped');
  const { P } = load(dir, ['project-config.js']);
  const SCOPE = { 'Shower Door': 'shower', 'Guardrail': 'guardrail', 'Terrace Divider': 'divider', 'Equipment Screen': 'screen' };

  const planOf = {};
  const floors = P.floors.map(f => {
    const img = f.img || `plan-${f.key.toLowerCase()}.png`;
    if (!planOf[img] && fs.existsSync(path.join(dir, img))) planOf[img] = copy(path.join(dir, img), 'lex', img);
    return { key: f.key, label: f.name.en, labelZh: (f.name.zh || '').split(' / ')[0], sheet: f.sheet || '',
             plan: planOf[img] || '', w: (f.planSize || [])[0] || 0, h: (f.planSize || [])[1] || 0 };
  });

  const items = {};
  for (const u of P.seedUnits) {
    const scope = SCOPE[u.type];
    if (!scope) { console.log('lex: unknown type', u.type, u.key); continue; }
    const it = { label: u.id, scope, floor: u.level, zone: u.zone || '', note: u.note || '', lf: Number(u.lf) || 0 };
    if (Array.isArray(u.runs) && u.runs.length) {
      it.geo = { t: 'lines', lines: u.runs.map(r => r.pts.map(p => [r5(p[0]), r5(p[1])])) };
      if (scope === 'guardrail') {
        // posts per run at a fixed spacing; a run of L ft has ceil(L/4) bays → +1 posts
        const n = u.runs.reduce((a, r) => a + Math.ceil((Number(r.lf) || 0) / POST_SPACING_FT) + 1, 0);
        it.qty = { n, u: 'posts' };
      } else {
        // equipment screen: each face says "4w×1h" → panels = w × h
        const n = u.runs.reduce((a, r) => {
          const m = String(r.label || '').match(/(\d+)\s*w\s*[×x]\s*(\d+)\s*h/i);
          return a + (m ? Number(m[1]) * Number(m[2]) : 1);
        }, 0);
        it.qty = { n, u: 'panels' };
      }
      it.parts = u.runs.map(r => r.label || '');
    } else if (Array.isArray(u.panels) && u.panels.length) {
      it.geo = { t: 'poly', polys: u.panels.map(p => p.pts.map(q => [r5(q[0]), r5(q[1])])) };
    }
    items[safe(u.key)] = it;
  }

  write({
    id: 'lex', name: '355 Lexington Avenue', code: 'LEX', pm: 'Jaesik', gc: 'Turner', status: 'not-started',
    scopes: [
      { key: 'shower',    label: 'Shower Door',      labelZh: '淋浴门', factory: false },
      { key: 'guardrail', label: 'Guardrail',        labelZh: '栏杆',   factory: true, count: 'posts' },
      { key: 'divider',   label: 'Terrace Divider',  labelZh: '隔断',   factory: true },
      { key: 'screen',    label: 'Equipment Screen', labelZh: '设备屏', factory: true, count: 'panels' }
    ],
    floors, elevations: {}, items
  });
}

/* ── Atlantic-Chestnut Building 3 ─────────────────────────────────────── */
function ac3() {
  const dir = firstDir('AC3 tracker');
  if (!dir) return console.log('ac3: tracker folder not found — skipped');
  const { P, ELEV } = load(dir, ['project-config.js', 'elevations.js']);
  const plan = fs.existsSync(path.join(dir, '2.png')) ? copy(path.join(dir, '2.png'), 'ac3', 'plan-gf.png') : '';
  const T = { glass: 'glass', panel: 'panel', door: 'door', louver: 'louver' };

  const items = {};
  for (const u of P.seedUnits) {
    items[safe(u.key)] = { label: u.id, scope: 'frame', floor: u.level || 'GF', zone: u.zone || '', note: u.note || '' };
  }
  const elevations = {};
  for (const [k, E] of Object.entries(ELEV)) {
    const file = `elev-${safe(k)}.svg`;
    const dst = path.join(OUT, 'plans', 'ac3'); fs.mkdirSync(dst, { recursive: true });
    fs.writeFileSync(path.join(dst, file), String(E.base || ''));
    elevations[safe(k)] = { name: E.name || k, viewBox: E.viewBox, base: `plans/ac3/${file}` };
    for (const el of E.elements) {
      const scope = T[el.t0];
      if (!scope) continue;                                   // 'hidden' and unknown parts are not scope
      items[safe(k) + '__' + safe(el.id)] = {
        label: `${k} ${el.id}`, scope, floor: 'GF', zone: k, elev: safe(k),
        geo: { t: 'rect', x: el.x, y: el.y, w: el.w, h: el.h }
      };
    }
  }
  write({
    id: 'ac3', name: 'Atlantic-Chestnut Building 3', code: 'AC3', pm: 'Jaesik', gc: '', status: 'not-started',
    note: 'Openings: 17 of 51 so far — the other 34 and their plan positions are only in the old tracker\'s cloud data and come in with the import.',
    scopes: [
      { key: 'frame',  label: 'Frame',       labelZh: '框架',   factory: true },
      { key: 'glass',  label: 'Glass',       labelZh: '玻璃',   factory: false },
      { key: 'louver', label: 'Louver',      labelZh: '百叶',   factory: true },
      { key: 'panel',  label: 'Metal Panel', labelZh: '金属板', factory: true },
      { key: 'door',   label: 'Door',        labelZh: '门',     factory: true }
    ],
    floors: [{ key: 'GF', label: 'Ground Floor', labelZh: '首层', plan, w: 4000, h: 3200 }],
    elevations, items
  });
}

/* ── New projects: no scope yet, placeholder plan ─────────────────────── */
function placeholder(id, name, code, pm, scopes) {
  write({ id, name, code, pm, gc: '', status: 'not-started',
          note: 'Takeoff and plans not in yet.',
          scopes, floors: [{ key: 'SITE', label: 'Site plan', labelZh: '总平面', plan: '', w: 1600, h: 1000 }],
          elevations: {}, items: {} });
}

lexington();
ac3();
placeholder('fh', 'Forest Hills Station Gutter', 'FH', 'Jaesik',
  [{ key: 'gutter', label: 'Gutter', labelZh: '天沟', factory: true }]);
placeholder('mta7', 'MTA Package 7', 'MTA7', 'Jean', []);
