/* ============================================================
   PROJECT CONFIG — Cooper Park 2
   ------------------------------------------------------------
   All project-specific data lives HERE. app.js / app-log.js /
   cloud-sync.js / chat.html / api/parse.js are CORE files,
   byte-identical across trackers — sync them freely between
   projects; never overwrite this file from another project.
   Load order: firebase-config → this file → cloud-sync →
   (elevations) → app-log → app.
   ============================================================ */
window.PROJECT = (() => {
const YEAR = new Date().getFullYear(); // seed log dates use the current year
return {
  name: 'Cooper Park 2',
  code: 'CP2',
  // AF Hub reporting (hub-report.js) - see Downloads/af-hub/README.md
  hubId:    'cp2',
  hubUnit:  'openings',
  hubScope: 'Storefront',

  // localStorage identity — NEVER change on a live project (orphans local caches)
  storageKey:  'cooper_park_2_install_v4',
  baselineKey: 'cooper_park_2_install_v4_baseline',
  langKey:     'cp2_lang',
  fileSlug:    'cooper_park_2',

  // Door-unit id patterns (regex, case-insensitive) beyond type==='Door'
  doorPatterns: ["^SD"],

  // Interior storefront id patterns (F-044) — these render as diamonds, not circles
  interiorPatterns: ["^IS"],

  /* F-048/F-050: scopes with a headline card + a marker ring. "Face Cover" was renamed
     Beauty Cap (same part as AC3's) — the stored key is `beautyCap` on both projects. */
  scopeKpis: [
    { scope: 'caulking',  valueId: 'kpi-caulk',     subId: 'kpi-caulk-sub',     label: 'Caulking' },
    { scope: 'beautyCap', valueId: 'kpi-beautycap', subId: 'kpi-beautycap-sub', label: 'Beauty Cap' }
  ],
  ringScopes: [
    { scope: 'caulking',  cls: 'scope-caulk', labelKey: 'legend_caulk' },
    { scope: 'beautyCap', cls: 'scope-fc',    labelKey: 'legend_beautycap' }
  ],

  // true → only markers explicitly placed via Place mode render on the plan
  requirePlacedMarkers: false,

  /* Floors (F-044, Leo 2026-08-05). "Other Levels" used to be one tab whose plan was a
     composite sheet with the 2nd-floor partial plan on the left and the 13th-floor terrace
     doors on the right. Now they are two tabs: 2F keeps the left half of that sheet
     (cropped to 2f-plan.png), 13F gets its own plan from the 13th-floor DXF.
     GF's image lives in index.html markup; other floors read `img` from here. */
  floors: [
    { key: 'GF',  name: { en: 'Ground Floor', zh: '一层 / Ground Floor', ko: '지상층' } },
    // img = light asset (black linework on white — also what prints); imgDark = the
    // pre-inverted twin the dark UI uses. BOTH are required for every plan (see CLAUDE.md).
    { key: 'L2',  name: { en: '2nd Floor',    zh: '二层 / 2nd Floor',    ko: '2층' },
      img: '2f-plan.png',  imgDark: '2f-plan-white.png' },
    { key: 'L13', name: { en: '13th Floor',   zh: '十三层 / 13th Floor', ko: '13층' },
      img: '13f-plan.png', imgDark: '13f-plan-white.png' }
  ],

  /* One-time state migrations (F-044). Each runs once per project — the id is recorded in
     state.migrations[] — so it can safely fix up live cloud data that no seed edit reaches. */
  migrations: [
    {
      id: 'glasslog-installed-only-2026-08',
      note: 'F-053: drop daily-log glass entries that were written for a panel merely being ' +
            '"ready" (on site) — only installed panels belong on the installation trend. ' +
            'Entries record the non-installed status per unit, so they are identifiable; an ' +
            'entry left with nothing in it is removed.',
      apply(state) {
        const log = Array.isArray(state.log) ? state.log : [];
        let dropped = 0;
        log.forEach(l => {
          if (!l || l.auto !== true || l.kind !== 'glass' || !l.autoUnits) return;
          Object.keys(l.autoUnits).forEach(k => {
            const v = l.autoUnits[k];
            const st = (v && typeof v === 'object') ? (v.status || '') : (typeof v === 'string' ? v : '');
            if (st) { delete l.autoUnits[k]; dropped++; }        // '' === installed
          });
          if (typeof rebuildAutoUnitsContent === 'function') rebuildAutoUnitsContent(l);
        });
        state.log = log.filter(l => !(l && l.auto === true && l.kind === 'glass' &&
          (!l.autoUnits || !Object.keys(l.autoUnits).length)));
        return dropped + ' non-installed glass row(s) removed from the trend';
      }
    },
    {
      id: 'cp2-2026-08-facecover-to-beautycap',
      note: 'F-050: "Face Cover" and AC3\'s "Beauty Cap" are the same part. Rename the stored ' +
            'scope key so both trackers speak one language; status/date are carried over as-is.',
      apply(state) {
        let n = 0;
        (state.units || []).forEach(u => {
          if (u.scopes && u.scopes.faceCover) {
            if (!u.scopes.beautyCap) u.scopes.beautyCap = u.scopes.faceCover;
            delete u.scopes.faceCover;
            n++;
          }
        });
        return n + ' unit(s): scopes.faceCover → scopes.beautyCap';
      }
    },
    {
      id: 'cp2-2026-08-floor-split',
      note: 'Split L2 into 2F + 13F: SF70/SF71 are the 13th-floor terrace doors, everything ' +
            'else on the old tab is 2nd floor. 2F marker positions are remapped from the old ' +
            '3200x956 composite sheet to the cropped 2f-plan.png (crop box 115,13 → 1118,932). ' +
            '13F positions are cleared — the new plan has different geometry, Leo re-places them.',
      apply(state) {
        const SRC_W = 3200, SRC_H = 956, X0 = 115, Y0 = 13, CW = 1003, CH = 919;
        const remap = p => ({
          x: Math.max(0, Math.min(100, (p.x / 100 * SRC_W - X0) / CW * 100)),
          y: Math.max(0, Math.min(100, (p.y / 100 * SRC_H - Y0) / CH * 100))
        });
        let moved = 0, remapped = 0;
        (state.units || []).forEach(u => {
          if ((u.level || 'GF') !== 'L2') return;
          if (/^SF7[01]/i.test(u.id || '')) {
            u.level = 'L13';
            if (state.positions && state.positions[u.key]) { delete state.positions[u.key]; moved++; }
            else moved++;
          } else if (state.positions && state.positions[u.key]) {
            state.positions[u.key] = remap(state.positions[u.key]);
            remapped++;
          }
        });
        return `${moved} unit(s) → 13th Floor (positions cleared), ${remapped} 2nd-floor marker(s) remapped`;
      }
    }
  ],

  // Project strings that override the core i18n table
  i18n: {
    // 2026-07-31 (Leo): dropped the "· Ground Floor · Installed Framing & Louver Tracking"
    // tail — the floor is already a control on the plan and the scope line was stale noise
    // in the sticky header, which is prime real estate on a phone.
    en: { header_sub: "Broadway Builders", img_alt_gf: "Cooper Park 2 — Ground Floor Plan (from DXF)", legend_door: "Door" },
    zh: { header_sub: "Broadway Builders", img_alt_gf: "Cooper Park 2 — 一层平面图（来自 DXF）", legend_door: "门" },
    ko: { header_sub: "Broadway Builders", img_alt_gf: "Cooper Park 2 — 1층 평면도 (DXF)", legend_door: "도어" }
  },

  // Scope baseline (seeds cloud/localStorage on first run or after /state reset)
  seedUnits: [
  { key:'SF06N', id:'SF06N', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-19`, louver:'no', note:'Framing 5/19 (06NE)' },
  { key:'SF04__1', id:'SF04', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-15`, louver:'yes', note:'Framing 5/15 · Louver → 5/18' },
  { key:'SF04__2', id:'SF04.1', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-15`, louver:'yes', note:'Framing 5/15 · Louver → 5/18' },
  { key:'SF07N', id:'SF07N', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF07W', id:'SF07W', type:'Storefront', zone:'West', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'yes', note:'Framing + Louver 5/20 (07NW)' },
  { key:'SF01__1', id:'SF01', type:'Storefront', zone:'West', level:'GF', status:'installed', date:`${YEAR}-05-13`, louver:'yes', note:'Framing 5/13 · Louver → 5/18' },
  { key:'SF01__2', id:'SF01.1', type:'Storefront', zone:'West', level:'GF', status:'installed', date:`${YEAR}-05-13`, louver:'yes', note:'Framing 5/13 · Louver → 5/18' },
  { key:'SF20A__1', id:'SF20A', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-12`, louver:'no', note:'Framing 5/12' },
  { key:'SF20A__2', id:'SF20A.1', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'yes', note:'Framing + Louver 5/20' },
  { key:'SF20B__1', id:'SF20B', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-12`, louver:'no', note:'Framing 5/12' },
  { key:'SF20A__3', id:'SF20A.2', type:'Storefront', zone:'North', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'yes', note:'Framing + Louver 5/20' },
  { key:'SF20B__2', id:'SF20B.1', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF20A__4', id:'SF20A.3', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF52', id:'SF52', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF51__1', id:'SF51', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF50__1', id:'SF50', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF51__2', id:'SF51.1', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF50__2', id:'SF50.1', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF21A', id:'SF21A', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF21B__1', id:'SF21B', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF21B__2', id:'SF21B.1', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF21B__3', id:'SF21B.2', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF32', id:'SF32', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF08E', id:'SF08E', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF08N', id:'SF08N', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF03__1', id:'SF03', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF03__2', id:'SF03.1', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF03__3', id:'SF03.2', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF09N', id:'SF09N', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF09W', id:'SF09W', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF02', id:'SF02', type:'Storefront', zone:'West', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF22B', id:'SF22B', type:'Storefront', zone:'West', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF40', id:'SF40', type:'Storefront', zone:'West', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF41', id:'SF41', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF42', id:'SF42', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF43', id:'SF43', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF44', id:'SF44', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF45', id:'SF45', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF46', id:'SF46', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF48', id:'SF48', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF20A__5', id:'SF20A.4', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF20A__6', id:'SF20A.5', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF10A', id:'SF10A', type:'Storefront', zone:'South', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'yes', note:'Framing + Louver 5/20' },
  { key:'SF30', id:'SF30', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF11A__1', id:'SF11A', type:'Storefront', zone:'South', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'no', note:'Framing 5/20' },
  { key:'SF11A__2', id:'SF11A.1', type:'Storefront', zone:'South', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'no', note:'Framing 5/20' },
  { key:'SF11A__3', id:'SF11A.2', type:'Storefront', zone:'South', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'no', note:'Framing 5/20' },
  { key:'SF11B', id:'SF11B', type:'Storefront', zone:'South', level:'GF', status:'installed', date:`${YEAR}-05-20`, louver:'no', note:'Framing 5/20' },
  { key:'SF11A__4', id:'SF11A.3', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF11A__5', id:'SF11A.4', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF31__1', id:'SF31', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF17S', id:'SF17S', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF47', id:'SF47', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF49', id:'SF49', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'Transom over the south main entry (above SF47) — F-055' },
  { key:'SD01', id:'SD01', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'South main entry door, inside the SF47 opening — F-055' },
  { key:'SF13A', id:'SF13A', type:'Storefront', zone:'East', level:'GF', status:'installed', date:`${YEAR}-05-13`, louver:'no', note:'Framing 5/13' },
  { key:'SF12B', id:'SF12B', type:'Storefront', zone:'East', level:'GF', status:'installed', date:`${YEAR}-05-11`, louver:'no', note:'Framing 5/11' },
  { key:'SF12A__1', id:'SF12A', type:'Storefront', zone:'East', level:'GF', status:'installed', date:`${YEAR}-05-12`, louver:'no', note:'Framing 5/12' },
  { key:'SF12A__2', id:'SF12A.1', type:'Storefront', zone:'East', level:'GF', status:'installed', date:`${YEAR}-05-12`, louver:'no', note:'Framing 5/12' },
  { key:'SF12A__3', id:'SF12A.2', type:'Storefront', zone:'East', level:'GF', status:'issue', date:`${YEAR}-05-12`, louver:'no', note:'12A3 — opening error (per PDF)' },
  { key:'SF16E', id:'SF16E', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF16N', id:'SF16N', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF31__2', id:'SF31.1', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF01__3', id:'SF01.2', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF01__4', id:'SF01.3', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF06E', id:'SF06E', type:'Storefront', zone:'North', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF17E', id:'SF17E', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF12A__4', id:'SF12A.3', type:'Storefront', zone:'South', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF12A__5', id:'SF12A.4', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF15E', id:'SF15E', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF15N', id:'SF15N', type:'Storefront', zone:'East', level:'GF', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },

  // ---- Level 2 units (2nd FL Partial Plan + 13th FL Terrace Entry Doors) ----
  { key:'SF60',    id:'SF60',    type:'Storefront', zone:'South', level:'L2', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF61',    id:'SF61',    type:'Storefront', zone:'South', level:'L2', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF62__1', id:'SF62',    type:'Storefront', zone:'North', level:'L2', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF62__2', id:'SF62.1',  type:'Storefront', zone:'North', level:'L2', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF63__1', id:'SF63',    type:'Storefront', zone:'North', level:'L2', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF63__2', id:'SF63.1',  type:'Storefront', zone:'North', level:'L2', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF70__1', id:'SF70',    type:'Storefront', zone:'North', level:'L13', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF70__2', id:'SF70.1',  type:'Storefront', zone:'North', level:'L13', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF70__3', id:'SF70.2',  type:'Storefront', zone:'North', level:'L13', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF71__1', id:'SF71',    type:'Storefront', zone:'North', level:'L13', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
  { key:'SF71__2', id:'SF71.1',  type:'Storefront', zone:'North', level:'L13', status:'pending', date:'', louver:'no', glass:'', panels:'', note:'' },
],

  seedLog: [
  // ----- Actual (per PDF "INSTALLED FRAMING UPDATE" 5/11-5/20) -----
  { date:`${YEAR}-05-11`, category:'framing',  content:'12A1 · 12A2 · 12B' },
  { date:`${YEAR}-05-12`, category:'framing',  content:'12A · 12A3 · 12A · 20A · 20A.1 · 20B' },
  { date:`${YEAR}-05-12`, category:'issue',    content:'12A3 — opening error' },
  { date:`${YEAR}-05-13`, category:'framing',  content:'13A · 01 · 01 · 20A.1 · 20B.1' },
  { date:`${YEAR}-05-14`, category:'caulking', content:'Caulking' },
  { date:`${YEAR}-05-15`, category:'framing',  content:'04 · 04 · 01L · 01R · 20A.1' },
  { date:`${YEAR}-05-18`, category:'louver',   content:'12A3 Louvers' },
  { date:`${YEAR}-05-19`, category:'framing',  content:'15NE · 16NE · 06NE' },
  { date:`${YEAR}-05-20`, category:'framing',  content:'11A · 11A · 11B · 11A — opening error' },
  { date:`${YEAR}-05-20`, category:'louver',   content:'10A · 20A · 20A · 07NW' },
  // ----- Planned (after today) -----
  { date:`${YEAR}-05-21`, category:'issue',    content:'Caulking / Louvers — Yulin NOT On-site', planned:true },
  { date:`${YEAR}-05-22`, category:'louver',   content:'Louvers (TBD)', planned:true },
],

  defaultPositions: {
  'SF06N': { x: 86.07, y: 8.26 },
  'SF04__1': { x: 81.27, y: 8.03 },
  'SF04__2': { x: 75.58, y: 8.03 },
  'SF07N': { x: 70.20, y: 8.01 },
  'SF07W': { x: 67.97, y: 10.41 },
  'SF01__1': { x: 67.80, y: 16.03 },
  'SF01__2': { x: 67.80, y: 22.84 },
  'SF20A__1': { x: 66.34, y: 45.70 },
  'SF20A__2': { x: 62.83, y: 45.70 },
  'SF20B__1': { x: 58.90, y: 45.70 },
  'SF20A__3': { x: 54.83, y: 45.70 },
  'SF20B__2': { x: 50.91, y: 45.70 },
  'SF20A__4': { x: 46.90, y: 45.70 },
  'SF52': { x: 43.80, y: 48.85 },
  'SF51__1': { x: 42.29, y: 50.74 },
  'SF50__1': { x: 38.89, y: 50.74 },
  'SF51__2': { x: 35.17, y: 50.74 },
  'SF50__2': { x: 31.76, y: 50.74 },
  'SF21A': { x: 29.82, y: 43.68 },
  'SF21B__1': { x: 29.84, y: 37.64 },
  'SF21B__2': { x: 29.84, y: 30.60 },
  'SF21B__3': { x: 29.84, y: 23.82 },
  'SF32': { x: 29.84, y: 15.65 },
  'SF08E': { x: 30.08, y: 10.33 },
  'SF08N': { x: 28.00, y: 8.00 },
  'SF03__1': { x: 22.60, y: 8.02 },
  'SF03__2': { x: 17.27, y: 8.02 },
  'SF03__3': { x: 11.98, y: 8.02 },
  'SF09N': { x: 6.56, y: 8.02 },
  'SF09W': { x: 4.57, y: 10.10 },
  'SF02': { x: 4.22, y: 16.30 },
  'SF22B': { x: 4.18, y: 23.57 },
  'SF40': { x: 3.70, y: 76.11 },
  'SF41': { x: 6.49, y: 84.53 },
  'SF42': { x: 11.99, y: 84.53 },
  'SF43': { x: 15.71, y: 84.53 },
  'SF44': { x: 18.84, y: 84.53 },
  'SF45': { x: 24.60, y: 84.53 },
  'SF46': { x: 30.52, y: 84.53 },
  'SF48': { x: 38.34, y: 84.53 },
  'SF20A__5': { x: 42.23, y: 88.00 },
  'SF20A__6': { x: 46.47, y: 88.00 },
  'SF10A': { x: 50.70, y: 88.00 },
  'SF30': { x: 55.64, y: 88.00 },
  'SF11A__1': { x: 59.23, y: 88.00 },
  'SF11A__2': { x: 63.35, y: 88.00 },
  'SF11A__3': { x: 67.45, y: 88.00 },
  'SF11B': { x: 71.66, y: 88.00 },
  'SF11A__4': { x: 75.88, y: 88.00 },
  'SF11A__5': { x: 80.23, y: 88.00 },
  'SF31__1': { x: 85.33, y: 87.87 },
  'SF17S': { x: 90.69, y: 87.79 },
  'SF47': { x: 36.12, y: 84.53 },
  'SF49': { x: 36.12, y: 82.40 },   // transom above SF47 — offset so both markers are clickable; drag to taste
  'SD01': { x: 36.12, y: 86.70 },   // entry door within SF47 — same idea
  'SF13A': { x: 92.27, y: 66.58 },
  'SF12B': { x: 92.28, y: 61.00 },
  'SF12A__1': { x: 92.27, y: 54.60 },
  'SF12A__2': { x: 92.27, y: 47.94 },
  'SF12A__3': { x: 92.27, y: 41.62 },
  'SF16E': { x: 92.27, y: 36.10 },
  'SF16N': { x: 90.49, y: 33.66 },
  'SF31__2': { x: 87.78, y: 31.47 },
  'SF01__3': { x: 87.78, y: 24.69 },
  'SF01__4': { x: 87.78, y: 17.41 },
  'SF06E': { x: 87.78, y: 10.87 },
  'SF17E': { x: 96.30, y: 86.27 },
  'SF12A__4': { x: 96.29, y: 80.82 },
  'SF12A__5': { x: 96.29, y: 74.42 },
  'SF15E': { x: 96.29, y: 69.12 },
  'SF15N': { x: 94.24, y: 66.55 },

  // ---- Level 2 (auto-imported from DXF: 2nd & 13th FL partial plan) ----
  'SF60': { x: 20.6, y: 77.37 },  // F-044 remapped to 2f-plan.png
  'SF61': { x: 49.28, y: 77.37 },  // F-044 remapped to 2f-plan.png
  'SF62__1': { x: 23.53, y: 19.3 },  // F-044 remapped to 2f-plan.png
  'SF62__2': { x: 60.61, y: 19.37 },  // F-044 remapped to 2f-plan.png
  'SF63__1': { x: 40.54, y: 19.37 },  // F-044 remapped to 2f-plan.png
  'SF63__2': { x: 74.77, y: 19.37 },  // F-044 remapped to 2f-plan.png
}
};
})();
