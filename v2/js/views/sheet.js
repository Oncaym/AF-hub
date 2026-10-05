/* The item sheet — the one screen a foreman needs.
   Three stages, each a single tap that stamps today's date and their name.
   Undo is right there; the change log keeps what it was. */
import { t, L } from '../i18n.js';
import { esc, $, toast, fmtDate } from '../ui.js';
import { STAGES, stageOf, can, today } from '../model.js';

export function renderSheet(store, pid, iid, closeHref) {
  const P = store.project(pid) || {};
  const meta = P.meta || {};
  const it = (P.items || {})[iid];
  if (!it) return `<div class="sheet"><a class="x" href="${closeHref}">×</a><p class="muted">${esc(iid)} — not found</p></div>`;
  const role = store.roleFor(pid);
  const scope = (meta.scopes || []).find(s => s.key === it.scope) || { label: it.scope, factory: true };
  const stages = STAGES.filter(s => s !== 'factory' || scope.factory !== false);
  const mark = can(role, 'mark');
  const issue = (P.issues || {})[iid];
  const st = it.st || {};
  const fl = (meta.floors || []).find(f => f.key === it.floor);
  const hist = store.changesFor(pid, iid);
  const N = it.qty && it.qty.n;
  const qd = Math.min(Number(it.qd) || 0, N || 0);

  return `
  <div class="sheet" role="dialog" aria-label="${esc(it.label)}">
    <div class="sheet-head">
      <div>
        <div class="sheet-title"><span class="dot ${stageOf(it)}"></span>${esc(it.label)}</div>
        <div class="muted">${esc(L(scope))} · ${esc(fl ? L(fl) : it.floor)}${it.zone ? ' · ' + esc(it.zone) : ''}${it.lf ? ` · ${esc(it.lf)} LF` : ''}</div>
      </div>
      <a class="x" href="${closeHref}" aria-label="${esc(t('close'))}">×</a>
    </div>
    ${it.note ? `<p class="note">${esc(it.note)}</p>` : ''}

    ${N ? `
    <div class="qty-box">
      <div class="qty-top"><span>${esc(scope.count || it.qty.u)}</span><b>${qd} / ${N}</b></div>
      ${mark ? `<div class="stepper">
        <button class="btn" data-sh="qd" data-v="${qd - 1}"${qd <= 0 ? ' disabled' : ''}>−</button>
        <input type="range" min="0" max="${N}" value="${qd}" data-sh="qd-range">
        <button class="btn" data-sh="qd" data-v="${qd + 1}"${qd >= N ? ' disabled' : ''}>+</button>
        <button class="btn" data-sh="qd" data-v="${N}"${qd >= N ? ' disabled' : ''}>${esc(t('allInstalled'))}</button>
      </div>` : ''}
      ${(it.parts || []).length ? `<div class="muted small">${it.parts.map(esc).join(' · ')}</div>` : ''}
    </div>` : ''}

    <div class="stages">
      ${stages.map(s => {
        const v = st[s];
        return `<div class="stage ${v ? 'done ' + s : ''}">
          <span class="dot ${v ? s : 'none'}"></span>
          <span class="stage-name">${esc(t('stageNames')[s])}</span>
          <span class="stage-when">${v ? `${esc(fmtDate(v.d))}${v.n ? ` · ${esc(v.n)}` : ''}` : '—'}</span>
          ${mark ? (v
            ? `<input type="date" value="${esc(v.d)}" data-sh="date" data-s="${s}" aria-label="${esc(t('change'))}"><button class="btn ghost sm" data-sh="clear" data-s="${s}">${esc(t('clear'))}</button>`
            : `<button class="btn primary" data-sh="mark" data-s="${s}">${esc(t('markToday'))}</button>`) : ''}
        </div>`;
      }).join('')}
    </div>

    <div class="issue-box">
      ${issue ? `
        <div class="issue open"><b>${esc(t('openIssue'))}</b> <span class="muted">${esc(issue.n || '')} ${issue.t ? esc(new Date(issue.t).toLocaleDateString()) : ''}</span><p>${esc(issue.text)}</p>
          ${can(role, 'issues') ? `<button class="btn ghost sm" data-sh="resolve">${esc(t('resolve'))}</button>` : ''}</div>`
      : can(role, 'issues') ? `
        <details class="issue-new"><summary>${esc(t('reportIssue'))}</summary>
          <textarea rows="3" placeholder="${esc(t('issueText'))}" data-sh="issue-text"></textarea>
          <button class="btn" data-sh="issue-save">${esc(t('save'))}</button>
        </details>` : ''}
    </div>

    <details class="hist"><summary>${esc(t('history'))} <span class="muted">${hist.length || ''}</span></summary>
      ${hist.length ? `<ul>${hist.map(c => `<li><span class="muted">${c.t ? esc(new Date(c.t).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}</span> ${esc(c.n || '')}: ${esc(describe(c))}</li>`).join('')}</ul>` : `<p class="muted">${esc(t('noHistory'))}</p>`}
    </details>
  </div>`;
}

function describe(c) {
  if (c.f && c.f.startsWith('st.')) {
    const s = t('stageNames')[c.f.slice(3)] || c.f;
    return c.to ? `${s} → ${c.to}` : `${s} ${t('clear').toLowerCase()} (${c.from || ''})`;
  }
  if (c.f === 'qd') return `${c.from} → ${c.to}`;
  if (c.f === 'issue') return c.to ? `${t('issue')}: ${c.to}` : `${t('issue')} ${t('resolve').toLowerCase()}`;
  return `${c.f}: ${c.from} → ${c.to}`;
}

export function wireSheet(el, store, pid, getIid) {
  const run = async (fn) => { try { await fn(); } catch (e) { toast(e.code || e.message, 'err'); console.warn(e); } };
  el.addEventListener('click', e => {
    const b = e.target.closest('[data-sh]');
    if (!b || !b.closest('.sheet')) return;
    const iid = getIid();
    const it = ((store.project(pid) || {}).items || {})[iid] || {};
    const N = it.qty && it.qty.n;
    const a = b.dataset.sh;
    if (a === 'mark') run(() => store.setStage(pid, iid, b.dataset.s, today()));
    if (a === 'clear') run(() => store.setStage(pid, iid, b.dataset.s, null));
    if (a === 'qd') run(() => setQty(store, pid, iid, Number(b.dataset.v), N, it));
    if (a === 'resolve') run(() => store.setIssue(pid, iid, null));
    if (a === 'issue-save') {
      const txt = $('[data-sh="issue-text"]', b.closest('.sheet')).value.trim();
      if (txt) run(() => store.setIssue(pid, iid, txt));
    }
  });
  el.addEventListener('change', e => {
    const b = e.target.closest('[data-sh]');
    if (!b || !b.closest('.sheet')) return;
    const iid = getIid();
    const it = ((store.project(pid) || {}).items || {})[iid] || {};
    if (b.dataset.sh === 'date' && b.value) run(() => store.setStage(pid, iid, b.dataset.s, b.value));
    if (b.dataset.sh === 'qd-range') run(() => setQty(store, pid, iid, Number(b.value), it.qty && it.qty.n, it));
  });
}

/* A count item is installed when its last post goes in — and stops being so if
   the count is walked back. */
async function setQty(store, pid, iid, n, N, it) {
  n = Math.max(0, Math.min(N, n));
  await store.setQty(pid, iid, n);
  const inst = it.st && it.st.installed;
  if (n === N && !inst) await store.setStage(pid, iid, 'installed', today());
  if (n < N && inst) await store.setStage(pid, iid, 'installed', null);
}
