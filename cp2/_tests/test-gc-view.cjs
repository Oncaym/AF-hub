/* Harness: GC mode hides the KPI banner + the Progress lens (F-043, Leo 2026-08-03).
   Run: npm i jsdom && node test-gc-view.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';   // harness lives in _tests/, the app is one level up

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window, window: { document } } = dom;

function slice(a1, b1) {
  const a = src.indexOf(a1), b = src.indexOf(b1, a + 1);
  if (a < 0 || b < 0) throw new Error('marker not found: ' + a1);
  return src.slice(a, b);
}
const lensBlk = slice("const _LENSES = ", 'function _lensShows(');
const markerBlk = slice('function _lensMarkerClass(u, lens)', 'function _lensMarkerLabel');
const keyBlk = slice('function _lensOpeningsKey()', 'function _lensCounts()');
const barBlk  = slice('function renderPlanLensBar()', '\nfunction _daysOpen(');

window.state = { units: [], projectItems: [] };
window.GC_ITEMS = [];
window.eval([
  /* The split (Leo, 2026-09-18): app.js no longer has one _isRO(). `__ro` keeps its
     old meaning — this session cannot write — and `__gc` defaults to it, so every test
     written before the split still means exactly what it meant. Set __gc:false with
     __ro:true to get the case that used to be impossible: a VIEWER. */
  'function _noEdit() { return !!window.__ro; }',
  'function _isGC() { return window.__gc === undefined ? !!window.__ro : !!window.__gc; }',
  'function renderPlan() { window.__planRenders = (window.__planRenders || 0) + 1; }',
  'function _lensCounts() { return { openings: 7, issues: 2 }; }',
  'function _lensRfiOptions() { return []; }',
  'function openOpeningsSheet() {} function printOpenings() {} function openItemsModal() {}',
  'function _openingAcks() { return window.__acks || {}; }',
  'function _roFollows(u) { return !!(u && u.roBasis === "follow"); }',
  lensBlk, markerBlk, keyBlk, barBlk,
  'window.__setLens = v => { _planLens = v; }; window.__picked = v => { _lensUserPicked = v; };',
  'window.__peekLens = () => _planLens;'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));
const tabs = () => Array.from(document.querySelectorAll('#planLensBar .lens-btn')).map(b => b.textContent.trim());

