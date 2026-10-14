/* ============================================================
   AF Design engine v2 — any Excel layout
   ------------------------------------------------------------
   Pure logic, no DOM, no AI. The same file and the same setup
   always give the same result.

   - Workbook model   readWorkbook(ExcelJS wb) -> model (every tab, as laid out)
                      writeWorkbook(model, templateWb, opts), addIssuesSheet(wb, rows, images)
   - Layout reading   analyzeSheet / analyzeFile: header rows, tables, subtotal rows,
                      number + size columns (detected from values and headers)
   - Colors           colorKey, findLegend, colorsUsed, defaultColorSetup, colorMarks
   - Checks           runChecks(model, setup) — rules that do not depend on the layout
   - Totals           totals(model, setup) — SF from WIDTH x HEIGHT (x QTY) when found
   - History          applyOp, replay, changedCells
   - Compare          compareFiles(A, B, setup)

   "setup" is what the team decides by hand for one file:
     { sheets: { [tab]: { ignore, headerRows:[r], idCol:'C', notesCols:['B'], requiredCols:['F'] } },
       colors: { [colorKey]: { kind: 'issue'|'label'|'resolved'|'ignore', label } } }
   ============================================================ */
(function (root) {
  'use strict';

  /* ---------- A1 helpers ---------- */
  function colNum(letters) { let n = 0; for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64); return n; }
  function colLetters(n) { let s = ''; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
  function splitA1(a) { const m = /^([A-Z]+)(\d+)$/.exec(a); return m ? { c: colNum(m[1]), r: +m[2] } : null; }
  function A1(c, r) { return colLetters(c) + r; }
  function parseRange(rg) {
    const [a, b] = rg.split(':'); const p = splitA1(a), q = splitA1(b || a);
    return { c1: Math.min(p.c, q.c), r1: Math.min(p.r, q.r), c2: Math.max(p.c, q.c), r2: Math.max(p.r, q.r) };
  }
  function rangeStr(o) { return A1(o.c1, o.r1) + ':' + A1(o.c2, o.r2); }
  const clone = (o) => JSON.parse(JSON.stringify(o));

  /* ---------- text helpers ---------- */
  function txt(v) {
    if (v === null || v === undefined) return '';
    if (typeof v === 'object') {
      if ('f' in v) return txt(v.v);
      if ('d' in v) return String(v.d).slice(0, 10);
      if ('img' in v) return '';
      return '';
    }
    return String(v);
  }
  const norm = (s) => txt(s).toUpperCase().replace(/[^A-Z0-9]/g, '');
  const squash = (s) => txt(s).toUpperCase().replace(/\s+/g, ' ').trim();
  function lev(a, b) {
    if (a === b) return 0; const m = a.length, n = b.length; if (!m || !n) return m || n;
    let prev = Array.from({ length: n + 1 }, (_, j) => j);
    for (let i = 1; i <= m; i++) { const cur = [i]; for (let j = 1; j <= n; j++) cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1)); prev = cur; }
    return prev[n];
  }
  function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return (h >>> 0).toString(36); }
  const EMPTYISH = /^\s*(N\/?A|-|—|–)?\s*$/i;
  function isNum(v) {
    if (typeof v === 'number') return true;
    if (v && typeof v === 'object' && 'f' in v) return typeof v.v === 'number';
    return typeof v === 'string' && /^\s*-?\d+(\.\d+)?\s*$/.test(v.replace(/,/g, ''));
  }

  /* ============================================================
     Workbook model
     ============================================================ */
  const DEFAULT_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47'];
  function readTheme(wb) {
    try {
      const xml = wb._themes && Object.values(wb._themes)[0];
      if (!xml) return DEFAULT_THEME.slice();
      const get = (tag) => {
        const m = new RegExp('<a:' + tag + '>([\\s\\S]*?)</a:' + tag + '>').exec(xml); if (!m) return null;
        const s = /srgbClr val="([0-9A-Fa-f]{6})"/.exec(m[1]) || /lastClr="([0-9A-Fa-f]{6})"/.exec(m[1]);
        return s ? s[1].toUpperCase() : null;
      };
      // Excel's theme index order: lt1, dk1, lt2, dk2, accent1..6
      const t = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6'].map(get);
      return t.map((x, i) => x || DEFAULT_THEME[i]);
    } catch (e) { return DEFAULT_THEME.slice(); }
  }
  function cellValueIn(c) {
    const v = c.value;
    if (v === null || v === undefined) return null;
    if (v instanceof Date) return { d: v.toISOString() };
    if (typeof v === 'object') {
      if (v.richText) return v.richText.map((t) => t.text).join('');
      if (v.formula || v.sharedFormula) {
        let f = null; try { f = c.formula; } catch (e) { f = v.formula || null; }
        let res = v.result; if (res && typeof res === 'object') res = res.error ? String(res.error) : (res instanceof Date ? res.toISOString().slice(0, 10) : null);
        return { f: f || v.formula || '', v: res === undefined ? null : res };
      }
      if (v.text !== undefined) return typeof v.text === 'object' && v.text.richText ? v.text.richText.map((t) => t.text).join('') : String(v.text);
      if (v.error) return String(v.error);
      return null;
    }
    return v;
  }

  const LIMIT_CELLS = 200000;
  /** readWorkbook(wb, opts) — every tab, kept as laid out. */
  function readWorkbook(wb, opts) {
    opts = opts || {};
    const styles = [], styleIdx = new Map();
    const styleId = (st) => {
      if (!st) return 0;
      const s = {};
      if (st.font) s.font = st.font;
      if (st.fill && st.fill.type === 'pattern' && st.fill.pattern && st.fill.pattern !== 'none') s.fill = st.fill;
      if (st.border && Object.keys(st.border).length) s.border = st.border;
      if (st.alignment && Object.keys(st.alignment).length) s.alignment = st.alignment;
      if (st.numFmt) s.numFmt = st.numFmt;
      const key = JSON.stringify(s);
      if (!styleIdx.has(key)) { styleIdx.set(key, styles.length); styles.push(JSON.parse(key)); }
      return styleIdx.get(key);
    };
    styleId({});
    const media = [];
    const mediaIdx = new Map();
    const sheets = [];
    wb.worksheets.slice().sort((a, b) => a.orderNo - b.orderNo).forEach((ws, order) => {
      const merges = Object.values(ws._merges || {}).map((m) => (m.range ? m.range : rangeStr({ c1: m.model.left, r1: m.model.top, c2: m.model.right, r2: m.model.bottom })));
      const cells = {};
      let maxRow = 0, lastValRow = 0, n = 0, truncated = false;
      ws.eachRow({ includeEmpty: true }, (row, r) => {
        if (truncated) return;
        row.eachCell({ includeEmpty: true }, (c, col) => {
          if (++n > LIMIT_CELLS) { truncated = true; return; }
          if (c.isMerged && c.master && c.master.address !== c.address) {
            const sid = styleId(c.style); if (sid && visibleWhenEmpty(styles[sid])) cells[c.address] = [null, sid];
          } else {
            const v = cellValueIn(c); const sid = styleId(c.style);
            if (v === null && !sid) return;
            if (v === null && !visibleWhenEmpty(styles[sid])) return; // an empty cell with only a font shows nothing
            cells[c.address] = [v, sid];
            if (v !== null && v !== '') lastValRow = Math.max(lastValRow, r);
          }
          maxRow = Math.max(maxRow, r);
        });
      });
      const imgs = [];
      try {
        for (const im of ws.getImages()) {
          const tl = im.range && im.range.tl, br = im.range && im.range.br;
          if (!tl) continue;
          const m = wb.getImage(im.imageId) || {};
          const ext = (m.extension || '').toLowerCase();
          let mi = null;
          if (/^(png|jpe?g|gif)$/.test(ext) && m.buffer) {
            if (!mediaIdx.has(im.imageId)) { mediaIdx.set(im.imageId, media.length); media.push({ ext, b64: bufB64(m.buffer) }); }
            mi = mediaIdx.get(im.imageId);
          }
          const r1 = Math.floor(tl.nativeRow) + 1, c1 = Math.floor(tl.nativeCol) + 1;
          const r2 = br ? Math.floor(br.nativeRow) + 1 : r1, c2 = br ? Math.floor(br.nativeCol) + 1 : c1;
          imgs.push({ a: A1(c1, r1), r2, c2, ext, media: mi });
          lastValRow = Math.max(lastValRow, r1);
        }
      } catch (e) { /* pictures are optional */ }
      const keepRow = Math.max(lastValRow, ...merges.map((m) => parseRange(m).r2), 1);
      for (const a of Object.keys(cells)) if (splitA1(a).r > keepRow + 2) delete cells[a];
      maxRow = Math.min(Math.max(maxRow, 1), keepRow + 2);
      let lastValCol = 1;
      for (const [a, cv] of Object.entries(cells)) if (cv[0] !== null && cv[0] !== '') lastValCol = Math.max(lastValCol, splitA1(a).c);
      for (const im of imgs) lastValCol = Math.max(lastValCol, splitA1(im.a).c);
      const maxCol = Math.max(lastValCol, ...merges.map((m) => parseRange(m).c2), 1);
      for (const a of Object.keys(cells)) if (splitA1(a).c > maxCol) delete cells[a];
      const cols = [];
      for (let c = 1; c <= maxCol; c++) { const col = ws.getColumn(c); cols[c] = col && col.width ? Math.round(col.width * 100) / 100 : null; }
      const rows = {};
      for (let r = 1; r <= maxRow; r++) { const h = ws.getRow(r).height; if (h) rows[r] = h; }
      sheets.push({ name: ws.name, order, state: ws.state || 'visible', maxRow, maxCol, cols, rows, merges, cells, images: imgs, truncated });
    });
    return { fileName: opts.fileName || '', importedAt: opts.at || null, theme: readTheme(wb), styles, sheets, media };
  }
  function visibleWhenEmpty(st) { return !!(st && (st.fill || st.border || (st.alignment && false) || st.numFmt)); }
  function bufB64(buf) {
    if (typeof Buffer !== 'undefined' && Buffer.from) return Buffer.from(buf).toString('base64');
    const u = new Uint8Array(buf); let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s);
  }

  /**
   * writeWorkbook(model, tpl, opts) — write the board's tabs into the template
   * (the file last imported), keeping pictures, widths and print setup.
   * opts.paint(sheet, addr) -> null | { fill: 'FFC7CE', font: '9C0006' } | 'clear'
   */
  function writeWorkbook(model, tpl, opts) {
    opts = opts || {};
    for (const sh of model.sheets) {
      let ws = tpl.getWorksheet(sh.name);
      if (!ws) ws = tpl.addWorksheet(sh.name);
      for (const m of Object.values(ws._merges || {})) {
        const rg = m.range || rangeStr({ c1: m.model.left, r1: m.model.top, c2: m.model.right, r2: m.model.bottom });
        try { ws.unMergeCells(rg); } catch (e) { /* gone */ }
      }
      const lastRow = Math.max(ws.rowCount, sh.maxRow), lastCol = Math.max(ws.columnCount, sh.maxCol);
      for (let r = 1; r <= lastRow; r++) {
        const row = ws.getRow(r);
        for (let c = 1; c <= lastCol; c++) { const cell = row.getCell(c); cell.value = null; cell.style = {}; }
        row.height = undefined;
      }
      for (let c = 1; c <= sh.maxCol; c++) ws.getColumn(c).width = sh.cols[c] || undefined;
      for (const [r, h] of Object.entries(sh.rows || {})) ws.getRow(+r).height = h;
      for (const m of sh.merges) { try { ws.mergeCells(m); } catch (e) { /* overlapping */ } }
      const mi = mergeIndex(sh);
      for (const [a, cv] of Object.entries(sh.cells)) {
        const cell = ws.getCell(a);
        let st = clone(model.styles[cv[1]] || {});
        const p = opts.paint ? opts.paint(sh.name, a) : null;
        if (p === 'clear') { delete st.fill; if (st.font) delete st.font.color; }
        else if (p && p.fill) { st.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF' + p.fill } }; if (p.font) st.font = Object.assign({}, st.font, { color: { argb: 'FF' + p.font } }); }
        cell.style = st;
        if (mi[a] && mi[a] !== a) continue;
        const v = cv[0];
        if (v !== null && typeof v === 'object') {
          if ('f' in v) cell.value = v.f ? { formula: v.f, result: v.v === null ? undefined : v.v } : v.v;
          else if ('d' in v) cell.value = new Date(v.d);
        } else cell.value = v;
      }
    }
    return tpl;
  }

  /**
   * addIssuesSheet(wb, issues, images) — an "Issues" tab for the record.
   * issues: [{ id, status, owner, sheet, cells, title, source, rev, opened, thread:[{t, by, text, imgs:[id]}] }]
   * images: { id: { buffer, ext, w, h } }
   */
  function addIssuesSheet(wb, issues, images, name) {
    let nm = name || 'Board issues', k = 2;
    while (wb.getWorksheet(nm)) nm = (name || 'Board issues') + ' ' + k++;
    const ws = wb.addWorksheet(nm);
    const head = ['#', 'Status', 'Owner', 'Tab', 'Cells', 'Issue', 'From', 'Rev', 'Opened', 'Thread', 'Screenshots'];
    ws.columns = [6, 11, 13, 18, 12, 46, 14, 10, 20, 70, 36].map((w) => ({ width: w }));
    ws.addRow(head);
    ws.getRow(1).font = { bold: true };
    ws.getRow(1).eachCell((c) => { c.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FFFFFFCC' } }; c.border = { bottom: { style: 'thin' } }; });
    ws.views = [{ state: 'frozen', ySplit: 1 }];
    let rowIdx = 2;
    for (const i of issues) {
      const thread = (i.thread || []).map((m) => `${m.when} · ${m.by}: ${m.text || ''}${m.imgs && m.imgs.length ? ` [${m.imgs.length} screenshot${m.imgs.length > 1 ? 's' : ''}]` : ''}`).join('\n');
      const row = ws.getRow(rowIdx);
      row.values = [i.id, i.status, i.owner, i.sheet, (i.cells || []).join(', '), i.title, i.source, i.rev || '', i.opened || '', thread, ''];
      row.alignment = { vertical: 'top', wrapText: true };
      const imgIds = [].concat(...(i.thread || []).map((m) => m.imgs || [])).filter((id) => images && images[id]);
      let h = Math.max(30, 15 * Math.min(12, thread.split('\n').length + 1));
      let x = 0;
      for (const id of imgIds.slice(0, 4)) {
        const im = images[id];
        const scale = Math.min(1, 240 / (im.w || 240), 160 / (im.h || 160));
        const w = Math.round((im.w || 240) * scale), hh = Math.round((im.h || 160) * scale);
        const mid = wb.addImage({ buffer: im.buffer, extension: im.ext === 'jpg' ? 'jpeg' : im.ext });
        ws.addImage(mid, { tl: { col: 10 + x / 260, row: rowIdx - 1 + 0.1 }, ext: { width: w, height: hh } });
        x += w + 8; h = Math.max(h, hh * 0.78 + 8);
      }
      if (imgIds.length) { ws.getColumn(11).width = Math.max(36, Math.min(110, Math.ceil(x / 7))); row.getCell(11).value = imgIds.length > 4 ? `+${imgIds.length - 4} more in the board` : null; }
      row.height = h;
      rowIdx++;
    }
    return ws;
  }

  /* ---------- merged cells ---------- */
  function mergeIndex(sh) {
    if (sh._mi && sh._mi.src === sh.merges) return sh._mi.map;
    const map = {};
    for (const m of sh.merges) { const o = parseRange(m); for (let r = o.r1; r <= o.r2; r++) for (let c = o.c1; c <= o.c2; c++) map[A1(c, r)] = A1(o.c1, o.r1); }
    Object.defineProperty(sh, '_mi', { value: { src: sh.merges, map }, enumerable: false, configurable: true, writable: true });
    return map;
  }
  function masterOf(sh, a) { return mergeIndex(sh)[a] || a; }
  function own(sh, c, r) { const cv = sh.cells[A1(c, r)]; return cv ? cv[0] : null; }
  function val(sh, c, r) { const a = masterOf(sh, A1(c, r)); const cv = sh.cells[a]; return cv ? cv[0] : null; }

  /* ============================================================
     Colors
     ============================================================ */
  function tintHex(hex, tint) {
    if (!tint) return hex;
    const n = parseInt(hex, 16); let r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const f = (v) => Math.max(0, Math.min(255, Math.round(tint > 0 ? v + (255 - v) * tint : v * (1 + tint))));
    r = f(r); g = f(g); b = f(b);
    return ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1).toUpperCase();
  }
  const INDEXED = { 2: 'FF0000', 3: '00FF00', 4: '0000FF', 5: 'FFFF00', 6: 'FF00FF', 7: '00FFFF', 10: 'FF0000', 13: 'FFFF00', 22: 'C0C0C0', 43: 'FFFF99', 44: '99CCFF', 45: 'FF99CC', 47: 'FFCC99', 51: 'FFCC00', 52: 'FF9900' };
  function colorHex(c, theme) {
    if (!c) return null;
    if (c.argb) return c.argb.slice(-6).toUpperCase();
    if (c.theme !== undefined) return tintHex((theme || DEFAULT_THEME)[c.theme] || '000000', c.tint || 0);
    if (c.indexed !== undefined && INDEXED[c.indexed]) return INDEXED[c.indexed];
    return null;
  }
  const NOT_A_MARK = new Set(['FFFFFF', '000000']);
  /** the color a person used to mark a cell: its fill, or a non-black font when there is no fill */
  function colorKey(model, sid) {
    const st = model.styles[sid];
    if (!st) return null;
    if (st.fill && st.fill.fgColor) { const h = colorHex(st.fill.fgColor, model.theme); if (h && !NOT_A_MARK.has(h)) return h; }
    if (st.font && st.font.color) { const h = colorHex(st.font.color, model.theme); if (h && !NOT_A_MARK.has(h) && h !== '1F2328') return 'T' + h; }
    return null;
  }
  const RED_FILLS = new Set(['FFC7CE', 'FF0000', 'FFCCCC', 'FF9999', 'F4CCCC', 'FFC0CB']);
  const RED_FONTS = new Set(['T9C0006', 'TFF0000', 'TC00000']);
  const isRedKey = (k) => RED_FILLS.has(k) || RED_FONTS.has(k);
  function colorName(k) {
    const h = k.replace(/^T/, ''); const n = parseInt(h, 16); const r = n >> 16, g = (n >> 8) & 255, b = n & 255;
    const mx = Math.max(r, g, b), mn = Math.min(r, g, b);
    if (mx - mn < 18) return mx > 200 ? 'light grey' : mx > 110 ? 'grey' : 'dark grey';
    let hue; const d = mx - mn;
    if (mx === r) hue = ((g - b) / d) % 6; else if (mx === g) hue = (b - r) / d + 2; else hue = (r - g) / d + 4;
    hue = (hue * 60 + 360) % 360;
    const light = mx > 200 && mn > 150 ? 'light ' : '';
    const nm = hue < 15 || hue >= 340 ? (light && mn > 180 ? 'pink' : 'red') : hue < 45 ? 'orange' : hue < 70 ? 'yellow' : hue < 170 ? 'green' : hue < 200 ? 'teal' : hue < 260 ? 'blue' : hue < 300 ? 'purple' : 'pink';
    return (k.startsWith('T') ? 'text: ' : '') + light + nm;
  }

  /** findLegend(model) -> { cells: Set('Sheet!A1'), map: { key: label } } */
  function findLegend(model) {
    const cells = new Set(), map = {};
    for (const sh of model.sheets) {
      for (const [a, cv] of Object.entries(sh.cells)) {
        if (!/^\s*(LEGEND|KEY|COLOR\s+LEGEND|COLOUR\s+LEGEND)\s*:?\s*$/i.test(txt(cv[0]))) continue;
        const { c, r } = splitA1(a);
        cells.add(sh.name + '!' + a);
        let miss = 0;
        for (let rr = r + 1; rr <= Math.min(sh.maxRow, r + 14) && miss < 2; rr++) {
          const ma = masterOf(sh, A1(c, rr));
          if (splitA1(ma).r !== rr && ma !== A1(c, rr)) continue;
          const cvv = sh.cells[A1(c, rr)];
          const key = cvv ? colorKey(model, cvv[1]) : null;
          if (!key) { miss++; continue; }
          miss = 0;
          let label = txt(cvv[0]).trim();
          if (!label) { const right = own(sh, c + 1, rr); if (txt(right).trim() && !(sh.cells[A1(c + 1, rr)] && colorKey(model, sh.cells[A1(c + 1, rr)][1]))) { label = txt(right).trim(); cells.add(sh.name + '!' + A1(c + 1, rr)); } }
          cells.add(sh.name + '!' + A1(c, rr));
          if (!map[key] || (!map[key] && label)) map[key] = label;
          else if (label && !map[key]) map[key] = label;
        }
      }
    }
    return { cells, map };
  }

  /* ============================================================
     Layout reading — header rows, tables, number / size columns
     ============================================================ */
  const QTY_HDR = /^(QT|QTY|QTY\.?|QUANTITY|Q'TY|QNTY|COUNT|NO\.? OF|EA|PCS)$|\bQ'?TY\b|\bQUANTITY\b/i;
  const W_HDR = /\bWIDTH\b|^W$|^WD$/i, H_HDR = /\bHEIGHT\b|\bHEGHT\b|\bHIEGHT\b|^H$|^HT$/i, L_HDR = /\bLENGTH\b|^L$|^LEN$/i;
  const NOTE_HDR = /NOTE|REMARK|RFI|REF\s*#|COMMENT|QUESTION/i;
  const ID_HDR = /^(ID|MARK|TAG|NAME|NO\.?|#|SET\s*#|SERIAL\s*NO\.?|WALL\s*TYPE|TYPE|CODE|ITEM)$/i;
  // a whole code token: MT-10, GL-01, WT-01A, FIT-0011, WS12 (not the start of MUL00-13490 or A6063-T5)
  const CODE_RE = /^\s*([A-Z]{1,4}-\d{1,4}[A-Z]?|[A-Z]{1,4}\d{1,4}[A-Z]?)(?![\w-])/;

  /* ft-in sizes: 8' - 0"   strict = written the way schedules write them */
  const STRICT_FTIN = /^\s*\d+\s*'\s*-?\s*\d+(?:\s+\d+\/\d+)?\s*"\s*$|^\s*\d+\s*'\s*$|^\s*\d+(?:\s+\d+\/\d+)?\s*"\s*$/;
  function parseFtIn(s) {
    const t = txt(s).trim();
    if (!t || typeof s === 'number') return null;
    const m = /^(\d+(?:\.\d+)?)\s*'\s*(?:-?\s*(\d+)?(?:\s*(\d+)\/(\d+))?\s*"?)?\s*$/.exec(t);
    if (!m) {
      const inch = /^(\d+)(?:\s+(\d+)\/(\d+))?\s*"\s*$/.exec(t);
      if (inch) return { inches: +inch[1] + (inch[2] ? inch[2] / inch[3] : 0), strict: true };
      return null;
    }
    const inches = (+m[1]) * 12 + (m[2] ? +m[2] : 0) + (m[3] ? m[3] / m[4] : 0);
    return { inches, strict: STRICT_FTIN.test(t) };
  }
  function looksLikeSize(v) { return typeof v === 'string' && /\d\s*['"]/.test(v) && parseFtIn(v) !== null; }

  function rowCells(sh, r) {
    const out = [];
    for (let c = 1; c <= sh.maxCol; c++) {
      const a = A1(c, r);
      const m = masterOf(sh, a);
      if (m !== a) continue;
      const cv = sh.cells[a];
      if (!cv) continue;
      const v = cv[0];
      if (v === null || txt(v).trim() === '') continue;
      out.push({ c, a, v, sid: cv[1] });
    }
    return out;
  }
  function isSubtotalRow(sh, r, cells) {
    cells = cells || rowCells(sh, r);
    if (cells.some((x) => x.v && typeof x.v === 'object' && 'f' in x.v && /\b(SUM|SUBTOTAL)\s*\(/i.test(x.v.f))) return true;
    const first = cells.find((x) => typeof x.v === 'string');
    return !!(first && /^\s*(SUB\s*-?\s*TOTAL|TOTAL|SUMMARY|GRAND\s+TOTAL)\b/i.test(first.v));
  }
  function styledShare(model, cells) {
    let s = 0;
    for (const x of cells) {
      const st = model.styles[x.sid] || {};
      const filled = st.fill && st.fill.fgColor && !NOT_A_MARK.has(colorHex(st.fill.fgColor, model.theme) || 'FFFFFF');
      if ((st.font && st.font.bold) || filled) s++;
    }
    return cells.length ? s / cells.length : 0;
  }
  function headerLike(model, sh, r) {
    const cells = rowCells(sh, r);
    if (cells.length < 3) return false;
    if (isSubtotalRow(sh, r, cells)) return false;
    // short labels, mostly without digits (data rows carry codes, sizes and numbers)
    const labels = cells.filter((x) => typeof x.v === 'string' && !isNum(x.v) && x.v.trim().length <= 32 && !looksLikeSize(x.v)).length / cells.length;
    if (labels < 0.9) return false;
    const digits = cells.filter((x) => /\d/.test(txt(x.v))).length / cells.length;
    if (digits > 0.25) return false;
    // one fill (or bold) across the row: a header band, not a few highlighted data cells
    const keyOf = (x) => { const st = model.styles[x.sid] || {}; const h = st.fill && st.fill.fgColor ? colorHex(st.fill.fgColor, model.theme) : null; return h && h !== 'FFFFFF' ? h : (st.font && st.font.bold ? 'bold' : 'none'); };
    const cnt = {}; cells.forEach((x) => { const k = keyOf(x); cnt[k] = (cnt[k] || 0) + 1; });
    const [topKey, topN] = Object.entries(cnt).sort((a, b) => b[1] - a[1])[0];
    return topKey !== 'none' && topN / cells.length >= 0.8 && styledShare(model, cells) >= 0.8;
  }
  function autoHeaderRows(model, sh) {
    const rows = [];
    for (let r = 1; r <= sh.maxRow; r++) if (headerLike(model, sh, r)) rows.push(r);
    if (rows.length) return rows;
    // no styled header: first row of 3+ short labels followed by 2 rows with values
    for (let r = 1; r <= Math.min(sh.maxRow, 40); r++) {
      const cells = rowCells(sh, r);
      if (cells.length < 3 || !cells.every((x) => typeof x.v === 'string' && x.v.length <= 40 && !isNum(x.v))) continue;
      const next = [1, 2].map((d) => rowCells(sh, r + d).length);
      if (next.every((n) => n >= 2)) return [r];
    }
    return [];
  }

  /**
   * analyzeSheet(model, sh, ss) — reads the layout of one tab.
   * Returns { headerRows, tables:[{ hdr:[rows], from, to, names:{c}, rows:[data rows], types:{c} }],
   *           rowInfo:{ r: { kind:'header'|'data'|'subtotal'|'text', table } } }
   */
  function analyzeSheet(model, sh, ss) {
    ss = ss || {};
    const headerRows = (ss.headerRows && ss.headerRows.length ? ss.headerRows.slice() : autoHeaderRows(model, sh)).filter((r) => r >= 1 && r <= sh.maxRow).sort((a, b) => a - b);
    const groups = [];
    for (const r of headerRows) { const g = groups[groups.length - 1]; if (g && r === g[g.length - 1] + 1) g.push(r); else groups.push([r]); }
    const tables = [];
    const rowInfo = {};
    let prevNames = {};
    const starts = groups.length ? groups : [[0]];
    starts.forEach((g, i) => {
      const from = g[g.length - 1] + 1;
      const to = i + 1 < starts.length ? starts[i + 1][0] - 1 : sh.maxRow;
      const names = {};
      if (g[0] > 0) {
        for (let c = 1; c <= sh.maxCol; c++) {
          const parts = [];
          for (const r of g) { const t = txt(val(sh, c, r)).replace(/\s+/g, ' ').trim(); if (t && !parts.includes(t)) parts.push(t); }
          if (parts.length) names[c] = parts.join(' / ');
          else if (prevNames[c]) names[c] = prevNames[c];
        }
        for (const r of g) rowInfo[r] = { kind: 'header', table: i };
      }
      const t = { hdr: g[0] > 0 ? g : [], from, to, names, rows: [], types: {}, idx: i };
      for (let r = from; r <= to; r++) {
        const cells = rowCells(sh, r);
        if (!cells.length) continue;
        if (isSubtotalRow(sh, r, cells)) { rowInfo[r] = { kind: 'subtotal', table: i }; continue; }
        if (cells.length === 1 && Object.keys(names).length > 2) { rowInfo[r] = { kind: 'text', table: i }; continue; }
        rowInfo[r] = { kind: 'data', table: i };
        t.rows.push(r);
      }
      // column types from the values (and the header as a hint)
      for (let c = 1; c <= sh.maxCol; c++) {
        let n = 0, nums = 0, sizes = 0, codes = 0;
        for (const r of t.rows) {
          const a = A1(c, r); if (masterOf(sh, a) !== a) continue;
          const v = own(sh, c, r);
          if (v === null || EMPTYISH.test(txt(v))) continue;
          n++;
          if (isNum(v)) nums++; else if (looksLikeSize(v)) sizes++;
          if (typeof v === 'string' && CODE_RE.test(v)) codes++;
        }
        if (!n) continue;
        const hn = names[c] || '';
        let type = 'text';
        if (sizes / n >= 0.6 || ((W_HDR.test(hn) || H_HDR.test(hn) || L_HDR.test(hn)) && sizes / n >= 0.3)) type = 'size';
        else if (nums / n >= 0.6 || (QTY_HDR.test(hn) && nums / n >= 0.3)) type = 'num';
        else if (codes / n >= 0.6) type = 'code';
        t.types[c] = { type, n };
      }
      tables.push(t);
      if (g[0] > 0) prevNames = names;
    });
    return { headerRows, tables, rowInfo };
  }
  function analyzeFile(model, setup) {
    const out = {};
    for (const sh of model.sheets) {
      const ss = (setup && setup.sheets && setup.sheets[sh.name]) || {};
      out[sh.name] = Object.assign(analyzeSheet(model, sh, ss), { ignore: !!ss.ignore });
    }
    return out;
  }
  function colName(an, sh, c, r) {
    const info = an.rowInfo[r];
    const t = info ? an.tables[info.table] : an.tables.find((x) => r >= x.from && r <= x.to);
    return (t && t.names[c]) || colLetters(c);
  }

  /* ============================================================
     Color marks (what the team colored)
     ============================================================ */
  /** colorsUsed(model, an, legend) -> [{ key, name, count, cells:[sheet!A1], legend }] */
  function colorsUsed(model, an, legend) {
    an = an || analyzeFile(model);
    legend = legend || findLegend(model);
    const m = new Map();
    for (const sh of model.sheets) {
      const a0 = an[sh.name];
      if (a0 && a0.ignore) continue;
      for (const [a, cv] of Object.entries(sh.cells)) {
        if (cv[0] === null || txt(cv[0]).trim() === '') continue;
        if (legend.cells.has(sh.name + '!' + a)) continue;
        const r = splitA1(a).r;
        if (a0 && a0.rowInfo[r] && (a0.rowInfo[r].kind === 'header' || a0.rowInfo[r].kind === 'subtotal')) continue;
        const k = colorKey(model, cv[1]);
        if (!k) continue;
        if (!m.has(k)) m.set(k, { key: k, name: colorName(k), count: 0, cells: [], legend: legend.map[k] || '' });
        const e = m.get(k); e.count++; if (e.cells.length < 4) e.cells.push(sh.name + '!' + a);
      }
    }
    // legend colors that are not used anywhere still show up, so the setup can name them
    for (const [k, label] of Object.entries(legend.map)) if (!m.has(k)) m.set(k, { key: k, name: colorName(k), count: 0, cells: [], legend: label });
    return [...m.values()].sort((x, y) => y.count - x.count);
  }
  function defaultColorSetup(used) {
    const out = {};
    for (const u of used) {
      if (isRedKey(u.key)) out[u.key] = { kind: 'issue', label: u.legend || 'Issue', auto: true };
      else out[u.key] = { kind: 'label', label: u.legend || ('Highlight (' + u.name + ')'), auto: true };
    }
    return out;
  }
  /** colorMarks(model, setup, an, legend) -> issue-kind colored cells grouped by tab + row + color */
  function colorMarks(model, setup, an, legend) {
    an = an || analyzeFile(model, setup);
    legend = legend || findLegend(model);
    const colors = (setup && setup.colors) || {};
    const groups = [];
    for (const sh of model.sheets) {
      const a0 = an[sh.name];
      if (a0 && a0.ignore) continue;
      const by = {};
      for (const [a, cv] of Object.entries(sh.cells)) {
        if (cv[0] === null || txt(cv[0]).trim() === '') continue;
        if (legend.cells.has(sh.name + '!' + a)) continue;
        const { r } = splitA1(a);
        if (a0 && a0.rowInfo[r] && (a0.rowInfo[r].kind === 'header' || a0.rowInfo[r].kind === 'subtotal')) continue;
        const k = colorKey(model, cv[1]);
        if (!k) continue;
        const kind = colors[k] ? colors[k].kind : (isRedKey(k) ? 'issue' : 'label');
        if (kind !== 'issue') continue;
        const g = r + '|' + k;
        (by[g] = by[g] || { sheet: sh.name, row: r, key: k, label: colors[k] ? colors[k].label : 'Issue', cells: [] }).cells.push(a);
      }
      for (const g of Object.values(by)) { g.cells.sort((x, y) => splitA1(x).c - splitA1(y).c); groups.push(g); }
    }
    return groups.sort((x, y) => model.sheets.findIndex((s) => s.name === x.sheet) - model.sheets.findIndex((s) => s.name === y.sheet) || x.row - y.row);
  }
  /** which issue colors a cell carries now */
  function cellIssueColor(model, setup, sheet, a) {
    const sh = model.sheets.find((s) => s.name === sheet); if (!sh) return null;
    const cv = sh.cells[a]; if (!cv) return null;
    const k = colorKey(model, cv[1]); if (!k) return null;
    const c = setup && setup.colors && setup.colors[k];
    const kind = c ? c.kind : (isRedKey(k) ? 'issue' : 'label');
    return kind === 'issue' ? k : null;
  }

  /* ============================================================
     Checks — rules that work on any layout
     ============================================================ */
  const RULES = {
    'question': { sev: 'warn', title: 'Open question in the text', why: 'The cell asks something ("please advise", "TBD", "to be confirmed", "?"). It is still open until someone answers it.' },
    'formula-total': { sev: 'error', title: 'Total formula looks wrong', why: 'A SUM adds a subtotal on top of the rows that subtotal already counts, or its range stops one row short of the data next to it.' },
    'dup-id': { sev: 'error', title: 'Same ID listed twice', why: 'The ID / mark column should be unique on a tab.', needs: 'ID column' },
    'code-text': { sev: 'info', title: 'Same code, different description', why: 'One code is described in more than one way. It may be on purpose; worth a look.' },
    'num-format': { sev: 'warn', title: 'Not a number in a number column', why: 'The rest of this column is numbers, so this value is left out of totals.' },
    'size-format': { sev: 'warn', title: "Size not written as ft-in", why: 'Sizes in this column are written like 8\' - 0". This one is missing a part.' },
    'required': { sev: 'warn', title: 'Required cell is empty', why: 'The file setup marks this column as required.', needs: 'required columns' },
    'one-off': { sev: 'info', title: 'Value appears only once', why: 'Every other row in this column uses a repeated value. Worth a look; it may be correct.' },
  };
  const Q_STRONG = [/\bplease\s+(advise|confirm|verify|clarify|check)\b/i, /\b(TBD|TBC|TBA)\b/, /\bto\s+be\s+(conf|deter|verif|coord|advis|decid)/i,
    /\bneed(s|ed)?\s+to\s+(be\s+)?(confirm|coordinat|verif|check|clarif|decid)/i, /\?\s*$/, /^\s*\?+\s*$/, /\bpending\b/i, /\bnot\s+(yet\s+)?(confirmed|decided|specified)\b/i];
  const Q_SOFT = [/\bcoordinat(e|ed|ion)\b/i, /\bverify\b/i, /\bconfirm\b/i, /\bcheck\b/i, /\badvise\b/i];

  function runChecks(model, setup, an, legend) {
    setup = setup || {};
    an = an || analyzeFile(model, setup);
    legend = legend || findLegend(model);
    const out = [];
    const add = (rule, sheet, cells, detail, sev) => {
      const sh = model.sheets.find((s) => s.name === sheet);
      const vals = cells.map((a) => (sh && sh.cells[a] ? txt(sh.cells[a][0]) + (sh.cells[a][0] && sh.cells[a][0].f ? '=' + sh.cells[a][0].f : '') : '')).join('|');
      const R = RULES[rule];
      out.push({ id: rule + ':' + sheet + ':' + cells.join(',') + ':' + hash(vals), rule, sev: sev || R.sev, title: R.title, why: R.why, sheet, cells, detail });
    };
    const codeGroups = {}; // code -> desc -> [{sheet, a}]
    for (const sh of model.sheets) {
      const a0 = an[sh.name];
      if (!a0 || a0.ignore) continue;
      const ss = (setup.sheets && setup.sheets[sh.name]) || {};
      const notesCols = new Set((ss.notesCols || []).map(colNum));
      // 1. question text
      for (const [a, cv] of Object.entries(sh.cells)) {
        const v = cv[0];
        if (typeof v !== 'string' || !v.trim()) continue;
        if (legend.cells.has(sh.name + '!' + a)) continue;
        const { c, r } = splitA1(a);
        if (a0.rowInfo[r] && a0.rowInfo[r].kind === 'header') continue;
        const inNotes = notesCols.size ? notesCols.has(c) : NOTE_HDR.test(colName(a0, sh, c, r));
        const hit = Q_STRONG.some((re) => re.test(v)) || (inNotes && Q_SOFT.some((re) => re.test(v)));
        if (hit) add('question', sh.name, [a], `${colName(a0, sh, c, r)}: "${v.replace(/\s+/g, ' ').trim().slice(0, 140)}"`);
      }
      // 2. formula totals
      for (const [a, cv] of Object.entries(sh.cells)) {
        const v = cv[0];
        if (!v || typeof v !== 'object' || !('f' in v) || !v.f) continue;
        const re = /(^|[^!A-Z'])SUM\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)/gi;
        let m;
        while ((m = re.exec(v.f))) {
          const o = { c1: colNum(m[2]), r1: +m[3], c2: colNum(m[4]), r2: +m[5] };
          const self = splitA1(a);
          const probs = [];
          // a) a subtotal inside the range whose own range overlaps -> counted twice
          for (let rr = o.r1; rr <= o.r2; rr++) for (let cc = o.c1; cc <= o.c2; cc++) {
            const iv = own(sh, cc, rr);
            if (!iv || typeof iv !== 'object' || !iv.f || A1(cc, rr) === a) continue;
            const im = /SUM\(\s*\$?([A-Z]{1,3})\$?(\d+)\s*:\s*\$?([A-Z]{1,3})\$?(\d+)\s*\)/i.exec(iv.f);
            if (!im) continue;
            const io = { c1: colNum(im[1]), r1: +im[2], c2: colNum(im[3]), r2: +im[4] };
            if (io.r1 <= o.r2 && io.r2 >= o.r1 && io.c1 <= o.c2 && io.c2 >= o.c1) probs.push(`adds the subtotal in ${A1(cc, rr)} (=${iv.f}) on top of the rows it already counts`);
          }
          // b) stops / starts one row short of the data right next to it (single-column ranges)
          if (o.c1 === o.c2) {
            const dataAt = (rr) => {
              if (rr < 1 || rr > sh.maxRow || rr === self.r) return false;
              const info = a0.rowInfo[rr];
              if (!info || info.kind !== 'data') return false;
              const x = own(sh, o.c1, rr);
              return x !== null && isNum(x) && !(typeof x === 'object' && x.f && /SUM\(/i.test(x.f));
            };
            if (dataAt(o.r1 - 1)) probs.push(`starts at row ${o.r1} and skips row ${o.r1 - 1} (${txt(own(sh, o.c1, o.r1 - 1))}) right above it`);
            if (dataAt(o.r2 + 1)) {
              let k = o.r2 + 1; while (dataAt(k + 1)) k++;
              probs.push(k > o.r2 + 1 ? `stops at row ${o.r2}; rows ${o.r2 + 1}–${k} below it are not counted` : `stops at row ${o.r2}; row ${o.r2 + 1} below it is not counted`);
            }
          }
          if (probs.length) add('formula-total', sh.name, [a], `${a} =${v.f}: ${probs.join('; ')}. Shows ${txt(v.v)}.`, probs.some((p) => /counts/.test(p)) ? 'error' : 'warn');
        }
      }
      // 3. per table column checks
      const idCol = ss.idCol ? colNum(ss.idCol) : null;
      const req = (ss.requiredCols || []).map(colNum);
      const ids = {};
      for (const t of a0.tables) {
        for (const [cs, ty] of Object.entries(t.types)) {
          const c = +cs;
          const name = t.names[c] || colLetters(c);
          const values = [];
          for (const r of t.rows) {
            const a = A1(c, r); if (masterOf(sh, a) !== a) continue;
            const v = own(sh, c, r);
            if (v === null || EMPTYISH.test(txt(v))) continue;
            values.push({ a, v, r });
          }
          if (ty.type === 'num') for (const x of values) if (!isNum(x.v) && !looksLikeSize(x.v)) add('num-format', sh.name, [x.a], `${name} "${txt(x.v)}" is not a number`);
          if (ty.type === 'size') for (const x of values) { const p = parseFtIn(x.v); if (!p) add('size-format', sh.name, [x.a], `${name} "${txt(x.v)}" can't be read as a size`); else if (!p.strict) add('size-format', sh.name, [x.a], `${name} "${txt(x.v)}"`); }
          if (ty.type === 'text' && values.length >= 8) {
            const cnt = {}; values.forEach((x) => { const k = squash(x.v); cnt[k] = (cnt[k] || 0) + 1; });
            const keys = Object.keys(cnt);
            const singles = keys.filter((k) => cnt[k] === 1);
            if (keys.length <= 5 && singles.length === 1 && keys.filter((k) => cnt[k] > 1).every((k) => cnt[k] >= 3)) {
              const x = values.find((y) => squash(y.v) === singles[0]);
              add('one-off', sh.name, [x.a], `${name} "${txt(x.v)}" appears once; the others are ${keys.filter((k) => k !== singles[0]).map((k) => `"${k}" ×${cnt[k]}`).join(', ')}`);
            }
          }
          if (ty.type === 'code') {
            // description = nearest text column to the right in the same table
            let dc = null;
            for (let k = c + 1; k <= Math.min(sh.maxCol, c + 3); k++) {
              if (!t.types[k] || t.types[k].type !== 'text') continue;
              if (NOTE_HDR.test(t.names[k] || '') || notesCols.has(k)) break; // notes are not descriptions
              dc = k; break;
            }
            if (dc) for (const x of values) {
              const code = (CODE_RE.exec(txt(x.v)) || [])[1]; if (!code) continue;
              const d = squash(val(sh, dc, x.r)); if (!d) continue;
              const g = (codeGroups[code.toUpperCase()] = codeGroups[code.toUpperCase()] || {});
              (g[d] = g[d] || []).push({ sheet: sh.name, a: A1(dc, x.r), r: x.r, col: t.names[dc] || colLetters(dc) });
            }
          }
        }
        if (idCol) for (const r of t.rows) {
          const v = txt(val(sh, idCol, r)).trim(); if (!v || EMPTYISH.test(v)) continue;
          const a = masterOf(sh, A1(idCol, r));
          const k = squash(v);
          (ids[k] = ids[k] || []).push({ a, r, v }); // merged ID cells count once
        }
        if (req.length) for (const r of t.rows) {
          const miss = req.filter((c) => { const v = val(sh, c, r); return v === null || txt(v).trim() === ''; });
          if (miss.length) add('required', sh.name, miss.map((c) => A1(c, r)), `Row ${r}: no ${miss.map((c) => t.names[c] || colLetters(c)).join(', ')}`);
        }
      }
      for (const [k, list] of Object.entries(ids)) {
        const uniq = [...new Map(list.map((x) => [x.a, x])).values()];
        if (uniq.length > 1) for (const x of uniq) add('dup-id', sh.name, [x.a], `"${x.v}" is on rows ${uniq.map((y) => y.r).join(', ')}`);
      }
    }
    for (const [code, g] of Object.entries(codeGroups)) {
      const variants = Object.entries(g);
      if (variants.length < 2) continue;
      const first = variants.map(([d, l]) => l[0]);
      const sheet = first[0].sheet;
      add('code-text', sheet, first.filter((x) => x.sheet === sheet).map((x) => x.a),
        `${code}: ${variants.map(([d, l]) => `"${d}" (${l.map((x) => (x.sheet !== sheet ? x.sheet + ' ' : '') + 'row ' + x.r).join(', ')})`).join(' vs ')}`);
    }
    const order = { error: 0, warn: 1, info: 2 };
    return out.sort((a, b) => order[a.sev] - order[b.sev] || model.sheets.findIndex((s) => s.name === a.sheet) - model.sheets.findIndex((s) => s.name === b.sheet) || splitA1(a.cells[0]).r - splitA1(b.cells[0]).r);
  }

  /* ============================================================
     Totals — read automatically from the headers and values
     ============================================================ */
  function totals(model, setup, an) {
    an = an || analyzeFile(model, setup);
    const bySheet = [];
    let sf = 0, rows = 0, any = false;
    for (const sh of model.sheets) {
      const a0 = an[sh.name]; if (!a0 || a0.ignore) continue;
      let ssf = 0, sized = 0, unsized = 0, drows = 0, found = false;
      for (const t of a0.tables) {
        drows += t.rows.length;
        const find = (re, type) => Object.keys(t.types).map(Number).find((c) => t.types[c].type === type && re.test(t.names[c] || ''));
        const wc = find(W_HDR, 'size'), hc = find(H_HDR, 'size'), qc = find(QTY_HDR, 'num');
        if (!wc || !hc) continue;
        found = true;
        for (const r of t.rows) {
          const w = parseFtIn(own(sh, wc, r)), h = parseFtIn(own(sh, hc, r));
          const qv = qc ? own(sh, qc, r) : 1;
          const q = qc ? (isNum(qv) ? Number(txt(qv)) : (/^\s*(\d+)/.exec(txt(qv)) || [])[1] ? +(/^\s*(\d+)/.exec(txt(qv))[1]) : null) : 1;
          if (w && h && q !== null) { ssf += (w.inches * h.inches * q) / 144; sized++; } else if (w || h) unsized++;
        }
      }
      rows += drows;
      if (found) { any = true; sf += ssf; }
      bySheet.push({ sheet: sh.name, rows: drows, sf: found ? ssf : null, sized, unsized });
    }
    return { sf: any ? sf : null, rows, bySheet };
  }

  /* ============================================================
     History — every change is an op; any point can be rebuilt
     ============================================================ */
  function shiftAddr(a, r0, d) { const p = splitA1(a); return p.r >= r0 ? A1(p.c, p.r + d) : a; }
  function applyOp(model, op) {
    if (op.k === 'import') { const m = clone(op.model); for (const k of ['sheets', 'styles', 'fileName', 'importedAt', 'theme', 'media']) model[k] = m[k]; return model; }
    const sh = model.sheets.find((s) => s.name === op.s);
    if (!sh) return model;
    if (op.k === 'set') {
      const cur = sh.cells[op.a];
      if (op.v === null || op.v === '') { if (cur) { if (cur[1]) cur[0] = null; else delete sh.cells[op.a]; } }
      else sh.cells[op.a] = [op.v, cur ? cur[1] : (op.st || 0)];
      const { r, c } = splitA1(op.a);
      sh.maxRow = Math.max(sh.maxRow, r); sh.maxCol = Math.max(sh.maxCol, c);
    } else if (op.k === 'colW') {
      // column width in Excel character units; null = Excel's default width
      sh.cols = sh.cols || [];
      sh.cols[op.c] = op.v === null || op.v === undefined ? null : Math.round(op.v * 100) / 100;
    } else if (op.k === 'rowH') {
      // row height in points; null = automatic
      sh.rows = sh.rows || {};
      if (op.v === null || op.v === undefined) delete sh.rows[op.r]; else sh.rows[op.r] = Math.round(op.v * 100) / 100;
    } else if (op.k === 'rowIns') {
      const cells = {};
      for (const [a, cv] of Object.entries(sh.cells)) cells[shiftAddr(a, op.r, 1)] = cv;
      if (op.cells) { for (const [col, cv] of Object.entries(op.cells)) cells[col + op.r] = cv.slice(); }
      else {
        const from = op.r - 1 >= 1 ? op.r - 1 : op.r + 1;
        for (let c = 1; c <= sh.maxCol; c++) { const src = sh.cells[A1(c, from)]; if (src && src[1]) cells[A1(c, op.r)] = [null, src[1]]; }
      }
      sh.cells = cells;
      sh.merges = sh.merges.map((m) => { const o = parseRange(m); if (o.r1 >= op.r) { o.r1++; o.r2++; } else if (o.r2 >= op.r) o.r2++; return rangeStr(o); });
      const rows = {};
      for (const [r, h] of Object.entries(sh.rows || {})) rows[+r >= op.r ? +r + 1 : +r] = h;
      if (op.h) rows[op.r] = op.h;
      sh.rows = rows;
      if (sh.images) sh.images = sh.images.map((im) => Object.assign({}, im, { a: shiftAddr(im.a, op.r, 1) }));
      sh.maxRow++;
    } else if (op.k === 'rowDel') {
      const cells = {};
      for (const [a, cv] of Object.entries(sh.cells)) { const p = splitA1(a); if (p.r === op.r) continue; cells[p.r > op.r ? A1(p.c, p.r - 1) : a] = cv; }
      const merges = [];
      for (const m of sh.merges) {
        const o = parseRange(m);
        if (o.r1 === op.r && o.r2 === op.r) continue;
        if (o.r1 === op.r && o.r2 > op.r) { const master = sh.cells[A1(o.c1, o.r1)]; if (master) cells[A1(o.c1, o.r1)] = master; o.r2--; }
        else if (o.r1 > op.r) { o.r1--; o.r2--; } else if (o.r2 >= op.r) o.r2--;
        if (o.r1 === o.r2 && o.c1 === o.c2) continue;
        merges.push(rangeStr(o));
      }
      sh.cells = cells; sh.merges = merges;
      const rows = {};
      for (const [r, h] of Object.entries(sh.rows || {})) { if (+r === op.r) continue; rows[+r > op.r ? +r - 1 : +r] = h; }
      sh.rows = rows;
      if (sh.images) sh.images = sh.images.filter((im) => splitA1(im.a).r !== op.r).map((im) => { const p = splitA1(im.a); return Object.assign({}, im, { a: p.r > op.r ? A1(p.c, p.r - 1) : im.a }); });
      sh.maxRow = Math.max(1, sh.maxRow - 1);
    }
    if (sh._mi) sh._mi = null;
    return model;
  }
  function replay(base, log, n) { const m = clone(base); const end = n === undefined ? log.length : n; for (let i = 0; i < end; i++) applyOp(m, log[i]); return m; }
  /** changedCells -> { sheet: Map(address now -> value it had at 'from') } */
  function changedCells(base, log, from, to) {
    let m = replay(base, log, from);
    const changed = {}, stash = {};
    const S = (s) => (changed[s] = changed[s] || new Map());
    const valAt = (model, s, a) => { const sh = model.sheets.find((x) => x.name === s); return sh && sh.cells && sh.cells[a] ? sh.cells[a][0] : null; };
    for (let i = from; i < to; i++) {
      const op = log[i];
      if (op.k === 'set') { const mp = S(op.s); if (!mp.has(op.a)) mp.set(op.a, valAt(m, op.s, op.a)); }
      else if (op.k === 'rowIns' || op.k === 'rowDel') {
        const mp = S(op.s), next = new Map();
        if (op.k === 'rowDel') {
          const sh = m.sheets.find((s) => s.name === op.s), keep = {};
          for (let c = 1; c <= (sh ? sh.maxCol : 0); c++) { const a = A1(c, op.r); keep[colLetters(c)] = mp.has(a) ? mp.get(a) : valAt(m, op.s, a); }
          stash[op.s + ':' + op.r] = keep;
        }
        for (const [a, old] of mp) { const p = splitA1(a); if (op.k === 'rowIns') next.set(p.r >= op.r ? A1(p.c, p.r + 1) : a, old); else if (p.r !== op.r) next.set(p.r > op.r ? A1(p.c, p.r - 1) : a, old); }
        if (op.k === 'rowIns') {
          const sh = m.sheets.find((s) => s.name === op.s);
          const back = op.cells ? stash[op.s + ':' + op.r] : null;
          for (let c = 1; c <= (sh ? sh.maxCol : 1); c++) next.set(A1(c, op.r), back ? (back[colLetters(c)] === undefined ? null : back[colLetters(c)]) : null);
        }
        changed[op.s] = next;
      } else if (op.k === 'import') {
        const before = m, after = applyOp(clone(m), op);
        for (const sh of after.sheets) {
          const old = before.sheets.find((s) => s.name === sh.name);
          const mp = S(sh.name);
          const keys = new Set([...Object.keys(sh.cells), ...(old && old.cells ? Object.keys(old.cells) : [])]);
          for (const a of keys) {
            const v1 = old && old.cells && old.cells[a] ? old.cells[a][0] : null, v2 = sh.cells[a] ? sh.cells[a][0] : null;
            if (txt(v1) !== txt(v2) && !mp.has(a)) mp.set(a, v1);
          }
        }
        m = after; continue;
      }
      applyOp(m, op);
    }
    for (const [s, mp] of Object.entries(changed)) for (const [a, old] of [...mp]) if (txt(old) === txt(valAt(m, s, a))) mp.delete(a);
    return changed;
  }

  /* ============================================================
     Compare two points of one file
     ============================================================ */
  function compareFiles(A, B, setup) {
    const anA = analyzeFile(A, setup), anB = analyzeFile(B, setup);
    const tA = totals(A, setup, anA), tB = totals(B, setup, anB);
    const sheets = [];
    const names = [...new Set([...A.sheets.map((s) => s.name), ...B.sheets.map((s) => s.name)])];
    for (const name of names) {
      const sa = A.sheets.find((s) => s.name === name), sb = B.sheets.find((s) => s.name === name);
      const ss = (setup && setup.sheets && setup.sheets[name]) || {};
      if (ss.ignore) continue;
      const res = { sheet: name, status: !sa ? 'added' : !sb ? 'removed' : 'same', cells: [], added: [], removed: [], changed: [] };
      if (sa && sb) {
        const keys = new Set([...Object.keys(sa.cells), ...Object.keys(sb.cells)]);
        for (const a of keys) {
          const v1 = sa.cells[a] ? sa.cells[a][0] : null, v2 = sb.cells[a] ? sb.cells[a][0] : null;
          if (txt(v1) !== txt(v2)) res.cells.push({ a, from: txt(v1), to: txt(v2) });
        }
        res.cells.sort((x, y) => splitA1(x.a).r - splitA1(y.a).r || splitA1(x.a).c - splitA1(y.a).c);
        if (ss.idCol) {
          const idc = colNum(ss.idCol);
          const rowsOf = (sh, an) => {
            const out = new Map(), seen = {};
            const a0 = an[name];
            for (const t of a0.tables) for (const r of t.rows) {
              const a = masterOf(sh, A1(idc, r)); if (splitA1(a).r !== r) continue;
              const id = txt(val(sh, idc, r)).trim(); if (!id || EMPTYISH.test(id)) continue;
              const k = squash(id); seen[k] = (seen[k] || 0) + 1;
              const vals = {}; for (let c = 1; c <= sh.maxCol; c++) { const v = txt(own(sh, c, r)).trim(); if (v) vals[c] = v; }
              out.set(seen[k] > 1 ? k + ' #' + seen[k] : k, { id, r, vals, names: t.names });
            }
            return out;
          };
          const ra = rowsOf(sa, anA), rb = rowsOf(sb, anB);
          for (const [k, x] of rb) if (!ra.has(k)) res.added.push(x);
          for (const [k, x] of ra) if (!rb.has(k)) res.removed.push(x);
          for (const [k, x] of rb) {
            const o = ra.get(k); if (!o) continue;
            const diffs = [];
            for (const c of new Set([...Object.keys(o.vals), ...Object.keys(x.vals)])) if ((o.vals[c] || '') !== (x.vals[c] || '')) diffs.push({ field: x.names[c] || colLetters(+c), from: o.vals[c] || '', to: x.vals[c] || '' });
            if (diffs.length) res.changed.push({ id: x.id, r: x.r, diffs });
          }
        }
      }
      sheets.push(res);
    }
    return { from: tA, to: tB, sheets };
  }

  const api = {
    colNum, colLetters, splitA1, A1, parseRange, rangeStr, txt, norm, squash, clone, hash, isNum,
    readWorkbook, writeWorkbook, addIssuesSheet, mergeIndex, masterOf,
    colorKey, colorHex, colorName, isRedKey, findLegend, colorsUsed, defaultColorSetup, colorMarks, cellIssueColor,
    analyzeSheet, analyzeFile, autoHeaderRows, colName, parseFtIn, RULES, runChecks, totals,
    applyOp, replay, changedCells, compareFiles,
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DesignEngine = api;
})(typeof window !== 'undefined' ? window : globalThis);
