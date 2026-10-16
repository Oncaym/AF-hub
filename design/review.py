"""Shop drawing review (no AI).

Drag one or more sheet DXFs (or the folder they are in) onto run_review.bat, or drop them on
the Design Board (Drawings → 🔍 Check DXF), which runs this same file in the browser. Every layout is a
sheet. All files are read together, so a callout on AC3-108 that points to AC3-504 is checked
against the 500 file when both are dropped. The result is written next to the first file as
"<name> - review.txt" and printed.

What it checks, per sheet:
  1. the sheet number in the title block matches the layout (AC3-108 on layout 108);
  2. every view title's sheet number is this sheet, and no detail number is used twice;
  3. the scale written under each view matches its viewport;
  4. every callout / section mark points to a sheet and a detail that exist;
  5. no dimension text was typed over (a number that is not what the dimension measures);
  6. text, notes, tags and dimension text that sit on top of each other, or off the sheet;
  7. material codes that look like typos (GL-1 next to GL-01, or used only once).
"""
import sys, os, re, glob, math, datetime
from collections import Counter, defaultdict
import ezdxf
from ezdxf import bbox

SHEET_RE = re.compile(r'^([A-Z]{1,4}\d{0,2}-)(\d{2,4}[A-Z]?)$')
TB_NO_RE = re.compile(r'^([A-Z]{1,4}\d{0,2}-\d{2,4}[A-Z]?)(?:\.(\d{1,2}))?$')     # AC3-108.01
CODE_RE = re.compile(r'^[A-Z]{1,3}-\d{1,3}[A-Z]?(?:\.\d)?$')                        # GL-01, EF-07, LV-A.4 is not
LEN_RE = re.compile(r"""(?:\d+'\s*-?\s*)?(?:\d+\s+\d+/\d+|\d+/\d+|\d+)"|\d+'""")      # 5'-2 1/2"  9"  3/4"  5'
CALLOUTS = ('CALL OUT 3', 'SYMBOL_SECTION', 'CALL OUT', 'SECTION')
SKIP_LAYOUTS = ('Model',)


# ---------------------------------------------------------------- helpers
# Copied from the layout tool (learn.py / textbox.py) so this file runs on its own:
# double-clicked with Python, or in the browser on the Design Board (Pyodide).
_SHEET_ANY = re.compile(r'^[A-Z]{1,4}\d{0,2}-\d{2,4}[A-Z]?$')   # AC3-107, AC3-107A, A-501


class LR:
    SHEET_RE = _SHEET_ANY

    @staticmethod
    def orig_name(doc, n):
        """Dynamic blocks are stored as *U123; the name the team picked is in the xdata."""
        if not n.startswith('*U'):
            return n
        try:
            for c, v in doc.block_records.get(n).get_xdata('AcDbBlockRepBTag'):
                if c == 1005:
                    return doc.entitydb.get(v).dxf.name
        except Exception:
            return n
        return n

    @staticmethod
    def viewports(lay):
        out = []
        for v in lay.query('VIEWPORT'):
            d = v.dxf
            if d.height <= 0:
                continue
            s = d.view_height / d.height
            cx = d.view_target_point.x + d.view_center_point.x
            cy = d.view_target_point.y + d.view_center_point.y
            if abs(s - 1) < 1e-6 and abs(cx - d.center.x) < 1e-3 and abs(cy - d.center.y) < 1e-3:
                continue   # the paper-space viewport itself
            out.append(dict(p=(d.center.x - d.width / 2, d.center.y - d.height / 2, d.center.x + d.width / 2, d.center.y + d.height / 2), s=s))
        return out

    @staticmethod
    def nearest_vp(vps, x, y):
        def dist(v):
            p = v['p']
            dx = max(p[0] - x, 0, x - p[2]); dy = max(p[1] - y, 0, y - p[3])
            return (dx * dx + dy * dy) ** 0.5
        return min(vps, key=dist)

    @staticmethod
    def split_atts(atts):
        """CALL OUT 3 / SYMBOL_SECTION keep the sheet and the number in either tag."""
        for tag, val in atts.items():
            if _SHEET_ANY.match(val.strip().upper()) or val.upper().startswith(('A', 'S')) and '-' in val and len(val) > 4:
                other = [t for t in atts if t != tag][0]
                return val, atts[other], tag
        return None, None, None


