"""Self-test for review.py: builds a small sheet set with known mistakes and checks each is reported.

    python design/review_selftest.py          (needs ezdxf; also runs inside Pyodide)

No project data: the drawing is made up here, so it can live in the public repository.
"""
import os, sys, tempfile
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import ezdxf
import review


def build(folder):
    doc = ezdxf.new('R2018', setup=True)
    # the team's blocks, by name: view title, callout bubble
    t = doc.blocks.new('DWG_TITLE')
    for i, tag in enumerate(['%%UTITLE', 'DET.', 'DWG.', '1:?', 'TITLE']):
        t.add_attdef(tag, (0, -0.2 * i), dxfattribs={'height': 0.125})
    c = doc.blocks.new('CALL OUT 3')
    c.add_circle((0, 0), 0.25)
    c.add_attdef('DWG.', (0, 0.05), dxfattribs={'height': 0.1})
    c.add_attdef('DET.', (0, -0.15), dxfattribs={'height': 0.1})

    def sheet(name, views, extra=None):
        lay = doc.layouts.new(name)
        lay.dxf.limmin = (0, 0); lay.dxf.limmax = (36, 24)
        for det, dwg, scale, title, (x, y), s in views:
            vp = lay.add_viewport(center=(x + 4, y + 2.5), size=(8, 3), view_center_point=(100, 100), view_height=3 * s)
            vp.dxf.status = 1
            ins = lay.add_blockref('DWG_TITLE', (x - 1, y))
            ins.add_auto_attribs({'%%UTITLE': title, 'DET.': det, 'DWG.': dwg, '1:?': scale, 'TITLE': ''})
        lay.add_mtext(name if name.startswith('AC3-') else 'AC3-' + name, dxfattribs={'char_height': 0.2, 'insert': (33, 1)}).text += '.00'
        if extra:
            extra(lay)
        return lay

    half = '1/2" = 1\'-0"'
    sheet('201', [('1', 'AC3-201', half, 'ELEVATION @ SF-01', (2, 14), 24),
                  ('2', 'AC3-201', half, 'PLAN 1 @ SF-01', (2, 8), 24)])

    def mistakes(lay):
        co = lay.add_blockref('CALL OUT 3', (20, 20))
        co.add_auto_attribs({'DWG.': 'AC3-201', 'DET.': '7'})          # no detail 7 on AC3-201
        co = lay.add_blockref('CALL OUT 3', (22, 20))
        co.add_auto_attribs({'DWG.': 'AC3-201', 'DET.': '2'})          # fine
        d = lay.add_linear_dim(base=(5, 3), p1=(3, 2), p2=(5, 2), override={'dimlfac': 24})
        d.dimension.dxf.text = '5\'-0"'                                  # measures 4'-0"
        d.render()
        lay.add_mtext('GL-01', dxfattribs={'char_height': 0.125, 'insert': (10, 10)})
        lay.add_mtext('GL-01', dxfattribs={'char_height': 0.125, 'insert': (12, 10)})
        lay.add_mtext('GL-1', dxfattribs={'char_height': 0.125, 'insert': (14, 10)})   # written another way
        lay.add_mtext('SEE DETAIL 2', dxfattribs={'char_height': 0.125, 'insert': (1.2, 14.05)})  # on a view title
        lay.add_mtext('OFF THE SHEET', dxfattribs={'char_height': 0.125, 'insert': (35.5, 12)})

    sheet('202', [('1', 'AC3-201', half, 'ELEVATION @ SF-02', (2, 14), 24),       # labelled with the wrong sheet
                  ('2', 'AC3-202', '3/4" = 1\'-0"', 'PLAN 1 @ SF-02', (2, 8), 24),  # scale says 3/4, drawn at 1/2
                  ('2', 'AC3-202', half, 'PLAN 2 @ SF-02', (2, 2), 24)], mistakes)  # detail 2 twice
    for e in doc.layouts.get('202').query('MTEXT'):
        if e.plain_text().startswith('AC3-202'):
            e.text = 'AC3-203.00'                                        # title block number
    path = os.path.join(folder, 'selftest.dxf')
    doc.saveas(path)
    return path


EXPECT = [
    ('✗', 'Title block says AC3-203, but this sheet is AC3-202'),
    ('✗', 'View 1 "ELEVATION @ SF-02" is labelled AC3-201'),
    ('✗', 'says 3/4" = 1\'-0", but its viewport is drawn at 1/2" = 1\'-0"'),
    ('✗', 'Detail number 2 is used 2 times'),
    ('✗', '7/AC3-201 points to detail 7 on AC3-201, which has no detail 7'),
    ('⚠', 'reads 5\'-0" but the line measures 4\'-0"'),
    ('⚠', '"SEE DETAIL 2"'),
    ('⚠', '"OFF THE SHEET" runs off the sheet'),
    ('⚠', 'GL-01 (×2) and GL-1 (×1)'),
]


def main():
    folder = tempfile.mkdtemp()
    text = review.run([build(folder)])
    ok = True
    for lvl, frag in EXPECT:
        hit = any(lvl in line and frag in line for line in text.splitlines())
        ok &= hit
        print(('ok    ' if hit else 'MISSED'), lvl, frag)
    sheet201 = text.split('AC3-201  (')[1].split('\n\n')[0] if 'AC3-201  (' in text else ''
    clean = not sheet201
    print(('ok    ' if clean else 'NOISE '), 'AC3-201 (no mistakes) reports nothing', sheet201[:200])
    ok &= clean
    print('review self-test:', 'passed' if ok else 'FAILED')
    if not ok:
        print(text)
    return ok


if __name__ == '__main__':
    sys.exit(0 if main() else 1)
