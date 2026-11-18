#!/usr/bin/env python3
"""Fictional ground-floor plan for the Carbon Skin demo project (Foundry Yard C).
Nothing here is taken from a real drawing. Writes:
  gf-plan.png        black linework on transparent (day theme / print)
  gf-plan-white.png  white linework on transparent (night theme)
  units.json         every facade unit: id, type, face, width/height (m), marker x/y (% of image)
"""
import json, math
from PIL import Image, ImageDraw, ImageFont

W, H, SS = 3200, 1800, 2
BW, BH = 64.0, 34.0                      # building, metres
S = 38.0                                 # px per metre (before supersample)
OX = (W - BW * S) / 2
OY = (H - BH * S) / 2 + 10

def P(x, y):                             # metres -> supersampled px
    return ((OX + x * S) * SS, (OY + y * S) * SS)

img = Image.new("L", (W * SS, H * SS), 0)          # draw as alpha mask
d = ImageDraw.Draw(img)
F = lambda px: ImageFont.truetype("/usr/share/fonts/opentype/inter/Inter-Medium.otf", int(px * SS))

def line(a, b, w=1.0, v=255):
    d.line([P(*a), P(*b)], fill=v, width=max(1, int(w * SS)))
def rect(x0, y0, x1, y1, w=1.0, v=255, fill=None):
    d.rectangle([P(x0, y0), P(x1, y1)], outline=v, width=max(1, int(w * SS)), fill=fill)
def wall(a, b, t=0.30, v=255):           # a solid wall of thickness t (m)
    (x0, y0), (x1, y1) = a, b
    if abs(x1 - x0) > abs(y1 - y0):
        d.rectangle([P(min(x0, x1), y0 - t / 2), P(max(x0, x1), y0 + t / 2)], fill=v)
    else:
        d.rectangle([P(x0 - t / 2, min(y0, y1)), P(x0 + t / 2, max(y0, y1))], fill=v)
def arc_door(cx, cy, r, start, end, hinge_line=None):
    x, y = P(cx, cy); R = r * S * SS
    d.arc([x - R, y - R, x + R, y + R], start, end, fill=150, width=max(1, int(1.2 * SS)))
    if hinge_line:
        line((cx, cy), hinge_line, 1.6, 200)
def text(x, y, s, px=22, v=200, anchor="mm"):
    d.text(P(x, y), s, fill=v, font=F(px), anchor=anchor)

# ── storefront glazing (thin double line with mullion ticks) ─────────────
def glazing(a, b, n):
    (x0, y0), (x1, y1) = a, b
    horiz = abs(y1 - y0) < 1e-6
    off = 0.09
    if horiz:
        line((x0, y0 - off), (x1, y1 - off), 1.4); line((x0, y0 + off), (x1, y1 + off), 1.4)
        for k in range(n + 1):
            x = x0 + (x1 - x0) * k / n
            rect(x - 0.12, y0 - 0.16, x + 0.12, y0 + 0.16, 1, 255, 255)
    else:
        line((x0 - off, y0), (x1 - off, y1), 1.4); line((x0 + off, y0), (x1 + off, y1), 1.4)
        for k in range(n + 1):
            y = y0 + (y1 - y0) * k / n
            rect(x0 - 0.16, y - 0.12, x0 + 0.16, y + 0.12, 1, 255, 255)

# ── shell ────────────────────────────────────────────────────────────────
# north frontage: storefront 0-28 and 36-64, recessed entry 28-36 (2 m deep)
glazing((0, 0), (28, 0), 14)
glazing((36, 0), (64, 0), 14)
glazing((28.8, 2.0), (35.2, 2.0), 4)                 # entry storefront (doors drawn below)
wall((28, 0), (28, 2.0)); wall((36, 0), (36, 2.0))
# west: storefront 0-12, solid 12-34 with a side door
glazing((0, 0), (0, 12), 6)
wall((0, 12), (0, 34), 0.35)
# east: storefront 0-14, metal panel wall 14-26, notch for the loading dock 26-34
glazing((64, 0), (64, 14), 7)
wall((64, 14), (64, 26), 0.35)
wall((64, 26), (52, 26), 0.35); wall((52, 26), (52, 34), 0.35)
# south: metal panel rainscreen 0-52
wall((0, 34), (52, 34), 0.35)
# rainscreen line outboard of the south and east-solid walls
for a, b in [((0, 34.42), (52, 34.42)), ((64.42, 14), (64.42, 26))]:
    line(a, b, 1.0, 170)

# ── column grid ──────────────────────────────────────────────────────────
GX = [0, 8, 16, 24, 32, 40, 48, 56, 64]
GY = [0, 8.5, 17, 25.5, 34]
for i, x in enumerate(GX):
    line((x, -3.2), (x, 37.2), 0.7, 70)
    cx, cy = P(x, -4.3); R = 0.85 * S * SS
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=190, width=int(1.4 * SS))
    text(x, -4.3, str(i + 1), 24, 210)
for j, y in enumerate(GY):
    line((-3.2, y), (67.2, y), 0.7, 70)
    cx, cy = P(-4.3, y); R = 0.85 * S * SS
    d.ellipse([cx - R, cy - R, cx + R, cy + R], outline=190, width=int(1.4 * SS))
    text(-4.3, y, "ABCDE"[j], 24, 210)
for x in GX:
    for y in GY:
        if (x > 52 and y > 26) or (x in (0, 64) or y in (0, 34)):
            continue
        rect(x - 0.3, y - 0.3, x + 0.3, y + 0.3, 1, 200, 200)

# ── interior: retail units along the frontage, back of house to the south ──
for x in (12, 20, 44, 52):
    wall((x, 0.3), (x, 14), 0.13, 175)
