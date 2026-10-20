/* ============================================================
   AF Design — Schedules: where the boards are kept.
   ------------------------------------------------------------
   The Excel board used to keep everything in the browser
   (IndexedDB). Here it lives in the design database, so the whole
   team sees the same board and changes show up for everyone.

     /schedules/<board>/chunks/<key>   JSON text, one piece each:
         b                 { v, name, nextIssue, order:[fileId] }
         i_<n>             one issue (with its thread and trail)
         f_<id>_base       a file's contents as first imported
         f_<id>_log        every change since (edits, new versions)
         f_<id>_m          the rest: name, revs, setup, versions …
       (a piece over 3.5 MB is split: "#parts:N" + <key>_p0 … _pN-1)
     /schedules/<board>/meta           { _by, _ts }   who saved last
     /scheduleFiles/<board>/<fileId>   { data: the original .xlsx (base64), name, _by, _ts }
                                       used to export in the file's own layout
     /images/<board>/<id>              screenshots in issue replies (shared with Review comments)

   Saving writes only the pieces that changed, in one update, so two
   people working on different files or issues do not overwrite each
   other. Pieces somebody else changed are never written back from an
   older copy.

   Same interface as the old IndexedDB store (get / set / del / clear),
   plus: onRemote(cb), onError(cb), createBoard(name), session(id),
   putTpl(board, fileId, buf, name).
   Needs window.DC (design-cloud.js).
   ============================================================ */
