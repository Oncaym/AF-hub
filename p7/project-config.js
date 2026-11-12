/* ============================================================
   PROJECT CONFIG — MTA A-37811 ADA Package 7 (Forte)
   ------------------------------------------------------------
   All project-specific data lives HERE. app.js / app-log.js /
   cloud-sync.js live in /core and are shared by every tracker;
   never overwrite this file from another project.
   Load order: firebase-config → this file → cloud-sync →
   app-log → app.
   ------------------------------------------------------------
   SCOPE BASELINE (built 2026-11-12 from the Final Design-2 A-drawings,
   A37811_DU2C / DU1C, submitted for permit 10/12/2026):
     Kingsbridge Rd — 2 elevators (EL-535 east, EL-536 west):
       each elevator = 4 elevations + roof + glass canopy;
       plus control-area roofs, stair canopy roofs (P9, M5/S5, P10, M6/S6),
       windscreens and EMR enclosures.
     167th St — 2 elevators (EL-533, EL-534):
       front / 2 sides / back + platform enclosure + roof + canopy.
   37 units. Plans: KGS-A-151 (East roof plan), KGS-A-150 (West roof
   plan), 167-A-113 (platform key plan). Marker positions are a first
   guess near each elevator / roof — drag them in Place mode.
   Notes carry the lite count and sf from the 11/12 quick takeoff
   (Y:\...\1. Contract\2. Proposal\P7 Proposal Ver4 vs Final-2 quantities (11-12).xlsx).
   key is IMMUTABLE once cloud data exists — rename via id only.
   ============================================================ */
