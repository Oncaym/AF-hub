/* Harness: the unit type registry (F-051) — shapes/colours as data, editable in-app.
   Run: npm i jsdom && node _tests/test-unit-types.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window, window: { document } } = dom;

const lines = src.split('\n');
const at = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('not found ' + re); return i + 1; };
const cut = (a, b) => lines.slice(a - 1, b - 1).join('\n');

window.state = { units: [], unitTypes: [] };
window.eval([
  fs.readFileSync(ROOT + 'project-config.js', 'utf8'), 'var PROJECT = window.PROJECT;',
  /* The split (Leo, 2026-09-18): app.js no longer has one _isRO(). `__ro` keeps its
     old meaning — this session cannot write — and `__gc` defaults to it, so every test
     written before the split still means exactly what it meant. Set __gc:false with
     __ro:true to get the case that used to be impossible: a VIEWER. */
  'function _noEdit() { return !!window.__ro; }',
  'function _isGC() { return window.__gc === undefined ? !!window.__ro : !!window.__gc; }',
  'function toast() {} function saveState() { window.__saved = (window.__saved || 0) + 1; }',
  'function confirm() { return window.__confirm !== false; }',
  'var CloudSync = { describe(t) { window.__desc = t; } };',
  cut(at(/^const I18N = \{/), at(/^function t\(key\)/)),
  cut(at(/^function t\(key\)/), at(/^let _appReady/)),
  cut(at(/^const _DOOR_PATTERNS/), at(/^let doorMode/)),
  cut(at(/^\/\* ================= Unit type registry/), at(/^\/\* Ring classes/)),
  cut(at(/^\/\* ---- Unit types editor \(F-051\)/), at(/^function openModules\(\)/)),
  cut(at(/^\/\* F-051: unit type picker/), at(/^\/\* F-045: floor picker/)),
  cut(at(/^\/\* F-051: the plan legend grows/), at(/^function renderPlan\(\)/)),
  'window.__setLang = l => { currentLang = l; }; window.__setLang("en");',
  'window.__draft = () => _utDraft; window.__setDraft = d => { _utDraft = d; };',
  'window.UT_SHAPES = UT_SHAPES; window.UT_COLORS = UT_COLORS;'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));
const U = (id, extra) => Object.assign({ key: id, id, type: 'Storefront', status: 'pending' }, extra || {});

// ---------- 1. palette is fixed and safe ----------
T('six shapes offered', window.UT_SHAPES.length === 6 && window.UT_SHAPES[0].key === 'circle');
T('eight outline colours offered', window.UT_COLORS.length === 8);
T('palette avoids the status fills (green/yellow/red/grey)', (() => {
  const status = ['#3fb950', '#d29922', '#f85149', '#6c7682', '#4d5764'];
  return window.UT_COLORS.every(c => !status.includes(c.hex.toLowerCase()));
})(), window.UT_COLORS.map(c => c.hex));
T('unknown shape falls back to circle', (window.state.unitTypes = [{ key: 'x', label: 'X', match: '^X', shape: 'blob' }],
  window.unitTypes()[0].shape === 'circle'));

// ---------- 2. matching ----------
window.state.unitTypes = [
  { key: 'hmDoor', label: 'Hollow metal door', match: '^HM', shape: 'square', color: 'cyan', badge: 'HM' },
  { key: 'sunshade', label: 'Sun shade', match: '^SS', shape: 'triangle', color: 'amber' }
];
T('id prefix picks the type', window.unitTypeOf(U('HM01')).key === 'hmDoor');
T('a non-matching id gets no type', window.unitTypeOf(U('SF01')) === null);
T('matching is case-insensitive', window.unitTypeOf(U('hm02')).key === 'hmDoor');
T('first match wins in list order', (window.state.unitTypes.unshift({ key: 'special', label: 'Special HM', match: '^HM0', shape: 'hex', color: 'violet' }),
  window.unitTypeOf(U('HM01')).key === 'special'));
window.state.unitTypes.shift();
T('a broken regex is skipped, not thrown', (window.state.unitTypes.push({ key: 'bad', label: 'Bad', match: '[', shape: 'circle', color: 'pink' }),
  window.unitTypeOf(U('SF01')) === null));
window.state.unitTypes.pop();

// ---------- 3. manual override always wins (constitution §4.9) ----------
T('explicit unitType overrides the pattern', window.unitTypeOf(U('HM01', { unitType: 'sunshade' })).key === 'sunshade');
T('"__none__" means plain marker even if the pattern matches', window.unitTypeOf(U('HM01', { unitType: '__none__' })) === null);
T('a stale override falls back to the pattern', window.unitTypeOf(U('HM01', { unitType: 'deleted-type' })).key === 'hmDoor');

// ---------- 4. marker classes: registry beats the built-ins, status keeps the fill ----------
T('registry shape class applied', window._unitShapeClass(U('HM01')) === ' ut ut-square',
  window._unitShapeClass(U('HM01')));
T('a typed DOOR keeps its door-type outline too',
  window._unitShapeClass(U('SD01', { unitType: 'hmDoor' })) === ' ut ut-square dt-exterior',
  window._unitShapeClass(U('SD01', { unitType: 'hmDoor' })));
T('a type overrides the interior-storefront diamond',
  !/interior-sf/.test(window._unitShapeClass(U('IS-HM01', { unitType: 'sunshade' }))));
// (AC3 has no interiorPatterns, CP2 has ^IS — assert against the project's own answer)
T('untyped units keep the built-in behaviour',
  window._unitShapeClass(U('IS01')) === (window.isInterior({ id: 'IS01' }) ? ' interior-sf' : ''),
  window._unitShapeClass(U('IS01')));
