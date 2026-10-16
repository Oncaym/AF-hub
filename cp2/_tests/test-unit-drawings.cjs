/* Harness: per-unit shop drawing / elevation upload + GC view (F-042, Leo 2026-08-03).
   Run: npm i jsdom && node test-unit-drawings.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';   // harness lives in _tests/, the app is one level up

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window } = dom;

function slice(a1, b1) {
  const a = src.indexOf(a1), b = src.indexOf(b1, a + 1);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + a1);
  return src.slice(a, b);
}
// R.O. block + the whole drawing feature + the GC card + the openings sheet.
const roBlk    = slice('function _roReqOf(u)', '/* -------- F-038: the Openings sheet');
const sheetBlk = slice('function _openingAcks()', 'function printOpenings()');
const gcBlk    = slice('function openUnitReadOnly(u)', 'function openUnit(id)');
// F-052: renderRoRequired() now offers the shop-drawing size, so it needs the bay helpers.
const bayBlk   = slice('function _bayGcShown(bay) {', '/* GC one-tap acknowledgment');

window.state = { units: [], log: [], positions: {} };
window.CAL_STATUS_LABEL = { installed: 'Installed', pending: 'Pending' };
window.eval([
  fs.readFileSync(ROOT + 'project-config.js', 'utf8'), 'var PROJECT = window.PROJECT;',
  // stubs for everything the sliced blocks reach for
  'function _eviCell(l, inner) { return "<label>" + l + "</label>" + inner; }',
  'var _EVI_IN = ""; var _IMP_DEN = 16;',
  'function _impNorm(s) { return String(s == null ? "" : s).trim(); }',
  /* Split 2026-09-18 — see the note in test-gc-view.cjs. */
  'function _noEdit() { return !!window.__ro; }',
  'function _isGC() { return window.__gc === undefined ? !!window.__ro : !!window.__gc; }',
  'function _gcItems() { return []; } function _gcItemsForUnit() { return []; }',
  'function _gcTsDate(ts) { return "8/1"; } function _gcItemReadCard() { return ""; }',
  'function _projItemByKey() { return null; } function _threadFrom() { return []; }',
  'function _threadReadHtml() { return ""; } function _daysOpen() { return 1; }',
  'function _daysOpenBadge() { return ""; } function _lens() { return window.__lens || "openings"; }',
  'function getFloors() { return [{ key: "GF", name: "Ground" }]; } function firstFloorKey() { return "GF"; }',
  'function floorLabel(f) { return f.name; } function _planSrcFor() { return "gf-plan.png"; }',
  'function _planLightSrc() { return "gf-plan.png"; } function markOpeningReady() {}',
  'function _photoFileToBlob() { return Promise.resolve(new Blob(["x"], { type: "image/jpeg" })); }',
  'function _uploadPhotoToStorage() { return window.__uploadImpl(); }',
  'function _deleteStoragePhoto(u) { (window.__deleted = window.__deleted || []).push(u); }',
  'function toast(m) {} function confirm() { return true; }',
  'function t(k) { return ({ ro_basis_label: "Dimension basis", ro_basis_hold: "We hold this dimension (glass purchased)", ro_basis_follow: "We follow the GC\'s opening (glass not purchased)", ro_basis_hold_hint: "hold hint", ro_basis_follow_hint: "follow hint", gc_follow_body: "Glass for this unit has not been purchased yet, so we will follow your opening.", gc_follow_target: "Target size", gc_follow_send: "Send us the dimension", sheet_follows_short: "follows your opening", sheet_follows_legend: "legend", openings_disclaimer: "Reference only — the binding record is the approved submittal.", col_unit: "Unit", col_panel: "Panel", col_zone: "Zone", col_type: "Type", col_status: "Status", col_date: "Date", col_note: "Note", kpi_detail_empty: "none" })[k] || k; }',
  'var editingUnitId = null; window.__setEditing = k => { editingUnitId = k; };',
  bayBlk, roBlk, sheetBlk, gcBlk,
  'window.__peekDraft = () => _unitDwgDraft; window.__setDraft = a => { _unitDwgDraft = a; };'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));
const D = (name, url) => ({ url: url || ('https://firebasestorage.example/' + name), name, ts: 1, by: 'leo@advfacade.com' });

