// ============================================================
//  systems.js — 系统定义(parts + accessories)
//  加新系统只改这个文件, 不用动 app.js。
//  结构: window.SYSTEM_DEFS = { '<系统名>': { parts:[...], accessories:[...] } }
//    parts:       { partNumber, description, roles:[...]  [, stockInches] }
//    accessories: { partNumber, description, rule, positions:[...], param, min, unit }
//    gasket (optional): { panel: { glass:[{part,loops}], panel:[], louver:[], door:[] },
//                         perimeterPart, doorPart }  — what a panel of each type takes.
//      Omit it and the system simply bills no gasket until someone fills it in under
//      Accessories -> Gasket defaults (stored per browser, in state.systemGaskets).
//      750XT / 45TU are seeded in app.js (SEED_SYSTEM_GASKET); a block here overrides that.
//  rule: per_piece | per_spacing | per_lf | per_lite | per_opening | per_part | per_part_len | per_panel
//  per_part / per_part_len: `positions` holds PART NUMBERS, not roles (see ACC_RULES in app.js).
//  per_panel:                `positions` holds PANEL TYPES — Glass / IMP-1 / Louver / Door.
//  app.js 读取本对象构建 SEED_PARTS / SEED_ACCESSORIES(自动补 system 与 id)。
// ============================================================
(function () {
  // IR501T / 450 共用的一套通用配件
  const GENERIC_ACC = [
    { partNumber: '', description: 'Setting Block',        rule: 'per_lite',    positions: [],                                                           param: 2,  min: 0, unit: 'ea' },
    { partNumber: '', description: 'Shear Block',          rule: 'per_piece',   positions: ['Horizontal','Transom Bar'],                                 param: 2,  min: 0, unit: 'ea' },
    { partNumber: '', description: 'Shear Block Fastener', rule: 'per_piece',   positions: ['Horizontal','Transom Bar'],                                 param: 4,  min: 0, unit: 'ea' },
    { partNumber: '', description: 'Perimeter Anchor',     rule: 'per_spacing', positions: ['Head','Sill','Jamb'],                                       param: 24, min: 2, unit: 'ea' },
    { partNumber: '', description: 'Glazing Gasket',       rule: 'per_lf',      positions: ['Head','Sill','Jamb','Horizontal','Vertical','Transom Bar'], param: 2,  min: 0, unit: 'LF' },
  ];

  window.SYSTEM_DEFS = {
    // ===== IR501T (Exterior Storefront) =====
    'IR501T': {
      parts: [
        { partNumber: '575T501', description: 'Standard Head',                      roles: ['Head'] },
        { partNumber: '575T217', description: '12" Long Thermal Filler',            roles: ['Head', 'Jamb'], stockInches: 144 },
        { partNumber: '575T500', description: 'Jamb',                               roles: ['Jamb'] },
        { partNumber: '575T511', description: 'Horizontal',                         roles: ['Horizontal'] },
        { partNumber: '575504',  description: 'Glass Stop',                         roles: ['Horizontal', 'Sill'] },
        { partNumber: '575T513', description: 'Standard Sill',                      roles: ['Sill'] },
        { partNumber: '575T537', description: 'Sill Flashing',                      roles: ['Subsill'] },
        { partNumber: '575205',  description: 'End Dam',                            roles: ['Sill'] },
        { partNumber: '575551',  description: 'Door Jamb W/ Fin',                   roles: ['Door Jamb At Transom', 'Door Jamb'] },
        { partNumber: '575133',  description: 'Transom Pocket Filler',              roles: ['Door Jamb At Transom'] },
        { partNumber: '575135',  description: 'Deep Pocket Filler',                 roles: ['Door Jamb At Transom', 'Door Jamb'] },
        { partNumber: '575122',  description: 'Transom Bar W/ Fin',                 roles: ['Transom Bar'] },
        { partNumber: '27078',   description: 'Bulb Door Weathering',               roles: ['Transom Bar', 'Door Jamb'] },
        { partNumber: '575104',  description: 'Glass Stop',                         roles: ['Transom Bar'] },
        { partNumber: '200023',  description: 'Standard 350 Top Rail',              roles: ['Transom Bar'] },
        { partNumber: '575T514', description: 'HW Tube Mullion',                    roles: ['Vertical'] },
        { partNumber: '127209',  description: 'Mating Gasket',                      roles: ['Vertical'] },
        { partNumber: '575531',  description: 'Mullion Insert Interior Half',       roles: ['Vertical'] },
        { partNumber: '575532',  description: 'Mullion Insert Exterior Half',       roles: ['Vertical'] },
        { partNumber: '128125',  description: '1/4" - 20x5/8" Fhtcms',              roles: ['Outside 90° Corner'] },
        { partNumber: '575T515', description: '90° Left Side Outside Corner Half',  roles: ['Outside 90° Corner'] },
        { partNumber: '575T535', description: '90° Right Side Outside Corner Half', roles: ['Outside 90° Corner'] },
      ],
      accessories: GENERIC_ACC,
    },

    // ===== 450 (Interior Storefront) =====
    '450': {
      parts: [
        { partNumber: '450126',   description: 'Shim Support',                   roles: ['Head', 'Jamb'] },
        { partNumber: '450CG004', description: 'Glass Stop',                     roles: ['Head', 'Horizontal', 'Sill'] },
        { partNumber: '450CG003', description: 'Head',                           roles: ['Head'] },
        { partNumber: '450CG011', description: 'Tube Horizontal',               roles: ['Horizontal'] },
        { partNumber: '450CG014', description: 'Sill',                           roles: ['Sill'] },
        { partNumber: '450VG037', description: 'HP Sill Flashing',              roles: ['Sill'] },
        { partNumber: '450VG316', description: 'End Dam',                        roles: ['Sill'] },
        { partNumber: '128407',   description: '10 x 7/16" Type I Crphtfs "B"',  roles: ['Sill'] },
        { partNumber: '28808',    description: '#8 x 1/2" PHTF "AB"',            roles: ['Sill'] },
        { partNumber: '450CG001', description: 'Mullion (Center Set)',           roles: ['Jamb', 'Vertical'] },
        { partNumber: '450CG002', description: 'Shallow Pocket Filler',          roles: ['Vertical'] },
        { partNumber: '450022',   description: 'T-bar Glass Stop (Qty x 2)',     roles: ['Transom Bar'] },
        { partNumber: '450502',   description: 'S/A T-Bar/Header Clip Package',  roles: ['Transom Bar'] },
        { partNumber: '200020',   description: '190 Standard 2-1/4" Top Door Rail', roles: ['Transom Bar'] },
        { partNumber: '450501',   description: 'S/A Door Jamb W/ Weathering',    roles: ['Door Jamb'] },
        { partNumber: '200002',   description: '"190" Lock/Pivot Stile',         roles: ['Door Jamb'] },
      ],
      accessories: GENERIC_ACC,
    },

    // ===== 1600 (10-1/2″) — composition A (HV-HS 工作簿 Sheet1 A) =====
    // roles 按 162901EN 指南/常规: 162064=竖梃, 162065=横档; 门件归 Door Jamb/Transom Bar(可调)。
    '1600 (10-1/2″)': {
      parts: [
        { partNumber: '162064', description: 'Mullion (Vertical)',      roles: ['Vertical', 'Jamb'] },
        { partNumber: '162065', description: 'Mullion (Horizontal)',    roles: ['Horizontal', 'Head', 'Sill'] },
        { partNumber: '162006', description: 'Cover',                   roles: ['Vertical', 'Jamb', 'Horizontal', 'Head', 'Sill'] },
        { partNumber: '162071', description: 'Interior Cover',          roles: ['Vertical', 'Jamb', 'Horizontal', 'Head', 'Sill'] },
        { partNumber: '162528', description: 'Pressure Plate',          roles: ['Vertical', 'Jamb', 'Horizontal', 'Head', 'Sill'] },
        { partNumber: '162215', description: 'Pressure Plate (Perim.)', roles: ['Head', 'Sill', 'Jamb'] },
        { partNumber: '162043', description: 'Door Adapter',            roles: ['Door Jamb', 'Door Jamb At Transom'] },
        { partNumber: '450520', description: 'Door Stop',               roles: ['Door Jamb'] },
        { partNumber: '450502', description: 'Header W/ Weathering',    roles: ['Transom Bar'] },
        { partNumber: '450506', description: 'T Bar',                   roles: ['Transom Bar'] },
      ],
      accessories: [
        { partNumber: '162347', description: 'Shear Block',               rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162348', description: 'Shear Block Clip',          rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '128396', description: 'Shear Blk→Vert Fastener',   rule: 'per_piece', positions: ['Horizontal'],                                 param: 4,   min: 0, unit: 'ea' },
        { partNumber: '128284', description: 'Shear Blk→Horiz Fastener',  rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '128267', description: 'Shear Blk→Horiz Fastener',  rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '128406', description: 'Pressure Plate Fastener',   rule: 'per_lf',    positions: [],                                             param: 1.8, min: 0, unit: 'ea' },
        { partNumber: '027853', description: 'Setting Block (1" Infill)', rule: 'per_lite',  positions: [],                                             param: 2,   min: 0, unit: 'ea' },
        { partNumber: '027855', description: 'Side Block (1" Infill)',    rule: 'per_lite',  positions: [],                                             param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162320', description: 'Jamb Mullion Anchor',       rule: 'per_piece', positions: ['Jamb'],                                       param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162321', description: 'Joint Plug',                rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162388', description: 'Vertical End Caps',         rule: 'per_piece', positions: ['Vertical','Jamb'],                            param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162355', description: 'T Anchor',                  rule: 'per_piece', positions: ['Vertical'],                                   param: 1,   min: 0, unit: 'ea' },
        { partNumber: '162354', description: 'F Anchor',                  rule: 'per_piece', positions: ['Vertical'],                                   param: 1,   min: 0, unit: 'ea' },
        { partNumber: '162310', description: 'Thermal Separator',         rule: 'per_lf',    positions: ['Vertical','Jamb','Horizontal','Head','Sill'], param: 1,   min: 0, unit: 'LF' },
        { partNumber: '027857', description: 'Perimeter Weathering',      rule: 'per_lf',    positions: ['Head','Sill','Jamb'],                         param: 1,   min: 0, unit: 'LF' },
        { partNumber: '027850', description: 'Glass Weathering',          rule: 'per_lf',    positions: ['Vertical','Jamb','Horizontal','Head','Sill'], param: 2,   min: 0, unit: 'LF' },
        { partNumber: '027078', description: 'Door Weathering',           rule: 'per_lf',    positions: ['Door Jamb','Transom Bar'],                    param: 1,   min: 0, unit: 'LF' },
      ],
    },

    // ===== 1600 (7-13/16″) — composition B (HV-HS 工作簿 Sheet1 B) =====
    '1600 (7-13/16″)': {
      parts: [
        { partNumber: '162004', description: 'Mullion (Vertical)',      roles: ['Vertical', 'Jamb'] },
        { partNumber: '162095', description: 'Head/Sill Horizontal',    roles: ['Horizontal', 'Head', 'Sill'] },
        { partNumber: '162239', description: 'Cover (3")',              roles: ['Vertical', 'Jamb', 'Horizontal', 'Head', 'Sill'] },
        { partNumber: '162528', description: 'Pressure Plate',          roles: ['Vertical', 'Jamb', 'Horizontal', 'Head', 'Sill'] },
        { partNumber: '162517', description: 'Pressure Plate (Perim.)', roles: ['Head', 'Sill', 'Jamb'] },
        { partNumber: '162020', description: 'Filler',                  roles: ['Head', 'Sill', 'Jamb'] },
        { partNumber: '162317', description: 'Shim Filler',             roles: ['Head', 'Sill', 'Jamb'] },
        { partNumber: '162378', description: 'Shear Block (SL)',        roles: ['Horizontal'] },
        { partNumber: '162043', description: 'Door Adapter',            roles: ['Door Jamb', 'Door Jamb At Transom'] },
        { partNumber: '450520', description: 'Door Stop',               roles: ['Door Jamb'] },
        { partNumber: '450502', description: 'Header W/ Weathering',    roles: ['Transom Bar'] },
        { partNumber: '450506', description: 'T Bar',                   roles: ['Transom Bar'] },
      ],
      accessories: [
        { partNumber: '162332', description: 'Shear Block',               rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '128394', description: 'Shear Blk→Vert Fastener',   rule: 'per_piece', positions: ['Horizontal'],                                 param: 4,   min: 0, unit: 'ea' },
        { partNumber: '128405', description: 'Shear Blk→Horiz Fastener',  rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '128406', description: 'Pressure Plate Fastener',   rule: 'per_lf',    positions: [],                                             param: 1.8, min: 0, unit: 'ea' },
        { partNumber: '162310', description: 'Thermal Separator',         rule: 'per_lf',    positions: ['Vertical','Jamb','Horizontal','Head','Sill'], param: 1,   min: 0, unit: 'LF' },
        { partNumber: '027857', description: 'Perimeter Weathering',      rule: 'per_lf',    positions: ['Head','Sill','Jamb'],                         param: 1,   min: 0, unit: 'LF' },
        { partNumber: '027850', description: 'Glass Weathering',          rule: 'per_lf',    positions: ['Vertical','Jamb','Horizontal','Head','Sill'], param: 2,   min: 0, unit: 'LF' },
        { partNumber: '027853', description: 'Setting Block (1" Infill)', rule: 'per_lite',  positions: [],                                             param: 2,   min: 0, unit: 'ea' },
        { partNumber: '027855', description: 'Side Block',                rule: 'per_lite',  positions: [],                                             param: 2,   min: 0, unit: 'ea' },
        { partNumber: '027078', description: 'Door Weathering',           rule: 'per_lf',    positions: ['Door Jamb','Transom Bar'],                    param: 1,   min: 0, unit: 'LF' },
        { partNumber: '162288', description: 'Perimeter Vert End Caps',   rule: 'per_piece', positions: ['Vertical','Jamb'],                            param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162320', description: 'Jamb Mullion Anchor',       rule: 'per_piece', positions: ['Jamb'],                                       param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162321', description: 'Joint Plug',                rule: 'per_piece', positions: ['Horizontal'],                                 param: 2,   min: 0, unit: 'ea' },
        { partNumber: '162312', description: 'T Anchor',                  rule: 'per_piece', positions: ['Vertical'],                                   param: 1,   min: 0, unit: 'ea' },
        { partNumber: '162311', description: 'F Anchor',                  rule: 'per_piece', positions: ['Vertical'],                                   param: 1,   min: 0, unit: 'ea' },
      ],
    },

    // ===== YKK AP 750XT (Exterior Storefront) — AC3 =====
    // 料表来源: elevations/750XT parts.xlsx(位置→颜色→料件清单)。占位料号 A/B/C 照抄(待换真号)。
    // Stock 全部 24ft(=288"=默认 STOCK_INCHES, 故不设 stockInches)。
    // (X)=louver 段构件, (Lv)=louver 中竖梃, (wide)=宽竖梃 —— 这些变体角色由 step4 louver 检测产出。
    '750XT': {
      parts: [
        { partNumber: 'BE9-3904', description: 'Head/Sill (Open Back)',      roles: ['Head', 'Sill', 'Head (X)', 'Sill (X)', 'Sill (normal)'] },
        { partNumber: 'E9-3162',  description: 'Flush Filler',               roles: ['Head', 'Sill', 'Head (X)', 'Sill (X)', 'Sill (normal)'] },
        { partNumber: 'AS-3907',  description: 'Permimeter Pressure Plate',  roles: ['Head (X)', 'Sill (X)', 'Jamb (X)', 'Jamb', 'Door Jamb', 'Sill (normal)'] },
        { partNumber: 'E9-1206',  description: 'Face Cover',                 roles: ['Head', 'Head (X)', 'Sill (X)', 'Sill (normal)', 'Horizontal', 'Horizontal (Glass & Glass)', 'Horizontal (X)', 'Jamb', 'Jamb (X)', 'Door Jamb', 'Vertical', 'Vertical (X)'] },
        { partNumber: 'A',        description: 'Pressure Plate',             roles: ['Head', 'Head (X)', 'Horizontal (X)'] },
        { partNumber: 'A',        description: 'Pocket Filler',              roles: ['Sill (X)', 'Jamb (X)', 'Vertical (X)', 'Vertical (wide X)'] }, // Vertical (Lv)/(X)/(wide X): ×2 per mullion(占位, 换真号时按 ×2 处理)
        { partNumber: 'AS-3906',  description: 'Pressure Plate',             roles: ['Head', 'Horizontal', 'Horizontal (Glass & Glass)', 'Horizontal (X)', 'Vertical', 'Vertical (X)'] },
        { partNumber: 'BE9-3910', description: 'Horizontal/Vertical',        roles: ['Horizontal', 'Horizontal (Glass & Glass)', 'Horizontal (X)', 'Jamb', 'Jamb (X)', 'Door Jamb', 'Vertical', 'Vertical (X)'] },
        { partNumber: 'B',        description: 'Permimeter Pressure Plate',  roles: ['Sill'] },
        { partNumber: 'C',        description: 'Face Cover',                 roles: ['Sill'], continuous: true }, // 连续覆盖 sill 整跑,不被竖梃打断(跑长出料,subsill 同逻辑)
        { partNumber: 'BY7-9065', description: 'Vertical (Wide)',            roles: ['Vertical (wide)', 'Vertical (wide X)'] },
        { partNumber: 'AS-7110',  description: 'Pressure Plate (Wide)',      roles: ['Vertical (wide)', 'Vertical (wide X)'] },
        { partNumber: 'E9-1660',  description: 'Face Cover (Wide)',          roles: ['Vertical (wide)', 'Vertical (wide X)'] },
      ],
      // #imp1-roles-retired (2026-08-20, Leo): the Jamb (IMP-1)/Vertical (IMP-1)/Vertical (wide
      // IMP-1) role variants are RETIRED. They always used the same hardware as their plain
      // counterparts — the only thing that differed was the gasket, and the gasket is now taken
      // off per infill panel (app.js PANEL_GASKET_DEFAULTS + the editable panel map) instead of
      // per framing role. Legacy cuts/pins holding an (IMP-1) label collapse to the base role via
      // ROLE_REMAP / normalizeImp1RoleToBase.
      // #acc-750xt (2026-08-20, Leo): fastener / hardware / anchor rules, from YKK 04-4014-25
      // (YCW 750 XT installation manual, eff. 2025-01-02) cross-checked against the formulas
      // already living in Leo's own "750XT / 45TU takeoff.xlsx". Page refs are PDF pages.
      // Gaskets are NOT here — they are taken off per infill panel at DXF import (buildElevExport /
      // computeAccessories), which is a geometry question, not a role rule.
      accessories: [
        // --- Hardware ---
        // p26 STEP 5: a standard shear block attaches each horizontal to a jamb or mullion — one
        // at each end of every horizontal. Leo's sheet carried this as a flat "44 openings × 8";
        // 4 horizontals × 2 ends is the same 8, and per-piece is exact on irregular elevations.
        { partNumber: 'E1-3504', description: 'Standard Shear Block (5-1/4" depth)', rule: 'per_piece',
          positions: ['Head', 'Head (X)', 'Sill', 'Sill (X)', 'Sill (Glass)', 'Sill (IMP-1)', 'Horizontal',
                      'Horizontal (X)', 'Horizontal(Y)', 'Horizontal (Glass & Glass)', 'Transom Bar'],
          param: 2, min: 0, unit: 'ea' },
        // Leo 2026-08-20: "install setting block chairs and rubber/silicone setting blocks at the
        // 1/4 points of the daylight opening (D.L.O.) along the sill or intermediate horizontal
        // member — so 2 for each panel (not just lite because imp-1 panel needs setting block too)".
        // Hence per_panel × 2 over Glass + IMP-1: two blocks per panel, at the quarter points.
        // Louver and door panels take none. Reads the panel map, so a hand-drawn or re-typed panel
        // moves this count with it. Deliberately NOT in the parts library: as parts they would be
        // FFD-nested onto 24′ bar and drawn on the cutting diagram.
        { partNumber: 'E1-3603', description: 'Setting Block Chair (2 per panel @ 1/4 points of D.L.O.)',
          rule: 'per_panel', positions: ['Glass', 'IMP-1'], param: 2, min: 0, unit: 'ea' },
        { partNumber: 'E2-0513', description: 'Setting Block (2 per panel @ 1/4 points of D.L.O.)',
          rule: 'per_panel', positions: ['Glass', 'IMP-1'], param: 2, min: 0, unit: 'ea' },
        // --- Fastener --- (all hang off another part; `positions` = part numbers)
        // p6 + p26/p27 STEP 5 + p47: "(2) HF-2510-W1 fasteners per block"
        { partNumber: 'HF-2510-W1', description: '1/4"-20 x 5/8" HWHS Type F — shear block to vertical',
          rule: 'per_part', positions: ['E1-3504'], param: 2, min: 0, unit: 'ea' },
        // p6 + p46/p47 STEP 16: "attach them to the shear blocks at each end with two FC-1220"
        // → 2 per shear block, same count as HF-2510-W1.
        { partNumber: 'FC-1220', description: '#12 x 1-1/4" FHSMS Type AB — horizontal to shear block',
          rule: 'per_part', positions: ['E1-3504'], param: 2, min: 0, unit: 'ea' },
        // p62 STEP 28: "Pressure plate stock lengths are factory punched with 0.281" diameter holes
        // at 9" O.C. maximum" (torque to 30 in-lb, bottom up). Same 9" in the 1" and 1-1/2" tables.
        { partNumber: 'HD-2516-W3-SS', description: '1/4"-20 x 1" HWHMS Type CA SS — pressure plate to mullion',
          rule: 'per_part_len', positions: ['AS-3906', 'AS-3907', 'AS-7110'], param: 9, min: 0, unit: 'ea' },
        // p6 + p46: corner shear blocks (E1-3501A/3503A/3506A) take FC-1212 instead of FC-1220.
        // AC3 has no 90° outside corners, so this stays at 0 — kept so it is visible, not forgotten.
        { partNumber: 'FC-1212', description: '#12 x 3/4" FHSMS Type AB — horizontal to CORNER shear block',
          rule: 'per_part', positions: ['E1-3504A'], param: 2, min: 0, unit: 'ea' },
        // --- Anchor --- (YKK gives no quantity: p47/p49 "per approved shop drawings", p3 note 9
        // "system-to-structure fasteners are not supplied by YKK AP". Leo: "always follow excel",
        // so these carry the basis from his own workbook's ACCESSORIES block and are his to edit.)
        { partNumber: 'E1-1234', description: 'Jamb "F" End Anchor (for BE9-3901) — per shop drawings',
          rule: 'per_opening', positions: [], param: 8, min: 0, unit: 'ea' },
        { partNumber: 'E1-1222', description: 'Intermediate Vertical "T" End Anchor (for BE9-3901 & E9-3401) — per shop drawings',
          rule: 'per_piece', positions: ['Vertical', 'Vertical (X)', 'Vertical (wide)', 'Vertical (wide X)'],
          param: 1, min: 0, unit: 'ea' },
      ],
    },

    // ===== YKK AP 45TU (Storefront) — from elevations/45TU parts.xlsx =====
    // Glazing gasket E2-0052 is per-role (count = runs along the member), NOT the 750XT perimeter model.
    '45TU': {
      parts: [
        { partNumber: 'BE9-2553', description: 'Head/Mullion/Jamb',        roles: ['Head', 'Jamb', 'Vertical'] },
        { partNumber: 'E9-1038',  description: 'Flat Filler',              roles: ['Jamb', 'Head', 'Sill'] },
        { partNumber: 'BE9-2552', description: 'Pocket Filler (Slotted)',  roles: ['Vertical'] },
        { partNumber: 'BE9-2566', description: '90° Corner Mullion',       roles: ['Corner'] },
        { partNumber: 'BE9-2567', description: '90° Corner Mullion',       roles: ['Corner'] },
        { partNumber: 'AS-0411',  description: 'Single Acting Door Jamb',  roles: ['Door Jamb'] },
        { partNumber: 'E9-1019',  description: 'Deep Pocket Filler',       roles: ['Door Jamb'] },
        { partNumber: 'BE9-2556', description: 'Horizontal',               roles: ['Horizontal'] },
        { partNumber: 'E9-1015',  description: 'Glass Stop',               roles: ['Horizontal', 'Sill'] },
        { partNumber: 'BE9-2579', description: 'Sill',                     roles: ['Sill'] },
        { partNumber: 'AS-0412',  description: 'Single Acting Door Head',  roles: ['Transom Bar'] },
        { partNumber: 'E9-0413',  description: 'Transom Glass Stop',       roles: ['Transom Bar'] },
      ],
      accessories: [
        // #gasket-per-system (2026-08-20, Leo: "45TU 为什么没有 gasket diagram，也得算"): the two
        // per-role E2-0052 rows that used to live here (2×LF on Jamb/Door Jamb/Head/Sill, 4×LF on
        // Vertical/Corner/Horizontal) are GONE — 45TU's glazing gasket is taken off per panel now,
        // in SYSTEM_GASKET (app.js), at 2 loops of E2-0052 per panel. That is the same arithmetic:
        // a perimeter member borders one panel and an interior member borders two, so 2 loops per
        // panel reproduces 2×L and 4×L respectively. Keeping both would have doubled the gasket.
        { partNumber: 'E1-1058', description: 'Shear Block (Sill/Horizontal, 1/end)', rule: 'per_piece', positions: ['Sill', 'Horizontal'], param: 2, min: 0, unit: 'ea' },
        { partNumber: 'E1-1059', description: 'Shear Block (Head, 1/end)',           rule: 'per_piece', positions: ['Head'],               param: 2, min: 0, unit: 'ea' },
        { partNumber: 'E2-0628', description: 'Setting Block (2/horizontal & sill)', rule: 'per_piece', positions: ['Horizontal', 'Sill'], param: 2, min: 0, unit: 'ea' },
        { partNumber: 'PC-1220', description: 'End cap (horizontal/head/sill, 2/end)', rule: 'per_piece', positions: ['Horizontal', 'Head', 'Sill'], param: 2, min: 0, unit: 'ea' },
        { partNumber: 'E2-0259', description: 'Foam Backer Tape (2/mullion top)',    rule: 'per_piece', positions: ['Vertical'],           param: 2, min: 0, unit: 'ea' },
      ],
    },
  };

  // 系统显示/默认顺序(无 mark 洞口默认取第一个; '450' 是整数样式键会被 JS 排前, 故显式固定)
  window.SYSTEM_ORDER = ['IR501T', '450', '1600 (10-1/2″)', '1600 (7-13/16″)', '750XT', '45TU'];
})();
