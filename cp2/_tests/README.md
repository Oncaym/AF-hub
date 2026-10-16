# _tests — verification harnesses

Plain Node + jsdom, no test framework. Each file slices the functions under test out of
the shared engine `../../core/app.js` (AF Hub, 2026-10-16: CP2 moved into the hub) and evals
them against CP2's real `../index.html` markup, so the assertions run
against the same DOM the browser gets.

    npm i jsdom          # once (or set JSDOM_DIR=/path/to/node_modules)
    node _tests/test-floors-types.cjs

| file | covers |
|---|---|
| `test-scope-kpi.cjs`      | F-041 Caulking / Face Cover KPI % + plan marker scope rings |
| `test-unit-drawings.cjs`  | F-042 per-unit shop drawing upload + GC view + openings sheet |
| `test-gc-view.cjs`        | F-043 GC mode hides the KPI banner + the Progress lens |
| `test-floors-types.cjs`   | F-044/F-045 floor split, state migration, IS diamonds, door types, floor moves |
| `test-unit-types.cjs`     | F-051 unit type registry |
| `test-submittal-items.cjs`| F-052 submittals in Things to Solve |
| `test-user-menu.cjs`      | F-047 mobile user menu |
| `test-bay-elevation.cjs`  | F-055/F-056/F-057 bay elevation panel, DXF-derived openings, elevation key on the plan, GC visibility switch |

`make-bay-preview.cjs` is not a test — it renders `preview-bay.html`, a standalone page
showing the bay elevation in GC dark / daylight / print / doors-hidden, plus the elevation
key drawn on the real floor plans with the real `state.json` coordinates. Open it in a
browser to eyeball F-055/F-056 without booting the app.

They cover deterministic logic only — visuals and Firebase behaviour still need a browser.
Not deployed (see `.vercelignore`).

## What jsdom cannot see (learned the hard way, 2026-08-26)

The F-056 elevation key shipped broken and passed the whole suite, twice over:

1. The harness stubbed `var editMode = false`. There **is no `editMode` global** — it is a
   local `const` inside `setupPlanInteractions()`. The stub invented it, so a handler that
   threw `ReferenceError` on every press looked fine here. **Never stub a global without
   grepping app.js to confirm it exists**; give the code the real DOM control instead
   (`#editPositionMode`), the way `test-bay-elevation.cjs` now does.
2. `#planViewport` calls `setPointerCapture()` on pointerdown so dragging pans the plan.
   Anything clickable on the plan must stop that event (every `.plan-marker` does). Without
   it the capture retargets mouseup to the viewport and **no click event is ever fired** —
   the tap silently does nothing. jsdom implements no pointer capture, so it cannot
   reproduce this; it is asserted structurally instead.

Both are now covered by mutation-checked assertions: revert either fix and
`test-bay-elevation.cjs` fails with a named message. If you add anything else clickable to
the plan, copy the `.plan-marker` handler set — `onpointerdown` stop, `onclick`, and read
edit mode from the checkbox — and verify a real click in a browser, not just here.