// 1. Top banner is markup-gated, and the CSS that hides it exists
const kpi = document.querySelector('.kpi-grid');
T('KPI banner section exists', !!kpi);
T('KPI banner is tagged data-gc-hide', kpi.hasAttribute('data-gc-hide'));
T('gc-view CSS hides everything tagged data-gc-hide',
  /body\.gc-view \[data-gc-hide\]\s*\{\s*display:\s*none\s*!important/.test(html));
T('the caulking / beauty cap cards are inside that section',
  !!kpi.querySelector('#kpi-caulk') && !!kpi.querySelector('#kpi-beautycap'));
T('banner is hidden only via the class — editors keep it',
  !kpi.hasAttribute('hidden') && !/display:\s*none/.test(kpi.getAttribute('style') || ''));

// 2. Editor sees all three lenses
window.__ro = false;
window.__setLens(null);
window.renderPlanLensBar();
T('editor sees 3 lens tabs', tabs().length === 3, tabs());
T('editor tabs include Progress', tabs().some(t => /Progress/.test(t)), tabs());
T('editor default lens is progress', window._lens() === 'progress');

// 3. GC sees Openings + Issues only
window.__ro = true;
window.__setLens(null); window.__picked(false);
T('GC default lens is openings', window._lens() === 'openings');
window.renderPlanLensBar();
T('GC sees 2 lens tabs', tabs().length === 2, tabs());
T('Progress tab not rendered for the GC', !tabs().some(t => /Progress/.test(t)), tabs());
T('GC keeps Openings + Issues', /Openings/.test(tabs()[0]) && /Issues/.test(tabs()[1]), tabs());
T('counts still shown to the GC', /7/.test(tabs()[0]) && /2/.test(tabs()[1]), tabs());

// 4. The lens is unreachable, not just unclickable
window.setPlanLens('progress');
T('setPlanLens("progress") ignored for the GC', window.__peekLens() !== 'progress', window.__peekLens());
T('ignored click does not repaint the plan', !window.__planRenders);
window.setPlanLens('issues');
T('GC can still switch to issues', window.__peekLens() === 'issues' && window.__planRenders === 1);

// 5. Race: read-only resolves AFTER a first paint that had landed on progress
window.__setLens('progress'); window.__picked(true);
T('a stale progress selection is coerced to openings on read', window._lens() === 'openings');
T('and the stored lens is rewritten, not just the return value', window.__peekLens() === 'openings');
window.renderPlanLensBar();
T('bar redrawn without the Progress tab', tabs().length === 2 && !tabs().some(t => /Progress/.test(t)));
T('hint text is the openings one, not "Installation status"',
  /Opening sizes/.test(document.querySelector('#planLensBar .lens-hint').textContent),
  document.querySelector('#planLensBar .lens-hint').textContent.slice(0, 60));

// 6. Editors are unaffected by any of it
window.__ro = false;
T('editor may select progress', (window.setPlanLens('progress'), window.__peekLens() === 'progress'));
window.renderPlanLensBar();
T('editor bar has Progress back', tabs().length === 3 && tabs().some(t => /Progress/.test(t)));
T('_lensAllowed is the single gate', window._lensAllowed('progress') === true &&
  (window.__ro = true, window._lensAllowed('progress') === false) &&
  window._lensAllowed('openings') === true && window._lensAllowed('nope') === false);


/* 6b. THE BUG (Leo, 2026-09-18). A viewer — signed in, not on /allowlist, not the GC —
   used to be handed everything below, because one flag answered both "can you write?"
   and "are you the GC?". They are one of us: allowlist is EDITOR permission, and not
   holding it must cost you the Save buttons, nothing else. */
window.__ro = true; window.__gc = false;          // cannot write, is NOT the GC
window.__setLens(null); window.__picked(false);
T('viewer: default lens is Progress, same as an editor', window._lens() === 'progress',
  window._lens());
window.renderPlanLensBar();
T('viewer: sees all 3 lens tabs', tabs().length === 3, tabs());
T('viewer: Progress tab is there', tabs().some(t => /Progress/.test(t)), tabs());
T('viewer: may actually select Progress',
  (window.setPlanLens('progress'), window.__peekLens() === 'progress'), window.__peekLens());
T('viewer: _lensAllowed does not gate them', window._lensAllowed('progress') === true);
T('viewer: gets the internal hint, not the GC colour key',
  !/Send us your dimension/.test(document.querySelector('#planLensBar .lens-hint').innerHTML));
/* And the GC is still narrowed — the split must not have simply disabled the feature. */
window.__gc = true;
window.__setLens(null); window.__picked(false);
T('and the GC is still narrowed to 2 tabs',
  (window.renderPlanLensBar(), tabs().length === 2), tabs());
window.__gc = undefined;                          // back to __gc following __ro

// 7. F-046b: Openings lens tells the two directions apart
const U = (id, extra) => Object.assign({ key: id, id }, extra || {});
window.__acks = {};
T('hold + awaiting = the plain (blue) openings marker',
  window._lensMarkerClass(U('SF01'), 'openings') === ' lens-dim', window._lensMarkerClass(U('SF01'), 'openings'));
T('follow gets its own class', window._lensMarkerClass(U('SF02', { roBasis: 'follow' }), 'openings') === ' lens-dim lens-follow');
window.__acks = { sf02: { ts: 1 } };
T('a confirmed follow unit reads as ready (green) too',
  window._lensMarkerClass(U('SF02', { roBasis: 'follow' }), 'openings') === ' lens-dim lens-follow lens-ready');
T('no lens classes outside the openings lens',
  window._lensMarkerClass(U('SF02', { roBasis: 'follow' }), 'progress') === '');
T('CSS paints follow markers violet + dashed',
  /\.plan-wrap\.lens-openings \.plan-marker\.lens-follow \{[^}]*var\(--follow-op[^}]*border-style:dashed/s.test(html));
T('ready still wins for a follow unit',
  /\.plan-marker\.lens-follow\.lens-ready \{[^}]*var\(--green/s.test(html));
T('--follow-op defined in both themes', (html.match(/--follow-op:/g) || []).length >= 2);
window.state.units = [U('SF01'), U('SF02', { roBasis: 'follow' })];
window.__ro = true; window.__setLens('openings'); window.__picked(true);
window.renderPlanLensBar();
const hint = document.querySelector('#planLensBar .lens-hint').innerHTML;
T('colour key shown to the GC', /Build to our dimension/.test(hint) && /Send us your dimension/.test(hint), hint.slice(0, 200));
T('key explains green too', /You marked it ready/.test(hint));
window.state.units = [U('SF01')];
window.renderPlanLensBar();
T('the violet chip is hidden when no unit follows the GC',
  !/Send us your dimension/.test(document.querySelector('#planLensBar .lens-hint').innerHTML));

console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