class TB:
    """Text extents without fonts (calibrated on the team's sheets: simplex, 0.64h per character)."""
    NARROW = set(' .,-#&:;\'"()/')

    @staticmethod
    def line_width(s, h):
        return sum((0.42 if ch in TB.NARROW else 0.6425) for ch in s) * h

    @staticmethod
    def text_size(content, h, wrap=0.0, spacing=1.0):
        from ezdxf.tools.text import plain_mtext
        lines = [l.replace('\t', '    ') for l in plain_mtext(content, split=True)]
        while lines and not lines[-1].strip():
            lines.pop()
        out = []
        for l in lines:
            if wrap and TB.line_width(l, h) > wrap:
                cur = ''
                for w in l.split(' '):
                    t = (cur + ' ' + w).strip()
                    if cur and TB.line_width(t, h) > wrap:
                        out.append(cur); cur = w
                    else:
                        cur = t
                out.append(cur)
            else:
                out.append(l)
        if not out:
            return 0.0, 0.0
        return max(TB.line_width(l, h) for l in out), 1.29 * h + (len(out) - 1) * 1.668 * h * spacing

    @staticmethod
    def box_at(x, y, attach, w, h):
        col = (attach - 1) % 3; row = (attach - 1) // 3
        x0 = x - (0, w / 2, w)[col]; y1 = y + (0, h / 2, h)[row]
        return (x0, y1 - h, x0 + w, y1)

    @staticmethod
    def mtext_box(e):
        c = e.text
        w, h = TB.text_size(c, e.dxf.char_height, 0.0, e.dxf.get('line_spacing_factor', 1.0))
        wrap = e.dxf.get('width', 0.0) or 0.0
        if wrap and w > wrap * 1.02:
            w, h = TB.text_size(c, e.dxf.char_height, wrap, e.dxf.get('line_spacing_factor', 1.0))
        ins = e.dxf.insert
        b = TB.box_at(ins.x, ins.y, e.dxf.get('attachment_point', 1), w, h)
        ang = e.get_rotation() if hasattr(e, 'get_rotation') else (e.dxf.get('rotation', 0) or 0)
        if abs(ang) % 360 < 0.5:
            return b
        c_, s_ = math.cos(math.radians(ang)), math.sin(math.radians(ang))
        pts = [(b[0], b[1]), (b[2], b[1]), (b[2], b[3]), (b[0], b[3])]
        rp = [(ins.x + (x - ins.x) * c_ - (y - ins.y) * s_, ins.y + (x - ins.x) * s_ + (y - ins.y) * c_) for x, y in pts]
        xs = [p[0] for p in rp]; ys = [p[1] for p in rp]
        return (min(xs), min(ys), max(xs), max(ys))

    @staticmethod
    def mleader_box(e):
        c = e.context; m = c.mtext
        if m is None:
            return None
        h = c.char_height * (c.scale or 1.0) if c.char_height else 0.125
        w, ht = TB.text_size(m.default_content, h, m.width if m.width and m.width > 0.5 else 0.0, m.line_spacing_factor or 1.0)
        return TB.box_at(m.insert.x, m.insert.y, m.alignment if m.alignment in range(1, 10) else 1, w, ht)

    @staticmethod
    def plain(e):
        from ezdxf.tools.text import plain_mtext
        m = e.context.mtext if e.dxftype() == 'MULTILEADER' else None
        c = m.default_content if m else getattr(e, 'text', '')
        return ' '.join(plain_mtext(c, split=True))


