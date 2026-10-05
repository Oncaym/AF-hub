/* Hub: one card per project the signed-in person can see. */
import { t, L } from '../i18n.js';
import { esc } from '../ui.js';
import { progress, thisWeek } from '../model.js';

let legacy = {}, legacyFor = null;

export function stageBar(p, cls = '') {
  const tot = p.total || 1;
  const w = n => (100 * n / tot).toFixed(2) + '%';
  return `<div class="sbar ${cls}" title="${esc(`${p.installed} ${t('installed')} · ${p.site} ${t('site')} · ${p.factory} ${t('factory')}`)}">
    <i class="installed" style="width:${w(p.installed)}"></i><i class="site" style="width:${w(p.site)}"></i><i class="factory" style="width:${w(p.factory)}"></i></div>`;
}

function card(pid, P) {
  const meta = P.meta;
  if (!meta) return `<a class="pcard loading" href="#/p/${esc(pid)}"><div class="pname">${esc(pid)}</div><div class="muted">…</div></a>`;
  const pr = progress(meta, P.items);
  const wk = thisWeek(meta, P.items);
  const started = pr.installed + pr.site + pr.factory > 0;
  const wkTxt = Object.entries(wk).map(([s, n]) => {
    const sc = (meta.scopes || []).find(x => x.key === s);
    return `<b>${n}</b> ${esc(sc ? L(sc) : s)}`;
  }).join(' · ');
  return `
  <a class="pcard" href="#/p/${esc(pid)}">
    <div class="phead-row">
      <div>
        <div class="pname">${esc(meta.name)}</div>
        <div class="muted">${esc(t('pm'))} ${esc(meta.pm || '—')}${meta.gc ? ` · ${esc(t('gc'))} ${esc(meta.gc)}` : ''}</div>
      </div>
      <span class="chip ${started ? 'on' : ''}">${esc(started ? t('inProgress') : t('notStarted'))}</span>
    </div>
    <div class="pct-row"><span class="pct">${pr.pct}%</span><span class="muted">${esc(t('installed'))} · ${pr.total} ${esc(t('items'))}</span></div>
    ${pr.total ? stageBar(pr) : `<div class="muted small">${esc(t('noItems'))}</div>`}
    ${pr.scopes.filter(s => s.total).map(s => `
      <div class="srow"><span>${esc(L(s))}</span><span class="num">${s.count ? `${s.unitsDone}/${s.units} ${esc(s.count)}` : `${s.installed}/${s.total}`}</span></div>`).join('')}
    ${pr.total ? `<div class="wk">${esc(t('thisWeek'))}: ${wkTxt || `<span class="muted">${esc(t('nothingThisWeek'))}</span>`}</div>` : ''}
  </a>`;
}

export function renderHub(store) {
  const who = store.user && store.user.uid;
  if (who && legacyFor !== who) { legacyFor = who; legacy = {}; store.legacy(v => { legacy = v || {}; }); }
  const ids = store.projectIds();
  const cards = ids.map(pid => card(pid, store.project(pid) || {})).join('');
  const old = legacy.cp2 ? `
    <div class="legacy">
      <span class="muted">${esc(t('oldTracker'))}:</span>
      <a href="${esc(legacy.cp2.url || '#')}" target="_blank" rel="noopener">${esc(legacy.cp2.name || 'Cooper Park 2')}</a>
      <b>${typeof legacy.cp2.pct === 'number' ? legacy.cp2.pct + '%' : ''}</b>
    </div>` : '';
  return `
    <section class="hub">
      ${ids.length ? `<div class="cards">${cards}</div>` : `<p class="empty">${esc(t('noProjects'))}</p>`}
      ${old}
    </section>`;
}
