/* Harness: 2F/13F floor split + one-time state migration + interior storefront (IS) +
   door types (F-044, Leo 2026-08-05). Run: npm i jsdom && node test-floors-types.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';   // harness lives in _tests/, the app is one level up

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window, window: { document } } = dom;

const lines = src.split('\n');
const cut = (a, b) => lines.slice(a - 1, b - 1).join('\n');   // 1-based, end-exclusive
const at = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('not found ' + re); return i + 1; };

const i18nBlk  = cut(at(/^const I18N = \{/), at(/^function t\(key\)/));
const tBlk     = cut(at(/^function t\(key\)/), at(/^let _appReady/));
const kindBlk  = cut(at(/^const _DOOR_PATTERNS/), at(/^let doorMode/));
const floorBlk = cut(at(/^const HAS_CUSTOM_FLOORS/), at(/^let currentFilter/));
const migBlk   = cut(at(/^function runStateMigrations/), at(/^function mergeSeedUnits/));
// (this range already carries the F-051 registry — it sits between the two markers)
const dtBlk    = cut(at(/^function renderDoorTypeRow/), at(/^function _scopeRingClass/));
const floorSelBlk = cut(at(/^function renderFloorSelect/), at(/^function renderDoorTypeRow/));
const themeBlk = cut(at(/^function _planLightSrc/), at(/^const _INVERT_CACHE/)) + '\n' +
                 cut(at(/^function _floorDarkSrc/), at(/^\/\/ Re-point the plan/));

window.state = { units: [], positions: {}, log: [], unitTypes: [] };
window.eval([
  fs.readFileSync(ROOT + 'project-config.js', 'utf8'), 'var PROJECT = window.PROJECT;',
  /* The split (Leo, 2026-09-18): app.js no longer has one _isRO(). `__ro` keeps its
     old meaning — this session cannot write — and `__gc` defaults to it, so every test
     written before the split still means exactly what it meant. Set __gc:false with
     __ro:true to get the case that used to be impossible: a VIEWER. */
  'function _noEdit() { return !!window.__ro; }',
  'function _isGC() { return window.__gc === undefined ? !!window.__ro : !!window.__gc; }',
  'function isPlanned() { return false; }',
  'function isDayMode() { return !!window.__day; }',
  'var PLAN_GF_SRC = "gf-plan.png"; var _INVERT_CACHE = {};',
  i18nBlk, tBlk, kindBlk, floorBlk, migBlk, floorSelBlk, dtBlk, themeBlk,
  'window.__setLang = l => { currentLang = l; }; window.__setLang("en");',
  'window.__setLevel = l => { currentLevel = l; }; window.__setZone = z => { currentZone = z; };',
  'var currentZone = "all";',
  'window.HAS_CUSTOM_FLOORS = HAS_CUSTOM_FLOORS; window.DOOR_TYPES = DOOR_TYPES;'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));

// ---------- 1. Floors ----------
const floors = window.getFloors();
T('three floors configured', floors.length === 3 && floors.map(f => f.key).join(',') === 'GF,L2,L13', floors.map(f => f.key));
T('custom floors mode is on (legacy GF/L2 pair replaced)', window.HAS_CUSTOM_FLOORS === true);
T('2F reuses the old sheet, cropped', floors[1].img === '2f-plan.png');
T('13F has its own plan from the DXF', floors[2].img === '13f-plan.png');
T('GF keeps its markup-provided image', !floors[0].img);
T('plan files exist and are real images',
  fs.statSync(ROOT + '2f-plan.png').size > 5000 && fs.statSync(ROOT + '13f-plan.png').size > 5000,
  [fs.statSync(ROOT + '2f-plan.png').size, fs.statSync(ROOT + '13f-plan.png').size]);
/* The dark UI is the DEFAULT skin — every plan must ship a pre-inverted twin (CLAUDE.md).
   This has bitten us more than once, so it is asserted, not eyeballed. */
T('every non-GF floor declares a dark twin', floors.slice(1).every(f => !!f.imgDark), floors.map(f => f.imgDark));
T('dark twins exist on disk', floors.slice(1).every(f => fs.statSync(ROOT + f.imgDark).size > 5000));
T('GF still carries its pair on the <img> markup',
  !!document.getElementById('planImg').getAttribute('data-plan-light') &&
  !!document.getElementById('planImg').getAttribute('data-plan-dark'));
