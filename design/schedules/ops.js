/* ============================================================
   AF Design — Schedules: board operations without a page.
   ------------------------------------------------------------
   The Schedules page (ui.js) and the chat (assistant/) both use
   these, so "add an Excel file" or "upload a new version" gives
   the same result from either place.

   A board B = { v, id, name, files:[file], issues:[issue], nextIssue }
   A file    = { id, name, addedAt, addedBy, base(model), log:[op], revs,
                 setup, dismissed, accepted, versions:[{name,t,by,at}] }
   Needs window.DesignEngine (engine.js); readFile needs window.ExcelJS.
   ============================================================ */
(function (root) {
  'use strict';
  const E = root.DesignEngine;
  const txt = E.txt;
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const STATUS_LABEL = { open: 'Open', asked: 'Asked', answered: 'Answered', closed: 'Closed' };

  async function readFile(buf, name) {
    if (!root.ExcelJS) throw new Error('The Excel reader did not load. Check the connection and reload the page.');
    const wb = new root.ExcelJS.Workbook();
    await wb.xlsx.load(buf);
    return E.readWorkbook(wb, { fileName: name, at: Date.now() });
  }
  function computeFile(file, model) {
    const setup = file.setup || (file.setup = { done: false, sheets: {}, colors: {} });
    const an = E.analyzeFile(model, setup);
    const legend = E.findLegend(model);
    const used = E.colorsUsed(model, an, legend);
    const colors = Object.assign({}, E.defaultColorSetup(used), setup.colors || {});
    const eff = Object.assign({}, setup, { colors, sheets: setup.sheets || {} });
    return { an, legend, used, eff, findings: E.runChecks(model, eff, an, legend), marks: E.colorMarks(model, eff, an, legend), tot: E.totals(model, eff, an) };
  }
  function lastRev(file) { return (file.revs || []).filter((r) => r.at !== null && r.at !== undefined).slice(-1)[0] || null; }
  function draftLabel(file) {
    const lr = lastRev(file);
    if (!lr) return 'No rev pinned';
    if (lr.at === file.log.length) return lr.label;
    return 'Rev ' + ((parseInt(String(lr.label).replace(/\D/g, ''), 10) || 0) + 1) + ' draft';
  }
  const versionsOf = (f) => f.versions || [{ name: (f.base && f.base.fileName) || f.name, t: f.addedAt, by: f.addedBy, at: 0 }];
  function tabMatch(a, b) {
    const A = a.sheets.map((s) => s.name), N = b.sheets.map((s) => s.name);
    const same = N.filter((n) => A.includes(n)).length;
    return { same, of: A.length, ratio: same / Math.max(A.length, N.length, 1) };
  }
  function rowKey(sh, setup, r) {
    const ss = (setup.sheets && setup.sheets[sh.name]) || {};
    if (ss.idCol) { const cv = sh.cells[E.masterOf(sh, ss.idCol + r)]; const v = txt(cv && cv[0]).trim(); if (v) return 'id:' + E.squash(v); }
    const vals = [];
    for (let c = 1; c <= sh.maxCol && vals.length < 3; c++) { const cv = sh.cells[E.A1(c, r)]; const v = cv ? txt(cv[0]).trim() : ''; if (v && !/^N\/?A$/i.test(v)) vals.push(E.squash(v)); }
    return vals.length ? 'row:' + vals.join('|') : null;
  }
  function issueTitle(model, an, setup, g) {
    const sh = model.sheets.find((s) => s.name === g.sheet);
    const ss = (setup.sheets && setup.sheets[g.sheet]) || {};
    let prefix = '';
    if (ss.idCol) { const cv = sh.cells[E.masterOf(sh, ss.idCol + g.row)]; prefix = txt(cv && cv[0]).trim(); }
    if (!prefix) for (let c = 1; c <= sh.maxCol && !prefix; c++) { const cv = sh.cells[E.A1(c, g.row)]; const v = txt(cv && cv[0]).trim(); if (/^\s*[A-Z]{1,4}-?\d{1,4}[A-Z]?\b/.test(v)) prefix = v.slice(0, 40); }
    const parts = g.cells.filter((a) => txt(sh.cells[a][0]).trim() !== prefix).map((a) => {
      const name = E.colName(an[g.sheet], sh, E.splitA1(a).c, g.row);
      const v = txt(sh.cells[a][0]).replace(/\s+/g, ' ').trim().slice(0, 120);
      return /^[A-Z]{1,3}$/.test(name) || /NOTE|REMARK|DESCRIPTION/i.test(name) ? v : name + ': ' + v;
    });
    if (!prefix && !parts.length) return 'Row ' + g.row;
    return (prefix ? prefix + (parts.length ? ' — ' : '') : '') + parts.join(' · ');
  }
  function suggestOwner(title) {
    const u = String(title).toUpperCase();
    if (/^EXCLUDED/.test(u)) return 'AF PM';
    if (/\bARCH\b|ARCHITECT/.test(u)) return 'Architect';
    return 'Unassigned';
  }
  /** cells colored with a "track as issue" color become issues, once */
  function seedColorIssues(B, file, model, r, rev, by) {
    let n = 0;
    for (const g of r.marks) {
      if (B.issues.some((i) => i.fileId === file.id && i.sheet === g.sheet && g.cells.every((a) => i.cells.includes(a)))) continue;
      const sh = model.sheets.find((s) => s.name === g.sheet);
      const title = issueTitle(model, r.an, r.eff, g);
      B.issues.push({
        id: B.nextIssue++, fileId: file.id, sheet: g.sheet, cells: g.cells.slice(), title, source: 'color', colorKey: g.key,
        colorLabel: g.label, owner: suggestOwner(title), status: 'open', rev, created: Date.now(), by,
        anchorKey: rowKey(sh, r.eff, g.row), thread: [], trail: [{ t: Date.now(), by, what: `Colored "${g.label}" in the Excel` }], suggestClose: null,
      });
      n++;
    }
    return n;
  }
  /** Put a new file on board B (the original .xlsx is stored by the caller). */
  function addFile(B, model, name, by, opts) {
    opts = opts || {};
    const file = {
      id: uid(), name, addedAt: Date.now(), addedBy: by, base: model, log: [], revs: opts.revs || [],
      setup: opts.setup ? E.clone(opts.setup) : { done: false, sheets: {}, colors: {} }, dismissed: {}, accepted: {},
      versions: [{ name, t: Date.now(), by, at: 0 }],
    };
    B.files.push(file);
    const r = computeFile(file, model);
    file.setup.colors = Object.assign({}, r.eff.colors);
    const n = seedColorIssues(B, file, model, r, lastRev(file) ? lastRev(file).label : 'As imported', by);
    return { file, n };
  }
  function reanchorIssues(B, file, model, setup) {
    for (const i of B.issues) {
      if (i.fileId !== file.id || !i.anchorKey || i.status === 'closed' || !i.cells.length) continue;
      const sh = model.sheets.find((s) => s.name === i.sheet); if (!sh) continue;
      const r0 = E.splitA1(i.cells[0]).r;
      if (rowKey(sh, setup, r0) === i.anchorKey) continue;
      const hits = [];
      for (let r = 1; r <= sh.maxRow; r++) if (rowKey(sh, setup, r) === i.anchorKey) hits.push(r);
      if (hits.length === 1 && hits[0] !== r0) {
        i.cells = i.cells.map((a) => E.A1(E.splitA1(a).c, hits[0]));
        i.trail.push({ t: Date.now(), by: 'Board', what: 'Moved to row ' + hits[0] + ' after import' });
      }
    }
  }
  /**
   * Replace a file's contents with an uploaded version (one "import" step in
   * its History). Returns { model (new contents), r, n (new issues from colors),
   * sug (issues whose color is gone; they get a "close?" suggestion) }.
   */
  function newVersion(B, file, model, name, by) {
    file.versions = versionsOf(file);
    const op = { k: 'import', model, file: name, t: Date.now(), by, id: (file.log.length + 1) + '-' + Math.random().toString(36).slice(2, 7) };
    file.log.push(op);
    file.versions.push({ name, t: Date.now(), by, at: file.log.length });
    const cur = E.replay(file.base, file.log);
    let r = computeFile(file, cur);
    reanchorIssues(B, file, cur, r.eff);
    let sug = 0;
    for (const i of B.issues) {
      if (i.fileId !== file.id || i.source !== 'color' || i.status === 'closed' || i.suggestClose) continue;
      if (!i.cells.some((a) => E.cellIssueColor(cur, r.eff, i.sheet, a))) { i.suggestClose = { t: Date.now(), why: 'The color was removed in ' + name }; sug++; }
    }
    const n = seedColorIssues(B, file, cur, r, draftLabel(file), by + ' (upload)');
    return { model: cur, r, n, sug };
  }
  /** The best existing file this upload is probably a new version of (same tab names). */
  function matchFile(B, model) {
    let best = null;
    for (const x of B.files) {
      const m = tabMatch(E.replay(x.base, x.log), model);
      if (m.ratio >= 0.6 && (!best || m.ratio > best.m.ratio)) best = { file: x, m };
    }
    return best;
  }
  const coveredBy = (B, f, fileId) => B.issues.find((i) => i.fileId === fileId && i.sheet === f.sheet && f.cells.every((a) => i.cells.includes(a)));
  function liveFindings(B, file, findings) {
    return findings.filter((f) => !(file.dismissed || {})[f.id] && !(file.accepted || {})[f.id] && !coveredBy(B, f, file.id));
  }
  /** Plain summary of a board (for the chat): files, check results, issues. */
  function summarize(B, opts) {
    opts = opts || {};
    const files = B.files.map((f) => {
      const model = E.replay(f.base, f.log);
      const r = computeFile(f, model);
      const live = liveFindings(B, f, r.findings);
      const sev = live.reduce((m, x) => { m[x.sev] = (m[x.sev] || 0) + 1; return m; }, {});
      const ign = new Set(Object.entries(r.eff.sheets || {}).filter(([, v]) => v && v.ignore).map(([k]) => k));
      return {
        id: f.id, name: f.name, tabs: model.sheets.filter((s) => !ign.has(s.name)).map((s) => s.name),
        versions: versionsOf(f).map((v, k) => 'v' + (k + 1) + ' ' + v.name + ' (' + new Date(v.t).toISOString().slice(0, 10) + ', ' + v.by + ')'),
        rev: draftLabel(f), revs: (f.revs || []).map((x) => ({ label: x.label, status: x.status, submitted: x.submitted || '', returned: x.returned || '', ball_in_court: x.bic || '' })),
        rows: r.tot.rows, sf: r.tot.sf === null ? null : Math.round(r.tot.sf),
        checks: { error: sev.error || 0, warn: sev.warn || 0, info: sev.info || 0 },
        check_list: live.slice(0, opts.checks || 25).map((x) => ({ sev: x.sev, title: x.title, tab: x.sheet, cells: x.cells.slice(0, 6).join(','), detail: x.detail || '' })),
      };
    });
    const byFile = Object.fromEntries(B.files.map((f) => [f.id, f.name]));
    const issues = B.issues.map((i) => ({
      id: i.id, file: byFile[i.fileId] || '?', tab: i.sheet, cells: (i.cells || []).slice(0, 6).join(','), title: i.title,
      status: i.status, status_label: STATUS_LABEL[i.status] || i.status, owner: i.owner, rev: i.rev, opened_by: i.by,
      replies: (i.thread || []).length, last_reply: (i.thread || []).length ? (i.thread[i.thread.length - 1].by + ': ' + String(i.thread[i.thread.length - 1].text || '').slice(0, 200)) : '',
      close_suggested: i.suggestClose ? i.suggestClose.why : '',
    }));
    return { files, issues };
  }

  const OWNERS = ['Unassigned', 'Architect', 'AF Design', 'AF PM', 'GC / CM'];
  /** Change one issue the way the page does (same History lines). Returns what changed, or null. */
  function changeIssue(B, id, ch, by) {
    const i = B.issues.find((x) => x.id === +id); if (!i) return null;
    const done = [];
    i.trail = i.trail || []; i.thread = i.thread || [];
    if (ch.status && ch.status !== i.status && STATUS_LABEL[ch.status]) {
      i.status = ch.status; if (ch.status === 'closed') i.suggestClose = null;
      i.trail.push({ t: Date.now(), by, what: 'Status → ' + STATUS_LABEL[ch.status] }); done.push('status');
    }
    if (ch.owner && ch.owner !== i.owner && OWNERS.includes(ch.owner)) { i.owner = ch.owner; i.trail.push({ t: Date.now(), by, what: 'Owner → ' + ch.owner }); done.push('owner'); }
    if (ch.reply && String(ch.reply).trim()) {
      i.thread.push({ id: uid(), t: Date.now(), by, text: String(ch.reply).trim(), imgs: [] });
      i.trail.push({ t: Date.now(), by, what: 'Replied' }); done.push('reply');
    }
    return done.length ? done : null;
  }

  root.ScheduleOps = {
    OWNERS, changeIssue,
    uid, readFile, computeFile, lastRev, draftLabel, versionsOf, tabMatch, rowKey, issueTitle, suggestOwner,
    seedColorIssues, addFile, reanchorIssues, newVersion, matchFile, liveFindings, summarize, STATUS_LABEL,
  };
})(typeof window !== 'undefined' ? window : globalThis);
