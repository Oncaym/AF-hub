/* Harness: caulking / face-cover KPI % + plan-marker scope rings (Leo, 2026-08-03).
   Loads the real index.html into jsdom, then evals only the functions under test with the
   surrounding app.js globals stubbed — CP2's app.js can't be evaluated whole outside a browser
   (Firebase/Chart.js). Run: npm i jsdom && node test-scope-kpi.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';   // harness lives in _tests/, the app is one level up

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
// url: needed so localStorage works (the i18n block reads the saved language on load)
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://localhost/' });
const { window } = dom;
const src = fs.readFileSync(ROOT + '../core/app.js', 'utf8');

// Pull out just the pieces this feature touches.
function slice(startMarker, endMarker) {
  const a = src.indexOf(startMarker);
  const b = src.indexOf(endMarker, a + 1);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + startMarker);
  return src.slice(a, b);
}
const i18nBlock = slice('const I18N', 'function t(');           // translation tables
const tFn       = slice('function t(', '\nfunction ');           // t()
const scopeBlk  = slice('/* -------- Caulking / Face Cover progress', 'function renderKPIs()');
const ringBlk   = slice('function _scopeRingClass(u)', 'function showPlanTooltip');
const kindsBlk  = slice('function _scopeDrillRows(name)', '\nfunction openKpiDetail');

window.state = { units: [] };
window.formatStatus = s => s;
// One single eval: `let` bindings in an indirect eval live in THAT eval's own lexical scope,
// so t() and currentLang must share one call or t() can never see a language switch.
window.eval([
  fs.readFileSync(ROOT + 'project-config.js', 'utf8'), 'var PROJECT = window.PROJECT;',
  i18nBlock, tFn, scopeBlk, ringBlk, kindsBlk,
  'window.I18N = I18N; window.__setLang = l => { currentLang = l; }; window.__setLang("en");'
].join('\n'));

const ok = [], bad = [];
const T = (name, cond, extra) => (cond ? ok : bad).push(name + (cond ? '' : ' :: ' + JSON.stringify(extra)));
const unit = (id, caulk, fc) => ({
  key: id, id, type: 'Storefront', zone: 'North', status: 'installed', date: '2026-07-01',
  scopes: Object.assign({}, caulk ? { caulking: { status: caulk, date: '2026-07-02' } } : {},
                            fc ? { beautyCap: { status: fc, date: '2026-07-03' } } : {})
});

// 1. i18n keys exist in all three languages
['en', 'zh', 'ko'].forEach(l => {
  const tbl = window.I18N[l];
  T('i18n ' + l + ' has the new keys',
    ['kpi_caulk','kpi_facecover','kpi_scope_sub_dyn','kpi_scope_sub_wip','legend_caulk',
     'legend_beautycap','kpi_detail_title_caulking','kpi_detail_title_beautycap']
      .every(k => typeof tbl[k] === 'string' && tbl[k]), l);
});

// 2. Percentages
window.state.units = [
  unit('SF01', 'installed', 'installed'),
  unit('SF02', 'installed', 'in-progress'),
  unit('SF03', 'in-progress', ''),
  unit('SF04', '', ''),
];
let p = window.scopeProgress('caulking');
T('caulking pct = installed / all units', p.pct === 50 && p.done === 2 && p.wip === 1 && p.total === 4, p);
p = window.scopeProgress('beautyCap');
T('face cover pct', p.pct === 25 && p.done === 1 && p.wip === 1, p);
T('N/A + pending both count as not done', window.scopeStatusOf(window.state.units[3], 'caulking') === '');
T('empty project is 0%, never NaN', (window.state.units = [], window.scopeProgress('caulking').pct === 0));

// 3. Banner paint (real DOM ids from index.html)
window.state.units = [unit('SF01','installed','installed'), unit('SF02','in-progress',''), unit('SF03','','')];
window._paintScopeKpi('kpi-caulk', 'kpi-caulk-sub', 'caulking');
window._paintScopeKpi('kpi-beautycap', 'kpi-beautycap-sub', 'beautyCap');
const g = id => window.document.getElementById(id);
T('banner has both cards wired', !!g('kpi-caulk') && !!g('kpi-beautycap') && !!g('kpi-caulk-sub'));
T('caulking card shows a percentage', g('kpi-caulk').textContent === '33%', g('kpi-caulk').textContent);
T('caulking sub shows done/total + wip',
  g('kpi-caulk-sub').textContent === '1 / 3 units · 1 in progress', g('kpi-caulk-sub').textContent);
T('face cover card', g('kpi-beautycap').textContent === '33%', g('kpi-beautycap').textContent);
T('no "in progress" tail when there is none',
  g('kpi-beautycap-sub').textContent === '1 / 3 units', g('kpi-beautycap-sub').textContent);
window.__setLang("zh");
window._paintScopeKpi('kpi-caulk', 'kpi-caulk-sub', 'caulking');
T('sub line follows language', g('kpi-caulk-sub').textContent.includes('单元'), g('kpi-caulk-sub').textContent);
window.__setLang("en");

// 4. Marker ring classes
T('both installed → both arcs', window._scopeRingClass(unit('x','installed','installed')) === ' scope-caulk scope-fc');
T('caulking in progress → dashed modifier',
  window._scopeRingClass(unit('x','in-progress','')) === ' scope-caulk scope-caulk-wip');
T('face cover only', window._scopeRingClass(unit('x','','installed')) === ' scope-fc');
T('nothing started → no ring at all (plan stays clean)',
  window._scopeRingClass(unit('x','pending','')) === '' && window._scopeRingClass(unit('x','','')) === '' &&
  window._scopeRingClass({ id:'x' }) === '');
T('issue status draws no ring (red marker already says it)', window._scopeRingClass(unit('x','issue','')) === '');
// CSS actually defines what those classes paint
const css = html;
T('CSS paints the caulking arc', /\.plan-marker\.scope-caulk::before\s*\{[^}]*border-top-color:\s*var\(--caulk-ring\)/.test(css));
T('CSS paints the face-cover arc', /\.plan-marker\.scope-fc::before\s*\{[^}]*border-bottom-color:\s*var\(--fc-ring\)/.test(css));
T('CSS dashes the in-progress arcs',
  /scope-caulk-wip::before\s*\{[^}]*border-top-style:\s*dashed/.test(css) &&
  /scope-fc-wip::before\s*\{[^}]*border-bottom-style:\s*dashed/.test(css));
T('ring vars defined for both themes',
  (css.match(/--caulk-ring:/g) || []).length >= 2 && (css.match(/--fc-ring:/g) || []).length >= 2);
T('rings hidden in openings/issues lenses', /lens-openings \.plan-marker::before[\s\S]{0,80}display:\s*none/.test(css));
T('legend explains both rings', css.includes('legend-ring caulk') && css.includes('legend-ring fc') &&
  css.includes('data-i18n="legend_caulk"') && css.includes('data-i18n="legend_beautycap"'));
T('ring uses ::before, louver badge keeps ::after', !/plan-marker[^{]*::after[^{]*\{[^}]*--caulk-ring/.test(css));

// 5. Tooltip text
T('tooltip lists finished scopes', window._scopeTipText(unit('x','installed','installed')) === ' · Caulking ✓ · Beauty Cap ✓',
  window._scopeTipText(unit('x','installed','installed')));
T('tooltip marks in-progress with …', window._scopeTipText(unit('x','in-progress','')) === ' · Caulking …');
T('tooltip stays empty when nothing to say', window._scopeTipText(unit('x','','')) === '');

// 6. Drill-down list
window.state.units = [unit('SF01','installed',''), unit('SF02','issue',''), unit('SF03','',''), unit('SF04','in-progress','')];
const d = window._kpiUnitsForKind('caulking');
T('drill-down titled per scope', d.title === 'Caulking — Unit by Unit', d.title);
T('drill-down lists every unit', d.units.length === 4);
T('drill-down sorted: issue → wip → pending/NA → done',
  d.units.map(r => r.id).join(',') === 'SF02,SF04,SF03,SF01', d.units.map(r => r.id + ':' + r.status));
T('rows carry the SCOPE status/date, not the frame status',
  d.units[3].status === 'installed' && d.units[3].date === '2026-07-02' && window.state.units[0].status === 'installed',
  d.units[3]);
T('N/A row shown as pending, not blank', d.units[2].status === 'pending');
T('rows keep key so the row click still opens the unit', d.units.every(r => !!r.key));
T('drill-down does not mutate state.units',
  window.state.units.every(x => x.status === 'installed' && x._rank === undefined));
T('beautyCap scope wired too', window._kpiUnitsForKind('scope:beautyCap').title === 'Beauty Cap — Unit by Unit');

console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
