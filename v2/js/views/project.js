/* One project: progress at the top, then the plan (or an elevation) and the
   pieces on it, grouped. Tap a shape or a row to open its sheet. */
import { t, L } from '../i18n.js';
import { esc, $, fmtDate } from '../ui.js';
import { progress, stageOf, groupItems, thisWeek } from '../model.js';
import { stageBar } from './hub.js';
import { panzoom } from '../panzoom.js';
import { renderSheet, wireSheet } from './sheet.js';

const elevCache = {};
async function elevBase(url) {
  if (!(url in elevCache)) elevCache[url] = fetch(url).then(r => r.ok ? r.text() : '').catch(() => '');
  return elevCache[url];
}

export function mountProject(el, store, route) {
  const pid = route.pid;
  let r = route, q = '', pz = null, shownKey = '';

  el.innerHTML = `
    <section class="project">
      <div id="p-head"></div>
      <nav class="tabs" id="p-tabs"></nav>
      <div id="p-progress">
        <div class="viewbar" id="p-viewbar"></div>
        <div class="stage-area">
          <div class="viewport" id="p-viewport"><div class="content" id="p-content"></div></div>
          <div class="zoom"><button class="btn ghost sm" data-z="in">＋</button><button class="btn ghost sm" data-z="out">－</button><button class="btn ghost sm" data-z="reset">⤢</button></div>
        </div>
        <div class="listbar"><input type="search" id="p-q" placeholder="${esc(t('search'))}"><span class="muted" id="p-count"></span></div>
        <div class="list" id="p-list"></div>
      </div>
      <div id="p-other" class="other" hidden></div>
      <div id="p-sheet"></div>
    </section>`;

  const P = () => store.project(pid) || {};
  const role = () => store.roleFor(pid);
  const link = (extra = {}) => {
    const qs = new URLSearchParams();
    const f = extra.f !== undefined ? extra.f : r.q.f; const e = extra.e !== undefined ? extra.e : r.q.e;
    const tab = extra.tab !== undefined ? extra.tab : r.q.tab;
    if (f) qs.set('f', f); if (e) qs.set('e', e); if (tab && tab !== 'progress') qs.set('tab', tab);
    const iid = extra.iid !== undefined ? extra.iid : '';
    return `#/p/${pid}${iid ? '/i/' + encodeURIComponent(iid) : ''}${qs.toString() ? '?' + qs : ''}`;
  };

  function defaultFloor(meta, items) {
    const floors = meta.floors || [];
    const withItems = floors.find(f => Object.values(items).some(i => i.floor === f.key));
    return (withItems || floors[0] || {}).key || '';
  }

  function head(meta, items) {
    const pr = progress(meta, items);
    const wk = thisWeek(meta, items);
    $('#p-head', el).innerHTML = `
      <div class="phead">
        <div class="phead-row">
          <div>
            <h1>${esc(meta.name)}</h1>
            <div class="muted">${esc(t('pm'))} ${esc(meta.pm || '—')}${meta.gc ? ` · ${esc(t('gc'))} ${esc(meta.gc)}` : ''}${role() && !['admin', 'pm', 'editor', 'field'].includes(role()) ? ` · ${esc(t('readOnly'))}` : ''}</div>
          </div>
          <div class="bigpct"><span>${pr.pct}%</span><small>${esc(t('installed'))}</small></div>
        </div>
        ${pr.total ? stageBar(pr, 'big') : ''}
        <div class="legend"><span class="dot installed"></span>${esc(t('installed'))} <span class="dot site"></span>${esc(t('site'))} <span class="dot factory"></span>${esc(t('factory'))} <span class="dot none"></span>${esc(t('none'))}</div>
        <div class="scopes">
          ${pr.scopes.filter(s => s.total).map(s => `
            <div class="scope">
              <div class="scope-top"><span class="scope-name">${esc(L(s))}</span>
                <span class="num">${s.count ? `${s.unitsDone}/${s.units} ${esc(s.count)}` : `${s.installed}/${s.total}`}${wk[s.key] ? ` <em class="wkn">+${wk[s.key]}</em>` : ''}</span></div>
              ${stageBar(s.factory_ !== undefined ? { total: s.total, installed: s.installed, site: s.site, factory: s.factory_ } : s)}
            </div>`).join('')}
        </div>
        ${meta.note ? `<p class="note">${esc(meta.note)}</p>` : ''}
      </div>`;
  }

  function tabs() {
    const cur = r.q.tab || 'progress';
    $('#p-tabs', el).innerHTML = ['progress', 'log', 'rfi', 'submittals'].map(k =>
      `<a class="tab${cur === k ? ' on' : ''}" href="${link({ tab: k })}">${esc(t(k === 'progress' ? 'progressTab' : k))}</a>`).join('');
    $('#p-progress', el).hidden = cur !== 'progress';
    const other = $('#p-other', el);
    other.hidden = cur === 'progress';
    if (cur !== 'progress') other.innerHTML = `<p class="empty">${esc(t('comingNext'))}</p>`;
  }

  function viewbar(meta, items) {
    const counts = {};
    Object.values(items).forEach(i => { counts[i.floor] = (counts[i.floor] || 0) + 1; });
    const f = r.q.e ? '' : (r.q.f || defaultFloor(meta, items));
    const floors = meta.floors || [];
    const elevs = Object.entries(meta.elevations || {});
    $('#p-viewbar', el).innerHTML = `
      ${floors.length > 1 || elevs.length ? `<span class="vb-label">${esc(t('floors'))}</span>` : ''}
      ${floors.map(fl => `<a class="fchip${fl.key === f ? ' on' : ''}${counts[fl.key] ? '' : ' empty'}" href="${link({ f: fl.key, e: '' })}">${esc(fl.key)}${counts[fl.key] ? `<small>${counts[fl.key]}</small>` : ''}</a>`).join('')}
      ${elevs.length ? `<span class="vb-label">${esc(t('elevations'))}</span>` + elevs.map(([k]) => `<a class="fchip${r.q.e === k ? ' on' : ''}" href="${link({ e: k, f: '' })}">${esc(k)}</a>`).join('') : ''}`;
    const on = $('.fchip.on', el); if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  /* The drawing: a floor plan with shapes over it, or an elevation with its parts. */
  async function drawing(meta, items) {
    const e = r.q.e;
    const f = e ? '' : (r.q.f || defaultFloor(meta, items));
    const key = e ? 'e:' + e : 'f:' + f;
    const content = $('#p-content', el), vp = $('#p-viewport', el);
    if (key !== shownKey) {
      shownKey = key;
      if (e) {
        const E = (meta.elevations || {})[e] || {};
        const base = await elevBase(E.base);
        if (shownKey !== key) return;
        content.innerHTML = `<svg class="elev" viewBox="${esc(E.viewBox)}" preserveAspectRatio="xMidYMid meet"><g class="elev-base">${base}</g><g id="p-shapes"></g></svg>`;
              } else {
        const fl = (meta.floors || []).find(x => x.key === f) || {};
        content.style.width = ''; content.style.height = '';
        content.innerHTML = fl.plan
          ? `<div class="plan"><img src="${esc(fl.plan)}" alt="${esc(fl.label || f)}" draggable="false"><svg class="overlay" viewBox="0 0 1 1" preserveAspectRatio="none"><g id="p-shapes"></g></svg></div>`
          : `<div class="plan placeholder"><div>${esc(t('noPlan'))}</div></div>`;
        const img = $('img', content);
        if (img) img.addEventListener('load', () => pz && pz.reset(), { once: true });
      }
      pz = panzoom(vp, content);
    }
    const g = $('#p-shapes', el);
    if (!g) return;
    const issues = (P().issues) || {};
    const list = Object.entries(items).filter(([, it]) => e ? it.elev === e : (it.floor === f && it.geo && it.geo.t !== 'rect'));
    g.innerHTML = list.map(([id, it]) => shape(id, it, issues[id], r.iid === id)).join('');
    const hint = !e && list.length === 0 && Object.values(items).some(it => it.floor === f && it.scope === 'frame') ? t('positionsPending') : '';
    let h = $('.plan-hint', el); if (!h) { h = document.createElement('div'); h.className = 'plan-hint'; vp.parentNode.appendChild(h); }
    h.textContent = hint; h.hidden = !hint;
  }

  function shape(id, it, issue, sel) {
    const cls = `shp ${stageOf(it)}${issue ? ' issue' : ''}${sel ? ' sel' : ''}`;
    const g = it.geo || {};
    const a = `data-iid="${esc(id)}"`;
    if (g.t === 'rect') {
      return `<rect ${a} class="${cls}" x="${g.x}" y="${g.y}" width="${g.w}" height="${g.h}"><title>${esc(it.label)}</title></rect>`;
    }
    if (g.t === 'poly') {
      return g.polys.map(p => {
        const pts = p.map(q => q.join(',')).join(' ');
        return `<polygon ${a} class="hit" points="${pts}"/><polygon ${a} class="${cls}" points="${pts}"><title>${esc(it.label)}</title></polygon>`;
      }).join('');
    }
    if (g.t === 'lines') {
      return g.lines.map(l => {
        const pts = l.map(q => q.join(',')).join(' ');
        return `<polyline ${a} class="hit" points="${pts}"/><polyline ${a} class="${cls} line" points="${pts}"><title>${esc(it.label)}</title></polyline>`;
      }).join('');
    }
    return '';
  }

  function listView(meta, items) {
    const e = r.q.e;
    const f = e ? '' : (r.q.f || defaultFloor(meta, items));
    const groups = groupItems(items, { floor: e ? '' : f, elev: e, q });
    const issues = (P().issues) || {};
    const scopeLabel = Object.fromEntries((meta.scopes || []).map(s => [s.key, L(s)]));
    let n = 0;
    const html = groups.map(([g, rows]) => {
      n += rows.length;
      const done = rows.filter(([, it]) => stageOf(it) === 'installed').length;
      const open = q || groups.length === 1 || rows.length <= 12;
      return `<details class="grp"${open ? ' open' : ''}><summary><span>${esc(g)}</span><span class="muted">${done}/${rows.length}</span></summary>
        ${rows.map(([id, it]) => {
          const st = stageOf(it);
          const d = it.st && it.st[st] && it.st[st].d;
          return `<a class="row${r.iid === id ? ' sel' : ''}" href="${link({ iid: id })}">
            <span class="dot ${st}"></span>
            <span class="lbl">${esc(it.label)}</span>
            <span class="muted sc">${esc(scopeLabel[it.scope] || it.scope)}</span>
            ${it.qty ? `<span class="qty">${Math.min(it.qd || 0, it.qty.n)}/${it.qty.n}</span>` : ''}
            ${issues[id] ? '<span class="flag" title="issue">!</span>' : ''}
            <span class="when muted">${d ? esc(fmtDate(d)) : ''}</span>
          </a>`;
        }).join('')}</details>`;
    }).join('');
    $('#p-list', el).innerHTML = html || `<p class="empty">${esc(Object.keys(items).length ? '—' : t('noItems'))}</p>`;
    $('#p-count', el).textContent = n ? `${n} ${t('items')}` : '';
  }

  function sheet() {
    const box = $('#p-sheet', el);
    if (!r.iid) { box.innerHTML = ''; box.className = ''; return; }
    if (box.contains(document.activeElement) && document.activeElement.tagName === 'TEXTAREA') return;   // don't wipe what they are typing
    box.className = 'sheet-wrap';
    box.innerHTML = renderSheet(store, pid, r.iid, link({ iid: '' }));
  }

  async function update(route) {
    if (route) r = route;
    const { meta, items = {} } = P();
    if (!meta) { $('#p-head', el).innerHTML = '<div class="phead"><p class="muted">…</p></div>'; return; }
    head(meta, items); tabs(); viewbar(meta, items); listView(meta, items); sheet();
    await drawing(meta, items);
  }

  // events
  el.addEventListener('click', e => {
    const s = e.target.closest('[data-iid]');
    if (s && s.closest('#p-content')) { location.hash = link({ iid: s.dataset.iid }); return; }
    const z = e.target.closest('[data-z]');
    if (z && pz) { z.dataset.z === 'in' ? pz.zoom(1.6) : z.dataset.z === 'out' ? pz.zoom(1 / 1.6) : pz.reset(); }
  });
  $('#p-q', el).addEventListener('input', e => { q = e.target.value; const { meta, items = {} } = P(); if (meta) listView(meta, items); });
  wireSheet(el, store, pid, () => r.iid);

  update(route);
  return { pid, update };
}