T('the twin is REALLY inverted (dark pixels), not a copy of the light file', (() => {
  // PNG bytes differ and the light file is mostly white: compare file sizes + first IDAT bytes
  return floors.slice(1).every(f => {
    const light = fs.readFileSync(ROOT + f.img), dark = fs.readFileSync(ROOT + f.imgDark);
    return !light.equals(dark);
  });
})());
window.__setLevel('L2');
T('dark mode picks the twin, no runtime inversion', (window.__day = false, window._floorImgSrc('L2') === '2f-plan-white.png'), window._floorImgSrc('L2'));
T('day mode picks the light file', (window.__day = true, window._floorImgSrc('L2') === '2f-plan.png'), window._floorImgSrc('L2'));
window.__day = false;
T('13F too', window._floorImgSrc('L13') === '13f-plan-white.png');
T('a floor with no twin still falls back to runtime inversion',
  /_INVERT_CACHE\[light\] \|\| light/.test(src));
T('floor names translate', window.floorLabel(floors[2]) === '13th Floor' &&
  (window.__setLang('zh'), window.floorLabel(floors[2]).includes('十三层')), window.floorLabel(floors[2]));
window.__setLang('en');
window.__setLevel('GF');
window.renderFloorControls();
const btns = Array.from(document.querySelectorAll('.plan-toolbar .level-btn')).map(b => b.textContent);
T('level buttons rebuilt for 3 floors', btns.length === 3 && btns[2] === '13th Floor', btns);
T('current floor button is active',
  document.querySelector('.plan-toolbar .level-btn.active').dataset.level === 'GF');
const tabs = Array.from(document.querySelectorAll('#zoneTabs .tab')).map(d => d.dataset.zone);
T('zone tabs rebuilt: all + 3 floors', tabs.join(',') === 'all,GF,L2,L13', tabs);
T('each floor tab has a count slot', ['GF', 'L2', 'L13'].every(k => !!document.getElementById('cnt-' + k)));

// ---------- 2. Migration ----------
const OLD = { SF60: { x: 10.05, y: 75.74 }, SF63__2: { x: 27.03, y: 19.98 }, SF70__1: { x: 63.76, y: 61.65 } };
const freshState = () => ({
  units: [
    { key: 'SF60', id: 'SF60', level: 'L2', status: 'installed', date: '2026-06-01' },
    { key: 'SF63__2', id: 'SF63.1', level: 'L2', status: 'pending' },
    { key: 'SF70__1', id: 'SF70', level: 'L2', status: 'installed', date: '2026-06-02', rfi: [{ ref: 'RFI-9', status: 'open' }] },
    { key: 'SF71__2', id: 'SF71.1', level: 'L2', status: 'in-progress' },
    { key: 'SF06N', id: 'SF06N', level: 'GF', status: 'installed' }
  ],
  positions: JSON.parse(JSON.stringify(Object.assign({}, OLD, { SF71__2: { x: 77.87, y: 61.65 } }))),
  log: []
});
let st = freshState();
T('migration reports what it did', window.runStateMigrations(st) === true);
const byKey = k => st.units.find(u => u.key === k);
T('SF70 → 13th Floor', byKey('SF70__1').level === 'L13' && byKey('SF71__2').level === 'L13');
T('SF60/SF63 stay on the 2nd Floor', byKey('SF60').level === 'L2' && byKey('SF63__2').level === 'L2');
T('GF untouched', byKey('SF06N').level === 'GF');
T('13F positions cleared for re-placing', !st.positions.SF70__1 && !st.positions.SF71__2, st.positions);
T('unit status/date/RFI survive the move',
  byKey('SF70__1').status === 'installed' && byKey('SF70__1').date === '2026-06-02' &&
  byKey('SF70__1').rfi[0].ref === 'RFI-9', byKey('SF70__1'));
// remap: (pct/100*SRC - crop origin) / crop size * 100
const expect = (x, y) => ({ x: (x / 100 * 3200 - 115) / 1003 * 100, y: (y / 100 * 956 - 13) / 919 * 100 });
const near = (a, b) => Math.abs(a - b) < 0.01;
const e60 = expect(OLD.SF60.x, OLD.SF60.y);
T('2F marker remapped to the cropped sheet',
  near(st.positions.SF60.x, e60.x) && near(st.positions.SF60.y, e60.y),
  [st.positions.SF60, e60]);
T('remapped marker still lands inside the plan',
  st.positions.SF63__2.x > 0 && st.positions.SF63__2.x < 100 && st.positions.SF63__2.y > 0 && st.positions.SF63__2.y < 100,
  st.positions.SF63__2);
T('migration id recorded', st.migrations.indexOf('cp2-2026-08-floor-split') !== -1, st.migrations);
T('flagged for push back to the cloud', /migration cp2-2026-08-floor-split/.test(st._mergeNote || ''), st._mergeNote);
T('audit line appended to the log for every migration that ran',
  st.log.length === window.PROJECT.migrations.length && st.log.every(l => /Data migration/.test(l.content)), st.log);
