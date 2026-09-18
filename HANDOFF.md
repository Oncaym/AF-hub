# AF Hub — Handoff

2026-09-17 · written for a fresh session picking this up cold.
Companion doc: `claude/Advanced Facade 内部 app — 路线图.md` in the Atlantic Chestnut 3 project.

---

## 1. What this is, in one paragraph

Advanced Facade runs ~10 construction projects across several teams. Leo maintains three of
them (AC3, CP2, 355 Lexington) as separate tracker web apps; another team has forked the
tracker and customized it. The goal is **not** one unified app — Leo rejected that explicitly
("用一个框架去适配不同的项目没有必要"). Instead: a **Hub** that every tracker reports four
numbers to, while each team keeps total freedom over its own UI.

**Live:** https://af-hub-two.vercel.app/ · **Local:** `C:\Users\Ethan\Downloads\af-hub\`

---

## 2. Decisions already made — do not relitigate these

| Decision | Why |
|---|---|
| **No unified app.** Hub + independent trackers. | Leo: teams' workflows and scopes differ; an app nobody likes is an app nobody uses. |
| **Only two roles are cross-project: the boss and the shop.** | The shop is in-house and serves all ~10 projects — one work queue. PM and foreman are per-project, so they stay in each tracker. |
| **The contract is four numbers,** not a schema. | Lexington is Shower Door / Terrace Divider / Guardrail / Equipment Screen; AC3 is curtain wall. Only `%` and `est. complete` are comparable — never raw counts. |
| **Mobile / iPad first, boss is the primary user.** | Leo, explicitly. |
| **No offline queue.** | Leo: 工地有信号. This deletes a large chunk of the original plan. |
| **No material cost tracking.** | Contract price is locked up front; material never moves revenue. Changes go through change orders. |
| **The only things that move money at install are labor and damage.** | stick bend / flashing broken / glass broken. Revenue is fixed, so every breakage comes straight out of margin unless it becomes a CO. |
| **Labor baseline: 5 people × 1 day = 8 units** → 5 work-hours/unit, **1.6 units/person-day**. | Leo's number. Deliberately coarse. Do not build a rate table — record crew size and units per day, compare to 1.6, and derive real rates after ~3 months. |
| **PWA, never native.** | Avoids App Store review, MDM distribution, version fragmentation. |
| **No external users yet** (GC / owner / supplier). | Leo: operationally hard, not reachable yet. But leave room in the membership model. |

**Design target:** the `Carbon Skin` film script (project doc
`claude/Carbon Skin 90s film - as-built script and music brief.md`). Its Act II shape —
*system finds the exception → pushes it to a person → consequence already computed → human
answers yes/no → lands in a ledger with author/time/reason* — is the whole product. Swap the
trigger from "delivery ticket arrived" to "**SF12A glass broken**". Everything else in that
film (re-pricing on delivery, face-level carbon allowance, substitution pricing page, offline
queue) does **not** apply here and has been cut.

---

## 3. Architecture

```
  tracker (AC3)  ──┐   hub-report.js  (browser, live, only when signed in)
  tracker (CP2)  ──┼──────────────────────────────►  af-hub-8f188 RTDB
  tracker (LEX)  ──┘                                 /projects/{id}/summary
                                                              ▲
  GitHub Action (every 2h, service accounts) ─────────────────┘
                                                              │
                                        af-hub-two.vercel.app ┘  (email/password login)
```

Two independent paths on purpose: the browser path is near-real-time during the working day;
the scheduled job guarantees the boss never opens a cold hub and sees stale numbers.

### The contract — `/projects/{id}/summary`

`name` · `unit` · `scope` · `url` · `done` · `total` · `weekRate` · `prevWeekRate` ·
`avg4w` · `openDamage` · `pendingCO` · `breakdown` · `pct` · `ts`

`Est. complete = remaining ÷ (avg4w ÷ 7)`. `openDamage` / `pendingCO` are reserved — always 0
until step 2 ships, so the hub needs no change when they go live.

`breakdown` (2026-09-17, optional) is `[{scope, done, total}]`, biggest first. It is computed
**inside `hub-report.js`** from classifiers already in each tracker's `app.js` — no core change,
no tracker UI change. Order matters in `scopeOf()`: `type` is consulted **before** `isDoor()`,
because `isDoor()` matches any type containing "door" and would otherwise file Lexington's 159
shower doors as exterior doors. `report/report.js` cannot compute it (no browser, no classifiers)
so it preserves whatever is there, the same way it preserves `url`.

