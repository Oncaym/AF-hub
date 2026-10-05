/* Admin: load the shipped projects into the database once, and add people.
   People are added by email; they become members the first time they sign in
   with a verified email (an email-link sign-in verifies it). */
import { t } from '../i18n.js';
import { esc, toast } from '../ui.js';
import { SEEDS } from '../seeds.js';

const ROLES = ['pm', 'editor', 'field', 'viewer', 'gc'];

export async function renderAdmin(el, store) {
  const acc = store.access();
  if (!acc.admin) {
    el.innerHTML = `<section class="admin"><h1>${esc(t('admin'))}</h1>
      ${store.mode === 'live' ? `<p class="muted">Not an admin yet. If this is the very first sign-in for the whole system, Leo's account can claim admin once:</p>
      <button class="btn primary" data-adm="claim">Claim admin</button>` : '<p class="muted">Switch the demo role to admin.</p>'}</section>`;
    el.querySelector('[data-adm="claim"]')?.addEventListener('click', async () => {
      try { await store.claimFirstAdmin(); toast('Admin claimed'); } catch (e) { toast(e.code || e.message, 'err'); }
    });
    return;
  }
  const status = await store.seedStatus();
  el.innerHTML = `
    <section class="admin">
      <h1>${esc(t('admin'))}</h1>
      <h2>${esc(t('seeds'))}</h2>
      <div class="seed-list">${SEEDS.map(pid => `
        <div class="seed-row"><b>${esc(pid)}</b>
          ${status[pid] ? `<span class="chip on">${esc(t('loaded'))}</span>` : `<button class="btn primary sm" data-adm="seed" data-pid="${pid}">${esc(t('loadSeed'))}</button>`}
        </div>`).join('')}</div>
      <h2>${esc(t('members'))}</h2>
      <div id="adm-members">${store.projectIds().map(pid => `
        <div class="mem-block" data-pid="${pid}">
          <h3>${esc((store.project(pid) || {}).meta?.name || pid)}</h3>
          <ul class="mem-list"><li class="muted">…</li></ul>
          <form class="mem-add" data-pid="${pid}">
            <input type="email" name="email" placeholder="${esc(t('email'))}" required>
            <select name="role">${ROLES.map(r => `<option>${r}</option>`).join('')}</select>
            <button class="btn sm">${esc(t('invite'))}</button>
          </form>
        </div>`).join('')}</div>
    </section>`;

  el.querySelectorAll('[data-adm="seed"]').forEach(b => b.addEventListener('click', async () => {
    b.disabled = true;
    try { await store.loadSeed(b.dataset.pid); toast(`${b.dataset.pid}: ${t('loaded')}`); renderAdmin(el, store); }
    catch (e) { b.disabled = false; toast(e.code || e.message, 'err'); }
  }));
  el.querySelectorAll('.mem-block').forEach(blk => {
    const pid = blk.dataset.pid;
    store.watchMembers(pid, m => {
      const ul = blk.querySelector('.mem-list');
      const rows = Object.entries(m || {});
      ul.innerHTML = rows.length ? rows.map(([uid, v]) => `<li>${esc(v.email || uid)} <span class="chip">${esc(v.role)}</span></li>`).join('') : '<li class="muted">—</li>';
    });
  });
  el.querySelectorAll('.mem-add').forEach(f => f.addEventListener('submit', async e => {
    e.preventDefault();
    try { await store.invite(f.dataset.pid, f.email.value.trim(), f.role.value); toast(`${f.email.value} → ${f.role.value}`); f.reset(); }
    catch (err) { toast(err.code || err.message, 'err'); }
  }));
}