(function () {
  'use strict';
  const PART = 3500000;
  const IMG_MAX = 1400000;
  const remoteCbs = [], errorCbs = [];
  let boardsInfo = null;          // boardInfo snapshot
  let current = null;             // board id the page shows
  const sessions = {};            // id -> Session
  const fileBoard = {};           // fileId -> board id
  let warnedView = false;

  const DC = () => window.DC;
  const db = () => window.DC.db;
  const short = (e) => String(e || '').split('@')[0];
  function fail(e) { errorCbs.forEach((cb) => { try { cb(e); } catch (x) { /* ignore */ } }); }

  /* ---------- pieces ---------- */
  function explode(out, k, s) {
    if (s.length <= PART) { out[k] = s; return; }
    const n = Math.ceil(s.length / PART);
    out[k] = '#parts:' + n;
    for (let i = 0; i < n; i++) out[k + '_p' + i] = s.slice(i * PART, (i + 1) * PART);
  }
  function implode(map, k) {
    const v = map[k];
    if (typeof v !== 'string' || v.indexOf('#parts:') !== 0) return v;
    const n = +v.slice(7); let r = '';
    for (let i = 0; i < n; i++) { const p = map[k + '_p' + i]; if (typeof p !== 'string') return null; r += p; }
    return r;
  }
  function toChunks(B) {
    const out = {};
    explode(out, 'b', JSON.stringify({ v: B.v || 2, name: B.name, nextIssue: B.nextIssue || 1, order: B.files.map((f) => f.id) }));
    for (const f of B.files) {
      const rest = Object.assign({}, f); delete rest.base; delete rest.log;
      explode(out, 'f_' + f.id + '_base', JSON.stringify(f.base));
      explode(out, 'f_' + f.id + '_log', JSON.stringify(f.log || []));
      explode(out, 'f_' + f.id + '_m', JSON.stringify(rest));
    }
    for (const i of B.issues) explode(out, 'i_' + i.id, JSON.stringify(i));
    return out;
  }
  function parse(map, k) { const s = implode(map, k); if (typeof s !== 'string') return undefined; try { return JSON.parse(s); } catch (e) { return undefined; } }
  function fromChunks(id, map) {
    const head = parse(map, 'b') || {};
    const info = (boardsInfo && boardsInfo[id]) || {};
    const B = { v: 2, id, name: info.name || head.name || id, files: [], issues: [], nextIssue: head.nextIssue || 1, curFile: null };
    const fids = [];
    Object.keys(map).forEach((k) => { const m = /^f_([A-Za-z0-9]+)_m$/.exec(k); if (m) fids.push(m[1]); });
    const order = (head.order || []).filter((f) => fids.includes(f)).concat(fids.filter((f) => !(head.order || []).includes(f)));
    for (const fid of order) {
      const f = parse(map, 'f_' + fid + '_m'), base = parse(map, 'f_' + fid + '_base');
      if (!f || !base) continue;
      f.base = base; f.log = parse(map, 'f_' + fid + '_log') || [];
      B.files.push(f); fileBoard[fid] = id;
    }
    Object.keys(map).forEach((k) => { if (/^i_\d+$/.test(k)) { const i = parse(map, k); if (i) B.issues.push(i); } });
    B.issues.sort((a, b) => a.id - b.id);
    B.nextIssue = Math.max(B.nextIssue, B.issues.reduce((m, i) => Math.max(m, i.id + 1), 1));
    return B;
  }

  /* ---------- one board ---------- */
  function Session(id) {
    this.id = id;
    this.ref = db().ref('schedules/' + id);
    this.server = {};   // pieces as the database has them now
    this.base = {};     // pieces the page's copy was built from (or last saved)
    this.by = '';
    this.live = false;
  }
  Session.prototype.fetch = async function () {
    const v = (await this.ref.once('value')).val() || {};
    this.server = Object.assign({}, v.chunks || {});
    this.by = (v.meta && v.meta._by) || '';
    return this;
  };
  Session.prototype.listen = function () {
    if (this.live) return;
    this.live = true;
    this.ref.on('value', (s) => {
      const v = s.val() || {};
      this.server = Object.assign({}, v.chunks || {});
      this.by = (v.meta && v.meta._by) || '';
      const keys = new Set(Object.keys(this.server).concat(Object.keys(this.base)));
      let foreign = false;
      keys.forEach((k) => { if (this.server[k] !== this.base[k]) foreign = true; });
      if (foreign) remoteCbs.forEach((cb) => { try { cb(this.id, short(this.by)); } catch (e) { console.error(e); } });
    }, (e) => fail(e));
  };
  Session.prototype.stop = function () { if (this.live) { this.ref.off(); this.live = false; } };
  /** The board as the database has it now; later saves compare against this. */
  Session.prototype.board = function () { this.base = Object.assign({}, this.server); return fromChunks(this.id, this.server); };
  /** Save B: only pieces the page changed since board() / the last save. */
  Session.prototype.write = async function (B, opts) {
    const loud = !!(opts && opts.throws);
    const next = toChunks(B);
    const upd = {}, prev = {};
    Object.keys(next).forEach((k) => { if (next[k] !== this.base[k]) { upd['chunks/' + k] = next[k]; prev[k] = this.base[k]; } });
    Object.keys(this.base).forEach((k) => { if (!(k in next) && this.base[k] !== undefined) { upd['chunks/' + k] = null; prev[k] = this.base[k]; } });
    if (!Object.keys(upd).length) return false;
    if (!DC().isEditor(this.id)) {
      if (loud) { const e = new Error('Your account can look at this board but not change it.'); e.code = 'PERMISSION_DENIED'; throw e; }
      if (!warnedView) { warnedView = true; fail(new Error('VIEW_ONLY')); }
      return false;
    }
    Object.keys(prev).forEach((k) => { if (upd['chunks/' + k] === null) delete this.base[k]; else this.base[k] = upd['chunks/' + k]; });
    upd.meta = { _by: DC().email, _ts: DC().TS };
    try { await this.ref.update(upd); }
    catch (e) { Object.keys(prev).forEach((k) => { if (prev[k] === undefined) delete this.base[k]; else this.base[k] = prev[k]; }); if (loud) throw e; fail(e); return false; }
    history(this.id, prev, upd);
    return true;
  };
  /** One line in the Design Board's History for things worth seeing there (only changed pieces are read). */
  function history(id, prev, upd) {
    const lines = []; let closed = 0;
    const js = (x) => { try { return x && x.indexOf('#parts:') !== 0 ? JSON.parse(x) : null; } catch (e) { return null; } };
    Object.keys(prev).forEach((k) => {
      const now = upd['chunks/' + k];
      if (/^f_[A-Za-z0-9]+_m$/.test(k)) {
        const a = js(prev[k]), b = js(now);
        if (!a && b) lines.push('Schedules: added ' + b.name);
        else if (a && now === null) lines.push('Schedules: removed ' + a.name);
        else if (a && b && (b.versions || []).length > (a.versions || []).length) lines.push('Schedules: new version of ' + b.name + ' (' + b.versions[b.versions.length - 1].name + ')');
      } else if (/^i_\d+$/.test(k)) {
        const a = js(prev[k]), b = js(now);
        if (b && b.status === 'closed' && (!a || a.status !== 'closed')) closed++;
      }
    });
    if (closed) lines.push('Schedules: closed ' + closed + ' issue' + (closed > 1 ? 's' : ''));
    lines.forEach((desc) => db().ref('boards/' + id + '/history').push({ ts: DC().TS, user: DC().email, desc }).catch(() => {}));
  }
  async function session(id, live) {
    let s = sessions[id];
    if (!s) { s = sessions[id] = new Session(id); await s.fetch(); }
    if (live) {
      Object.values(sessions).forEach((x) => { if (x !== s) x.stop(); });
      s.listen();
    }
    return s;
  }

  /* ---------- boards list ---------- */
  // Only the boards this person can open (a PM: their own project's; see design-cloud.js).
  async function loadBoards() {
    if (!boardsInfo) {
      let all = {};
      try { all = (await db().ref('boardInfo').once('value')).val() || {}; } catch (e) { all = {}; }
      const roles = await DC().loadRoles(Object.keys(all));
      boardsInfo = {};
      Object.keys(all).forEach((id) => { if (roles[id]) boardsInfo[id] = all[id]; });
    }
    return boardsInfo;
  }
  function wanted() {
    let want = (location.hash.match(/b=([a-z0-9-]+)/) || [])[1];
    if (!want) { try { want = localStorage.getItem('afdesign_board'); } catch (e) { /* blocked */ } }
    return want;
  }
  function setCurrent(id) {
    current = id;
    try { localStorage.setItem('afdesign_board', id); } catch (e) { /* blocked */ }
    if (location.hash !== '#b=' + id) history_replace('#b=' + id);
    document.querySelectorAll('[data-board-link]').forEach((a) => { a.href = a.dataset.boardLink + '#b=' + id; });
  }
  function history_replace(h) { try { window.history.replaceState(null, '', location.pathname + location.search + h); } catch (e) { /* file:// */ } }
  async function createBoard(name) {
    await loadBoards();
    const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 20) || 'board';
    let id = /^[a-z0-9]/.test(base) && base.length >= 2 ? base : 'p-' + base;
    for (let n = 2; boardsInfo[id]; n++) id = base.slice(0, 20) + '-' + n;
    const row = { name: String(name).slice(0, 80), _by: DC().email, _ts: DC().TS };
    await db().ref('boardInfo/' + id).set(row);
    boardsInfo[id] = { name: row.name };
    DC().boardRoles[id] = 'editor';     // only the design team creates boards
    return id;
  }

  /* ---------- files and pictures ---------- */
  function bufToB64(buf) {
    const u = new Uint8Array(buf); let s = '';
    for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
    return btoa(s);
  }
  function b64ToBuf(b64) { const bin = atob(b64); const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u.buffer; }
  async function putTpl(board, fid, buf, name, opts) {
    fileBoard[fid] = board;
    if (!DC().isEditor(board)) return;
    try { await db().ref('scheduleFiles/' + board + '/' + fid).set({ data: bufToB64(buf), name: String(name || '').slice(0, 200), _by: DC().email, _ts: DC().TS }); }
    catch (e) { if (opts && opts.throws) throw e; fail(e); }
  }
  const blobToDataURL = (blob) => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(r.result); r.onerror = rej; r.readAsDataURL(blob); });
  async function smaller(blob) {
    let url = await blobToDataURL(blob);
    if (url.length < IMG_MAX) return url;
    const bmp = await createImageBitmap(blob);
    let side = Math.min(2400, Math.max(bmp.width, bmp.height));
    for (let q = 0.85; url.length >= IMG_MAX && side >= 400; side = Math.round(side * 0.75), q = Math.max(0.6, q - 0.08)) {
      const k = side / Math.max(bmp.width, bmp.height);
      const c = document.createElement('canvas'); c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
      const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(bmp, 0, 0, c.width, c.height);
      url = c.toDataURL('image/jpeg', q);
    }
    return url;
  }
  function urlToBlob(url) {
    const m = /^data:([^;,]+)(;base64)?,(.*)$/.exec(url || ''); if (!m) return null;
    const bin = m[2] ? atob(m[3]) : decodeURIComponent(m[3]);
    const u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i);
    return new Blob([u], { type: m[1] });
  }

  /* ---------- the old store interface ---------- */
  const store = {
    async get(k) {
      if (k === 'meta') {
        const info = await loadBoards();
        const boards = Object.entries(info).map(([id, b]) => ({ id, name: (b && b.name) || id })).sort((a, b) => a.name.localeCompare(b.name));
        const w = wanted();
        const cur = boards.some((b) => b.id === w) ? w : (boards[0] && boards[0].id) || null;
        return { v: 2, boards, current: cur };
      }
      if (k.indexOf('board:') === 0) {
        const id = k.slice(6);
        await loadBoards();
        if (!boardsInfo[id]) return undefined;
        const s = await session(id, true);
        setCurrent(id); DC().useBoard(id);
        return s.board();
      }
      if (k.indexOf('tpl:') === 0) {
        const fid = k.slice(4), b = fileBoard[fid] || current;
        const v = (await db().ref('scheduleFiles/' + b + '/' + fid).once('value')).val();
        return v && v.data ? b64ToBuf(v.data) : undefined;
      }
      if (k.indexOf('img:') === 0) {
        const v = (await db().ref('images/' + current + '/' + k.slice(4)).once('value')).val();
        return v && v.data ? urlToBlob(v.data) : undefined;
      }
      return undefined;
    },
    async set(k, v) {
      if (k === 'meta') { if (v && v.current) setCurrent(v.current); return; }
      if (k.indexOf('board:') === 0) { const s = await session(k.slice(6), false); await s.write(v); return; }
      if (k.indexOf('tpl:') === 0) { const fid = k.slice(4); await putTpl(fileBoard[fid] || current, fid, v); return; }
      if (k.indexOf('img:') === 0) {
        if (!DC().isEditor(current)) return;
        try { await db().ref('images/' + current + '/' + k.slice(4)).set({ data: await smaller(v), _by: DC().email, _ts: DC().TS }); }
        catch (e) { fail(e); }
      }
    },
    async del(k) {
      if (k.indexOf('tpl:') === 0 && DC().isEditor(fileBoard[k.slice(4)] || current)) {
        const fid = k.slice(4);
        try { await db().ref('scheduleFiles/' + (fileBoard[fid] || current) + '/' + fid).remove(); } catch (e) { fail(e); }
      }
    },
    async clear() { /* nothing: the shared board is never wiped from a page */ },
    onRemote(cb) { remoteCbs.push(cb); },
    onError(cb) { errorCbs.push(cb); },
    createBoard,
    /** For the chat: open a board without following live changes. */
    async session(id) { await loadBoards(); if (!boardsInfo[id]) throw new Error('No board "' + id + '"'); const s = sessions[id] || await session(id, false); await s.fetch(); return s; },
    putTpl,
    get current() { return current; },
    _chunks: { toChunks, fromChunks },
  };
  window.DesignStore = store;
})();