window.PROJECT = (() => {
return {
  name: 'MTA ADA Package 7',
  code: 'P7',
  // AF Hub reporting (hub-report.js)
  hubId:    'p7',
  hubUnit:  'units',
  hubScope: 'Elevator Enclosures · Roofs · Windscreen — Kingsbridge Rd & 167th St',

  // localStorage identity — NEVER change on a live project (orphans local caches)
  storageKey:  'p7_install_v1',
  baselineKey: 'p7_install_v1_baseline',
  langKey:     'p7_lang',
  fileSlug:    'p7',

  doorPatterns: [],
  interiorPatterns: [],
  submittalReviewers: [],
  scopeKpis: [],
  ringScopes: [],
  requirePlacedMarkers: false,

  /* Floors = the three plans. The FIRST one takes its image from the <img id="planImg">
     markup in index.html; the others read img/imgDark (light + pre-inverted twin) here. */
  floors: [
    { key: 'KBE',  name: { en: 'Kingsbridge East', zh: 'Kingsbridge 东 / East', ko: 'Kingsbridge 동' } },
    { key: 'KBW',  name: { en: 'Kingsbridge West', zh: 'Kingsbridge 西 / West', ko: 'Kingsbridge 서' },
      img: 'kbw-plan.png', imgDark: 'kbw-plan-white.png' },
    { key: 'S167', name: { en: '167th St', zh: '167街 / 167th St', ko: '167번가' },
      img: 's167-plan.png', imgDark: 's167-plan-white.png' }
  ],

  migrations: [],

  i18n: {
    en: { header_sub: "Forte · MTA A-37811 · Kingsbridge Rd & 167th St", img_alt_gf: "Kingsbridge East Roof Plan (KGS-A-151)" },
    zh: { header_sub: "Forte · MTA A-37811 · Kingsbridge Rd 与 167th St", img_alt_gf: "Kingsbridge 东侧屋面平面 (KGS-A-151)" },
    ko: { header_sub: "Forte · MTA A-37811 · Kingsbridge Rd & 167th St", img_alt_gf: "Kingsbridge East Roof Plan (KGS-A-151)" }
  },

  seedUnits: [
  { key:"EL535-E", id:"EL535-E", type:"Elevator Enclosure", zone:"EL-535", level:"KBE", status:'pending', date:'', louver:"no", note:"East elevation · 14 lites ≈ 124 sf · KGS-A-421" },
  { key:"EL535-S", id:"EL535-S", type:"Elevator Enclosure", zone:"EL-535", level:"KBE", status:'pending', date:'', louver:"yes", note:"South elevation · 22 lites ≈ 336 sf · KGS-A-421" },
  { key:"EL535-W", id:"EL535-W", type:"Elevator Enclosure", zone:"EL-535", level:"KBE", status:'pending', date:'', louver:"no", note:"West elevation · 14 lites ≈ 164 sf · KGS-A-421" },
  { key:"EL535-N", id:"EL535-N", type:"Elevator Enclosure", zone:"EL-535", level:"KBE", status:'pending', date:'', louver:"yes", note:"North elevation · 18 lites ≈ 289 sf · KGS-A-421" },
  { key:"EL535-RF", id:"EL535-RF", type:"Standing Seam Roof", zone:"EL-535", level:"KBE", status:'pending', date:'', louver:"na", note:"Elevator roof ≈ 163 sf · KGS-A-421" },
  { key:"EL535-CN", id:"EL535-CN", type:"Glass Canopy", zone:"EL-535", level:"KBE", status:'pending', date:'', louver:"na", note:"Street-level glass canopy · KGS-A-421" },
  { key:"EL536-E", id:"EL536-E", type:"Elevator Enclosure", zone:"EL-536", level:"KBW", status:'pending', date:'', louver:"no", note:"East elevation · 8 lites ≈ 69 sf · KGS-A-424" },
  { key:"EL536-S", id:"EL536-S", type:"Elevator Enclosure", zone:"EL-536", level:"KBW", status:'pending', date:'', louver:"yes", note:"South elevation · 19 lites ≈ 281 sf · KGS-A-424" },
  { key:"EL536-W", id:"EL536-W", type:"Elevator Enclosure", zone:"EL-536", level:"KBW", status:'pending', date:'', louver:"no", note:"West elevation · 20 lites ≈ 192 sf · KGS-A-424" },
  { key:"EL536-N", id:"EL536-N", type:"Elevator Enclosure", zone:"EL-536", level:"KBW", status:'pending', date:'', louver:"yes", note:"North elevation · 21 lites ≈ 332 sf · KGS-A-424" },
  { key:"EL536-RF", id:"EL536-RF", type:"Standing Seam Roof", zone:"EL-536", level:"KBW", status:'pending', date:'', louver:"na", note:"Elevator roof ≈ 163 sf · KGS-A-424" },
  { key:"EL536-CN", id:"EL536-CN", type:"Glass Canopy", zone:"EL-536", level:"KBW", status:'pending', date:'', louver:"na", note:"Street-level glass canopy · KGS-A-424" },
  { key:"KBE-HH-RF", id:"KBE-HH-RF", type:"Standing Seam Roof", zone:"Control Area", level:"KBE", status:'pending', date:'', louver:"na", note:"East control area / head house roof · KGS-A-151" },
  { key:"KBE-EMR-RF", id:"KBE-EMR-RF", type:"Standing Seam Roof", zone:"EMR", level:"KBE", status:'pending', date:'', louver:"na", note:"EMR EL-535 roof · KGS-A-151" },
  { key:"KBE-ST-P9", id:"KBE-ST-P9", type:"Standing Seam Roof", zone:"Stair", level:"KBE", status:'pending', date:'', louver:"na", note:"Stair P9 canopy roof · KGS-A-151" },
  { key:"KBE-ST-M5", id:"KBE-ST-M5", type:"Standing Seam Roof", zone:"Stair", level:"KBE", status:'pending', date:'', louver:"na", note:"Stair M5 / S5 canopy roof · KGS-A-151" },
  { key:"KBE-WS", id:"KBE-WS", type:"Windscreen", zone:"Control Area", level:"KBE", status:'pending', date:'', louver:"na", note:"East control area windscreen · KGS-A-545" },
  { key:"KBE-EMR", id:"KBE-EMR", type:"EMR Enclosure", zone:"EMR", level:"KBE", status:'pending', date:'', louver:"yes", note:"EMR 535 · ext. metal panel + louvers LV-4/LV-5 · KGS-A-406/604" },
  { key:"KBW-HH-RF", id:"KBW-HH-RF", type:"Standing Seam Roof", zone:"Control Area", level:"KBW", status:'pending', date:'', louver:"na", note:"West control area roof · KGS-A-150" },
  { key:"KBW-ST-P10", id:"KBW-ST-P10", type:"Standing Seam Roof", zone:"Stair", level:"KBW", status:'pending', date:'', louver:"na", note:"Stair P10 canopy roof · KGS-A-150" },
  { key:"KBW-ST-M6", id:"KBW-ST-M6", type:"Standing Seam Roof", zone:"Stair", level:"KBW", status:'pending', date:'', louver:"na", note:"Stair M6 / S6 canopy roof · KGS-A-150" },
  { key:"KBW-WS", id:"KBW-WS", type:"Windscreen", zone:"Control Area", level:"KBW", status:'pending', date:'', louver:"na", note:"West control area windscreen · KGS-A-545" },
  { key:"KBW-EMR", id:"KBW-EMR", type:"EMR Enclosure", zone:"EMR", level:"KBW", status:'pending', date:'', louver:"yes", note:"EMR 536 · ext. metal panel + louvers LV-1/2/3 · KGS-A-405/604" },
  { key:"EL534-F", id:"EL534-F", type:"Elevator Enclosure", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"no", note:"Street level Front · ≈ 59 sf glazing · 167-A-201/202" },
  { key:"EL534-L", id:"EL534-L", type:"Elevator Enclosure", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"no", note:"Street level Side (left) · ≈ 89 sf glazing · 167-A-201/202" },
  { key:"EL534-R", id:"EL534-R", type:"Elevator Enclosure", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"no", note:"Street level Side (right) · ≈ 89 sf glazing · 167-A-201/202" },
  { key:"EL534-B", id:"EL534-B", type:"Elevator Enclosure", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"yes", note:"Street level Back · ≈ 64 sf glazing + louver ≈ 23 sf · 167-A-201/202" },
  { key:"EL534-P", id:"EL534-P", type:"Elevator Enclosure", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"na", note:"Platform-level enclosure · GL-04 ≈ 110 sf · 167-A-415/416" },
  { key:"EL534-RF", id:"EL534-RF", type:"Standing Seam Roof", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"na", note:"Elevator roof ≈ 122 sf + SS gutter/fascia · 167-A-201/202" },
  { key:"EL534-CN", id:"EL534-CN", type:"Glass Canopy", zone:"EL-534", level:"S167", status:'pending', date:'', louver:"na", note:"Street-level glass canopy · 167-A-201" },
  { key:"EL533-F", id:"EL533-F", type:"Elevator Enclosure", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"no", note:"Street level Front · ≈ 59 sf glazing · 167-A-201/202" },
  { key:"EL533-L", id:"EL533-L", type:"Elevator Enclosure", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"no", note:"Street level Side (left) · ≈ 89 sf glazing · 167-A-201/202" },
  { key:"EL533-R", id:"EL533-R", type:"Elevator Enclosure", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"no", note:"Street level Side (right) · ≈ 89 sf glazing · 167-A-201/202" },
  { key:"EL533-B", id:"EL533-B", type:"Elevator Enclosure", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"yes", note:"Street level Back · ≈ 64 sf glazing + louver ≈ 23 sf · 167-A-201/202" },
  { key:"EL533-P", id:"EL533-P", type:"Elevator Enclosure", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"na", note:"Platform-level enclosure · GL-04 ≈ 110 sf · 167-A-415/416" },
  { key:"EL533-RF", id:"EL533-RF", type:"Standing Seam Roof", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"na", note:"Elevator roof ≈ 122 sf + SS gutter/fascia · 167-A-201/202" },
  { key:"EL533-CN", id:"EL533-CN", type:"Glass Canopy", zone:"EL-533", level:"S167", status:'pending', date:'', louver:"na", note:"Street-level glass canopy · 167-A-201" }
],

  seedLog: [],

  defaultPositions: {
  "EL535-E": { x: 51.00, y: 45.90 },
  "EL535-S": { x: 45.83, y: 50.98 },
  "EL535-W": { x: 40.67, y: 45.90 },
  "EL535-N": { x: 45.83, y: 40.82 },
  "EL535-RF": { x: 45.83, y: 45.90 },
  "EL535-CN": { x: 53.75, y: 51.64 },
  "EL536-E": { x: 70.60, y: 58.39 },
  "EL536-S": { x: 65.97, y: 63.39 },
  "EL536-W": { x: 61.34, y: 58.39 },
  "EL536-N": { x: 65.97, y: 53.39 },
  "EL536-RF": { x: 65.97, y: 58.39 },
  "EL536-CN": { x: 73.06, y: 64.03 },
  "KBE-HH-RF": { x: 38.33, y: 20.49 },
  "KBE-EMR-RF": { x: 32.50, y: 63.93 },
  "KBE-ST-P9": { x: 57.08, y: 55.74 },
  "KBE-ST-M5": { x: 44.17, y: 79.51 },
  "KBE-WS": { x: 50.42, y: 20.49 },
  "KBE-EMR": { x: 28.33, y: 70.49 },
  "KBW-HH-RF": { x: 59.70, y: 75.81 },
  "KBW-ST-P10": { x: 55.22, y: 51.61 },
  "KBW-ST-M6": { x: 51.49, y: 32.26 },
  "KBW-WS": { x: 64.93, y: 80.65 },
  "KBW-EMR": { x: 79.85, y: 85.48 },
  "EL534-F": { x: 36.17, y: 34.29 },
  "EL534-L": { x: 31.38, y: 28.57 },
  "EL534-R": { x: 40.96, y: 28.57 },
  "EL534-B": { x: 36.17, y: 22.86 },
  "EL534-P": { x: 26.60, y: 28.57 },
  "EL534-RF": { x: 36.17, y: 28.57 },
  "EL534-CN": { x: 45.74, y: 34.29 },
  "EL533-F": { x: 36.70, y: 72.86 },
  "EL533-L": { x: 31.91, y: 67.14 },
  "EL533-R": { x: 41.49, y: 67.14 },
  "EL533-B": { x: 36.70, y: 61.43 },
  "EL533-P": { x: 27.13, y: 67.14 },
  "EL533-RF": { x: 36.70, y: 67.14 },
  "EL533-CN": { x: 46.28, y: 72.86 }
  }
};
})();
