/* Renders the F-055 bay panel into a standalone page so it can be eyeballed (or
   screenshotted) without booting the app, Firebase or a login.
   Run: node _tests/make-bay-preview.cjs   →  _tests/preview-bay.html
   Shows the same bay four ways: GC dark / GC light / editor dark / doors hidden. */
const fs = require('fs'), path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';
const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window } = dom;
const slice = (a1, b1) => { const a = src.indexOf(a1), b = src.indexOf(b1, a + 1); return src.slice(a, b); };

window.eval(fs.readFileSync(ROOT + 'elevations.js', 'utf8'));
window.state = { units: [
  { key: 'SF46', id: 'SF46', roRequired: { w: `6'-8"`,  h: `11'-6"`,     issued: '2026-07-31', rev: 1 } },
  { key: 'SF47', id: 'SF47', roRequired: { w: `10'-4"`, h: `9'-2 1/2"`,  issued: '2026-07-31', rev: 1 } },
  { key: 'SF48', id: 'SF48' }, { key: 'SF49', id: 'SF49' },
  { key: 'SF60', id: 'SF60' }, { key: 'SF61', id: 'SF61' }, { key: 'SD01', id: 'SD01' }
] };
window.eval([
  /* The split (Leo, 2026-09-18): app.js no longer has one _isRO(). `__ro` keeps its
     old meaning — this session cannot write — and `__gc` defaults to it, so every test
     written before the split still means exactly what it meant. Set __gc:false with
     __ro:true to get the case that used to be impossible: a VIEWER. */
  'function _noEdit() { return !!window.__ro; }',
  'function _isGC() { return window.__gc === undefined ? !!window.__ro : !!window.__gc; }',
  'function t(k){ return { sheet_follows_short:"follows your opening" }[k] || k; }',
  'function toast(){} function openUnit(){}',
  'function _roReqOf(u){ return (u && u.roRequired) || { w:"",h:"",tol:"",note:"",issued:"",rev:0 }; }',
  'function _roReqEmpty(r){ return !(r && (r.w||r.h||r.tol||r.note)); }',
  'function _roFollows(u){ return !!(u && u.roBasis==="follow"); }',
  'function _openingAckedBy(id){ return (window.__acks||{})[String(id).toLowerCase()] || null; }',
  "let _opView='plan', _opBay='', _bayDoors=true;",
  slice('function _bays() {', '/* GC one-tap acknowledgment')
].join('\n'));

// index.html has more than one <style> block — take them all, or the panel
// renders as raw SVG defaults (black on black) and the preview lies.
const style = (html.match(/<style>[\s\S]*?<\/style>/g) || [])
  .map(b => b.replace(/^<style>|<\/style>$/g, '')).join('\n');

/* Daylight and print are scoped to `body.day-mode` / `body.printing-openings`, and a
   preview page has ONE body. Earlier this file just overrode the CSS variables, which
   meant the day-mode and print declarations were never exercised and the preview
   quietly showed something nobody will ever see. So: lift those rules onto a wrapper
   class instead, print rules out of their @media block, and render them for real. */
function blocks(css, startsWith) {          // brace-matched extraction
  const out = [];
  let i = 0;
  while ((i = css.indexOf(startsWith, i)) >= 0) {
    let j = css.indexOf('{', i), depth = 0, k = j;
    for (; k < css.length; k++) {
      if (css[k] === '{') depth++;
      else if (css[k] === '}' && --depth === 0) break;
    }
    out.push(css.slice(j + 1, k));
    i = k + 1;
  }
  return out.join('\n');
}
const dayCss   = style.replace(/body\.day-mode/g, '.day-mode');
/* Keep only the print rules that paint the sheet itself. The rest of the print block
   hides the app chrome (`body.printing-openings > *:not(#openingsModal)`), which on a
   preview page whose body is not the modal would hide the preview. */
const printCss = blocks(style, '@media print')
  .split('}')
  .filter(r => r.indexOf('#openingsSheet') >= 0 && r.indexOf('> *') < 0)
  .map(r => r.trim() + '}')
  .join('\n')
  .replace(/body\.printing-openings/g, '.printing');
