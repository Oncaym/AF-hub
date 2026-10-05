import { t } from '../i18n.js';
import { esc, toast } from '../ui.js';

let usePw = false;

export function renderLogin(store) {
  setTimeout(() => wire(store), 0);
  return `
  <div class="login">
    <div class="login-card">
      <div class="logo big">AF</div>
      <h1>${esc(t('signInTitle'))}</h1>
      <form id="login-form">
        <label>${esc(t('email'))}<input type="email" name="email" autocomplete="email" required></label>
        ${usePw ? `<label>${esc(t('password'))}<input type="password" name="pw" autocomplete="current-password" required></label>` : ''}
        <button class="btn primary wide" type="submit">${esc(usePw ? t('signIn') : t('sendLink'))}</button>
      </form>
      <button class="link" data-login="toggle">${esc(usePw ? t('useLink') : t('usePassword'))}</button>
      <p class="hint" id="login-msg"></p>
    </div>
  </div>`;
}

function wire(store) {
  const f = document.getElementById('login-form');
  if (!f || f.dataset.wired) return;
  f.dataset.wired = '1';
  f.addEventListener('submit', async e => {
    e.preventDefault();
    const email = f.email.value.trim();
    const msg = document.getElementById('login-msg');
    try {
      if (usePw) await store.signInPassword(email, f.pw.value);
      else { await store.sendLink(email); msg.textContent = t('linkSent'); }
    } catch (err) { msg.textContent = err.code || err.message; }
  });
  document.querySelector('[data-login="toggle"]').addEventListener('click', () => {
    usePw = !usePw;
    document.getElementById('app').innerHTML = renderLogin(store);
  });
}

/* Opened the link on a different device than the one that asked for it. */
export function askEmail() {
  return Promise.resolve(window.prompt(t('confirmEmail')) || null);
}
