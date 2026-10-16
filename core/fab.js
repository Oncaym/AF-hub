/* ============================================================
   Fab drawings (Leo, 2026-10-16)
   ------------------------------------------------------------
   The shop and the site could not find a fab drawing without phoning Leo.
   Each project now keeps its fab PDFs here, for everyone on the project
   except the GC (rules: /fab is read by editors, viewers and staff only).

   Upload (editors): drop the PDFs. In the browser, pdf.js reads every
   page's text and files the page under each unit id of this project that is
   printed on it (CP2's sheets say "TAG SF40"), and draws the page to a JPEG
   so a phone can open one sheet without downloading a whole set. PDF and
   page images go to p/<project>/fab/<id>/ in the shared bucket; only their
   links go in the database (/fab/<id>), the same way photos work.

   "Latest" is by upload time. For a unit, the newest upload that shows it
   is the current sheet; older uploads stay listed as older. The sheets
   carry no revision number, so upload order is the only honest signal.

   The top half is pure (no DOM) and is require()d by the tests.
   ============================================================ */
(function (root) {
  'use strict';

  const up = s => String(s == null ? '' : s).trim().toUpperCase();
  const reEsc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

  /** A function text -> [unit ids printed in it]. A unit counts only as a
      whole token: "SF20A" is not SF20, but "SF30-L" and "SF12A.1" are
      SF30 and SF12A. */
  function tagMatcher(ids) {
    const list = [...new Set((ids || []).map(up).filter(Boolean))].sort((a, b) => b.length - a.length);
    if (!list.length) return () => [];
    const re = new RegExp('(?<![A-Z0-9])(' + list.map(reEsc).join('|') + ')(?![A-Z0-9])', 'g');
    return text => {
      const out = new Set(), s = up(text);
      let m; re.lastIndex = 0;
      while ((m = re.exec(s))) out.add(m[1]);
      return [...out];
    };
  }

  /** Tags for each page of one file. When no page has any text the drawing
      was plotted as lines; then the file name is the only clue ("IS05.pdf"). */
  function indexPages(pageTexts, ids, fileName) {
    const find = tagMatcher(ids);
    const pages = (pageTexts || []).map(t => find(t));
    if (!pages.some(p => p.length)) {
      const fromName = find(String(fileName || '').replace(/\.pdf$/i, '').replace(/_/g, ' '));
      if (fromName.length) return pages.map(() => fromName.slice());
    }
    return pages;
  }

  const pagesOf = f => (f && Array.isArray(f.pages) ? f.pages : f && f.pages ? Object.values(f.pages) : []);
  /** A page's units: what was read off it plus what an editor added by hand to the file. */
  function pageTags(f, i) {
    const p = pagesOf(f)[i] || {};
    const t = [].concat(p.tags || [], (f && f.manualTags) || []);
    return [...new Set(t.map(up).filter(Boolean))];
  }
  function fileTags(f) {
    const all = new Set();
    pagesOf(f).forEach((p, i) => pageTags(f, i).forEach(t => all.add(t)));
    return [...all].sort(natural);
  }
  function natural(a, b) { return String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' }); }

  /** Every sheet that shows this unit, newest upload first. `current` marks
      the pages of the newest upload (a unit can run over two sheets). */
  function sheetsFor(files, unitId) {
    const k = up(unitId), out = [];
    if (!k) return out;
    Object.keys(files || {}).forEach(id => {
      const f = files[id];
      if (!f) return;
      pagesOf(f).forEach((p, i) => { if (pageTags(f, i).includes(k)) out.push({ id, f, page: i }); });
    });
    out.sort((a, b) => (+b.f.uploadedAt || 0) - (+a.f.uploadedAt || 0) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0) || a.page - b.page);
    const newest = out.length ? out[0].id : null;
    out.forEach(s => { s.current = s.id === newest; });
    return out;
  }

  /** Search box: unit ids that contain the query (with their sheets) and files
      whose name or folder contains it. Empty query: every file, newest first. */
  function search(files, q, ids) {
    const Q = up(q);
    const list = Object.keys(files || {}).filter(id => files[id]).map(id => ({ id, f: files[id] }))
      .sort((a, b) => (+b.f.uploadedAt || 0) - (+a.f.uploadedAt || 0));
    if (!Q) return { units: [], files: list };
    const known = [...new Set((ids || []).map(up))];
    Object.keys(files || {}).forEach(id => fileTags(files[id]).forEach(t => { if (!known.includes(t)) known.push(t); }));
    const units = known.filter(u => u.includes(Q)).sort((a, b) => (a === Q ? -1 : b === Q ? 1 : natural(a, b)))
      .map(u => ({ unit: u, sheets: sheetsFor(files, u) }));
    const fl = list.filter(x => up(x.f.name).includes(Q) || up(x.f.folder).includes(Q));
    return { units, files: fl };
  }

  /** Which of the project's units have no fab drawing yet. */
  function missing(files, ids) {
    const have = new Set();
    Object.keys(files || {}).forEach(id => fileTags(files[id]).forEach(t => have.add(t)));
    return [...new Set((ids || []).map(up).filter(Boolean))].filter(u => !have.has(u)).sort(natural);
  }

  const API = { tagMatcher, indexPages, pageTags, fileTags, sheetsFor, search, missing };
  root.AF_FAB = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;

  /* ======================= browser ======================= */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const MAX_MB = 100;        // storage.rules allows 100 MB under p/<project>/fab/
  const PAGE_PX = 3000;      // longest side of a page image: dimension strings stay legible
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pid = () => String((window.PROJECT || {}).hubId || 'unknown').replace(/[^a-z0-9_-]/gi, '');
  const me = () => { try { return firebase.auth().currentUser.email; } catch (e) { return ''; } };
  const canEdit = () => !(typeof _noEdit === 'function' && _noEdit());
  const isGC = () => typeof _isGC === 'function' && _isGC();
  const ids = () => ((typeof state !== 'undefined' && state && state.units) || []).map(u => u && u.id).filter(Boolean);
  const say = m => { if (typeof toast === 'function') toast(m); };

  const FAB = { files: null, at: 0, denied: false, q: '', pending: [], busy: false };
  API._state = FAB;

  async function load(force) {
    if (!force && FAB.files && Date.now() - FAB.at < 60000) return FAB.files;
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) throw new Error('Not connected');
    try {
      const snap = await firebase.database().ref('fab').once('value');
      FAB.files = snap.val() || {}; FAB.at = Date.now(); FAB.denied = false;
    } catch (e) {
      if (/permission/i.test((e && (e.code || e.message)) || '')) { FAB.denied = true; FAB.files = {}; }
      throw e;
    }
    return FAB.files;
  }

  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }
  async function pdfLib() {
    await loadScript(PDFJS + 'pdf.min.js');
    const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
    return lib;
  }

  /* ---------- the list ---------- */
  function overlay() {
    let ov = document.getElementById('fabModal');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'fabModal'; ov.className = 'modal-overlay';
      document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('show'); });
    }
    return ov;
  }
  const btn = 'font-size:12px;padding:4px 10px;min-height:0';
  function sheetBtn(s, label) {
    return `<button type="button" class="btn" style="${btn}" onclick="AF_FAB.view('${esc(s.id)}',${s.page})">${esc(label)}</button>`;
  }
  const when = ts => { const d = new Date(+ts || 0); return isNaN(d) || !+ts ? '' : d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }); };
  const who = e => String(e || '').split('@')[0];

  function unitRow(u, sheets) {
    const cur = sheets.filter(s => s.current), old = sheets.filter(s => !s.current);
    if (!cur.length) return `<div class="fab-row"><b>${esc(u)}</b> <span style="color:var(--text-dim)">— no fab drawing yet</span></div>`;
    const f = cur[0].f;
    return `<div class="fab-row" style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 0;border-bottom:1px solid var(--border)">
        <b style="min-width:70px">${esc(u)}</b>
        ${cur.map(s => sheetBtn(s, '📄 ' + (cur.length > 1 ? 'Sheet ' + (s.page + 1) : 'Open'))).join('')}
        <span style="font-size:11.5px;color:var(--text-dim);flex:1;min-width:140px">${esc(f.name)} · ${esc(when(f.uploadedAt))}${f.folder ? ' · ' + esc(f.folder) : ''}</span>
        ${old.length ? `<details style="font-size:11.5px"><summary style="cursor:pointer;color:var(--text-dim)">${old.length} older</summary>
          ${old.map(s => `<div style="margin:4px 0">${sheetBtn(s, (s.f.name || 'sheet') + ' p.' + (s.page + 1))} <span style="color:var(--text-dim)">${esc(when(s.f.uploadedAt))}</span></div>`).join('')}</details>` : ''}
      </div>`;
  }
  function fileRow(x) {
    const f = x.f, tags = fileTags(f), n = pagesOf(f).length;
    const edit = canEdit() ? `<button type="button" class="btn" style="${btn}" onclick="AF_FAB.editTags('${esc(x.id)}')" title="Add unit numbers this file covers">🏷 Units</button>
        <button type="button" class="btn btn-danger" style="${btn}" onclick="AF_FAB.remove('${esc(x.id)}')" title="Remove this file">×</button>` : '';
    return `<div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;padding:7px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;min-width:160px"><b style="font-weight:500">${esc(f.name)}</b>
          <span style="font-size:11.5px;color:var(--text-dim)"> · ${n} sheet${n === 1 ? '' : 's'} · ${esc(when(f.uploadedAt))} · ${esc(who(f._by))}${f.folder ? ' · ' + esc(f.folder) : ''}</span>
          <div style="font-size:11.5px;color:${tags.length ? 'var(--text-dim)' : 'var(--amber,#d29922)'};margin-top:2px">${tags.length ? esc(tags.join(', ')) : 'No unit number found on these sheets — add them with 🏷 Units'}</div></span>
        ${n ? sheetBtn({ id: x.id, page: 0 }, '📄 Open') : ''}
        ${f.pdf ? `<a class="btn" style="${btn};text-decoration:none" href="${esc(f.pdf)}" target="_blank" rel="noopener">PDF ↗</a>` : ''}
        ${edit}
      </div>`;
  }

  function render() {
    const ov = overlay();
    const box = ov.querySelector('#fabBody');
    if (!box) return;
    if (FAB.denied) { box.innerHTML = '<div style="color:var(--text-dim)">Fab drawings are not shared with this account.</div>'; return; }
    if (!FAB.files) { box.innerHTML = '<div style="color:var(--text-dim)">Loading…</div>'; return; }
    const r = search(FAB.files, FAB.q, ids());
    let html = '';
    if (FAB.q) {
      html += r.units.length ? r.units.slice(0, 60).map(x => unitRow(x.unit, x.sheets)).join('') : '';
      if (r.files.length) html += `<div style="font-size:12px;color:var(--text-dim);margin:12px 0 2px">Files</div>` + r.files.map(fileRow).join('');
      if (!r.units.length && !r.files.length) html = `<div style="color:var(--text-dim)">Nothing matches “${esc(FAB.q)}”.</div>`;
    } else {
      const miss = missing(FAB.files, ids());
      const total = new Set(ids().map(up)).size;
      html += total ? `<div style="font-size:12px;color:var(--text-dim);margin-bottom:6px">${total - miss.length} of ${total} units have a fab drawing.${miss.length ? ` <details style="display:inline"><summary style="display:inline;cursor:pointer">Without one (${miss.length})</summary><div style="margin-top:4px">${esc(miss.join(', '))}</div></details>` : ''}</div>` : '';
      html += r.files.length ? r.files.map(fileRow).join('') : `<div style="color:var(--text-dim);margin-top:8px">No fab drawings uploaded yet.${canEdit() ? ' Drop the PDFs below.' : ''}</div>`;
    }
    box.innerHTML = html;
  }

  function uploadZone() {
    if (!canEdit()) return '';
    return `<div id="fabDrop" style="margin-top:12px;border:1px dashed var(--border);border-radius:8px;padding:12px;text-align:center">
        <div style="font-size:12.5px">Drop fab drawing PDFs here, or <label style="color:var(--accent,#58a6ff);cursor:pointer">choose files<input type="file" id="fabFiles" accept="application/pdf" multiple hidden></label></div>
        <div style="font-size:11px;color:var(--text-dim);margin-top:4px">Each sheet is filed under the unit numbers printed on it. Up to ${MAX_MB} MB a file. Newer uploads become the current sheet.</div>
        <div class="form-row" style="margin:8px auto 0;max-width:420px"><input type="text" id="fabFolder" placeholder="Folder (optional), e.g. Exterior Storefronts / part 4" style="width:100%"></div>
        <div id="fabPending" style="text-align:left;margin-top:8px"></div>
      </div>`;
  }

  async function open(q) {
    if (isGC()) return;
    const ov = overlay();
    FAB.q = q || '';
    ov.innerHTML = `<div class="modal" style="max-width:760px;max-height:90vh;overflow-y:auto">
        <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
          <h3 style="margin:0;flex:1">📑 Fab drawings</h3>
          <button type="button" class="btn" style="${btn}" onclick="document.getElementById('fabModal').classList.remove('show')">✕</button>
        </div>
        <div class="form-row" style="margin:0"><input type="search" id="fabSearch" placeholder="Unit number (SF40) or file name" value="${esc(FAB.q)}" style="width:100%" autocomplete="off"></div>
        <div id="fabBody" style="margin-top:10px"></div>
        ${uploadZone()}
      </div>`;
    ov.classList.add('show');
    const s = ov.querySelector('#fabSearch');
    s.addEventListener('input', () => { FAB.q = s.value.trim(); render(); });
    wireDrop(ov);
    render();
    try { await load(); } catch (e) { console.warn('[fab] load failed', e); }
    render();
  }

  /* ---------- viewing ---------- */
  function listItem(id, f, i) {
    const p = pagesOf(f)[i] || {};
    const tags = pageTags(f, i);
    return { url: p.img, name: `${tags.slice(0, 4).join(', ') || f.name} · ${f.name}${pagesOf(f).length > 1 ? ' · sheet ' + (i + 1) : ''}`,
      pdf: f.pdf ? f.pdf + '#page=' + (i + 1) : '' };
  }
  function view(id, page) {
    const f = (FAB.files || {})[id];
    if (!f || typeof openDwgViewer !== 'function') return;
    const all = pagesOf(f).map((p, i) => listItem(id, f, i));
    const list = all.filter(x => x.url);
    openDwgViewer(list, Math.max(0, list.indexOf(all[page])));
  }
  /** The unit's current sheets in the lightbox; nothing found: the list, searched for it. */
  async function forUnit(unitId) {
    try { await load(); } catch (e) {}
    const cur = sheetsFor(FAB.files, unitId).filter(s => s.current);
    if (!cur.length) { open(unitId); return; }
    openDwgViewer(cur.map(s => listItem(s.id, s.f, s.page)).filter(x => x.url), 0);
  }

  /* ---------- unit card hooks (called from app.js) ---------- */
  function unitButtonHtml(u, n) {
    return `<button type="button" class="btn" style="${btn}" onclick="AF_FAB.forUnit('${esc(u.id)}')">📑 Fab drawing${n ? ' (' + n + ')' : n === 0 ? ' — none yet' : ''}</button>`;
  }
  /** Editor modal: a button next to the title. */
  async function unitButton(u) {
    if (!u || isGC()) return;
    const title = document.getElementById('modalTitle');
    if (!title) return;
    let slot = document.getElementById('fabUnitBtn');
    if (!slot) { slot = document.createElement('span'); slot.id = 'fabUnitBtn'; slot.style.cssText = 'margin-left:10px;vertical-align:middle;display:inline-block'; title.insertAdjacentElement('afterend', slot); }
    slot.innerHTML = unitButtonHtml(u);
    try { await load(); } catch (e) { if (FAB.denied) { slot.innerHTML = ''; } return; }
    slot.innerHTML = unitButtonHtml(u, sheetsFor(FAB.files, u.id).filter(s => s.current).length);
  }
  /** Read-only card (staff, viewers): fills its slot. */
  async function fillUnitSlots(rootEl, u) {
    const slot = rootEl && rootEl.querySelector('.fab-unit-slot');
    if (!slot || !u || isGC()) return;
    slot.innerHTML = `<div style="margin-top:10px">${unitButtonHtml(u)}</div>`;
    try { await load(); } catch (e) { slot.innerHTML = ''; return; }
    slot.innerHTML = `<div style="margin-top:10px">${unitButtonHtml(u, sheetsFor(FAB.files, u.id).filter(s => s.current).length)}</div>`;
  }

  /* ---------- upload (editors) ---------- */
  function wireDrop(ov) {
    const z = ov.querySelector('#fabDrop'); if (!z) return;
    const inp = ov.querySelector('#fabFiles');
    inp.addEventListener('change', () => { add(inp.files); inp.value = ''; });
    z.addEventListener('dragover', e => { e.preventDefault(); z.style.background = 'rgba(88,166,255,.08)'; });
    z.addEventListener('dragleave', () => { z.style.background = ''; });
    z.addEventListener('drop', e => { e.preventDefault(); z.style.background = ''; add(e.dataTransfer.files); });
    renderPending();
  }
  function renderPending() {
    const el = document.getElementById('fabPending'); if (!el) return;
    if (!FAB.pending.length) { el.innerHTML = ''; return; }
    el.innerHTML = FAB.pending.map((p, i) => `<div style="font-size:12px;padding:4px 0;border-top:1px solid var(--border)">
        <b style="font-weight:500">${esc(p.file.name)}</b> <span style="color:var(--text-dim)">${esc(p.status)}</span>
        ${p.pages ? `<div style="color:${p.pages.some(t => t.length) ? 'var(--text-dim)' : 'var(--amber,#d29922)'}">${p.pages.map((t, j) => 'p.' + (j + 1) + ': ' + (t.join(', ') || '—')).join(' · ')}</div>` : ''}
      </div>`).join('') + (FAB.pending.some(p => p.ready) && !FAB.busy
        ? `<button type="button" class="btn btn-primary" style="margin-top:8px" onclick="AF_FAB.commit()">⬆ Upload ${FAB.pending.filter(p => p.ready).length} file${FAB.pending.filter(p => p.ready).length === 1 ? '' : 's'}</button>
           <button type="button" class="btn" style="margin-top:8px" onclick="AF_FAB.clearPending()">Cancel</button>` : '');
  }
  async function add(fileList) {
    const files = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) return;
    for (const file of files) {
      const p = { file, status: 'reading…', pages: null, images: [], ready: false };
      if (file.size > MAX_MB * 1048576) { p.status = `is over ${MAX_MB} MB — split it first`; FAB.pending.push(p); renderPending(); continue; }
      FAB.pending.push(p); renderPending();
      try {
        const lib = await pdfLib();
        const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const texts = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          p.status = `reading sheet ${n} of ${pdf.numPages}…`; renderPending();
          const page = await pdf.getPage(n);
          const tc = await page.getTextContent();
          texts.push(tc.items.map(it => it.str || '').join(' '));
          p.images.push(await pageJpeg(page));
        }
        p.pages = indexPages(texts, ids(), file.name);
        p.status = `${pdf.numPages} sheet${pdf.numPages === 1 ? '' : 's'}`;
        p.ready = true;
      } catch (e) {
        console.warn('[fab] read failed', e);
        p.status = 'could not be read: ' + ((e && e.message) || e);
      }
      renderPending();
    }
  }
  async function pageJpeg(page) {
    const v1 = page.getViewport({ scale: 1 });
    const scale = Math.min(4, PAGE_PX / Math.max(v1.width, v1.height));
    const v = page.getViewport({ scale });
    const c = document.createElement('canvas');
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    c.width = c.height = 0;
    return blob;
  }
  function clearPending() { FAB.pending = []; renderPending(); }
  async function commit() {
    if (!canEdit() || FAB.busy) return;
    const todo = FAB.pending.filter(p => p.ready);
    if (!todo.length) return;
    FAB.busy = true;
    const folder = ((document.getElementById('fabFolder') || {}).value || '').trim().slice(0, 120);
    const st = firebase.storage(), db = firebase.database();
    let done = 0;
    for (const p of todo) {
      try {
        const id = db.ref('fab').push().key;
        const base = `p/${pid()}/fab/${id}/`;
        p.status = 'uploading the PDF…'; renderPending();
        const pdfRef = st.ref(base + p.file.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
        await pdfRef.put(p.file, { contentType: 'application/pdf' });
        const pdf = await pdfRef.getDownloadURL();
        const pages = [];
        for (let i = 0; i < p.images.length; i++) {
          p.status = `uploading sheet ${i + 1} of ${p.images.length}…`; renderPending();
          const r = st.ref(base + 'p' + (i + 1) + '.jpg');
          await r.put(p.images[i], { contentType: 'image/jpeg' });
          pages.push({ img: await r.getDownloadURL(), tags: p.pages[i] || [] });
        }
        const row = { name: p.file.name.slice(0, 200), folder, pdf, size: p.file.size, pages, uploadedAt: Date.now(),
          _by: me(), _project: (window.PROJECT || {}).hubId, _ts: firebase.database.ServerValue.TIMESTAMP };
        await db.ref('fab/' + id).set(row);
        FAB.files = Object.assign({}, FAB.files || {}, { [id]: Object.assign({}, row, { _ts: Date.now() }) });
        p.ready = false; p.status = '✓ uploaded'; done++;
      } catch (e) {
        console.warn('[fab] upload failed', e);
        p.status = 'upload failed: ' + ((e && (e.code || e.message)) || e);
      }
      renderPending();
    }
    FAB.busy = false;
    FAB.pending = FAB.pending.filter(p => p.status !== '✓ uploaded');
    renderPending(); render();
    if (done) say(`${done} fab drawing file${done === 1 ? '' : 's'} uploaded`);
    try { await load(true); render(); } catch (e) {}
  }

  async function editTags(id) {
    const f = (FAB.files || {})[id]; if (!f || !canEdit()) return;
    const v = prompt('Unit numbers this file covers, besides the ones read off the sheets (comma-separated):', (f.manualTags || []).join(', '));
    if (v == null) return;
    const tags = [...new Set(v.split(/[,;\s]+/).map(up).filter(Boolean))].slice(0, 200);
    try {
      await firebase.database().ref('fab/' + id).update({ manualTags: tags, _by: me(), _ts: firebase.database.ServerValue.TIMESTAMP });
      f.manualTags = tags; render();
    } catch (e) { say('Could not save: ' + ((e && (e.code || e.message)) || e)); }
  }
  async function remove(id) {
    const f = (FAB.files || {})[id]; if (!f || !canEdit()) return;
    if (!confirm(`Remove ${f.name}? The shop and the site will no longer see it.`)) return;
    try {
      await firebase.database().ref('fab/' + id).remove();
      delete FAB.files[id]; render();
      // Files are tidied up best-effort; a stray image without its row is never shown.
      [f.pdf].concat(pagesOf(f).map(p => p.img)).forEach(u => { try { if (u) firebase.storage().refFromURL(u).delete().catch(() => {}); } catch (e) {} });
    } catch (e) { say('Could not remove: ' + ((e && (e.code || e.message)) || e)); }
  }

  Object.assign(API, { open, view, forUnit, unitButton, fillUnitSlots, commit, clearPending, editTags, remove, add, load });
  root.openFab = open;
})(typeof window !== 'undefined' ? window : globalThis);
