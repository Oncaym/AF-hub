/* Per-scope breakdown.

   Two things are checked here, and the second matters more than the first:

   1. the numbers, against each tracker's own CLAUDE.md;
   2. that hub-report.js's OWN classifiers still agree with the ones in each
      tracker's app.js. The hub has to re-implement isDoor / isInterior /
      doorTypeOf because app.js needs a DOM and the scheduled job has none —
      that duplication is the risk, so it is pinned here rather than hoped about.

   Usage:  node _tests/test-breakdown.cjs [folder-holding-the-trackers]
   Trackers that are not on this machine are skipped, not failed.            */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT  = process.argv[2] || path.resolve(__dirname, '..', '..');
const RULES = require(path.resolve(__dirname, '..', 'hub-report.js'));

function slice(src, startRe, endMark, what) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('could not find the start of ' + what + ' — renamed?');
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new Error('could not find the end of ' + what);
  return src.slice(i, j + endMark.length);
}

const TRACKERS = [
  { label: 'AC3', dirs: ['AC3 tracker'] },
  { label: 'CP2', dirs: ['cp2-tracker-deploy', 'CP2 Installation Tracking/cp2-tracker-deploy'] },
  { label: 'Lexington', dirs: ['355-lexington-tracker', 'Lexington/355-lexington-tracker'],
    expect: { 'Shower Door': 159, 'Terrace Divider': 33, 'Guardrail': 8, 'Equipment Screen': 2 },
    qty: [['Guardrail', 'LF', 1201.52], ['Equipment Screen', 'LF', 182.33],
          ['Shower Door', 'pieces', 159], ['Terrace Divider', 'pieces', 33]] },
];

let fails = 0, ran = 0;
const ck = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '   [' + x + ']' : '')); };

for (const t of TRACKERS) {
  const root = t.dirs.map(d => path.join(ROOT, d)).find(p => fs.existsSync(path.join(p, 'project-config.js')));
  if (!root) { console.log('SKIP  ' + t.label + ' — not on this machine'); continue; }
  ran++;

  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(fs.readFileSync(path.join(root, 'project-config.js'), 'utf8'), ctx);
  const PROJECT = ctx.window.PROJECT || ctx.PROJECT;

  /* elevations.js, when the tracker has one. AC3 keeps glass and metal panel as
     elevation ELEMENTS; CP2's file defines ELEV_BAYS (the F-055 bay drawing), which
     is a different thing and correctly yields no element scopes. */
  let ELEV = {};
  const ep = path.join(root, 'elevations.js');
  if (fs.existsSync(ep)) { vm.runInContext(fs.readFileSync(ep, 'utf8'), ctx); ELEV = ctx.window.ELEVATIONS || {}; }

  const units = PROJECT.seedUnits || [];
  const state = { units: units };
  const bd = RULES.breakdown(state, PROJECT, ELEV);

  console.log('\n=== ' + t.label + ' — ' + units.length + ' seed units, '
              + Object.keys(ELEV).length + ' elevations');
  bd.forEach(b => console.log('    ' + b.scope.padEnd(34)
    + String(b.qtyDone).padStart(6) + ' / ' + String(b.qtyTotal).padEnd(8) + (b.unit || '')));
  console.log('    project percentage: ' + RULES.pct(bd) + '%');

  ck(t.label + ': nothing falls through to "Other"', !bd.some(b => /Other/.test(b.scope)));
  ck(t.label + ': done never exceeds total', bd.every(b => b.qtyDone <= b.qtyTotal));
  ck(t.label + ': caulking / beauty cap stay off the boss screen',
     !bd.some(b => /caulk|beauty|face ?cover/i.test(b.scope)), bd.map(b => b.scope).join(' | '));

  /* ── the drift guard ── */
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const classifiers = slice(app, /const _DOOR_PATTERNS =/,
    "return isInterior(u) ? 'interior' : 'exterior';   // inferred default, never written to state\n}",
    'isDoor/isInterior/doorTypeOf');
  vm.runInContext('const PROJECT = window.PROJECT || globalThis.PROJECT;\n' + classifiers, ctx);
  let disagree = [];
  for (const u of units) {
    const a = { d: vm.runInContext('isDoor(' + JSON.stringify(u) + ')', ctx),
                i: vm.runInContext('isInterior(' + JSON.stringify(u) + ')', ctx),
                t: vm.runInContext('doorTypeOf(' + JSON.stringify(u) + ')', ctx) };
    const b = { d: RULES.isDoor(u, PROJECT), i: RULES.isInterior(u, PROJECT), t: RULES.doorTypeOf(u, PROJECT) };
    if (a.d !== b.d || a.i !== b.i || a.t !== b.t)
      disagree.push(u.id + ' app=' + JSON.stringify(a) + ' hub=' + JSON.stringify(b));
  }
  ck(t.label + ": the hub's classifiers agree with app.js on all " + units.length + ' units',
     disagree.length === 0, disagree.slice(0, 3).join(' ; '));

  for (const [scope, total] of Object.entries(t.expect || {})) {
    const got = bd.find(b => b.scope === scope);
    ck(t.label + ': ' + scope + ' = ' + total, !!got && got.total === total, got ? got.total : 'missing');
  }
  for (const [scope, unit, qty] of (t.qty || [])) {
    const got = bd.find(b => b.scope === scope);
    ck(t.label + ': ' + scope + ' = ' + qty + ' ' + unit,
       !!got && got.unit === unit && Math.abs(got.qtyTotal - qty) < 0.6, got && (got.qtyTotal + ' ' + got.unit));
  }
  if (t.label === 'Lexington')
    ck('Lexington: shower doors are NOT filed under a Door scope',
       !bd.some(b => /^Door/.test(b.scope)), bd.map(b => b.scope).join(' | '));

  /* AC3 is the only project whose glass and metal panel are counted per element. */
  if (t.label === 'AC3') {
    ck('AC3: glass is broken out per elevation element',
       bd.some(b => /— Glass$/.test(b.scope)), bd.map(b => b.scope).join(' | '));
    ck('AC3: metal panel appears', bd.some(b => /Metal Panel$/.test(b.scope)));
    ck('AC3: an elevation shared by several units is counted once',
       (bd.find(b => /— Glass$/.test(b.scope)) || {}).qtyTotal <= 279,
       (bd.find(b => /— Glass$/.test(b.scope)) || {}).qtyTotal);
  }
}

console.log('');
if (!ran) { console.log('nothing to test — no trackers under ' + ROOT); process.exit(0); }
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
