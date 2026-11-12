# P7 tracker — piece generator

Rebuilds `../project-config.js` and `../img/*.png` from the Final Design-2 PDFs.
Written 2026-11-12 (Claude + Leo). Python 3 with `pymupdf` and `pillow`.

```
set P7_KB_PDF=...\A37811_DU2C ... .pdf      (Kingsbridge, 117 pp)
set P7_S167_PDF=...\A37811_DU1C ... .pdf    (167th St, 75 pp)
python gen_all.py        -> p7v2/  (sheet images + p7data.json)
python gen_config.py     -> ../project-config.js + ../img/
```

| file | what it does |
|---|---|
| `elev.py` | vector helpers: quads by stroke width, black H/V segments, tags |
| `build_elev.py` | one KB elevation → frames, glass / louver / panel cells, bands, CP |
| `gen_kb.py` | KB elevations (KGS-A-421/423/424) + manual zones (OVR) + 8' corner pieces |
| `seam2.py`, `dlo.py` | standing-seam hatch → roof sf / panel count; misc segment helpers |
| `gen_all.py` | everything: KB + 167 (manual grid from 167-A-201/202/415/416), roofs (KGS-A-150/151, 167-A-412/413), key plans (KGS-A-103, 167-A-111) |
| `gen_config.py` | p7data.json → project-config.js (seedUnits, p7geo, p7nav, p7hot) |

Page numbers and clip boxes are hard-coded for the Final-2 sets. A new drawing set
means re-checking them. Unit keys must stay the same once the cloud has data:
renaming a piece is done through `id`, not `key`.
