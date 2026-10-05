# AF v2 — the shared platform (prototype, 2026-10-05)

One site, one backend, every project. Lives at `af-hub-two.vercel.app/v2/` until it replaces the hub at `/`.

- **Backend**: the hub's own Firebase project (`af-hub-8f188`), everything under `/v2` in the Realtime Database.
  The config is the site's existing `af-hub-config.js`. Who may read/write what: `firebase-database-rules.json` (the `"v2"` block).
- **Demo**: `/v2/?demo` runs the whole app on built-in data with no Firebase. Changes stay in that browser.
  The role picker in the top bar shows each role's screen (admin · pm · editor · field · viewer · exec).
- **Data model** (see `js/store-live.js` for the paths): a project is `meta` + `items`; an item is one trackable piece
  (a shower door, a guardrail with its posts, one glass lite on an elevation) with three stages —
  `factory → site → installed`, each stamped `{ d: date, t, by, n }`. Count items (posts, panels) also carry `qd`.
  Every write goes out with its line in the append-only `v2/changes/{pid}`.
- **Projects**: `seed/*.json`, built from the old trackers' own files by `node v2/tools/build-seed.cjs`
  (run it from the repo; it finds `Downloads\AC3 tracker` and `Downloads\Lexington\355-lexington-tracker`).
  Guardrail posts are counted at one per 4 ft; equipment-screen panels from each face's "4w×1h".
  AC3 has 17 of its 51 openings — the rest and their plan positions are only in the old tracker's cloud data (import: next step).
- **Rules tests**: `v2/tests/rules.test.mjs`, run on GitHub by `.github/workflows/v2-rules.yml` on every push that touches the rules.

## First time live (once)
1. Firebase console → Authentication → Sign-in method → Email/Password → turn on **Email link (passwordless sign-in)**.
   (Recommended: Settings → User actions → untick "Enable create (sign-up)" so only invited people get in.)
2. Push, wait for **v2 rules tests** to go green, then paste `firebase-database-rules.json` into
   Realtime Database → Rules → Publish. The old hub's rules are inside it unchanged.
3. Open `/v2/`, sign in as leosun@advfacade.com, go to **Admin → Claim admin**, then **Load into database** for each project.
4. Admin → add people by email and role. They become members the first time they sign in with an email link.

## Not built yet
Log (photos), RFI, Submittals tabs · deliveries and the delivery-aware finish date · the factory view ·
importing AC3's cloud data · GC view · Korean strings.
