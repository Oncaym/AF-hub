/* ============================================================
   AF Design Board — drawings and review comments, per project.
   ------------------------------------------------------------
   Data (design database, see platform/design-database.rules.json):
     /boardInfo/<b>                 { name, _by, _ts }
     /boards/<b>/drawings/<dkey>    { no, title, scale, rev, owner, status, note }
     /boards/<b>/issues/<id>        { n, dwg, where, text, orig, reviewer, owner,
                                      source, status, imgs{}, thread{}, fixed…, closed… }
     /boards/<b>/history/<push>     { ts, user, desc }      (append only)
     /images/<b>/<id>               { data: 'data:image/jpeg;base64,…' }
   A review comment closes twice: the drafter marks it FIXED, then the
   reviewer CLOSES it (the rules refuse closed unless it was fixed).
   Every save carries _by (the signed-in email) and _ts.
   ============================================================ */
(function () {
  'use strict';
  const DC = window.DC;
  const db = DC.db;

  // ------------------------------------------------------------ constants --
  const DSTAT = [['drafting', 'Drafting'], ['review', 'Internal review'], ['revise', 'Revise'],
    ['submitted', 'Submitted'], ['returned', 'Returned'], ['approved', 'Approved']];
  const DLABEL = Object.fromEntries(DSTAT);
  const ISTAT = { open: 'To fix', ask: 'Ask reviewer', fixed: 'Fixed · to check', closed: 'Closed' };
  const IFILTER = [['active', 'Not closed'], ['open', 'To fix'], ['ask', 'Ask reviewer'], ['fixed', 'Fixed · to check'], ['closed', 'Closed'], ['all', 'All']];
  const SOURCES = [['discord', 'Discord'], ['email', 'Email'], ['person', 'In person'], ['markup', 'PDF markup'], ['claude', 'Claude']];
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';

  // ---------------------------------------------------------------- state --
  const S = {
    boards: {}, board: null, drawings: {}, issues: {}, imgs: {},
    tab: 'review', ifilter: 'active', dfilter: 'all', mine: false, dwg: '', q: '',
    listeners: [],
  };
  /* ?mini=1 is the compact view the desktop helper (AF Helper) shows: my to-do
     first, quick paste, drawing status, hub links. Same data, same rules. */
  let MINI = false;
  try {
    const u = new URLSearchParams(location.search);
    MINI = u.get('mini') === '1';
    if (u.get('tab')) S.tab = u.get('tab');
    if (u.get('mine') === '1' || MINI) S.mine = true;
  } catch (e) {}
  if (MINI) {
    document.body.classList.add('mini');
    const tabs = document.getElementById('tabs');
    tabs.innerHTML = '<button data-tab="review">To-do<span class="n" id="nReview"></span></button><button data-tab="drawings">Drawings<span class="n" id="nDrawings"></span></button><button data-tab="links">Links</button>';
  }
  const helper = window.afHelper || null;   // set by the desktop helper's preload, absent in a browser

  // ---------------------------------------------------------------- utils --
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const dkey = no => String(no || '').trim().replace(/[.#$[\]/]/g, '_');
  const nameOf = e => { e = String(e || ''); return e.includes('@') ? e.split('@')[0] : e; };
  const me = () => DC.email;
  const isMe = v => {
    v = String(v || '').trim().toLowerCase(); if (!v || !me()) return false;
    const m = me().toLowerCase();
    return v === m || v === nameOf(m) || nameOf(v) === nameOf(m);
  };
  const ed = () => DC.isEditor();
  const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const when = t => {
    if (!t) return '';
    const d = new Date(t), now = Date.now(), s = (now - t) / 1000;
    if (s < 60) return 'just now'; if (s < 3600) return Math.floor(s / 60) + ' min ago';
    if (s < 86400) return Math.floor(s / 3600) + ' h ago';
    return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' }) + (d.getFullYear() !== new Date().getFullYear() ? ' ' + d.getFullYear() : '');
  };
  const bref = p => db.ref('boards/' + S.board + '/' + p);
  const stamp = o => Object.assign(o || {}, { _by: me(), _ts: DC.TS });

  let toastT;
  function toast(msg, err) {
    const t = $('#toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : '');
    clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, err ? 6000 : 2500);
  }
  function fail(e) {
    console.error(e);
    toast(/PERMISSION_DENIED|permission/i.test((e && (e.code || e.message)) || '') ? 'Not saved: you can only view this board.' : 'Not saved: ' + ((e && e.message) || e), true);
  }
  function log(desc) { return bref('history').push({ ts: DC.TS, user: me(), desc }).catch(() => {}); }

  // ---------------------------------------------------------------- modal --
  let modalClose = null;
  function openModal(html, opts) {
    opts = opts || {};
    const box = $('#modalBox');
    box.className = 'box' + (opts.wide ? ' wide' : '');
    box.innerHTML = html;
    $('#modal').hidden = false;
    modalClose = opts.onClose || null;
    // Focus now, not later: a delayed focus can jump into a field the person is already typing in.
    const first = box.querySelector('[autofocus]'); if (first) first.focus();
    return box;
  }
  function closeModal() { $('#modal').hidden = true; $('#modalBox').innerHTML = ''; if (modalClose) { const f = modalClose; modalClose = null; f(); } }
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') closeModal(); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape' && !$('#modal').hidden) closeModal(); });

  // --------------------------------------------------------------- images --
  function shrink(blob) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(blob), img = new Image();
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.naturalWidth * k)); c.height = Math.max(1, Math.round(img.naturalHeight * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        let q = 0.85, d = c.toDataURL('image/jpeg', q);
        while (d.length > 1400000 && q > 0.35) { q -= 0.15; d = c.toDataURL('image/jpeg', q); }
        res(d);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('That file is not a picture.')); };
      img.src = url;
    });
  }
  async function saveImages(list) {
    const ids = {};
    for (const data of list) {
      const r = db.ref('images/' + S.board).push();
      await r.set(stamp({ data }));
      ids[r.key] = true;
    }
    return ids;
  }
  function loadImg(id) {
    if (S.imgs[id] !== undefined) return Promise.resolve(S.imgs[id]);
    S.imgs[id] = null;
    return db.ref('images/' + S.board + '/' + id + '/data').once('value').then(s => (S.imgs[id] = s.val()), () => null);
  }
  function fillThumbs(root) {
    (root || document).querySelectorAll('img[data-img]').forEach(el => {
      const id = el.getAttribute('data-img');
      if (el.getAttribute('src')) return;
      loadImg(id).then(d => { if (d) el.src = d; });
    });
  }
  /* Paste (Ctrl+V), drop or pick screenshots into a list of data URLs. */
  function pictureInput(box, list, onChange) {
    const drop = box.querySelector('.drop'), pick = box.querySelector('input[type=file]');
    const add = async files => {
      for (const f of files) {
        if (!/^image\//.test(f.type)) continue;
        try { list.push(await shrink(f)); } catch (e) { toast(e.message, true); }
      }
      onChange();
    };
    box.addEventListener('paste', e => {
      const files = [...(e.clipboardData || {}).items || []].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
      if (files.length) { e.preventDefault(); add(files); }
    });
    if (drop) {
      drop.addEventListener('dragover', e => { e.preventDefault(); drop.classList.add('over'); });
      drop.addEventListener('dragleave', () => drop.classList.remove('over'));
      drop.addEventListener('drop', e => { e.preventDefault(); drop.classList.remove('over'); add([...e.dataTransfer.files]); });
    }
    if (pick) pick.addEventListener('change', () => { add([...pick.files]); pick.value = ''; });
  }
  const pendingThumbs = list => list.map((d, i) => `<span style="position:relative;display:inline-block">${d ? `<img src="${d}" alt="">` : '<span class="ph" title="could not be read"></span>'}<button class="btn small" type="button" data-unpic="${i}" style="position:absolute;top:2px;right:2px;padding:0 6px">×</button></span>`).join('');

  // ---------------------------------------------------------- derived data --
  const issuesArr = () => Object.entries(S.issues).map(([id, v]) => Object.assign({ id }, v));
  const drawingsArr = () => Object.entries(S.drawings).map(([k, v]) => Object.assign({ k }, v)).sort((a, b) => nat(a.no, b.no));
  const nextN = () => 1 + issuesArr().reduce((m, i) => Math.max(m, +i.n || 0), 0);
  function mineIssue(i) {
    if ((i.status === 'open' || i.status === 'ask') && isMe(i.owner)) return true;
    if (i.status === 'fixed' && isMe(i.reviewer)) return true;
    return false;
  }
  const dwgLabel = k => { const d = S.drawings[k]; return d ? d.no : (k || ''); };
  const people = () => {
    const set = new Set([me()]);
    Object.values(S.drawings).forEach(d => d.owner && set.add(d.owner));
    Object.values(S.issues).forEach(i => { [i.owner, i.reviewer, i.createdBy, i.fixedBy].forEach(p => p && set.add(p)); });
    return [...set].filter(Boolean).sort(nat);
  };

  // --------------------------------------------------------------- boards --
  function detach() { S.listeners.forEach(r => r.off()); S.listeners = []; }
  function listen(ref, cb) {
    ref.on('value', s => cb(s.val() || {}), e => { console.error(e); toast('Cannot read this board: ' + (e.code || e.message), true); });
    S.listeners.push(ref);
  }
  function renderBoardPick() {
    const sel = $('#boardPick');
    const ids = Object.keys(S.boards).sort((a, b) => nat(S.boards[a].name || a, S.boards[b].name || b));
    sel.innerHTML = ids.map(id => `<option value="${esc(id)}">${esc(S.boards[id].name || id)}</option>`).join('') +
      (ed() ? '<option value="__new">+ New project board…</option>' : '');
    sel.hidden = !ids.length && !ed();
    if (S.board) sel.value = S.board;
  }
  function selectBoard(id) {
    if (!id || !S.boards[id]) { S.board = null; detach(); render(); return; }
    if (S.board === id && S.listeners.length) return;
    detach();
    S.board = id; S.drawings = {}; S.issues = {}; S.imgs = {}; S.issuesLoaded = false; seenMine = null;
    try { localStorage.setItem('afdesign_board', id); } catch (e) {}
    if (location.hash !== '#b=' + id) history.replaceState(null, '', location.pathname + location.search + '#b=' + id);
    listen(bref('drawings'), v => { S.drawings = v; render(); });
    listen(bref('issues'), v => { S.issues = v; S.issuesLoaded = true; render(); });
    renderBoardPick(); render();
  }
  function newBoard() {
    const box = openModal(`<h2>New project board</h2><div class="form">
      <label>Project name</label><input type="text" id="nbName" placeholder="Hillview" autofocus>
      <label>Short id (letters, numbers, dashes; used in the link)</label><input type="text" id="nbId" placeholder="hillview">
      <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="nbGo">Create</button></div></div>`,
    { onClose: () => renderBoardPick() });
    const nm = box.querySelector('#nbName'), idEl = box.querySelector('#nbId');
    nm.addEventListener('input', () => { if (!idEl.dataset.touched) idEl.value = nm.value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 24); });
    idEl.addEventListener('input', () => { idEl.dataset.touched = 1; });
    box.querySelector('[data-x]').onclick = closeModal;
    box.querySelector('#nbGo').onclick = async () => {
      const id = idEl.value.trim(), name = nm.value.trim();
      if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(id)) { toast('Short id: 2–24 lowercase letters, numbers or dashes.', true); return; }
      if (!name) { toast('Give the project a name.', true); return; }
      if (S.boards[id]) { toast('There is already a board "' + id + '".', true); return; }
      try {
        await db.ref('boardInfo/' + id).set(stamp({ name }));
        S.boards[id] = { name };
        closeModal(); selectBoard(id);
        log('Created the board "' + name + '"');
      } catch (e) { fail(e); }
    };
  }

  // --------------------------------------------------------------- render --
  function render() {
    document.querySelectorAll('#tabs button').forEach(b => b.classList.toggle('on', b.dataset.tab === S.tab));
    const view = $('#view');
    if (!S.board) {
      view.innerHTML = `<div class="empty">${Object.keys(S.boards).length ? 'Pick a project above.' :
        (ed() ? 'No project boards yet. <button class="btn primary" id="firstBoard">+ New project board</button>' : 'No project boards yet.')}</div>`;
      const fb = $('#firstBoard'); if (fb) fb.onclick = newBoard;
      $('#nReview').textContent = ''; $('#nDrawings').textContent = '';
      return;
    }
    const is = issuesArr();
    $('#nReview').textContent = (MINI ? is.filter(mineIssue).length : is.filter(i => i.status !== 'closed').length) || '';
    $('#nDrawings').textContent = Object.keys(S.drawings).length || '';
    const ae = document.activeElement, focusId = ae && (ae.id === 'q' || ae.id === 'askQ') ? ae.id : null;
    const keepFocus = focusId ? ae.selectionStart : null;
    if (S.tab === 'links') renderLinks(view); else if (S.tab === 'drawings') renderDrawings(view); else renderReview(view);
    tellHelper(is);
    if (focusId) { const q = document.getElementById(focusId); if (q) { q.focus(); q.setSelectionRange(keepFocus, keepFocus); } }
    fillThumbs(view);
  }

  function renderLinks(view) {
    const L = [['✏️ Design Board (full page)', './' + (S.board ? '#b=' + S.board : '')], ['🏠 AF Hub — all projects', '../'],
      ['🏢 AC3 tracker', '../ac3/'], ['🏢 355 Lexington tracker', '../lex/'], ['🛠 Takeoff tool', '../takeoff/']];
    view.innerHTML = `<div class="links">${L.map(([t, h]) => `<a class="card" href="${esc(h)}" target="_blank" rel="noopener">${esc(t)}</a>`).join('')}</div>`;
  }
  /* Desktop helper: the badge shows my to-do count; a new item for me pops a notice. */
  let seenMine = null;
  function tellHelper(is) {
    if (!helper) return;
    const mine = is.filter(mineIssue);
    try { helper.setBadge(mine.length); } catch (e) {}
    if (!S.issuesLoaded) return;          // no burst of notices while the board is still loading
    const ids = new Set(mine.map(i => i.id));
    if (seenMine) mine.filter(i => !seenMine.has(i.id)).slice(0, 3).forEach(i => {
      try { helper.notify(i.status === 'fixed' ? `#${i.n} is fixed — please check` : `New for you: #${i.n}`, `${dwgLabel(i.dwg) || ''} ${i.text}`.trim()); } catch (e) {}
    });
    seenMine = ids;
  }

  function tiles(is) {
    if (MINI) return '';
    const c = s => is.filter(i => i.status === s).length;
    const mine = is.filter(mineIssue).length;
    return `<div class="tiles">
      <div class="tile bad" data-f="open"><div class="v">${c('open')}</div><div class="l">To fix</div></div>
      <div class="tile warn" data-f="fixed"><div class="v">${c('fixed')}</div><div class="l">Fixed · waiting for check</div></div>
      <div class="tile info" data-f="ask"><div class="v">${c('ask')}</div><div class="l">Ask reviewer</div></div>
      <div class="tile good" data-f="closed"><div class="v">${c('closed')}</div><div class="l">Closed</div></div>
      <div class="tile" data-mine="1"><div class="v">${mine}</div><div class="l">My to-do</div></div></div>`;
  }

  function renderReview(view) {
    const all = issuesArr();
    const q = S.q.trim().toLowerCase();
    const list = all.filter(i => {
      if (S.ifilter === 'active' ? i.status === 'closed' : S.ifilter !== 'all' && i.status !== S.ifilter) return false;
      if (S.mine && !mineIssue(i)) return false;
      if (S.dwg && i.dwg !== S.dwg) return false;
      if (q && ![i.text, i.orig, i.where, dwgLabel(i.dwg), i.reviewer, i.owner, '#' + i.n].join(' ').toLowerCase().includes(q)) return false;
      return true;
    });
    const cnt = f => all.filter(i => (f === 'active' ? i.status !== 'closed' : f === 'all' || i.status === f)).length;
    const groups = {};
    list.forEach(i => { (groups[i.dwg || ''] = groups[i.dwg || ''] || []).push(i); });
    const keys = Object.keys(groups).sort((a, b) => (a ? 0 : 1) - (b ? 0 : 1) || nat(dwgLabel(a), dwgLabel(b)));
    const dwgOpts = drawingsArr().map(d => `<option value="${esc(d.k)}" ${S.dwg === d.k ? 'selected' : ''}>${esc(d.no)}</option>`).join('');
    view.innerHTML = tiles(all) + `
      <div class="bar">
        <div class="chips">${IFILTER.map(([f, l]) => `<button class="chip ${S.ifilter === f ? 'on' : ''}" data-if="${f}">${l}<span class="n">${cnt(f)}</span></button>`).join('')}
          <button class="chip ${S.mine ? 'on' : ''}" data-mine="1">Mine</button></div>
        <select id="dwgSel"><option value="">All drawings</option>${dwgOpts}</select>
        <input type="search" id="q" placeholder="Search" value="${esc(S.q)}" style="width:150px">
        <span class="grow"></span>
        ${ed() ? '<button class="btn" id="splitBtn" title="Paste a Discord conversation or screenshots; Claude splits it into comments">✨ Paste from Discord</button><button class="btn primary" id="addIssue">+ Add comment</button>' : ''}
      </div>
      ${ed() ? `<form class="bar" id="askForm"><input type="text" id="askQ" placeholder="Ask Claude — e.g. what is left on AC3-103?  ·  mark #3 fixed in rev 2" style="flex:1;min-width:200px" value="${esc(S.askQ || '')}"><button class="btn" type="submit">Ask</button></form><div id="askOut">${S.askHtml || ''}</div>` : ''}` +
      (list.length ? keys.map(k => {
        const d = S.drawings[k];
        return `<div class="group"><h3>${k ? esc(d ? d.no : k) : 'No drawing'}<span class="dim">${d ? esc(d.title || '') : ''}</span></h3>` +
          groups[k].sort((a, b) => (+a.n || 0) - (+b.n || 0)).map(cardHtml).join('') + '</div>';
      }).join('') : `<div class="empty">${all.length ? 'Nothing matches.' : 'No review comments yet.' + (ed() ? ' Tap “+ Add comment” and paste a screenshot.' : '')}</div>`);
  }

  function cardHtml(i) {
    const imgs = Object.keys(i.imgs || {});
    const thread = Object.entries(i.thread || {}).sort((a, b) => (a[1].ts || 0) - (b[1].ts || 0));
    const acts = [];
    if (ed()) {
      if (i.status === 'open') acts.push(['fix', 'Mark fixed', 'ok'], ['ask', 'Ask reviewer', '']);
      if (i.status === 'ask') acts.push(['reopen', 'Back to “to fix”', '']);
      if (i.status === 'fixed') acts.push(['close', 'Checked · close', 'ok'], ['reopen', 'Not fixed · reopen', '']);
      if (i.status === 'closed') acts.push(['reopen', 'Reopen', 'ghost']);
      acts.push(['reply', 'Reply', 'ghost'], ['edit', 'Edit', 'ghost']);
    }
    const meta = [];
    if (i.status === 'fixed' || i.status === 'closed') meta.push(`Fixed by ${esc(nameOf(i.fixedBy))}${i.fixedRev ? ' in rev ' + esc(i.fixedRev) : ''} · ${when(i.fixedAt)}`);
    if (i.status === 'closed') meta.push(`Checked by ${esc(nameOf(i.closedBy))} · ${when(i.closedAt)}`);
    return `<div class="card st-${esc(i.status)}" data-id="${esc(i.id)}">
      <div class="hd"><b>#${esc(i.n)}</b><span class="pill i-${esc(i.status)}">${ISTAT[i.status] || esc(i.status)}</span>
        ${i.where ? `<span>${esc(i.where)}</span>` : ''}
        ${i.reviewer ? `<span>from <b>${esc(nameOf(i.reviewer))}</b></span>` : ''}
        ${i.owner ? `<span>· for <b>${esc(nameOf(i.owner))}</b></span>` : ''}
        <span class="grow"></span><span>${esc((SOURCES.find(s => s[0] === i.source) || [])[1] || '')} ${when(i.created)}</span></div>
      <div class="tx">${esc(i.text)}</div>
      ${i.orig ? `<div class="orig">${esc(i.orig)}</div>` : ''}
      ${imgs.length ? `<div class="thumbs">${imgs.map(id => `<img data-img="${esc(id)}" alt="screenshot">`).join('')}</div>` : ''}
      ${meta.length ? `<div class="meta">${meta.join('<br>')}</div>` : ''}
      ${thread.length ? `<div class="thread">${thread.map(([, r]) => `<div class="r"><span class="by">${esc(nameOf(r.by))} · ${when(r.ts)}</span><br>${esc(r.text || '')}${
        r.imgs ? `<div class="thumbs">${Object.keys(r.imgs).map(id => `<img data-img="${esc(id)}" alt="screenshot">`).join('')}</div>` : ''}</div>`).join('')}</div>` : ''}
      ${acts.length ? `<div class="acts">${acts.map(([a, l, c]) => `<button class="btn small ${c}" data-act="${a}">${l}</button>`).join('')}</div>` : ''}
    </div>`;
  }

  function renderDrawings(view) {
    const ds = drawingsArr(), is = issuesArr();
    const q = S.q.trim().toLowerCase();
    const list = ds.filter(d => (S.dfilter === 'all' || d.status === S.dfilter) && (!S.mine || isMe(d.owner)) &&
      (!q || [d.no, d.title, d.owner, d.note].join(' ').toLowerCase().includes(q)));
    const cnt = f => ds.filter(d => f === 'all' || d.status === f).length;
    const open = k => is.filter(i => i.dwg === k && (i.status === 'open' || i.status === 'ask')).length;
    const check = k => is.filter(i => i.dwg === k && i.status === 'fixed').length;
    const stSel = d => ed() ? `<select data-dst="${esc(d.k)}">${DSTAT.map(([v, l]) => `<option value="${v}" ${d.status === v ? 'selected' : ''}>${l}</option>`).join('')}</select>`
      : `<span class="pill s-${esc(d.status)}">${DLABEL[d.status] || esc(d.status)}</span>`;
    view.innerHTML = `
      <div class="bar">
        <div class="chips">${[['all', 'All']].concat(DSTAT).map(([f, l]) => `<button class="chip ${S.dfilter === f ? 'on' : ''}" data-df="${f}">${l}<span class="n">${cnt(f)}</span></button>`).join('')}
          <button class="chip ${S.mine ? 'on' : ''}" data-mine="1">Mine</button></div>
        <input type="search" id="q" placeholder="Search" value="${esc(S.q)}" style="width:150px">
        <span class="grow"></span>
        ${ed() ? '<button class="btn" id="importPdf">Import drawing list (PDF)</button><button class="btn" id="addDwg">+ Drawing</button>' : ''}
      </div>` + (list.length ? `<div class="wrapx"><table class="tbl"><thead><tr>
        <th>No.</th><th>Title</th><th>Rev</th><th>With</th><th>Status</th><th>Comments</th><th class="hide-s">Updated</th></tr></thead><tbody>${
        list.map(d => `<tr class="row" data-dwg="${esc(d.k)}"><td class="no">${esc(d.no)}</td><td>${esc(d.title || '')}${d.note ? `<div class="dim" style="font-size:12px">${esc(d.note)}</div>` : ''}</td>
          <td>${esc(d.rev || '')}</td><td>${esc(nameOf(d.owner) || '')}</td><td data-stop>${stSel(d)}</td>
          <td>${open(d.k) ? `<a href="#" data-goto="${esc(d.k)}" class="cnt">${open(d.k)} to fix</a>` : ''}${check(d.k) ? ` <a href="#" data-goto="${esc(d.k)}" style="color:var(--yellow)">${check(d.k)} to check</a>` : ''}</td>
          <td class="dim hide-s">${when(d._ts)}${d._by ? ' · ' + esc(nameOf(d._by)) : ''}</td></tr>`).join('')}</tbody></table></div>`
      : `<div class="empty">${ds.length ? 'Nothing matches.' : 'No drawings yet.' + (ed() ? ' Import the drawing list PDF, or add drawings one by one.' : '')}</div>`);
  }

  // --------------------------------------------------------------- events --
  document.addEventListener('click', e => {
    const t = e.target.closest('button, a, tr.row, .tile, img[data-img]');
    if (!t || !$('#app').contains(t)) return;
    if (t.matches('#tabs button')) { S.tab = t.dataset.tab; S.q = ''; render(); return; }
    if (t.dataset.if) { S.ifilter = t.dataset.if; render(); return; }
    if (t.dataset.df) { S.dfilter = t.dataset.df; render(); return; }
    if (t.dataset.mine) { S.mine = !S.mine; if (t.classList.contains('tile')) S.ifilter = 'active'; render(); return; }
    if (t.classList.contains('tile') && t.dataset.f) { S.ifilter = t.dataset.f; S.mine = false; render(); return; }
    if (t.dataset.goto) { e.preventDefault(); S.tab = 'review'; S.dwg = t.dataset.goto; S.ifilter = 'active'; render(); return; }
    if (t.id === 'addIssue') { issueForm(null, { dwg: S.dwg }); return; }
    if (t.id === 'splitBtn') { splitForm(); return; }
    if (t.dataset.doact != null) { doAction(+t.dataset.doact, t); return; }
    if (t.id === 'addDwg') { drawingForm(null); return; }
    if (t.id === 'importPdf') { importPdf(); return; }
    if (t.matches('img[data-img]')) { if (t.src) openModal(`<div class="zoom"><img src="${t.src}" alt=""></div><div class="form"><div class="foot"><button class="btn" data-x>Close</button></div></div>`, { wide: true }).querySelector('[data-x]').onclick = closeModal; return; }
    if (t.matches('tr.row')) { if (e.target.closest('[data-stop]')) return; drawingView(t.dataset.dwg); return; }
    if (t.dataset.act) { const card = t.closest('.card'); issueAction(t.dataset.act, card.dataset.id); }
  });
  document.addEventListener('change', e => {
    const t = e.target;
    if (t.id === 'boardPick') { if (t.value === '__new') newBoard(); else { S.dwg = ''; selectBoard(t.value); } return; }
    if (t.id === 'dwgSel') { S.dwg = t.value; render(); return; }
    if (t.dataset && t.dataset.dst) {
      const d = S.drawings[t.dataset.dst], v = t.value;
      bref('drawings/' + t.dataset.dst).update(stamp({ status: v })).then(() => log(`${d.no}: status ${DLABEL[d.status] || d.status} → ${DLABEL[v]}`), fail);
    }
  });
  document.addEventListener('input', e => {
    if (e.target.id === 'q') { S.q = e.target.value; render(); }
    if (e.target.id === 'askQ') S.askQ = e.target.value;   // keep the draft across re-renders
  });

  // ------------------------------------------------------- comment actions --
  async function issueAction(act, id) {
    const i = S.issues[id]; if (!i) return;
    const ref = bref('issues/' + id), tag = `#${i.n}${i.dwg ? ' (' + dwgLabel(i.dwg) + ')' : ''}`;
    try {
      if (act === 'fix') {
        const d = S.drawings[i.dwg];
        const box = openModal(`<h2>Mark ${esc(tag)} fixed</h2><div class="form">
          <div class="dim">${esc(i.text)}</div>
          <label>Fixed in rev</label><input type="text" id="fxRev" value="${esc(d && d.rev ? d.rev : '')}" autofocus>
          <label>Note (optional)</label><textarea id="fxNote" placeholder="What changed"></textarea>
          <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn ok" id="fxGo">Mark fixed</button></div></div>`);
        box.querySelector('[data-x]').onclick = closeModal;
        box.querySelector('#fxGo').onclick = async () => {
          const rev = box.querySelector('#fxRev').value.trim(), note = box.querySelector('#fxNote').value.trim();
          const upd = stamp({ status: 'fixed', fixedBy: me(), fixedAt: DC.TS, fixedRev: rev || null });
          if (note) upd['thread/' + db.ref().push().key] = { by: me(), ts: DC.TS, text: 'Fixed: ' + note };
          try { await ref.update(upd); closeModal(); log(`${tag} marked fixed${rev ? ' in rev ' + rev : ''}`); toast('Marked fixed. The reviewer closes it after checking.'); } catch (e) { fail(e); }
        };
      } else if (act === 'close') {
        await ref.update(stamp({ status: 'closed', closedBy: me(), closedAt: DC.TS }));
        log(`${tag} checked and closed`);
      } else if (act === 'ask') {
        await ref.update(stamp({ status: 'ask' }));
        log(`${tag} needs the reviewer to explain`);
      } else if (act === 'reopen') {
        const why = i.status === 'fixed' || i.status === 'closed' ? prompt('Why is it reopened? (optional)') : '';
        if (why === null) return;
        const upd = stamp({ status: 'open', closedBy: null, closedAt: null });
        if (why) upd['thread/' + db.ref().push().key] = { by: me(), ts: DC.TS, text: 'Reopened: ' + why };
        await ref.update(upd);
        log(`${tag} reopened${why ? ': ' + why : ''}`);
      } else if (act === 'reply') {
        replyForm(id);
      } else if (act === 'edit') {
        issueForm(id, i);
      }
    } catch (e) { fail(e); }
  }

  function replyForm(id) {
    const i = S.issues[id], pics = [];
    const box = openModal(`<h2>Reply to #${esc(i.n)}</h2><div class="form">
      <div class="dim">${esc(i.text)}</div>
      <label>Reply</label><textarea id="rpTx" autofocus></textarea>
      <div class="thumbs" id="rpPics"></div>
      <div class="drop">Paste a screenshot (Ctrl+V), drop it here, or <label style="display:inline;color:var(--accent-2);cursor:pointer">choose<input type="file" accept="image/*" multiple hidden></label></div>
      <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="rpGo">Send</button></div></div>`);
    const redraw = () => { box.querySelector('#rpPics').innerHTML = pendingThumbs(pics); };
    pictureInput(box, pics, redraw);
    box.addEventListener('click', e => { const u = e.target.closest('[data-unpic]'); if (u) { pics.splice(+u.dataset.unpic, 1); redraw(); } });
    box.querySelector('[data-x]').onclick = closeModal;
    box.querySelector('#rpGo').onclick = async () => {
      const text = box.querySelector('#rpTx').value.trim();
      if (!text && !pics.length) { toast('Write something or paste a screenshot.', true); return; }
      try {
        const r = { by: me(), ts: DC.TS, text };
        if (pics.length) r.imgs = await saveImages(pics);
        await bref('issues/' + id).update(stamp({ ['thread/' + db.ref().push().key]: r }));
        closeModal();
      } catch (e) { fail(e); }
    };
  }

  /* Add (id = null) or edit a review comment. */
  function issueForm(id, init) {
    init = init || {};
    const pics = [];
    const dopts = drawingsArr().map(d => `<option value="${esc(d.k)}" ${init.dwg === d.k ? 'selected' : ''}>${esc(d.no)} — ${esc(d.title || '')}</option>`).join('');
    const ppl = people().map(p => `<option value="${esc(p)}">`).join('');
    const box = openModal(`<h2>${id ? 'Edit #' + esc(init.n) : 'Add review comment'}</h2><div class="form">
      <div class="two"><div><label>Drawing</label><select id="ifDwg"><option value="">— none / general —</option>${dopts}</select></div>
        <div><label>Detail / where</label><input type="text" id="ifWhere" value="${esc(init.where || '')}" placeholder="e.g. Typ. Perimeter Section @ West Sunshade"></div></div>
      <label>What to change</label><textarea id="ifText" autofocus placeholder="One change per comment">${esc(init.text || '')}</textarea>
      <label>Original words (optional, as the reviewer wrote them)</label><textarea id="ifOrig" style="min-height:44px">${esc(init.orig || '')}</textarea>
      <div class="two"><div><label>Reviewer (who asked)</label><input type="text" id="ifRev" list="pplList" value="${esc(init.reviewer || '')}"></div>
        <div><label>For (who fixes it)</label><input type="text" id="ifOwner" list="pplList" value="${esc(init.owner || '')}" placeholder="defaults to who has the drawing"></div></div>
      <datalist id="pplList">${ppl}</datalist>
      <label>Source</label><select id="ifSrc">${SOURCES.map(([v, l]) => `<option value="${v}" ${(init.source || 'discord') === v ? 'selected' : ''}>${l}</option>`).join('')}</select>
      ${id ? '' : `<label>Screenshots</label><div class="thumbs" id="ifPics"></div>
      <div class="drop">Paste a screenshot (Ctrl+V), drop it here, or <label style="display:inline;color:var(--accent-2);cursor:pointer">choose<input type="file" accept="image/*" multiple hidden></label></div>`}
      <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="ifGo">${id ? 'Save' : 'Add comment'}</button></div></div>`);
    const redraw = () => { const el = box.querySelector('#ifPics'); if (el) el.innerHTML = pendingThumbs(pics); };
    if (!id) pictureInput(box, pics, redraw);
    box.addEventListener('click', e => { const u = e.target.closest('[data-unpic]'); if (u) { pics.splice(+u.dataset.unpic, 1); redraw(); } });
    box.querySelector('[data-x]').onclick = closeModal;
    box.querySelector('#ifGo').onclick = async () => {
      const v = s => box.querySelector(s).value.trim();
      const dwg = v('#ifDwg'), text = v('#ifText');
      if (!text) { toast('Write what to change.', true); return; }
      const d = S.drawings[dwg];
      const rec = { dwg: dwg || null, where: v('#ifWhere') || null, text, orig: v('#ifOrig') || null,
        reviewer: v('#ifRev') || null, owner: v('#ifOwner') || (d && d.owner) || null, source: v('#ifSrc') };
      try {
        if (id) {
          await bref('issues/' + id).update(stamp(rec));
          log(`#${init.n} edited`);
        } else {
          const n = nextN();
          if (pics.length) rec.imgs = await saveImages(pics);
          await bref('issues').push().set(stamp(Object.assign(rec, { n, status: 'open', created: DC.TS, createdBy: me() })));
          log(`#${n} added${d ? ' on ' + d.no : ''}`);
        }
        closeModal();
      } catch (e) { fail(e); }
    };
  }

  // ---------------------------------------------------------------- Claude --
  /* Claude reads and proposes; nothing is saved until the person presses a
     button, and then it is saved as that person (the rules apply as usual). */
  function shrinkData(d, max, q) {
    return new Promise(res => {
      const img = new Image();
      img.onload = () => {
        const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight));
        const c = document.createElement('canvas');
        c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k);
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        res(c.toDataURL('image/jpeg', q));
      };
      img.onerror = () => res(d);
      img.src = d;
    });
  }
  function context() {
    return {
      drawings: drawingsArr().map(d => ({ k: d.k, no: d.no, title: d.title, rev: d.rev, owner: d.owner, status: d.status })),
      issues: issuesArr().map(i => ({ id: i.id, n: i.n, dwg: i.dwg, where: i.where, text: i.text, status: i.status, owner: i.owner, reviewer: i.reviewer, fixedRev: i.fixedRev })),
    };
  }
  async function claude(mode, text, images, extra) {
    const token = await DC.idToken();
    const body = Object.assign({ token, board: S.board, mode, text, context: context() }, extra || {});
    if (images && images.length) body.images = await Promise.all(images.filter(Boolean).map(d => shrinkData(d, 1400, 0.75)));
    const r = await fetch('../api/design', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || ('Claude is not available (' + r.status + ')'));
    return j;
  }

  function splitForm() {
    const pics = [];
    let props = [];
    const box = openModal(`<h2>Paste from Discord</h2><div class="form">
      <div class="dim">Paste the conversation (text) and the screenshots — or pull the new messages straight from the board's Discord channel. Claude splits them into one comment per change; you check each one before it is added.</div>
      <label>Conversation / email</label><textarea id="spTx" autofocus style="min-height:110px" placeholder="Copy the messages from Discord and paste here"></textarea>
      <div class="thumbs" id="spPics"></div>
      <div class="drop">Paste screenshots (Ctrl+V), drop them here, or <label style="display:inline;color:var(--accent-2);cursor:pointer">choose<input type="file" accept="image/*" multiple hidden></label></div>
      <div id="spOut"></div>
      <div class="foot"><button class="btn" id="spPull" style="margin-right:auto" title="Reads the messages after the last pull from this board's Discord channel">⬇ Pull new from Discord</button><button class="btn ghost" data-x>Cancel</button><button class="btn" id="spGo">✨ Split into comments</button><button class="btn primary" id="spAdd" hidden>Add</button></div></div>`, { wide: true });
    const redraw = () => { box.querySelector('#spPics').innerHTML = pendingThumbs(pics); };
    pictureInput(box, pics, redraw);
    box.addEventListener('click', e => { const u = e.target.closest('[data-unpic]'); if (u) { pics.splice(+u.dataset.unpic, 1); redraw(); } });
    box.querySelector('[data-x]').onclick = closeModal;
    const dopts = sel => '<option value="">— none —</option>' + drawingsArr().map(d => `<option value="${esc(d.k)}" ${sel === d.k ? 'selected' : ''}>${esc(d.no)} — ${esc(d.title || '')}</option>`).join('');
    const out = box.querySelector('#spOut'), go = box.querySelector('#spGo'), add = box.querySelector('#spAdd');
    let pulledLast = null, pulledMore = false;
    const saveLast = () => (pulledLast ? db.ref('boardInfo/' + S.board).update(stamp({ discordLast: pulledLast })).then(() => { pulledLast = null; }, fail) : Promise.resolve());
    const pull = box.querySelector('#spPull');
    pull.onclick = async () => {
      pull.disabled = true; pull.textContent = 'Reading Discord…'; out.innerHTML = '';
      try {
        const j = await claude('pull', '', null, { after: (S.boards[S.board] || {}).discordLast || null });
        pics.length = 0; (j.images || []).forEach(d => pics.push(d)); redraw();
        box.querySelector('#spTx').value = j.transcript || '';
        pulledLast = j.last_id || null; pulledMore = !!j.more;
        show(j);
        if (!(j.comments || []).length) await saveLast();   // nothing to add: mark these messages as read
      } catch (e) { out.innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; }
      pull.disabled = false; pull.textContent = '⬇ Pull new from Discord';
    };
    go.onclick = async () => {
      const text = box.querySelector('#spTx').value;
      if (!text.trim() && !pics.some(Boolean)) { toast('Paste the conversation or a screenshot first.', true); return; }
      go.disabled = true; go.textContent = 'Claude is reading…'; out.innerHTML = '';
      try { show(await claude('split', text, pics)); } catch (e) { out.innerHTML = `<div class="card" style="color:var(--red)">${esc(e.message)}</div>`; }
      go.disabled = false; go.textContent = '✨ Split again';
    };
    function show(j) {
        props = (j.comments || []).map(c => Object.assign({ images: [] }, c, { dwg: S.drawings[c.dwg] ? c.dwg : '' }));
        out.innerHTML = (j.note ? `<div class="card" style="border-color:var(--yellow)">${esc(j.note)}</div>` : '') +
          (props.length ? props.map((c, i) => `<div class="card" data-pi="${i}">
            <div class="hd"><label><input type="checkbox" class="spOn" checked> <b>Comment ${i + 1}</b></label>
              ${c.already_fixed ? '<span class="pill i-fixed">already fixed</span>' : ''}${c.unclear ? '<span class="pill i-ask">unclear</span>' : ''}
              ${(c.images || []).length ? `<span>screenshot ${(c.images || []).map(n => +n + 1).join(', ')}</span>` : ''}</div>
            <div class="form"><div class="two"><div><label>Drawing</label><select class="spDwg">${dopts(c.dwg)}</select></div>
              <div><label>Detail / where</label><input type="text" class="spWhere" value="${esc(c.where || '')}"></div></div>
            <label>What to change</label><textarea class="spText" style="min-height:48px">${esc(c.text || '')}${c.unclear && c.question ? '\n(Question: ' + esc(c.question) + ')' : ''}</textarea>
            ${c.orig ? `<div class="orig">${esc(c.orig)}</div>` : ''}
            <div class="two"><div><label>Reviewer</label><input type="text" class="spRev" value="${esc(c.reviewer || '')}"></div>
              <div><label>For</label><input type="text" class="spOwner" value="${esc(c.owner || '')}"></div></div>
            <label>Status</label><select class="spSt">
              <option value="open" ${!c.already_fixed && !c.unclear ? 'selected' : ''}>To fix</option>
              <option value="ask" ${c.unclear && !c.already_fixed ? 'selected' : ''}>Ask reviewer</option>
              <option value="fixed" ${c.already_fixed ? 'selected' : ''}>Fixed · to check</option></select></div></div>`).join('')
          : '<div class="empty">Claude found no change requests in this.</div>');
        add.hidden = !props.length; add.textContent = `Add ${props.length} comment${props.length === 1 ? '' : 's'}`;
    }
    box.addEventListener('change', e => { if (e.target.classList.contains('spOn')) { const n = box.querySelectorAll('.spOn:checked').length; add.textContent = `Add ${n} comment${n === 1 ? '' : 's'}`; } });
    add.onclick = async () => {
      const rows = [...box.querySelectorAll('[data-pi]')].filter(r => r.querySelector('.spOn').checked);
      if (!rows.length) { closeModal(); return; }
      add.disabled = true;
      try {
        const used = new Set(); rows.forEach(r => (props[+r.dataset.pi].images || []).forEach(n => used.add(+n)));
        if (rows.length === 1 && !used.size) pics.forEach((_, n) => used.add(n));
        const imgId = {};
        for (const n of [...used].sort()) { if (pics[n]) Object.assign(imgId, { [n]: Object.keys(await saveImages([pics[n]]))[0] }); }
        let n = nextN();
        for (const r of rows) {
          const c = props[+r.dataset.pi], q = s => r.querySelector(s).value.trim();
          const dwg = q('.spDwg'), d = S.drawings[dwg], st = q('.spSt');
          const owner = q('.spOwner') || (d && d.owner) || null;
          const rec = { n: n++, dwg: dwg || null, where: q('.spWhere') || null, text: q('.spText'), orig: c.orig || null,
            reviewer: q('.spRev') || null, owner, source: 'discord', status: st, created: DC.TS, createdBy: me() };
          const ids = {}; (rows.length === 1 && !(c.images || []).length ? Object.keys(imgId) : c.images || []).forEach(k => { if (imgId[k]) ids[imgId[k]] = true; });
          if (Object.keys(ids).length) rec.imgs = ids;
          if (st === 'fixed') Object.assign(rec, { fixedBy: owner || me(), fixedAt: DC.TS, fixedRev: (d && d.rev) || null });
          if (!rec.text) continue;
          await bref('issues').push().set(stamp(rec));
        }
        log(`Added ${rows.length} comments from Discord (split by Claude)`);
        await saveLast();
        closeModal(); toast(rows.length + ' comments added.' + (pulledMore ? ' More Discord messages are waiting: pull again.' : ''));
      } catch (e) { add.disabled = false; fail(e); }
    };
  }

  document.addEventListener('submit', async e => {
    if (e.target.id !== 'askForm') return;
    e.preventDefault();
    const q = $('#askQ').value.trim(); if (!q) return;
    S.askQ = q; S.askHtml = '<div class="card dim">Claude is reading the board…</div>'; render();
    try {
      const j = await claude('ask', q);
      S.actions = (j.actions || []).filter(a => a && a.kind);
      S.askHtml = `<div class="card"><div class="tx">${esc(j.answer || '')}</div>${S.actions.length ? `<div class="acts">${S.actions.map((a, i) =>
        `<button class="btn small ok" data-doact="${i}">${esc(a.why || a.kind)}</button>`).join('')}</div><div class="meta">Nothing changes until you press a button.</div>` : ''}</div>`;
    } catch (err) { S.askHtml = `<div class="card" style="color:var(--red)">${esc(err.message)}</div>`; }
    render();
  });
  async function doAction(i, btn) {
    const a = (S.actions || [])[i]; if (!a) return;
    btn.disabled = true;
    try {
      if (a.kind === 'comment_status') {
        const c = S.issues[a.id];
        if (!c) throw new Error('That comment is not on this board.');
        const st = a.status, upd = stamp({ status: st });
        if (st === 'fixed') Object.assign(upd, { fixedBy: me(), fixedAt: DC.TS, fixedRev: a.rev || (S.drawings[c.dwg] || {}).rev || null });
        else if (st === 'closed') { if (c.status !== 'fixed') throw new Error(`#${c.n} must be marked fixed before it can be closed.`); Object.assign(upd, { closedBy: me(), closedAt: DC.TS }); }
        else if (st === 'open' || st === 'ask') Object.assign(upd, { closedBy: null, closedAt: null });
        else throw new Error('Unknown status ' + st);
        await bref('issues/' + a.id).update(upd);
        log(`#${c.n} → ${ISTAT[st]} (asked Claude)`);
      } else if (a.kind === 'drawing_status' || a.kind === 'drawing_owner') {
        const d = S.drawings[a.dwg];
        if (!d) throw new Error('That drawing is not on this board.');
        if (a.kind === 'drawing_status' && !DLABEL[a.status]) throw new Error('Unknown status ' + a.status);
        const upd = a.kind === 'drawing_status' ? { status: a.status } : { owner: a.owner || null };
        await bref('drawings/' + a.dwg).update(stamp(upd));
        log(`${d.no}: ${a.kind === 'drawing_status' ? 'status → ' + DLABEL[a.status] : 'now with ' + (a.owner || 'nobody')} (asked Claude)`);
      }
      btn.textContent = '✓ ' + btn.textContent; S.askHtml = $('#askOut') ? $('#askOut').innerHTML : S.askHtml;
    } catch (e) { btn.disabled = false; fail(e); }
  }

  // -------------------------------------------------------------- drawings --
  function drawingForm(k) {
    const d = k ? S.drawings[k] : {};
    const box = openModal(`<h2>${k ? esc(d.no) : 'Add drawing'}</h2><div class="form">
      <div class="two"><div><label>No.</label><input type="text" id="dfNo" value="${esc(d.no || '')}" ${k ? 'disabled' : 'autofocus'}></div>
        <div><label>Rev</label><input type="text" id="dfRev" value="${esc(d.rev || '')}"></div></div>
      <label>Title</label><input type="text" id="dfTitle" value="${esc(d.title || '')}">
      <div class="two"><div><label>With (who has it now)</label><input type="text" id="dfOwner" list="pplList2" value="${esc(d.owner || '')}"></div>
        <div><label>Status</label><select id="dfSt">${DSTAT.map(([v, l]) => `<option value="${v}" ${(d.status || 'drafting') === v ? 'selected' : ''}>${l}</option>`).join('')}</select></div></div>
      <datalist id="pplList2">${people().map(p => `<option value="${esc(p)}">`).join('')}</datalist>
      <label>Scale</label><input type="text" id="dfScale" value="${esc(d.scale || '')}">
      <label>Note</label><input type="text" id="dfNote" value="${esc(d.note || '')}" placeholder="e.g. waiting for architect on sill height">
      <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="dfGo">Save</button></div></div>`);
    box.querySelector('[data-x]').onclick = () => (k ? drawingView(k) : closeModal());
    box.querySelector('#dfGo').onclick = async () => {
      const v = s => box.querySelector(s).value.trim();
      const no = k ? d.no : v('#dfNo');
      if (!no) { toast('Drawing number?', true); return; }
      const key = k || dkey(no);
      if (!k && S.drawings[key]) { toast(no + ' is already on the list.', true); return; }
      const rec = { no, title: v('#dfTitle'), rev: v('#dfRev'), owner: v('#dfOwner') || null, status: v('#dfSt'), scale: v('#dfScale'), note: v('#dfNote') || null };
      const ch = k ? Object.keys(rec).filter(f => (rec[f] || '') !== (d[f] || '')).map(f => `${f} ${d[f] || '–'} → ${rec[f] || '–'}`) : [];
      try {
        await bref('drawings/' + key).update(stamp(rec));
        log(k ? `${no}: ${ch.join(', ') || 'saved'}` : `${no} added`);
        k ? drawingView(k) : closeModal();
      } catch (e) { fail(e); }
    };
  }

  function drawingView(k) {
    const d = S.drawings[k]; if (!d) return;
    const is = issuesArr().filter(i => i.dwg === k).sort((a, b) => (+a.n || 0) - (+b.n || 0));
    const byRev = {};
    is.filter(i => i.status === 'fixed' || i.status === 'closed').forEach(i => { (byRev[i.fixedRev || '?'] = byRev[i.fixedRev || '?'] || []).push(i); });
    const revs = Object.keys(byRev).sort(nat).reverse();
    const line = i => `<div style="padding:3px 0"><span class="pill i-${esc(i.status)}">${ISTAT[i.status]}</span> <b>#${esc(i.n)}</b> ${esc(i.text)}</div>`;
    const box = openModal(`<h2>${esc(d.no)} <span class="dim" style="font-weight:400">${esc(d.title || '')}</span></h2>
      <div class="dim">Rev ${esc(d.rev || '–')} · with ${esc(nameOf(d.owner) || 'nobody')} · <span class="pill s-${esc(d.status)}">${DLABEL[d.status] || esc(d.status)}</span>${d.note ? ' · ' + esc(d.note) : ''}</div>
      <h3 style="font-size:14px;margin:14px 0 4px">Open comments</h3>
      ${is.filter(i => i.status !== 'closed' && i.status !== 'fixed').map(line).join('') || '<div class="dim">None.</div>'}
      <h3 style="font-size:14px;margin:14px 0 4px">Fixed · waiting for check</h3>
      ${is.filter(i => i.status === 'fixed').map(line).join('') || '<div class="dim">None.</div>'}
      <h3 style="font-size:14px;margin:14px 0 4px">What changed, by rev</h3>
      ${revs.map(r => `<div style="margin:6px 0"><b>Rev ${esc(r)}</b>${byRev[r].map(line).join('')}</div>`).join('') || '<div class="dim">Nothing marked fixed yet.</div>'}
      <div class="form"><div class="foot">
        ${ed() ? '<button class="btn" id="dvEdit">Edit drawing</button><button class="btn primary" id="dvAdd">+ Comment on this drawing</button>' : ''}
        <button class="btn" id="dvList">Show in review list</button><button class="btn ghost" data-x>Close</button></div></div>`, { wide: true });
    box.querySelector('[data-x]').onclick = closeModal;
    box.querySelector('#dvList').onclick = () => { closeModal(); S.tab = 'review'; S.dwg = k; S.ifilter = 'all'; render(); };
    if (ed()) {
      box.querySelector('#dvEdit').onclick = () => drawingForm(k);
      box.querySelector('#dvAdd').onclick = () => issueForm(null, { dwg: k });
    }
  }

  // ------------------------------------------------------ drawing list PDF --
  /* Rows of a drawing list from PDF text items [{s, x, y, p}]: a drawing number
     in the DWG# column, then the title, scale and rev on the same line. The
     column edges come from the TITLE / SCALE / REV headers when the sheet has them. */
  function parseDrawingList(items) {
    const NO = /^[A-Z0-9]{1,8}-[A-Z0-9]{1,6}$/;
    const out = [], seen = new Set();
    const pages = [...new Set(items.map(i => i.p))];
    for (const p of pages) {
      const its = items.filter(i => i.p === p && i.s);
      // Headers: DWG# then TITLE / SCALE / REV on the same line, to its right.
      const hDwg = its.find(i => /^DWG\.?\s*(#|NO\.?)$/i.test(i.s));
      const onHdr = re => (hDwg ? its.find(i => re.test(i.s) && Math.abs(i.y - hDwg.y) < 4 && i.x > hDwg.x) : null);
      const hScale = onHdr(/^SCALE$/i), hRev = onHdr(/^REV\.?\s*(#|NO\.?)?$/i);
      // Under a DWG# header any NO-shaped text counts (A-CS cover sheets have no digit);
      // without one, require a digit so abbreviations like "W-O" are not taken.
      let nos = its.filter(i => NO.test(i.s) && (hDwg || /\d/.test(i.s)));
      if (!nos.length) continue;
      let colX;
      if (hDwg) colX = hDwg.x;
      else {
        const votes = {};
        nos.forEach(i => { const k = Math.round(i.x / 6); votes[k] = (votes[k] || 0) + 1; });
        colX = 6 * +Object.keys(votes).sort((a, b) => votes[b] - votes[a])[0];
      }
      nos = nos.filter(i => Math.abs(i.x - colX) <= 15 && (!hDwg || i.y < hDwg.y));
      const scaleX = hScale ? hScale.x - 45 : Infinity, revX = hRev ? hRev.x - 12 : Infinity;
      const titleEnd = Math.min(scaleX, revX);
      for (const n of nos) {
        if (seen.has(n.s)) continue;
        const row = its.filter(o => o !== n && Math.abs(o.y - n.y) < 3 && o.x > n.x).sort((a, b) => a.x - b.x);
        let title, scale = '', rev = '';
        if (titleEnd < Infinity) {
          title = row.filter(o => o.x < titleEnd).map(o => o.s).join(' ');
          scale = row.filter(o => o.x >= scaleX && o.x < revX).map(o => o.s).join(' ');
          rev = row.filter(o => o.x >= revX && o.x < revX + 70).map(o => o.s).join(' ');
        } else {
          const near = row.filter(o => o.x < n.x + 700);
          const si = near.findIndex(o => /^(NTS|N\.T\.S\.?|AS NOTED|\d[\d\-/ ]*"\s*=\s*1'-0")$/i.test(o.s));
          title = (si >= 0 ? near.slice(0, si) : near).map(o => o.s).join(' ');
          scale = si >= 0 ? near[si].s : '';
        }
        title = title.replace(/\s+/g, ' ').trim();
        if (!title) continue;
        seen.add(n.s);
        out.push({ no: n.s, title, scale: scale.replace(/\s+/g, ' ').trim(), rev: rev.trim() });
      }
    }
    return out.sort((a, b) => nat(a.no, b.no));
  }
  window.DesignBoard = { parseDrawingList };

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }
  async function pdfItems(file) {
    await loadScript(PDFJS + 'pdf.min.js');
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
    const items = [];
    for (let p = 1; p <= pdf.numPages; p++) {
      const tc = await (await pdf.getPage(p)).getTextContent();
      tc.items.forEach(it => { const s = String(it.str || '').trim(); if (s) items.push({ s, x: it.transform[4], y: it.transform[5], p }); });
    }
    return items;
  }
  function importPdf() {
    const box = openModal(`<h2>Import drawing list</h2><div class="form">
      <div class="dim">Pick the drawing list PDF (the sheet with DWG# · TITLE · SCALE). Nothing is saved until you check the list and press Import.</div>
      <div class="drop" style="margin-top:10px"><label style="color:var(--accent-2);cursor:pointer">Choose PDF<input type="file" accept="application/pdf" hidden id="ipFile"></label></div>
      <div id="ipOut" style="margin-top:10px"></div>
      <div class="foot"><button class="btn ghost" data-x>Cancel</button><button class="btn primary" id="ipGo" disabled>Import</button></div></div>`, { wide: true });
    let rows = [];
    box.querySelector('[data-x]').onclick = closeModal;
    box.querySelector('#ipFile').addEventListener('change', async ev => {
      const f = ev.target.files[0]; if (!f) return;
      const out = box.querySelector('#ipOut'); out.innerHTML = '<div class="dim">Reading…</div>';
      try { rows = parseDrawingList(await pdfItems(f)); } catch (e) { out.innerHTML = `<div style="color:var(--red)">${esc(e.message)}</div>`; return; }
      if (!rows.length) { out.innerHTML = '<div style="color:var(--red)">No drawing numbers found in this PDF.</div>'; return; }
      const st = r => { const d = S.drawings[dkey(r.no)]; return !d ? 'new' : (d.title !== r.title || (d.scale || '') !== r.scale) ? 'changed' : 'same'; };
      out.innerHTML = `<div class="dim">${rows.length} drawings · ${rows.filter(r => st(r) === 'new').length} new · ${rows.filter(r => st(r) === 'changed').length} changed</div>
        <div class="wrapx" style="max-height:50vh;overflow-y:auto;margin-top:6px"><table class="tbl"><thead><tr><th></th><th>No.</th><th>Title</th><th>Scale</th><th></th></tr></thead><tbody>${
        rows.map((r, i) => `<tr><td><input type="checkbox" data-ri="${i}" ${st(r) === 'same' ? '' : 'checked'}></td><td class="no">${esc(r.no)}</td><td>${esc(r.title)}</td><td class="dim">${esc(r.scale)}</td><td class="dim">${st(r)}</td></tr>`).join('')}</tbody></table></div>`;
      box.querySelector('#ipGo').disabled = false;
    });
    box.querySelector('#ipGo').onclick = async () => {
      const pick = [...box.querySelectorAll('input[data-ri]:checked')].map(c => rows[+c.dataset.ri]);
      if (!pick.length) { closeModal(); return; }
      const upd = {};
      pick.forEach(r => {
        const k = dkey(r.no), d = S.drawings[k];
        const base = d ? {} : { no: r.no, status: 'drafting' };
        Object.assign(base, { title: r.title, scale: r.scale || null });
        Object.keys(base).forEach(f => { upd[k + '/' + f] = base[f]; });
        upd[k + '/_by'] = me(); upd[k + '/_ts'] = DC.TS;
      });
      try {
        await bref('drawings').update(upd);
        log(`Imported ${pick.length} drawings from the drawing list`);
        closeModal(); toast(pick.length + ' drawings imported.');
      } catch (e) { fail(e); }
    };
  }

  // -------------------------------------------------------------- history --
  $('#histBtn').onclick = async () => {
    if (!S.board) return;
    const box = openModal('<h2>History</h2><div class="hist" id="hList"><div class="dim">Loading…</div></div><div class="form"><div class="foot"><button class="btn" data-x>Close</button></div></div>', { wide: true });
    box.querySelector('[data-x]').onclick = closeModal;
    try {
      const v = (await bref('history').orderByChild('ts').limitToLast(150).once('value')).val() || {};
      const rows = Object.values(v).sort((a, b) => (b.ts || 0) - (a.ts || 0));
      box.querySelector('#hList').innerHTML = rows.map(r => `<div><span class="dim">${new Date(r.ts).toLocaleString()} · ${esc(nameOf(r.user))}</span><br>${esc(r.desc)}</div>`).join('') || '<div class="dim">Nothing yet.</div>';
    } catch (e) { box.querySelector('#hList').textContent = 'Cannot read history: ' + (e.code || e.message); }
  };

  // ------------------------------------------------------------------ help --
  $('#helpBtn').onclick = () => {
    openModal(`<h2>How the Design Board works</h2><div class="hist" style="font-size:14px;line-height:1.55">
      <p><b>One comment = one change</b>, on one drawing. Each comment closes <b>twice</b>:</p>
      <ol><li>The drafter fixes it and presses <b>Mark fixed</b> (with the rev it is in).</li>
      <li>The reviewer checks the drawing and presses <b>Checked · close</b> — or <b>Not fixed · reopen</b>.</li></ol>
      <p>A ✅ in Discord only means “seen”. Nothing is closed until the reviewer closes it here.</p>
      <p><b>Adding comments</b></p>
      <ul><li><b>+ Add comment</b>: pick the drawing, write the change, paste a screenshot with Ctrl+V.</li>
      <li><b>✨ Paste from Discord</b>: paste the conversation and the screenshots; Claude splits them into comments. You check each one before it is added.</li>
      <li><b>⬇ Pull new from Discord</b> (inside that window): reads the new messages in this project's Discord channel by itself, once the bot is set up.</li></ul>
      <p><b>Finding your work</b>: <b>My to-do</b> / <b>Mine</b> = comments you must fix, plus fixed ones waiting for your check. Click a drawing to see its comments and <i>what changed in each rev</i>.</p>
      <p><b>Ask Claude</b> (box above the list): “what is left on AC3-103?”, “what changed in rev 3?”, “mark #3 fixed in rev 2”. Claude only suggests; a change happens when you press its button.</p>
      <p><b>On your desktop</b>: the AF Helper round button opens a small version of this page (Ctrl+Shift+Space). Its red number is your to-do count.</p>
      <p class="dim">Every change is saved with your name — see History.</p></div>
      <div class="form"><div class="foot"><button class="btn primary" data-x>Got it</button></div></div>`, { wide: true }).querySelector('[data-x]').onclick = closeModal;
  };

  // ----------------------------------------------------------------- theme --
  try { if (localStorage.getItem('afdesign_theme') === 'day') document.body.classList.add('day-mode'); } catch (e) {}
  $('#themeBtn').onclick = () => {
    const day = document.body.classList.toggle('day-mode');
    try { localStorage.setItem('afdesign_theme', day ? 'day' : 'dark'); } catch (e) {}
  };
  $('#outBtn').onclick = () => DC.signOut();

  // ----------------------------------------------------------------- start --
  let boardsRef = null;
  DC.onReady(() => {
    $('#who').innerHTML = `${esc(DC.email)} <span class="role">${ed() ? 'editor' : 'view only'}</span>`;
    $('#outBtn').hidden = false; $('#histBtn').hidden = false;
    if (boardsRef) boardsRef.off();
    boardsRef = db.ref('boardInfo');
    boardsRef.on('value', s => {
      S.boards = s.val() || {};
      renderBoardPick();
      if (!S.board || !S.boards[S.board]) {
        let want = (location.hash.match(/b=([a-z0-9-]+)/) || [])[1];
        if (!want) { try { want = localStorage.getItem('afdesign_board'); } catch (e) {} }
        const ids = Object.keys(S.boards).sort();
        selectBoard(S.boards[want] ? want : ids[0]);
      }
      render();
    }, e => toast('Cannot read the board list: ' + (e.code || e.message), true));
  });
  DC.onSignedOut(() => {
    detach(); if (boardsRef) { boardsRef.off(); boardsRef = null; }
    S.board = null; S.boards = {}; S.drawings = {}; S.issues = {}; S.imgs = {};
    $('#who').textContent = ''; $('#outBtn').hidden = true; $('#histBtn').hidden = true; $('#boardPick').hidden = true;
  });
})();
