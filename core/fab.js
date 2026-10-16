/* ============================================================
   Fab drawings (Leo, 2026-10-16)
   ------------------------------------------------------------
   The shop and the site could not find a fab drawing without phoning Leo.
   Each project keeps its fab PDFs in the 📐 Drawings window, below the
   drawing links, for everyone on the project except the GC (rules: /fab is
   read by editors, viewers and staff only; the GC has no Drawings button).

   Upload (editors): drop the PDFs. In the browser, pdf.js reads every
   page's text and files the page under each unit id of this project that is
   printed on it (CP2's sheets say "TAG SF40"), and draws the page to a JPEG
   so a phone can open one sheet without downloading a whole set. PDF and
   page images go to p/<project>/fab/<id>/ in the shared bucket; only their
   links go in the database (/fab/<id>), the same way photos work.

   "Latest" is by upload time: for a unit, the newest upload that shows it
   is its sheet. The sheets carry no revision number, so upload order is
   the only honest signal. Older files stay in the list.

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
  const current = (files, unitId) => sheetsFor(files, unitId).filter(s => s.current);

  /** Search box: units that contain the query and have a sheet, and files whose
      name contains it. Empty query: every file, newest first. */
  function search(files, q, ids) {
    const Q = up(q);
    const list = Object.keys(files || {}).filter(id => files[id]).map(id => ({ id, f: files[id] }))
      .sort((a, b) => (+b.f.uploadedAt || 0) - (+a.f.uploadedAt || 0));
    if (!Q) return { units: [], files: list };
    const known = new Set((ids || []).map(up));
    Object.keys(files || {}).forEach(id => fileTags(files[id]).forEach(t => known.add(t)));
    const units = [...known].filter(u => u.includes(Q)).sort((a, b) => (a === Q ? -1 : b === Q ? 1 : natural(a, b)))
      .map(u => ({ unit: u, sheets: current(files, u) })).filter(x => x.sheets.length);
    return { units, files: list.filter(x => up(x.f.name).includes(Q)) };
  }

  const API = { tagMatcher, indexPages, pageTags, fileTags, sheetsFor, search };
  root.AF_FAB = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;

  /* ======================= browser ======================= */
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const MAX_MB = 100;        // storage.rules allows 100 MB under p/<project>/fab/
  const PAGE_PX = 3000;      // longest side of a page image: dimension strings stay legible
  const SHOW = 40;           // files listed before the search box has to narrow it
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const pid = () => String((window.PROJECT || {}).hubId || 'unknown').replace(/[^a-z0-9_-]/gi, '');
  const me = () => { try { return firebase.auth().currentUser.email; } catch (e) { return ''; } };
  const canEdit = () => !(typeof _noEdit === 'function' && _noEdit());
  const isGC = () => typeof _isGC === 'function' && _isGC();
  const ids = () => ((typeof state !== 'undefined' && state && state.units) || []).map(u => u && u.id).filter(Boolean);
  const errText = e => (e && (e.code || e.message)) || String(e);
  const btn = 'font-size:12px;padding:3px 9px;min-height:0';
  const when = ts => (+ts ? new Date(+ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '');

  const FAB = { files: null, at: 0, denied: false, q: '', status: '', busy: false };
  API._state = FAB;

  async function load(force) {
    if (!force && FAB.files && Date.now() - FAB.at < 60000) return FAB.files;
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.length) throw new Error('Not connected');
    try {
      const snap = await firebase.database().ref('fab').once('value');
      FAB.files = snap.val() || {}; FAB.at = Date.now(); FAB.denied = false;
    } catch (e) {
      if (/permission/i.test(errText(e))) { FAB.denied = true; FAB.files = {}; }
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

  /* ---------- the section in the Drawings window ---------- */
  const open1 = (id, page, label) => `<button type="button" class="btn" style="${btn}" onclick="AF_FAB.view('${esc(id)}',${page})">${label}</button>`;
  function fileRow(x) {
    const f = x.f, tagged = fileTags(f).length;
    return `<div class="drawing-row" style="gap:6px;flex-wrap:wrap;align-items:center;padding:8px 12px">
        <span style="flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(f.name)}
          <span style="color:var(--text-dim);font-size:11.5px">${esc(when(f.uploadedAt))}</span>
          ${tagged ? '' : `<span style="color:var(--amber,#d29922);font-size:11.5px"> · no unit no.</span>`}</span>
        ${pagesOf(f).length ? open1(x.id, 0, 'Open') : ''}
        ${f.pdf ? `<a class="btn" style="${btn};text-decoration:none" href="${esc(f.pdf)}" target="_blank" rel="noopener">PDF</a>` : ''}
        ${canEdit() && !tagged ? `<button type="button" class="btn" style="${btn}" onclick="AF_FAB.editTags('${esc(x.id)}')" title="Which units this file is for">🏷</button>` : ''}
        ${canEdit() ? `<button type="button" class="drawing-remove" onclick="AF_FAB.remove('${esc(x.id)}')" title="Remove" aria-label="remove">×</button>` : ''}
      </div>`;
  }
  function renderBody() {
    const box = document.getElementById('fabBody');
    if (!box) return;
    const st = document.getElementById('fabStatus');
    if (st) st.textContent = FAB.status;
    if (FAB.denied) { box.innerHTML = '<div class="drawings-empty">Not shared with this account.</div>'; return; }
    if (!FAB.files) { box.innerHTML = '<div class="drawings-empty">Loading…</div>'; return; }
    const r = search(FAB.files, FAB.q, ids());
    const units = r.units.slice(0, 30).map(x => `<div class="drawing-row" style="gap:6px;flex-wrap:wrap;align-items:center;padding:8px 12px"><b style="flex:1">${esc(x.unit)}</b>${
      x.sheets.map((s, i) => open1(s.id, s.page, x.sheets.length > 1 ? 'Sheet ' + (i + 1) : 'Open')).join('')}</div>`).join('');
    const files = r.files.slice(0, SHOW).map(fileRow).join('')
      + (r.files.length > SHOW ? `<div style="font-size:11.5px;color:var(--text-dim);padding:6px 0">${r.files.length - SHOW} more — search to find them</div>` : '');
    box.innerHTML = units + files || `<div class="drawings-empty">${FAB.q ? 'Nothing matches “' + esc(FAB.q) + '”.' : 'No fab drawings yet.'}</div>`;
  }
  /** Called by openDrawings(): put the section under the drawing links (once), then refresh. */
  async function mount() {
    if (isGC()) return;
    const list = document.getElementById('drawingsList');
    if (!list) return;
    let sec = document.getElementById('fabSection');
    if (!sec) {
      sec = document.createElement('div'); sec.id = 'fabSection';
      sec.style.cssText = 'margin-top:14px;padding-top:12px;border-top:1px solid var(--border)';
      sec.innerHTML = `<div style="display:flex;align-items:center;gap:8px">
          <strong style="flex:1">Fab drawings</strong>
          ${canEdit() ? `<label class="btn" style="${btn};cursor:pointer" title="Drop PDFs here too. Each sheet is filed under the unit numbers printed on it.">⬆ Add PDFs<input type="file" id="fabFiles" accept="application/pdf" multiple hidden></label>` : ''}
        </div>
        <div class="form-row" style="margin:8px 0 0"><input type="search" id="fabSearch" placeholder="Unit no. or file name" autocomplete="off" style="width:100%"></div>
        <div id="fabStatus" style="font-size:11.5px;color:var(--text-dim);margin-top:4px"></div>
        <div id="fabBody" class="drawings-list" style="margin-top:6px"></div>`;
      list.insertAdjacentElement('afterend', sec);
      const s = sec.querySelector('#fabSearch');
      s.addEventListener('input', () => { FAB.q = s.value.trim(); renderBody(); });
      const inp = sec.querySelector('#fabFiles');
      if (inp) inp.addEventListener('change', () => { add(inp.files); inp.value = ''; });
      sec.addEventListener('dragover', e => { if (canEdit()) { e.preventDefault(); sec.style.background = 'rgba(88,166,255,.06)'; } });
      sec.addEventListener('dragleave', () => { sec.style.background = ''; });
      sec.addEventListener('drop', e => { if (!canEdit()) return; e.preventDefault(); sec.style.background = ''; add(e.dataTransfer.files); });
    }
    const s = sec.querySelector('#fabSearch');
    if (s && s.value !== FAB.q) s.value = FAB.q;
    renderBody();
    try { await load(); } catch (e) { console.warn('[fab] load failed', e); }
    renderBody();
  }
  /** Open the Drawings window on the fab list, optionally searched. */
  function open(q) {
    FAB.q = q || '';
    if (typeof openDrawings === 'function') openDrawings();
  }

  /* ---------- viewing ---------- */
  function listItem(f, i) {
    const p = pagesOf(f)[i] || {};
    return { url: p.img, name: `${pageTags(f, i).slice(0, 4).join(', ') || f.name} · ${f.name}`,
      pdf: f.pdf ? f.pdf + '#page=' + (i + 1) : '' };
  }
  function view(id, page) {
    const f = (FAB.files || {})[id];
    if (!f || typeof openDwgViewer !== 'function') return;
    const all = pagesOf(f).map((p, i) => listItem(f, i));
    const list = all.filter(x => x.url);
    openDwgViewer(list, Math.max(0, list.indexOf(all[page])));
  }
  async function forUnit(unitId) {
    try { await load(); } catch (e) {}
    const cur = current(FAB.files, unitId);
    if (!cur.length) { open(unitId); return; }
    openDwgViewer(cur.map(s => listItem(s.f, s.page)).filter(x => x.url), 0);
  }

  /* ---------- unit card hooks (called from app.js): shown only when the unit has a sheet ---------- */
  const unitBtn = u => `<button type="button" class="btn" style="${btn}" onclick="AF_FAB.forUnit('${esc(u.id)}')">📑 Fab drawing</button>`;
  async function has(u) {
    if (!u || isGC()) return false;
    try { await load(); } catch (e) { return false; }
    return current(FAB.files, u.id).length > 0;
  }
  /** Editor modal: a button beside the title. */
  async function unitButton(u) {
    let slot = document.getElementById('fabUnitBtn');
    if (slot) slot.innerHTML = '';
    if (!(await has(u))) return;
    const title = document.getElementById('modalTitle');
    if (!title) return;
    if (!slot) { slot = document.createElement('span'); slot.id = 'fabUnitBtn'; slot.style.cssText = 'margin-left:10px;vertical-align:middle;display:inline-block'; title.insertAdjacentElement('afterend', slot); }
    slot.innerHTML = unitBtn(u);
  }
  /** Read-only card (staff, viewers): fills its slot. */
  async function fillUnitSlots(rootEl, u) {
    const slot = rootEl && rootEl.querySelector('.fab-unit-slot');
    if (slot && (await has(u))) slot.innerHTML = `<div style="margin-top:10px">${unitBtn(u)}</div>`;
  }

  /* ---------- upload (editors): read, then upload straight away ---------- */
  function setStatus(s) { FAB.status = s; const el = document.getElementById('fabStatus'); if (el) el.textContent = s; }
  async function add(fileList) {
    if (!canEdit() || FAB.busy) return;
    const files = Array.from(fileList || []).filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf');
    if (!files.length) return;
    FAB.busy = true;
    let done = 0; const bad = [];
    for (let k = 0; k < files.length; k++) {
      const file = files[k], tag = files.length > 1 ? ` (${k + 1} of ${files.length})` : '';
      if (file.size > MAX_MB * 1048576) { bad.push(`${file.name}: over ${MAX_MB} MB`); continue; }
      try {
        setStatus(`Reading ${file.name}${tag}…`);
        const lib = await pdfLib();
        const pdf = await lib.getDocument({ data: new Uint8Array(await file.arrayBuffer()) }).promise;
        const texts = [], images = [];
        for (let n = 1; n <= pdf.numPages; n++) {
          const page = await pdf.getPage(n);
          texts.push((await page.getTextContent()).items.map(it => it.str || '').join(' '));
          images.push(await pageJpeg(page));
        }
        const tags = indexPages(texts, ids(), file.name);
        setStatus(`Uploading ${file.name}${tag}…`);
        await store(file, images, tags);
        done++;
      } catch (e) {
        console.warn('[fab] upload failed', e);
        bad.push(`${file.name}: ${errText(e)}`);
      }
    }
    FAB.busy = false;
    setStatus((done ? `✓ ${done} uploaded` : '') + (bad.length ? (done ? ' · ' : '') + 'Not uploaded — ' + bad.join('; ') : ''));
    try { await load(true); } catch (e) {}
    renderBody();
  }
  async function pageJpeg(page) {
    const v1 = page.getViewport({ scale: 1 });
    const v = page.getViewport({ scale: Math.min(4, PAGE_PX / Math.max(v1.width, v1.height)) });
    const c = document.createElement('canvas');
    c.width = Math.round(v.width); c.height = Math.round(v.height);
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
    await page.render({ canvasContext: ctx, viewport: v }).promise;
    const blob = await new Promise(r => c.toBlob(r, 'image/jpeg', 0.82));
    c.width = c.height = 0;
    return blob;
  }
  async function store(file, images, tags) {
    const st = firebase.storage(), db = firebase.database();
    const id = db.ref('fab').push().key;
    const base = `p/${pid()}/fab/${id}/`;
    const pdfRef = st.ref(base + file.name.replace(/[^a-zA-Z0-9._-]/g, '_'));
    await pdfRef.put(file, { contentType: 'application/pdf' });
    const pages = [];
    for (let i = 0; i < images.length; i++) {
      const r = st.ref(base + 'p' + (i + 1) + '.jpg');
      await r.put(images[i], { contentType: 'image/jpeg' });
      pages.push({ img: await r.getDownloadURL(), tags: tags[i] || [] });
    }
    await db.ref('fab/' + id).set({ name: file.name.slice(0, 200), pdf: await pdfRef.getDownloadURL(), size: file.size, pages,
      uploadedAt: Date.now(), _by: me(), _project: (window.PROJECT || {}).hubId, _ts: firebase.database.ServerValue.TIMESTAMP });
  }

  async function editTags(id) {
    const f = (FAB.files || {})[id]; if (!f || !canEdit()) return;
    const v = prompt('Unit numbers this file is for (comma-separated):', (f.manualTags || []).join(', '));
    if (v == null) return;
    const tags = [...new Set(v.split(/[,;\s]+/).map(up).filter(Boolean))].slice(0, 200);
    try {
      await firebase.database().ref('fab/' + id).update({ manualTags: tags, _by: me(), _ts: firebase.database.ServerValue.TIMESTAMP });
      f.manualTags = tags; renderBody();
    } catch (e) { setStatus('Could not save: ' + errText(e)); }
  }
  async function remove(id) {
    const f = (FAB.files || {})[id]; if (!f || !canEdit()) return;
    if (!confirm(`Remove ${f.name}?`)) return;
    try {
      await firebase.database().ref('fab/' + id).remove();
      delete FAB.files[id]; renderBody();
      // Files are tidied up best-effort; a stray image without its row is never shown.
      [f.pdf].concat(pagesOf(f).map(p => p.img)).forEach(u => { try { if (u) firebase.storage().refFromURL(u).delete().catch(() => {}); } catch (e) {} });
    } catch (e) { setStatus('Could not remove: ' + errText(e)); }
  }

  Object.assign(API, { mount, open, view, forUnit, unitButton, fillUnitSlots, add, editTags, remove, load });
})(typeof window !== 'undefined' ? window : globalThis);