# ---------------------------------------------------------------- lengths
def inches(s):
    """5'-2 1/2"  2'-9"  13/4" (stacked 1 3/4)  1 1/2"  9"  -> inches, or None."""
    s = s.strip().replace('\u2019', "'").replace('\u201d', '"')
    m = re.match(r"^(?:(\d+)'\s*-?\s*)?(?:(\d+)(?:\s+(\d+)/(\d+))?|(\d+)/(\d+))?\s*\"?$", s)
    if not m or not any(m.groups()):
        return None
    ft, whole, n, d, n2, d2 = m.groups()
    v = float(ft or 0) * 12 + float(whole or 0)
    if n and d: v += float(n) / float(d)
    if n2 and d2: v += float(n2) / float(d2)
    return v


def scale_of(text):
    """'1/2" = 1'-0"' -> 24 (model inches per paper inch); '1'-0" = 1'-0"' -> 1; NTS -> None."""
    t = (text or '').upper().replace(' ', ' ').strip()
    if not t or 'N.T.S' in t or t in ('NTS', 'NONE'):
        return None
    if 'FULL' in t:
        return 1.0
    m = re.match(r'^1\s*:\s*(\d+(?:\.\d+)?)$', t)
    if m:
        return float(m.group(1))
    if '=' not in t:
        return None
    a, b = [x.strip() for x in t.split('=', 1)]
    pa, pb = inches(a), inches(b)
    return pb / pa if pa and pb else None


def mtext_raw_to_plain(raw):
    """Keep stacked fractions readable: \\S13/16; -> ' 13/16'."""
    raw = re.sub(r'\\S(\d+)[/#^](\d+);', r' \1/\2', raw or '')
    from ezdxf.tools.text import plain_mtext
    return ' '.join(plain_mtext(raw, split=True))