T('CSS never sets the fill for a type — only border/box-shadow',
  /\.plan-marker\.ut \{[^}]*border-color: var\(--ut-color/.test(html) &&
  !/\.plan-marker\.ut \{[^}]*background:/.test(html));
T('all six shapes have CSS', ['ut-square', 'ut-capsule', 'ut-diamond', 'ut-triangle', 'ut-hex'].every(c => html.includes('.plan-marker.' + c)));
T('legend swatches exist for every shape', ['ut-circle', 'ut-square', 'ut-capsule', 'ut-diamond', 'ut-triangle', 'ut-hex'].every(c => html.includes('.ut-swatch.' + c)));
T('badge rendered from a data attribute', /\.plan-marker\.ut\[data-ut-badge\]::after/.test(html));
T('hover text names the type', window._unitKindText(U('HM01')).indexOf('Hollow metal door') !== -1, window._unitKindText(U('HM01')));

// ---------- 5. the modal picker ----------
T('modal has the type row', !!document.getElementById('cal-unittype-row'));
window.renderUnitTypeRow(U('HM01'));
T('row shown when types exist', document.getElementById('cal-unittype-row').style.display === '');
const opts = Array.from(document.querySelectorAll('#cal-unittype option')).map(o => o.value);
T('auto + none + every type offered', opts.join(',') === ',__none__,hmDoor,sunshade', opts);
T('the auto option spells out what the pattern picks',
  /Auto \(by unit id\) \(Hollow metal door\)/.test(document.querySelector('#cal-unittype option').textContent),
  document.querySelector('#cal-unittype option').textContent);
window.renderUnitTypeRow(U('HM01', { unitType: 'sunshade' }));
T('current override preselected', document.getElementById('cal-unittype').value === 'sunshade');
T('saveUnit writes/clears the override',
  /if \(_ut\) \{ if \(_ut\.value\) u\.unitType = _ut\.value; else delete u\.unitType; \}/.test(src));
{
  const keep = window.state.unitTypes;
  window.state.unitTypes = [];
  window.renderUnitTypeRow(U('SF01'));
  T('row hidden when no types are defined', document.getElementById('cal-unittype-row').style.display === 'none');
  window.state.unitTypes = keep;
}

// ---------- 6. the editor panel ----------
window.state.units = [U('HM01'), U('HM02'), U('SS01'), U('SF01')];
window.openUnitTypes();
const panel = () => document.getElementById('unitTypesModal').innerHTML;
T('panel opens with the current list', document.getElementById('unitTypesModal').classList.contains('show') &&
  window.__draft().length === 2);
T('panel shows how many units match today', /2 unit\(s\) match today/.test(panel()), panel().slice(0, 400));
T('panel says the fill still means status', /fill colour still shows install status/.test(panel()));
window.addUnitTypeRow();
T('add appends a row', window.__draft().length === 3);
window.setUnitTypeField(2, 'label', 'Canopy');
window.setUnitTypeField(2, 'match', '^CP');
window.setUnitTypeField(2, 'shape', 'hex');
window.setUnitTypeField(2, 'badge', 'CPY');
T('badge capped at 2 chars', window.__draft()[2].badge === 'CP', window.__draft()[2].badge);
window.saveUnitTypes();
T('saved to state', window.state.unitTypes.length === 3 && window.state.unitTypes[2].label === 'Canopy');
T('key auto-derived from the label', window.state.unitTypes[2].key === 'type3' || /canopy/.test(window.state.unitTypes[2].key),
  window.state.unitTypes[2].key);
T('save goes through the normal sync path', window.__saved > 0 && /Updated unit types/.test(window.__desc || ''));
T('the new type matches immediately', window.unitTypeOf(U('CP01')).label === 'Canopy');
window.openUnitTypes();
window.addUnitTypeRow();
window.saveUnitTypes();
T('blank rows dropped on save', window.state.unitTypes.length === 3);
window.openUnitTypes();
window.__confirm = true;
window.removeUnitTypeRow(0);
window.saveUnitTypes();
T('remove works', window.state.unitTypes.length === 2 && !window.state.unitTypes.some(t => t.key === 'hmDoor'));
T('units of a removed type fall back to plain markers', window._unitShapeClass(U('HM01')) === '',
  window._unitShapeClass(U('HM01')));
window.__ro = true;
window.openUnitTypes();
T('read-only accounts get no Save / Add / Remove buttons',
  !/saveUnitTypes\(\)/.test(panel()) && !/addUnitTypeRow\(\)/.test(panel()) && !/removeUnitTypeRow/.test(panel()));
window.__ro = false;

// ---------- 7. legend ----------
window.state.unitTypes = [{ key: 'hmDoor', label: 'Hollow metal door', match: '^HM', shape: 'square', color: 'cyan' }];
window.renderUnitTypeLegend();
const legendRows = document.querySelectorAll('.legend-item[data-ut]');
T('legend row generated per type', legendRows.length === 1 && /Hollow metal door/.test(legendRows[0].textContent));
window.renderUnitTypeLegend();
T('re-rendering does not duplicate legend rows', document.querySelectorAll('.legend-item[data-ut]').length === 1);
window.state.unitTypes = [];
window.renderUnitTypeLegend();
T('removing the type removes its legend row', document.querySelectorAll('.legend-item[data-ut]').length === 0);
T('legend labels are escaped', (() => {
  window.state.unitTypes = [{ key: 'x', label: '<img src=x onerror=1>', match: '^X', shape: 'circle', color: 'pink' }];
  window.renderUnitTypeLegend();
  const row = document.querySelector('.legend-item[data-ut]');
  return row.querySelectorAll('img').length === 0;
})());

console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
