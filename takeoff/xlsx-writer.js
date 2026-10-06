/* ============================================================
   xlsx-writer.js — a minimal, dependency-free .xlsx writer
   ------------------------------------------------------------
   Why hand-rolled instead of SheetJS: the takeoff tool is a static page with no build step and no
   third-party runtime deps, and the one thing it must never do is fail to produce a deliverable
   because a CDN was unreachable. An .xlsx is a ZIP of XML, and everything this tool needs — a few
   sheets, merges, column widths, a fixed palette of cell styles, numbers, text and formulas — is
   a couple of hundred lines. Entries are STORED (no compression): Excel, LibreOffice and Google
   Sheets all accept that, and it removes the only part that would have needed a real library.

   Usage:  window.makeXlsx([{ name, cols, merges, rows, freeze }]) -> Blob
     name   sheet name (invalid characters are stripped, 31-char cap, duplicates suffixed)
     cols   [{ w }]                      column widths, in Excel character units
     merges ['A1:I2', …]
     freeze 'A6'                         optional freeze-pane anchor
     rows   [ [cell, …], … ]             row-major; a hole is null/undefined
              cell = { v, s, f, h }
                v  value — string | number | boolean | null
                s  style id, see STYLE_* below
                f  formula, WITHOUT the leading '=' (v is then the cached value, may be omitted)
                h  row height in points (taken from the first cell that carries one)
   ============================================================ */
(function () {
  'use strict';

  // ---- style ids, in the order they are written into styles.xml ----
  const S = {
    DEFAULT: 0,
    TITLE: 1,        // 25pt bold, centred — the system name across the top
    LABEL: 2,        // bold left label (Date / Project Name / Elevation)
    HEAD: 3,         // grey header band, bold, centred, wrapped, boxed
    BANNER: 4,       // 13pt bold section banner, boxed
    BANNER_SM: 5,    // 12pt bold section banner, boxed
    TEXT: 6,         // boxed text, centred
    TEXT_L: 7,       // boxed text, left
    NUM2: 8,         // boxed number, 2 decimals
    INT: 9,          // boxed integer
    DATE: 10,        // m/d/yyyy
    RAW_HEAD: 11,    // bold, no fill — the audit block's header
    RAW: 12,         // plain, no border — audit block body
    RAW_WRAP: 13,    // plain, wrapped — the long Roles column
    NOTE: 14,        // small grey italic
  };

  const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' }[c]));
  const colName = i => { let s = ''; i++; while (i > 0) { const r = (i - 1) % 26; s = String.fromCharCode(65 + r) + s; i = (i - 1 - r) / 26; } return s; };

  // ---------- ZIP (stored) ----------
  const CRC_TABLE = (() => {
    const t = new Uint32Array(256);
    for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = (c & 1) ? (0xEDB88320 ^ (c >>> 1)) : (c >>> 1); t[n] = c >>> 0; }
    return t;
  })();
  function crc32(buf) {
    let c = 0xFFFFFFFF;
    for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xFF] ^ (c >>> 8);
    return (c ^ 0xFFFFFFFF) >>> 0;
  }
  function zip(files) {
    const enc = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const nameB = enc.encode(f.name), dataB = enc.encode(f.data), crc = crc32(dataB);
      const local = new Uint8Array(30 + nameB.length);
      const dv = new DataView(local.buffer);
      dv.setUint32(0, 0x04034b50, true); dv.setUint16(4, 20, true); dv.setUint16(6, 0, true);
      dv.setUint16(8, 0, true);                                  // stored
      dv.setUint16(10, 0, true); dv.setUint16(12, 0x21, true);   // fixed timestamp → byte-identical reruns
      dv.setUint32(14, crc, true); dv.setUint32(18, dataB.length, true); dv.setUint32(22, dataB.length, true);
      dv.setUint16(26, nameB.length, true); dv.setUint16(28, 0, true);
      local.set(nameB, 30);
      parts.push(local, dataB);

      const cen = new Uint8Array(46 + nameB.length);
      const cv = new DataView(cen.buffer);
      cv.setUint32(0, 0x02014b50, true); cv.setUint16(4, 20, true); cv.setUint16(6, 20, true);
      cv.setUint16(8, 0, true); cv.setUint16(10, 0, true);
      cv.setUint16(12, 0, true); cv.setUint16(14, 0x21, true);
      cv.setUint32(16, crc, true); cv.setUint32(20, dataB.length, true); cv.setUint32(24, dataB.length, true);
      cv.setUint16(28, nameB.length, true);
      cv.setUint32(42, offset, true);
      cen.set(nameB, 46);
      central.push(cen);
      offset += local.length + dataB.length;
    }
    const cenSize = central.reduce((a, c) => a + c.length, 0);
    const end = new Uint8Array(22);
    const ev = new DataView(end.buffer);
    ev.setUint32(0, 0x06054b50, true);
    ev.setUint16(8, files.length, true); ev.setUint16(10, files.length, true);
    ev.setUint32(12, cenSize, true); ev.setUint32(16, offset, true);
    return new Blob([...parts, ...central, end], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  }

  // ---------- fixed parts ----------
  const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="2"><numFmt numFmtId="164" formatCode="0.00"/><numFmt numFmtId="165" formatCode="m/d/yyyy"/></numFmts>
