# AF Hub — Executive Overview

One hub. Each team's tracker does exactly one extra thing: push four numbers.
**No tracker UI changes.**

Live: https://af-hub-two.vercel.app/

```
af-hub/
├── index.html                    Executive overview (iPad portrait first, dark/light)
├── hub-report.js                 Reporter — copied into every tracker
├── af-hub-config.js              Hub Firebase config (same file in every tracker)
├── firebase-database-rules.json  Security rules
└── README.md
```

---

## The contract

| Field | Meaning |
|---|---|
| `done` / `total` | Installed / total. Unit is each project's own (openings, pieces, linear ft) |
| `weekRate` / `prevWeekRate` / `avg4w` | This week / last week / 4-week mean |
| `openDamage` | Unresolved damage events (step 2 — currently always 0) |
| `pendingCO` | Change orders awaiting a decision (same) |
| `breakdown` | **Optional.** `[{scope, done, total, qtyDone, qtyTotal, unit}]`, biggest first |

A scope is **unit class × sub-scope** — `Storefront · exterior — Glass`,
`Door · fire-rated`. The hub renders each as a card grouped by the part before the
separator, the same shape as a tracker's own top banner.

Where a sub-scope's numbers come from differs by project, and the rules read both:

| Sub-scope | AC3 | Cooper Park 2 | Lexington |
|---|---|---|---|
| Frame / Door | `u.scopes.frame`, else `u.status` | same | the unit itself |
| Glass | elevation elements | `u.glassPanels[]` | — |
| Metal Panel / Louver | elevation elements | louver only, from `u.louver` | — |

AC3's M3 moved glass onto elevation elements; CP2 kept it on the unit. **CP2 has no
`window.ELEVATIONS` at all** (its `elevations.js` defines `ELEV_BAYS`, the F-055 bay
drawing, which is a different thing), so CP2 has no metal-panel count anywhere —
`metal-panel` exists there only as a log category. Caulking and beauty cap are
excluded everywhere: crew workflow, not scope.
| `pct` | **Optional.** The project's percentage. Use this, not `done/total` |

`done` / `total` are ROW counts. For a project whose scopes share one unit that is also
the answer, but Lexington measures a guardrail run in feet and a shower door in doors —
"18 / 202" counted a 196 ft run as one item, the same as one door, and called it 0%
until the last foot went in. So each scope also reports `qtyDone` / `qtyTotal` in its own
`unit` (`LF`, or the project's own `hubUnit`), taken from the tracker's own distinction:
a row with `runs` is dragged along in feet, everything else is one piece.

`pct` is the project figure: each scope's percentage measured in its own unit, averaged
weighted by row count. Rows are the weight because there is no honest conversion between
a foot of railing and a shower door — if a truer weight is ever wanted, put one on the
scope in `project-config.js` and use it in `pctOf()`.

`breakdown` is computed inside `hub-report.js` from classifiers that already exist in
each tracker's `app.js` (`isDoor` / `isInterior` / `doorTypeOf`, plus `u.type`), so it
costs no tracker UI change and no core change. A tracker still on `?v=4` simply sends
nothing and its card shows no scope rows. The scheduled reporter runs on firebase-admin
where those classifiers do not exist, so it never writes this field and never wipes it.

**The overview compares percent and estimated completion, never raw counts** — which
is why 355 Lexington in *pieces* and AC3 in *openings* sort in one list. A **Completion
by project** chart sits above the cards for the same reason: one measure, one hue, bars
sorted, a project with no report greyed and labelled rather than shown as zero.

Each card then opens that number up by scope — *Storefront · exterior*, *Door ·
fire-rated*, *Shower Door* — showing **what is left**, which is the question actually
being asked. Caulking and beauty cap are deliberately absent: crew workflow, not scope.

`Est. complete = remaining ÷ (4-week average ÷ 7)`. Earliest finish sorts to the top.

---

## Setup

### 1. Firebase project — done
`af-hub-8f188`. Realtime Database enabled. Authentication needs **two** providers on:

- **Anonymous** — trackers use it to push summaries
- **Email/Password** — the overview screen requires a real account

Create one email/password user per person who should see the overview
(Authentication → Users → Add user).

### 2. Rules
Paste `firebase-database-rules.json` into Realtime Database → Rules.

The split matters: anonymous can **write a summary** but cannot **read the portfolio**.
A tracker deployed on a public URL therefore cannot be used to read every project's numbers.

### 3. Deploy — done
`af-hub/` is static; no build step.

### 4. Wire each tracker

**Do not copy these two files any more (F-059, 2026-09-18).** Point the tracker at the
hub's single copy — in `index.html`, after `app.js`:

```html
<script src="https://af-hub-two.vercel.app/af-hub-config.js"></script>
<script src="https://af-hub-two.vercel.app/hub-report.js"></script>
```

They used to be copied into every tracker, so changing the reporter meant deploying four
projects and bumping four `?v=` numbers — and missing one left that tracker silently
reporting with old code. Now it is one file and one deploy, with no version numbers to
keep in step. `vercel.json` pins `max-age=0, must-revalidate` on both so a hub deploy
reaches every tracker on its next page load.

A cross-origin classic script still shares the page's global scope, so the reporter reads
`state` and calls `isDoor()` / `doorTypeOf()` exactly as before — verified in a real
browser, `_tests/` has the fixture. If the hub is unreachable the scripts simply do not
load: the tracker is unaffected and just does not report that session.

The trade: the hub's domain is now a dependency of all three trackers. Changing it means
one more pass over their `index.html`.

and in `project-config.js`:

```js
hubId:    'ac3',                       // ac3 / cp2 / lex
hubUnit:  'openings',                  // openings / pieces / linear ft
hubScope: 'Storefront / Curtain Wall',
```

The reporter runs on its own Firebase app instance (`afhub`) and writes a single node.
It cannot disturb the tracker's own sync, and a failed push is silent.

---

## Projects as of 2026-09-17

| Project | Total | Composition | Unit |
|---|---|---|---|
| Atlantic Chestnut 3 | **pending** | Storefront / Curtain Wall | openings |
| Cooper Park 2 | 82 | GF 71 · L2 6 · L13 5 | openings |
| 355 Lexington | 232 | Shower Door 159 · Terrace Divider 33 · Guardrail 8 · Equipment Screen 2, across 26 floors | pieces |

AC3's total is not on disk: `seedUnits` holds a stale 17, and
`AC3 ALL ELEVATIONS - reconciled.xlsx` reads "25 mark(s)" while the ground-floor plan
alone carries 70+ markers — **a mark is not an opening** (SF04 appears several times).
The overview needs physical openings, because that is the install workload.
Wiring `hub-report.js` resolves it automatically as `units.length`.

---

## Roadmap beyond the MVP

| Step | Scope | Days |
|---|---|---|
| 2 | Damage ledger + change-order decision (built on the hub — no tracker UI changes) | 4 |
| 3 | `af-core.js` — shared auth / sync / evidence / backup; forks keep their own UI | 6 |
| 4 | Shop scheduling — one cross-project work queue | 6 |
| 5 | Foreman screen — what goes in today | 4 |
