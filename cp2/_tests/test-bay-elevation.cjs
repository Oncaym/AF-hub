/* Harness: F-055 bay elevation panel (Leo, 2026-08-26).
   Run: npm i jsdom && node _tests/test-bay-elevation.cjs

   The point of this suite is NOT "does the SVG render". It is: does the number
   the GC reads off the panel equal the number on the shop drawing, and does an
   un-issued opening stay blank instead of quietly publishing a scaled guess.
   So the gap geometry is re-derived here from the shipped opening rectangles by
   an implementation that shares no code with tools/dxf2bay.py — if the two ever
   disagree, one of them is wrong and this fails. */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const elev = fs.readFileSync(ROOT + 'elevations.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window, window: { document } } = dom;

function slice(a1, b1) {
  const a = src.indexOf(a1), b = src.indexOf(b1, a + 1);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + a1);
  return src.slice(a, b);
}
const bayBlk = slice('function _bayGcShown(bay) {', '/* GC one-tap acknowledgment');
const hintBlk = slice('function _roDxfHint(u, r) {', '/* -------- Per-unit shop drawing');
const sheetBlk = slice('function openOpeningsSheet() {', 'function printOpenings()');
// bayBlk already runs to the ack comment, so it carries the F-056 plan keys too.
const impBlk  = slice('const _IMP_DEN = 16;', 'function _roReqOf(');

window.eval(elev);
window.state = { units: [] };
window.eval([
  /* The split (Leo, 2026-09-18): app.js no longer has one _isRO(). `__ro` keeps its
     old meaning — this session cannot write — and `__gc` defaults to it, so every test
     written before the split still means exactly what it meant. Set __gc:false with
     __ro:true to get the case that used to be impossible: a VIEWER. */
  'function _noEdit() { return !!window.__ro; }',
  'function _isGC() { return window.__gc === undefined ? !!window.__ro : !!window.__gc; }',
  'function t(k) { return { sheet_follows_short: "follows your opening" }[k] || k; }',
  'function toast() {}',
  'function saveState() { window.__saves = (window.__saves || 0) + 1; }',
  'function renderPlan() {}',
  'function openUnit(k) { window.__opened = k; }',
  'function _roReqOf(u) { return (u && u.roRequired) || { w:"", h:"", tol:"", note:"", issued:"", rev:0 }; }',
  'function _roReqEmpty(r) { return !(r && (r.w || r.h || r.tol || r.note)); }',
  'function _roFollows(u) { return !!(u && u.roBasis === "follow"); }',
  'function _openingAckedBy(id) { return (window.__acks || {})[String(id).toLowerCase()] || null; }',
  "let _opView='plan', _opBay='', _bayDoors=true;",
  // stubs for the rest of what the sheet reaches for
  'function openingsRows() { return window.__rows || []; }',
  'function getFloors() { return [{ key:"GF", name:{en:"Ground Floor"} }]; }',
  'function firstFloorKey() { return "GF"; }',
  'function floorLabel(f) { return f.name.en; }',
  'function _planSrcFor() { return "gf-plan.png"; }',
  'function _roReqDims(r) { return (r.w || "") + " x " + (r.h || ""); }',
  'function _gcTsDate() { return "08-26"; }',
  'window.PROJECT = { name: "Cooper Park 2" };',
  'function _clampMarkerPct(v) { return Math.max(-50, Math.min(150, v)); }',
  'var currentLevel = "GF", placeMode = false, dragState = null;',
  'window.__setLevel = v => { currentLevel = v; };',
  impBlk, bayBlk, hintBlk, sheetBlk,
  'window.__peekOpView = () => _opView; window.__peekOpBay = () => _opBay;'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));
const round = v => Math.round(v * 100) / 100;

/* ---------- 1. the shipped data --------------------------------------- */
const bays = window._bays();
T('elevations.js exposes exactly one bay', bays.length === 1, bays.length);
const bay = bays[0];
T('bay is the south main entry', bay.id === 'south-main-entry' && /south main entry\.dxf/i.test(bay.source), bay.source);
T('bay is 306 x 307.25 in', bay.w === 306 && bay.h === 307.25, [bay.w, bay.h]);
T('six openings imported', bay.openings.length === 6, bay.openings.length);
const names = bay.openings.map(o => o.unit).sort();
T('openings are SF46-49 + SF60/61', names.join(',') === 'SF46,SF47,SF48,SF49,SF60,SF61', names);
T('every opening carries a level', bay.openings.every(o => o.level === 'GF' || o.level === 'L2'));
T('L2 holds SF60 + SF61 only',
  bay.openings.filter(o => o.level === 'L2').map(o => o.unit).sort().join(',') === 'SF60,SF61');
