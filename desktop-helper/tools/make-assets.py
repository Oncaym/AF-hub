#!/usr/bin/env python3
"""Leona's pictures for the helper, from Leo's desktop-pet originals (1024x1024 PNG).
   python3 tools/make-assets.py <folder with pose-*.png>
Writes assets/pose-*.webp (480 px, small enough to ship), assets/poses.js (where her
body is in each picture: the only part that catches the mouse) and, from her face in
pose-idle, icon.png / icon.ico / tray.png."""
import sys, os
from PIL import Image

SRC = sys.argv[1]
HERE = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
OUT = os.path.join(HERE, 'assets')
os.makedirs(OUT, exist_ok=True)
POSES = ['idle', 'coffee', 'sleep', 'wave', 'draw', 'walk', 'walk2']
SIZE = 480
boxes = {}
for k in POSES:
    im = Image.open(os.path.join(SRC, 'pose-%s.png' % k)).convert('RGBA')
    W, H = im.size
    l, t, r, b = im.getchannel('A').point(lambda a: 255 if a > 40 else 0).getbbox()
    boxes[k] = dict(l=round(l / W, 3), t=round(t / H, 3), r=round(r / W, 3), b=round(b / H, 3))
    im.resize((SIZE, SIZE), Image.LANCZOS).save(os.path.join(OUT, 'pose-%s.webp' % k), 'WEBP', quality=90, method=6)
with open(os.path.join(OUT, 'poses.js'), 'w') as f:
    f.write('/* made by tools/make-assets.py: picture and body box (fractions of the picture) per pose */\n')
    f.write('window.POSES = {\n' + ''.join("  %s: { src: 'assets/pose-%s.webp', box: { l: %s, t: %s, r: %s, b: %s } },\n" % (k, k, v['l'], v['t'], v['r'], v['b']) for k, v in boxes.items()) + '};\n')

# icons: a square around her head, from the idle pose
if len(sys.argv) > 2:
    x, y, s = (int(v) for v in sys.argv[2].split(','))   # head square in the 1024 picture: left,top,size
    im = Image.open(os.path.join(SRC, 'pose-idle.png')).convert('RGBA').crop((x, y, x + s, y + s))
    im.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, 'icon.png'))
    im.resize((256, 256), Image.LANCZOS).save(os.path.join(HERE, 'icon.ico'), sizes=[(16, 16), (24, 24), (32, 32), (48, 48), (64, 64), (128, 128), (256, 256)])
    im.resize((32, 32), Image.LANCZOS).save(os.path.join(HERE, 'tray.png'))
print(boxes)