// 1. Editor block renders inside the real R.O. tab container
const unit = { key: 'SF04', id: 'SF04', roRequired: { w: "7'-0", h: "3'-0", issued: '2026-08-01', rev: 0 } };
window.state.units = [unit];
T('index.html has the R.O. tab container', !!window.document.getElementById('ro-required'));
window.renderRoRequired(unit);
T('upload input rendered', !!window.document.getElementById('ro-dwg-file'));
T('input takes images only, multiple',
  window.document.getElementById('ro-dwg-file').getAttribute('accept') === 'image/*' &&
  window.document.getElementById('ro-dwg-file').hasAttribute('multiple'));
T('empty state tells you nothing is uploaded',
  /No drawing uploaded/.test(window.document.getElementById('ro-dwg-thumbs').innerHTML));
T('R.O. dimension inputs still there (block appended, not replacing)',
  !!window.document.getElementById('ro-req-w') && !!window.document.getElementById('ro-req-h'));

// 2. Draft seeding + thumbnails
unit.drawings = [D('SF04-elev.png'), D('SF04-section.png')];
window.renderRoRequired(unit);
T('draft seeded from the saved unit', window.__peekDraft().length === 2);
T('draft is a copy, not the live array', window.__peekDraft()[0] !== unit.drawings[0]);
const thumbs = window.document.querySelectorAll('#ro-dwg-thumbs img');
T('one thumbnail per drawing', thumbs.length === 2);
T('thumbnail opens the viewer by index',
  thumbs[1].getAttribute('onclick') === 'openUnitDwgViewer(1)', thumbs[1].getAttribute('onclick'));
T('each thumbnail has a remove button',
  window.document.querySelectorAll('#ro-dwg-thumbs button').length === 2);

// 3. Remove deletes the blob from Storage too
window.__deleted = [];
window.removeUnitDwg(0);
T('remove drops the row', window.__peekDraft().length === 1 && window.__peekDraft()[0].name === 'SF04-section.png');
T('remove also deletes the stored blob', window.__deleted.length === 1 && /SF04-elev/.test(window.__deleted[0]));
T('remove does not touch the saved unit until Save', unit.drawings.length === 2);