wall((0.2, 14), (28, 14), 0.13, 175); wall((36, 14), (63.8, 14), 0.13, 175)
wall((28, 2.0), (28, 14), 0.13, 175); wall((36, 2.0), (36, 14), 0.13, 175)
# corridor south side
wall((0.2, 16.4), (24, 16.4), 0.13, 175); wall((40, 16.4), (63.8, 16.4), 0.13, 175)
# core: stairs, lifts, restrooms
rect(24, 16.4, 40, 30, 1.4, 200)
for k in range(13):                                   # stair A treads
    line((24.3, 17.0 + k * 0.42), (27.6, 17.0 + k * 0.42), 0.8, 160)
line((25.95, 17.0), (25.95, 22.0), 0.8, 160)
for k in range(13):                                   # stair B treads
    line((36.4, 17.0 + k * 0.42), (39.7, 17.0 + k * 0.42), 0.8, 160)
line((38.05, 17.0), (38.05, 22.0), 0.8, 160)
for x0 in (29.0, 31.6, 34.2):                        # three lifts with the usual cross
    rect(x0, 17.0, x0 + 2.2, 19.6, 1.2, 230)
    line((x0, 17.0), (x0 + 2.2, 19.6), 0.8, 130); line((x0 + 2.2, 17.0), (x0, 19.6), 0.8, 130)
wall((24, 23.0), (40, 23.0), 0.13, 175)
wall((32, 23.0), (32, 30), 0.13, 175)
for k in range(4):                                    # restroom fixtures
    rect(24.6 + k * 1.6, 28.6, 25.6 + k * 1.6, 29.6, 0.8, 150)
    rect(32.6 + k * 1.6, 28.6, 33.6 + k * 1.6, 29.6, 0.8, 150)
# back of house rooms
wall((10, 16.4), (10, 33.8), 0.13, 175); wall((18, 16.4), (18, 33.8), 0.13, 175)
wall((46, 16.4), (46, 25.8), 0.13, 175)
wall((0.2, 25.5), (10, 25.5), 0.13, 175)
# loading dock and its overhead door
rect(52.6, 26.6, 63.4, 33.6, 0.9, 120)
for k in range(6):
    line((53 + k * 1.8, 34.0), (53 + k * 1.8, 33.2), 0.9, 140)
# entry vestibule doors and inner doors
arc_door(30.6, 2.0, 1.6, 0, 90, (32.2, 2.0)); arc_door(33.4, 2.0, 1.6, 90, 180, (31.8, 2.0))
for x in (5.5, 15.5, 47.5, 57.5):                     # shop doors to the corridor
    arc_door(x, 14.0, 1.0, 0, 90, (x + 1.0, 14.0))
arc_door(0.0, 21.0, 1.1, 270, 360, (1.1, 21.0))       # west side door
arc_door(14.0, 16.4, 1.0, 0, 90, (15.0, 16.4)); arc_door(50.0, 16.4, 1.0, 0, 90, (51.0, 16.4))

# ── room names (thin, like a CAD plan) ───────────────────────────────────
for x, y, s in [(6, 7, "RETAIL 101"), (16, 7, "RETAIL 102"), (24, 7, "RETAIL 103"),
                (32, 8, "LOBBY"), (40, 7, "RETAIL 104"), (48, 7, "CAFE 105"), (58, 7, "RETAIL 106"),
                (5, 21, "MAIL"), (5, 30, "BIKE"), (14, 25, "TRASH"), (21, 25, "MECH."),
                (32, 15.2, "CORRIDOR"), (52, 21, "STORAGE"), (58, 30, "LOADING")]:
    text(x, y, s, 20, 150)

# ── units: the facade elements the crews install ─────────────────────────
U = []
def unit(uid, typ, face, x, y, w, h):
    U.append({"id": uid, "type": typ, "face": face, "w": round(w, 2), "h": round(h, 2),
              "x": round((OX + x * S) / W * 100, 2), "y": round((OY + y * S) / H * 100, 2)})
n = 1
for k in range(14):                                   # north storefront, 4 m units
    x = (k * 4 + 2) if k < 7 else (36 + (k - 7) * 4 + 2)
    unit(f"SF{n:02d}", "Storefront", "North", x, -1.0, 4.0, 4.6); n += 1
for k in range(3):                                    # west storefront
    unit(f"SF{n:02d}", "Storefront", "West", -1.0, 2 + k * 4, 4.0, 4.6); n += 1
for k in range(3):                                    # east storefront
    unit(f"SF{n:02d}", "Storefront", "East", 65.0, 2.3 + k * 4.7, 4.7, 4.6); n += 1
unit("SD01", "Door", "North", 32.0, 3.0, 6.4, 3.0)
unit("SD02", "Door", "West", -1.0, 21.0, 1.1, 2.4)
for k in range(7):                                    # south metal panel rainscreen
    unit(f"MP{k + 1:02d}", "Metal Panel", "South", 3.7 + k * 7.4, 35.3, 7.4, 4.6)
for k in range(2):                                    # east metal panel
    unit(f"MP{k + 8:02d}", "Metal Panel", "East", 65.3, 17 + k * 6, 6.0, 4.6)

def export(path, rgb):
    a = img.resize((W, H), Image.LANCZOS)
    out = Image.new("RGBA", (W, H), rgb + (0,))
    out.putalpha(a)
    out.save(path, optimize=True)
export("gf-plan.png", (0, 0, 0))
export("gf-plan-white.png", (255, 255, 255))
json.dump(U, open("units.json", "w"), indent=1)
print(len(U), "units")