Each scope also carries `qtyDone` / `qtyTotal` / `unit` (2026-09-18). `done` / `total` stay
ROW counts; the quantities are the real work. A row with `runs` is measured in feet (the
tracker's own test — `lf.js` asks `isRun()` for exactly this), everything else is one piece.
`pct` is the project figure: per-scope percentages in their own units, row-weighted. The
card shows `N scopes` instead of a blended `x / y` when a project mixes units.

Test: `node _tests/test-breakdown.cjs <folder-holding-the-trackers>` — runs the real `scopeOf`
over each tracker's real seed units and checks Lexington's split AND its quantities
(1201.52 LF guardrail, 182.33 LF screen, 159 doors, 33 panels) against its own CLAUDE.md.

### Auth model

- **Anonymous** — trackers use it to write their own summary. Rules let anonymous **write** a
  summary but **not read** `/projects`, so a publicly-deployed tracker cannot be used to pull
  the whole portfolio.
- **Email/password** — required to read the overview. Users are created by hand in Firebase
  Console → Authentication → Users.

---

## 4. Files

### `C:\Users\Ethan\Downloads\af-hub\`

| File | md5 | Role |
|---|---|---|
| `index.html` | `9e851ce7ed` | The overview. Sign-in gate, roster merge, theme toggle, change password, reset password, per-project **Open ↗**. |
| `hub-report.js` | `cf96897754` | Reporter. **Served from here to every tracker (F-059)** — **Identical copy in all three trackers** — treat as a CORE file under SYNC.md. Now also sends `breakdown`. |
| `af-hub-config.js` | `a3e947c333` | Hub Firebase config. Same file in the hub and every tracker. |
| `firebase-database-rules.json` | `cc8177ccd4` | RTDB rules. Includes the reserved `damage` subtree for step 2. |
| `report/report.js` | `7c539b6d39` | Scheduled reporter (firebase-admin). Mirrors `hub-report.js` maths — **change both together**. |
| `report/projects.json` | `1cc07a3ea9` | Per-project databaseURL + which secret to use. Not secret. |
| `report/package.json` | `755776df71` | firebase-admin ^12.7.0 |
| `.gitignore` | `2f2ba71fa1` | Excludes `hub secrets/` and `*-adminsdk-*.json`. |
| `hub secrets/` | — | **Four Firebase service-account private keys.** Not in git. Should really be moved outside the folder. |

### Tracker wiring (all three identical)

- **F-059 (2026-09-18): nothing is copied any more.** Both files are loaded from
  `https://af-hub-two.vercel.app/` — one copy, one deploy, no `?v=` to keep in step.
  The local copies were deleted from all three trackers; leaving them would have been a
  trap, since editing one would look like it should work and would change nothing.
- two `<script>` tags before `</body>`, absolute URLs
- `project-config.js` gained `hubId` / `hubUnit` / `hubScope`

| Tracker | hubId | unit | Firebase RTDB |
|---|---|---|---|
| AC3 tracker | `ac3` | openings | `atlantic-chestnut-3-default-rtdb` |
| cp2-tracker-deploy | `cp2` | openings | `copper-park-2---monitor-default-rtdb` |
| Lexington/355-lexington-tracker | `lex` | pieces | `lexington-avenue-93a52-default-rtdb` |

---

## 5. OPEN — pick these up first

### 5.1 ⛔ AC3 reports 0 / 51 and that is almost certainly wrong
The most recent Action run produced:

```
ac3: 0/51      ← suspicious, AC3 is the most-installed project
cp2: 54/119    ← looks right
lex: 0/202     ← plausible, may genuinely not have started
```

Already ruled out:
- the maths — `app.js:2219` counts installed as `u.filter(x => x.status === 'installed')`, and
  both reporters use exactly that
- the path — all three read `/state`; `cloud-sync.js` is byte-identical across trackers
  (md5 `8cecb53763ee`)
- CP2 produces a correct number through the identical code

So AC3's cloud `/state` really does hold 51 units with none marked installed. Note the four
different numbers seen for AC3: seed 17 · `AC3 ALL ELEVATIONS - reconciled.xlsx` says
"25 mark(s)" · the ground-floor plan carries 70+ markers · cloud says 51. **A mark is not an
opening** (SF04 appears several times on the plan). Next step: open the AC3 tracker signed in
and compare its own KPI against 0/51. If the tracker also shows 0%, the data is the problem,
not the reporter.

**The executive screen must not ship to the boss until this reconciles.**

### 5.2 CP2 and Lexington have no `url`, so no Open ↗ button
`report/projects.json` has `"url": ""` for both — their Vercel addresses were never found in
the repos. Self-heals the moment someone opens those trackers signed in (`hub-report.js`
reports `location.origin`). `report.js` was fixed to preserve an existing url rather than
overwrite it with its own blank — **that fix is not yet pushed**. Alternatively just ask Leo
for the two URLs and hard-code them.

### 5.3 `.github/workflows/report.yml` must be created by hand
Remote tools are blocked from writing under `.github`. The file content was delivered in chat.
Easiest path: GitHub web UI → Add file → Create new file → path `.github/workflows/report.yml`.
**Confirm whether Leo has done this** — the Action has run at least once, so probably yes.

### 5.4 Repo / secrets status — verify, do not assume
As of this handoff `Downloads\af-hub` had **no `.git`**; it was deployed to Vercel by hand.
Leo was given instructions to create a private `af-hub` repo, push, and add five secrets
(`HUB_SERVICE_ACCOUNT`, `HUB_DATABASE_URL`, `AC3_/CP2_/LEX_SERVICE_ACCOUNT`). Data has since
appeared on the hub, so at least some of this is done. Check before re-explaining it.

### 5.5 Not yet redeployed / repushed
- `index.html` — change-password + reset-password dialogs, the `[hidden]` fix below,
  plus the **Completion by project** chart, the per-scope rows on each card, and the
  `#u=` email handoff on Open ↗. **Redeploy this one first** — the live build at
  af-hub-two.vercel.app still shows the account dialog nailed over the sign-in screen
  for every visitor.
- `hub-report.js` v5 — into all three trackers (`?v=5` already bumped in each
  `index.html`). Until a tracker ships v5 its card simply has no scope rows.
- **All three trackers: `cloud-sync.js` (core, F-058) + `firebase-database-rules.json`.**
  See 5.7.
- `report/report.js` — the url-preservation fix
- three trackers — `hub-report.js` v4

### 5.7 ⛔ F-058 needs two things done in the Firebase Console, per project
Until step ② is done the hole is still open — the code ships fail-open on purpose so it
can go out ahead of the Console work.

1. **Publish the updated `firebase-database-rules.json`** (each tracker's own project).
   The only change is the new `/gcList` node. `/state`'s `.read` stays `auth != null`:
   accounts are created by hand in the Console with no self-signup, so being able to
   sign in *is* the authorisation.
2. **Create `/gcList`** and put the real GC's email in it. Key = email with **every**
   `.` replaced by `,` (the rules' `replace` is global; swapping only the first dot
   silently misses `leo.sun@…`, which is the shape of most of these addresses):
   ```json
   { "gcList": { "pm@broadwaybuilder,com": true } }
   ```
3. Sign in with the GC account → the narrowed view. Sign in with an account on neither
   list → **the full internal board, read-only**. `/allowlist` is editor permission;
   not holding it makes you a viewer, not an outsider (Leo, 2026-09-18).

### 5.6 Password reset email comes from `noreply@af-hub-8f188.firebaseapp.com`
It will land in spam the first time. Customizing the sender needs domain verification in
Firebase Console → Authentication → Templates. Worth doing before handing the boss the link.

---

## 6. Traps already hit — do not repeat

1. **`window.state` is undefined in the trackers.** `app.js:778` is `let state = null;` at top
   level of a classic script — a global *lexical* binding, shared between classic scripts but
   **not a property of `window`**. Cost an entire debugging round where the reporter silently
   pushed nothing. `hub-report.js` now reads the bare identifier `state`, then `window.state`,
   then `localStorage[PROJECT.storageKey]`.
2. **A logged-out visitor to a tracker used to overwrite the hub with seed data.** Public URL +
   embedded seed (AC3: 17 units, 0 installed) = anyone could silently reset the overview.
   Fixed by `trackerReady()` — only report when the tracker's own auth has a `currentUser`.
3. **The roster must not be decided by whoever pushed last.** An early version rendered the
   live list when it was non-empty, so the moment `ac3` appeared, CP2 and Lexington vanished
   from the screen. Now `ROSTER` in `index.html` is merged with live data; unreported projects
   render dimmed and marked "not reporting". **Adding a fourth project means adding a ROSTER
   row as well as a `hubId`.** Move the roster into the database once there are more than ~5.
4. **Silent failure is the real bug.** The first reporter returned early with no logging.
   Everything now logs under `[af-hub]`, plus `afHubDebug()` / `afHubPush()` on `window`.
   `afHubDebug()` only exists on **tracker** pages, never on the hub — Leo hit this.
5. **Service-account JSONs live inside the folder that becomes a git repo.** `.gitignore` is in
   place; still verify `git status` before the first `git add`.
6. Remote tools cannot write anything under `.github`.
7. **A tracker's own `index.html` is where the plan-asset pair gets forgotten.** AC3
   shipped `2-white.png` on 2026-09-03 but never wired `data-plan-light` /
   `data-plan-dark`, and because its `project-config.js` has no `floors`, `setLevel()` —
   the only thing that pins `PLAN_GF_SRC` — never ran. `_planLightSrc()` therefore
   returned the live `src`, which after one runtime inversion *is* the inverted data
   URL, so every save inverted the previous output and the plan alternated black/white
   forever. Fixed 2026-09-17 by wiring the pair. Lesson: when a floor has no shipped
   twin, the runtime inversion's input must never be a value that the inversion itself
   can overwrite.
8. **`[hidden]` loses the cascade to any rule that sets `display`.** `.veil` set
   `display: flex`, which outranks the UA sheet's `[hidden] { display: none }`, so
   `acctPanel.hidden = true` set the attribute and changed nothing: the change-password
   dialog rendered over the sign-in screen from first paint, and Cancel / Esc / backdrop
   all ran correctly while the box sat there. Nothing in the JS was wrong. Fixed once,
   globally, with `[hidden] { display: none !important; }` near the top of the sheet —
   which also immunises every future element that carries the attribute. Verified in
   headless Chromium: 28 assertions over both dialogs, both themes, signed in and out.
9. **A person who forgot their password cannot type their current one.** Reset and
   change are two different flows and must never share a dialog. `#resetPanel` (email
   only, no session needed) vs `#acctPanel` (reauthenticate, session required).

---

## 7. Roadmap after the MVP

| Step | Scope | Days |
|---|---|---|
| ✅ 1 | Hub + executive overview | 4 |
| **2** | **Damage ledger + change order** — highest leverage | 4 |
| 3 | `af-core.js` — shared auth/sync/evidence/backup; forks keep their own UI | 6 |
| 4 | Shop scheduling — one cross-project queue | 6 |
| 5 | Foreman screen — what goes in today | 4 |

**Step 2 is the one that matters.** Revenue is locked, so every damage event comes out of
margin unless it is proven to be someone else's and converted into a CO — and that proof is
only ever the evidence captured on the day. **F-011 already built the table**: the evidence
layer's `ref` / `party` / `fault` fields plus fit-issue / field-verify / gc-inquiry event types
are exactly damage attribution. Only two things are missing: **an amount, and a CO status**
(not claiming / to submit / submitted / approved / rejected), plus damage type and photos.
Build it **on the hub**, not inside each tracker, so no team has to touch its own UI.

Step 3's acceptance test: the other team points their fork at `af-core.js`, deletes their own
cloud-sync/permissions code, and ships **without changing one line of their UI**.

---

## 8. Unrelated work from the same session

`AC3 tracker\2.png` / `2-white.png` — the ground-floor plan was rebuilt from
`1541 - AC - Bldg 3-Sheet - A-111` (DXF, via ezdxf) at 4000×3200, replacing a soft raster crop
of the Bulletin 2 PDF. Notes worth keeping:
- 39 of 93 layers were **off** in the DXF export, including all dimensions and unit tags —
  they must be force-enabled or the plan renders without annotation
- every text style points at `arial.ttf`; with no such font installed ezdxf silently renders
  no text at all. Aliasing Liberation Sans as `arial.ttf` fixed it
- **the crispness fix was not resolution, it was antialiasing.** CP2's plans have 2 alpha
  levels (hard edges); ours had 8 and read as blur at any zoom. Linework is now rendered at 2×
  and min-pooled to a hard binary mask, with only hatch fills left soft
- the frame was registered against the old asset by SIFT/RANSAC, residual 0.13 px, so every
  marker kept its position
- old file backed up at `_bak/2.png.pre-bulletin2-20260902`
- `2-white.png` still is **not wired up** — `index.html:2098` has no `data-plan-light` /
  `data-plan-dark`, so dark mode still uses the runtime canvas inversion that CLAUDE.md rule 8
  says never to rely on. Two attributes would fix it.
