/* ============================================================
   AF Helper — chat that does the work (/assistant/)
   ------------------------------------------------------------
   The person types (Chinese / Korean / English) and pastes
   screenshots, PDFs or Excel. /api/agent (Claude) answers and
   calls tools. The tools run HERE, with the person's own Firebase
   session, so the database rules decide what they may read and
   change:
     get_design / get_tracker          read
     get_schedules                     read (Excel schedules on a Design Board)
     propose_design_comments           ┐ show a confirm card;
     propose_design_changes            │ saved only when the person
     propose_tracker_update            │ presses "Confirm"
     propose_schedule_import           │ (Excel → Schedules: new file or new version)
     propose_schedule_issue_changes    ┘
   Design Boards live in the design database; trackers (AC3, Lex …)
   in their own project databases (platform/projects.json).
   ============================================================ */
(function () {
  'use strict';
  const DC = window.DC;
  const $ = s => document.querySelector(s);
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const nameOf = e => { e = String(e || ''); return e.includes('@') ? e.split('@')[0] : e; };
  const nat = (a, b) => String(a).localeCompare(String(b), undefined, { numeric: true, sensitivity: 'base' });
  const dkey = no => String(no || '').trim().replace(/[.#$[\]/]/g, '_');
  const today = () => { const d = new Date(); return new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 10); };
  const toArr = v => (Array.isArray(v) ? v.filter(x => x != null) : Object.values(v || {}));
  const helper = window.afHelper || null;
  const DSTAT = { drafting: 'Drafting', review: 'Internal review', revise: 'Revise', submitted: 'Submitted', returned: 'Returned', approved: 'Approved' };
  const ISTAT = { open: 'To fix', ask: 'Ask reviewer', fixed: 'Fixed · to check', closed: 'Closed' };
  const SUBSTAT = ['draft', 'submitted', 'under-review', 'approved', 'approved-as-noted', 'revise-resubmit', 'rejected'];
  const PDFJS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/';
  const XLSX_JS = 'https://cdnjs.cloudflare.com/ajax/libs/xlsx/0.18.5/xlsx.full.min.js';
  const EXCELJS = 'https://cdnjs.cloudflare.com/ajax/libs/exceljs/4.4.0/exceljs.min.js';
  const SOPS = window.ScheduleOps, STORE = window.DesignStore, ENG = window.DesignEngine;
  const MAX_SEND = 3_900_000;

  const S = {
    boards: {}, issues: {}, drawings: {}, projects: {}, ready: false,
    convo: [], atts: [], pending: [], notes: [], cards: {}, busy: false, refs: [],
  };

  // ------------------------------------------------------------- small UI --
  let toastT;
  function toast(msg, err) { const t = $('#toast'); t.textContent = msg; t.className = 'on' + (err ? ' err' : ''); clearTimeout(toastT); toastT = setTimeout(() => { t.className = ''; }, err ? 6000 : 2500); }
  const chat = () => $('#chat');
  function scroll() { const c = chat(); c.scrollTop = c.scrollHeight; }
  function bubble(cls, html) { const d = document.createElement('div'); d.className = 'msg ' + cls; d.innerHTML = `<div class="b">${html}</div>`; chat().appendChild(d); scroll(); return d; }
  function md(t) {
    const lines = String(t || '').split('\n'); const out = []; let list = null, table = null;
    const inline = s => esc(s).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>').replace(/`([^`]+)`/g, '<code>$1</code>');
    const flush = () => { if (list) { out.push(`<${list.t}>${list.items.map(i => `<li>${i}</li>`).join('')}</${list.t}>`); list = null; } if (table) { out.push(`<table>${table.map((r, i) => `<tr>${r.map(c => i ? `<td>${inline(c)}</td>` : `<th>${inline(c)}</th>`).join('')}</tr>`).join('')}</table>`); table = null; } };
    for (const raw of lines) {
      const l = raw.trimEnd();
      let m;
      if (/^\|.*\|$/.test(l.trim())) { if (/^\|[\s:-|]+\|$/.test(l.trim())) continue; if (list) flush(); (table = table || []).push(l.trim().slice(1, -1).split('|').map(c => c.trim())); continue; }
      if ((m = /^\s*[-*•]\s+(.*)$/.exec(l))) { if (table) flush(); if (!list || list.t !== 'ul') { flush(); list = { t: 'ul', items: [] }; } list.items.push(inline(m[1])); continue; }
      if ((m = /^\s*\d+[.)]\s+(.*)$/.exec(l))) { if (table) flush(); if (!list || list.t !== 'ol') { flush(); list = { t: 'ol', items: [] }; } list.items.push(inline(m[1])); continue; }
      flush();
      if (!l.trim()) continue;
      const h = /^#{1,4}\s+(.*)$/.exec(l);
      out.push(h ? `<p><b>${inline(h[1])}</b></p>` : `<p>${inline(l)}</p>`);
    }
    flush();
    return out.join('');
  }

  // ------------------------------------------------------------- loading --
  function loadScript(src) {
    return new Promise((res, rej) => {
      if ([...document.scripts].some(s => s.src === src)) return res();
      const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.appendChild(s);
    });
  }
  async function loadProjects() {
    const reg = { projects: window.AF_PROJECTS || [] };
    const key = DC.emailKey(DC.email);
    for (const p of reg.projects || []) {
      const db = firebase.app().database(p.databaseURL);
      let role = null;
      try { if ((await db.ref('allowlist/' + key).once('value')).exists()) role = 'editor'; } catch (e) {}
      if (!role) { try { if ((await db.ref('meta/project').once('value')).val() === p.id) role = 'viewer'; } catch (e) {} }
      if (role) S.projects[p.id] = { id: p.id, name: p.name, url: p.databaseURL, db, role, cache: null };
    }
  }
  function listenBoards() {
    S.refs.forEach(r => r.off()); S.refs = [];
    const r = DC.db.ref('boardInfo');
    r.on('value', s => {
      S.boards = s.val() || {};
      Object.keys(S.boards).forEach(b => {
        if (S.refs.some(x => x.__b === b)) return;
        const ir = DC.db.ref('boards/' + b + '/issues'); ir.__b = b;
        ir.on('value', x => { S.issues[b] = x.val() || {}; badge(); }, () => {});
        S.refs.push(ir);
      });
      if (!S.ready) { S.ready = true; hello(); }
    }, () => { S.ready = true; hello(); });
    S.refs.push(r);
  }

  // ---------------------------------------------------- my to-do + helper --
  const isMe = v => { v = String(v || '').trim().toLowerCase(); const m = String(DC.email || '').toLowerCase(); return !!v && !!m && (v === m || v === nameOf(m) || nameOf(v) === nameOf(m)); };
  const mine = i => ((i.status === 'open' || i.status === 'ask') && isMe(i.owner)) || (i.status === 'fixed' && isMe(i.reviewer));
  let seen = null;
  /* To-do count and "new for you": to Leona in the desktop app, or — in the
     browser app (Edge / Chrome "Install") — the taskbar badge and a Windows notice. */
  const setCount = n => {
    if (helper) { try { helper.setBadge(n); } catch (e) {} return; }
    try { if (navigator.setAppBadge) (n ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {}); } catch (e) {}
  };
  const tell = (title, body) => {
    if (helper) { try { helper.notify(title, body); } catch (e) {} return; }
    try { if (window.Notification && Notification.permission === 'granted' && document.hidden) new Notification(title, { body, icon: 'leona/icon-192.png', tag: title }); } catch (e) {}
  };
  function badge() {
    const all = []; Object.entries(S.issues).forEach(([b, is]) => Object.entries(is).forEach(([id, i]) => all.push(Object.assign({ id: b + '/' + id, b }, i))));
    const my = all.filter(mine);
    setCount(my.length);
    const ids = new Set(my.map(i => i.id));
    if (seen && Object.keys(S.issues).length === Object.keys(S.boards).length) my.filter(i => !seen.has(i.id)).slice(0, 3).forEach(i => {
      tell(i.status === 'fixed' ? `#${i.n} is fixed — please check` : `New for you: #${i.n}`, `${(S.boards[i.b] || {}).name || i.b}: ${i.text}`);
    });
    if (Object.keys(S.issues).length === Object.keys(S.boards).length) seen = ids;
  }

  // --------------------------------------------------------------- tools --
  async function drawingsOf(b) { const v = (await DC.db.ref('boards/' + b + '/drawings').once('value')).val() || {}; S.drawings[b] = v; return v; }
  async function issuesOf(b) { const v = (await DC.db.ref('boards/' + b + '/issues').once('value')).val() || {}; S.issues[b] = v; return v; }
  function needBoard(b) { if (!S.boards[b]) throw new Error(`No board "${b}". Boards: ${Object.keys(S.boards).join(', ') || 'none'}`); }
  function needProject(p) { if (!S.projects[p]) throw new Error(`No access to project "${p}". You can open: ${Object.keys(S.projects).join(', ') || 'none'}`); return S.projects[p]; }
  const tally = (arr, f) => arr.reduce((m, x) => { const k = f(x); if (k) m[k] = (m[k] || 0) + 1; return m; }, {});
  const words = s => String(s || '').toLowerCase().split(/\s+/).filter(Boolean);
  const hit = (q, hay) => words(q).every(w => hay.toLowerCase().includes(w));

  async function get_design({ board, dwg, status, person, search, part }) {
    needBoard(board);
    const [ds, is] = await Promise.all([drawingsOf(board), issuesOf(board)]);
    const D = Object.values(ds), I = Object.entries(is).map(([id, v]) => Object.assign({ id }, v));
    const dno = k => (ds[k] ? ds[k].no : k || '');
    let dl = D, il = I;
    if (dwg) { const k = dkey(dwg); dl = dl.filter(d => dkey(d.no) === k); il = il.filter(i => i.dwg === k); }
    if (status) il = il.filter(i => (status === 'active' ? i.status !== 'closed' : i.status === status));
    if (person) { dl = dl.filter(d => hit(person, d.owner || '')); il = il.filter(i => hit(person, [i.owner, i.reviewer, i.fixedBy].join(' '))); }
    if (search) { dl = dl.filter(d => hit(search, [d.no, d.title, d.note].join(' '))); il = il.filter(i => hit(search, [dno(i.dwg), i.where, i.text, i.orig].join(' '))); }
    const out = {
      board, name: S.boards[board].name, your_role: DC.role,
      counts: { drawings_total: D.length, drawings_by_status: tally(D, d => d.status), comments_total: I.length, comments_by_status: tally(I, i => i.status), matching_drawings: dl.length, matching_comments: il.length },
    };
    if (part !== 'comments') out.drawings = dl.sort((a, b) => nat(a.no, b.no)).slice(0, 150).map(d => ({ no: d.no, title: d.title, rev: d.rev || '', with: d.owner || '', status: d.status, note: d.note || undefined }));
    if (part !== 'drawings') out.comments = il.sort((a, b) => (a.n || 0) - (b.n || 0)).slice(0, 150).map(i => ({ n: i.n, dwg: dno(i.dwg), where: i.where || undefined, text: i.text, orig: i.orig || undefined, status: i.status, for: i.owner || undefined, from: i.reviewer || undefined, fixed_rev: i.fixedRev || undefined, fixed_by: i.fixedBy ? nameOf(i.fixedBy) : undefined, closed_by: i.closedBy ? nameOf(i.closedBy) : undefined }));
    return out;
  }

  async function stateOf(p, fresh) {
    if (!fresh && p.cache && Date.now() - p.cacheAt < 20000) return p.cache;
    const v = (await p.db.ref('state').once('value')).val() || {};
    p.cache = v; p.cacheAt = Date.now(); return v;
  }
  async function get_tracker({ project, part, filter, limit }) {
    const p = needProject(project);
    const st = await stateOf(p);
    const units = toArr(st.units), log = toArr(st.log), subs = toArr(st.submittals);
    const lim = Math.min(+limit || 200, 400);
    const f = filter || '';
    if (part === 'summary') {
      return {
        project, name: p.name, your_role: p.role, updated: st.updatedAt || '',
        units: { total: units.length, by_status: tally(units, u => u.status || 'pending'), by_zone: tally(units, u => u.zone || '-'), issues: units.filter(u => u.status === 'issue').map(u => u.id + (u.note ? ' (' + u.note + ')' : '')).slice(0, 40) },
        latest_log: log.slice().sort((a, b) => String(b.date).localeCompare(String(a.date))).slice(0, 10).map(l => ({ date: l.date, cat: l.categories || l.category, text: l.content })),
        submittals: { total: subs.length, by_status: tally(subs, s => s.status || '-') },
      };
    }
    if (part === 'units') {
      const rows = units.filter(u => !f || hit(f, [u.key, u.id, u.zone, u.status, u.note, u.date].join(' ')));
      return { project, matching: rows.length, units: rows.slice(0, lim).map(u => ({ key: u.key, id: u.id, zone: u.zone, status: u.status || 'pending', date: u.date || undefined, louver: u.louver || undefined, note: u.note || undefined })) };
    }
    if (part === 'log') {
      const rows = log.filter(l => !f || hit(f, [l.date, l.content, l.category, (l.categories || []).join(' '), l.party, l.ref].join(' '))).sort((a, b) => String(b.date).localeCompare(String(a.date)));
      return { project, matching: rows.length, log: rows.slice(0, lim).map(l => ({ date: l.date, cat: l.categories || l.category, text: l.content, planned: l.planned || undefined, party: l.party || undefined, ref: l.ref || undefined })) };
    }
    if (part === 'submittals') {
      const rows = subs.filter(s => !f || hit(f, [s.number, s.title, s.spec, s.scope, s.status, s.note, s.ballInCourt].join(' ')));
      return { project, matching: rows.length, submittals: rows.slice(0, lim).map(s => ({ number: s.number, title: s.title, status: s.status, rev: s.rev, submitted: s.submittedDate || undefined, returned: s.returnedDate || undefined, ball_in_court: s.ballInCourt || undefined, note: s.note || undefined })) };
    }
    throw new Error('part must be summary, units, log or submittals');
  }

  // --------------------------------------------------------- confirm cards --
  let cardSeq = 0;
  function card(title, rowsHtml, canSave, onConfirm, label) {
    const id = 'c' + (++cardSeq);
    const d = document.createElement('div');
    d.className = 'pcard'; d.id = id;
    d.innerHTML = `<div class="ph">${esc(title)}</div><div class="pb">${rowsHtml}</div>
      <div class="pf">${canSave ? `<button class="btn ghost" data-no>Cancel</button><button class="btn ok" data-yes>${esc(label || 'Confirm & save')}</button>` : '<span class="warn">You can look at this but not change it.</span>'}</div>`;
    chat().appendChild(d); scroll();
    if (canSave) {
      d.querySelector('[data-no]').onclick = () => { d.classList.add('gone'); d.querySelector('.pf').innerHTML = '<span class="dim">Cancelled</span>'; S.notes.push(`The person cancelled: ${title}.`); };
      d.querySelector('[data-yes]').onclick = async () => {
        const f = d.querySelector('.pf'); f.innerHTML = '<span class="dim">Saving…</span>';
        try { const msg = await onConfirm(); d.classList.add('done'); f.innerHTML = `<span style="color:var(--green)">✓ ${esc(msg || 'Saved')}</span>`; S.notes.push(`The person confirmed and it was saved: ${title}.`); }
        catch (e) {
          const m = /PERMISSION_DENIED|permission/i.test((e && (e.code || e.message)) || '') ? 'Not saved: your account cannot change this.' : 'Not saved: ' + ((e && e.message) || e);
          f.innerHTML = `<span style="color:var(--red)">${esc(m)}</span>`; S.notes.push(`Saving failed (${m}): ${title}.`);
        }
      };
    }
    return id;
  }
  const stamp = o => Object.assign(o || {}, { _by: DC.email, _ts: DC.TS });
  const histDesign = (b, desc) => DC.db.ref('boards/' + b + '/history').push({ ts: DC.TS, user: DC.email, desc }).catch(() => {});

  async function propose_design_comments({ board, comments, summary }) {
    needBoard(board);
    const ds = await drawingsOf(board);
    const byNo = {}; Object.entries(ds).forEach(([k, d]) => { byNo[dkey(d.no)] = k; });
    const rows = (comments || []).filter(c => c && c.text).map(c => Object.assign({}, c, { key: byNo[dkey(c.dwg)] || '', att: (c.attachments || []).map(Number).filter(n => S.atts[n - 1] && S.atts[n - 1].img) }));
    if (!rows.length) throw new Error('No comments to add.');
    const html = rows.map((c, i) => `<div class="pr"><b>${i + 1}.</b> ${c.key ? `<b>${esc(ds[c.key].no)}</b>` : (c.dwg ? `<span class="warn">${esc(c.dwg)} is not on the board</span>` : '<span class="dim">no drawing</span>')}${c.where ? ' · ' + esc(c.where) : ''}
      <span class="pill i-${esc(c.status || 'open')}">${ISTAT[c.status || 'open']}</span><br>${esc(c.text)}${c.orig ? `<div class="orig">${esc(c.orig)}</div>` : ''}
      <div class="dim" style="font-size:12px">${c.reviewer ? 'from ' + esc(c.reviewer) : ''}${c.owner ? ' · for ' + esc(c.owner) : ''}</div>
      ${c.att.length ? `<div class="thumbs">${c.att.map(n => `<img src="${S.atts[n - 1].img}" alt="attachment ${n}">`).join('')}</div>` : ''}</div>`).join('');
    const id = card(`${S.boards[board].name}: add ${rows.length} review comment${rows.length > 1 ? 's' : ''}`, html, DC.isEditor(), async () => {
      const is = await issuesOf(board);
      let n = 1 + Object.values(is).reduce((m, i) => Math.max(m, +i.n || 0), 0);
      const saved = {};
      for (const c of rows) {
        const rec = { n: n++, dwg: c.key || null, where: c.where || null, text: c.text, orig: c.orig || null, reviewer: c.reviewer || null,
          owner: c.owner || (c.key && ds[c.key].owner) || null, source: 'claude', status: c.status || 'open', created: DC.TS, createdBy: DC.email };
        if (rec.status === 'fixed') Object.assign(rec, { fixedBy: rec.owner || DC.email, fixedAt: DC.TS, fixedRev: (c.key && ds[c.key].rev) || null });
        const imgs = {};
        for (const a of c.att) {
          if (!saved[a]) { const r = DC.db.ref('images/' + board).push(); await r.set(stamp({ data: S.atts[a - 1].img })); saved[a] = r.key; }
          imgs[saved[a]] = true;
        }
        if (Object.keys(imgs).length) rec.imgs = imgs;
        await DC.db.ref('boards/' + board + '/issues').push().set(stamp(rec));
      }
      histDesign(board, `Added ${rows.length} comments with AF Helper${summary ? ': ' + summary : ''}`);
      return `${rows.length} comment${rows.length > 1 ? 's' : ''} added (#${n - rows.length}–#${n - 1})`;
    });
    return { shown_to_person: id, comments: rows.length, saved: false, note: DC.isEditor() ? 'Waiting for the person to press Confirm.' : 'The person is not an editor of the design board; it cannot be saved.' };
  }

  async function propose_design_changes({ board, changes, summary }) {
    needBoard(board);
    const [ds, is] = await Promise.all([drawingsOf(board), issuesOf(board)]);
    const byN = {}; Object.entries(is).forEach(([id, i]) => { byN[i.n] = id; });
    const byNo = {}; Object.entries(ds).forEach(([k, d]) => { byNo[dkey(d.no)] = k; });
    const plan = [], bad = [];
    for (const c of changes || []) {
      if (c.kind === 'comment') {
        const id = byN[c.n]; const cur = is[id];
        if (!cur) { bad.push(`#${c.n} does not exist`); continue; }
        if (c.status && !ISTAT[c.status]) { bad.push(`#${c.n}: unknown status ${c.status}`); continue; }
        if (c.status === 'closed' && cur.status !== 'fixed' && cur.status !== 'closed') { bad.push(`#${c.n} is "${ISTAT[cur.status]}" — it must be marked fixed before it can be closed`); continue; }
        plan.push({ kind: 'comment', id, cur, c, label: `#${c.n} ${cur.text.slice(0, 60)}`, diff: [c.status && c.status !== cur.status ? `status <span class="old">${ISTAT[cur.status]}</span> → <span class="new">${ISTAT[c.status]}</span>` : '', c.rev ? `rev ${esc(c.rev)}` : '', c.note ? `note: ${esc(c.note)}` : ''].filter(Boolean) });
      } else if (c.kind === 'drawing') {
        const k = byNo[dkey(c.dwg)]; const cur = ds[k];
        if (!cur) { bad.push(`${c.dwg} is not on the board`); continue; }
        if (c.status && !DSTAT[c.status]) { bad.push(`${c.dwg}: unknown status ${c.status}`); continue; }
        const diff = [];
        if (c.status && c.status !== cur.status) diff.push(`status <span class="old">${DSTAT[cur.status] || cur.status}</span> → <span class="new">${DSTAT[c.status]}</span>`);
        if (c.owner != null && c.owner !== (cur.owner || '')) diff.push(`with <span class="old">${esc(nameOf(cur.owner) || '–')}</span> → <span class="new">${esc(nameOf(c.owner) || '–')}</span>`);
        if (c.rev != null && c.rev !== (cur.rev || '')) diff.push(`rev <span class="old">${esc(cur.rev || '–')}</span> → <span class="new">${esc(c.rev)}</span>`);
        if (c.note != null && c.note !== (cur.note || '')) diff.push(`note → ${esc(c.note)}`);
        if (diff.length) plan.push({ kind: 'drawing', k, cur, c, label: cur.no, diff });
      }
    }
    if (!plan.length) return { saved: false, nothing_to_change: true, problems: bad };
    const html = plan.map(p => `<div class="pr"><b>${esc(p.label)}</b><br>${p.diff.join(' · ')}</div>`).join('') + bad.map(b => `<div class="pr warn">⚠ ${esc(b)}</div>`).join('');
    const id = card(`${S.boards[board].name}: ${summary || 'update'}`, html, DC.isEditor(), async () => {
      for (const p of plan) {
        if (p.kind === 'comment') {
          const st = p.c.status, upd = stamp({});
          if (st) upd.status = st;
          if (st === 'fixed') Object.assign(upd, { fixedBy: DC.email, fixedAt: DC.TS, fixedRev: p.c.rev || (ds[p.cur.dwg] || {}).rev || null });
          if (st === 'closed') Object.assign(upd, { closedBy: DC.email, closedAt: DC.TS });
          if (st === 'open' || st === 'ask') Object.assign(upd, { closedBy: null, closedAt: null });
          if (p.c.note) upd['thread/' + DC.db.ref().push().key] = { by: DC.email, ts: DC.TS, text: p.c.note };
          await DC.db.ref('boards/' + board + '/issues/' + p.id).update(upd);
        } else {
          const upd = stamp({});
          ['status', 'owner', 'rev', 'note'].forEach(f => { if (p.c[f] != null) upd[f] = p.c[f] || null; });
          await DC.db.ref('boards/' + board + '/drawings/' + p.k).update(upd);
        }
      }
      histDesign(board, `AF Helper: ${summary || plan.map(p => p.label).join(', ')}`);
      return `${plan.length} change${plan.length > 1 ? 's' : ''} saved`;
    });
    return { shown_to_person: id, changes: plan.length, problems: bad, saved: false };
  }

  async function propose_tracker_update({ project, unit_updates, log_entries, submittal_updates, summary }) {
    const p = needProject(project);
    const st = await stateOf(p, true);
    const units = toArr(st.units), subs = toArr(st.submittals);
    const rows = [], bad = [];
    const uu = (unit_updates || []).filter(u => {
      const cur = units.find(x => x.key === u.key);
      if (!cur) { bad.push(`unit key ${u.key} not found`); return false; }
      const diff = ['status', 'date', 'louver', 'note'].filter(f => u[f] !== undefined && u[f] !== cur[f]).map(f => `${f} <span class="old">${esc(cur[f] || '–')}</span> → <span class="new">${esc(u[f] || '–')}</span>`);
      if (diff.length) rows.push(`<div class="pr"><b>${esc(cur.id)}</b> <span class="dim">${esc(u.key)}</span><br>${diff.join(' · ')}</div>`);
      return diff.length > 0;
    });
    const le = (log_entries || []).filter(l => l && l.content && l.date);
    le.forEach(l => rows.push(`<div class="pr">+ log <b>${esc(l.date)}</b> [${esc(l.category)}] ${esc(l.content)}${l.planned ? ' <span class="warn">(planned)</span>' : ''}</div>`));
    const su = (submittal_updates || []).filter(s => {
      const cur = subs.find(x => String(x.number || '').trim().toLowerCase() === String(s.number || '').trim().toLowerCase());
      if (!cur) { bad.push(`submittal ${s.number} not found`); return false; }
      if (s.status && !SUBSTAT.includes(s.status)) { bad.push(`submittal ${s.number}: unknown status ${s.status}`); return false; }
      const diff = ['status', 'rev', 'submittedDate', 'returnedDate', 'note'].filter(f => s[f] !== undefined && s[f] !== cur[f]).map(f => `${f} <span class="old">${esc(cur[f] || '–')}</span> → <span class="new">${esc(s[f] || '–')}</span>`);
      if (diff.length) rows.push(`<div class="pr">Submittal <b>${esc(cur.number)}</b> ${esc(cur.title || '')}<br>${diff.join(' · ')}</div>`);
      return diff.length > 0;
    });
    if (!uu.length && !le.length && !su.length) return { saved: false, nothing_to_change: true, problems: bad };
    const html = rows.join('') + bad.map(b => `<div class="pr warn">⚠ ${esc(b)}</div>`).join('');
    const id = card(`${p.name}: ${summary || 'update'}`, html, p.role === 'editor', async () => {
      const next = JSON.parse(JSON.stringify((await p.db.ref('state').once('value')).val() || {}));
      next.units = toArr(next.units); next.log = toArr(next.log); next.submittals = toArr(next.submittals);
      uu.forEach(u => { const x = next.units.find(y => y.key === u.key); if (x) ['status', 'date', 'louver', 'note'].forEach(f => { if (u[f] !== undefined) x[f] = u[f]; }); });
      le.forEach(l => next.log.push(Object.assign({ date: l.date, category: l.category, categories: [l.category], content: l.content }, l.planned ? { planned: true } : {})));
      su.forEach(s => { const x = next.submittals.find(y => String(y.number || '').trim().toLowerCase() === String(s.number).trim().toLowerCase()); if (x) ['status', 'rev', 'submittedDate', 'returnedDate', 'note'].forEach(f => { if (s[f] !== undefined) x[f] = s[f]; }); });
      next.updatedAt = new Date().toISOString();
      const desc = 'AF Helper: ' + (summary || 'update');
      await p.db.ref('state').set(Object.assign(next, { _ts: DC.TS, _by: DC.email, _desc: desc, _clientId: 'helper-' + Math.random().toString(36).slice(2), _project: p.id }));
      const c = tally(next.units, u => u.status || 'pending');
      await p.db.ref('history').push({ ts: DC.TS, user: DC.email, desc, snapshot: { units: next.units.length, installed: c.installed || 0, issues: c.issue || 0, log: next.log.length } }).catch(() => {});
      p.cache = null;
      return 'Saved to ' + p.name;
    });
    return { shown_to_person: id, saved: false, problems: bad, note: p.role === 'editor' ? 'Waiting for the person to press Confirm.' : `The person is ${p.role} on ${p.name}; they cannot change it.` };
  }

  // ------------------------------------------------- Excel schedules --
  const SCHED_URL = b => '../design/schedules.html#b=' + encodeURIComponent(b);
  const meShort = () => nameOf(DC.email);
  async function schedBoard(board) { needBoard(board); const s = await STORE.session(board); return { s, B: s.board() }; }
  function findFile(B, q) {
    if (!q) return null;
    const n = String(q).toLowerCase().replace(/\.xlsx$/, '');
    return B.files.find(f => f.id === q) || B.files.find(f => f.name.toLowerCase().replace(/\.xlsx$/, '') === n) || B.files.find(f => f.name.toLowerCase().includes(n)) || null;
  }
  async function get_schedules({ board, part, file, tab, status, search, limit }) {
    const { B } = await schedBoard(board);
    const sum = SOPS.summarize(B, { checks: 40 });
    const out = { board, page: SCHED_URL(board), files: sum.files.length, open_issues: sum.issues.filter(i => i.status !== 'closed').length };
    if (!B.files.length) return Object.assign(out, { note: 'No Excel files on this board yet. Attach an .xlsx and ask to put it on the board.' });
    part = part || 'summary';
    const f = file ? findFile(B, file) : null;
    if (file && !f) throw new Error(`No file like "${file}". Files: ${B.files.map(x => x.name).join(', ')}`);
    if (part === 'summary' || part === 'checks') {
      out.file_list = sum.files.filter(x => !f || x.id === f.id).map(x => (part === 'summary' ? Object.assign({}, x, { check_list: x.check_list.slice(0, 10) }) : x));
    }
    if (part === 'summary' || part === 'issues') {
      let is = sum.issues.filter(i => (!f || i.file === f.name));
      if ((status || 'active') === 'active') is = is.filter(i => i.status !== 'closed'); else if (status !== 'all') is = is.filter(i => i.status === status);
      if (search) is = is.filter(i => hit(search, [i.title, i.tab, i.cells, i.owner, i.last_reply].join(' ')));
      out.issue_counts = tally(sum.issues.filter(i => !f || i.file === f.name), i => i.status);
      out.issues = is.slice(0, limit || 150);
    }
    if (part === 'cells') {
      const ff = f || B.files[0];
      const model = ENG.replay(ff.base, ff.log);
      const sh = model.sheets.find(x => !tab || x.name.toLowerCase() === String(tab).toLowerCase()) || model.sheets.find(x => x.name.toLowerCase().includes(String(tab || '').toLowerCase())) || model.sheets[0];
      const rows = [];
      for (let r = 1; r <= sh.maxRow; r++) {
        const vals = []; for (let c = 1; c <= sh.maxCol; c++) { const cv = sh.cells[ENG.A1(c, r)]; vals.push(cv ? ENG.txt(cv[0]).replace(/\s+/g, ' ').trim() : ''); }
        while (vals.length && !vals[vals.length - 1]) vals.pop();
        if (!vals.length) continue;
        const line = r + ': ' + vals.join(' | ');
        if (!search || hit(search, line)) rows.push(line);
        if (rows.length >= (limit || 300)) break;
      }
      Object.assign(out, { file: ff.name, tab: sh.name, tabs: model.sheets.map(x => x.name), columns: 'A, B, C … in order; "row: values"', rows });
    }
    return out;
  }

  async function propose_schedule_import({ board, attachment, mode, version_of, summary }) {
    needBoard(board);
    const a = S.atts[(+attachment || 0) - 1];
    if (!a || !a.xbuf) throw new Error(`Attachment ${attachment} is not an .xlsx file in this conversation. Ask the person to attach the Excel file (.xlsx).`);
    await loadScript(EXCELJS);
    const model = await SOPS.readFile(a.xbuf.slice(0), a.name);
    const { B } = await schedBoard(board);
    let target = version_of ? findFile(B, version_of) : null;
    if (version_of && !target) throw new Error(`No file like "${version_of}" on ${board}. Files: ${B.files.map(x => x.name).join(', ') || 'none'}`);
    const match = SOPS.matchFile(B, model);
    if (!target && mode !== 'add' && match) target = match.file;
    if (mode === 'add') target = null;
    // dry run on a copy, to show what it will do
    const dry = JSON.parse(JSON.stringify(B));
    let rows = '', n = 0, sug = 0;
    const tabs = model.sheets.map(x => x.name);
    if (target) {
      const t = dry.files.find(x => x.id === target.id);
      const before = ENG.replay(t.base, t.log);
      const r0 = SOPS.computeFile(t, before);
      const cmp = ENG.compareFiles(before, model, r0.eff);
      const res = SOPS.newVersion(dry, t, model, a.name, meShort()); n = res.n; sug = res.sug;
      const lines = cmp.sheets.map(x => {
        const bits = [];
        if (x.status === 'added') bits.push('new tab'); if (x.status === 'removed') bits.push('tab not in the new file');
        const pl = (k, w) => k + ' ' + w + (k === 1 ? '' : 's');
        if (x.added.length) bits.push(pl(x.added.length, 'row') + ' added'); if (x.removed.length) bits.push(pl(x.removed.length, 'row') + ' removed'); if (x.changed.length) bits.push(pl(x.changed.length, 'row') + ' changed');
        if (x.cells.length && !x.added.length && !x.removed.length && !x.changed.length) bits.push(pl(x.cells.length, 'cell') + ' changed');
        return bits.length ? `<div>· <b>${esc(x.sheet)}</b>: ${bits.join(', ')}</div>` : '';
      }).join('');
      rows = `<div class="pr">Upload <b>${esc(a.name)}</b> as <b>version ${SOPS.versionsOf(target).length + 1}</b> of <b>${esc(target.name)}</b>${match && match.file.id === target.id ? ` <span class="dim">(${match.m.same} of ${match.m.of} tab names match)</span>` : ' <span class="warn">(tab names do not match well)</span>'}</div>
        <div class="pr">${lines || 'No differences in the cells.'}${cmp.from.sf !== null || cmp.to.sf !== null ? `<div>SF ${Math.round(cmp.from.sf || 0).toLocaleString()} → ${Math.round(cmp.to.sf || 0).toLocaleString()}</div>` : ''}</div>`;
    } else {
      const res = SOPS.addFile(dry, model, a.name, meShort()); n = res.n;
      const r = SOPS.computeFile(res.file, model);
      rows = `<div class="pr">Add <b>${esc(a.name)}</b> as a new file · ${tabs.length} tab${tabs.length > 1 ? 's' : ''} (${esc(tabs.slice(0, 6).join(', '))}${tabs.length > 6 ? '…' : ''}) · ${r.tot.rows} rows${r.tot.sf !== null ? ' · ' + Math.round(r.tot.sf).toLocaleString() + ' SF' : ''}</div>`;
    }
    rows += `<div class="pr">${n ? `<span class="new">${n} new issue${n > 1 ? 's' : ''}</span> from colored cells` : 'No new issues from colors'}${sug ? ` · <span class="warn">${sug} issue${sug > 1 ? 's' : ''} may be closed (color removed)</span>` : ''}</div>`;
    const title = `${S.boards[board].name} · Schedules: ${target ? 'new version of ' + target.name : 'add ' + a.name}`;
    const id = card(title, rows, DC.isEditor(), async () => {
      const s = await STORE.session(board); const B2 = s.board();
      const t2 = target ? B2.files.find(x => x.id === target.id) : null;
      if (target && !t2) throw new Error(target.name + ' was removed from the board meanwhile');
      const m2 = await SOPS.readFile(a.xbuf.slice(0), a.name);
      let fid, made;
      if (t2) { made = SOPS.newVersion(B2, t2, m2, a.name, meShort()); fid = t2.id; }
      else { made = SOPS.addFile(B2, m2, a.name, meShort()); fid = made.file.id; }
      await STORE.putTpl(board, fid, a.xbuf.slice(0), a.name, { throws: true });
      await s.write(B2, { throws: true });
      return `${t2 ? 'Version ' + t2.versions.length + ' of ' + t2.name : a.name + ' added'}${made.n ? ' · ' + made.n + ' new issues' : ''} — open Schedules to see it`;
    }, target ? 'Upload new version' : 'Add to board');
    return { shown_to_person: id, saved: false, action: target ? 'new_version' : 'add', target: target ? target.name : null, new_issues_from_colors: n, close_suggestions: sug, page: SCHED_URL(board),
      note: DC.isEditor() ? 'Waiting for the person to press the button on the card.' : 'The person is not an editor of the design board; it cannot be saved.' };
  }

  async function propose_schedule_issue_changes({ board, changes, summary }) {
    const { B } = await schedBoard(board);
    const plan = [], bad = [];
    for (const c of changes || []) {
      const i = B.issues.find(x => x.id === +c.id);
      if (!i) { bad.push(`issue ${c.id} does not exist`); continue; }
      if (c.status && !SOPS.STATUS_LABEL[c.status]) { bad.push(`issue ${c.id}: unknown status ${c.status}`); continue; }
      if (c.owner && !SOPS.OWNERS.includes(c.owner)) { bad.push(`issue ${c.id}: owner must be one of ${SOPS.OWNERS.join(', ')}`); continue; }
      const diff = [];
      if (c.status && c.status !== i.status) diff.push(`status <span class="old">${SOPS.STATUS_LABEL[i.status]}</span> → <span class="new">${SOPS.STATUS_LABEL[c.status]}</span>`);
      if (c.owner && c.owner !== i.owner) diff.push(`owner <span class="old">${esc(i.owner)}</span> → <span class="new">${esc(c.owner)}</span>`);
      if (c.reply && String(c.reply).trim()) diff.push(`reply: ${esc(c.reply)}`);
      if (diff.length) plan.push({ c, label: `#${i.id} ${String(i.title || '').slice(0, 70)}`, diff });
    }
    if (!plan.length) return { saved: false, nothing_to_change: true, problems: bad };
    const html = plan.map(p => `<div class="pr"><b>${esc(p.label)}</b><br>${p.diff.join(' · ')}</div>`).join('') + bad.map(b => `<div class="pr warn">⚠ ${esc(b)}</div>`).join('');
    const id = card(`${S.boards[board].name} · Schedules: ${summary || 'update issues'}`, html, DC.isEditor(), async () => {
      const s = await STORE.session(board); const B2 = s.board();
      let k = 0; plan.forEach(p => { if (SOPS.changeIssue(B2, p.c.id, p.c, meShort())) k++; });
      if (!k) throw new Error('nothing to change any more');
      await s.write(B2, { throws: true });
      return `${k} issue${k > 1 ? 's' : ''} updated`;
    });
    return { shown_to_person: id, changes: plan.length, problems: bad, saved: false };
  }

  const TOOLS = { get_design, get_tracker, get_schedules, propose_design_comments, propose_design_changes, propose_tracker_update, propose_schedule_import, propose_schedule_issue_changes };
  async function runTool(u) {
    const line = document.createElement('div'); line.className = 'tool';
    line.textContent = ({ get_design: '🔎 reading the design board', get_tracker: '🔎 reading the tracker', get_schedules: '🔎 reading the Excel schedules', propose_schedule_import: '📊 reading the Excel file' }[u.name] || '📝 preparing changes') + '…';
    chat().appendChild(line); scroll();
    try {
      const f = TOOLS[u.name]; if (!f) throw new Error('Unknown tool ' + u.name);
      const out = await f(u.input || {});
      line.remove();
      let s = JSON.stringify(out); if (s.length > 40000) s = s.slice(0, 40000) + '… (cut; ask for a narrower filter)';
      return { type: 'tool_result', tool_use_id: u.id, content: s };
    } catch (e) {
      line.textContent = '⚠ ' + (e.message || e);
      return { type: 'tool_result', tool_use_id: u.id, content: String(e.message || e), is_error: true };
    }
  }

  // ---------------------------------------------------------- attachments --
  function shrinkFile(file, max, q) {
    return new Promise((res, rej) => {
      const url = URL.createObjectURL(file), img = new Image();
      img.onload = () => { const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight)); const c = document.createElement('canvas'); c.width = Math.round(img.naturalWidth * k); c.height = Math.round(img.naturalHeight * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); URL.revokeObjectURL(url); res(c.toDataURL('image/jpeg', q)); };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error(file.name + ' is not a picture')); };
      img.src = url;
    });
  }
  const b64 = d => d.slice(d.indexOf(',') + 1);
  const fileB64 = f => new Promise((res, rej) => { const r = new FileReader(); r.onload = () => res(b64(r.result)); r.onerror = rej; r.readAsDataURL(f); });
  async function addFile(f) {
    const n = S.atts.length + 1;
    const a = { n, name: f.name || 'pasted picture', blocks: [] };
    try {
      if (/^image\//.test(f.type)) {
        a.img = await shrinkFile(f, 1400, 0.8);
        a.blocks = [{ type: 'text', text: `attachment ${n} (${a.name}):` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(a.img) } }];
      } else if (f.type === 'application/pdf' || /\.pdf$/i.test(f.name)) {
        if (f.size <= 3_000_000) a.blocks = [{ type: 'text', text: `attachment ${n} (${a.name}, PDF):` }, { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: await fileB64(f) } }];
        else {
          await loadScript(PDFJS + 'pdf.min.js'); const lib = window.pdfjsLib; lib.GlobalWorkerOptions.workerSrc = PDFJS + 'pdf.worker.min.js';
          const pdf = await lib.getDocument({ data: new Uint8Array(await f.arrayBuffer()) }).promise;
          const pages = Math.min(pdf.numPages, 8);
          a.blocks.push({ type: 'text', text: `attachment ${n} (${a.name}, PDF of ${pdf.numPages} pages; too big to send whole, so here are pages 1–${pages} as pictures — ask the person for other pages if needed):` });
          for (let i = 1; i <= pages; i++) {
            const pg = await pdf.getPage(i); const v1 = pg.getViewport({ scale: 1 }); const v = pg.getViewport({ scale: Math.min(2, 1400 / Math.max(v1.width, v1.height)) });
            const c = document.createElement('canvas'); c.width = v.width; c.height = v.height;
            await pg.render({ canvasContext: c.getContext('2d'), viewport: v }).promise;
            const d = c.toDataURL('image/jpeg', 0.72); if (i === 1) a.img = d;
            a.blocks.push({ type: 'text', text: `page ${i}:` }, { type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data: b64(d) } });
          }
          a.thumbOnly = true;
        }
      } else if (/\.(xlsx|xls|csv)$/i.test(f.name)) {
        await loadScript(XLSX_JS);
        const wb = window.XLSX.read(new Uint8Array(await f.arrayBuffer()), { type: 'array' });
        let text = '';
        wb.SheetNames.forEach(sn => { if (text.length < 60000) text += `\n--- sheet "${sn}" ---\n` + window.XLSX.utils.sheet_to_csv(wb.Sheets[sn], { blankrows: false }).slice(0, 60000 - text.length); });
        if (/\.xlsx$/i.test(f.name)) a.xbuf = await f.arrayBuffer();
        a.blocks = [{ type: 'text', text: `attachment ${n} (${a.name}, spreadsheet as CSV${a.xbuf ? '; can be put on a Design Board\'s Schedules with propose_schedule_import' : ''}):${text}` }];
      } else throw new Error(`${f.name}: send pictures, PDF or Excel`);
    } catch (e) { toast(e.message || String(e), true); return; }
    S.atts.push(a); S.pending.push(a); drawAtts();
  }
  function drawAtts() {
    $('#atts').innerHTML = S.pending.map((a, i) => `<span class="att">${a.img ? `<img src="${a.img}" alt="">` : '📄'}<span>${esc(a.n + '. ' + a.name)}</span><button type="button" data-rm="${i}" title="Remove">×</button></span>`).join('');
  }

  // ----------------------------------------------------------------- talk --
  function context() {
    return {
      today: today(), lang: navigator.language,
      boards: Object.entries(S.boards).map(([id, b]) => ({ id, name: b.name, role: DC.role })),
      projects: Object.values(S.projects).map(p => ({ id: p.id, name: p.name, role: p.role })),
    };
  }
  /* Older pictures are replaced by a note so each request stays small. */
  function wire() {
    const last = S.convo.length - 1;
    let lastUserWithFiles = -1;
    S.convo.forEach((m, i) => { if (m.role === 'user' && Array.isArray(m.content) && m.content.some(b => b.type === 'image' || b.type === 'document')) lastUserWithFiles = i; });
    return S.convo.map((m, i) => {
      if (!Array.isArray(m.content) || i === lastUserWithFiles || i === last) return m;
      return { role: m.role, content: m.content.map(b => (b.type === 'image' || b.type === 'document' ? { type: 'text', text: '[picture shown earlier]' } : b)) };
    });
  }
  async function callAgent() {
    const token = await DC.idToken();
    const body = JSON.stringify({ token, messages: wire(), context: context() });
    if (body.length > MAX_SEND) throw new Error('Too much at once: send fewer or smaller pictures.');
    const r = await fetch('../api/agent', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body });
    let j = {}; try { j = await r.json(); } catch (e) {}
    if (!r.ok) throw new Error(j.error || ('The helper is not available (' + r.status + ')'));
    return j;
  }
  async function send(text) {
    if (S.busy) return;
    text = String(text || '').trim();
    if (!text && !S.pending.length) return;
    S.busy = true; $('#send').disabled = true;
    try { if (helper && helper.busy) helper.busy(true); } catch (e) {}   // Leona draws while we work
    const hello = chat().querySelector('.hello'); if (hello) hello.remove();
    const files = S.pending.splice(0); drawAtts();
    const me = bubble('me', esc(text || '(attachments)') + (files.length ? `<div class="thumbs">${files.map(a => a.img ? `<img src="${a.img}" alt="">` : `<span class="att">📄 ${esc(a.name)}</span>`).join('')}</div>` : ''));
    me.querySelector('.b').style.whiteSpace = 'pre-wrap';
    const content = [];
    if (S.notes.length) { content.push({ type: 'text', text: '(Since your last reply: ' + S.notes.splice(0).join(' ') + ')' }); }
    files.forEach(a => content.push(...a.blocks));
    content.push({ type: 'text', text: text || 'Please look at the attachments.' });
    const lastMsg = S.convo[S.convo.length - 1];
    if (lastMsg && lastMsg.role === 'user' && Array.isArray(lastMsg.content)) lastMsg.content.push(...content);   // after tool results: one user turn
    else S.convo.push({ role: 'user', content });
    const wait = bubble('bot', '<img class="leona-mini" src="leona/draw.webp" alt="">Working on it<span class="typing"></span>');
    try {
      for (let step = 0; step < 8; step++) {
        const res = await callAgent();
        const blocks = (res.content || []).filter(b => b.type === 'text' || b.type === 'tool_use');
        S.convo.push({ role: 'assistant', content: blocks.length ? blocks : [{ type: 'text', text: '…' }] });
        const said = blocks.filter(b => b.type === 'text').map(b => b.text).join('\n').trim();
        if (said) { const d = bubble('bot', md(said)); chat().insertBefore(d, wait); }
        const uses = blocks.filter(b => b.type === 'tool_use');
        if (!uses.length) break;
        const results = [];
        for (const u of uses) results.push(await runTool(u));
        chat().appendChild(wait); scroll();
        S.convo.push({ role: 'user', content: results });
      }
    } catch (e) {
      bubble('err', esc(e.message || String(e)));
      // keep the conversation valid: drop the unanswered tail (and a tool call left without its result)
      const hasUse = m => m.role === 'assistant' && Array.isArray(m.content) && m.content.some(b => b.type === 'tool_use');
      while (S.convo.length && (S.convo[S.convo.length - 1].role === 'user' || hasUse(S.convo[S.convo.length - 1]))) S.convo.pop();
    }
    wait.remove();
    S.busy = false; $('#send').disabled = false; $('#msg').focus();
    try { if (helper && helper.busy) helper.busy(false); } catch (e) {}
    save();
  }
  function save() {
    try {
      const slim = S.convo.slice(-30).map(m => ({ role: m.role, content: Array.isArray(m.content) ? m.content.map(b => (b.type === 'image' || b.type === 'document' ? { type: 'text', text: '[picture shown earlier]' } : b)) : m.content }));
      sessionStorage.setItem('afhelper_convo', JSON.stringify(slim));
    } catch (e) {}
  }
  function hello() {
    if (chat().children.length) return;
    const tips = ['AC3 还剩哪些意见没改？', '我手上有哪些要改的？', 'AC3 的 Excel 表有哪些问题？', 'AC3 这周装了多少？有哪些 issue？', '哪些 submittal 被退回了？'];
    chat().innerHTML = `<div class="hello"><img class="leona" src="leona/wave.webp" alt="Leona" title="Leona"><div style="font-size:16px;color:var(--text)">Hi ${esc(nameOf(DC.email))} — tell me what you need.</div>
      <div>Paste a Discord screenshot to log comments, ask what is left, or tell me what was installed. I show you every change before it is saved.</div>
      <div class="chips">${tips.map(t => `<button class="chip" data-tip="${esc(t)}">${esc(t)}</button>`).join('')}</div></div>`;
  }

  // ---------------------------------------------------------------- events --
  const box = () => $('#msg');
  $('#composer').addEventListener('submit', e => { e.preventDefault(); const t = box().value; box().value = ''; autosize(); send(t); });
  box().addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#composer').requestSubmit(); } });
  function autosize() { const t = box(); t.style.height = 'auto'; t.style.height = Math.min(160, t.scrollHeight) + 'px'; }
  box().addEventListener('input', autosize);
  document.addEventListener('paste', e => {
    if (!DC.ready) return;
    const files = [...((e.clipboardData || {}).items || [])].filter(i => i.kind === 'file').map(i => i.getAsFile()).filter(Boolean);
    if (files.length) { e.preventDefault(); files.forEach(addFile); }
  });
  $('#fileIn').addEventListener('change', e => { [...e.target.files].forEach(addFile); e.target.value = ''; });
  document.addEventListener('dragover', e => e.preventDefault());
  document.addEventListener('drop', e => { e.preventDefault(); if (DC.ready) [...e.dataTransfer.files].forEach(addFile); });
  document.addEventListener('click', e => {
    const rm = e.target.closest('[data-rm]'); if (rm) { S.pending.splice(+rm.dataset.rm, 1); drawAtts(); return; }
    const tip = e.target.closest('[data-tip]'); if (tip) { send(tip.dataset.tip); return; }
    const img = e.target.closest('.msg img, .pcard img'); if (img) { const m = $('#modal'); $('#modalBox').innerHTML = `<div class="zoom"><img src="${img.src}" alt=""></div>`; $('#modalBox').className = 'box wide'; m.hidden = false; }
  });
  $('#modal').addEventListener('mousedown', e => { if (e.target.id === 'modal') $('#modal').hidden = true; });
  // the browser app: an "Install" button (Edge / Chrome), notices, and the offline page
  let installEv = null;
  const standalone = () => window.matchMedia && matchMedia('(display-mode: standalone)').matches;
  window.addEventListener('beforeinstallprompt', e => { if (helper) return; e.preventDefault(); installEv = e; $('#installBtn').hidden = false; });
  window.addEventListener('appinstalled', () => { $('#installBtn').hidden = true; toast('Installed — AF Helper is now in your Start menu.'); });
  $('#installBtn').onclick = async () => { if (!installEv) return; installEv.prompt(); try { await installEv.userChoice; } catch (e) {} installEv = null; $('#installBtn').hidden = true; };
  function bellState() { const b = $('#bellBtn'); b.hidden = !!helper || !window.Notification || Notification.permission !== 'default' || !standalone(); }
  $('#bellBtn').onclick = () => { Notification.requestPermission().then(p => { bellState(); if (p === 'granted') toast('Notices on: you will hear about new to-dos.'); }); };
  bellState();
  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
  $('#newChat').onclick = () => { if (S.busy) return; S.convo = []; S.pending = []; S.notes = []; drawAtts(); chat().innerHTML = ''; save(); hello(); };
  try { if (localStorage.getItem('afdesign_theme') === 'day') document.body.classList.add('day-mode'); } catch (e) {}
  $('#themeBtn').onclick = () => { const d = document.body.classList.toggle('day-mode'); try { localStorage.setItem('afdesign_theme', d ? 'day' : 'dark'); } catch (e) {} };

  DC.onReady(async () => {
    $('#who').textContent = nameOf(DC.email);
    listenBoards();
    loadProjects().catch(() => {});
    try {
      const old = JSON.parse(sessionStorage.getItem('afhelper_convo') || '[]');
      if (old.length) {
        S.convo = old;
        old.forEach(m => {
          if (!Array.isArray(m.content)) return;
          const t = m.content.filter(b => b.type === 'text' && !/^\(Since your last reply/.test(b.text) && !/^attachment \d+/.test(b.text) && b.text !== '[picture shown earlier]').map(b => b.text).join('\n').trim();
          if (t) bubble(m.role === 'user' ? 'me' : 'bot', m.role === 'user' ? esc(t) : md(t));
        });
      }
    } catch (e) {}
    box().focus();
  });
  DC.onSignedOut(() => { S.refs.forEach(r => r.off()); S.refs = []; S.convo = []; chat().innerHTML = ''; });

  window.AFHelper = { md, send, S };   // for tests
})();