T('one door, SD01, inside SF47',
  bay.doors.length === 1 && bay.doors[0].id === 'SD01' && bay.doors[0].parent === 'SF47', bay.doors);

/* ---------- 2. R.O. sizes vs what was issued to the GC by hand --------- */
/* SF46 and SF47 were issued 2026-07-31, long before this DXF was parsed. If the
   parser agrees with them to the 1/16" it is reading the drawing correctly. */
const by = id => bay.openings.find(o => o.unit === id);
T('SF46 R.O. = the issued 6\'-8" x 11\'-6"', by('SF46').dxfW === `6'-8"` && by('SF46').dxfH === `11'-6"`,
  [by('SF46').dxfW, by('SF46').dxfH]);
T('SF47 R.O. = the issued 10\'-4" x 9\'-2 1/2"', by('SF47').dxfW === `10'-4"` && by('SF47').dxfH === `9'-2 1/2"`,
  [by('SF47').dxfW, by('SF47').dxfH]);
T('SF46 raw inches are 80 x 138', by('SF46').w === 80 && by('SF46').h === 138);
T('SF47 raw inches are 124 x 110.5', by('SF47').w === 124 && by('SF47').h === 110.5);
T('no two openings overlap', (() => {
  const O = bay.openings;
  for (let i = 0; i < O.length; i++) for (let j = i + 1; j < O.length; j++) {
    const a = O[i], b = O[j];
    if (Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x) > 0.01 &&
        Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y) > 0.01) return false;
  }
  return true;
})());
T('every opening sits inside the bay',
  bay.openings.every(o => o.x >= -0.01 && o.y >= -0.01 && o.x + o.w <= bay.w + 0.01 && o.y + o.h <= bay.h + 0.01));

/* ---------- 3. the gaps, re-derived independently ---------------------- */
const derived = (() => {
  const O = bay.openings, out = {};
  const crossed = (x0, y0, x1, y1, a, b) => O.some(o => o !== a && o !== b &&
    Math.min(o.x + o.w, x1) - Math.max(o.x, x0) > 0.05 &&
    Math.min(o.y + o.h, y1) - Math.max(o.y, y0) > 0.05);
  for (let i = 0; i < O.length; i++) for (let j = i + 1; j < O.length; j++) {
    const p = O[i], q = O[j];
    const vo0 = Math.max(p.y, q.y), vo1 = Math.min(p.y + p.h, q.y + q.h);
    const ho0 = Math.max(p.x, q.x), ho1 = Math.min(p.x + p.w, q.x + q.w);
    if (vo1 - vo0 > 1) {
      const l = p.x < q.x ? p : q, r = p.x < q.x ? q : p;
      const a = l.x + l.w, b = r.x;
      if (b - a > 0.05 && !crossed(a, vo0, b, vo1, l, r)) out['h' + round(a) + ':' + round(b)] = round(b - a);
    } else if (ho1 - ho0 > 1) {
      const lo = p.y < q.y ? p : q, hi = p.y < q.y ? q : p;
      const a = lo.y + lo.h, b = hi.y;
      if (b - a > 0.05 && !crossed(ho0, a, ho1, b, lo, hi)) out['v' + round(a) + ':' + round(b)] = round(b - a);
    }
  }
  return out;
})();
const shipped = {};
bay.gaps.forEach(g => { shipped[g.axis + round(g.a) + ':' + round(g.b)] = round(g.v); });
const norm = o => Object.keys(o).sort().map(k => k + '=' + o[k]).join('|');
T('re-derived clear gaps match the shipped gaps exactly',
  norm(derived) === norm(shipped), { derived: norm(derived), shipped: norm(shipped) });
T('exactly four clear gaps', bay.gaps.length === 4, bay.gaps.map(g => g.v));
T('the four gaps are 12, 14, 20, 26 inches',
  bay.gaps.map(g => g.v).sort((a, b) => a - b).join(',') === '12,14,20,26', bay.gaps.map(g => g.v));
T('26" is the column between SF60 and SF61',
  bay.gaps.some(g => g.v === 26 && g.axis === 'h' && g.pairs.some(p => p.join() === 'SF60,SF61')));