const bay = window._bays()[0];
const shot = (title, opts) => {
  window.__ro = !!opts.ro;
  window.__acks = opts.acks || {};
  const cls = [opts.day ? 'day-mode' : '', opts.print ? 'printing' : ''].join(' ');
  return `<section class="${opts.day || opts.print ? 'day' : ''}">
      <h2>${title}</h2>
      <div class="frame ${cls}"><div id="openingsSheet">
        <div class="bay-stage${opts.nodoors ? ' bay-nodoors' : ''}">${window._baySvg(bay)}</div>
      </div></div></section>`;
};
const body = [
  shot('GC view — dark (SF46/SF47 issued, SF46 confirmed ready)', { ro: 1, acks: { sf46: { by: 'gc', ts: 1 } } }),
  shot('GC view — daylight mode', { ro: 1, day: 1 }),
  shot('GC handout — print colours (black on white, no app chrome)', { ro: 1, print: 1 }),
  shot('Editor view — the drawing\'s own measurements on un-issued openings', { ro: 0 }),
  shot('Doors hidden', { ro: 1, nodoors: 1 })
].join('\n');

fs.writeFileSync(ROOT + '_tests/preview-bay.html',
`<!doctype html><meta charset="utf-8"><title>F-055 bay elevation preview</title>
<style>${style}
${dayCss}
${printCss}
 body{background:#0d1117;color:#e6edf3;font-family:system-ui,-apple-system,"Segoe UI",sans-serif;margin:0;padding:22px}
 h2{font-size:14px;font-weight:600;color:#8b949e;margin:26px 0 8px}
 .frame{max-width:1000px}
 section.day .frame{--bg:#fff;--text:#1f2328;--text-dim:#59636e;--border:#d0d7de;background:#fff;padding:12px;border-radius:10px}
 .printing .bay-stage{background:#fff}
</style>${body}\n`);
console.log('wrote _tests/preview-bay.html');

/* ---- F-056: where the elevation key lands on the REAL plan ------------------
   The unit test proves the maths with synthetic positions. This renders it over
   the actual floor plans with the actual seeded coordinates, because "is it in a
   sensible place on this building" is a question only a picture answers. */
const stateJson = JSON.parse(fs.readFileSync(ROOT + 'state.json', 'utf8'));
window.state.units = stateJson.units;
window.state.positions = stateJson.positions;
window.eval([
  'function firstFloorKey(){ return "GF"; }',
  'function _clampMarkerPct(v){ return Math.max(-50, Math.min(150, v)); }',
  'var currentLevel = "GF", editMode = false, placeMode = false, dragState = null;',
  'window.__lvl = v => { currentLevel = v; };'
].join('\n'));

const planSrc = { GF: 'gf-plan-white.png', L2: '2f-plan-white.png' };
const planShot = (level, title) => {
  window.__lvl(level);
  const w = window.document.createElement('div');
  window.state.units.filter(u => (u.level || 'GF') === level).forEach(u => {
    const p = window.state.positions[u.key]; if (!p) return;
    const m = window.document.createElement('div');
    m.className = 'plan-marker pending'; m.dataset.unit = u.key;
    m.style.left = p.x + '%'; m.style.top = p.y + '%';
    m.textContent = String(u.id).replace(/^SF/i, '');
    w.appendChild(m);
  });
  window.renderElevationKeys(w);
  return `<section><h2>${title}</h2>
    <div class="planwrap"><img src="../${planSrc[level]}">${w.innerHTML}</div></section>`;
};
fs.appendFileSync(ROOT + '_tests/preview-bay.html',
  `<style>.planwrap{position:relative;max-width:1000px}.planwrap img{width:100%;display:block}</style>` +
  planShot('GF', 'F-056 — elevation key on the real Ground Floor plan') +
  planShot('L2', 'F-056 — and on the 2nd Floor'));
console.log('appended the plan-key sections');
