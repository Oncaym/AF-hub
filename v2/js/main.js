/* v2 entry point: pick a backend, sign in, route.
     #/                     hub — every project you can see
     #/p/{pid}              a project  (?f=<floor> or ?e=<elevation>)
     #/p/{pid}/i/{iid}      …with one item open
     #/admin                load projects, add people
   ?demo in the URL runs on built-in data with no Firebase at all. */
import { createDemoStore } from './store-demo.js';
import { t, getLang, setLang } from './i18n.js';
import { esc, batched } from './ui.js';
import { renderHub } from './views/hub.js';
import { mountProject } from './views/project.js';
import { renderLogin, askEmail } from './views/login.js';
import { renderAdmin } from './views/admin.js';

const root = document.getElementById('app');
const demo = new URLSearchParams(location.search).has('demo') || !window.AF_HUB_FIREBASE;
let store;

function parse() {
  const h = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = h.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const seg = path.split('/').filter(Boolean);
  if (seg[0] === 'p' && seg[1]) return { name: 'project', pid: seg[1], iid: seg[2] === 'i' ? decodeURIComponent(seg[3] || '') : '', q };
  if (seg[0] === 'admin') return { name: 'admin', q };
  return { name: 'hub', q };
}

function theme() {
  let th = null; try { th = localStorage.getItem('afv2-theme'); } catch (e) {}
  if (th) document.documentElement.dataset.theme = th; else delete document.documentElement.dataset.theme;
}

function chrome(route) {
  const u = store.user;
  const acc = store.access();
  const back = route.name === 'hub' ? '' : `<a class="back" href="#/">‹ ${esc(t('projects'))}</a>`;
  const roleSel = store.mode === 'demo'
    ? `<select class="demo-role" aria-label="${esc(t('role'))}">${['admin', 'pm', 'editor', 'field', 'viewer', 'exec'].map(r =>
        `<option value="${r}"${store.demoRole === r ? ' selected' : ''}>${r}</option>`).join('')}</select>` : '';
  return `
    ${store.mode === 'demo' ? `<div class="demo-bar">${esc(t('demo'))} <button class="link" data-act="reset-demo">reset</button></div>` : ''}
    <header class="top">
      <div class="brand">${back || `<span class="logo">AF</span><span>${esc(t('projects'))}</span>`}</div>
      <div class="top-actions">
        ${roleSel}
        ${acc.admin && route.name !== 'admin' ? `<a class="btn ghost sm" href="#/admin">${esc(t('admin'))}</a>` : ''}
        <button class="btn ghost sm" data-act="lang">${getLang() === 'zh' ? 'EN' : '中文'}</button>
        <button class="btn ghost sm" data-act="theme" aria-label="theme">◐</button>
        ${u && store.mode === 'live' ? `<button class="btn ghost sm" data-act="signout" title="${esc(u.email)}">${esc(t('signout'))}</button>` : ''}
      </div>
    </header>`;
}

let current = null;   // mounted project view (keeps its own DOM between data updates)

function render() {
  const route = parse();
  if (store.mode === 'live' && !store.user) { current = null; root.innerHTML = renderLogin(store); return; }
  if (route.name === 'project') {
    if (!current || current.pid !== route.pid) {
      root.innerHTML = chrome(route) + '<main id="view"></main>';
      current = mountProject(document.getElementById('view'), store, route);
    } else current.update(route);
    return;
  }
  current = null;
  root.innerHTML = chrome(route) + `<main id="view">${route.name === 'admin' ? '' : renderHub(store)}</main>`;
  if (route.name === 'admin') renderAdmin(document.getElementById('view'), store);
}

document.addEventListener('click', async e => {
  const a = e.target.closest('[data-act]');
  if (!a) return;
  const act = a.dataset.act;
  if (act === 'lang') { setLang(getLang() === 'zh' ? 'en' : 'zh'); current = null; render(); }
  if (act === 'theme') {
    const cur = document.documentElement.dataset.theme || (matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    const next = cur === 'light' ? 'dark' : 'light';
    try { localStorage.setItem('afv2-theme', next); } catch (err) {}
    theme();
  }
  if (act === 'signout') { await store.signOut(); location.hash = '#/'; }
  if (act === 'reset-demo') store.resetDemo();
});
document.addEventListener('change', e => {
  if (e.target.matches('.demo-role')) { store.setDemoRole(e.target.value); current = null; render(); }
});

(async function boot() {
  theme();
  root.innerHTML = '<div class="boot">…</div>';
  if (demo) store = createDemoStore();
  else {
    try {
      const { createLiveStore } = await import('./store-live.js');
      store = await createLiveStore(window.AF_HUB_FIREBASE);
    } catch (e) {
      root.innerHTML = `<div class="boot err">Could not reach Firebase (${esc(e.message)}). <a href="?demo">Open the demo</a></div>`;
      return;
    }
  }
  window.afv2 = store;                        // for the console and the tests
  await store.init({ askEmail });
  store.subscribe(batched(render));
  store.onAuth(() => { current = null; render(); });
  window.addEventListener('hashchange', render);
  render();
})();
