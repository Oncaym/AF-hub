#!/usr/bin/env python3
"""carbon-skin/index.html = cp2/index.html (the live tracker page) with the demo's
wiring: an in-page backend instead of Firebase, the demo project's plan, the CP2-only
scopes (louver, caulking, beauty cap, glass, second floor) taken out, and the carbon
layer added. Re-run after the tracker page changes."""
import re
src = open("/home/claude/af-hub/cp2/index.html", encoding="utf-8").read()
s = src

def rep(a, b, count=1):
    global s
    n = s.count(a)
    assert n >= 1, ("missing", a[:80])
    if count == 1:
        assert n == 1, ("not unique", a[:80], n)
    s = s.replace(a, b)

def cut(pattern, flags=re.S):
    global s
    s2, n = re.subn(pattern, "", s, flags=flags)
    assert n >= 1, ("cut missing", pattern[:80])
    s = s2

rep("<title>Cooper Park 2 — Installation Progress Monitor (Cloud)</title>",
    "<title>Carbon Skin — Foundry Yard C (demo)</title>\n"
    "<meta name=\"description\" content=\"Carbon Skin: facade installation tracker with an embodied-carbon ledger. Public demo on a fictional project.\">\n"
    "<link rel=\"stylesheet\" href=\"carbon.css?v=1\">")
rep("""<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-app-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-auth-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-database-compat.js"></script>
<script src="https://www.gstatic.com/firebasejs/10.12.0/firebase-storage-compat.js"></script>
<script src="firebase-config.js?v=20261016a"></script>
<script src="project-config.js?v=20260805b"></script>""",
"""<!-- Carbon Skin demo: no Firebase. demo-sdk.js stands in for the SDK and
     demo-backend.js keeps the data in this page (see their headers). -->
<script src="demo-sdk.js?v=1"></script>
<script src="demo-backend.js?v=1"></script>
<script src="firebase-config.js?v=1"></script>
<script src="project-config.js?v=1"></script>""")

# header
rep(">Cooper Park 2 — Installation Progress Monitor</h1>", ">Foundry Yard C — Installation &amp; Carbon</h1>")
rep(">Broadway Builders</p>", ">Demo project · fictional data</p>")
cut(r'\s*<a class="btn" href="chat\.html"[^>]*>.*?</a>')
cut(r'\s*<a class="btn" href="warehouse\.html"[^>]*>.*?</a>')
cut(r'\s*<button class="btn" type="button" onclick="openDrawings\(\)"[^>]*>.*?</button>')

# KPI cards that only CP2 has
for kid in ("kpi-louvers", "kpi-caulk", "kpi-beautycap", "kpi-glass-installed"):
    cut(r'\s*<div class="kpi-card[^"]*"[^>]*>\s*<div class="kpi-label"[^>]*>[^<]*</div>\s*<div class="kpi-value" id="' + kid + r'"[^>]*>.*?</div>\s*<div class="kpi-sub"[^>]*>[^<]*</div>\s*</div>')

# plan image + floors
rep('src="gf-plan-white.png" data-plan-light="gf-plan.png" data-plan-dark="gf-plan-white.png" alt="Cooper Park 2 — Ground Floor Plan (from DXF)"',
    'src="gf-plan-white.png" data-plan-light="gf-plan.png" data-plan-dark="gf-plan-white.png" alt="Foundry Yard C — Ground Floor Plan"')
cut(r'\s*<button class="level-btn" data-level="L2"[^>]*>Level 2</button>')
cut(r'\s*<div class="tab" data-zone="L2"[^>]*>.*?</div>')

# legend entries for scopes the demo does not have
for key in ("legend_louver", "legend_interior_sf", "legend_int_door", "legend_fire_door", "legend_caulk", "legend_beautycap"):
    cut(r'\s*<div class="legend-item"[^>]*>(?:(?!</div>).)*data-i18n="' + key + r'"[^>]*>[^<]*</span>\s*</div>')

# CP2-only plan tools
for bid in ("glassMapBtn", "doorModeBtn", "glassBatchBtn", "hideSfBtn"):
    cut(r'\s*<button class="btn" id="' + bid + r'"[^>]*>.*?</button>')


# CP2's glass charts: kept in the page (renderGlassChart expects the canvas) but hidden
rep("""  <!-- Glass Status Breakdown -->
  <div class="section" data-gc-hide>""", """  <!-- Glass Status Breakdown (CP2 scope; hidden in the demo) -->
  <div class="section" data-gc-hide style="display:none">""")
rep('<button id="glassFlipBtn" class="btn glass-flip-btn"', '<button id="glassFlipBtn" style="display:none" class="btn glass-flip-btn"')

# trend legend: only the series the demo has
cut(r'\s*<div class="legend-item"[^>]*><span class="status-dot" style="background:var\(--purple\)"[^>]*></span><span data-i18n="cat_louver"[^>]*>Louver</span></div>')
cut(r'\s*<div class="legend-item"[^>]*><span class="status-dot" style="background:var\(--orange\)"[^>]*></span><span data-i18n="cat_caulking"[^>]*>Caulking</span></div>')

# scripts at the end: no fab drawings, no hub report; add the carbon layer
rep('<script src="elevations.js?v=20260826a"></script>', '<script src="elevations.js?v=1"></script>')
cut(r'\s*<script src="\.\./core/fab\.js[^"]*"></script>')
cut(r'\s*<!-- F-059 \(2026-09-17\).*?-->')
cut(r'\s*<script src="\.\./af-hub-config\.js"></script>')
cut(r'\s*<script src="\.\./hub-report\.js[^"]*"></script>')
rep('<!-- boot handled inside app.js (core) -->',
    '<!-- boot handled inside app.js (core) -->\n<script src="carbon.js?v=1"></script>')
s = s.replace("Cooper Park 2", "Foundry Yard C")
# comments carry people's and the company's names: neutral wording in the demo copy
def _clean(m):
    c = m.group(0)
    c = re.sub(r"\(Leo,?\s*", "(", c); c = re.sub(r"\bLeo\b", "PM", c)
    c = re.sub(r"AF [Hh]ub", "the hub", c)
    return c
s = re.sub(r"/\*.*?\*/", _clean, s, flags=re.S)
s = re.sub(r"<!--.*?-->", _clean, s, flags=re.S)
assert "Broadway" not in s and "gstatic.com/firebasejs" not in s
open("/home/claude/af-hub/carbon-skin/index.html", "w", encoding="utf-8").write(s)
print("index.html", len(s))
