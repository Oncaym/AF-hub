/* ============================================================
   AF Design Board — Schedules (Excel) UI (v2, any Excel layout)
   One page, several boards (projects); each board holds several
   Excel files; one issue log per board. Kept in the design
   database (cloud-store.js), so the team shares one board and
   sees each other's changes. Board logic shared with the chat
   lives in ops.js.
   ============================================================ */
(function () {
  'use strict';
  const E = window.DesignEngine;
  const OPS = window.ScheduleOps;

  const OWNERS = ['Unassigned', 'Architect', 'AF Design', 'AF PM', 'GC / CM'];
  const STATUS = [['open', 'Open'], ['asked', 'Asked'], ['answered', 'Answered'], ['closed', 'Closed']];
  const STATUS_LABEL = Object.fromEntries(STATUS);
  const REV_STATUS = ['In progress', 'Submitted', 'Approved', 'Approved as noted', 'Revise & resubmit', 'Rejected'];
  const BIC = ['AF Design', 'AF PM', 'GC / CM', 'Architect', 'Owner'];
  const SEV_LABEL = { error: 'Error', warn: 'Warning', info: 'Info' };
  const KIND_LABEL = { issue: 'Track as issue', label: 'Label only', resolved: 'Color for closed issues', ignore: 'Ignore' };

  /* ---------------- storage: the design database (cloud-store.js) ---------------- */
  const idbOk = true;
  const IDB = window.DesignStore;
  const NAME = { get() { return (window.DC && window.DC.email ? String(window.DC.email).split('@')[0] : ''); }, set() {} };
  const canEdit = () => !!(window.DC && window.DC.isEditor());
  let savePending = false, remoteQ = null, booted = false;

  let META = null;      // { v, boards:[{id,name}], current }
  let B = null;         // current board
  let FILE = null;      // current file (in B.files)
  let cur = null;       // current file's model now
  let AN = null, LEG = null, USED = [], SETUP = null, F = [], MARKS = [], TOT = null;
  let me = NAME.get();
  const myOps = [];
  const fileCache = new Map();
  const ui = {
    sheet: null, a: null, b: null, side: 'issues', iFilter: 'active', iOwner: '', iFile: '', iSheetOnly: false,
    cFilter: 'review', hl: null, cmpFrom: null, cmpTo: null, focusIssue: null, open: new Set(), showAll: new Set(),
    delArm: null, resetArm: false, removeArm: false, pending: {}, drafts: {},
  };
  const dlP = (window.claude && typeof window.claude.use === 'function') ? window.claude.use('downloads').catch(() => null) : Promise.resolve(null);

  /* ---------------- helpers ---------------- */
  const $ = (s, el) => (el || document).querySelector(s);
  const esc = (s) => String(s === null || s === undefined ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const txt = E.txt;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const fmtN = (n) => (n === null || n === undefined || isNaN(n) ? '—' : Math.round(n).toLocaleString('en-US'));
  const fmtT = (t) => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : '');
  const fmtD = (t) => (t ? new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : '');
  const sgn = (n) => (Math.round(n) > 0 ? '+' : Math.round(n) < 0 ? '−' : '') + fmtN(Math.abs(n));
  const dcls = (n) => (Math.round(n) > 0 ? 'up' : Math.round(n) < 0 ? 'down' : 'zero');
  const pl = (n, w, ws) => n + ' ' + (n === 1 ? w : (ws || w + 's'));
  const short = (name) => String(name || '').replace(/\.xlsx$/i, '');
  function toast(msg, ms) {
    document.querySelectorAll('.toast').forEach((x) => x.remove());
    const el = document.createElement('div'); el.className = 'toast'; el.textContent = msg; el.setAttribute('role', 'status');
    document.body.appendChild(el); setTimeout(() => el.remove(), ms || 2600);
  }
  function needName() {
    if (canEdit()) return false;
    toast('View only. Ask Leo to add you to the design team list to make changes.', 4000);
    return true;
  }
  let saveTimer = null;
  function save() {
    clearTimeout(saveTimer); savePending = true;
    const board = B, meta = META;
    saveTimer = setTimeout(async () => {
      try { await IDB.set('board:' + board.id, board); await IDB.set('meta', meta); }
      finally { savePending = false; if (remoteQ) applyRemote(); }
    }, 150);
  }
  async function flush() { clearTimeout(saveTimer); if (B) await IDB.set('board:' + B.id, B); if (META) await IDB.set('meta', META); savePending = false; }
  const fileById = (id) => B.files.find((f) => f.id === id);
  const sheetModel = (name) => cur && cur.sheets.find((s) => s.name === name);

  /* ---------------- derived state ---------------- */
  const computeFile = (file, model) => OPS.computeFile(file, model);
  function recompute() {
    if (!FILE) return;
    const r = computeFile(FILE, cur);
    AN = r.an; LEG = r.legend; USED = r.used; SETUP = r.eff; F = r.findings; MARKS = r.marks; TOT = r.tot;
    fileCache.set(FILE.id, { key: FILE.log.length + ':' + JSON.stringify(FILE.setup), model: cur, r });
  }
  function fileInfo(file) {
    if (FILE && file.id === FILE.id && cur) return { model: cur, r: { an: AN, legend: LEG, used: USED, eff: SETUP, findings: F, marks: MARKS, tot: TOT } };
    const key = file.log.length + ':' + JSON.stringify(file.setup);
    const c = fileCache.get(file.id);
    if (c && c.key === key) return c;
    const model = E.replay(file.base, file.log);
    const v = { key, model, r: computeFile(file, model) };
    fileCache.set(file.id, v);
    return v;
  }
  const lastRev = OPS.lastRev, draftLabel = OPS.draftLabel;
  const issuesOfFile = (fileId) => B.issues.filter((i) => i.fileId === fileId);
  function issuesAt(sheet) {
    const m = {};
    for (const i of B.issues) if (i.fileId === FILE.id && i.sheet === sheet) for (const a of i.cells) (m[a] = m[a] || []).push(i);
    return m;
  }
  const coveredBy = (f, fileId) => B.issues.find((i) => i.fileId === fileId && i.sheet === f.sheet && f.cells.every((a) => i.cells.includes(a)));
  function liveFindings(file, findings) {
    file = file || FILE; findings = findings || F;
    return findings.filter((f) => !file.dismissed[f.id] && !file.accepted[f.id] && !coveredBy(f, file.id));
  }

  /* ---------------- import ---------------- */
  const readFile = OPS.readFile, rowKey = OPS.rowKey, versionsOf = OPS.versionsOf, tabMatch = OPS.tabMatch;
  const seedColorIssues = (file, model, r, rev, by) => OPS.seedColorIssues(B, file, model, r, rev, by);
  async function addFile(buf, name, opts, model) {
    opts = opts || {};
    model = model || await readFile(buf, name);
    const res = OPS.addFile(B, model, name, opts.by || me, opts);
    await IDB.set('tpl:' + res.file.id, buf);
    return res;
  }

  let pending = null;
  async function onAddFile(f) {
    if (!f || needName()) return;
    let buf, model;
    try { buf = await f.arrayBuffer(); model = await readFile(buf, f.name); } catch (e) { toast('Could not read that file: ' + e.message, 5000); return; }
    // a newer copy of a file that is already on the board? ask before adding a duplicate
    let best = null;
    for (const x of B.files) { const m = tabMatch(fileInfo(x).model, model); if (m.ratio >= 0.6 && (!best || m.ratio > best.m.ratio)) best = { x, m }; }
    if (best) { pending = { model, buf, name: f.name, target: best.x.id, mode: 'add-match' }; showUploadDialog(); return; }
    await doAdd(buf, f.name, model);
  }
  async function doAdd(buf, name, model) {
    const { file, n } = await addFile(buf, name, {}, model);
    selectFile(file.id);
    save(); renderAll();
    toast(`Added ${name} as a separate file.${n ? ' ' + pl(n, 'issue') + ' from red cells.' : ''} Open File setup to name its colors and columns.`, 4500);
  }
  async function onNewVersion(f) {
    if (!f || !FILE || needName()) return;
    let model, buf;
    try { buf = await f.arrayBuffer(); model = await readFile(buf, f.name); } catch (e) { toast('Could not read that file: ' + e.message, 5000); return; }
    pending = { model, buf, name: f.name, target: FILE.id, mode: 'version' };
    showUploadDialog();
  }
  function showUploadDialog() {
    const target = fileById(pending.target);
    if (!FILE || FILE.id !== target.id) { selectFile(target.id); renderAll(); }
    const m = tabMatch(cur, pending.model);
    const mismatch = m.same < Math.max(1, Math.ceil(m.of / 2));
    const cmp = E.compareFiles(cur, pending.model, SETUP);
    const lines = cmp.sheets.map((s) => {
      const bits = [];
      if (s.status === 'added') bits.push('new tab');
      if (s.status === 'removed') bits.push('not in the uploaded file');
      if (s.added.length) bits.push(pl(s.added.length, 'row') + ' added');
      if (s.removed.length) bits.push(pl(s.removed.length, 'row') + ' removed');
      if (s.changed.length) bits.push(pl(s.changed.length, 'row') + ' changed');
      if (s.cells.length && !s.added.length && !s.removed.length && !s.changed.length) bits.push(pl(s.cells.length, 'cell') + ' changed');
      return bits.length ? `<li><b>${esc(s.sheet)}</b>: ${bits.join(', ')}</li>` : '';
    }).join('');
    const diff = `<div><b>Compared with ${esc(short(target.name))} on the board now</b></div>
      ${lines ? `<ul>${lines}</ul>` : '<div class="note">No differences.</div>'}
      ${cmp.from.sf !== null || cmp.to.sf !== null ? `<div>SF ${fmtN(cmp.from.sf)} → ${fmtN(cmp.to.sf)}</div>` : ''}`;
    const how = `<div class="note">A new version replaces the file's contents and is saved as one change in its History, by <b>${esc(me)}</b>. The file keeps its name on the board and lists every uploaded version. Board edits that are not in the uploaded file are replaced; earlier versions stay in History for comparing. Issues whose color is gone get a "close?" suggestion; nothing closes on its own.</div>`;
    const okB = $('#btnImportOk'), altB = $('#btnImportAlt');
    altB.hidden = true; altB.className = 'btn'; okB.className = 'btn primary';
    if (pending.mode === 'add-match') {
      $('#dlgImportH').textContent = 'Is this a new version of a file on the board?';
      $('#dlgImportBody').innerHTML = `<div class="note"><b>${esc(pending.name)}</b> has the same tabs as <b>${esc(short(target.name))}</b>, which is already on this board (${m.same} of ${m.of} tab names match).</div>${diff}${how}`;
      okB.textContent = 'Upload as new version of ' + short(target.name).slice(0, 40); pending.ok = 'replace';
      altB.hidden = false; altB.textContent = 'Add as a separate file'; pending.alt = 'add';
    } else if (mismatch) {
      $('#dlgImportH').textContent = 'This looks like a different file';
      $('#dlgImportBody').innerHTML = `<div class="note warnnote">Only <b>${m.same} of ${m.of}</b> tab names in <b>${esc(pending.name)}</b> match <b>${esc(short(target.name))}</b>. It is probably a different schedule. Add it as its own file to keep both.</div>${diff}`;
      okB.textContent = 'Add as a separate file'; pending.ok = 'add';
      altB.hidden = false; altB.textContent = 'Replace ' + short(target.name).slice(0, 30) + ' anyway'; altB.className = 'btn ghost danger'; pending.alt = 'replace';
    } else {
      $('#dlgImportH').textContent = 'Upload a new version of ' + short(target.name);
      $('#dlgImportBody').innerHTML = `<div>Uploading <b>${esc(pending.name)}</b> as version ${versionsOf(target).length + 1} of <b>${esc(short(target.name))}</b>.</div>${diff}${how}`;
      okB.textContent = 'Replace with this version'; pending.ok = 'replace';
    }
    $('#dlgImport').showModal();
  }
  async function runUpload(action) {
    if (!pending) return;
    if (action === 'add') { const p = pending; pending = null; $('#dlgImport').close(); await doAdd(p.buf, p.name, p.model); return; }
    confirmNewVersion();
  }
  function confirmNewVersion() {
    if (!pending || !FILE) return;
    const keep = ui.sheet;
    const res = OPS.newVersion(B, FILE, pending.model, pending.name, me);
    IDB.set('tpl:' + FILE.id, pending.buf);
    cur = res.model; recompute();
    if (!cur.sheets.some((x) => x.name === keep)) ui.sheet = cur.sheets[0] && cur.sheets[0].name;
    const n = res.n, sug = res.sug;
    pending = null;
    $('#dlgImport').close();
    save(); renderAll();
    toast(`Version ${FILE.versions.length} of ${short(FILE.name)} uploaded.${n ? ' ' + pl(n, 'new issue') + ' from colors.' : ''}${sug ? ' ' + pl(sug, 'issue') + ' may be closed (color removed).' : ''}`, 4500);
  }
  /* ---------------- edits (every change is an op) ---------------- */
  function pushOp(op, opts) {
    op.t = Date.now(); op.by = me; op.id = (FILE.log.length + 1) + '-' + Math.random().toString(36).slice(2, 7);
    FILE.log.push(op);
    E.applyOp(cur, op);
    if (op.k === 'rowIns' || op.k === 'rowDel') shiftIssues(op);
    if (!(opts && opts.noUndo)) myOps.push({ file: FILE.id, idx: FILE.log.length - 1 });
  }
  function shiftIssues(op) {
    for (const i of issuesOfFile(FILE.id)) {
      if (i.sheet !== op.s) continue;
      const next = [];
      for (const a of i.cells) { const p = E.splitA1(a); if (op.k === 'rowIns') next.push(p.r >= op.r ? E.A1(p.c, p.r + 1) : a); else if (p.r !== op.r) next.push(p.r > op.r ? E.A1(p.c, p.r - 1) : a); }
      if (next.length !== i.cells.length) i.trail.push({ t: Date.now(), by: me, what: 'Its row was deleted' });
      i.cells = next;
    }
  }
  const parseInput = (s) => { const t = String(s); if (t.trim() === '') return null; if (/^-?\d+(\.\d+)?$/.test(t.trim())) return Number(t.trim()); return t; };
  function setCell(sheet, a, text) {
    if (needName()) return false;
    const sh = sheetModel(sheet);
    const old = sh.cells[a] ? sh.cells[a][0] : null;
    const oldText = old && typeof old === 'object' && 'f' in old ? '=' + old.f : txt(old);
    if (String(text) === oldText) return false;
    const v = String(text).startsWith('=') && String(text).length > 1 ? { f: String(text).slice(1), v: null } : parseInput(text);
    pushOp({ k: 'set', s: sheet, a, o: old, v });
    afterChange();
    return true;
  }
  function insertRow(sheet, r) { if (needName()) return; pushOp({ k: 'rowIns', s: sheet, r }); afterChange(); select(E.A1(1, r)); toast('Row ' + r + ' inserted'); }
  function deleteRow(sheet, r) {
    if (needName()) return;
    const sh = sheetModel(sheet); const snap = {};
    for (const [a, cv] of Object.entries(sh.cells)) { const p = E.splitA1(a); if (p.r === r) snap[E.colLetters(p.c)] = cv.slice(); }
    pushOp({ k: 'rowDel', s: sheet, r, snap, h: sh.rows[r] || null });
    afterChange(); toast('Row ' + r + ' deleted. Undo with Ctrl+Z.');
  }
  function undo() {
    if (!FILE) return;
    while (myOps.length) {
      const last = myOps[myOps.length - 1];
      if (last.file !== FILE.id) { toast('Your last change was in another file. Open it to undo.'); return; }
      myOps.pop();
      const op = FILE.log[last.idx];
      if (!op || op.undone) continue;
      let inv = null;
      if (op.k === 'set') inv = { k: 'set', s: op.s, a: op.a, o: op.v, v: op.o };
      else if (op.k === 'rowIns') inv = { k: 'rowDel', s: op.s, r: op.r, snap: {} };
      else if (op.k === 'rowDel') inv = { k: 'rowIns', s: op.s, r: op.r, cells: op.snap, h: op.h };
      else if (op.k === 'colW') inv = { k: 'colW', s: op.s, c: op.c, o: op.v, v: op.o };
      else if (op.k === 'rowH') inv = { k: 'rowH', s: op.s, r: op.r, o: op.v, v: op.o };
      if (!inv) continue;
      op.undone = true;
      pushOp(Object.assign(inv, { undo: op.id }), { noUndo: true });
      afterChange(); toast('Undone (logged as a new change)');
      return;
    }
    toast('Nothing of yours to undo in this session');
  }
  function afterChange() { recompute(); save(); renderAll(); }

  /* ---------------- issues ---------------- */
  function newIssue(fields) {
    const i = Object.assign({
      id: B.nextIssue++, fileId: FILE.id, sheet: ui.sheet, cells: [], title: '', source: 'person', owner: 'Unassigned', status: 'open',
      rev: draftLabel(FILE), created: Date.now(), by: me, thread: [], trail: [{ t: Date.now(), by: me, what: 'Opened' }], suggestClose: null,
    }, fields);
    const sh = sheetModel(i.sheet);
    if (sh && i.cells[0]) i.anchorKey = rowKey(sh, SETUP, E.splitA1(i.cells[0]).r);
    B.issues.push(i);
    return i;
  }
  function updateIssue(id, patch, what) {
    const i = B.issues.find((x) => x.id === id); if (!i) return;
    if (needName()) { renderSide(); return; }
    Object.assign(i, patch);
    i.trail.push({ t: Date.now(), by: me, what });
    save(); renderFiles(); renderCards(); renderGrid(); renderTabs(); renderSide();
  }
  async function imgMeta(blob) {
    try { const bmp = await createImageBitmap(blob); const r = { w: bmp.width, h: bmp.height }; if (bmp.close) bmp.close(); return r; }
    catch (e) { return { w: 0, h: 0 }; }
  }
  async function addPending(issueId, blob) {
    if (!blob || !/^image\//.test(blob.type)) return;
    if (blob.size > 12 * 1024 * 1024) { toast('That image is over 12 MB. Crop it and paste again.'); return; }
    const m = await imgMeta(blob);
    (ui.pending[issueId] = ui.pending[issueId] || []).push({ id: uid(), blob, url: URL.createObjectURL(blob), w: m.w, h: m.h, type: blob.type });
    renderSide();
    const ta = $(`[data-reply="${issueId}"]`); if (ta) ta.focus();
  }
  async function sendReply(issueId) {
    if (needName()) return;
    const ta = $(`[data-reply="${issueId}"]`);
    const text = (ta && ta.value || '').trim();
    const imgs = ui.pending[issueId] || [];
    if (!text && !imgs.length) { toast('Write a reply or paste a screenshot first'); return; }
    const i = B.issues.find((x) => x.id === issueId); if (!i) return;
    for (const p of imgs) { await IDB.set('img:' + p.id, p.blob); imgUrl.set(p.id, p.url); }
    i.thread.push({ id: uid(), t: Date.now(), by: me, text, imgs: imgs.map((p) => ({ id: p.id, w: p.w, h: p.h, type: p.type })) });
    i.trail.push({ t: Date.now(), by: me, what: 'Replied' + (imgs.length ? ' with ' + pl(imgs.length, 'screenshot') : '') });
    ui.pending[issueId] = []; delete ui.drafts[issueId];
    if (ta) ta.value = '';
    save(); renderSide(); renderCards();
  }
  const imgUrl = new Map();
  async function hydrateImages() {
    for (const el of document.querySelectorAll('img[data-img]:not([src])')) {
      const id = el.dataset.img;
      if (!imgUrl.has(id)) { const blob = await IDB.get('img:' + id); if (blob) imgUrl.set(id, URL.createObjectURL(blob)); }
      if (imgUrl.has(id)) el.src = imgUrl.get(id); else el.alt = 'Screenshot not found';
    }
  }

  /* ---------------- boards ---------------- */
  async function loadBoard(id) {
    const b = await IDB.get('board:' + id);
    if (!b) return false;
    B = b; META.current = id;
    ui.hl = null; ui.cmpFrom = null; ui.cmpTo = null; ui.focusIssue = null; ui.iFile = ''; fileCache.clear();
    selectFile(B.curFile && fileById(B.curFile) ? B.curFile : (B.files[0] && B.files[0].id));
    return true;
  }
  function selectFile(id) {
    FILE = id ? fileById(id) : null;
    B.curFile = FILE ? FILE.id : null;
    ui.hl = null; ui.cmpFrom = null; ui.cmpTo = null; ui.a = null; ui.b = null; ui.removeArm = false;
    if (FILE) {
      cur = E.replay(FILE.base, FILE.log);
      recompute();
      const tabs = cur.sheets.filter((s) => !(SETUP.sheets[s.name] && SETUP.sheets[s.name].ignore));
      ui.sheet = (tabs[0] || cur.sheets[0]).name;
    } else { cur = null; ui.sheet = null; AN = null; F = []; MARKS = []; USED = []; SETUP = null; }
  }
  async function newBoard(name) {
    const id = await IDB.createBoard(name);
    META.boards.push({ id, name });
    await loadBoard(id);
  }
  /* Somebody else saved this board: take their copy, keep what this person is looking at. */
  function applyRemote() {
    if (!remoteQ || !B || remoteQ.id !== B.id) { remoteQ = null; return; }
    const ae = document.activeElement;
    const busy = savePending || document.querySelector('dialog[open]') || document.querySelector('#grid td.editing') || (ae && ae.matches && ae.matches('textarea, #fbar, input[type="text"], input:not([type])'));
    if (busy) { clearTimeout(applyRemote.t); applyRemote.t = setTimeout(applyRemote, 1200); return; }
    const q = remoteQ; remoteQ = null;
    const keepFile = FILE && FILE.id, keepSheet = ui.sheet, keepA = ui.a, keepB = ui.b;
    IDB.get('board:' + B.id).then((nb) => {
      if (!nb || !B || nb.id !== B.id) return;
      B = nb; fileCache.clear();
      const same = keepFile && fileById(keepFile);
      selectFile(same ? keepFile : (B.files[0] && B.files[0].id));
      if (same && cur && cur.sheets.some((x) => x.name === keepSheet)) { ui.sheet = keepSheet; ui.a = keepA; ui.b = keepB; }
      renderAll();
      toast('Updated by ' + (q.by || 'a teammate'), 2200);
    });
  }

  /* ---------------- render ---------------- */
  function renderAll() { renderHeader(); renderFiles(); renderCards(); renderTabs(); renderGrid(); renderSide(); }

  function renderHeader() {
    $('#boardSel').innerHTML = META.boards.map((b) => `<option value="${esc(b.id)}" ${B && b.id === B.id ? 'selected' : ''}>${esc(b.name)}</option>`).join('') + '<option value="__new">+ New board…</option>';
    $('#btnExport').disabled = !FILE;
  }
  function renderFiles() {
    const bar = $('#fileBar');
    if (!B.files.length) { bar.innerHTML = '<span class="note" style="flex:1">No files on this board yet. Use <b>Add Excel file</b>.</span>'; $('#setupBanner').hidden = true; return; }
    bar.innerHTML = B.files.map((f) => {
      const open = B.issues.filter((i) => i.fileId === f.id && i.status !== 'closed').length;
      return `<button class="fchip ${FILE && f.id === FILE.id ? 'on' : ''}" data-file="${esc(f.id)}" title="${esc(f.name)}"><span class="fname">${esc(short(f.name))}</span>${f.setup && f.setup.done ? '<span class="pill ok">set up</span>' : '<span class="pill warn">needs setup</span>'}${open ? `<span class="n" title="open issues">${open}</span>` : ''}</button>`;
    }).join('') + (FILE ? `<span class="fbar-acts"><span class="sel" title="${esc(FILE.name)}">Selected: <b>${esc(short(FILE.name))}</b></span><button class="btn small" data-act="newVer" title="Replace this file with a newer copy of the same schedule; saved as one change in its History">Upload new version</button><button class="btn small" data-act="setup">File setup</button><button class="btn small ghost ${ui.removeArm ? 'danger' : ''}" data-act="removeFile">${ui.removeArm ? 'Click again to remove the file and its issues' : 'Remove file'}</button></span>` : '');
    const banner = $('#setupBanner');
    const need = FILE && !(FILE.setup && FILE.setup.done);
    banner.hidden = !need;
    if (need) banner.innerHTML = `<b>${esc(short(FILE.name))}</b> isn't set up yet. You can use it now, and the checks that need no setup are already running. <button class="linkish" data-act="setup">Open File setup</button> to say what each color means and which columns are the ID, the notes and the required fields.`;
  }

  function renderCards() {
    // 1. files
    const rows = B.files.map((f) => {
      const info = fileInfo(f);
      const live = liveFindings(f, info.r.findings).length;
      const open = B.issues.filter((i) => i.fileId === f.id && i.status !== 'closed').length;
      const tabs = info.model.sheets.length, ign = info.model.sheets.filter((s) => f.setup.sheets[s.name] && f.setup.sheets[s.name].ignore).length;
      return `<tr class="${FILE && f.id === FILE.id ? 'cur' : ''}"><td><button class="linkish fl" data-file="${esc(f.id)}" title="${esc(f.name)}">${esc(short(f.name))}</button><div class="sub">${pl(tabs - ign, 'tab')}${ign ? ` (+${ign} ignored)` : ''} · ${fmtN(info.r.tot.rows)} rows${info.r.tot.sf !== null ? ' · ' + fmtN(info.r.tot.sf) + ' SF' : ''}${versionsOf(f).length > 1 ? ` · <span title="${esc(versionsOf(f).map((v, k) => 'v' + (k + 1) + ': ' + v.name + ' (' + fmtT(v.t) + ', ' + v.by + ')').join('\n'))}">${pl(versionsOf(f).length, 'version')}</span>` : ''}</div></td>
        <td class="n">${open}</td><td class="n">${live}</td><td>${f.setup.done ? '<span class="pill ok">set up</span>' : '<span class="pill warn">setup</span>'}</td></tr>`;
    }).join('');
    $('#cardFiles').innerHTML = `<h2>Files <span class="aside">${esc(B.name)} · ${pl(B.files.length, 'file')}</span></h2>
      ${B.files.length ? `<table class="ftable"><thead><tr><th>File</th><th class="n">Open<br>issues</th><th class="n">Checks</th><th></th></tr></thead><tbody>${rows}</tbody></table>` : '<div class="note">Add an Excel file to start.</div>'}`;
    // 2. issues
    const cnt = {}; OWNERS.forEach((o) => { cnt[o] = { open: 0, asked: 0, answered: 0, closed: 0 }; });
    for (const i of B.issues) { const o = cnt[i.owner] ? i.owner : 'Unassigned'; cnt[o][i.status]++; }
    const active = B.issues.filter((i) => i.status !== 'closed').length;
    const sug = B.issues.filter((i) => i.suggestClose && i.status !== 'closed').length;
    const cell = (o, st) => { const n = cnt[o][st]; return `<td>${n ? `<button data-owner="${esc(o)}" data-st="${st}" title="Show ${STATUS_LABEL[st].toLowerCase()} issues for ${esc(o)}">${n}</button>` : '<span class="zero">0</span>'}</td>`; };
    $('#cardIssues').innerHTML = `<h2>Issues <span class="aside">${B.issues.length} total · all files</span></h2>
      <div class="big">${active}<small>not closed</small>${sug ? ` <button class="pill warn" data-act="showSug" style="border:0;cursor:pointer">${sug} may be closed</button>` : ''}</div>
      <table class="matrix"><thead><tr><th>Owner</th>${STATUS.map(([, l]) => `<th>${l}</th>`).join('')}</tr></thead>
      <tbody>${OWNERS.map((o) => `<tr><td>${esc(o)}</td>${STATUS.map(([st]) => cell(o, st)).join('')}</tr>`).join('')}</tbody></table>`;
    // 3. checks
    let tot = 0; const sev = { error: 0, warn: 0, info: 0 };
    const per = B.files.map((f) => { const l = liveFindings(f, fileInfo(f).r.findings); tot += l.length; l.forEach((x) => sev[x.sev]++); return { f, l }; });
    $('#cardChecks').innerHTML = `<h2>Checks to review <span class="aside">all files</span></h2>
      <div class="big">${tot}<small>to review</small></div>
      <div class="filters">${sev.error ? `<span class="pill bad">${pl(sev.error, 'error')}</span>` : ''}${sev.warn ? `<span class="pill warn">${pl(sev.warn, 'warning')}</span>` : ''}${sev.info ? `<span class="pill info">${sev.info} info</span>` : ''}</div>
      <div class="kv">${per.map(({ f, l }) => `<div class="k"><button class="linkish" data-file="${esc(f.id)}" data-go="checks" title="${esc(f.name)}">${esc(short(f.name))}</button></div><div class="v">${l.length}</div>`).join('')}</div>
      <div class="sub foot">Fixed rules in code: the same file always gives the same result.</div>`;
    // 4. current file: revisions + changes
    if (!FILE) { $('#cardRev').innerHTML = '<h2>Revisions & changes</h2><div class="note">No file selected.</div>'; return; }
    const lr = lastRev(FILE);
    const stCls = (s) => (/Approved/.test(s) ? 'ok' : /Revise|Rejected/.test(s) ? 'bad' : s === 'Submitted' ? 'info' : 'warn');
    let chg = '';
    if (lr) {
      const ch = E.changedCells(FILE.base, FILE.log, lr.at, FILE.log.length);
      let cells = 0; Object.values(ch).forEach((m) => { cells += m.size; });
      const on = ui.hl === lr.at;
      chg = `<div class="kv"><div class="k">Changed since ${esc(lr.label)}</div><div class="v"><b>${pl(cells, 'cell')}</b> · ${pl(FILE.log.length - lr.at, 'edit')}</div></div>
        <div class="foot"><button class="btn small ${on ? 'primary' : ''}" data-hl="${lr.at}" aria-pressed="${on}">${on ? 'Hide on sheet' : 'Show on sheet'}</button><button class="btn small" data-go="history">Compare</button></div>`;
    }
    $('#cardRev').innerHTML = `<h2>Revisions & changes <span class="aside" title="${esc(FILE.name)}">${esc(short(FILE.name).slice(0, 24))}</span></h2>
      ${lr ? `<div style="display:flex;align-items:baseline;gap:8px;flex-wrap:wrap"><span class="big">${esc(lr.label)}</span><span class="pill ${stCls(lr.status)}">${esc(lr.status)}</span></div>
      <div class="kv"><div class="k">Ball in court</div><div class="v"><b>${esc(lr.bic || '—')}</b></div><div class="k">Submitted / returned</div><div class="v">${lr.submitted ? esc(fmtD(lr.submitted + 'T12:00')) : '—'} / ${lr.returned ? esc(fmtD(lr.returned + 'T12:00')) : '—'}</div></div>${chg}`
        : `<div class="note">No revision pinned for this file yet. Pin one in <button class="linkish" data-go="revs">Revisions</button> when it goes out, so the next round can be compared with it.</div>
        <div class="kv"><div class="k">Edits on the board</div><div class="v">${FILE.log.length}</div></div>
        <div class="foot"><button class="btn small" data-go="history">History</button></div>`}`;
  }

  function renderTabs() {
    if (!FILE) { $('#sheetTabs').innerHTML = ''; return; }
    const im = {};
    for (const i of issuesOfFile(FILE.id)) if (i.status !== 'closed') im[i.sheet] = (im[i.sheet] || 0) + 1;
    $('#sheetTabs').innerHTML = cur.sheets.map((s) => {
      const ign = SETUP.sheets[s.name] && SETUP.sheets[s.name].ignore;
      return `<button class="tab ${s.name === ui.sheet ? 'on' : ''} ${ign ? 'ign' : ''}" role="tab" aria-selected="${s.name === ui.sheet}" data-sheet="${esc(s.name)}" ${ign ? 'title="Not part of this project (File setup): no checks, no issues"' : ''}>${esc(s.name)}${im[s.name] ? `<span class="n">${im[s.name]}</span>` : ''}</button>`;
    }).join('');
  }

  function color(c) {
    if (!c) return null;
    const h = E.colorHex(c, cur.theme);
    return h ? '#' + h : null;
  }
  const styleCache = new Map();
  function cssOf(sid) {
    const key = FILE.id + ':' + (cur.importedAt || 0) + ':' + sid;
    if (styleCache.has(key)) return styleCache.get(key);
    const st = cur.styles[sid] || {};
    const css = [];
    if (st.fill && st.fill.fgColor) { const c = color(st.fill.fgColor); if (c && c.toUpperCase() !== '#FFFFFF') css.push('background-color:' + c); }
    if (st.font) {
      const c = color(st.font.color); if (c) css.push('color:' + c);
      if (st.font.bold) css.push('font-weight:700');
      if (st.font.italic) css.push('font-style:italic');
      if (st.font.underline) css.push('text-decoration:underline');
      if (st.font.strike) css.push('text-decoration:line-through');
      if (st.font.size && st.font.size !== 11) css.push('font-size:' + Math.max(9, Math.min(22, st.font.size / 11 * 12.5)).toFixed(1) + 'px');
    }
    if (st.alignment) {
      const h = st.alignment.horizontal; if (h) css.push('text-align:' + (h === 'centerContinuous' ? 'center' : h === 'distributed' ? 'justify' : h === 'fill' ? 'left' : h));
      const v = st.alignment.vertical; if (v) css.push('vertical-align:' + (v === 'middle' ? 'middle' : v === 'top' ? 'top' : 'bottom'));
    }
    if (st.border) for (const side of ['top', 'right', 'bottom', 'left']) {
      const b = st.border[side]; if (!b || !b.style) continue;
      const w = /medium|mediumDash/.test(b.style) ? 2 : /thick|double/.test(b.style) ? 3 : 1;
      const sty = /dash/i.test(b.style) ? 'dashed' : /dot|hair/.test(b.style) ? 'dotted' : b.style === 'double' ? 'double' : 'solid';
      css.push(`border-${side}:${w}px ${sty} ${color(b.color) || 'var(--paper-line)'}`);
    }
    const s = css.join(';'); styleCache.set(key, s); return s;
  }
  const colPx = (w) => Math.round((w || 8.43) * 7 + 5);
  function selRange() {
    if (!ui.a) return null;
    const p = E.splitA1(ui.a), q = E.splitA1(ui.b || ui.a);
    return { c1: Math.min(p.c, q.c), r1: Math.min(p.r, q.r), c2: Math.max(p.c, q.c), r2: Math.max(p.r, q.r) };
  }
  function cellDisplay(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'number') return Number.isInteger(v) ? String(v) : String(Math.round(v * 10000) / 10000);
    if (typeof v === 'object' && 'f' in v) return cellDisplay(v.v);
    return txt(v);
  }
  function renderGrid() {
    const wrap = $('#grid');
    const sh = FILE && sheetModel(ui.sheet);
    if (!sh) { wrap.innerHTML = '<div class="empty-sheet">No file selected. Use <b>Add Excel file</b> to put a schedule on this board.</div>'; renderToolbar(); return; }
    const mi = E.mergeIndex(sh);
    const span = {};
    for (const m of sh.merges) { const o = E.parseRange(m); span[E.A1(o.c1, o.r1)] = { rs: o.r2 - o.r1 + 1, cs: o.c2 - o.c1 + 1 }; }
    const a0 = AN[sh.name];
    const ign = a0 && a0.ignore;
    const iss = issuesAt(sh.name);
    const fnd = {}; const ord = { error: 0, warn: 1, info: 2 };
    if (!ign) for (const f of liveFindings()) if (f.sheet === sh.name) for (const a of f.cells) if (!fnd[a] || ord[f.sev] < ord[fnd[a]]) fnd[a] = f.sev;
    const chg = ui.hl !== null ? (E.changedCells(FILE.base, FILE.log, ui.hl, FILE.log.length)[sh.name] || new Map()) : null;
    const imgAt = {}; for (const im of sh.images || []) (imgAt[im.a] = imgAt[im.a] || []).push(im);
    const legendCells = LEG ? LEG.cells : new Set();
    const rg = selRange();
    let tw = 50; for (let c = 1; c <= sh.maxCol; c++) tw += colPx(sh.cols[c]);
    const out = [];
    out.push(`<table class="xl" role="grid" style="width:${tw}px" aria-label="${esc(sh.name)}"><colgroup><col style="width:50px">`);
    for (let c = 1; c <= sh.maxCol; c++) out.push(`<col style="width:${colPx(sh.cols[c])}px">`);
    out.push('</colgroup><thead><tr><th class="corner"></th>');
    for (let c = 1; c <= sh.maxCol; c++) out.push(`<th class="${rg && c >= rg.c1 && c <= rg.c2 ? 'sel' : ''}">${E.colLetters(c)}<span class="cres" data-col="${c}" title="Drag to resize column ${E.colLetters(c)}; double-click to fit the text"></span></th>`);
    out.push('</tr></thead><tbody>');
    for (let r = 1; r <= sh.maxRow; r++) {
      const h = sh.rows[r] ? Math.round(sh.rows[r] * 4 / 3) : 20;
      const info = a0 && a0.rowInfo[r];
      const tag = info && info.kind === 'header' ? '<span class="rtag h" title="Read as a header row">H</span>' : info && info.kind === 'subtotal' ? '<span class="rtag s" title="Read as a subtotal / total row">Σ</span>' : '';
      out.push(`<tr style="height:${h}px" data-r="${r}"><th class="${rg && r >= rg.r1 && r <= rg.r2 ? 'sel' : ''}">${r}${tag}<span class="rres" data-row="${r}" title="Drag to resize row ${r}; double-click for automatic height"></span></th>`);
      for (let c = 1; c <= sh.maxCol; c++) {
        const a = E.A1(c, r);
        if (mi[a] && mi[a] !== a) continue;
        const cv = sh.cells[a];
        const sp = span[a];
        const cls = [];
        if (a === ui.a) cls.push('sel'); else if (rg && c >= rg.c1 && c <= rg.c2 && r >= rg.r1 && r <= rg.r2) cls.push('insel');
        let deco = '', title = '';
        const il = iss[a];
        if (il) {
          const open = il.some((i) => i.status !== 'closed');
          deco += `<span class="tri ${open ? 'issue' : 'closed'}"></span>`;
          title += il.map((i) => `#${i.id} ${STATUS_LABEL[i.status]} · ${i.owner}: ${i.title}`).join('\n');
        }
        if (fnd[a]) { deco += `<span class="dot ${fnd[a]}"></span>`; title += (title ? '\n' : '') + 'Check: ' + SEV_LABEL[fnd[a]]; }
        if (chg && chg.has(a)) { cls.push('chg'); title += (title ? '\n' : '') + 'Changed. Was: ' + (txt(chg.get(a)) || '(empty)'); }
        let style = cv ? cssOf(cv[1]) : '';
        if (cv && txt(cv[0]).trim() && !legendCells.has(sh.name + '!' + a)) {
          const k = E.colorKey(cur, cv[1]); const cs = k && SETUP.colors[k];
          if (cs) title += (title ? '\n' : '') + 'Color: ' + cs.label + ' (' + KIND_LABEL[cs.kind].toLowerCase() + ')';
        }
        if (il && !ign) {
          const open = il.some((i) => i.status !== 'closed');
          if (!open) style += ';background-color:#c6efce;color:#006100';
          else if (!(cv && E.cellIssueColor(cur, SETUP, sh.name, a))) style += ';box-shadow:inset 0 0 0 2px #cf222e';
        }
        if (cv && cv[0] && typeof cv[0] === 'object' && 'f' in cv[0] && cv[0].f) title += (title ? '\n' : '') + '=' + cv[0].f;
        let content = esc(cv ? cellDisplay(cv[0]) : '');
        if (imgAt[a]) content += imgAt[a].map((im) => (im.media !== null && cur.media && cur.media[im.media]
          ? `<img class="xlimg" alt="Picture from the Excel" src="data:image/${im.ext === 'jpg' ? 'jpeg' : im.ext};base64,${cur.media[im.media].b64}">`
          : `<span class="xlpic" title="${esc((im.ext || '').toUpperCase())} picture. Browsers can't show this format; it stays in the file and in the export.">▣ picture</span>`)).join('');
        // rows with a set height clip like Excel does; the full text stays in the tooltip
        const rs = sp ? sp.rs : 1;
        let clip = '';
        let all = true, sum = 0;
        for (let k = r; k < r + rs; k++) { if (!sh.rows[k]) { all = false; break; } sum += Math.round(sh.rows[k] * 4 / 3); }
        if (all) { clip = ` style="max-height:${Math.max(8, sum - 7)}px"`; const full = cv ? cellDisplay(cv[0]) : ''; if (full.length > 24 && !title.includes(full)) title = full + (title ? '\n' + title : ''); }
        out.push(`<td data-a="${a}"${sp ? ` rowspan="${sp.rs}" colspan="${sp.cs}"` : ''} class="${cls.join(' ')}" style="${style}"${title ? ` title="${esc(title)}"` : ''}><div class="cv"${clip}>${content}</div>${deco}</td>`);
      }
      out.push('</tr>');
    }
    out.push('</tbody></table>');
    const st = wrap.scrollTop, sl = wrap.scrollLeft;
    wrap.innerHTML = (ign ? '<div class="ignbar">This tab is marked "not part of this project" in File setup. No checks or issues run here.</div>' : '') + out.join('');
    wrap.scrollTop = st; wrap.scrollLeft = sl;
    renderToolbar();
  }
  function renderToolbar() {
    const sh = FILE && sheetModel(ui.sheet);
    const rg = selRange();
    $('#addr').textContent = ui.a ? (rg && (rg.c1 !== rg.c2 || rg.r1 !== rg.r2) ? E.rangeStr(rg) : ui.a) : '—';
    const fb = $('#fbar');
    if (document.activeElement !== fb) { const cv = ui.a && sh && sh.cells[ui.a]; fb.value = cv ? (cv[0] && typeof cv[0] === 'object' && cv[0].f ? '=' + cv[0].f : txt(cv[0])) : ''; }
    fb.disabled = !ui.a;
    const r = ui.a ? E.splitA1(ui.a).r : null;
    $('#btnIns').disabled = !ui.a; $('#btnDel').disabled = !ui.a; $('#btnFlag').disabled = !ui.a;
    if (ui.delArm && ui.delArm.r === r && ui.delArm.sheet === ui.sheet) $('#btnDel').textContent = 'Click again to delete row ' + r;
    else { $('#btnDel').textContent = 'Delete row'; ui.delArm = null; }
    let info = '';
    if (ui.a && sh) {
      const il = (issuesAt(sh.name)[ui.a] || []);
      const fl = liveFindings().filter((f) => f.sheet === sh.name && f.cells.includes(ui.a));
      info = il.map((i) => `<button class="pill ${i.status === 'closed' ? 'ok' : 'bad'}" data-issue="${i.id}" style="cursor:pointer;border:0">Issue #${i.id}</button>`).join(' ')
        + fl.map((f) => ` <button class="pill ${f.sev === 'error' ? 'bad' : f.sev === 'warn' ? 'warn' : 'info'}" data-finding="${esc(f.id)}" style="cursor:pointer;border:0">${esc(f.title)}</button>`).join('');
    }
    $('#cellInfo').innerHTML = info;
    const lr = FILE && (FILE.revs || []).find((x) => x.at === ui.hl);
    $('#cmpBar').hidden = ui.hl === null;
    if (ui.hl !== null) $('#cmpBarText').innerHTML = `Highlighted: cells changed since <b>${esc(lr ? lr.label : 'that point')}</b>. Hover a cell to see what it was.`;
  }

  /* ---------------- selection + editing ---------------- */
  function select(a, extend) {
    const sh = sheetModel(ui.sheet); if (!sh) return;
    a = E.masterOf(sh, a);
    if (extend && ui.a) ui.b = a; else { ui.a = a; ui.b = null; }
    renderGrid();
    const td = $(`#grid td[data-a="${a}"]`); if (td) td.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }
  function move(dr, dc) {
    if (!ui.a) return;
    const sh = sheetModel(ui.sheet); const mi = E.mergeIndex(sh);
    let { c, r } = E.splitA1(ui.a);
    const span = sh.merges.map(E.parseRange).find((o) => o.c1 === c && o.r1 === r);
    if (span) { if (dr > 0) r = span.r2; if (dc > 0) c = span.c2; }
    r = Math.min(Math.max(1, r + dr), sh.maxRow); c = Math.min(Math.max(1, c + dc), sh.maxCol);
    select(mi[E.A1(c, r)] || E.A1(c, r));
  }
  function startEdit(initial) {
    if (!ui.a || needName()) return;
    const td = $(`#grid td[data-a="${ui.a}"]`); if (!td) return;
    const sh = sheetModel(ui.sheet);
    const cv = sh.cells[ui.a];
    const old = cv ? (cv[0] && typeof cv[0] === 'object' && cv[0].f ? '=' + cv[0].f : txt(cv[0])) : '';
    const a = ui.a;
    td.classList.add('editing'); td.innerHTML = '';
    const ta = document.createElement('textarea');
    ta.className = 'cell-ed'; ta.value = initial !== undefined ? initial : old; ta.setAttribute('aria-label', 'Edit ' + a);
    td.appendChild(ta); ta.focus(); ta.setSelectionRange(ta.value.length, ta.value.length);
    let done = false;
    const finish = (commit, dr, dc) => {
      if (done) return; done = true;
      if (commit && ta.value !== old) setCell(ui.sheet, a, ta.value); else renderGrid();
      if (dr || dc) move(dr || 0, dc || 0);
      $('#grid').focus({ preventScroll: true });
    };
    ta.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey && !e.altKey) { e.preventDefault(); finish(true, 1, 0); }
      else if (e.key === 'Tab') { e.preventDefault(); finish(true, 0, e.shiftKey ? -1 : 1); }
      else if (e.key === 'Escape') { e.preventDefault(); finish(false); }
      e.stopPropagation();
    });
    ta.addEventListener('blur', () => finish(true));
  }

  /* ---------------- resizing columns and rows ---------------- */
  const toChars = (px) => Math.max(0.5, (px - 5) / 7);
  const lastTap = { key: null, t: 0 };
  function startResize(h, e) {
    const sh = sheetModel(ui.sheet); if (!sh) return;
    const isCol = h.classList.contains('cres');
    const table = $('#grid table.xl');
    const c = +h.dataset.col, r = +h.dataset.row;
    const colEl = isCol ? table.querySelectorAll('colgroup col')[c] : null;
    const tr = isCol ? null : h.closest('tr');
    const startPx = isCol ? colEl.getBoundingClientRect().width || parseFloat(colEl.style.width) : tr.getBoundingClientRect().height;
    const startW = table.getBoundingClientRect().width;
    const x0 = e.clientX, y0 = e.clientY;
    let px = startPx;
    h.classList.add('on'); document.body.classList.add('resizing'); document.body.style.cursor = isCol ? 'col-resize' : 'row-resize';
    const tip = document.createElement('div'); tip.className = 'sizetip'; document.body.appendChild(tip);
    try { h.setPointerCapture(e.pointerId); } catch (err) { /* older browsers */ }
    const mv = (ev) => {
      if (isCol) { px = Math.max(16, startPx + ev.clientX - x0); colEl.style.width = px + 'px'; table.style.width = (startW + px - startPx) + 'px'; tip.textContent = `Column ${E.colLetters(c)}: ${toChars(px).toFixed(1)}`; }
      else { px = Math.max(12, startPx + ev.clientY - y0); tr.style.height = px + 'px'; tr.querySelectorAll('td:not([rowspan]) .cv').forEach((d) => { d.style.maxHeight = Math.max(8, px - 7) + 'px'; }); tip.textContent = `Row ${r}: ${Math.round(px * 0.75)} pt`; }
      tip.style.left = ev.clientX + 14 + 'px'; tip.style.top = ev.clientY + 14 + 'px';
    };
    const up = () => {
      h.removeEventListener('pointermove', mv); h.removeEventListener('pointerup', up); h.removeEventListener('pointercancel', up);
      tip.remove(); h.classList.remove('on'); document.body.classList.remove('resizing'); document.body.style.cursor = '';
      if (Math.abs(px - startPx) < 2) {
        // two quick clicks on the same edge = fit (pointer events swallow dblclick here)
        const key = (isCol ? 'c' : 'r') + (isCol ? c : r), now = Date.now();
        if (lastTap.key === key && now - lastTap.t < 450) { lastTap.key = null; fitSize(h); } else { lastTap.key = key; lastTap.t = now; renderGrid(); }
        return;
      }
      if (isCol) {
        const o = sh.cols[c] === undefined ? null : sh.cols[c];
        const v = Math.round(toChars(px) * 100) / 100;
        pushOp({ k: 'colW', s: ui.sheet, c, o, v });
        toast(`Column ${E.colLetters(c)} resized. Saved in History and in the export.`);
      } else {
        const o = sh.rows[r] === undefined ? null : sh.rows[r];
        pushOp({ k: 'rowH', s: ui.sheet, r, o, v: Math.round(px * 0.75 * 100) / 100 });
        toast(`Row ${r} resized. Saved in History and in the export.`);
      }
      afterChange();
    };
    h.addEventListener('pointermove', mv); h.addEventListener('pointerup', up); h.addEventListener('pointercancel', up);
  }
  function fitSize(h) {
    if (needName()) return;
    const sh = sheetModel(ui.sheet); if (!sh) return;
    if (h.classList.contains('rres')) {
      const r = +h.dataset.row;
      if (sh.rows[r] === undefined) { toast('Row ' + r + ' already has automatic height'); return; }
      pushOp({ k: 'rowH', s: ui.sheet, r, o: sh.rows[r], v: null });
      afterChange(); toast('Row ' + r + ' set to automatic height');
      return;
    }
    const c = +h.dataset.col;
    const mi = E.mergeIndex(sh);
    let longest = 0;
    for (let r = 1; r <= sh.maxRow; r++) {
      const a = E.A1(c, r);
      if (mi[a] && mi[a] !== a) continue;
      if (sh.merges.some((m) => { const o = E.parseRange(m); return o.c1 === c && o.r1 === r && o.c2 > o.c1; })) continue; // spans other columns
      const cv = sh.cells[a]; if (!cv) continue;
      const lines = cellDisplay(cv[0]).split('\n');
      for (const l of lines) longest = Math.max(longest, l.length);
    }
    const v = Math.max(4, Math.min(80, Math.round(longest * 1.05 + 2)));
    const o = sh.cols[c] === undefined ? null : sh.cols[c];
    if (o === v) return;
    pushOp({ k: 'colW', s: ui.sheet, c, o, v });
    afterChange(); toast(`Column ${E.colLetters(c)} fitted to its text (${v}).`);
  }

  /* ---------------- side panel ---------------- */
  function renderSide() {
    const open = B.issues.filter((i) => i.status !== 'closed').length;
    const live = FILE ? liveFindings().length : 0;
    $('#sideTabs').innerHTML = [['issues', `Issues (${open})`], ['checks', `Checks (${live})`], ['history', 'History'], ['revs', 'Revisions']]
      .map(([k, l]) => `<button class="tab ${ui.side === k ? 'on' : ''}" role="tab" aria-selected="${ui.side === k}" data-side="${k}">${l}</button>`).join('');
    const body = $('#sideBody');
    const st = body.scrollTop;
    body.querySelectorAll('[data-reply]').forEach((ta) => { if (ta.value) ui.drafts[ta.dataset.reply] = ta.value; });
    if (ui.side === 'issues') body.innerHTML = issuesPanel();
    else if (!FILE) body.innerHTML = '<div class="note">Add a file to see its checks, history and revisions.</div>';
    else if (ui.side === 'checks') body.innerHTML = checksPanel();
    else if (ui.side === 'history') body.innerHTML = historyPanel();
    else body.innerHTML = revsPanel();
    body.querySelectorAll('[data-reply]').forEach((ta) => { if (ui.drafts[ta.dataset.reply]) ta.value = ui.drafts[ta.dataset.reply]; });
    body.scrollTop = st;
    if (ui.focusIssue) { const el = $(`#sideBody [data-issue-card="${ui.focusIssue}"]`); if (el) el.scrollIntoView({ block: 'nearest' }); }
    hydrateImages();
  }
  const cellBtn = (fileId, sheet, a) => `<button class="cellref" data-goto="${esc(fileId)}|${esc(sheet)}|${a}" title="Go to ${esc(sheet)}!${a}">${FILE && fileId === FILE.id && sheet === ui.sheet ? '' : esc(sheet) + '!'}${a}</button>`;

  function issuesPanel() {
    let list = B.issues.slice().reverse();
    if (ui.iFilter === 'active') list = list.filter((i) => i.status !== 'closed');
    else if (ui.iFilter === 'suggest') list = list.filter((i) => i.suggestClose && i.status !== 'closed');
    else if (ui.iFilter !== 'all') list = list.filter((i) => i.status === ui.iFilter);
    if (ui.iOwner) list = list.filter((i) => i.owner === ui.iOwner);
    if (ui.iFile) list = list.filter((i) => i.fileId === ui.iFile);
    if (ui.iSheetOnly && FILE) list = list.filter((i) => i.fileId === FILE.id && i.sheet === ui.sheet);
    const chips = [['active', 'Not closed'], ['open', 'Open'], ['asked', 'Asked'], ['answered', 'Answered'], ['closed', 'Closed'], ['all', 'All']]
      .map(([k, l]) => `<button class="chip ${ui.iFilter === k ? 'on' : ''}" data-if="${k}">${l}</button>`).join('')
      + (B.issues.some((i) => i.suggestClose && i.status !== 'closed') ? `<button class="chip ${ui.iFilter === 'suggest' ? 'on' : ''}" data-if="suggest">May be closed</button>` : '');
    const rg = selRange();
    const selCells = [];
    if (rg && FILE) for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { const a = E.masterOf(sheetModel(ui.sheet), E.A1(c, r)); if (!selCells.includes(a)) selCells.push(a); }
    const form = `<div class="form">
      <div class="sec-h" style="margin:0">New issue ${selCells.length ? 'on ' + esc(ui.sheet) + '!' + esc(selCells.length > 3 ? selCells[0] + '…' + selCells[selCells.length - 1] : selCells.join(', ')) : ''}</div>
      ${selCells.length ? `<div class="r"><input class="mini" id="niTitle" placeholder="What needs to be resolved?" maxlength="300">
        <select class="mini" id="niOwner" aria-label="Owner">${OWNERS.map((o) => `<option>${esc(o)}</option>`).join('')}</select>
        <button class="btn small primary" data-act="newIssue">Add</button></div>` : '<div class="sub">Select one or more cells on the sheet first (Shift+click for a range).</div>'}
    </div>`;
    const fname = (id) => { const f = fileById(id); return f ? short(f.name) : 'removed file'; };
    const items = list.map((i) => {
      const expanded = ui.open.has(i.id) || ui.focusIssue === i.id;
      const msgs = i.thread || [];
      const showAll = ui.showAll.has(i.id);
      const shown = showAll ? msgs : msgs.slice(-2);
      const pend = ui.pending[i.id] || [];
      const src = i.source === 'color' ? `<span class="src" title="From a colored cell in the Excel">${esc(i.colorLabel || 'Color')}</span>` : i.source === 'rule' ? '<span class="src">Check</span>' : '<span class="src">Added</span>';
      return `
      <div class="item st-${i.status} ${ui.focusIssue === i.id ? 'focus' : ''}" data-issue-card="${i.id}">
        <button class="ttl ttlbtn" data-toggle="${i.id}" aria-expanded="${expanded}"><span class="id">#${i.id}</span>${esc(i.title)}<span class="chev">${expanded ? '▾' : '▸'}</span></button>
        <div class="meta">${i.cells.length ? i.cells.slice(0, 4).map((a) => cellBtn(i.fileId, i.sheet, a)).join(' ') + (i.cells.length > 4 ? ' …' : '') : '<span>row deleted</span>'}
          <span>${esc(fname(i.fileId))} · ${esc(i.sheet)}</span>${src}<span>${esc(i.rev || '')}</span>${msgs.length ? `<span>${pl(msgs.length, 'reply', 'replies')}</span>` : ''}</div>
        ${i.suggestClose && i.status !== 'closed' ? `<div class="sugg">${esc(i.suggestClose.why)}. Close this issue? <button class="btn small" data-close="${i.id}">Close it</button> <button class="btn small ghost" data-keep="${i.id}">Keep open</button></div>` : ''}
        <div class="ctrls">
          <label>Owner<select class="mini" data-iowner="${i.id}">${OWNERS.map((o) => `<option ${o === i.owner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select></label>
          <label>Status<select class="mini" data-istatus="${i.id}">${STATUS.map(([k, l]) => `<option value="${k}" ${k === i.status ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        </div>
        ${expanded ? `
        <div class="thread">
          ${msgs.length > 2 && !showAll ? `<button class="linkish" data-showall="${i.id}">Show all ${msgs.length} replies</button>` : ''}
          ${shown.map((m) => `<div class="msg"><div class="mh"><b>${esc(m.by)}</b><span>${esc(fmtT(m.t))}</span></div>${m.text ? `<div class="mt">${esc(m.text)}</div>` : ''}${m.imgs && m.imgs.length ? `<div class="thumbs">${m.imgs.map((im) => `<button class="thumb" data-view="${esc(im.id)}" title="Open screenshot"><img data-img="${esc(im.id)}" alt="Screenshot"></button>`).join('')}</div>` : ''}</div>`).join('')}
          ${!msgs.length ? '<div class="sub">No replies yet. Ask the question here instead of in chat, so the answer stays with the cell.</div>' : ''}
          <div class="reply">
            <textarea class="mini" data-reply="${i.id}" placeholder="Reply… paste a screenshot with Ctrl+V" aria-label="Reply to issue ${i.id}"></textarea>
            ${pend.length ? `<div class="thumbs">${pend.map((p) => `<span class="thumb pend"><img src="${p.url}" alt="Screenshot to send"><button class="x" data-unpend="${i.id}|${p.id}" aria-label="Remove screenshot">×</button></span>`).join('')}</div>` : ''}
            <div class="acts"><label class="btn small ghost">Attach screenshot<input type="file" accept="image/*" data-attach="${i.id}" hidden multiple></label><button class="btn small primary" data-send="${i.id}">Reply</button></div>
          </div>
          <div class="trail">${i.trail.slice(-4).map((x) => `<span>${esc(fmtT(x.t))} · ${esc(x.by)} · ${esc(x.what)}</span>`).join('')}</div>
        </div>` : ''}
      </div>`;
    }).join('');
    return `
      <div class="filters">${chips}</div>
      <div class="filters">
        <select class="mini" id="iFile" aria-label="Filter by file"><option value="">All files</option>${B.files.map((f) => `<option value="${esc(f.id)}" ${f.id === ui.iFile ? 'selected' : ''}>${esc(short(f.name))}</option>`).join('')}</select>
        <select class="mini" id="iOwner" aria-label="Filter by owner"><option value="">All owners</option>${OWNERS.map((o) => `<option ${o === ui.iOwner ? 'selected' : ''}>${esc(o)}</option>`).join('')}</select>
        <label class="sub" style="display:flex;gap:4px;align-items:center"><input type="checkbox" id="iSheetOnly" ${ui.iSheetOnly ? 'checked' : ''}> This tab only</label>
        <span class="sub" style="margin-left:auto">${list.length} shown</span>
      </div>
      ${FILE ? form : ''}
      ${items || '<div class="note">No issues match this filter.</div>'}`;
  }

  function checksPanel() {
    const live = liveFindings();
    const counts = { error: 0, warn: 0, info: 0 }; live.forEach((f) => counts[f.sev]++);
    const made = F.filter((f) => FILE.accepted[f.id] || (!FILE.dismissed[f.id] && coveredBy(f, FILE.id)));
    let list;
    if (ui.cFilter === 'dismissed') list = F.filter((f) => FILE.dismissed[f.id]);
    else if (ui.cFilter === 'issues') list = made;
    else list = live.filter((f) => ui.cFilter === 'review' || f.sev === ui.cFilter);
    const groups = {}; for (const f of list) (groups[f.rule] = groups[f.rule] || []).push(f);
    const chips = [['review', `To review (${live.length})`], ['error', `Errors (${counts.error})`], ['warn', `Warnings (${counts.warn})`], ['info', `Info (${counts.info})`],
      ['issues', `Already issues (${made.length})`], ['dismissed', `Dismissed (${F.filter((f) => FILE.dismissed[f.id]).length})`]]
      .map(([k, l]) => `<button class="chip ${ui.cFilter === k ? 'on' : ''}" data-cf="${k}">${l}</button>`).join('');
    const needs = [];
    if (!Object.values(SETUP.sheets || {}).some((s) => s.idCol)) needs.push('duplicate IDs (pick the ID column)');
    if (!Object.values(SETUP.sheets || {}).some((s) => (s.requiredCols || []).length)) needs.push('empty required cells (pick required columns)');
    const body = Object.entries(groups).map(([rule, fs]) => `
      <div class="sec-h">${esc(E.RULES[rule].title)} <span class="pill ${fs[0].sev === 'error' ? 'bad' : fs[0].sev === 'warn' ? 'warn' : 'info'}">${SEV_LABEL[fs[0].sev]} · ${fs.length}</span></div>
      <div class="sub">${esc(E.RULES[rule].why)}</div>
      ${fs.map((f) => {
        const d = FILE.dismissed[f.id], acc = FILE.accepted[f.id], cov = !acc && coveredBy(f, FILE.id);
        return `<div class="item sev-${f.sev}" data-fid="${esc(f.id)}">
          <div class="det">${esc(f.detail)}</div>
          <div class="meta">${f.cells.slice(0, 6).map((a) => cellBtn(FILE.id, f.sheet, a)).join(' ')} <span>${esc(f.sheet)}</span></div>
          ${d ? `<div class="meta">Dismissed by ${esc(d.by)}, ${esc(fmtT(d.t))}${d.reason ? ': “' + esc(d.reason) + '”' : ''} <button class="linkish" data-undismiss="${esc(f.id)}">Restore</button></div>`
            : acc ? `<div class="meta">Made into <button class="linkish" data-issue="${acc}">issue #${acc}</button></div>`
            : cov ? `<div class="meta">Already covered by <button class="linkish" data-issue="${cov.id}">issue #${cov.id}</button></div>`
            : `<div class="acts"><button class="btn small" data-accept="${esc(f.id)}">Make issue</button>
               <input class="mini" data-dreason="${esc(f.id)}" placeholder="Reason to dismiss (optional)" style="flex:1 1 140px" aria-label="Reason to dismiss">
               <button class="btn small ghost" data-dismiss="${esc(f.id)}">Dismiss</button></div>`}
        </div>`;
      }).join('')}`).join('');
    return `
      <div class="note"><b>Checks are fixed rules written in code</b> and work on any layout. They run again after every change, point at cells, and never change the sheet. A person decides: make it an issue, or dismiss it. A dismissed check comes back only if that cell changes.${needs.length ? `<br><br>Not running yet for this file: ${needs.join('; ')}. <button class="linkish" data-act="setup">File setup</button>` : ''}</div>
      <div class="filters">${chips}</div>
      ${body || '<div class="note">Nothing here.</div>'}
      <details class="rulebox"><summary>What each rule checks (${Object.keys(E.RULES).length} rules)</summary>
        <ul>${Object.entries(E.RULES).map(([k, r]) => `<li><b>${esc(r.title)}</b> (${SEV_LABEL[r.sev]}${r.needs ? ', needs ' + r.needs + ' in setup' : ''}): ${esc(r.why)}</li>`).join('')}</ul></details>`;
  }

  function points() {
    const pts = [{ at: 0, label: 'As first imported' }];
    for (const r of FILE.revs || []) if (r.at !== null && r.at !== undefined) pts.push({ at: r.at, label: `${r.label} (pinned ${fmtD(r.t)})` });
    let i = 0; const L = FILE.log;
    while (i < L.length) {
      const g0 = L[i]; let j = i;
      while (j + 1 < L.length && L[j + 1].by === g0.by && L[j + 1].t - L[j].t < 10 * 60 * 1000 && L[j + 1].k !== 'import' && g0.k !== 'import') j++;
      pts.push({ at: j + 1, label: `${fmtT(L[j].t)} · ${L[j].by || '—'} · after ${g0.k === 'import' ? 'uploading ' + (g0.file || 'a new version') : pl(j - i + 1, 'change')}` });
      i = j + 1;
    }
    const byAt = new Map();
    for (const p of pts) if (!byAt.has(p.at) || /pinned/.test(p.label)) byAt.set(p.at, p);
    const out = [...byAt.values()].sort((a, b) => a.at - b.at);
    const last = out.find((p) => p.at === L.length);
    if (last) last.label += ' (now)'; else out.push({ at: L.length, label: 'Now' });
    return out;
  }
  function historyPanel() {
    const pts = points();
    const lr = lastRev(FILE);
    if (ui.cmpFrom === null || ui.cmpFrom > FILE.log.length) ui.cmpFrom = lr ? lr.at : 0;
    if (ui.cmpTo === null || ui.cmpTo > FILE.log.length) ui.cmpTo = FILE.log.length;
    const opt = (sel) => pts.map((p) => `<option value="${p.at}" ${p.at === sel ? 'selected' : ''}>${esc(p.label)}</option>`).join('');
    const A = E.replay(FILE.base, FILE.log, ui.cmpFrom), Bm = E.replay(FILE.base, FILE.log, ui.cmpTo);
    const c = E.compareFiles(A, Bm, SETUP);
    const sheets = c.sheets.map((s) => {
      const rows = [];
      if (s.status !== 'same') rows.push(`<div class="c"><span class="tag ${s.status === 'added' ? 'add' : 'rem'}">Tab</span><span>${s.status === 'added' ? 'New tab' : 'Tab no longer in the file'}</span></div>`);
      s.added.forEach((x) => rows.push(`<div class="c"><span class="tag add">Added</span><span><b>${esc(x.id)}</b> row ${x.r}</span></div>`));
      s.removed.forEach((x) => rows.push(`<div class="c"><span class="tag rem">Removed</span><span><b>${esc(x.id)}</b></span></div>`));
      s.changed.forEach((x) => rows.push(`<div class="c"><span class="tag mod">Changed</span><span><b>${esc(x.id)}</b> ${x.diffs.map((d) => `${esc(d.field)} <span class="from">${esc(d.from || '(empty)')}</span> → ${esc(d.to || '(empty)')}`).join('; ')}</span></div>`));
      if (!s.added.length && !s.removed.length && !s.changed.length) {
        s.cells.slice(0, 60).forEach((x) => rows.push(`<div class="c"><span class="tag mod">${x.a}</span><span><span class="from">${esc(x.from || '(empty)')}</span> → ${esc(x.to || '(empty)')}</span></div>`));
        if (s.cells.length > 60) rows.push(`<div class="sub">… and ${s.cells.length - 60} more cells</div>`);
      }
      return rows.length ? `<div class="sec-h">${esc(s.sheet)}</div><div class="chg-list">${rows.join('')}</div>` : '';
    }).join('');
    const groups = [];
    const L = FILE.log;
    for (let i = L.length - 1; i >= 0; i--) {
      const op = L[i]; const g = groups[groups.length - 1];
      if (g && g.by === op.by && g.t0 - op.t < 10 * 60 * 1000 && op.k !== 'import' && g.k !== 'import') { g.ops.push([i, op]); g.t0 = op.t; }
      else groups.push({ by: op.by, t0: op.t, t1: op.t, k: op.k, ops: [[i, op]] });
    }
    const pinAt = {}; (FILE.revs || []).forEach((r) => { if (r.at !== null && r.at !== undefined) (pinAt[r.at] = pinAt[r.at] || []).push(r); });
    const opLine = (op) => {
      if (op.k === 'set') return `${esc(op.s)} ${op.a}: <span class="from">${esc(txt(op.o) || '(empty)')}</span> → ${esc(txt(op.v) || '(empty)')}${op.undo ? ' (undo)' : ''}`;
      if (op.k === 'rowIns') return `${esc(op.s)}: inserted row ${op.r}${op.undo ? ' (undo)' : ''}`;
      if (op.k === 'rowDel') return `${esc(op.s)}: deleted row ${op.r}${op.snap ? ' (' + esc(Object.values(op.snap).map((cv) => txt(cv[0])).filter(Boolean).slice(0, 3).join(' · ')) + ')' : ''}${op.undo ? ' (undo)' : ''}`;
      if (op.k === 'import') return `Uploaded ${esc(op.file || 'Excel file')} as a new version`;
      if (op.k === 'colW') return `${esc(op.s)}: column ${E.colLetters(op.c)} width ${op.o === null || op.o === undefined ? 'default' : op.o} → ${op.v === null || op.v === undefined ? 'default' : op.v}${op.undo ? ' (undo)' : ''}`;
      if (op.k === 'rowH') return `${esc(op.s)}: row ${op.r} height ${op.o === null || op.o === undefined ? 'auto' : op.o + ' pt'} → ${op.v === null || op.v === undefined ? 'auto' : op.v + ' pt'}${op.undo ? ' (undo)' : ''}`;
      return esc(op.k);
    };
    const pinHtml = (at) => (pinAt[at] || []).map((r) => `<div class="pin"><span>${esc(r.label)} pinned</span><span>${esc(fmtD(r.t))}</span></div>`).join('');
    let act = pinHtml(L.length);
    for (const g of groups) {
      act += `<div class="g"><div class="h"><b>${esc(g.by || '—')}</b><span>${esc(fmtT(g.t1))}</span></div>${g.ops.slice(0, 12).map(([, op]) => `<div class="op">${opLine(op)}</div>`).join('')}${g.ops.length > 12 ? `<div class="op">… ${g.ops.length - 12} more</div>` : ''}</div>`;
      const firstIdx = g.ops[g.ops.length - 1][0];
      if (firstIdx !== L.length) act += pinHtml(firstIdx);
    }
    act += `<div class="g"><div class="h"><b>${esc(FILE.addedBy || '—')}</b><span>${esc(fmtT(FILE.addedAt))}</span></div><div class="op">Added ${esc(FILE.base.fileName || FILE.name)} to the board</div></div>`;
    const dRows = c.to.rows - c.from.rows;
    return `
      <div class="sec-h" style="margin-top:0">Compare any two points of this file</div>
      <div class="cmp-pick"><label for="cmpFrom">From</label><select class="mini" id="cmpFrom">${opt(ui.cmpFrom)}</select>
        <label for="cmpTo">To</label><select class="mini" id="cmpTo">${opt(ui.cmpTo)}</select></div>
      <table class="dt"><thead><tr><th></th><th class="n">From</th><th class="n">To</th><th class="n">Change</th></tr></thead><tbody>
        <tr><td>Data rows</td><td class="n">${fmtN(c.from.rows)}</td><td class="n">${fmtN(c.to.rows)}</td><td class="n delta ${dcls(dRows)}">${sgn(dRows)}</td></tr>
        ${c.from.sf !== null || c.to.sf !== null ? `<tr><td>SF (width × height × qty)</td><td class="n">${fmtN(c.from.sf)}</td><td class="n">${fmtN(c.to.sf)}</td><td class="n delta ${dcls((c.to.sf || 0) - (c.from.sf || 0))}">${sgn((c.to.sf || 0) - (c.from.sf || 0))}</td></tr>` : ''}
      </tbody></table>
      ${!Object.values(SETUP.sheets || {}).some((s) => s.idCol) ? '<div class="sub">Pick an ID column in File setup to see changes row by row (added / removed / changed) instead of cell by cell.</div>' : ''}
      ${sheets || '<div class="note">No differences between these two points.</div>'}
      ${ui.cmpTo === FILE.log.length && ui.cmpFrom !== ui.cmpTo ? `<div><button class="btn small" data-hl="${ui.cmpFrom}">${ui.hl === ui.cmpFrom ? 'Hide on sheet' : 'Highlight these changes on the sheet'}</button></div>` : ''}
      <div class="sec-h">Activity</div>
      <div class="act">${act}</div>`;
  }

  function revsPanel() {
    const lr = lastRev(FILE);
    const pendingN = lr ? FILE.log.length - lr.at : FILE.log.length;
    const nextN = lr ? (parseInt(String(lr.label).replace(/\D/g, ''), 10) || 0) + 1 : 0;
    const revs = (FILE.revs || []).slice().reverse().map((r) => `
      <div class="rev" data-rev="${esc(r.id)}">
        <div class="rh"><b>${esc(r.label)}</b><span class="sub">Pinned ${esc(fmtT(r.t))} · ${esc(r.by)}</span></div>
        <label>Status<select class="mini" data-rf="status">${REV_STATUS.map((s) => `<option ${s === r.status ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Ball in court<select class="mini" data-rf="bic">${BIC.map((s) => `<option ${s === r.bic ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select></label>
        <label>Submitted<input type="date" class="mini" data-rf="submitted" value="${esc(r.submitted)}"></label>
        <label>Returned<input type="date" class="mini" data-rf="returned" value="${esc(r.returned)}"></label>
        <label class="wide">Notes / architect's comments<textarea class="mini" data-rf="notes">${esc(r.notes)}</textarea></label>
        <div style="grid-column:1/-1"><button class="btn small" data-cmpfrom="${r.at}">Compare with now</button></div>
      </div>`).join('');
    return `
      <div class="note">Revisions are per file. Pinning saves the schedule exactly as it was when the shop drawings went out, so the next round can be compared with it.</div>
      <div class="form">
        <div class="sec-h" style="margin:0">Rev ${nextN} <span class="pill warn">draft</span></div>
        <div class="sub">${pl(pendingN, 'change')} since ${esc(lr ? lr.label : 'the import')}.</div>
        <div class="r"><button class="btn small primary" data-act="pinRev" ${pendingN || !lr ? '' : 'disabled'}>Pin this file as Rev ${nextN}</button></div>
      </div>
      <div class="revs">${revs}</div>`;
  }

  /* ---------------- File setup ---------------- */
  function colOptions(sh, a0) {
    const cols = [];
    for (let c = 1; c <= sh.maxCol; c++) {
      const names = [...new Set(a0.tables.map((t) => t.names[c]).filter(Boolean))];
      const any = Object.keys(sh.cells).some((a) => E.splitA1(a).c === c && txt(sh.cells[a][0]).trim());
      if (!any && !names.length) continue;
      cols.push({ c, L: E.colLetters(c), name: names[0] || '' });
    }
    return cols;
  }
  function openSetup() {
    if (!FILE) return;
    const s = FILE.setup;
    const colors = USED.map((u) => {
      const cfg = SETUP.colors[u.key] || { kind: 'label', label: '' };
      const sw = u.key.startsWith('T') ? `<span class="swatch txt" style="color:#${u.key.slice(1)}">A</span>` : `<span class="swatch" style="background:#${u.key}"></span>`;
      return `<tr data-ckey="${esc(u.key)}"><td>${sw}</td><td>${esc(u.name)}${u.legend ? `<div class="sub">Legend: “${esc(u.legend)}”</div>` : ''}</td>
        <td class="n">${u.count}</td><td>${u.cells.slice(0, 2).map((x) => `<span class="sub">${esc(x)}</span>`).join('<br>')}</td>
        <td><select class="mini" data-ckind aria-label="What this color means">${Object.entries(KIND_LABEL).map(([k, l]) => `<option value="${k}" ${k === cfg.kind ? 'selected' : ''}>${l}</option>`).join('')}</select></td>
        <td><input class="mini" data-clabel value="${esc(cfg.label || u.legend || '')}" placeholder="e.g. Need to coordinate" aria-label="Name for this color"></td></tr>`;
    }).join('');
    const firstOpen = cur.sheets.findIndex((x) => !(s.sheets[x.name] && s.sheets[x.name].ignore));
    const tabs = cur.sheets.map((sh, i) => {
      const ss = s.sheets[sh.name] || {};
      const a0 = E.analyzeSheet(cur, sh, ss);
      const auto = E.autoHeaderRows(cur, sh);
      const cols = colOptions(sh, a0);
      const nums = [], sizes = [];
      a0.tables.forEach((t) => Object.entries(t.types).forEach(([c, ty]) => { const lab = E.colLetters(+c) + (t.names[c] ? ' ' + t.names[c] : ''); if (ty.type === 'num' && !nums.includes(lab)) nums.push(lab); if (ty.type === 'size' && !sizes.includes(lab)) sizes.push(lab); }));
      const subs = Object.entries(a0.rowInfo).filter(([, x]) => x.kind === 'subtotal').map(([r]) => r);
      const chk = (field, key, c) => `<label class="cchip"><input type="checkbox" data-${field}="${c.L}" ${(ss[key] || []).includes(c.L) ? 'checked' : ''}> ${c.L}${c.name ? ' · ' + esc(c.name.slice(0, 22)) : ''}</label>`;
      const suggestId = cols.find((c) => /^(ID|MARK|TAG|NAME|SET\s*#|SERIAL\s*NO\.?|NO\.?|CODE|TYPE|WALL\s*TYPE)$/i.test(c.name.trim()));
      return `<details class="stab" data-stab="${esc(sh.name)}" ${i === firstOpen ? 'open' : ''}>
        <summary><b>${esc(sh.name)}</b> <span class="sub">${a0.tables.reduce((n, t) => n + t.rows.length, 0)} data rows · header rows ${a0.headerRows.join(', ') || 'none found'}</span>${ss.ignore ? ' <span class="pill neutral">not part of project</span>' : ''}</summary>
        <div class="sgrid">
          <label class="wide row"><input type="checkbox" data-ignore ${ss.ignore ? 'checked' : ''}> Not part of this project (no checks, no issues on this tab)</label>
          <label>Header rows<input class="mini" data-hdr value="${esc((ss.headerRows || a0.headerRows).join(', '))}" placeholder="e.g. 4, 12"><span class="sub">Detected: ${auto.join(', ') || 'none'}. Rows with an "H" on the sheet.</span></label>
          <label>ID / mark column<select class="mini" data-id><option value="">— none —</option>${cols.map((c) => `<option value="${c.L}" ${ss.idCol === c.L ? 'selected' : ''}>${c.L}${c.name ? ' · ' + esc(c.name.slice(0, 30)) : ''}</option>`).join('')}</select>${!ss.idCol && suggestId ? `<span class="sub">Maybe ${suggestId.L} · ${esc(suggestId.name)}?</span>` : ''}</label>
          <div class="wide"><div class="lab">Notes / remarks / RFI columns</div><div class="cchips">${cols.map((c) => chk('notes', 'notesCols', c)).join('')}</div></div>
          <div class="wide"><div class="lab">Required columns (an empty cell becomes a check)</div><div class="cchips">${cols.map((c) => chk('req', 'requiredCols', c)).join('')}</div></div>
          <div class="wide sub">Read automatically: numbers in ${esc(nums.join(', ') || '—')}; sizes in ${esc(sizes.join(', ') || '—')}${subs.length ? `; subtotal rows ${subs.join(', ')}` : ''}.</div>
        </div></details>`;
    }).join('');
    $('#dlgSetupBody').innerHTML = `
      <div class="note">You decide what the file means; the board does the rest with fixed rules. Saved for <b>${esc(FILE.name)}</b> only. ${s.done ? `Last saved by ${esc(s.by || '—')}, ${esc(fmtT(s.t))}.` : ''}</div>
      <div class="sec-h" style="margin:0">1. Colors in this file</div>
      ${USED.length ? `<div class="tw"><table class="dt setupc"><thead><tr><th></th><th>Color</th><th class="n">Cells</th><th>Where</th><th>Means</th><th>Name</th></tr></thead><tbody>${colors}</tbody></table></div>
      <div class="sub">"Track as issue": every cell with this color becomes an issue. "Color for closed issues": used in the export when an issue is closed. Header rows are not counted.</div>` : '<div class="note">No colored cells found (header rows are not counted).</div>'}
      <div class="sec-h">2. Tabs and columns</div>
      ${tabs}`;
    $('#dlgSetup').showModal();
  }
  function saveSetup() {
    if (needName()) return;
    const colors = {};
    $('#dlgSetupBody').querySelectorAll('[data-ckey]').forEach((tr) => {
      colors[tr.dataset.ckey] = { kind: tr.querySelector('[data-ckind]').value, label: tr.querySelector('[data-clabel]').value.trim() || E.colorName(tr.dataset.ckey) };
    });
    const sheets = {};
    $('#dlgSetupBody').querySelectorAll('[data-stab]').forEach((d) => {
      const name = d.dataset.stab;
      const hdr = d.querySelector('[data-hdr]').value.split(/[,\s]+/).map((x) => parseInt(x, 10)).filter((x) => x > 0);
      const auto = E.autoHeaderRows(cur, sheetModel(name));
      const same = hdr.length === auto.length && hdr.every((x, i) => x === auto[i]);
      const o = {
        ignore: d.querySelector('[data-ignore]').checked || undefined,
        headerRows: same ? undefined : hdr,
        idCol: d.querySelector('[data-id]').value || undefined,
        notesCols: [...d.querySelectorAll('[data-notes]:checked')].map((x) => x.dataset.notes),
        requiredCols: [...d.querySelectorAll('[data-req]:checked')].map((x) => x.dataset.req),
      };
      sheets[name] = JSON.parse(JSON.stringify(o));
    });
    FILE.setup = { done: true, sheets, colors, by: me, t: Date.now() };
    recompute();
    const n = seedColorIssues(FILE, cur, { an: AN, eff: SETUP, marks: MARKS }, draftLabel(FILE), me);
    $('#dlgSetup').close();
    if (SETUP.sheets[ui.sheet] && SETUP.sheets[ui.sheet].ignore) { const t = cur.sheets.find((x) => !(SETUP.sheets[x.name] && SETUP.sheets[x.name].ignore)); if (t) ui.sheet = t.name; }
    save(); renderAll();
    toast('Setup saved for ' + short(FILE.name) + '.' + (n ? ' ' + pl(n, 'new issue') + ' from colors.' : ''), 3500);
  }

  /* ---------------- events ---------------- */
  function goto(fileId, sheet, a) {
    if (!FILE || FILE.id !== fileId) { selectFile(fileId); renderAll(); }
    if (ui.sheet !== sheet) { ui.sheet = sheet; ui.a = null; ui.b = null; renderTabs(); }
    select(a);
  }
  function wire() {
    $('#who').textContent = me + (canEdit() ? '' : ' · view only');
    $('#boardSel').addEventListener('change', async (e) => {
      const v = e.target.value;
      if (v === '__new') { e.target.value = B.id; if (needName()) return; $('#nbName').value = ''; $('#dlgBoard').showModal(); $('#nbName').focus(); return; }
      await flush(); await loadBoard(v); await IDB.set('meta', META); renderAll();
    });
    $('#btnBoardOk').addEventListener('click', async () => {
      const name = $('#nbName').value.trim(); if (!name) { $('#nbName').focus(); return; }
      try { await flush(); await newBoard(name); } catch (err) { toast('Could not create the board: ' + (err.message || err), 5000); return; }
      $('#dlgBoard').close(); renderAll(); toast('Board "' + name + '" created. Add an Excel file to start.');
    });
    $('#btnBoardCancel').addEventListener('click', () => $('#dlgBoard').close());
    $('#fileAdd').addEventListener('change', (e) => { onAddFile(e.target.files[0]); e.target.value = ''; });
    $('#fileVer').addEventListener('change', (e) => { onNewVersion(e.target.files[0]); e.target.value = ''; });
    $('#btnAdd').addEventListener('click', () => { if (!needName()) $('#fileAdd').click(); });
    $('#btnExport').addEventListener('click', () => { if (FILE) { $('#expName').textContent = FILE.name; $('#dlgExport').showModal(); } });
    $('#btnDoExport').addEventListener('click', doExport);
    $('#btnImportOk').addEventListener('click', () => runUpload(pending && pending.ok));
    $('#btnImportAlt').addEventListener('click', () => runUpload(pending && pending.alt));
    $('#btnImportCancel').addEventListener('click', () => { pending = null; $('#dlgImport').close(); });
    $('#btnExportCancel').addEventListener('click', () => $('#dlgExport').close());
    $('#btnSetupSave').addEventListener('click', saveSetup);
    $('#btnSetupCancel').addEventListener('click', () => $('#dlgSetup').close());
    $('#btnViewClose').addEventListener('click', () => $('#dlgView').close());
    $('#sheetTabs').addEventListener('click', (e) => { const b = e.target.closest('[data-sheet]'); if (!b) return; ui.sheet = b.dataset.sheet; ui.a = null; ui.b = null; renderTabs(); renderGrid(); if (ui.iSheetOnly) renderSide(); });
    const grid = $('#grid');
    grid.addEventListener('mousedown', (e) => {
      const td = e.target.closest('td[data-a]'); if (!td || td.classList.contains('editing')) return;
      e.preventDefault(); grid.focus({ preventScroll: true });
      select(td.dataset.a, e.shiftKey);
      if (ui.side === 'issues') renderSide();
    });
    grid.addEventListener('dblclick', (e) => {
      if (e.target.closest('.cres, .rres')) return; // handled on the pointer events
      if (e.target.closest('td[data-a]')) startEdit();
    });
    grid.addEventListener('pointerdown', (e) => {
      const h = e.target.closest('.cres, .rres');
      if (!h || e.button > 0) return;
      e.preventDefault(); e.stopPropagation();
      if (needName()) return;
      startResize(h, e);
    }, true);
    grid.addEventListener('keydown', (e) => {
      if (!ui.a || e.target !== grid) return;
      const k = e.key;
      if ((e.ctrlKey || e.metaKey) && k.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
      if (k === 'ArrowDown') { e.preventDefault(); move(1, 0); } else if (k === 'ArrowUp') { e.preventDefault(); move(-1, 0); }
      else if (k === 'ArrowLeft') { e.preventDefault(); move(0, -1); } else if (k === 'ArrowRight' || k === 'Tab') { e.preventDefault(); move(0, e.shiftKey ? -1 : 1); }
      else if (k === 'Enter' || k === 'F2') { e.preventDefault(); startEdit(); }
      else if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); setCell(ui.sheet, ui.a, ''); }
      else if (k.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); startEdit(k); }
    });
    document.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z' && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement.tagName) && document.activeElement !== grid && FILE) { e.preventDefault(); undo(); }
    });
    const fb = $('#fbar');
    fb.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); if (ui.a) { setCell(ui.sheet, ui.a, fb.value); move(1, 0); grid.focus({ preventScroll: true }); } }
      else if (e.key === 'Escape') { fb.blur(); renderToolbar(); grid.focus({ preventScroll: true }); }
    });
    fb.addEventListener('focus', () => { if (!me.trim()) needName(); });
    $('#btnIns').addEventListener('click', () => { if (ui.a) insertRow(ui.sheet, E.splitA1(ui.a).r + 1); });
    $('#btnDel').addEventListener('click', () => {
      if (!ui.a) return;
      const r = E.splitA1(ui.a).r;
      if (ui.delArm && ui.delArm.r === r && ui.delArm.sheet === ui.sheet) { ui.delArm = null; deleteRow(ui.sheet, r); return; }
      ui.delArm = { r, sheet: ui.sheet }; renderToolbar();
      setTimeout(() => { if (ui.delArm && ui.delArm.r === r) { ui.delArm = null; renderToolbar(); } }, 4000);
    });
    $('#btnUndo').addEventListener('click', undo);
    $('#btnFlag').addEventListener('click', () => { ui.side = 'issues'; renderSide(); const t = $('#niTitle'); if (t) t.focus(); });
    $('#btnHlOff').addEventListener('click', () => { ui.hl = null; renderGrid(); renderCards(); renderSide(); });

    // paste screenshots into a reply box
    document.addEventListener('paste', (e) => {
      const ta = e.target.closest && e.target.closest('[data-reply]');
      if (!ta) return;
      const files = [...((e.clipboardData && e.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type));
      if (!files.length) return;
      e.preventDefault();
      if (ta.value) ui.drafts[ta.dataset.reply] = ta.value;
      files.forEach((f) => addPending(+ta.dataset.reply, f));
    });

    document.addEventListener('click', async (e) => {
      const t = e.target.closest('button, [data-goto]');
      if (!t) return;
      const d = t.dataset;
      if (d.goto) { const [fid, s, a] = d.goto.split('|'); goto(fid, s, a); return; }
      if (d.file && !d.go) { selectFile(d.file); renderAll(); return; }
      if (d.file && d.go) { selectFile(d.file); ui.side = d.go; ui.cFilter = 'review'; renderAll(); $('#side').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.side) { ui.side = d.side; ui.focusIssue = null; renderSide(); return; }
      if (d.go) { ui.side = d.go; renderSide(); $('#side').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.hl !== undefined) { const at = +d.hl; ui.hl = ui.hl === at ? null : at; renderGrid(); renderCards(); renderSide(); return; }
      if (d.owner) { ui.side = 'issues'; ui.iOwner = d.owner; ui.iFilter = d.st; ui.iFile = ''; renderSide(); $('#side').scrollIntoView({ block: 'nearest', behavior: 'smooth' }); return; }
      if (d.if) { ui.iFilter = d.if; renderSide(); return; }
      if (d.cf) { ui.cFilter = d.cf; renderSide(); return; }
      if (d.toggle) { const id = +d.toggle; if (ui.open.has(id) || ui.focusIssue === id) { ui.open.delete(id); if (ui.focusIssue === id) ui.focusIssue = null; } else ui.open.add(id); renderSide(); return; }
      if (d.showall) { ui.showAll.add(+d.showall); renderSide(); return; }
      if (d.view) { const url = imgUrl.get(d.view); if (url) { $('#viewImg').src = url; $('#dlgView').showModal(); } return; }
      if (d.unpend) { const [iid, pid] = d.unpend.split('|'); ui.pending[iid] = (ui.pending[iid] || []).filter((p) => p.id !== pid); renderSide(); return; }
      if (d.send) { await sendReply(+d.send); return; }
      if (d.close) { updateIssue(+d.close, { status: 'closed', suggestClose: null }, 'Closed (color removed in the Excel)'); return; }
      if (d.keep) { updateIssue(+d.keep, { suggestClose: null }, 'Kept open'); return; }
      if (d.issue) {
        const i = B.issues.find((x) => x.id === +d.issue);
        ui.side = 'issues'; ui.iFilter = 'all'; ui.iOwner = ''; ui.iFile = ''; ui.iSheetOnly = false; ui.focusIssue = +d.issue; ui.open.add(+d.issue); renderSide();
        if (i && i.cells[0] && !t.closest('#sideBody')) goto(i.fileId, i.sheet, i.cells[0]);
        return;
      }
      if (d.finding) { ui.side = 'checks'; ui.cFilter = 'review'; renderSide(); const el = $(`#sideBody [data-fid="${CSS.escape(d.finding)}"]`); if (el) { el.scrollIntoView({ block: 'nearest' }); el.classList.add('focus'); } return; }
      if (d.accept) {
        if (needName()) return;
        const f = F.find((x) => x.id === d.accept); if (!f) return;
        const i = newIssue({ title: f.title + ': ' + f.detail, sheet: f.sheet, cells: f.cells.slice(), source: 'rule', rule: f.rule, findingId: f.id, owner: OPS.suggestOwner(f.detail) });
        i.trail = [{ t: Date.now(), by: me, what: 'Made from check “' + f.title + '”' }];
        FILE.accepted[f.id] = i.id;
        ui.open.add(i.id);
        save(); renderAll(); toast('Issue #' + i.id + ' opened');
        return;
      }
      if (d.dismiss) {
        if (needName()) return;
        const reason = ($(`[data-dreason="${CSS.escape(d.dismiss)}"]`) || {}).value || '';
        FILE.dismissed[d.dismiss] = { by: me, t: Date.now(), reason };
        save(); renderAll(); toast('Dismissed');
        return;
      }
      if (d.undismiss) { delete FILE.dismissed[d.undismiss]; save(); renderAll(); return; }
      if (d.cmpfrom !== undefined) { ui.side = 'history'; ui.cmpFrom = +d.cmpfrom; ui.cmpTo = FILE.log.length; renderSide(); return; }
      if (d.act === 'setup') { openSetup(); return; }
      if (d.act === 'newVer') { if (!needName()) $('#fileVer').click(); return; }
      if (d.act === 'showSug') { ui.side = 'issues'; ui.iFilter = 'suggest'; ui.iOwner = ''; ui.iFile = ''; renderSide(); return; }
      if (d.act === 'removeFile') {
        if (!ui.removeArm) { ui.removeArm = true; renderFiles(); setTimeout(() => { if (ui.removeArm) { ui.removeArm = false; renderFiles(); } }, 4000); return; }
        ui.removeArm = false;
        const id = FILE.id, name = FILE.name;
        B.files = B.files.filter((f) => f.id !== id);
        B.issues = B.issues.filter((i) => i.fileId !== id);
        IDB.del('tpl:' + id); fileCache.delete(id);
        selectFile(B.files[0] && B.files[0].id);
        save(); renderAll(); toast('Removed ' + name);
        return;
      }
      if (d.act === 'newIssue') {
        if (needName()) return;
        const title = $('#niTitle').value.trim();
        if (!title) { $('#niTitle').focus(); toast('Describe the issue first'); return; }
        const rg = selRange(); const cells = [];
        for (let r = rg.r1; r <= rg.r2; r++) for (let c = rg.c1; c <= rg.c2; c++) { const a = E.masterOf(sheetModel(ui.sheet), E.A1(c, r)); if (!cells.includes(a)) cells.push(a); }
        const i = newIssue({ title, cells, owner: $('#niOwner').value });
        ui.focusIssue = i.id; ui.open.add(i.id); ui.iFilter = 'active';
        save(); renderAll(); toast('Issue #' + i.id + ' opened');
        return;
      }
      if (d.act === 'pinRev') {
        if (needName()) return;
        const lr = lastRev(FILE);
        const n = lr ? (parseInt(String(lr.label).replace(/\D/g, ''), 10) || 0) + 1 : 0;
        FILE.revs.push({ id: 'r' + n + '-' + uid(), label: 'Rev ' + n, at: FILE.log.length, t: Date.now(), by: me, status: 'Submitted', submitted: new Date().toISOString().slice(0, 10), returned: '', bic: 'Architect', notes: '' });
        save(); renderAll(); toast('Rev ' + n + ' pinned');
      }
    });
    document.addEventListener('change', (e) => {
      const t = e.target, d = t.dataset;
      if (d.iowner) updateIssue(+d.iowner, { owner: t.value }, 'Owner → ' + t.value);
      else if (d.istatus) { const i = B.issues.find((x) => x.id === +d.istatus); updateIssue(+d.istatus, { status: t.value, suggestClose: t.value === 'closed' ? null : (i && i.suggestClose) }, 'Status → ' + STATUS_LABEL[t.value]); }
      else if (d.attach) { [...t.files].forEach((f) => addPending(+d.attach, f)); t.value = ''; }
      else if (t.id === 'iOwner') { ui.iOwner = t.value; renderSide(); }
      else if (t.id === 'iFile') { ui.iFile = t.value; renderSide(); }
      else if (t.id === 'iSheetOnly') { ui.iSheetOnly = t.checked; renderSide(); }
      else if (t.id === 'cmpFrom') { ui.cmpFrom = +t.value; renderSide(); }
      else if (t.id === 'cmpTo') { ui.cmpTo = +t.value; renderSide(); }
      else if (d.rf) {
        const card = t.closest('[data-rev]'); const r = FILE.revs.find((x) => x.id === card.dataset.rev);
        if (!r || needName()) return;
        r[d.rf] = t.value; save(); renderCards();
      }
    });
  }

  /* ---------------- export ---------------- */
  async function doExport() {
    if (!window.ExcelJS) { toast('The Excel writer did not load. Reload the page and try again.', 4000); return; }
    const paint = $('#expPaint').checked, withIssues = $('#expIssues').checked;
    const btn = $('#btnDoExport'); btn.disabled = true; btn.textContent = 'Building…';
    try {
      const tplBuf = await IDB.get('tpl:' + FILE.id);
      if (!tplBuf) throw new Error('The original Excel file is not on the board. Upload it again as a new version.');
      const tpl = new window.ExcelJS.Workbook();
      await tpl.xlsx.load(tplBuf);
      const issues = issuesOfFile(FILE.id);
      const resolvedKey = Object.entries(SETUP.colors).find(([, v]) => v.kind === 'resolved');
      const issueKey = Object.entries(SETUP.colors).find(([, v]) => v.kind === 'issue');
      const fillOf = (k) => (k && !k.startsWith('T') ? k : null);
      const paintMap = {};
      for (const i of issues) for (const a of i.cells) {
        const key = i.sheet + '|' + a;
        if (i.status !== 'closed') paintMap[key] = { fill: fillOf(i.colorKey) || fillOf(issueKey && issueKey[0]) || 'FFC7CE', font: '9C0006' };
        else if (!paintMap[key]) paintMap[key] = resolvedKey ? { fill: fillOf(resolvedKey[0]) || 'C6EFCE' } : (E.cellIssueColor(cur, SETUP, i.sheet, a) ? 'clear' : null);
      }
      E.writeWorkbook(cur, tpl, { paint: paint ? (s, a) => paintMap[s + '|' + a] || null : null });
      if (withIssues && issues.length) {
        const images = {};
        for (const i of issues) for (const m of i.thread || []) for (const im of m.imgs || []) {
          const blob = await IDB.get('img:' + im.id); if (!blob) continue;
          const ty = blob.type || im.type || '';
          const ext = /png/.test(ty) ? 'png' : /jpe?g/.test(ty) ? 'jpeg' : /gif/.test(ty) ? 'gif' : null;
          if (!ext) continue;
          images[im.id] = { buffer: new Uint8Array(await blob.arrayBuffer()), ext, w: im.w, h: im.h };
        }
        E.addIssuesSheet(tpl, issues.map((i) => ({
          id: i.id, status: STATUS_LABEL[i.status], owner: i.owner, sheet: i.sheet, cells: i.cells, title: i.title,
          source: i.source === 'color' ? (i.colorLabel || 'Color') : i.source === 'rule' ? 'Check' : 'Added', rev: i.rev,
          opened: fmtT(i.created) + ' · ' + i.by,
          thread: (i.thread || []).map((m) => ({ when: fmtT(m.t), by: m.by, text: m.text, imgs: (m.imgs || []).map((x) => x.id) })),
        })), images);
      }
      const buf = await tpl.xlsx.writeBuffer();
      const base = short(FILE.name || 'schedule').replace(/\s+[—-]\s+(Rev|No rev).*$/, '');
      // plain dashes: Chromium drops a download name that has "—" in it
      const name = `${base} - ${draftLabel(FILE)} - ${new Date().toISOString().slice(0, 10)}.xlsx`.replace(/[\\/:*?"<>|]/g, '_');
      const dl = await dlP;
      if (dl) {
        try { await dl.save({ filename: name, data: new Blob([buf]) }); toast('Saved ' + name, 3500); }
        catch (err) { if (err && err.code !== 'declined') toast('Could not save: ' + (err.message || err.code), 4000); }
      } else {
        const url = URL.createObjectURL(new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }));
        const a = document.createElement('a'); a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove();
        setTimeout(() => URL.revokeObjectURL(url), 4000);
        toast('Downloaded ' + name, 3500);
      }
      $('#dlgExport').close();
    } catch (err) { toast('Export failed: ' + err.message, 5000); }
    finally { btn.disabled = false; btn.textContent = 'Export'; }
  }

  /* ---------------- boot ---------------- */
  async function boot() {
    me = NAME.get();
    IDB.onError((e) => {
      const m = String((e && (e.code || e.message)) || e);
      toast(m === 'VIEW_ONLY' ? 'View only: your changes on this page are not saved.' : /PERMISSION|permission/.test(m) ? 'Not saved: your account cannot change this board.' : 'Not saved: ' + m, 5000);
    });
    IDB.onRemote((id, by) => { remoteQ = { id, by }; applyRemote(); });
    try {
      META = await IDB.get('meta');
      if (!META || !META.boards || !META.boards.length) {
        $('#grid').innerHTML = '<div class="empty-sheet">No project boards yet. Create one on the <a href="./">Design Board</a> first.</div>';
        return;
      }
      if (!(await loadBoard(META.current || META.boards[0].id)) && !(await loadBoard(META.boards[0].id))) throw new Error('Could not open this board.');
    } catch (err) {
      $('#grid').innerHTML = `<div class="empty-sheet">${esc(err.message)}</div>`;
      console.error(err);
      return;
    }
    wire();
    renderAll();
    window.__design = { get B() { return B; }, get FILE() { return FILE; }, get cur() { return cur; }, get F() { return F; }, get SETUP() { return SETUP; }, get META() { return META; }, ui, flush };
  }
  window.DC.onReady(() => { if (!booted) { booted = true; boot(); } });
  window.DC.onSignedOut(() => { if (booted) location.reload(); });
})();