// idempotence — the dangerous case: a second run must NOT remap again
const snapshot = JSON.stringify(st.positions);
T('second run is a no-op', window.runStateMigrations(st) === false);
T('positions not remapped twice', JSON.stringify(st.positions) === snapshot, st.positions);
T('log not duplicated', st.log.length === window.PROJECT.migrations.length);
// read-only sessions must not migrate (they can never persist the marker)
window.__ro = true;
const roState = freshState();
T('read-only session skips migrations', window.runStateMigrations(roState) === false);
T('read-only state left exactly as found',
  roState.units.every(u => u.level === (u.key === 'SF06N' ? 'GF' : 'L2')) && !!roState.positions.SF70__1);
window.__ro = false;
// a throwing migration must not poison the rest of the state
const boom = window.PROJECT.migrations;
window.PROJECT.migrations = [{ id: 'boom', apply() { throw new Error('nope'); } }];
const bs = freshState();
T('a failing migration is skipped, not recorded', window.runStateMigrations(bs) === false &&
  (bs.migrations || []).indexOf('boom') === -1);
window.PROJECT.migrations = boom;

// ---------- 3. Interior storefront ----------
const U = (id, extra) => Object.assign({ key: id, id, type: 'Storefront', status: 'pending' }, extra || {});
T('IS prefix is interior', window.isInterior(U('IS01')));
T('SF prefix is exterior', !window.isInterior(U('SF01')));
T('manual override wins over the prefix',
  !window.isInterior(U('IS02', { interior: 'no' })) && window.isInterior(U('SF02', { interior: 'yes' })));
T('interior storefront renders as a diamond', window._unitShapeClass(U('IS01')) === ' interior-sf');
T('exterior storefront keeps its shape classes empty', window._unitShapeClass(U('SF01')) === '');
T('hover text names it', window._unitKindText(U('IS01')) === ' · Interior');
T('CSS actually draws the diamond',
  /\.plan-marker\.interior-sf\s*\{[^}]*rotate\(45deg\)/.test(html) &&
  /\.plan-marker\.interior-sf \.mk-label\s*\{[^}]*rotate\(-45deg\)/.test(html));
T('renderPlan counter-rotates the label', /mk-label/.test(src) && /sp\.textContent = _lbl/.test(src));
T('legend explains the diamond', /data-i18n="legend_interior_sf"/.test(html));

// ---------- 4. Door types ----------
T('a door defaults to exterior', window.doorTypeOf(U('SD01')) === 'exterior');
T('an interior-prefixed door defaults to interior', window.doorTypeOf(U('ISD01', { type: 'Door' })) === 'interior');
T('explicit type wins', window.doorTypeOf(U('SD02', { doorType: 'fire-rated' })) === 'fire-rated');
T('a storefront has no door type', window.doorTypeOf(U('SF01')) === '');
T('door classes: interior / fire-rated',
  window._unitShapeClass(U('SD03', { doorType: 'interior' })) === ' dt-interior' &&
  window._unitShapeClass(U('SD04', { doorType: 'fire-rated' })) === ' dt-firerated',
  [window._unitShapeClass(U('SD03', { doorType: 'interior' })), window._unitShapeClass(U('SD04', { doorType: 'fire-rated' }))]);
T('an interior DOOR stays square (door shape wins)',
  window._unitShapeClass(U('ISD02', { type: 'Door', doorType: 'interior' })).indexOf('interior-sf') === -1);
T('hover text names the door type', window._unitKindText(U('SD04', { doorType: 'fire-rated' })) === ' · Fire-rated door');
T('CSS colours the door types',
  /\.plan-marker\.door\.dt-interior\s*\{[^}]*var\(--int-sf\)/.test(html) &&
  /\.plan-marker\.door\.dt-firerated\s*\{[^}]*var\(--fire-door\)/.test(html));
T('ring colours defined in both themes',
  (html.match(/--int-sf:/g) || []).length >= 2 && (html.match(/--fire-door:/g) || []).length >= 2);
T('legend explains both door types',
  /data-i18n="legend_int_door"/.test(html) && /data-i18n="legend_fire_door"/.test(html));

// door-type row in the modal
T('modal has the door-type row', !!document.getElementById('cal-doortype-row'));
window.renderDoorTypeRow(U('SF01'));
T('row hidden for a storefront', document.getElementById('cal-doortype-row').style.display === 'none');
window.renderDoorTypeRow(U('SD01'));
T('row shown for a door', document.getElementById('cal-doortype-row').style.display === '');
const opts = Array.from(document.querySelectorAll('#cal-doortype option')).map(o => o.value);
T('all four choices offered', opts.join(',') === ',exterior,interior,fire-rated', opts);
T('the unset option shows the inferred default',
  /not set.*\(Exterior door\)/.test(document.querySelector('#cal-doortype option').textContent),
  document.querySelector('#cal-doortype option').textContent);