T('14" is the spandrel between SF46 and SF60',
  bay.gaps.some(g => g.v === 14 && g.axis === 'v' && g.pairs.some(p => p.join() === 'SF46,SF60')));
T('12" is the band between SF47 and SF49',
  bay.gaps.some(g => g.v === 12 && g.axis === 'v' && g.pairs.some(p => p.join() === 'SF47,SF49')));
T('20" is the pier before SF48',
  bay.gaps.some(g => g.v === 20 && g.axis === 'h' && g.pairs.some(p => p.indexOf('SF48') >= 0)));
T('every gap carries feet-inches text', bay.gaps.every(g => /^\d+('|")/.test(g.text)), bay.gaps.map(g => g.text));
T('the sheet\'s own DIMENSION entities are recorded with the bay',
  Array.isArray(bay.drawnDims) && bay.drawnDims.length === 6, bay.drawnDims);
T('every dimension drawn on the sheet is reproduced by a gap or an overall',
  bay.drawnDims.every(v => bay.gaps.some(g => Math.abs(g.v - v) < 0.03) ||
                           [bay.w, bay.h].some(x => Math.abs(x - v) < 0.03)), bay.drawnDims);
T('and nothing is reported that the detailer did not dimension',
  bay.gaps.every(g => bay.drawnDims.some(v => Math.abs(g.v - v) < 0.03)), bay.gaps.map(g => g.v));
T('SF46|SF48 is NOT reported as a gap — SF47 stands in it',
  !bay.gaps.some(g => g.pairs.some(p => p.join() === 'SF46,SF48')));

/* ---------- 4. the panel, as the GC sees it ---------------------------- */
window.state.units = [
  { key: 'SF46', id: 'SF46', roRequired: { w: `6'-8"`, h: `11'-6"`, issued: '2026-07-31', rev: 1 } },
  { key: 'SF47', id: 'SF47', roRequired: { w: `10'-4"`, h: `9'-2 1/2"`, issued: '2026-07-31', rev: 1 } },
  { key: 'SF48', id: 'SF48' },
  { key: 'SF49', id: 'SF49' },
  { key: 'SF60', id: 'SF60', roBasis: 'follow' },
  { key: 'SF61', id: 'SF61' },
  { key: 'SD01', id: 'SD01' }
];
const parse = svg => { const d = document.createElement('div'); d.innerHTML = svg; return d; };
/* Labels are painted in one pass over the whole bay (so a later opening's own
   background cannot bury an earlier one's dimension), so they live in .bay-lbl,
   not inside .bay-op. Both carry data-unit. */
const lblOf = (d, u) => d.querySelector(`.bay-lbl[data-unit="${u}"]`);

window.state.elevGc = { 'south-main-entry': true };    // F-057: published to the GC
window.__ro = true;                                   // ---- GC ----
let d = parse(window._baySvg(bay));
const ops = Array.from(d.querySelectorAll('.bay-op'));
T('GC: six tappable opening groups', ops.length === 6, ops.length);
T('GC: each opening carries its unit id', ops.every(g => /^SF\d+$/.test(g.getAttribute('data-unit'))));
T('GC: SF46 reads as issued', d.querySelector('.bay-op[data-unit="SF46"]').getAttribute('data-state') === 'issued');
T('GC: SF48 reads as not issued', d.querySelector('.bay-op[data-unit="SF48"]').getAttribute('data-state') === 'none');
T('GC: SF60 reads as follow-our-opening', d.querySelector('.bay-op[data-unit="SF60"]').getAttribute('data-state') === 'follow');
T('GC: the issued size is printed on SF46', /6'-8" × 11'-6"/.test(lblOf(d, 'SF46').textContent));
T('GC: an un-issued opening says so instead of showing a number',
  /not issued/.test(lblOf(d, 'SF48').textContent) &&
  !/\d+'-\d/.test(lblOf(d, 'SF48').querySelector('.bay-op-dim').textContent));
T('GC: NEVER sees a dimension scaled off the drawing', d.querySelectorAll('.bay-op-dxf').length === 0);
T('GC: tapping an opening opens that unit', /openUnit\('SF46'\)/.test(d.querySelector('.bay-op[data-unit="SF46"]').getAttribute('onclick')));
T('GC: labels never swallow a tap meant for the opening', /\.bay-lbl \{ pointer-events:none/.test(html));
T('GC: labels are drawn after every opening, so none is buried',
  d.innerHTML.indexOf('bay-lbl') > d.innerHTML.lastIndexOf('class="bay-ro"'));
T('GC: openings are keyboard reachable', ops.every(g => g.getAttribute('tabindex') === '0'));
window.eval("document.body.innerHTML = ''");

T('GC: the four gap dimensions are drawn on the picture',
  [`2'-2"`, `1'-2"`, `1'-0"`, `1'-8"`].every(x => d.textContent.indexOf(x) >= 0), d.textContent.slice(0, 200));
T('GC: both overall dimensions are drawn',
  d.textContent.indexOf(`25'-6"`) >= 0 && d.textContent.indexOf(`25'-7 1/4"`) >= 0);
T('GC: the door is drawn and is separately hideable', d.querySelectorAll('.bay-door').length === 1);
T('GC: glass lites drawn for every opening', d.querySelectorAll('.bay-glass').length >= 10, d.querySelectorAll('.bay-glass').length);
T('GC: the ribbed column between the openings is drawn', d.querySelectorAll('.bay-rib line').length > 4);

window.__acks = { sf46: { by: 'gc@bb.com', ts: 1 } };
d = parse(window._baySvg(bay));
T('GC: a confirmed opening turns green', d.querySelector('.bay-op[data-unit="SF46"]').getAttribute('data-state') === 'ready');
window.__acks = {};

window.__ro = false;                                  // ---- editor ----
d = parse(window._baySvg(bay));
T('editor: sees what the drawing measures on an un-issued opening',
  /dwg 4'-8" × 11'-6"/.test(lblOf(d, 'SF48').textContent), lblOf(d, 'SF48').textContent);
T('editor: every un-issued opening gets one, including the short transom',
  ['SF48', 'SF49', 'SF60', 'SF61'].every(u => !!lblOf(d, u).querySelector('.bay-op-dxf')),
  ['SF48', 'SF49', 'SF60', 'SF61'].map(u => !!lblOf(d, u).querySelector('.bay-op-dxf')));
T('editor: no drawing-measures line where it agrees with the issued size',
  !lblOf(d, 'SF46').querySelector('.bay-op-dxf') && !lblOf(d, 'SF47').querySelector('.bay-op-dxf'));

/* ---------- 5. a unit that is not on the tracker ----------------------- */
window.state.units = window.state.units.filter(u => u.id !== 'SF49');
d = parse(window._baySvg(bay));
T('an opening with no unit is flagged, not silently blank',
  d.querySelector('.bay-op[data-unit="SF49"]').getAttribute('data-state') === 'missing');
T('an opening with no unit is not clickable',
  !d.querySelector('.bay-op[data-unit="SF49"]').getAttribute('onclick'));

/* ---------- 6. the R.O. tab suggestion --------------------------------- */
window.__ro = false;
const txt = h => { const e = document.createElement('div'); e.innerHTML = h; return e.textContent; };
const hintNone = window._roDxfHint({ id: 'SF48' }, { w: '', h: '' });
T('R.O. tab offers the drawing size when nothing is issued',
  /measures/.test(hintNone) && txt(hintNone).indexOf(`4'-8"`) >= 0, txt(hintNone));
T('the offer is a button, not an auto-fill', /_roUseDxf\('SF48'\)/.test(hintNone));
const hintSame = window._roDxfHint({ id: 'SF46' }, { w: `6'-8"`, h: `11'-6"` });
T('R.O. tab confirms a match quietly', /Matches the shop drawing/.test(hintSame));
const hintDiff = window._roDxfHint({ id: 'SF46' }, { w: `6'-9"`, h: `11'-6"` });
T('R.O. tab warns loudly when the issued size disagrees with the drawing',
  /\u26a0/.test(hintDiff) && txt(hintDiff).indexOf(`6'-8"`) >= 0 && txt(hintDiff).indexOf(`6'-9"`) >= 0,
  txt(hintDiff));
T('a unit with no opening in any bay gets no hint', window._roDxfHint({ id: 'SF12A' }, { w: '', h: '' }) === '');
window.__ro = true;
T('the GC never gets the R.O. hint', window._roDxfHint({ id: 'SF48' }, { w: '', h: '' }) === '');
window.__ro = false;

/* ---------- 7. wiring in index.html ------------------------------------ */
T('elevations.js is loaded before app.js',
  html.indexOf('elevations.js') > 0 && html.indexOf('elevations.js') < html.indexOf('src="../core/app.js'));
T('the sheet has Key plan / Elevation / Table tabs',
  /data-view="plan"/.test(src) && /data-view="elev"/.test(src) && /data-view="table"/.test(src));
T('only the active tab shows on screen', /#openingsSheet \.op-view \{ display:none/.test(html));
T('printing emits every tab, not just the active one',
  /printing-openings #openingsSheet \.op-view \{ display:block !important/.test(html));
T('the drawing-measures line is stripped from print', /printing-openings #openingsSheet \.bay-op-dxf \{ display:none/.test(html));
T('print turns the elevation to black on white', /printing-openings #openingsSheet \.bay-void \{ fill:#fff/.test(html));
T('doors hide behind one class', /\.bay-nodoors \.bay-door \{ display:none/.test(html));
T('the panel scrolls sideways on a phone rather than shrinking',
  /#openingsSheet \.bay-stage \{[^}]*overflow-x:auto/.test(html) && /min-width:520px/.test(html));
T('opening colours match the plan lens (blue issued / green ready / purple follow)',
  /data-state="issued"\]\s*\.bay-ro \{ stroke:#58a6ff/.test(html) &&
  /data-state="ready"\]\s*\.bay-ro \{ stroke:#2ea043/.test(html) &&
  /data-state="follow"\]\s*\.bay-ro \{ stroke:#a371f7/.test(html));

/* ---------- 8. the panel wrapper --------------------------------------- */
const panel = window._bayPanelHtml();
T('panel names the source drawing', /south main entry\.dxf/.test(panel));
const panelTxt = txt(panel);
T('panel lists the distances between openings in words',
  /Distance between openings/.test(panelTxt) && panelTxt.indexOf(`2'-2"`) >= 0 &&
  panelTxt.indexOf('SF60 and SF61') >= 0, panelTxt.slice(0, 300));
T('panel carries the door toggle', /toggleBayDoors\(\)/.test(panel));
T('panel says the sizes are the issued ones, not scaled off the drawing',
  /issued to the GC, not scaled/.test(panel));

/* ---------- 9. the sheet actually opens ------------------------------- */
/* _baySvg() being right is no use if the modal that hosts it throws. This is the
   thing Leo clicks, so it gets exercised end to end. */
window.__ro = true;
window.state.elevGc = { 'south-main-entry': true };
window.__rows = [{ key: 'SF46', id: 'SF46', level: 'GF', w: `6'-8"`, h: `11'-6"`, tol: '', note: '',
                   issued: '2026-07-31', rev: 1, ack: null, dwg: 0, follows: false, pos: { x: 30, y: 84 } }];
let threw = null;
try { window.openOpeningsSheet(); } catch (e) { threw = e && e.message; }
T('the openings sheet opens without throwing', threw === null, threw);
const modal = document.getElementById('openingsModal');
T('the sheet is shown', !!modal && modal.classList.contains('show'));
const tabNames = Array.from(modal.querySelectorAll('.op-tabs .btn')).map(b => b.textContent.trim());
T('three tabs render', tabNames.length === 3, tabNames);
T('the middle tab is the elevation', /Elevation/.test(tabNames[1]), tabNames);
const views = Array.from(modal.querySelectorAll('.op-view')).map(v => v.dataset.view);
T('all three views are in the DOM at once (so printing gets them all)',
  views.join(',') === 'plan,elev,table', views);
T('the key plan is the tab that opens first',
  modal.querySelector('.op-view[data-view="plan"]').classList.contains('on') &&
  !modal.querySelector('.op-view[data-view="elev"]').classList.contains('on'));
T('the elevation view really contains the bay', !!modal.querySelector('.op-view[data-view="elev"] .bay-svg'));
T('the table view still contains the openings table', !!modal.querySelector('.op-view[data-view="table"] .op-table'));
window.setOpView('elev');
T('switching to the elevation swaps which view is on',
  modal.querySelector('.op-view[data-view="elev"]').classList.contains('on') &&
  !modal.querySelector('.op-view[data-view="plan"]').classList.contains('on'));
T('the active tab is marked', modal.querySelector('.op-tabs .btn[data-view="elev"]').classList.contains('btn-primary'));
window.setOpView('plan');

// and with no elevation imported at all (AC3, every other project) the tab must vanish
const keep = window.ELEV_BAYS;
window.ELEV_BAYS = {};
threw = null;
try { window.openOpeningsSheet(); } catch (e) { threw = e && e.message; }
T('a project with no elevation still opens the sheet', threw === null, threw);
T('...with no Elevation tab', !document.querySelector('#openingsModal .op-tabs .btn[data-view="elev"]'));
T('...and no empty elevation view', !document.querySelector('#openingsModal .op-view[data-view="elev"]'));
window.ELEV_BAYS = keep;

/* ---------- 10. F-056: the elevation key on the plan -------------------- */
/* Leo's actual complaint about F-055 was "too many steps to find this elevation".
   The fix is a symbol on the plan, so what matters is: does it appear on the right
   floors, does it sit OUTSIDE the building pointing back at the facade, and does
   one tap land on the elevation. */
window.state.units = [
  { key: 'SF46', id: 'SF46', level: 'GF' }, { key: 'SF47', id: 'SF47', level: 'GF' },
  { key: 'SF48', id: 'SF48', level: 'GF' }, { key: 'SF49', id: 'SF49', level: 'GF' },
  { key: 'SD01', id: 'SD01', level: 'GF' },
  { key: 'SF60', id: 'SF60', level: 'L2' }, { key: 'SF61', id: 'SF61', level: 'L2' },
  // some elsewhere-on-the-floor units, so the building has a centre to be outside of
  { key: 'SF06N', id: 'SF06N', level: 'GF' }, { key: 'SF13A', id: 'SF13A', level: 'GF' },
  { key: 'SF62', id: 'SF62', level: 'L2' }
];
window.state.positions = {
  SF46: { x: 30.52, y: 84.53 }, SF47: { x: 36.12, y: 84.53 }, SF48: { x: 38.34, y: 84.53 },
  SF49: { x: 36.12, y: 82.40 }, SD01: { x: 36.12, y: 86.70 },
  SF60: { x: 20.60, y: 77.37 }, SF61: { x: 49.28, y: 77.37 },
  SF06N: { x: 86.07, y: 8.26 }, SF13A: { x: 92.27, y: 66.58 }, SF62: { x: 30.00, y: 40.00 }
};
const wrap = document.createElement('div');
document.body.appendChild(wrap);
// the real control the app reads for edit mode (there is no `editMode` global)
const editChk = document.createElement('input');
editChk.type = 'checkbox'; editChk.id = 'editPositionMode';
document.body.appendChild(editChk);
const drawKeys = level => {
  window.__setLevel(level);
  wrap.innerHTML = '';
  window.state.units.forEach(u => {                     // the unit markers the key rings
    if ((u.level || 'GF') !== level) return;
    const m = document.createElement('div');
    m.className = 'plan-marker'; m.dataset.unit = u.key; wrap.appendChild(m);
  });
  window.renderElevationKeys(wrap);
  return Array.from(wrap.querySelectorAll('.elev-key'));
};

let keys = drawKeys('GF');
T('the plan carries one elevation key on the ground floor', keys.length === 1, keys.length);
T('the key is numbered', keys[0].querySelector('.elev-key-dot').textContent === '1');
T('the key names the bay', /South Main Entry/.test(keys[0].querySelector('.elev-key-label').textContent));
T('the key names its openings in the tooltip so it is obvious what it covers',
  ['SF46', 'SF47', 'SF48', 'SF49', 'SD01'].every(u => keys[0].title.indexOf(u) >= 0), keys[0].title);
const gx = parseFloat(keys[0].style.left), gy = parseFloat(keys[0].style.top);
T('the key sits OUTSIDE the wall, not on top of the openings', gy > 86, [gx, gy]);
/* Measured from the bay's outermost marker, not its middle — the door SD01 sits
   2" lower than the storefronts and a centroid-based offset parked the tag on it. */
T('the key clears the LOWEST marker of the bay, not just the average',
  gy - 86.70 >= 4, [gy, 'SD01 at 86.70']);
T('the key stays over the bay horizontally', Math.abs(gx - 35.4) < 1.5, gx);
T('the key points back at the facade (up, at a south wall)',
  /rotate\(-90deg\)/.test(keys[0].querySelector('.elev-key-arrow').getAttribute('style')),
  keys[0].querySelector('.elev-key-arrow').getAttribute('style'));

keys = drawKeys('L2');
T('the same bay is keyed on the upper floor too', keys.length === 1);
T('...positioned from THAT floor\'s own units', Math.abs(parseFloat(keys[0].style.left) - 34.94) < 1.5,
  parseFloat(keys[0].style.left));

window.__setLevel('13F');
wrap.innerHTML = '';
window.renderElevationKeys(wrap);
T('no key on a floor the bay does not reach', wrap.querySelectorAll('.elev-key').length === 0);

keys = drawKeys('GF');
T('one tap opens the elevation', /openBayElevation|_opView/.test(String(keys[0].onclick)));
window._opView = 'plan';
keys[0].onclick({ stopPropagation() {} });
T('...and it lands on the Elevation tab of the right bay',
  window.__peekOpView() === 'elev' && window.__peekOpBay() === 'south-main-entry',
  [window.__peekOpView(), window.__peekOpBay()]);
/* ---- the click has to actually survive the plan's pointer handling -------------
   Two ways this tap died in the real browser that a naive harness cannot see:

   1. `editMode` is a local const inside setupPlanInteractions(), not a global. Reading
      it from the key's onmousedown threw a ReferenceError on every press, which killed
      the click. The old harness stubbed `editMode` into existence and so passed a build
      that did nothing when clicked.
   2. #planViewport calls setPointerCapture() on pointerdown so a drag pans the plan.
      Every .plan-marker stops that event to stay clickable. The key is not a
      .plan-marker, so without the same guard the capture retargeted mouseup to the
      viewport, the browser fired the click on their common ancestor, and the handler
      never ran. jsdom has no pointer capture, so this is asserted structurally. */
let pressErr = null;
T('pressing the key does not throw (no invented globals in the handler)', (() => {
  editChk.checked = false;
  try {
    keys[0].onmousedown({ preventDefault() {}, stopPropagation() {}, clientX: 0, clientY: 0 });
  } catch (e) { pressErr = e.message; return false; }
  return window.dragState == null;      // view mode: no drag started
})(), pressErr);
T('...and in edit mode it does start a drag', (() => {
  editChk.checked = true;
  try { keys[0].onmousedown({ preventDefault() {}, stopPropagation() {}, clientX: 5, clientY: 5 }); }
  catch (e) { editChk.checked = false; pressErr = e.message; return false; }
  const started = !!(window.dragState && window.dragState.id === keys[0].dataset.unit);
  window.dragState = null; editChk.checked = false;
  return started;
})());
T('the key guards the pointer the way every plan marker does', !!keys[0].onpointerdown);
T('...by stopping it reaching the viewport, which would capture the pointer', (() => {
  if (!keys[0].onpointerdown) return false;
  let stopped = false;
  keys[0].onpointerdown({ stopPropagation() { stopped = true; } });
  return stopped;
})());
T('the marker convention it is copying still exists',
  /m\.onpointerdown = \(e\) => \{[^}]*stopPropagation\(\)/.test(src));
T('#planViewport really does capture the pointer (the reason the guard is needed)',
  /vp\.setPointerCapture\(/.test(src));
T('a dragged key is stored under a reserved id that cannot collide with a unit',
  keys[0].dataset.unit === '__elev:south-main-entry:GF' &&
  !window.state.units.some(u => u.key === keys[0].dataset.unit), keys[0].dataset.unit);
window.state.positions['__elev:south-main-entry:GF'] = { x: 12, y: 34 };
keys = drawKeys('GF');
T('a moved key stays where it was put', parseFloat(keys[0].style.left) === 12 && parseFloat(keys[0].style.top) === 34);
delete window.state.positions['__elev:south-main-entry:GF'];

T('hovering the key rings the openings it covers', (() => {
  keys = drawKeys('GF');
  keys[0].dispatchEvent(new window.Event('mouseenter'));
  const lit = wrap.querySelectorAll('.plan-marker.elev-linked').length;
  keys[0].dispatchEvent(new window.Event('mouseleave'));
  return lit === 5 && wrap.querySelectorAll('.plan-marker.elev-linked').length === 0;
})());
T('the plan clears old keys before redrawing (no duplicates on re-render)',
  /elev-key'\)\.forEach\(el => el\.remove\(\)\)/.test(src));
T('renderPlan actually draws them', /renderElevationKeys\(wrap\);/.test(src));
T('the key is styled to sit above the unit markers', /\.elev-key \{[^}]*z-index: 12/.test(html));
T('the label is dropped on a phone but the circle is not', /\.elev-key-label \{ display: none; \}/.test(html));

/* the second route in: the unit card the GC already opens from a marker */
T('the GC unit card offers a way to the elevation', /See \$\{esc\(u\.id\)\} on the/.test(src));
T('...even when no size has been issued for that unit',
  src.indexOf('const elevBlock = !_eb') > 0 &&
  /No rough opening has been issued for this unit yet\.<\/div>`\)\s*\n\s*\+ elevBlock/.test(src));
T('a door reaches its parent bay too', !!window._bayOfUnit('SD01') && window._bayOfUnit('SD01').id === 'south-main-entry');
T('a unit in no bay gets no button', window._bayOfUnit('SF12A') === null);

/* ---------- 11. F-057: per-bay visibility to the GC --------------------- */
/* "Allow me to hide this elevation for GC" — so the flag has to reach EVERY surface,
   not just the tab. A hidden bay that still shows a symbol on the GC's plan, or still
   prints on their handout, is not hidden. _bays() is the single choke point; these
   assertions check each surface actually flows from it. */
window.state.elevGc = {};                              // back to the default
window.__ro = true;
T('a bay is NOT shown to the GC by default', window._bays().length === 0, window._bays().length);
T('...while editors always see it', (() => { window.__ro = false; const n = window._bays().length; window.__ro = true; return n === 1; })());
T('the GC gets no elevation key on the plan', drawKeys('GF').length === 0);
T('the GC gets no Elevation tab', (() => {
  window.openOpeningsSheet();
  return !document.querySelector('#openingsModal .op-tabs .btn[data-view="elev"]');
})());
T('the GC gets no elevation view in the sheet at all',
  !document.querySelector('#openingsModal .op-view[data-view="elev"]'));
T('the GC gets no elevation symbol on the key plan',
  !document.querySelector('#openingsModal .op-plan .elev-key'));
T('the GC gets no button on the unit card', window._bayOfUnit('SF46') === null);
T('the R.O. hint stays editor-only regardless', window._roDxfHint({ id: 'SF48' }, { w: '', h: '' }) === '');

window.__ro = false;                                   // ---- editor, still hidden ----
T('the editor still sees the bay and its key', window._bays().length === 1 && drawKeys('GF').length === 1);
T('...but the key is marked internal so the audience is obvious at a glance',
  drawKeys('GF')[0].className.indexOf('elev-key-internal') >= 0);
T('...and the panel says so in words, with a way to change it', (() => {
  const h = window._bayPanelHtml();
  return /Internal only/.test(h) && /Show to the GC/.test(h) && /toggleBayGc\('south-main-entry'\)/.test(h);
})());
T('the internal elevation is dropped from the printed GC handout',
  /printing-openings #openingsSheet \.op-view-internal \{ display:none/.test(html) &&
  /printing-openings \.elev-key-internal \{ display:none/.test(html));
T('the sheet tags the elevation view as internal so print can drop it', (() => {
  window.openOpeningsSheet();
  const v = document.querySelector('#openingsModal .op-view[data-view="elev"]');
  return !!v && v.classList.contains('op-view-internal');
})());

const savesBefore = window.__saves || 0;
window.toggleBayGc('south-main-entry');                // ---- publish it ----
T('publishing records the change so it syncs to everyone', (window.__saves || 0) > savesBefore);
T('the flag is stored per bay', window.state.elevGc['south-main-entry'] === true);
window.__ro = true;
T('now the GC sees the bay', window._bays().length === 1);
T('...gets the key on the plan', drawKeys('GF').length === 1);
T('...with no internal marking on it', drawKeys('GF')[0].className.indexOf('elev-key-internal') < 0);
T('...and gets the button on the unit card back', !!window._bayOfUnit('SF46'));
window.__ro = false;
T('the panel now reports the GC can see it', /The GC can see this elevation/.test(window._bayPanelHtml()));
T('...and offers to hide it again', /Hide from the GC/.test(window._bayPanelHtml()));
T('the view is no longer tagged internal', (() => {
  window.openOpeningsSheet();
  const v = document.querySelector('#openingsModal .op-view[data-view="elev"]');
  return !!v && !v.classList.contains('op-view-internal');
})());
window.toggleBayGc('south-main-entry');
T('hiding it again is one tap and fully reverses', window.state.elevGc['south-main-entry'] === false &&
  (() => { window.__ro = true; const n = window._bays().length; window.__ro = false; return n === 0; })());
T('a GC account cannot flip the switch itself', (() => {
  window.__ro = true;
  window.setBayGc('south-main-entry', true);
  const still = window.state.elevGc['south-main-entry'] === false;
  window.__ro = false;
  return still;
})());

console.log(ok.map(s => '  ok  ' + s).join('\n'));
if (bad.length) { console.log('\n' + bad.map(s => '  FAIL ' + s).join('\n')); }
console.log(`\n${ok.length} passed, ${bad.length} failed`);
process.exit(bad.length ? 1 : 0);