<fonts count="7">
<font><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="25"/><name val="Calibri"/></font>
<font><b/><sz val="11"/><name val="Calibri"/></font>
<font><b/><sz val="13"/><name val="Calibri"/></font>
<font><b/><sz val="12"/><name val="Calibri"/></font>
<font><i/><sz val="9"/><color rgb="FF808080"/><name val="Calibri"/></font>
<font><sz val="10"/><name val="Calibri"/></font>
</fonts>
<fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill>
<fill><patternFill patternType="solid"><fgColor rgb="FFA5A5A5"/><bgColor indexed="64"/></patternFill></fill></fills>
<borders count="2"><border><left/><right/><top/><bottom/><diagonal/></border>
<border><left style="thin"/><right style="thin"/><top style="thin"/><bottom style="thin"/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="15">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="0" fontId="2" fillId="2" borderId="1" xfId="0" applyFont="1" applyFill="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="3" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="4" fillId="0" borderId="1" xfId="0" applyFont="1" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center" wrapText="1"/></xf>
<xf numFmtId="0" fontId="0" fillId="0" borderId="1" xfId="0" applyBorder="1" applyAlignment="1"><alignment horizontal="left" vertical="center" wrapText="1"/></xf>
<xf numFmtId="164" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="1" fontId="0" fillId="0" borderId="1" xfId="0" applyNumberFormat="1" applyBorder="1" applyAlignment="1"><alignment horizontal="center" vertical="center"/></xf>
<xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="center"/></xf>
<xf numFmtId="0" fontId="6" fillId="0" borderId="0" xfId="0" applyFont="1" applyAlignment="1"><alignment vertical="top" wrapText="1"/></xf>
<xf numFmtId="0" fontId="5" fillId="0" borderId="0" xfId="0" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

  // Element order inside <worksheet> is fixed by the schema — sheetPr, sheetViews, cols,
  // sheetData, mergeCells, pageMargins, pageSetup. LibreOffice forgives a wrong order; Excel
  // reports the file as corrupt and offers to repair it, so this follows the schema exactly.
  function sheetXml(sh) {
    let out = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
      '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
      '<sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>';
    if (sh.freeze) {
      const m = /^([A-Z]+)(\d+)$/.exec(sh.freeze);
      if (m) out += `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${+m[2] - 1}" topLeftCell="${sh.freeze}" activePane="bottomLeft" state="frozen"/><selection pane="bottomLeft"/></sheetView></sheetViews>`;
    }
    if (sh.cols && sh.cols.length) {
      out += '<cols>' + sh.cols.map((c, i) =>
        `<col min="${i + 1}" max="${i + 1}" width="${(c && c.w) || 10}" customWidth="1"/>`).join('') + '</cols>';
    }
    out += '<sheetData>';
    (sh.rows || []).forEach((row, r) => {
      if (!row || !row.length) return;
      const ht = row.find(c => c && c.h);
      out += `<row r="${r + 1}"${ht ? ` ht="${ht.h}" customHeight="1"` : ''}>`;
      row.forEach((c, i) => {
        if (c == null) return;
        const ref = colName(i) + (r + 1), st = c.s ? ` s="${c.s}"` : '';
        if (c.f != null) {
          const cached = typeof c.v === 'number' ? `<v>${c.v}</v>` : '';
          out += `<c r="${ref}"${st}><f>${esc(c.f)}</f>${cached}</c>`;
        } else if (typeof c.v === 'number' && isFinite(c.v)) {
          out += `<c r="${ref}"${st}><v>${c.v}</v></c>`;
        } else if (typeof c.v === 'boolean') {
          out += `<c r="${ref}"${st} t="b"><v>${c.v ? 1 : 0}</v></c>`;
        } else if (c.v != null && c.v !== '') {
          out += `<c r="${ref}"${st} t="inlineStr"><is><t xml:space="preserve">${esc(c.v)}</t></is></c>`;
        } else if (c.s) {
          out += `<c r="${ref}"${st}/>`;
        }
      });
      out += '</row>';
    });
    out += '</sheetData>';
    if (sh.merges && sh.merges.length)
      out += `<mergeCells count="${sh.merges.length}">` + sh.merges.map(m => `<mergeCell ref="${m}"/>`).join('') + '</mergeCells>';
    out += '<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/>';
    out += '<pageSetup orientation="landscape" fitToWidth="1" fitToHeight="0" paperSize="1"/>';
    return out + '</worksheet>';
  }

  // Excel forbids : \ / ? * [ ] in a sheet name, caps it at 31 chars, and rejects duplicates.
  function safeNames(sheets) {
    const seen = new Set();
    return sheets.map((sh, i) => {
      let n = String(sh.name || ('Sheet' + (i + 1))).replace(/[:\\/?*[\]]/g, '-').slice(0, 31) || ('Sheet' + (i + 1));
      let base = n, k = 2;
      while (seen.has(n.toLowerCase())) { const suf = '(' + k++ + ')'; n = base.slice(0, 31 - suf.length) + suf; }
      seen.add(n.toLowerCase());
      return n;
    });
  }

  window.makeXlsx = function makeXlsx(sheets) {
    const names = safeNames(sheets);
    const files = [
      { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">' +
        '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>' +
        '<Default Extension="xml" ContentType="application/xml"/>' +
        '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>' +
        '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>' +
        sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('') +
        '</Types>' },
      { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        '<Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>' +
        '</Relationships>' },
      { name: 'xl/workbook.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>' +
        names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('') +
        '</sheets></workbook>' },
      { name: 'xl/_rels/workbook.xml.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">' +
        sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('') +
        `<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/>` +
        '</Relationships>' },
      { name: 'xl/styles.xml', data: STYLES },
    ];
    sheets.forEach((sh, i) => files.push({ name: `xl/worksheets/sheet${i + 1}.xml`, data: sheetXml(sh) }));
    return zip(files);
  };
  window.XLSX_STYLE = S;
})();