def fmt_in(v):
    neg = v < 0; v = abs(v)
    ft = int(v // 12); rest = v - ft * 12
    sixteenths = round(rest * 16)
    if sixteenths == 192: ft += 1; sixteenths = 0
    whole, frac = divmod(sixteenths, 16)
    fr = ''
    if frac:
        g = math.gcd(frac, 16); fr = f' {frac // g}/{16 // g}'
    s = (f"{ft}'-" if ft else '') + f'{whole}{fr}"'
    return ('-' if neg else '') + s


# ---------------------------------------------------------------- reading
def atts(e):
    return {a.dxf.tag: (a.dxf.text or '').strip() for a in e.attribs}


def read_sheets(paths):
    """-> list of sheets: dict(file, layout, sheet, doc, lay, titles, marks, tb_no)."""
    sheets = []
    for path in paths:
        doc = ezdxf.readfile(path)
        for lay in doc.layouts:
            if lay.name in SKIP_LAYOUTS or not len(lay):
                continue      # model space, and empty layouts
            s = dict(file=os.path.basename(path), layout=lay.name, doc=doc, lay=lay, titles=[], marks=[], tb_no=None)
            for e in lay.query('INSERT'):
                name = (LR.orig_name(doc, e.dxf.name) or e.dxf.name).upper()
                a = atts(e)
                if name == 'DWG_TITLE' or ('DET.' in a and '1:?' in a):
                    s['titles'].append(dict(det=a.get('DET.', ''), dwg=a.get('DWG.', '').upper(), scale=a.get('1:?', ''),
                                            title=' '.join(x for x in (a.get('%%UTITLE', ''), a.get('TITLE', '')) if x),
                                            x=e.dxf.insert.x, y=e.dxf.insert.y))
                elif name in CALLOUTS or (len(a) == 2 and LR.split_atts(a)[0]):
                    sh, num, _ = LR.split_atts(a)
                    if sh:
                        s['marks'].append(dict(kind=name, sheet=sh.upper(), num=(num or '').upper(), x=e.dxf.insert.x, y=e.dxf.insert.y))
            # title-block sheet number: the right-hand strip carries "AC3-108.01"
            lim0, lim1 = lay.dxf.get('limmin'), lay.dxf.get('limmax')
            for e in lay.query('MTEXT TEXT'):
                t = (e.plain_text() if e.dxftype() == 'MTEXT' else e.dxf.text or '').strip().upper()
                m = TB_NO_RE.match(t)
                if m and lim1 is not None and e.dxf.insert.x > lim1[0] - 5:
                    s['tb_no'] = (m.group(1), m.group(2))
            sheets.append(s)
    # sheet numbers: layout "108" means AC3-108 (prefix taken from the view titles)
    prefixes = Counter()
    for s in sheets:
        for t in s['titles']:
            m = SHEET_RE.match(t['dwg'])
            if m: prefixes[m.group(1)] += 1
    prefix = prefixes.most_common(1)[0][0] if prefixes else ''
    for s in sheets:
        L = s['layout'].upper().strip()
        s['sheet'] = L if SHEET_RE.match(L) else (prefix + L if re.match(r'^\d{2,4}[A-Z]?$', L) else L)
    return sheets, prefix


# ---------------------------------------------------------------- checks
def host_viewport(vps, t):
    """The viewport a view title sits under (titles are just below their view, a little to the left)."""
    best = None
    for v in vps:
        p = v['p']
        if t['y'] < p[1] + 0.05 and p[1] - t['y'] < 2.6 and p[0] - 3.5 < t['x'] < p[2]:
            d = p[1] - t['y']
            if best is None or d < best[0]:
                best = (d, v)
    return best[1] if best else None


def label_boxes(doc, e):
    out = []
    t = e.dxftype()
    try:
        if t == 'MTEXT':
            txt = e.plain_text().strip()
            if txt and txt not in ('\u2104',):    # the centreline glyph is meant to sit on lines
                out.append(('text', txt[:30], TB.mtext_box(e)))
        elif t == 'MULTILEADER':
            b = TB.mleader_box(e)
            if b: out.append(('note', TB.plain(e)[:30], b))
        elif t == 'DIMENSION':
            blk = doc.blocks.get(e.dxf.geometry)
            if blk:
                for ve in blk:
                    if ve.dxftype() == 'MTEXT':
                        # measured like the team's own text (ezdxf's MTEXT extents use the wrap width)
                        out.append(('dim', mtext_raw_to_plain(ve.text)[:30], TB.mtext_box(ve)))
                    elif ve.dxftype() == 'TEXT':
                        b = bbox.extents([ve])
                        if b.has_data:
                            out.append(('dim', (ve.dxf.text or '')[:30], (b.extmin.x, b.extmin.y, b.extmax.x, b.extmax.y)))
        elif t == 'INSERT':
            name = LR.orig_name(doc, e.dxf.name) or e.dxf.name
            if 'TITLE' in name.upper() and 'DWG' not in name.upper():
                return out          # the title block itself
            for a in e.attribs:
                if a.dxf.text.strip():
                    b = bbox.extents([a])
                    if b.has_data: out.append(('mark', a.dxf.text.strip()[:30], (b.extmin.x, b.extmin.y, b.extmax.x, b.extmax.y)))
    except Exception:
        pass
    return out


def overlap(a, b):
    w = min(a[2], b[2]) - max(a[0], b[0]); h = min(a[3], b[3]) - max(a[1], b[1])
    return w * h if w > 0 and h > 0 else 0.0


def area(a): return max(1e-6, (a[2] - a[0]) * (a[3] - a[1]))


def review(paths):
    sheets, prefix = read_sheets(paths)
    by_sheet = {s['sheet']: s for s in sheets}
    dets = {s['sheet']: {t['det'] for t in s['titles']} for s in sheets}
    issues = defaultdict(list)       # sheet -> [(level, text)]
    elsewhere = Counter()            # callout targets not in these files
    codes = Counter(); code_where = defaultdict(set)

    for s in sheets:
        S, doc, lay = s['sheet'], s['doc'], s['lay']
        add = lambda lvl, msg: issues[S].append((lvl, msg))
        # 1. title block number
        if s['tb_no'] and s['tb_no'][0] != S:
            add('✗', f'Title block says {s["tb_no"][0]}, but this sheet is {S}')
        # 2. view titles
        seen = Counter(t['det'] for t in s['titles'] if t['det'])
        for d, n in seen.items():
            if n > 1: add('✗', f'Detail number {d} is used {n} times on this sheet')
        for t in s['titles']:
            if t['dwg'] and t['dwg'] != S:
                add('✗', f'View {t["det"]} "{t["title"]}" is labelled {t["dwg"]}')
        # 3. scale
        vps = LR.viewports(lay)
        for t in s['titles']:
            want = scale_of(t['scale'])
            v = host_viewport(vps, t)
            if want and v and abs(v['s'] - want) / want > 0.02:
                add('✗', f'View {t["det"]} "{t["title"]}" says {t["scale"]}, but its viewport is drawn at {scale_text(v["s"])}')
            elif not t['scale']:
                add('⚠', f'View {t["det"]} "{t["title"]}" has no scale')
        # 4. callouts
        for m in s['marks']:
            num = m['num'].split('/')[0].strip()
            if m['sheet'] not in by_sheet:
                elsewhere[m['sheet']] += 1
            elif num and num not in dets.get(m['sheet'], set()):
                add('✗', f'{num}/{m["sheet"]} points to detail {num} on {m["sheet"]}, which has no detail {num}'
                         f' (it has {", ".join(sorted(dets[m["sheet"]], key=lambda x: (len(x), x))) or "none"})')
        # 5. dimensions typed over: the text is a number that is not what the line measures.
        #    A paper-space dimension measures through its viewport, so the viewport scale counts too.
        for d in lay.query('DIMENSION'):
            txt = (d.dxf.text or '').strip()
            if not txt or '<>' in txt:
                continue
            m = LEN_RE.search(mtext_raw_to_plain(txt))
            shown = inches(m.group(0)) if m else None
            try:
                raw = float(d.get_measurement())
                lf = abs(float(d.override().get('dimlfac', 1.0) or 1.0))
            except Exception:
                continue
            p = d.dxf.get('defpoint2') or d.dxf.get('defpoint')
            v = LR.nearest_vp(vps, p.x, p.y) if (vps and p is not None) else None
            cands = [raw, raw * lf] + ([raw * v['s']] if v else [])
            if shown is not None and all(abs(shown - c) > 1 / 16 + 1e-6 for c in cands):
                best = raw * v['s'] if v else raw * lf
                add('⚠', f'A dimension reads {mtext_raw_to_plain(txt)} but the line measures {fmt_in(best)} — typed over?')
        # 6. labels on top of each other, or off the sheet
        lim0, lim1 = lay.dxf.get('limmin'), lay.dxf.get('limmax')
        items = []
        for i, e in enumerate(lay):
            if e.dxftype() in ('MTEXT', 'MULTILEADER', 'DIMENSION', 'INSERT'):
                for k, txt, b in label_boxes(doc, e):
                    items.append((i, k, txt, b))
        if lim0 is not None and lim1 is not None:      # (0, 0) is a real corner, not "missing"
            for i, k, txt, b in items:
                if b[0] < lim0[0] - 0.05 or b[1] < lim0[1] - 0.05 or b[2] > lim1[0] + 0.05 or b[3] > lim1[1] + 0.05:
                    add('⚠', f'"{txt}" runs off the sheet')
        clashes = []
        for a in range(len(items)):
            ia, ka, ta, ba = items[a]
            for b in range(a + 1, len(items)):
                ib, kb, tb, bb = items[b]
                if ia == ib or (ka == kb == 'mark'):
                    continue
                if ta == tb and overlap(ba, bb) > 0.8 * min(area(ba), area(bb)):
                    continue      # the same note twice in one place (one text, two leaders)
                if overlap(ba, bb) > 0.30 * min(area(ba), area(bb)):
                    clashes.append(f'"{ta}" and "{tb}" overlap')
        for c in clashes:
            add('⚠', c)
        # 7. material codes
        for e in lay.query('MTEXT TEXT INSERT'):
            vals = [a for a in atts(e).values()] if e.dxftype() == 'INSERT' else [(e.plain_text() if e.dxftype() == 'MTEXT' else e.dxf.text or '')]
            for v in vals:
                v = v.strip().upper()
                # (GL-01 looks like a sheet number too; a sheet of this set never is a material)
                if CODE_RE.match(v) and v not in by_sheet and not (prefix and v.startswith(prefix)):
                    codes[v] += 1; code_where[v].add(S)

    # material codes that look like typos
    general = []
    norm = defaultdict(list)
    for c in codes:
        k = re.sub(r'-0*(\d)', r'-\1', c)
        norm[k].append(c)
    for k, cs in norm.items():
        if len(cs) > 1:
            general.append(('⚠', 'Material codes ' + ' and '.join(f'{c} (×{codes[c]})' for c in sorted(cs)) + ' — same thing written two ways?'))
    for c, n in codes.items():
        if n == 1 and sum(codes.values()) > 20:
            general.append(('⚠', f'Material code {c} appears only once (on {", ".join(sorted(code_where[c]))}) — typo?'))
    return sheets, issues, elsewhere, codes, general


def scale_text(s):
    if abs(s - 1) < 0.02: return "1'-0\" = 1'-0\""
    paper = 12 / s
    for whole in range(0, 13):
        for n, d in ((0, 1), (1, 8), (1, 4), (3, 8), (1, 2), (5, 8), (3, 4), (7, 8)):
            v = whole + n / d
            if v and abs(v - paper) < 0.01:
                f = (f'{whole} ' if whole else '') + (f'{n}/{d}' if n else '')
                return f'{f.strip()}" = 1\'-0"'
    return f'1:{s:g}'


def write(paths, sheets, issues, elsewhere, codes, general):
    out = []
    names = ', '.join(os.path.basename(p) for p in paths)
    out.append(f'Shop drawing review — {datetime.datetime.now():%Y-%m-%d %H:%M}')
    out.append(f'Files: {names}')
    out.append(f'Sheets: {len(sheets)} ({", ".join(s["sheet"] for s in sheets)})')
    nx = sum(1 for v in issues.values() for l, _ in v if l == '✗')
    nw = sum(1 for v in issues.values() for l, _ in v if l == '⚠') + len(general)
    out.append(f'✗ {nx} to fix · ⚠ {nw} to look at')
    out.append('')
    for s in sheets:
        lst = issues.get(s['sheet'], [])
        if not lst:
            continue
        out.append(f'{s["sheet"]}  ({s["file"]} · layout {s["layout"]})')
        for lvl, msg in sorted(lst, key=lambda x: x[0] != '✗'):
            out.append(f'  {lvl} {msg}')
        out.append('')
    if general:
        out.append('Whole set')
        out += [f'  {l} {m}' for l, m in general]
        out.append('')
    if elsewhere:
        out.append('Not checked (these sheets are not in the files you dropped): ' +
                   ', '.join(f'{k} ×{v}' for k, v in sorted(elsewhere.items())))
        out.append('  Drop those files too to check the callouts that point to them.')
    if codes:
        out.append('Material codes used: ' + ', '.join(f'{c} ×{n}' for c, n in sorted(codes.items())))
    if not nx and not nw:
        out.append('Nothing found.')
    return '\n'.join(out) + '\n'


def run(paths):
    """For the Design Board (Pyodide): the report for these DXF paths, as text."""
    return write(paths, *review(paths))


def main(args):
    try:   # a Windows console is not UTF-8 by default; never crash on a ✗
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass
    paths = []
    for a in args:
        if os.path.isdir(a):
            paths += sorted(glob.glob(os.path.join(a, '*.dxf')))
        elif a.lower().endswith('.dxf'):
            paths.append(a)
    if not paths:
        print('Drag one or more DXF files (or their folder) onto run_review.bat.')
        return 1
    print('Reading ' + ', '.join(os.path.basename(p) for p in paths) + ' ...')
    res = review(paths)
    text = write(paths, *res)
    target = os.path.splitext(paths[0])[0] + ' - review.txt'
    with open(target, 'w', encoding='utf-8-sig') as f:   # BOM: Notepad shows ✗ / ⚠ right
        f.write(text)
    print(text)
    print('Saved: ' + target)
    return 0


if __name__ == '__main__':
    sys.exit(main(sys.argv[1:]))
