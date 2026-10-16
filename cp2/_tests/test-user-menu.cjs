/* Harness: the user dropdown must not be clipped by the host page's layout (F-047).
   Run: npm i jsdom && node _tests/test-user-menu.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const cs   = fs.readFileSync(ROOT + '../core/cloud-sync.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window, window: { document } } = dom;

// Mount just the badge: slice mountStatusBadge out of the IIFE and give it its deps.
const lines = cs.split('\n');
const at = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('not found ' + re); return i + 1; };
const mountBlk = lines.slice(at(/^  function mountStatusBadge\(\)/) - 1, at(/^  function unmountStatusBadge\(\)/) - 1).join('\n');

window.eval([
  'function openHistoryPanel() { window.__opened = "history"; }',
  'function openPresencePanel() { window.__opened = "presence"; }',
  'var auth = { signOut() { window.__opened = "logout"; } };',
  mountBlk,
  'window.mountStatusBadge = mountStatusBadge;'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));

// The host page really does clip: this is the layout that broke it on a phone.
T('host makes .header-actions scroll on mobile (the thing that clipped it)',
  /\.header-actions\s*\{[^}]*overflow-x:\s*auto/.test(html));
T('host header uses backdrop-filter (so position:fixed alone would not escape it)',
  /header\s*\{[^}]*backdrop-filter/.test(html));

window.mountStatusBadge();
const dd = document.getElementById('cs-user-dropdown');
const btn = document.getElementById('cs-user-btn');
T('badge mounted', !!dd && !!btn);
T('dropdown is moved out to <body>, not left inside the scrolling header',
  dd.parentElement === document.body, dd.parentElement && dd.parentElement.className);
T('the button itself stays in the header', !!document.querySelector('.header-actions .cs-user-btn'));
T('dropdown is fixed-positioned', /position:\s*fixed/.test(cs.slice(cs.indexOf('.cs-user-dropdown {'), cs.indexOf('.cs-user-dropdown {') + 260)));
T('it sits above the sticky header', /z-index:\s*10000/.test(cs));
T('menu is capped to the viewport width', /max-width:\s*calc\(100vw - 16px\)/.test(cs));
T('touch-sized rows under 720px', /@media[^{]*720px[^}]*\{[\s\S]{0,200}\.cs-user-dropdown button\s*\{[^}]*padding:\s*12px/.test(cs));
T('all three actions present',
  [...dd.querySelectorAll('button')].map(b => b.dataset.action).join(',') === 'history,presence,logout');

// Placement: jsdom gives every element a zero rect, so drive it with a stubbed rect.
function rect(r) { btn.getBoundingClientRect = () => r; }
Object.defineProperty(dd, 'offsetWidth',  { get: () => 214, configurable: true });
Object.defineProperty(dd, 'offsetHeight', { get: () => 150, configurable: true });
Object.defineProperty(document.documentElement, 'clientWidth',  { get: () => 390, configurable: true });
Object.defineProperty(document.documentElement, 'clientHeight', { get: () => 844, configurable: true });

rect({ top: 60, bottom: 84, left: 300, right: 372, width: 72, height: 24 });
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
T('opens on click', dd.classList.contains('open'));
T('right-aligned to the button', dd.style.left === '158px', dd.style.left);   // 372 - 214
T('drops below the button', dd.style.top === '90px', dd.style.top);
T('fits on screen horizontally', parseInt(dd.style.left) >= 8 && parseInt(dd.style.left) + 214 <= 390 - 8);

// A button near the right edge of a narrow phone must not push the menu off-screen.
document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));   // close
rect({ top: 60, bottom: 84, left: 350, right: 388, width: 38, height: 24 });
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
T('clamped to an 8px margin at the right edge', parseInt(dd.style.left) === 390 - 214 - 8, dd.style.left);

// Landscape phone: no room below → flip above the button instead of hanging off.
document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
Object.defineProperty(document.documentElement, 'clientHeight', { get: () => 380, configurable: true });
rect({ top: 300, bottom: 330, left: 300, right: 372, width: 72, height: 30 });
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
T('flips above when there is no room below', parseInt(dd.style.top) === 300 - 150 - 6, dd.style.top);
T('never renders past the bottom edge', parseInt(dd.style.top) + 150 <= 380);

// Actions still work from the new home, and the menu closes after each one.
window.__opened = null;
dd.querySelector('[data-action="presence"]').dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
T('menu items still fire', window.__opened === 'presence');
T('menu closes after choosing', !dd.classList.contains('open'));
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
document.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
T('outside click closes it', !dd.classList.contains('open'));
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
btn.dispatchEvent(new window.MouseEvent('click', { bubbles: true }));
T('the button toggles it shut again', !dd.classList.contains('open'));

console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