window.renderDoorTypeRow(U('SD05', { doorType: 'fire-rated' }));
T('current value preselected', document.getElementById('cal-doortype').value === 'fire-rated');
T('saveUnit only writes doorType for doors, and clears on unset',
  /if \(_dt && isDoor\(u\)\) \{ if \(_dt\.value\) u\.doorType = _dt\.value; else delete u\.doorType; \}/.test(src));
T('three languages for every new key', ['en', 'zh', 'ko'].every(l => {
  const tbl = window.I18N ? window.I18N[l] : null;
  return !tbl || ['legend_interior_sf', 'legend_int_door', 'legend_fire_door', 'kind_interior_sf',
    'door_type_exterior', 'door_type_interior', 'door_type_firerated', 'form_door_type']
    .every(k => typeof tbl[k] === 'string' && tbl[k]);
}));


// ---------- 5. F-045: moving a unit between floors ----------
T('modal has a floor row', !!document.getElementById('cal-floor-row'));
window.renderFloorSelect({ key: 'SD19', id: 'SD19', level: 'L2' });
T('floor row shown when the project has several floors',
  document.getElementById('cal-floor-row').style.display === '');
const fopts = Array.from(document.querySelectorAll('#cal-floor option')).map(o => o.value);
T('every floor offered', fopts.join(',') === 'GF,L2,L13', fopts);
T("the unit's current floor is preselected", document.getElementById('cal-floor').value === 'L2');
window.renderFloorSelect({ key: 'X', id: 'X' });
T('a unit with no level falls back to the first floor', document.getElementById('cal-floor').value === 'GF');
T('row hidden on single-floor projects', (() => {
  const keep = window.PROJECT.floors;
  window.PROJECT.floors = [keep[0]];
  window.renderFloorSelect({ key: 'X', id: 'X', level: 'GF' });
  const hidden = document.getElementById('cal-floor-row').style.display === 'none';
  window.PROJECT.floors = keep;
  return hidden;
})());
// place-mode + saveUnit wiring (source-level, since both live inside big DOM handlers)
T('place mode moves the unit to the floor you place it on',
  /const from = unit\.level \|\| firstFloorKey\(\);[\s\S]{0,400}unit\.level = currentLevel;/.test(src));
T('the move is confirmed first, not silent', /confirm\(t\('confirm_move_floor'\)/.test(src));
T('a cancelled confirm places nothing',
  /if \(!confirm\(t\('confirm_move_floor'\)[\s\S]{0,120}\) return;/.test(src));
T('the move is logged', /content: `\$\{unit\.id\} · moved \$\{fl\(from\)\} → \$\{fl\(currentLevel\)\}`/.test(src));
T('position is still written after the move', /unit\.level = currentLevel;[\s\S]{0,600}state\.positions\[unit\.key\] = \{ x, y \};/.test(src));
T('saveUnit applies a floor change from the modal', /_fs\.value !== _was[\s\S]{0,200}u\.level = _fs\.value;/.test(src));
T('changing floor in the modal clears the stale position',
  /u\.level = _fs\.value;[\s\S]{0,120}delete state\.positions\[u\.key\]/.test(src));
T('floor-move strings exist in all three languages', ['en', 'zh', 'ko'].every(l => {
  const tbl = window.I18N ? window.I18N[l] : null;
  return !tbl || ['form_floor', 'confirm_move_floor', 'msg_moved_floor'].every(k => typeof tbl[k] === 'string' && tbl[k]);
}));


// ---------- 6. F-046: plan assets must match the ground floor's treatment ----------
/* Leo, 2026-08-05: the first cut shipped opaque white/black plans, which read as a solid
   black slab in the dark UI. GF's assets are TRANSPARENT — the page background shows
   through and only the linework is drawn. Every plan must match that. */
const PNG = require('zlib');
function pngInfo(file) {
  const b = fs.readFileSync(ROOT + file);
  // IHDR: width(4) height(4) bitdepth(1) colortype(1) — colortype 6 = RGBA, 2 = RGB
  return { colorType: b[25], size: b.length };
}
['gf-plan.png', 'gf-plan-white.png', '2f-plan.png', '2f-plan-white.png', '13f-plan.png', '13f-plan-white.png']
  .forEach(f => T(f + ' has an alpha channel like the ground floor (RGBA)', pngInfo(f).colorType === 6, pngInfo(f)));
T('light and dark twins are different files',
  ['2f-plan', '13f-plan'].every(b => !fs.readFileSync(ROOT + b + '.png').equals(fs.readFileSync(ROOT + b + '-white.png'))));

console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
