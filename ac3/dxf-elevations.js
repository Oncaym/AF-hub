// ============================================================
//  dxf-elevations.js  (tracker-side, PROJECT file, no CP2 sync)
//  M2-v2: in-tracker region import. Trimmed, system-INDEPENDENT port of the geometry
//  half of takeoff/app.js's parseRawDxfOpenings → buildElevExport pipeline: DXF group-code
//  parse → polyline clustering (1 cluster = 1 elevation) → door-block / louver-block /
//  metal-panel-hatch region detection → glass/louver/panel/door element grid + SVG base.
//
//  Deliberately OMITS everything system/role-dependent (dxfDetectCuts, 750XT/45TU
//  branches, role whitelist, gaskets, cut/part classification) — that stays exclusively in
//  takeoff/app.js, which now writes ONLY into elevGeo/{mark}.takeoff (merge), leaving the
//  geometry fields below (viewBox/name/base/elements) owned by this file. See memory.md
//  "M2-v2" and SONNET-HANDOFF.md for the full design.
//
//  Usage (index.html "Import DXF" button):
//    const marks = DxfElevations.parseElevationRegions(dxfText);
//    // marks: [{ key, viewBox, name, base, elements:[{id,x,y,w,h,t0}] }, ...]
//    // t0 ∈ glass|louver|panel|door — same schema takeoff/elev-cloud.js already expect.
//
//  Kept deliberately close to the takeoff/app.js source (same variable names/structure)
//  so the two parsers are easy to diff/keep in sync if the DXF conventions change.
// ============================================================
(function (global) {
  'use strict';

  // DXF layer-name config — same defaults as takeoff/app.js's LAYER_CONFIG. AC3-specific;
  // if a future project uses different layer names, override via DxfElevations.setLayerConfig().
  let LAYER_CONFIG = {
    alum: 'AF_ALUM PROFILE',
    doorSubframe: 'AF-DOOR SUBFRAME',
    outline: 'AF_OUTLINE',
    scope: 'AF SCOPE',
    door: 'A-DOOR-1',
    fallbacks: ['0', 'AF_X'],
  };
  function setLayerConfig(cfg) { LAYER_CONFIG = Object.assign({}, LAYER_CONFIG, cfg || {}); }

  // ---------- low-level DXF group-code parsing (verbatim port from takeoff/app.js) ----------
  function dxfPairs(text) {
    const lines = text.split(/\r?\n/);
    const pairs = [];
    for (let i = 0; i < lines.length - 1; i += 2) {
      const code = parseInt(lines[i].trim(), 10);
      if (!Number.isNaN(code)) pairs.push([code, lines[i + 1].trim()]);
    }
    return pairs;
  }

  function dxfCollectEntities(pairs, sectionName) {
    let section = null, pendingSection = false, current = null;
    const entities = [];
    for (const [code, value] of pairs) {
      if (code === 0 && value === 'SECTION') { pendingSection = true; continue; }
      if (pendingSection && code === 2) { section = value; pendingSection = false; continue; }
      if (code === 0 && value === 'ENDSEC') { section = null; continue; }
      if (section !== sectionName) continue;
      if (code === 0) {
        if (current) entities.push(current);
        current = { type: value, pairs: [] };
      } else if (current) {
        current.pairs.push([code, value]);
      }
    }
    if (current) entities.push(current);
    return entities;
  }

  function dxfCollectBlocks(pairs) {
    let section = null, pendingSection = false, blockName = null, current = null;
    const blockEntities = [];
    const blocks = new Map();
    for (const [code, value] of pairs) {
      if (code === 0 && value === 'SECTION') { pendingSection = true; continue; }
      if (pendingSection && code === 2) { section = value; pendingSection = false; continue; }
      if (code === 0 && value === 'ENDSEC') { section = null; continue; }
      if (section !== 'BLOCKS') continue;
      if (code === 0 && value === 'BLOCK') { blockName = null; blockEntities.length = 0; current = null; continue; }
      if (code === 0 && value === 'ENDBLK') {
        if (current) blockEntities.push(current);
        if (blockName) blocks.set(blockName, blockEntities.map(e => ({ type: e.type, pairs: [...e.pairs] })));
        current = null; blockName = null;
        continue;
      }
      if (blockName === null && code === 2) { blockName = value; continue; }
      if (blockName === null) continue;
      if (code === 0) {
        if (current) blockEntities.push(current);
        current = { type: value, pairs: [] };
      } else if (current) {
        current.pairs.push([code, value]);
      }
    }
    return blocks;
  }

  function dxfValues(entity, code) { return entity.pairs.filter(([c]) => c === code).map(([, value]) => value); }
  function dxfValue(entity, code) { const v = dxfValues(entity, code); return v.length ? v[0] : ''; }

  function dxfMtextSummary(entity) {
    return { text: dxfValue(entity, 1).trim(), x: parseFloat(dxfValue(entity, 10)), y: parseFloat(dxfValue(entity, 20)) };
  }

  function dxfInsertSummary(entity) {
    return {
      block: dxfValue(entity, 2),
      x: parseFloat(dxfValue(entity, 10)) || 0,
      y: parseFloat(dxfValue(entity, 20)) || 0,
      scaleX: parseFloat(dxfValue(entity, 41)) || 1,
      scaleY: parseFloat(dxfValue(entity, 42)) || 1,
    };
  }

  function dxfTransformEntity(entity, insert) {
    return {
      type: entity.type,
      pairs: entity.pairs.map(([code, value]) => {
        if (code === 10) return [code, String(insert.x + (parseFloat(value) || 0) * insert.scaleX)];
        if (code === 20) return [code, String(insert.y + (parseFloat(value) || 0) * insert.scaleY)];
        return [code, value];
      }),
    };
  }

  function dxfPolylineSummary(entity) {
    const xs = dxfValues(entity, 10).map(Number);
    const ys = dxfValues(entity, 20).map(Number);
    const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
    return {
      handle: dxfValue(entity, 5), layer: dxfValue(entity, 8),
      minX, maxX, minY, maxY, width: maxX - minX, height: maxY - minY,
      centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2,
    };
  }

  function dxfRound(value) { return Math.round(value * 1000) / 1000; }

  // Spatial union-find clustering of polylines by bbox proximity — 1 cluster = 1 elevation.
  function clusterPolys(polys, eps) {
    if (!polys.length) return [];
    const n = polys.length;
    const parent = Array.from({ length: n }, (_, i) => i);
    function find(x) { while (parent[x] !== x) { parent[x] = parent[parent[x]]; x = parent[x]; } return x; }
    function union(a, b) { const ra = find(a), rb = find(b); if (ra !== rb) parent[ra] = rb; }
    const GRID = 50;
    const buckets = new Map();
    for (let i = 0; i < n; i++) {
      const p = polys[i];
      for (let bx = Math.floor(p.minX / GRID); bx <= Math.floor(p.maxX / GRID) + 1; bx++) {
        for (let by = Math.floor(p.minY / GRID); by <= Math.floor(p.maxY / GRID) + 1; by++) {
          const key = bx + ',' + by;
          if (!buckets.has(key)) buckets.set(key, []);
          buckets.get(key).push(i);
        }
      }
    }
    function near(a, b) { return !(a.maxX + eps < b.minX || b.maxX + eps < a.minX || a.maxY + eps < b.minY || b.maxY + eps < a.minY); }
    const checked = new Set();
    for (const [key, list] of buckets) {
      const [bx, by] = key.split(',').map(Number);
      for (const i of list) {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
          const nbrs = buckets.get((bx + dx) + ',' + (by + dy));
          if (!nbrs) continue;
          for (const j of nbrs) {
            if (i >= j) continue;
            const k = i + ',' + j;
            if (checked.has(k)) continue;
            checked.add(k);
            if (near(polys[i], polys[j])) union(i, j);
          }
        }
      }
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) { const r = find(i); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(polys[i]); }
    const clusters = [];
    for (const members of groups.values()) {
      if (members.length < 3) continue;
      let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
      for (const m of members) { minX = Math.min(minX, m.minX); minY = Math.min(minY, m.minY); maxX = Math.max(maxX, m.maxX); maxY = Math.max(maxY, m.maxY); }
      const w = maxX - minX, h = maxY - minY;
      if (w < 5 || h < 5) continue;
      clusters.push({ bbox: { minX, minY, maxX, maxY, width: w, height: h, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 }, polys: members, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2 });
    }
    return clusters;
  }

  // ---------- SVG base + glass/louver/panel/door element grid (verbatim port of buildElevExport;
  // confirmed system/cut-independent in takeoff/app.js — no `cuts`/`system` param there either) ----------
  function buildElevExport(mark, c, pool, louverBand, doorRegions, structuralPolys, panelStrips, byOthersZones) {
    const bb = c.bbox;
    const boards = structuralPolys.filter(p => p.width >= p.height && p.height <= 12 &&
      p.centerX >= bb.minX - 2 && p.centerX <= bb.maxX + 2 && p.centerY >= bb.minY - 2 && p.centerY <= bb.maxY + 2);
    const s = 400 / bb.height;
    const X = v => +(((v - bb.minX) * s).toFixed(1));
    const Y = v => +(((bb.maxY - v) * s).toFixed(1));
    const W = v => +((v * s).toFixed(1));
    let base = '<g fill="none" stroke="#3fa0ff" stroke-width="0.6">';
    for (const p of c.polys) base += `<rect x="${X(p.minX)}" y="${Y(p.maxY)}" width="${W(p.width)}" height="${W(p.height)}"/>`;
    for (const p of boards) base += `<rect x="${X(p.minX)}" y="${Y(p.maxY)}" width="${W(p.width)}" height="${W(p.height)}"/>`;
    if (louverBand) {
      const lx1 = X(Math.max(louverBand.minX, bb.minX)), lx2 = X(Math.min(louverBand.maxX, bb.maxX));
      for (let ly = louverBand.minY + 2; ly < louverBand.maxY; ly += 4) base += `<line x1="${lx1}" y1="${Y(ly)}" x2="${lx2}" y2="${Y(ly)}"/>`;
    }
    base += '</g>';
    const els = []; let n = 0;
    const louverBays = new Set();
    const add = (x1, y1, x2, y2, t0) => { els.push({ id: mark + '-' + (++n), x: X(x1), y: Y(y2), w: W(x2 - x1), h: W(y2 - y1), t0 }); };
    const H = pool.filter(p => p.width > p.height && p.height >= 1);
    const V = pool.filter(p => p.height > p.width && p.width >= 1);
    const vxs = [...new Set(V.map(v => Math.round(v.centerX)))].sort((a, b) => a - b);
    const inDoor = (x1, x2, y1, y2) => doorRegions.some(d => x1 >= d.minX - 3 && x2 <= d.maxX + 3 && (y1 + y2) / 2 < d.headY);
    for (let i = 0; i + 1 < vxs.length; i++) {
      const xL = vxs[i], xR = vxs[i + 1], cx = (xL + xR) / 2;
      const rows = [...new Set(H.filter(h => h.minX <= cx && h.maxX >= cx).map(h => +h.centerY.toFixed(1)))].sort((a, b) => a - b);
      for (let j = 0; j + 1 < rows.length; j++) {
        const y1 = rows[j], y2 = rows[j + 1];
        if (y2 - y1 < 4) continue;
        if (inDoor(xL, xR, y1, y2)) continue;
        const cy = (y1 + y2) / 2;
        const isLv = louverBand && cy >= louverBand.minY - 3 && cy <= louverBand.maxY + 3 && cx >= louverBand.minX - 10 && cx <= louverBand.maxX + 10;
        const inZone = (byOthersZones || []).some(z => {
          const ox = Math.min(xR, z.maxX) - Math.max(xL, z.minX), oy = Math.min(y2, z.maxY) - Math.max(y1, z.minY);
          return ox > 0 && oy > 0 && (ox * oy) > 0.6 * (xR - xL) * (y2 - y1);
        });
        if (inZone) continue;
        const inStrip = (panelStrips || []).some(sp => cy >= sp.minY - 2 && cy <= sp.maxY + 2 && Math.min(xR, sp.maxX) - Math.max(xL, sp.minX) > (xR - xL) * 0.5);
        const _t0 = inStrip ? 'panel' : (isLv ? 'louver' : 'glass'); if (_t0 === 'louver') louverBays.add(i); add(xL, y1, xR, y2, _t0);
      }
    }
    if (louverBand) { for (let i = 0; i + 1 < vxs.length; i++) { const xL = vxs[i], xR = vxs[i + 1], cx = (xL + xR) / 2; if (cx < louverBand.minX - 10 || cx > louverBand.maxX + 10) continue; if (louverBays.has(i)) continue; if (inDoor(xL, xR, louverBand.minY, louverBand.maxY)) continue; add(xL, louverBand.minY, xR, louverBand.maxY, 'louver'); } }
    for (const d of doorRegions) add(d.minX, bb.minY, d.maxX, d.headY, 'door');
    for (const p of boards) add(p.minX, p.minY, p.maxX, p.maxY, 'panel');
    return { key: mark, viewBox: `0 0 ${+(bb.width * s).toFixed(1)} 400`, name: mark, base, elements: els };
  }

  // ---------- main entry: trimmed port of parseRawDxfOpenings, geometry-only ----------
  // NOTE: the takeoff parser's `minLen` (shortest admitted profile) is 8" for 750XT, else 10";
  // since this port has no system, it uses 8" (matches AC3's dominant 750XT system) — the only
  // effect of the difference is whether very short (8-10") infill members appear as extra grid
  // lines; does not affect role/part classification (owned entirely by takeoff/app.js).
  function parseElevationRegions(text) {
    if (!/\bSECTION\b/i.test(text) || !/\bENTITIES\b/i.test(text)) return [];
    const pairs = dxfPairs(text);
    const entities = dxfCollectEntities(pairs, 'ENTITIES');
    const blocks = dxfCollectBlocks(pairs);
    const allEntities = [...entities];

    const doorRegionsAll = [];
    const louverRegionsAll = [];
    const blockSig = name => { const b = blocks.get(name) || []; let lw = 0, ln = 0; for (const e of b) { if (/LWPOLYLINE/i.test(e.type)) lw++; else if (e.type === 'LINE') ln++; } return lw + '/' + ln; };
    const doorKindOf = name => { const s = blockSig(name); return s === '12/11' ? 'SINGLE' : (s === '22/6' ? 'DOUBLE' : null); };
    const isLouverBlock = name => { const b = blocks.get(name) || []; let lw = 0, ln = 0; for (const e of b) { if (/LWPOLYLINE/i.test(e.type)) lw++; else if (e.type === 'LINE') ln++; } return (lw === 0 && ln >= 24) || /louver/i.test(name); };
    for (const insert of entities.filter(e => e.type === 'INSERT').map(dxfInsertSummary)) {
      const block = blocks.get(insert.block);
      if (!block) continue;
      const kind = doorKindOf(insert.block);
      const kids = block.map(child => dxfTransformEntity(child, insert));
      for (const child of kids) { if (kind) child.__door = 1; allEntities.push(child); }
      if (kind) {
        const dp = kids.map(dxfPolylineSummary).filter(p => p && p.layer === LAYER_CONFIG.alum && (p.width > 0 || p.height > 0));
        if (dp.length) doorRegionsAll.push({ kind, minX: Math.min(...dp.map(p => p.minX)), maxX: Math.max(...dp.map(p => p.maxX)), headY: Math.max(...dp.map(p => p.maxY)) });
      } else if (isLouverBlock(insert.block)) {
        const lp = kids.map(dxfPolylineSummary).filter(p => p);
        if (lp.length) louverRegionsAll.push({ minX: Math.min(...lp.map(p => p.minX)), maxX: Math.max(...lp.map(p => p.maxX)), minY: Math.min(...lp.map(p => p.minY)), maxY: Math.max(...lp.map(p => p.maxY)) });
      }
    }

    const hatchBoxes = [];
    for (const e of allEntities) {
      if (!/^HATCH$/i.test(e.type)) continue;
      const lay = dxfValue(e, 8);
      if (lay !== 'AF_HATCH' && lay !== 'AF_GENERAL') continue;
      const xs = [], ys = [];
      for (let k = 0; k + 1 < e.pairs.length; k++) {
        const c1 = e.pairs[k][0], c2 = e.pairs[k + 1][0];
        if ((c1 === 10 || c1 === 11) && (c2 === 20 || c2 === 21)) {
          const x = parseFloat(e.pairs[k][1]), y = parseFloat(e.pairs[k + 1][1]);
          if (Math.abs(x) > 1 && Math.abs(y) > 1) { xs.push(x); ys.push(y); }
        }
      }
      if (!xs.length) continue;
      hatchBoxes.push({ layer: lay, minX: Math.min(...xs), maxX: Math.max(...xs), minY: Math.min(...ys), maxY: Math.max(...ys) });
    }

    const profiles = allEntities
      .filter(e => /POLYLINE|LWPOLYLINE/i.test(e.type) || e.type === 'LINE')
      .map(e => { const s = dxfPolylineSummary(e); if (s && e.__door) s.__door = 1; return s; })
      .filter(p => p && p.width >= 0 && p.height >= 0);
    const flashingLike = p => p.height < 1 && p.width > 10;
    const alumDoorPolys = profiles.filter(p =>
      p.layer === LAYER_CONFIG.alum || p.layer === LAYER_CONFIG.doorSubframe || LAYER_CONFIG.fallbacks.includes(p.layer) ||
      ((p.layer === LAYER_CONFIG.outline || p.layer === LAYER_CONFIG.scope) && flashingLike(p)));

    const labels = allEntities
      .filter(e => /^M?TEXT$/i.test(e.type))
      .map(dxfMtextSummary)
      .filter(t => t && /^(WS|WN|SF)\d+$/i.test(t.text))
      .map((t, i) => ({ ...t, id: i, text: t.text.toUpperCase() }));
    const marksByName = {};
    for (const l of labels) (marksByName[l.text] = marksByName[l.text] || []).push(l);
    for (const name in marksByName) {
      const grp = marksByName[name].sort((a, b) => a.x - b.x);
      grp.forEach((l, i) => { l.display = grp.length > 1 ? `${name}.${i + 1}` : name; });
    }

    const isStructural = p => !p.__door && Math.max(p.width, p.height) >= 24 && (p.height > p.width ? p.width >= 12 : p.height >= 6);
    const structuralPolys = alumDoorPolys.filter(isStructural);
    const framePolys = alumDoorPolys.filter(p => !isStructural(p));
    const isFrameLayer = p => p.__door || p.layer === LAYER_CONFIG.alum || p.layer === LAYER_CONFIG.doorSubframe;
    const clusterInput = framePolys.filter(isFrameLayer);
    const clusters = clusterPolys(clusterInput, 20);
    for (const p of framePolys) {
      if (isFrameLayer(p)) continue;
      let best = null, bestOv = 0;
      for (const c of clusters) {
        const ov = Math.max(0, Math.min(p.maxX, c.bbox.maxX) - Math.max(p.minX, c.bbox.minX));
        if (ov > bestOv) { bestOv = ov; best = c; }
      }
      if (best && bestOv > 0) best.polys.push(p);
    }

    const results = [];
    const used = new Set();
    const minLen = 8; // see NOTE above
    for (const c of clusters) {
      let best = null, bestD = 1e9;
      for (const lbl of labels) {
        if (used.has(lbl.id)) continue;
        if (lbl.x < c.bbox.minX - 3 || lbl.x > c.bbox.maxX + 3) continue;
        const d = Math.hypot(lbl.x - c.centerX, lbl.y - c.centerY);
        if (d < bestD) { bestD = d; best = lbl; }
      }
      if (best) used.add(best.id);
      const mark = best ? best.display : `EL-${String(results.length + 1).padStart(2, '0')}`;

      const louverBands = louverRegionsAll.filter(l => { const cx = (l.minX + l.maxX) / 2; return cx >= c.bbox.minX - 3 && cx <= c.bbox.maxX + 3; });
      const louverBand = louverBands.length ? {
        minX: Math.min(...louverBands.map(l => l.minX)), maxX: Math.max(...louverBands.map(l => l.maxX)),
        minY: Math.min(...louverBands.map(l => l.minY)), maxY: Math.max(...louverBands.map(l => l.maxY)),
      } : null;

      const alumPool = c.polys.filter(p => !p.__door && (
        (Math.min(p.width, p.height) >= 1 && Math.max(p.width, p.height) >= minLen) ||
        (p.height < 1 && p.width > 10)));

      const doorRegions = doorRegionsAll.filter(d => { const cx = (d.minX + d.maxX) / 2; return cx >= c.bbox.minX - 3 && cx <= c.bbox.maxX + 3; });

      const stripHatches = hatchBoxes.filter(hb => (hb.maxY - hb.minY) <= 12 && (hb.maxX - hb.minX) >= 20 &&
        hb.minX < c.bbox.maxX && hb.maxX > c.bbox.minX && hb.minY > c.bbox.minY - 2 && hb.maxY < c.bbox.maxY + 2);
      const boardStrips = structuralPolys.filter(p => p.width >= p.height && p.height <= 12 && p.width >= 20 &&
        p.centerX >= c.bbox.minX - 2 && p.centerX <= c.bbox.maxX + 2 && p.centerY >= c.bbox.minY - 2 && p.centerY <= c.bbox.maxY + 2)
        .map(p => ({ layer: p.layer, minX: p.minX, maxX: p.maxX, minY: p.minY, maxY: p.maxY }));
      const vBotsAll = alumPool.filter(p => p.height > p.width && p.width >= 1).map(p => Math.round(p.minY * 10) / 10);
      const floorCnt = new Map(); for (const v of vBotsAll) floorCnt.set(v, (floorCnt.get(v) || 0) + 1);
      const clusterFloor = vBotsAll.length ? [...floorCnt.entries()].sort((a, b) => b[1] - a[1])[0][0] : c.bbox.minY;
      const panelStrips = stripHatches.concat(boardStrips)
        .filter(s => s.minY > clusterFloor - 1)
        .filter(s => !(louverBand && s.maxY > louverBand.minY - 5 && s.minY < louverBand.maxY + 5));
      const byOthersZones = hatchBoxes.filter(hb => (hb.maxY - hb.minY) > 12 && (hb.maxX - hb.minX) > 12 &&
        hb.minX < c.bbox.maxX && hb.maxX > c.bbox.minX && hb.minY < c.bbox.maxY && hb.maxY > c.bbox.minY);

      const _ex = buildElevExport(mark, c, alumPool, louverBand, doorRegions, structuralPolys, panelStrips, byOthersZones);
      results.push(_ex);
    }
    return results;
  }

  global.DxfElevations = { parseElevationRegions, setLayerConfig };
})(window);
