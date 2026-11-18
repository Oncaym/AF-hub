# Carbon Skin demo — how it is built

`/carbon-skin/` is the public demo for the A' Design Award entry: the live tracker code
(`core/app.js`, `core/cloud-sync.js`) on a **fictional** project, plus the carbon layer.
Nothing in it is real project data.

| file | what | made by |
|---|---|---|
| index.html | cp2/index.html with the demo wiring | `_build/mkindex.py` |
| project-config.js | Foundry Yard C units, dates (relative to today), positions | `_build/mkconfig.py` |
| gf-plan.png / gf-plan-white.png | fictional ground-floor plan | `_build/plangen.py` (writes units.json for mkconfig) |
| elevations.js | fictional storefront bays, dxf2bay format | `_build/mkelev.py` |
| demo-sdk.js | Firebase SDK stand-in (from platform/tests/e2e/fake-firebase.js) | copied |
| demo-backend.js | the in-page database; every visitor is the demo editor; reload = fresh | hand-written |
| carbon.js / carbon.css | the carbon layer: KPI cards, Carbon lens, Tap to Book sheet, ledger | hand-written |

Re-run order after the tracker page changes: `plangen.py` → `mkconfig.py` → `mkelev.py` → `mkindex.py`
(the scripts use absolute paths from the build session; adjust `ROOT` paths before re-running).
