/* ============================================================
   PROJECT CONFIG — Atlantic-Chestnut Building 3
   ------------------------------------------------------------
   All project-specific data lives HERE. app.js / app-log.js /
   cloud-sync.js / chat.html / api/parse.js are CORE files,
   byte-identical across trackers — sync them freely between
   projects; never overwrite this file from another project.
   Load order: firebase-config → this file → cloud-sync →
   (elevations) → app-log → app.
   ============================================================ */
window.PROJECT = {
  name: 'Atlantic-Chestnut Building 3',
  code: 'AC3',
  // AF Hub reporting (hub-report.js) - see Downloads/af-hub/README.md
  hubId:    'ac3',
  hubUnit:  'openings',
  hubScope: 'Storefront / Curtain Wall',

  // localStorage identity — NEVER change on a live project (orphans local caches)
  storageKey:  'ac3_install_v1',
  baselineKey: 'ac3_install_v1_baseline',
  langKey:     'ac3_lang',
  fileSlug:    'ac3',

  // Door-unit id patterns (regex, case-insensitive) beyond type==='Door'
  doorPatterns: ["^SD", "^3-"],

  // true → only markers explicitly placed via Place mode render on the plan
  requirePlacedMarkers: true,

  // Submittal ball-in-court reviewers — Procore review chain, FIXED ORDER.
  // Seeded into every new submittal / new revision; always hand-editable per row.
  submittalReviewers: [
    'AKRF Inc.(Consulting)',
    'Bright Power, Inc.(Energy Efficiency)',
    'Dattner Architects',
    'Monadnock Construction'
  ],

  /* F-048: which per-unit scopes get a headline card + a marker ring. AC3 tracks three
     (CP2 tracks Caulking + Face Cover). Only the first TWO ring scopes can draw an arc —
     the marker has an upper-left and a lower-right arc, nothing more. */
  scopeKpis: [
    { scope: 'caulking',  valueId: 'kpi-caulk',     subId: 'kpi-caulk-sub',     label: 'Caulking' },
    { scope: 'beautyCap', valueId: 'kpi-beautycap', subId: 'kpi-beautycap-sub', label: 'Beauty Cap' }
  ],
  ringScopes: [
    { scope: 'caulking',  cls: 'scope-caulk', labelKey: 'legend_caulk' },
    { scope: 'beautyCap', cls: 'scope-fc',    labelKey: 'legend_beautycap' }
  ],

  /* One-time state migrations (F-044 mechanism) — each runs once per project. */
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
  ],

  // Interior storefront id patterns (F-044) — AC3 has none yet; add "^IS" when it does
  interiorPatterns: [],

  // Project strings that override the core i18n table
  i18n: {
    en: { header_sub: "Monadnock · Ground Floor · Storefront Install & Glass Tracking", img_alt_gf: "Atlantic-Chestnut Building 3 — Ground Floor Plan" },
    zh: { header_sub: "Monadnock · 一层 · 店面安装与玻璃追踪", img_alt_gf: "Atlantic-Chestnut Building 3 — 一层平面图" },
    ko: { header_sub: "Monadnock · 지상층 · 스토어프론트 설치 및 유리 추적", img_alt_gf: "Atlantic-Chestnut Building 3 — 지상층 평면도" }
  },

  // Scope baseline (seeds cloud/localStorage on first run or after /state reset)
  seedUnits: [
  { key:'SF01', id:'SF01', type:'Storefront', zone:'Lobby', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Residential Lobby \u00b7 5 Vision Lites +1 Door \u00b7 254.0 sf" },
  { key:'SF02', id:'SF02', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Storefront \u00b7 2 Vision Lites \u00b7 87.8 sf" },
  { key:'SF03', id:'SF03', type:'Storefront', zone:'Lobby', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Chestnut Residential Lobby \u00b7 3 Vision Lites +1 Door \u00b7 185.7 sf" },
  { key:'SF04', id:'SF04', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail Storefront \u00b7 5 Vision Lites +1 Door \u00b7 286.7 sf" },
  { key:'SF05', id:'SF05', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail Storefront \u00b7 7 Vision Lites \u00b7 332.1 sf" },
  { key:'SF06', id:'SF06', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail (Atlantic West) \u00b7 8 Vision Lites +1 Door \u00b7 383.6 sf" },
  { key:'SF07', id:'SF07', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail (Atlantic East) \u00b7 8 Vision Lites +1 Door \u00b7 409.1 sf" },
  { key:'SF08', id:'SF08', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail (Euclid, Bldg 3) \u00b7 9 Vision Lites +1 Door \u00b7 518.8 sf" },
  { key:'SF09', id:'SF09', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail (Atlantic) \u00b7 7 Vision Lites +1 Door \u00b7 353.1 sf" },
  { key:'SF10', id:'SF10', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail w/ Double Door \u00b7 2 Vision Lites +2 Doors \u00b7 125.9 sf" },
  { key:'SF11', id:'SF11', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail Storefront \u00b7 4 Vision Lites \u00b7 183.0 sf" },
  { key:'SF12', id:'SF12', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail Storefront \u00b7 3 Vision Lites \u00b7 152.8 sf" },
  { key:'SF13', id:'SF13', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail Storefront \u00b7 3 Vision Lites \u00b7 139.5 sf" },
  { key:'SF14', id:'SF14', type:'Storefront', zone:'Retail', level:'GF', status:'pending', date:'', louver:'yes', facecap:'yes', note:"Retail Storefront \u00b7 3 Vision Lites \u00b7 141.4 sf" },
  { key:'SF15', id:'SF15', type:'Storefront', zone:'Window', level:'GF', status:'pending', date:'', louver:'no', facecap:'yes', note:"Window Unit \u00b7 1 Vision Lite \u00b7 37.1 sf" },
  { key:'SF16', id:'SF16', type:'Storefront', zone:'Window', level:'GF', status:'pending', date:'', louver:'no', facecap:'yes', note:"Window Unit \u00b7 3 Vision Lites \u00b7 104.8 sf" },
  { key:'SF17', id:'SF17', type:'Storefront', zone:'Window', level:'GF', status:'pending', date:'', louver:'no', facecap:'yes', note:"Window Unit \u00b7 1 Vision Lite \u00b7 26.2 sf" }
],

  seedLog: [],

  defaultPositions: {}
};