// 4. Upload path: Storage first, data-URL fallback, status messages
window.window = window;   // handleUnitDwgFiles reads FileReader off the window
(async () => {
  window.__uploadImpl = () => Promise.resolve('https://firebasestorage.example/new.png');
  window.__setDraft([]);
  await window.handleUnitDwgFiles([{ type: 'image/png', name: 'new.png' }]);
  T('upload appends to the draft', window.__peekDraft().length === 1, window.__peekDraft());
  T('stores url + name + who + when',
    !!window.__peekDraft()[0].url && window.__peekDraft()[0].name === 'new.png' && !!window.__peekDraft()[0].ts);
  T('status cleared after a good upload', window.document.getElementById('ro-dwg-status').textContent === '');
  await window.handleUnitDwgFiles([{ type: 'application/pdf', name: 'plan.pdf' }]);
  T('non-images ignored (PDF is not a screenshot)', window.__peekDraft().length === 1);

  window.__uploadImpl = () => Promise.reject(new Error('storage rules missing'));
  await window.handleUnitDwgFiles([{ type: 'image/png', name: 'fallback.png' }]);
  T('Storage failure falls back to a data-URL instead of losing the file',
    window.__peekDraft().length === 2 && /^data:/.test(window.__peekDraft()[1].url), window.__peekDraft()[1]);
  T('fallback says so out loud (inline blobs bloat /state)',
    /Storage rejected/i.test(window.document.getElementById('ro-dwg-status').textContent),
    window.document.getElementById('ro-dwg-status').textContent);

  // 5. GC read-only card
  window.__ro = true;
  unit.drawings = [D('SF04-elev.png'), D('SF04-section.png')];
  window.__lens = 'openings';
  window.openUnitReadOnly(unit);
  let card = window.document.getElementById('unitViewModal').innerHTML;
  T('GC openings card shows the required opening', /Required rough opening/.test(card));
  T('GC openings card shows the drawing, 2 sheets', /Shop drawing · 2 sheets/.test(card), card.slice(0, 200));
  T('GC thumbnails open the viewer for that unit', card.includes("openDwgViewerFor('SF04', 1)"));
  T('GC card offers a full-size escape hatch hint', /Full size/.test(card));
  window.__lens = 'progress';
  window.openUnitReadOnly(unit);
  card = window.document.getElementById('unitViewModal').innerHTML;
  T('drawing also reachable from the progress lens', /Shop drawing/.test(card));
  delete unit.drawings;
  window.__lens = 'openings';
  window.openUnitReadOnly(unit);
  card = window.document.getElementById('unitViewModal').innerHTML;
  T('no drawing → no empty section on the GC card', !/Shop drawing/.test(card));
  T('R.O. still shown when there is no drawing', /Required rough opening/.test(card));

  // 6. Openings sheet
  unit.drawings = [D('SF04-elev.png')];
  window.state.units = [unit, { key: 'SF05', id: 'SF05', roRequired: { w: "4'-0", h: "8'-0", issued: '2026-08-02' } }];
  const rows = window.openingsRows();
  T('sheet rows carry a drawing count', rows.find(r => r.id === 'SF04').dwg === 1 && rows.find(r => r.id === 'SF05').dwg === 0);
  window.openOpeningsSheet();
  const sheet = window.document.getElementById('openingsModal').innerHTML;
  T('sheet has a Drawing column', /<th>Drawing<\/th>/.test(sheet));
  T('column count matches the header (9)', (sheet.match(/<th>/g) || []).length === 9);
  T('unit with a drawing gets a button', sheet.includes("openDwgViewerFor('SF04', 0)"));
  T('unit without one shows a dash, not a dead button', !sheet.includes("openDwgViewerFor('SF05'"));
  T('Drawing button is print-suppressed like the other actions',
    /op-noprint[^>]*openDwgViewerFor|openDwgViewerFor[\s\S]{0,10}/.test(sheet) && sheet.includes('op-noprint'));

  // 7. Viewer
  window.openDwgViewerFor('SF04', 0);
  let v = window.document.getElementById('dwgViewer');
  T('viewer opens', v.classList.contains('show') && /SF04-elev\.png/.test(v.innerHTML));
  T('single sheet hides the ‹ › arrows', !/stepDwgViewer/.test(v.innerHTML));
  unit.drawings = [D('a.png'), D('b.png'), D('c.png')];
  window.openDwgViewerFor('SF04', 2);
  v = window.document.getElementById('dwgViewer');
  T('multi-sheet shows position + arrows', /3 \/ 3/.test(v.innerHTML) && /stepDwgViewer/.test(v.innerHTML));
  window.stepDwgViewer(1);
  T('stepping wraps around', /1 \/ 3/.test(window.document.getElementById('dwgViewer').innerHTML));
  window.toggleDwgZoom();
  T('tap zooms in', /width:250%/.test(window.document.getElementById('dwgViewer').innerHTML));
  window.toggleDwgZoom();
  T('tap again zooms out', /width:100%/.test(window.document.getElementById('dwgViewer').innerHTML));
  window.openDwgViewerFor('NOPE', 0);
  T('unknown unit / empty list closes instead of throwing',
    !window.document.getElementById('dwgViewer').classList.contains('show'));

  // 8. Escaping
  window.__setDraft([D('<img src=x onerror=1>.png', 'https://x/"><script>1</script>')]);
  window.renderUnitDwgThumbs();
  const box = window.document.getElementById('ro-dwg-thumbs');
  // The hostile string must survive as DATA (one img, attribute values intact) — no
  // injected element, no broken-out attribute.
  T('no element injected from a hostile name/url',
    box.querySelectorAll('script').length === 0 && box.querySelectorAll('img').length === 1,
    box.innerHTML.slice(0, 200));
  T('hostile url stays inside the src attribute',
    box.querySelector('img').getAttribute('src') === 'https://x/"><script>1</script>',
    box.querySelector('img').getAttribute('src'));
  T('hostile name stays inside the alt attribute',
    box.querySelector('img').getAttribute('alt') === '<img src=x onerror=1>.png');
  T('remove button still wired to the right index',
    box.querySelector('button').getAttribute('onclick') === 'removeUnitDwg(0)');


  // ---------- 9. F-046: dimension basis + disclaimer ----------
  const hold = { key: 'SF10', id: 'SF10', roRequired: { w: "6'-0", h: "8'-0", issued: '2026-08-01' } };
  const follow = { key: 'SF11', id: 'SF11', roBasis: 'follow' };
  const followWithTarget = { key: 'SF12', id: 'SF12', roBasis: 'follow', roRequired: { w: "5'-0", h: "8'-0", issued: '2026-08-02' } };
  T('basis defaults to "we hold it" (everything issued so far)', window.roBasisOf(hold) === 'hold');
  T('explicit follow is respected', window.roBasisOf(follow) === 'follow');
  window.state.units = [hold, follow, followWithTarget];
  window.__ro = true; window.__lens = 'openings';
  window.openUnitReadOnly(hold);
  let c = window.document.getElementById('unitViewModal').innerHTML;
  T('hold unit still shows Required rough opening', /Required rough opening/.test(c));
  T('every openings card carries the "reference only" disclaimer', /binding record is the approved submittal/.test(c));
  window.openUnitReadOnly(follow);
  c = window.document.getElementById('unitViewModal').innerHTML;
  T('follow unit asks the GC for THEIR dimension', /has not been purchased yet, so we will follow your opening/.test(c));
  T('follow unit does not hand out a required opening', !/Required rough opening/.test(c));
  T('follow unit offers a way to send the dimension back', /Send us the dimension/.test(c));
  window.openUnitReadOnly(followWithTarget);
  c = window.document.getElementById('unitViewModal').innerHTML;
  T('a target size is shown as a preference, not a requirement',
    /Target size/.test(c) && !/Required rough opening/.test(c), c.slice(0, 400));
  // sheet
  const rows2 = window.openingsRows();
  T('a follow unit with no dimension still reaches the sheet',
    rows2.some(r => r.id === 'SF11' && r.follows === true), rows2.map(r => r.id + ':' + r.follows));
  window.openOpeningsSheet();
  const sh = window.document.getElementById('openingsModal').innerHTML;
  T('sheet prints the disclaimer', /binding record is the approved submittal/.test(sh));
  T('sheet shows "follows your opening" instead of a number', /follows your opening/.test(sh));
  T('sheet explains the marked rows', /legend/.test(sh));
  T('hold rows still show their dimensions', /6'-0/.test(sh.replace(/&#39;/g, "'")));


  // ---------- 10. the basis picker must actually stick (Leo: "点了没变化") ----------
  const pick = { key: 'SF20', id: 'SF20', roRequired: { w: "4'-0", h: "7'-0", issued: '2026-08-01' } };
  window.state.units = [pick];
  window.__setEditing('SF20');
  window.renderRoRequired(pick);
  const sel = window.document.getElementById('ro-basis');
  T('basis select exists and starts on "we hold it"', !!sel && sel.value === 'hold', sel && sel.value);
  T('the select re-renders through setRoBasis, not a raw re-render',
    sel.getAttribute('onchange') === 'setRoBasis(this.value)', sel.getAttribute('onchange'));
  window.setRoBasis('follow');
  const sel2 = window.document.getElementById('ro-basis');
  T('picking "we follow the GC" sticks after the re-render', sel2.value === 'follow', sel2.value);
  T('the unit is NOT changed until Save', window.roBasisOf(pick) === 'hold');
  T('the labels follow the pick', /Target R\.O\./.test(window.document.getElementById('ro-required').innerHTML));
  T('readRoRequired reports the picked basis', window.readRoRequired().basis === 'follow', window.readRoRequired());
  // a queued upload must survive the re-render the picker triggers
  window.__setDraft([D('queued.png')]);
  window.setRoBasis('hold');
  T('a queued drawing survives switching the basis', window.__peekDraft().length === 1, window.__peekDraft());
  T('switching back is also live', window.document.getElementById('ro-basis').value === 'hold');
  // reopening a different unit re-seeds from that unit
  window.renderRoRequired({ key: 'SF21', id: 'SF21', roBasis: 'follow' });
  T('reopening seeds the draft from the unit', window.document.getElementById('ro-basis').value === 'follow');

  console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
  if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
})();
