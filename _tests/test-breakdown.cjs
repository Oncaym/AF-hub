/* Per-scope breakdown — runs the reporter's real scopeOf/breakdownOf over each
   tracker's real seed units, using that tracker's own classifiers lifted verbatim
   out of its app.js. Nothing is reimplemented here; a copy would drift.

   Usage:  node _tests/test-breakdown.cjs [path-to-folder-holding-the-trackers]
   Default search root is the parent of af-hub. Trackers that are not on this
   machine are skipped, not failed.  */
const fs = require('fs'), vm = require('vm'), path = require('path');

const ROOT = process.argv[2] || path.resolve(__dirname, '..', '..');
const HUB  = fs.readFileSync(path.resolve(__dirname, '..', 'hub-report.js'), 'utf8');

function slice(src, startRe, endMark, what) {
  const i = src.search(startRe);
  if (i < 0) throw new Error('could not find the start of ' + what + ' — has it been renamed?');
  const j = src.indexOf(endMark, i);
  if (j < 0) throw new Error('could not find the end of ' + what);
  return src.slice(i, j + endMark.length);
}
const REPORTER = slice(HUB, /function scopeOf\(u\) \{/,
  'return out.slice(0, 12);            // a boss screen, not a report\n  }', 'scopeOf/breakdownOf');

/* Expected splits come from each tracker's own CLAUDE.md, not from this code. */
const TRACKERS = [
  { label: 'AC3',       dirs: ['AC3 tracker'], expect: {} },
  { label: 'CP2',       dirs: ['cp2-tracker-deploy', 'CP2 Installation Tracking/cp2-tracker-deploy'],
    expect: {} },
  { label: 'Lexington', dirs: ['355-lexington-tracker', 'Lexington/355-lexington-tracker'],
    expect: { 'Shower Door': 159, 'Terrace Divider': 33, 'Guardrail': 8, 'Equipment Screen': 2 } },
];

let fails = 0, ran = 0;
const ck = (n, c, x) => { if (!c) fails++; console.log((c ? 'PASS  ' : 'FAIL  ') + n + (x !== undefined ? '   [' + x + ']' : '')); };

for (const t of TRACKERS) {
  const root = t.dirs.map(d => path.join(ROOT, d)).find(p => fs.existsSync(path.join(p, 'project-config.js')));
  if (!root) { console.log('SKIP  ' + t.label + ' — not on this machine'); continue; }
  ran++;

  const cfg = fs.readFileSync(path.join(root, 'project-config.js'), 'utf8');
  const app = fs.readFileSync(path.join(root, 'app.js'), 'utf8');
  const classifiers = slice(app, /const _DOOR_PATTERNS =/,
    "return isInterior(u) ? 'interior' : 'exterior';   // inferred default, never written to state\n}",
    'isDoor/isInterior/doorTypeOf');

  const ctx = { console, window: {} };
  ctx.window.window = ctx.window;
  vm.createContext(ctx);
  vm.runInContext(cfg, ctx);
  const PROJECT = ctx.window.PROJECT || ctx.PROJECT;
  vm.runInContext('const PROJECT = window.PROJECT || globalThis.PROJECT;\n' + classifiers, ctx);
  vm.runInContext("function isDone(u){ return u && u.status === 'installed'; }\n" + REPORTER, ctx);

  const units = PROJECT.seedUnits || [];
  const bd = vm.runInContext('breakdownOf(' + JSON.stringify(units) + ')', ctx);

  console.log('\n=== ' + t.label + ' — ' + units.length + ' seed units');
  bd.forEach(b => console.log('    ' + b.scope.padEnd(24) + String(b.done).padStart(4) + ' / ' + b.total));

  const sum = bd.reduce((a, b) => a + b.total, 0);
  ck(t.label + ': every unit lands in exactly one scope', sum === units.length, sum + ' vs ' + units.length);
  ck(t.label + ': nothing falls through to "Other"', !bd.some(b => b.scope === 'Other'));
  ck(t.label + ': done never exceeds total', bd.every(b => b.done <= b.total));
  ck(t.label + ': scopes are sorted biggest first',
     bd.every((b, i) => i === 0 || bd[i - 1].total >= b.total));

  for (const [scope, total] of Object.entries(t.expect)) {
    const got = bd.find(b => b.scope === scope);
    ck(t.label + ': ' + scope + ' = ' + total, !!got && got.total === total, got ? got.total : 'missing');
  }
  /* The trap this test exists for: isDoor() matches ANY type containing "door", so
     Lexington's 159 shower doors used to be reported as exterior doors. */
  if (t.label === 'Lexington')
    ck('Lexington: shower doors are NOT filed under a Door scope',
       !bd.some(b => /^Door/.test(b.scope)), bd.map(b => b.scope).join(' | '));
}

console.log('');
if (!ran) { console.log('nothing to test — no trackers found under ' + ROOT); process.exit(0); }
console.log(fails ? fails + ' FAILED' : 'all passed');
process.exit(fails ? 1 : 0);
