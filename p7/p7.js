/* ============================================================================
   p7.js — MTA ADA Package 7 (Forte, A-37811), project-specific module
   ----------------------------------------------------------------------------
   NOT a core file. Loaded AFTER ../core/app.js; layers on top of core the same
   way lex/lf.js does (wraps renderPlan / renderKPIs, never edits core).

   WHAT IS DIFFERENT HERE (Leo, 2026-11-12)
   • The map is the ELEVATION, not a floor plan. Every piece on the Final-2
     A-drawings is its own unit: frame (535S-1), glass (535S-1-G1), louver (-L1),
     infill panel (-M1), horizontal band (535S-H1), control panel (-CP1),
     composite stud-wall panel (-COM1), glass canopy (-GC1), corner panel
     (535-NE-V1, 8' a piece, top down) and standing-seam roofs (R-…).
   • Navigation: station (Kingsbridge / 167th) → key plan → group (an elevator
     or the station's roofs) → one elevation per tab.
   • Each piece walks 未下单 → 已下单 → 工厂 → 工地 → 已安装 (+ Issue flag).
     Default after ordered is the shop; a piece can go straight to site.
     Core status is DERIVED so markers-free core views, charts, the daily log and
     cloud sync keep working: installed→installed, issue→issue, site→in-progress,
     everything earlier→pending.
   • Roofs: one piece per roof; you book how many panels went in that day.
   11-13 (Leo): "More →" opens core's full unit editor (status there is mapped back
   onto the stage), clickable summary cards, full-width piece list (Detail / Card,
   filter by progress + material), Issues / Overall cards, roof hot spots per sheet.

   Geometry lives in PROJECT.p7geo (generated from the PDFs), NOT on the units,
   so the cloud state stays small and a corrected extraction reaches live data
   on the next load. Unit keys are immutable.
   ========================================================================== */
(function () {
  'use strict';
  var BUILD = 'p7·2026-11-13a';
  var P = window.PROJECT || {};
  var NAV = P.p7nav || { stations: [] };
  var GEO = P.p7geo || {};
  var HOT = P.p7hot || {};

  var STAGES = ['', 'ordered', 'shop', 'site', 'installed'];
  var STAGE_LABEL = {
    en: { '': 'Not ordered', ordered: 'Ordered', shop: 'Shop', site: 'On site', installed: 'Installed' },
    zh: { '': '未下单', ordered: '已下单', shop: '工厂', site: '工地', installed: '已安装' }
  };
  var KIND_LABEL = {
    frame: 'Frame', glass: 'Glass', band: 'Metal panel (band)', panel: 'Metal panel', louver: 'Louver',
    cp: 'St. Stl. control panel', com: 'Composite metal panel', canopy: 'Glass canopy',
    corner: 'Corner panel', roof: 'Standing seam roof'
  };
  /* proposal legend colours (Proposal Ver #4, p.8) — material view */
  var MAT = {   /* frame / canopy are outlines only — never filled */
    glass: '#bfe6ee', 'GL-2': '#bfe6ee', 'GL-02': '#bfe6ee', 'GL-3': '#8fa4e8', 'GL-03': '#8fa4e8',
    'GL-04': '#a8e0b8', 'GL-05': '#c7a6ec',
    band: '#dccbe8', panel: '#dccbe8', cp: '#cfc3e6', com: '#f6c3cf', louver: '#f4b8b8',
    corner: '#f8dca0', canopy: '#a9a5e0', roof: '#d9d9d9', frame: '#d33'
  };
  var CARD_LINES = [
    { k: 'glass',  label: 'Glazing',               kinds: ['glass'] },
    { k: 'frame',  label: 'Storefront / CW frame', kinds: ['frame'] },
    { k: 'metal',  label: 'Metal panel',           kinds: ['band', 'panel'] },
    { k: 'com',    label: 'Composite metal panel', kinds: ['com'] },
    { k: 'corner', label: 'Corner metal panel',    kinds: ['corner'] },
    { k: 'louver', label: 'Louver',                kinds: ['louver'] },
    { k: 'cp',     label: 'St. Stl. control panel',kinds: ['cp'] },
    { k: 'canopy', label: 'Glass canopy',          kinds: ['canopy'] },
    { k: 'roof',   label: 'Standing seam roof',    kinds: ['roof'] }
  ];

  // ------------------------------------------------------------------ helpers
  function esc(s) { return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
  function lang() { return (typeof currentLang !== 'undefined' && currentLang === 'zh') ? 'zh' : 'en'; }
  function SL(s) { return (STAGE_LABEL[lang()] || STAGE_LABEL.en)[s || ''] || s; }
  function today() { var d = new Date(); return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0'); }
  function units() { return (typeof state !== 'undefined' && state && Array.isArray(state.units)) ? state.units : []; }
  function byKey(k) { return units().find(function (u) { return u.key === k; }) || null; }
  var _seed = null;
  function seedMap() {
    if (_seed) return _seed; _seed = {};
    (P.seedUnits || []).forEach(function (u) { _seed[u.key] = u; });
    return _seed;
  }
  function inBaseline(u) { return !!(u && seedMap()[u.key]); }
  function noEdit() { try { return typeof _noEdit === 'function' && _noEdit(); } catch (e) { return false; } }
  function lvl() { return (typeof currentLevel !== 'undefined') ? currentLevel : null; }
  function nm(o) { return o == null ? '' : typeof o === 'string' ? o : (o[lang()] || o.en || ''); }
  function fmt(n) { return (Math.round(n * 10) / 10).toLocaleString('en-US'); }

  // ------------------------------------------------- baseline + derived status
  var SEED_FIELDS = ['type', 'kind', 'zone', 'sub', 'sf', 'w', 'h', 'panelsTotal', 'corner', 'frame', 'note'];
  function stageFromStatus(st) { return st === 'installed' ? 'installed' : st === 'in-progress' ? 'site' : ''; }
  function statusOf(u) { return u.issue ? 'issue' : u.stage === 'installed' ? 'installed' : u.stage === 'site' ? 'in-progress' : 'pending'; }
  /* The core unit editor ("More →") and anything else in core only knows u.status. When the
     status no longer matches what the stage says, the status wins and the stage follows. */
  function reconcile(u) {
    var want = statusOf(u); if (!u.status || u.status === want) return;
    var sd = u.stageDates || (u.stageDates = {});
    if (u.status === 'issue') { u.issue = true; return; }
    u.issue = false;
    if (u.status === 'installed') { u.stage = 'installed'; if (!sd.installed) sd.installed = u.date || today(); }
    else if (u.status === 'in-progress') { u.stage = 'site'; if (!sd.site) sd.site = today(); delete sd.installed; }
    else if (u.stage === 'installed' || u.stage === 'site') { u.stage = sd.shop ? 'shop' : sd.ordered ? 'ordered' : ''; delete sd.site; delete sd.installed; }
  }
  function baselineSync() {
    var m = seedMap();
    units().forEach(function (u) {
      var s = m[u.key]; if (!s) return;
      SEED_FIELDS.forEach(function (f) { if (s[f] !== undefined) u[f] = s[f]; });
      if (u.stage === undefined) u.stage = stageFromStatus(u.status);
      if (u.issue === undefined) u.issue = (u.status === 'issue');
      if (u.kind === 'roof' && typeof u.panelsDone !== 'number') u.panelsDone = 0;
      reconcile(u);
    });
  }
  function derive(u) {
    if (u.kind === 'roof') {
      var tot = Number(u.panelsTotal) || 0, done = Number(u.panelsDone) || 0;
      if (tot > 0 && done >= tot) u.stage = 'installed';
      else if (done > 0 && STAGES.indexOf(u.stage) < 3) u.stage = 'site';
    }
    u.status = statusOf(u);
    if (u.stage === 'installed') { u.date = (u.stageDates && u.stageDates.installed) || u.date || today(); }
    else if (!u.issue) { u.date = ''; }
  }

  // ------------------------------------------------------------------- nav
  var cur = { station: null, group: null };
  function floorMeta(k) { return (P.floors || []).find(function (f) { return f.key === k; }) || null; }
  function stationOfFloor(k) {
    for (var i = 0; i < NAV.stations.length; i++) {
      var st = NAV.stations[i];
      if (st.key === k) return { st: st, g: null };
      for (var j = 0; j < st.groups.length; j++) if (st.groups[j].floors.indexOf(k) >= 0) return { st: st, g: st.groups[j] };
    }
    return null;
  }
  function syncCurFromLevel() {
    var r = stationOfFloor(lvl()); if (!r) return;
    cur.station = r.st.id; cur.group = r.g ? r.g.id : null;
  }
  function stationById(id) { return NAV.stations.find(function (s) { return s.id === id; }) || NAV.stations[0]; }
  function goFloor(k) {
    if (typeof setLevel === 'function') setLevel(k);
    fitWrap();
    paintNav(); paintCards();
    try { if (typeof planZoomReset === 'function') planZoomReset(); } catch (e) {}
  }
  function goGroup(stId, gId) {
    var st = stationById(stId); var g = st.groups.find(function (x) { return x.id === gId; });
    if (!g) return; cur.station = st.id; cur.group = g.id;
    var keep = g.floors.indexOf(lvl()) >= 0 ? lvl() : g.floors[0];
    goFloor(keep);
  }
  function goStation(stId) { var st = stationById(stId); cur.station = st.id; cur.group = null; goFloor(st.key); paintCards(); }
  window.P7nav = { goFloor: goFloor, goGroup: goGroup, goStation: goStation };

  function navHost() {
    var host = document.getElementById('p7Nav');
    if (!host) {
      host = document.createElement('div'); host.id = 'p7Nav';
      var sec = document.getElementById('planSection');
      var vp = document.getElementById('planViewport');
      if (sec && vp) vp.parentNode.insertBefore(host, vp);
    }
    return host;
  }
  var view = 'progress';
  function paintNav() {
    var host = navHost(); if (!host) return;
    syncCurFromLevel();
    var st = stationById(cur.station);
    var h = '<div class="p7-row">';
    NAV.stations.forEach(function (s) {
      h += '<button class="p7-st' + (s.id === st.id ? ' on' : '') + '" onclick="P7nav.goStation(\'' + s.id + '\')">' + esc(s.name) + '</button>';
    });
    h += '<span class="p7-sep"></span>';
    h += '<button class="p7-chip' + (lvl() === st.key ? ' on' : '') + '" onclick="P7nav.goFloor(\'' + st.key + '\')">🗺 ' + (lang() === 'zh' ? '总平面' : 'Key plan') + '</button>';
    st.groups.forEach(function (g) {
      h += '<button class="p7-chip' + (g.id === cur.group ? ' on' : '') + '" onclick="P7nav.goGroup(\'' + st.id + '\',\'' + g.id + '\')">' + esc(nm(g.name)) + '</button>';
    });
    h += '<span class="p7-grow"></span>';
    h += '<span class="p7-view"><button class="' + (view === 'progress' ? 'on' : '') + '" onclick="P7.setView(\'progress\')">' + (lang() === 'zh' ? '进度' : 'Progress') + '</button>' +
         '<button class="' + (view === 'material' ? 'on' : '') + '" onclick="P7.setView(\'material\')">' + (lang() === 'zh' ? '材料' : 'Material') + '</button></span>';
    h += '</div>';
    var g = st.groups.find(function (x) { return x.id === cur.group; });
    if (g) {
      h += '<div class="p7-row p7-sub">';
      g.floors.forEach(function (k) {
        var f = floorMeta(k); var fname = f ? (nm(f.short) || nm(f.name) || k) : k;
        var n = countFloor(k);
        h += '<button class="p7-chip small' + (k === lvl() ? ' on' : '') + '" onclick="P7nav.goFloor(\'' + k + '\')">' + esc(fname) +
             ' <em>' + n.done + '/' + n.tot + '</em></button>';
      });
      var fm = floorMeta(lvl());
      if (fm && fm.sheet) h += '<span class="p7-sheet">' + esc(fm.sheet) + '</span>';
      h += '</div>';
    }
    h += '<div class="p7-row p7-legend">' + legendHtml() + '<span class="p7-grow"></span><span class="p7-build">' + BUILD + '</span></div>';
    host.innerHTML = h;
  }
  function legendHtml() {
    if (view === 'material') {
      var st = stationById(cur.station), zs = {}, gl = {};
      st.groups.forEach(function (g) { (g.zones || []).forEach(function (z) { zs[z] = 1; }); });
      units().forEach(function (u) { if (u.kind === 'glass' && zs[u.zone] && u.sub) gl[u.sub] = 1; });
      return Object.keys(gl).sort().map(function (t) { return [t, 'Glass ' + t]; }).concat([['band', 'Metal panel'], ['com', 'Composite'], ['corner', 'Corner panel'],
              ['louver', 'Louver'], ['cp', 'Control panel'], ['canopy', 'Glass canopy'], ['roof', 'Roof']]).map(function (x) {
        return '<span class="p7-lg"><i style="background:' + MAT[x[0]] + '"></i>' + esc(x[1]) + '</span>';
      }).join('');
    }
    return STAGES.map(function (s) {
      return '<span class="p7-lg"><i class="p7-st-' + (s || 'none') + '">' + esc(SL(s)).slice(0, 2) + '</i>' + esc(SL(s)) + '</span>';
    }).join('') + '<span class="p7-lg"><i class="p7-st-none p7-issue-sw"></i>' + (lang() === 'zh' ? '问题' : 'Issue') + '</span>' +
      '<span class="p7-hint">' + (lang() === 'zh' ? '点一件改状态 · Shift/Ctrl 点多选 · 点框编号选整个框' : 'Click a piece · Shift/Ctrl-click to multi-select · click a frame tag for the whole frame') + '</span>';
  }
  function countFloor(k) {
    var tot = 0, done = 0;
    units().forEach(function (u) {
      if (!inBaseline(u)) return;
      var g = GEO[u.key] || []; if (!g.some(function (x) { return x.f === k; })) return;
      tot++; if (u.stage === 'installed') done++;
    });
    return { tot: tot, done: done };
  }

  /* An elevation is tall and thin: at 100% width it would be several screens high. Size the
     wrap so the whole sheet fits the viewport height; the overlay is in % of the wrap, so it
     follows. Key plans / roof plans keep the full width. */
  function fitWrap() {
    var wrap = document.getElementById('planWrap'), vp = document.getElementById('planViewport');
    if (!wrap || !vp) return;
    var f = floorMeta(lvl()); if (!f || !f.size) { wrap.style.width = ''; wrap.style.height = ''; vp.style.height = ''; return; }
    var aspect = f.size[0] / f.size[1];
    var vh = Math.max(420, Math.round(window.innerHeight * 0.78));
    var w = Math.min(vp.clientWidth || vp.offsetWidth || 800, Math.round(vh * aspect));
    var h = Math.round(w / aspect);
    vp.style.height = Math.max(h, 260) + 'px';
    wrap.style.width = w + 'px'; wrap.style.height = h + 'px';
  }

  // --------------------------------------------------------------- overlay
  var sel = {};      // multi-select set
  function layer() {
    var wrap = document.getElementById('planWrap'); if (!wrap) return null;
    var L = document.getElementById('p7Layer');
    if (!L) { L = document.createElement('div'); L.id = 'p7Layer'; wrap.appendChild(L); }
    if (L.parentNode !== wrap) wrap.appendChild(L);
    return L;
  }
  function pieceClass(u) {
    var c = 'p7-st-' + (u.stage || 'none');
    if (u.issue) c += ' p7-issue';
    if (sel[u.key]) c += ' p7-sel';
    return c;
  }
  function label(u) {
    var id = u.id || u.key;
    if (u.kind === 'roof') return id;
    if (u.kind === 'frame') return id;
    if (u.kind === 'corner') return id.replace(/^\d+-/, '');
    return id.replace(/^\d+[A-Z]-(\d+-)?/, '');
  }
  function renderOverlay() {
    baselineSync();
    var L = layer(); if (!L) return;
    var k = lvl();
    var html = [];
    // key-plan hot spots
    (HOT[k] || []).forEach(function (h) {
      var st = NAV.stations.find(function (s) { return s.key === k; });
      var g = st && st.groups.find(function (x) { return x.id === h.group; });
      if (!g) return;
      var n = { tot: 0, done: 0 };
      (h.floor ? [h.floor] : g.floors).forEach(function (f) { var c = countFloor(f); n.tot += c.tot; n.done += c.done; });
      var lab = h.floor ? nm((floorMeta(h.floor) || {}).short) || nm(g.name) : nm(g.name);
      html.push('<div class="p7-hot" style="left:' + h.x + '%;top:' + h.y + '%;width:' + h.w + '%;height:' + h.h + '%" data-hot="' + st.id + '|' + g.id + '|' + (h.floor || '') + '">' +
        '<span>' + esc(lab) + ' · ' + n.done + '/' + n.tot + '</span></div>');
    });
    var on = units().filter(function (u) { return inBaseline(u) && (GEO[u.key] || []).some(function (x) { return x.f === k; }); });
    var order = { roof: 0, com: 1, band: 2, cp: 2, corner: 2, glass: 3, panel: 3, louver: 3, frame: 4, canopy: 5 };
    on.sort(function (a, b) { return (order[a.kind] || 3) - (order[b.kind] || 3); });
    var svgPolys = [];
    on.forEach(function (u) {
      (GEO[u.key] || []).filter(function (x) { return x.f === k; }).forEach(function (g, gi) {
        var box = 'left:' + g.x + '%;top:' + g.y + '%;width:' + g.w + '%;height:' + g.h + '%';
        var matBg = MAT[u.sub] || MAT[u.kind] || '#ddd';
        var st = view === 'material' ? ' style="' + box + ';--mat:' + matBg + '"' : ' style="' + box + '"';
        var cls = 'p7-pc p7-k-' + u.kind + ' ' + pieceClass(u) + (view === 'material' ? ' p7-mat' : '');
        if (u.kind === 'frame' || u.kind === 'canopy') {
          html.push('<div class="' + cls + '"' + st + ' data-key="' + esc(u.key) + '"><b class="p7-tag" data-key="' + esc(u.key) + '">' + esc(label(u)) + '</b></div>');
        } else if (u.kind === 'roof' && g.poly) {
          svgPolys.push('<polygon class="' + cls + '" data-key="' + esc(u.key) + '" points="' + g.poly.map(function (p) { return p[0] + ',' + p[1]; }).join(' ') + '"' +
            (view === 'material' ? ' style="--mat:' + matBg + '"' : '') + '/>');
          if (!gi) html.push('<div class="p7-roofl ' + pieceClass(u) + '" style="left:' + (g.x + g.w / 2) + '%;top:' + (g.y + g.h / 2) + '%" data-key="' + esc(u.key) + '">' +
            esc(label(u)) + '<em>' + (u.panelsDone || 0) + '/' + (u.panelsTotal || 0) + '</em></div>');
        } else {
          html.push('<div class="' + cls + '"' + st + ' data-key="' + esc(u.key) + '" title="' + esc(u.id + ' · ' + (u.note || '') + ' · ' + SL(u.stage)) + '"><span>' + esc(label(u)) +
            (u.kind === 'roof' ? '<em>' + (u.panelsDone || 0) + '/' + (u.panelsTotal || 0) + '</em>' : '') + '</span></div>');
        }
      });
    });
    var svg = svgPolys.length ? '<svg class="p7-svg" viewBox="0 0 100 100" preserveAspectRatio="none">' + svgPolys.join('') + '</svg>' : '';
    L.innerHTML = svg + html.join('');
    document.body.classList.add('p7-on');
  }
  function onLayerClick(ev, t0) {
    var hot = t0 && t0.closest && t0.closest('[data-hot]');
    if (hot) { ev.stopPropagation(); ev.preventDefault(); var hp = hot.getAttribute('data-hot').split('|'); goGroup(hp[0], hp[1]); if (hp[2]) goFloor(hp[2]); return; }
    var t = t0 && t0.closest && t0.closest('[data-key]');
    if (!t || !document.getElementById('p7Layer').contains(t)) return;
    var u = byKey(t.getAttribute('data-key')); if (!u) return;
    // a frame body is a container: only its tag selects the frame
    if ((u.kind === 'frame' || u.kind === 'canopy') && !t.classList.contains('p7-tag')) return;
    ev.stopPropagation(); ev.preventDefault();
    if (ev.shiftKey || ev.ctrlKey || ev.metaKey) {
      if (sel[u.key]) delete sel[u.key]; else sel[u.key] = 1;
      renderOverlay(); openEditor(Object.keys(sel)); return;
    }
    sel = {}; sel[u.key] = 1; renderOverlay(); openEditor([u.key]);
  }

  // ---------------------------------------------------------------- editor
  function editorEl() {
    var e = document.getElementById('p7Ed');
    if (!e) { e = document.createElement('div'); e.id = 'p7Ed'; document.body.appendChild(e); }
    return e;
  }
  var edKeys = [];
  function openEditor(keys) {
    edKeys = keys.filter(function (k) { return byKey(k); });
    var e = editorEl();
    if (!edKeys.length) { e.style.display = 'none'; return; }
    var us = edKeys.map(byKey);
    var one = us.length === 1 ? us[0] : null;
    var ro = noEdit();
    var h = '<div class="p7-ed-head"><b>' + (one ? esc(one.id) : us.length + (lang() === 'zh' ? ' 件' : ' pieces')) + '</b><button onclick="P7.closeEd()">✕</button></div>';
    if (one) {
      h += '<div class="p7-ed-sub">' + esc(KIND_LABEL[one.kind] || one.type) + (one.sub && one.kind !== 'roof' ? ' · ' + esc(one.sub) : '') +
           (one.kind === 'roof' ? ' · ' + esc(one.sub) : '') + '<br>' + esc(one.note || '') + '</div>';
    } else {
      h += '<div class="p7-ed-sub">' + esc(us.map(function (u) { return u.id; }).join(', ')).slice(0, 400) + '</div>';
    }
    var curStage = one ? (one.stage || '') : null;
    h += '<div class="p7-ed-stages">' + STAGES.map(function (s) {
      return '<button class="p7-st-' + (s || 'none') + (curStage === s ? ' cur' : '') + '" ' + (ro ? 'disabled' : '') + ' onclick="P7.pick(\'' + s + '\')">' + esc(SL(s)) + '</button>';
    }).join('') + '</div>';
    var issueOn = us.every(function (u) { return u.issue; });
    h += '<label class="p7-ed-row"><input type="checkbox" id="p7EdIssue"' + (issueOn ? ' checked' : '') + (ro ? ' disabled' : '') + '> Issue</label>';
    h += '<label class="p7-ed-row">' + (lang() === 'zh' ? '日期' : 'Date') + ' <input type="date" id="p7EdDate" value="' + today() + '"' + (ro ? ' disabled' : '') + '></label>';
    if (one && one.kind === 'roof') {
      h += '<div class="p7-ed-roof">' + (lang() === 'zh' ? '已装板' : 'Panels installed') + ': <b>' + (one.panelsDone || 0) + ' / ' + (one.panelsTotal || 0) + '</b>' +
           '<label class="p7-ed-row">' + (lang() === 'zh' ? '今天装了' : 'Installed today') + ' <input type="number" id="p7EdPanels" min="-999" step="1" value="" placeholder="+ panels"' + (ro ? ' disabled' : '') + '></label>' +
           '<div class="p7-ed-note">' + (lang() === 'zh' ? '总块数是按 12" 板宽估的，shop drawing 出来后改。' : 'Total is an estimate at 12" panel width; correct it from the shop drawings.') + '</div></div>';
    }
    if (one) h += '<label class="p7-ed-row p7-col">' + (lang() === 'zh' ? '备注' : 'Note') + '<textarea id="p7EdNote" rows="2"' + (ro ? ' disabled' : '') + '>' + esc(one.p7note || '') + '</textarea></label>';
    if (one && one.kind === 'frame') {
      h += '<button class="p7-ed-frame" ' + (ro ? 'disabled' : '') + ' onclick="P7.selectFrame(\'' + esc(one.key) + '\')">' + (lang() === 'zh' ? '选中整个框（含框内玻璃/板/louver）' : 'Select the whole frame (with its glass / panels / louvers)') + '</button>';
    }
    if (one && one.stageDates) {
      h += '<div class="p7-ed-hist">' + STAGES.filter(function (s) { return s && one.stageDates[s]; }).map(function (s) { return esc(SL(s)) + ' ' + esc(one.stageDates[s]); }).join(' · ') + '</div>';
    }
    h += '<div class="p7-ed-foot">' + (one ? '<button class="p7-ed-more" onclick="P7.more(\'' + esc(one.key) + '\')" title="' +
         (lang() === 'zh' ? '完整编辑（日历 / Field Verify / Glass / RFI）' : 'Full editor (Calendar / Field Verify / Glass / RFI)') + '">' + (lang() === 'zh' ? '更多 →' : 'More →') + '</button>' : '') +
         '<span class="p7-grow"></span>' + (ro ? '<span>' + (lang() === 'zh' ? '只读' : 'Read-only') + '</span>' :
         '<button class="btn btn-primary" onclick="P7.save()">' + (lang() === 'zh' ? '保存' : 'Save') + '</button>') + '</div>';
    e.innerHTML = h; e.style.display = 'block';
    e.dataset.pick = curStage == null ? '__keep' : curStage;
  }
  function pick(s) {
    var e = editorEl(); e.dataset.pick = s;
    e.querySelectorAll('.p7-ed-stages button').forEach(function (b, i) { b.classList.toggle('cur', STAGES[i] === s); });
  }
  function closeEd() { editorEl().style.display = 'none'; sel = {}; renderOverlay(); }
  function selectFrame(fk) {
    sel = {}; sel[fk] = 1;
    units().forEach(function (u) { if (u.frame === fk) sel[u.key] = 1; });
    renderOverlay(); openEditor(Object.keys(sel));
  }
  function logCat(u) { return u.kind === 'glass' ? 'glass' : u.kind === 'louver' ? 'louver' : 'framing'; }
  function addLog(date, cat, line) {
    if (typeof state === 'undefined' || !state) return;
    if (!Array.isArray(state.log)) state.log = [];
    var e = state.log.find(function (l) { return l && l.p7Entry === true && l.date === date && l.category === cat; });
    if (!e) { e = { date: date, category: cat, p7Entry: true, items: [] }; state.log.push(e); }
    if (!Array.isArray(e.items)) e.items = [];
    if (e.items.indexOf(line) < 0) e.items.push(line);
    e.content = e.items.join(' · ');
  }
  function save() {
    if (noEdit()) return;
    var e = editorEl(); var s = e.dataset.pick;
    var date = (document.getElementById('p7EdDate') || {}).value || today();
    var issue = !!(document.getElementById('p7EdIssue') || {}).checked;
    var noteEl = document.getElementById('p7EdNote');
    var panEl = document.getElementById('p7EdPanels');
    var changed = [];
    edKeys.forEach(function (k) {
      var u = byKey(k); if (!u) return;
      var before = u.stage || '';
      if (s !== '__keep' && s !== undefined && s !== null && s !== before) {
        u.stage = s;
        if (!u.stageDates) u.stageDates = {};
        if (s) u.stageDates[s] = date;
        // going back: forget later dates
        STAGES.forEach(function (x, i) { if (i > STAGES.indexOf(s) && u.stageDates[x]) delete u.stageDates[x]; });
        if (s === 'installed') addLog(date, logCat(u), (lang() === 'zh' ? '安装 ' : 'Installed ') + u.id);
        changed.push(u.id);
      }
      if (u.issue !== issue) {
        u.issue = issue; changed.push(u.id + (issue ? ' issue' : ' issue cleared'));
        if (issue) addLog(date, 'issue', 'Issue · ' + u.id);
      }
      if (noteEl && edKeys.length === 1) { var nv = noteEl.value.trim(); if ((u.p7note || '') !== nv) { u.p7note = nv; changed.push(u.id + ' note'); } }
      if (panEl && u.kind === 'roof' && panEl.value !== '') {
        var add = Math.round(Number(panEl.value) || 0);
        if (add) {
          u.panelsDone = Math.max(0, Math.min(Number(u.panelsTotal) || 9999, (Number(u.panelsDone) || 0) + add));
          if (!u.stageDates) u.stageDates = {};
          if (!u.stageDates.site) u.stageDates.site = date;
          if (u.panelsDone >= (Number(u.panelsTotal) || 0)) u.stageDates.installed = date;
          addLog(date, 'framing', u.id + ' ' + (add > 0 ? '+' : '') + add + ' panels (' + u.panelsDone + '/' + u.panelsTotal + ')');
          changed.push(u.id + ' ' + (add > 0 ? '+' : '') + add + ' panels');
        }
      }
      derive(u);
    });
    if (changed.length) {
      var label = changed.length > 4 ? changed.slice(0, 4).join(', ') + ' +' + (changed.length - 4) : changed.join(', ');
      if (s && s !== '__keep') label = SL(s) + ': ' + label;
      if (typeof CloudSync !== 'undefined' && CloudSync.describe) CloudSync.describe(label);
      if (typeof saveState === 'function') saveState(false, label);
    }
    editorEl().style.display = 'none'; sel = {};
    if (typeof render === 'function') render(); else { renderOverlay(); paintCards(); }
  }
  function more(k) {
    editorEl().style.display = 'none'; sel = {}; renderOverlay();
    if (typeof openUnit === 'function') openUnit(k);
  }
  window.P7 = { pick: pick, save: save, closeEd: closeEd, selectFrame: selectFrame, build: BUILD, more: more, openEditor: openEditor,
    setView: function (v) { view = v; paintNav(); renderOverlay(); }, renderOverlay: renderOverlay, refresh: refresh };

  // ----------------------------------------------------------------- cards
  function cardsHost() {
    var h = document.getElementById('p7Cards');
    if (!h) {
      h = document.createElement('section'); h.id = 'p7Cards';
      var sec = document.getElementById('planSection');
      if (sec) sec.parentNode.insertBefore(h, sec);
    }
    return h;
  }
  function paintCards() {
    var host = cardsHost(); if (!host) return;
    syncCurFromLevel();
    var st = stationById(cur.station);
    var zones = {}; st.groups.forEach(function (g) { (g.zones || []).forEach(function (z) { zones[z] = 1; }); });
    var us = units().filter(function (u) { return inBaseline(u) && zones[u.zone]; });
    var h = '<div class="p7-cards-head"><b>' + esc(st.name) + '</b> · ' + (lang() === 'zh' ? '按 Final-2 实际量（件数 / sf）· 点卡片看安装详情' : 'Final-2 quantities (pieces / sf) · click a card for install details') + '</div><div class="p7-cards">';
    // Overall + Issues (same board as CP2 / AC3: Things to Solve)
    var allDone = us.filter(function (u) { return u.stage === 'installed'; }).length;
    var flagged = us.filter(function (u) { return u.issue; }).length;
    var openN = 0; try { openN = (typeof computeOpenItems === 'function') ? computeOpenItems().length : 0; } catch (e) {}
    var pct = us.length ? Math.round(100 * allDone / us.length) : 0;
    h += '<div class="kpi-card p7-card clickable" onclick="P7.cardDetail(\'all\')"><div class="kpi-label">' + (lang() === 'zh' ? '总进度' : 'Overall') + '</div>' +
      '<div class="kpi-value">' + pct + '%</div><div class="kpi-sub">' + allDone + ' / ' + us.length + (lang() === 'zh' ? ' 件已安装' : ' pieces installed') + '</div>' +
      '<div class="p7-bar"><i class="p7-st-installed" style="width:' + pct + '%"></i></div><div class="p7-mini"></div></div>';
    h += '<div class="kpi-card p7-card red clickable" onclick="openItemsModal()" title="Things to Solve"><div class="kpi-label">' + (lang() === 'zh' ? '问题' : 'Issues') + '</div>' +
      '<div class="kpi-value">' + openN + '</div><div class="kpi-sub">' + (lang() === 'zh' ? '问题板待解决' : 'open on the board') + '</div>' +
      '<div class="p7-bar"></div><div class="p7-mini">' + (flagged ? flagged + (lang() === 'zh' ? ' 件标了 Issue' : ' pieces flagged') : '') + '</div></div>';
    CARD_LINES.forEach(function (c) {
      var list = us.filter(function (u) { return c.kinds.indexOf(u.kind) >= 0; });
      if (!list.length) return;
      var cnt = {}; STAGES.forEach(function (s) { cnt[s] = 0; });
      var sfT = 0, sfI = 0, pT = 0, pD = 0, iss = 0;
      list.forEach(function (u) {
        cnt[u.stage || '']++; var sf = Number(u.sf) || 0; sfT += sf; if (u.stage === 'installed') sfI += sf; if (u.issue) iss++;
        if (u.kind === 'roof') { pT += Number(u.panelsTotal) || 0; pD += Number(u.panelsDone) || 0; }
      });
      var done = cnt.installed, tot = list.length;
      var big = c.k === 'roof' ? pD + '/' + pT + ' <small>panels</small>' : done + '/' + tot;
      var sub = c.k === 'roof' ? (lang() === 'zh' ? '屋顶 ' : 'roofs ') + done + '/' + tot + ' · ≈' + fmt(sfT) + ' sf' :
        fmt(sfI) + ' / ' + fmt(sfT) + ' sf';
      var bar = STAGES.slice(1).map(function (s) { return tot ? '<i class="p7-st-' + s + '" style="width:' + (100 * cnt[s] / tot) + '%"></i>' : ''; }).join('');
      h += '<div class="kpi-card p7-card clickable" onclick="P7.cardDetail(\'' + c.k + '\')"><div class="kpi-label">' + esc(c.label) + (iss ? ' <span class="p7-iss">' + iss + ' issue</span>' : '') + '</div>' +
        '<div class="kpi-value">' + big + '</div><div class="kpi-sub">' + sub + '</div><div class="p7-bar">' + bar + '</div>' +
        '<div class="p7-mini">' + STAGES.slice(1, 4).map(function (s) { return cnt[s] ? esc(SL(s)) + ' ' + cnt[s] : ''; }).filter(Boolean).join(' · ') + '</div></div>';
    });
    h += '</div>';
    host.innerHTML = h;
  }

  // ------------------------------------------------- shared lookups (list + details)
  function zonesOf(stId) {
    var z = {}; NAV.stations.forEach(function (st) { if (stId === 'all' || st.id === stId) st.groups.forEach(function (g) { (g.zones || []).forEach(function (x) { z[x] = st.id; }); }); });
    return z;
  }
  function stationOfUnit(u) { return zonesOf('all')[u.zone] || ''; }
  function where(u) { var f = floorMeta(u.level); return f ? nm(f.name) : (u.level || ''); }
  function matLabel(u) { return (KIND_LABEL[u.kind] || u.type || '') + (u.kind === 'glass' && u.sub ? ' · ' + u.sub : ''); }
  function lineOf(u) { var c = CARD_LINES.find(function (c) { return c.kinds.indexOf(u.kind) >= 0; }); return c ? c.k : ''; }
  function lineLabel(k) { if (k === 'all') return lang() === 'zh' ? '全部' : 'All'; var c = CARD_LINES.find(function (c) { return c.k === k; }); return c ? c.label : k; }
  function floorOrder() { var o = {}; (P.floors || []).forEach(function (f, i) { o[f.key] = i; }); return o; }
  function badge(u) {
    return '<span class="p7-badge p7-st-' + (u.stage || 'none') + (u.issue ? ' p7-issue' : '') + '">' + esc(SL(u.stage)) + '</span>';
  }

  // ------------------------------------------------------ card → install details
  /* Re-uses core's KPI detail modal (#kpiDetailModal) so it looks like CP2 / AC3. */
  function cardDetail(k) {
    var modal = document.getElementById('kpiDetailModal'); if (!modal) return;
    syncCurFromLevel();
    var st = stationById(cur.station), zs = zonesOf(st.id), zh = lang() === 'zh';
    var list = units().filter(function (u) { return inBaseline(u) && zs[u.zone] && (k === 'all' || lineOf(u) === k); });
    var fo = floorOrder(), rows = {};
    list.forEach(function (u) {
      var r = rows[u.level] || (rows[u.level] = { f: u.level, n: {}, tot: 0, sfT: 0, sfI: 0, pT: 0, pD: 0 });
      r.n[u.stage || ''] = (r.n[u.stage || ''] || 0) + 1; r.tot++;
      var sf = Number(u.sf) || 0; r.sfT += sf; if (u.stage === 'installed') r.sfI += sf;
      if (u.kind === 'roof') { r.pT += Number(u.panelsTotal) || 0; r.pD += Number(u.panelsDone) || 0; }
    });
    var R = Object.keys(rows).map(function (x) { return rows[x]; }).sort(function (a, b) { return (fo[a.f] || 0) - (fo[b.f] || 0); });
    var roofs = k === 'roof';
    var h = '<table class="kpi-detail-table p7-dt"><thead><tr><th>' + (zh ? '位置' : 'Where') + '</th>' +
      STAGES.map(function (x) { return '<th>' + esc(SL(x)) + '</th>'; }).join('') + '<th>' + (zh ? '合计' : 'Total') + '</th><th>' +
      (roofs ? (zh ? '板（装/总）' : 'Panels') : (k === 'all' ? '' : 'sf')) + '</th></tr></thead><tbody>';
    var T = { n: {}, tot: 0, sfT: 0, sfI: 0, pT: 0, pD: 0 };
    R.forEach(function (r) {
      h += '<tr><td><a href="#" onclick="P7nav.goFloor(\'' + r.f + '\');closeKpiDetail();return false">' + esc(nm((floorMeta(r.f) || {}).name) || r.f) + '</a></td>' +
        STAGES.map(function (x) { T.n[x] = (T.n[x] || 0) + (r.n[x] || 0); return '<td class="num">' + (r.n[x] || '') + '</td>'; }).join('') +
        '<td class="num"><b>' + r.tot + '</b></td><td class="num">' + (roofs ? r.pD + ' / ' + r.pT : (k === 'all' ? '' : fmt(r.sfI) + ' / ' + fmt(r.sfT))) + '</td></tr>';
      T.tot += r.tot; T.sfT += r.sfT; T.sfI += r.sfI; T.pT += r.pT; T.pD += r.pD;
    });
    h += '<tr class="p7-dt-tot"><td>' + (zh ? '合计' : 'Total') + '</td>' + STAGES.map(function (x) { return '<td class="num">' + (T.n[x] || '') + '</td>'; }).join('') +
      '<td class="num"><b>' + T.tot + '</b></td><td class="num">' + (roofs ? T.pD + ' / ' + T.pT : (k === 'all' ? '' : fmt(T.sfI) + ' / ' + fmt(T.sfT))) + '</td></tr></tbody></table>';
    var inst = list.filter(function (u) { return u.stage === 'installed' || (u.kind === 'roof' && u.panelsDone > 0); })
      .sort(function (a, b) { var da = (a.stageDates && (a.stageDates.installed || a.stageDates.site)) || '', db = (b.stageDates && (b.stageDates.installed || b.stageDates.site)) || ''; return db < da ? -1 : db > da ? 1 : 0; });
    h += '<h4 class="p7-dt-h">' + (zh ? '最近安装' : 'Latest installed') + ' <small>' + inst.length + '</small></h4>';
    h += inst.length ? '<div class="p7-dt-list">' + inst.slice(0, 40).map(function (u) {
      var d = (u.stageDates && (u.stageDates.installed || u.stageDates.site)) || '';
      return '<div><span class="p7-dt-date">' + esc(d) + '</span><a href="#" onclick="closeKpiDetail();P7.openEditor([\'' + esc(u.key) + '\']);return false">' + esc(u.id) + '</a> <span class="p7-dt-dim">' + esc(where(u)) +
        (u.kind === 'roof' ? ' · ' + u.panelsDone + '/' + u.panelsTotal + ' panels' : '') + '</span></div>';
    }).join('') + '</div>' : '<div class="p7-dt-dim">' + (zh ? '还没有安装记录' : 'Nothing installed yet') + '</div>';
    var iss = list.filter(function (u) { return u.issue; });
    if (iss.length) h += '<h4 class="p7-dt-h">Issue <small>' + iss.length + '</small></h4><div class="p7-dt-list">' + iss.map(function (u) {
      return '<div><a href="#" onclick="closeKpiDetail();P7.openEditor([\'' + esc(u.key) + '\']);return false">' + esc(u.id) + '</a> <span class="p7-dt-dim">' + esc(where(u)) + (u.p7note ? ' · ' + esc(u.p7note) : '') + '</span></div>';
    }).join('') + '</div>';
    h += '<div class="p7-dt-go"><button class="btn" onclick="closeKpiDetail();P7.listFor(\'' + st.id + '\',\'' + k + '\')">' + (zh ? '在列表里看这些 →' : 'Show these in the list →') + '</button></div>';
    var titleEl = document.getElementById('kpiDetailTitle'), countEl = document.getElementById('kpiDetailCount'), body = document.getElementById('kpiDetailBody');
    if (titleEl) { titleEl.removeAttribute('data-i18n'); titleEl.textContent = (k === 'all' ? (zh ? '全部' : 'All pieces') : lineLabel(k)) + ' · ' + st.name; }
    if (countEl) countEl.textContent = String(list.length);
    if (body) body.innerHTML = h;
    modal.classList.add('show');
  }

  // ------------------------------------------- piece list (replaces core's table)
  /* Leo 11-13: full width like the map, Detail / Card, filter by progress AND material. */
  var LF = { station: 'all', where: 'all', stage: 'all', mat: 'all', glass: 'all', q: '', mode: 'detail', sort: '', dir: 1 };
  try { var _lf = JSON.parse(localStorage.getItem('p7_list_v1') || 'null'); if (_lf) { LF.mode = _lf.mode || LF.mode; } } catch (e) {}
  function saveLF() { try { localStorage.setItem('p7_list_v1', JSON.stringify({ mode: LF.mode })); } catch (e) {} }
  function listHost() {
    var h = document.getElementById('p7List');
    if (!h) {
      h = document.createElement('section'); h.id = 'p7List'; h.className = 'section';
      h.innerHTML = '<div class="section-header"><div class="section-title" id="p7ListTitle"></div><div id="p7ListTools" class="p7-lt"></div></div>' +
        '<div id="p7ListFilters"></div><div id="p7ListBody"></div>';
      var plan = document.getElementById('planSection');
      if (plan) plan.parentNode.insertBefore(h, plan.nextSibling);
    }
    return h;
  }
  function listUnits() {
    var zs = zonesOf(LF.station), q = LF.q.trim().toLowerCase();
    var out = units().filter(function (u) {
      if (!inBaseline(u) || !zs[u.zone]) return false;
      if (LF.where !== 'all') {
        if (LF.where.indexOf('g:') === 0) { var gz = LF.where.slice(2); if (u.zone !== gz) return false; }
        else if (!(GEO[u.key] || []).some(function (g) { return g.f === LF.where; })) return false;
      }
      if (LF.stage === 'issue') { if (!u.issue) return false; }
      else if (LF.stage !== 'all' && (u.stage || '') !== (LF.stage === 'none' ? '' : LF.stage)) return false;
      if (LF.mat !== 'all' && lineOf(u) !== LF.mat) return false;
      if (LF.mat === 'glass' && LF.glass !== 'all' && u.sub !== LF.glass) return false;
      if (q && (u.id + ' ' + (u.note || '') + ' ' + (u.p7note || '') + ' ' + where(u)).toLowerCase().indexOf(q) < 0) return false;
      return true;
    });
    var fo = floorOrder();
    out.sort(function (a, b) { return ((fo[a.level] || 0) - (fo[b.level] || 0)) || natCmp(a.id, b.id); });
    if (LF.sort) {
      var key = {
        id: function (u) { return u.id; }, mat: function (u) { return matLabel(u); }, where: function (u) { return ('000' + (fo[u.level] || 0)).slice(-3); },
        sf: function (u) { return Number(u.sf) || 0; }, stage: function (u) { return STAGES.indexOf(u.stage || ''); },
        date: function (u) { var d = u.stageDates || {}; return d.installed || d.site || d.shop || d.ordered || ''; }
      }[LF.sort];
      if (key) out.sort(function (a, b) { var x = key(a), y = key(b); return (x < y ? -1 : x > y ? 1 : 0) * LF.dir; });
    }
    return out;
  }
  function natCmp(a, b) {
    var x = String(a).split(/(\d+)/), y = String(b).split(/(\d+)/);
    for (var i = 0; i < Math.min(x.length, y.length); i++) {
      if (x[i] === y[i]) continue;
      var nx = /^\d+$/.test(x[i]), ny = /^\d+$/.test(y[i]);
      if (nx && ny) return Number(x[i]) - Number(y[i]);
      return x[i] < y[i] ? -1 : 1;
    }
    return x.length - y.length;
  }
  function chip(group, val, text, on, extra) {
    return '<button class="p7-chip small' + (on ? ' on' : '') + (extra || '') + '" onclick="P7.lf(\'' + group + '\',\'' + val + '\')">' + text + '</button>';
  }
  function paintList() {
    var host = listHost(); if (!host) return;
    var zh = lang() === 'zh';
    var zsc = zonesOf(LF.station);
    var all = units().filter(function (u) { return inBaseline(u) && zsc[u.zone]; });   // counts + glass types follow the station
    var list = listUnits();
    document.getElementById('p7ListTitle').textContent = zh ? '构件清单 · 点一行改状态' : 'Pieces · click a row to update';
    document.getElementById('p7ListTools').innerHTML =
      '<span class="p7-view"><button class="' + (LF.mode === 'detail' ? 'on' : '') + '" onclick="P7.lf(\'mode\',\'detail\')">' + (zh ? '明细' : 'Detail') + '</button>' +
      '<button class="' + (LF.mode === 'card' ? 'on' : '') + '" onclick="P7.lf(\'mode\',\'card\')">' + (zh ? '卡片' : 'Card') + '</button></span>' +
      (noEdit() ? '' : '<button class="btn" onclick="P7.editShown()" ' + (list.length ? '' : 'disabled') + '>' + (zh ? '批量改这 ' + list.length + ' 件' : 'Edit these ' + list.length) + '</button>');
    // filters
    var f = '<div class="p7-fl"><span class="p7-fl-l">' + (zh ? '车站' : 'Station') + '</span>' + chip('station', 'all', zh ? '全部' : 'All', LF.station === 'all') +
      NAV.stations.map(function (st) { return chip('station', st.id, esc(st.name), LF.station === st.id); }).join('');
    var opts = '<option value="all">' + (zh ? '全部位置' : 'All locations') + '</option>';
    NAV.stations.forEach(function (st) {
      if (LF.station !== 'all' && LF.station !== st.id) return;
      st.groups.forEach(function (g) {
        var z = (g.zones || [])[0];
        opts += '<optgroup label="' + esc(st.name + ' · ' + nm(g.name)) + '"><option value="g:' + esc(z) + '"' + (LF.where === 'g:' + z ? ' selected' : '') + '>' + esc(nm(g.name)) + (zh ? '（全部）' : ' (all)') + '</option>' +
          g.floors.map(function (k) { var fm = floorMeta(k); return '<option value="' + k + '"' + (LF.where === k ? ' selected' : '') + '>' + esc(fm ? nm(fm.name) : k) + '</option>'; }).join('') + '</optgroup>';
      });
    });
    f += '<select class="p7-sel" onchange="P7.lf(\'where\',this.value)">' + opts + '</select>' +
      '<input class="p7-q" type="search" placeholder="' + (zh ? '搜编号 / 备注' : 'Search id / note') + '" value="' + esc(LF.q) + '" oninput="P7.lfq(this.value)"></div>';
    var cntStage = function (s) { return all.filter(function (u) { return s === 'issue' ? u.issue : (u.stage || '') === s; }).length; };
    f += '<div class="p7-fl"><span class="p7-fl-l">' + (zh ? '进度' : 'Progress') + '</span>' + chip('stage', 'all', zh ? '全部' : 'All', LF.stage === 'all') +
      STAGES.map(function (x) { return chip('stage', x || 'none', '<i class="p7-dot p7-st-' + (x || 'none') + '"></i>' + esc(SL(x)) + ' <em>' + cntStage(x) + '</em>', LF.stage === (x || 'none')); }).join('') +
      chip('stage', 'issue', '<i class="p7-dot p7-st-none p7-issue-sw"></i>Issue <em>' + cntStage('issue') + '</em>', LF.stage === 'issue') + '</div>';
    f += '<div class="p7-fl"><span class="p7-fl-l">' + (zh ? '材料' : 'Material') + '</span>' + chip('mat', 'all', zh ? '全部' : 'All', LF.mat === 'all') +
      CARD_LINES.map(function (c) { return chip('mat', c.k, '<i class="p7-dot" style="background:' + (MAT[c.kinds[0]] || '#ccc') + '"></i>' + esc(c.label), LF.mat === c.k); }).join('');
    if (LF.mat === 'glass') {
      var types = {}; all.forEach(function (u) { if (u.kind === 'glass' && u.sub) types[u.sub] = 1; });
      f += '<span class="p7-fl-sep"></span>' + chip('glass', 'all', zh ? '全部型号' : 'All types', LF.glass === 'all') +
        Object.keys(types).sort().map(function (t) { return chip('glass', t, '<i class="p7-dot" style="background:' + (MAT[t] || MAT.glass) + '"></i>' + esc(t), LF.glass === t); }).join('');
    }
    f += '</div>';
    document.getElementById('p7ListFilters').innerHTML = f;
    // body
    var sfT = 0, sfI = 0; list.forEach(function (u) { var v = Number(u.sf) || 0; sfT += v; if (u.stage === 'installed') sfI += v; });
    var sum = '<div class="p7-sum">' + list.length + (zh ? ' 件' : ' pieces') + ' · ' + list.filter(function (u) { return u.stage === 'installed'; }).length + (zh ? ' 已安装' : ' installed') +
      (LF.mat !== 'all' && LF.mat !== 'frame' ? ' · ' + fmt(sfI) + ' / ' + fmt(sfT) + ' sf' : '') + '</div>';
    var b;
    if (!list.length) b = '<div class="p7-empty">' + (zh ? '没有符合条件的构件' : 'No pieces match these filters') + '</div>';
    else if (LF.mode === 'card') {
      var fo = floorOrder(), groups = {};
      list.forEach(function (u) { (groups[u.level] = groups[u.level] || []).push(u); });
      b = Object.keys(groups).sort(function (a, c) { return (fo[a] || 0) - (fo[c] || 0); }).map(function (k) {
        var g = groups[k];
        return '<div class="p7-cg"><div class="p7-cg-h"><a href="#" onclick="P7nav.goFloor(\'' + k + '\');document.getElementById(\'planSection\').scrollIntoView({behavior:\'smooth\'});return false">' +
          esc(nm((floorMeta(k) || {}).name) || k) + '</a> <em>' + g.filter(function (u) { return u.stage === 'installed'; }).length + '/' + g.length + '</em></div><div class="p7-cg-grid">' +
          g.map(function (u) {
            return '<div class="p7-tile p7-st-' + (u.stage || 'none') + (u.issue ? ' p7-issue' : '') + '" onclick="P7.openEditor([\'' + esc(u.key) + '\'])" title="' + esc(u.id + ' · ' + matLabel(u) + ' · ' + SL(u.stage)) + '">' +
              '<b>' + esc(u.id) + '</b><span>' + esc(u.kind === 'glass' ? (u.sub || 'Glass') : (KIND_LABEL[u.kind] || '')) + (u.kind === 'roof' ? ' · ' + (u.panelsDone || 0) + '/' + (u.panelsTotal || 0) : '') + '</span></div>';
          }).join('') + '</div></div>';
      }).join('');
    } else {
      var th = function (k, t) { return '<th class="p7-th" onclick="P7.lfsort(\'' + k + '\')">' + t + (LF.sort === k ? (LF.dir > 0 ? ' ▲' : ' ▼') : '') + '</th>'; };
      b = '<div class="table-wrap p7-tw"><table class="p7-table"><thead><tr>' + th('id', zh ? '编号' : 'ID') + th('mat', zh ? '材料' : 'Material') + th('where', zh ? '位置' : 'Location') +
        '<th>' + (zh ? '尺寸' : 'Size') + '</th>' + th('sf', 'sf') + th('stage', zh ? '状态' : 'Status') +
        STAGES.slice(1).map(function (x) { return '<th class="p7-dcol">' + esc(SL(x)) + '</th>'; }).join('') + th('date', zh ? '最近' : 'Latest') + '<th>' + (zh ? '备注' : 'Note') + '</th><th></th></tr></thead><tbody>' +
        list.map(function (u) {
          var d = u.stageDates || {};
          var latest = d.installed || d.site || d.shop || d.ordered || '';
          return '<tr onclick="P7.openEditor([\'' + esc(u.key) + '\'])"><td class="p7-id">' + esc(u.id) + '</td><td><i class="p7-dot" style="background:' + (MAT[u.sub] || MAT[u.kind] || '#ccc') + '"></i>' + esc(matLabel(u)) + '</td>' +
            '<td>' + esc(where(u)) + '</td><td class="num">' + (u.kind === 'roof' ? (u.panelsDone || 0) + '/' + (u.panelsTotal || 0) + ' pnl' : (u.w ? u.w + '" × ' + u.h + '"' : '')) + '</td>' +
            '<td class="num">' + (u.sf ? fmt(Number(u.sf)) : '') + '</td><td>' + badge(u) + '</td>' +
            STAGES.slice(1).map(function (x) { return '<td class="p7-dcol num">' + esc((d[x] || '').slice(5)) + '</td>'; }).join('') +
            '<td class="num">' + esc(latest) + '</td><td class="p7-note">' + esc(u.p7note || '') + '</td>' +
            '<td><button class="p7-loc" title="' + (zh ? '在立面上定位' : 'Show on the elevation') + '" onclick="event.stopPropagation();P7.locate(\'' + esc(u.key) + '\')">📍</button></td></tr>';
        }).join('') + '</tbody></table></div>';
    }
    document.getElementById('p7ListBody').innerHTML = sum + b;
  }
  var _qT = null;
  function lfSet(k, v) {
    LF[k] = v;
    if (k === 'station') LF.where = 'all';
    if (k === 'mat' && v !== 'glass') LF.glass = 'all';
    if (k === 'mode') saveLF();
    paintList();
  }
  function listFor(stId, k) {
    LF.station = stId; LF.where = 'all'; LF.mat = (k === 'all' ? 'all' : k); LF.glass = 'all'; LF.stage = 'all'; LF.q = '';
    paintList(); var h = document.getElementById('p7List'); if (h) h.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  function locate(k) {
    var u = byKey(k); if (!u) return;
    var f = ((GEO[k] || [])[0] || {}).f || u.level;
    goFloor(f); sel = {}; sel[k] = 1; renderOverlay();
    var ps = document.getElementById('planSection'); if (ps) ps.scrollIntoView({ behavior: 'smooth', block: 'start' });
    openEditor([k]);
  }
  window.P7.cardDetail = cardDetail; window.P7.listFor = listFor; window.P7.locate = locate; window.P7.paintList = paintList;
  window.P7.lf = lfSet;
  window.P7.lfq = function (v) { LF.q = v; clearTimeout(_qT); _qT = setTimeout(function () { paintList(); var i = document.querySelector('#p7List .p7-q'); if (i) { i.focus(); i.setSelectionRange(i.value.length, i.value.length); } }, 250); };
  window.P7.lfsort = function (k) { if (LF.sort === k) LF.dir = -LF.dir; else { LF.sort = k; LF.dir = 1; } paintList(); };
  window.P7.editShown = function () { var ks = listUnits().map(function (u) { return u.key; }); if (ks.length) { sel = {}; ks.forEach(function (k) { sel[k] = 1; }); renderOverlay(); openEditor(ks); } };

  // ------------------------------------------------------------------ css
  function injectCss() {
    if (document.getElementById('p7Css')) return;
    var s = document.createElement('style'); s.id = 'p7Css';
    s.textContent = [
      /* core pieces that mean nothing here */
      'body.p7-on .plan-marker{display:none!important}',
      'body.p7-on .plan-toolbar, body.p7-on #zoneTabs, body.p7-on #planSection .legend, body.p7-on #planLensBar{display:none!important}',
      'body.p7-on main > section.kpi-grid:first-of-type{display:none!important}',
      '#p7Nav{margin:0 0 10px}',
      '#p7Nav .p7-row{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-bottom:7px}',
      '#p7Nav .p7-grow{flex:1}', '#p7Nav .p7-sep{width:10px}',
      '#p7Nav button{font-family:inherit;cursor:pointer}',
      '.p7-st{background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:8px;padding:7px 14px;font-weight:700;font-size:13px}',
      '.p7-st.on{background:var(--accent);border-color:var(--accent);color:#fff}',
      '.p7-chip{background:var(--panel-2);border:1px solid var(--border);color:var(--text-dim);border-radius:20px;padding:5px 12px;font-size:12.5px;font-weight:600}',
      '.p7-chip.on{color:var(--text);border-color:var(--accent);background:color-mix(in srgb,var(--accent) 18%,transparent)}',
      '.p7-chip.small{padding:4px 10px;font-size:12px}', '.p7-chip em{font-style:normal;opacity:.7;font-size:11px;margin-left:3px}',
      '.p7-sheet{font-size:11px;color:var(--text-dim);margin-left:6px}',
      '.p7-view{display:inline-flex;border:1px solid var(--border);border-radius:8px;overflow:hidden}',
      '.p7-view button{background:transparent;border:0;color:var(--text-dim);padding:5px 11px;font-size:12px}',
      '.p7-view button.on{background:var(--accent);color:#fff}',
      '.p7-legend{font-size:11.5px;color:var(--text-dim)}',
      '.p7-lg{display:inline-flex;align-items:center;gap:4px;margin-right:8px}',
      '.p7-lg i{display:inline-block;min-width:22px;height:15px;border-radius:3px;font-style:normal;font-size:9px;text-align:center;line-height:15px;border:1px solid rgba(127,127,127,.4)}',
      '.p7-issue-sw{outline:2px solid #f85149;outline-offset:-2px}',
      '.p7-hint{opacity:.8}', '.p7-build{font-size:10px;opacity:.55}',
      /* stage colours (Leo 11-12) */
      '.p7-st-none{background:rgba(110,118,129,.55)!important;color:#9aa4ae!important}',
      '.p7-st-ordered{background:rgba(110,118,129,.75)!important;color:#fff!important}',
      '.p7-st-shop{background:rgba(110,118,129,.75)!important;color:#ffd33d!important}',
      '.p7-st-site{background:#ffffff!important;color:#d4a300!important}',
      '.p7-st-installed{background:#2ea043!important;color:#fff!important}',
      'body.day-mode .p7-st-none{background:rgba(110,118,129,.28)!important;color:#59636e!important}',
      'body.day-mode #p7Layer .p7-k-frame.p7-st-none .p7-tag{background:rgba(110,118,129,.45)!important;color:#24292f!important}',
      'body.day-mode .p7-st-site{box-shadow:inset 0 0 0 1px #d4a300}',
      '.p7-hide{display:none!important}',
      '.p7-one-col{grid-template-columns:1fr!important}',
      /* editor footer: More → on the left */
      '.p7-ed-foot{align-items:center;gap:8px}', '.p7-ed-foot .p7-grow{flex:1}',
      '.p7-ed-more{background:none;border:1px solid var(--border);color:var(--accent);border-radius:6px;padding:6px 10px;font:inherit;font-size:12.5px;font-weight:600;cursor:pointer}',
      '.p7-ed-more:hover{background:var(--panel-2)}',
      /* clickable cards + detail modal */
      '.p7-card.clickable{cursor:pointer}', '.p7-card.clickable:hover{border-color:var(--accent)}',
      '.p7-dt td.num,.p7-dt th{text-align:center}', '.p7-dt td:first-child,.p7-dt th:first-child{text-align:left}',
      '.p7-dt-tot td{font-weight:700;border-top:2px solid var(--border)}',
      '.p7-dt-h{margin:16px 0 6px;font-size:13px}', '.p7-dt-h small{color:var(--text-dim);font-weight:600}',
      '.p7-dt-list{max-height:220px;overflow:auto;font-size:12.5px;line-height:1.7}',
      '.p7-dt-date{display:inline-block;width:86px;color:var(--text-dim);font-variant-numeric:tabular-nums}',
      '.p7-dt-dim{color:var(--text-dim);font-size:12px}', '.p7-dt-go{margin-top:12px;text-align:right}',
      '#kpiDetailModal .p7-dt a,#kpiDetailModal .p7-dt-list a{color:var(--accent);text-decoration:none}',
      /* piece list */
      '#p7List button{font-family:inherit;cursor:pointer}',
      '#p7List .section-header{display:flex;align-items:center;gap:10px;flex-wrap:wrap}',
      '.p7-lt{display:flex;gap:8px;align-items:center;margin-left:auto}',
      '.p7-fl{display:flex;flex-wrap:wrap;gap:5px;align-items:center;margin:0 0 7px}',
      '.p7-fl-l{font-size:11px;color:var(--text-dim);width:58px;text-transform:uppercase;letter-spacing:.4px}',
      '.p7-fl-sep{width:10px}',
      '.p7-chip em{font-style:normal;opacity:.65;font-size:11px}',
      '.p7-dot{display:inline-block;width:9px;height:9px;border-radius:2px;margin-right:5px;vertical-align:-1px;border:1px solid rgba(127,127,127,.5)}',
      '.p7-sel,.p7-q{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 8px;font:inherit;font-size:12.5px}',
      '.p7-q{min-width:160px;flex:1;max-width:260px}',
      '.p7-sum{font-size:12px;color:var(--text-dim);margin:4px 0 8px}',
      '.p7-empty{padding:30px;text-align:center;color:var(--text-dim)}',
      '.p7-tw{max-height:70vh;overflow:auto}',
      '.p7-table{width:100%;border-collapse:collapse;font-size:12.5px}',
      '.p7-table th{position:sticky;top:0;background:var(--panel);text-align:left;font-size:11px;text-transform:uppercase;color:var(--text-dim);padding:7px 8px;border-bottom:1px solid var(--border);white-space:nowrap}',
      '.p7-table td{padding:6px 8px;border-bottom:1px solid var(--border);white-space:nowrap}',
      '.p7-table tbody tr{cursor:pointer}', '.p7-table tbody tr:hover td{background:var(--panel-2)}',
      '.p7-table .num{text-align:right;font-variant-numeric:tabular-nums}', '.p7-th{cursor:pointer;user-select:none}',
      '.p7-id{font-weight:700}', '.p7-note{white-space:normal!important;max-width:280px;color:var(--text-dim)}',
      '.p7-loc{background:none;border:0;padding:0 2px;font-size:13px}',
      '.p7-badge{display:inline-block;padding:2px 7px;border-radius:5px;font-size:11px;font-weight:700;border:1px solid rgba(127,127,127,.4)}',
      '.p7-badge.p7-issue{outline:2px solid #f85149;outline-offset:-2px}',
      '@media (max-width:900px){.p7-dcol{display:none}}',
      '.p7-cg{margin-bottom:12px}', '.p7-cg-h{font-size:12.5px;font-weight:700;margin:4px 0 6px}', '.p7-cg-h a{color:var(--text);text-decoration:none}',
      '.p7-cg-h em{font-style:normal;color:var(--text-dim);font-weight:600;margin-left:4px}',
      '.p7-cg-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(112px,1fr));gap:5px}',
      '.p7-tile{border-radius:6px;padding:6px 7px;cursor:pointer;border:1px solid rgba(127,127,127,.35);line-height:1.25}',
      '.p7-tile b{display:block;font-size:12px}', '.p7-tile span{font-size:10.5px;opacity:.85}',
      '.p7-tile.p7-issue{outline:2.5px solid #f85149;outline-offset:-2px}',
      /* overlay */
      '#p7Layer{position:absolute;inset:0;z-index:5;pointer-events:none}',
      '#p7Layer .p7-svg{position:absolute;inset:0;width:100%;height:100%;pointer-events:none}',
      '#p7Layer .p7-svg polygon{pointer-events:auto;cursor:pointer;opacity:.6;stroke:#222;stroke-width:.15}',
      '#p7Layer .p7-svg polygon.p7-st-none{fill:rgba(110,118,129,.55)}', '#p7Layer .p7-svg polygon.p7-st-ordered,#p7Layer .p7-svg polygon.p7-st-shop{fill:rgba(110,118,129,.8)}',
      '#p7Layer .p7-svg polygon.p7-st-site{fill:#fff}', '#p7Layer .p7-svg polygon.p7-st-installed{fill:#2ea043}',
      '#p7Layer .p7-svg polygon.p7-mat{fill:var(--mat)!important}',
      '#p7Layer .p7-pc{position:absolute;box-sizing:border-box;pointer-events:auto;cursor:pointer;border:1px solid rgba(0,0,0,.45);opacity:.86;display:flex;align-items:center;justify-content:center;overflow:hidden}',
      '#p7Layer .p7-pc span{font-size:9px;font-weight:700;line-height:1.05;text-align:center;white-space:nowrap;pointer-events:none}',
      '#p7Layer .p7-pc span em{display:block;font-style:normal;font-weight:600}',
      '#p7Layer .p7-pc.p7-mat{background:var(--mat)!important;color:#222!important}',
      '#p7Layer .p7-k-frame,#p7Layer .p7-k-canopy,#p7Layer .p7-k-frame.p7-mat,#p7Layer .p7-k-canopy.p7-mat{background:transparent!important;border:2px solid #58a6ff;opacity:1;pointer-events:none;align-items:flex-start;justify-content:flex-start;overflow:visible}',
      '#p7Layer .p7-k-canopy{border-style:dashed;border-color:#a9a5e0}',
      '#p7Layer .p7-k-canopy.p7-st-site,#p7Layer .p7-k-canopy.p7-st-shop{border-color:#d4a300}', '#p7Layer .p7-k-canopy.p7-st-installed{border-color:#2ea043}',
      '#p7Layer .p7-k-frame.p7-st-installed{border-color:#2ea043}', '#p7Layer .p7-k-frame.p7-st-site,#p7Layer .p7-k-frame.p7-st-shop{border-color:#d4a300}',
      '#p7Layer .p7-tag{pointer-events:auto;cursor:pointer;font-size:9px;padding:1px 4px;border-radius:3px;transform:translate(-2px,-100%);border:1px solid rgba(0,0,0,.4);white-space:nowrap}',
      '#p7Layer .p7-k-frame .p7-tag{background:inherit}',
      '#p7Layer .p7-k-frame.p7-st-none .p7-tag{background:rgba(110,118,129,.85)!important}',
      '#p7Layer .p7-k-canopy .p7-tag{transform:translate(-2px,0)}',
      '#p7Layer .p7-issue{outline:2.5px solid #f85149;outline-offset:-2px;opacity:1}',
      '#p7Layer .p7-sel{box-shadow:0 0 0 3px #1f6feb inset, 0 0 0 2px #1f6feb;opacity:1}',
      '#p7Layer .p7-roofl{position:absolute;transform:translate(-50%,-50%);pointer-events:auto;cursor:pointer;font-size:11px;font-weight:700;padding:2px 6px;border-radius:5px;border:1px solid rgba(0,0,0,.4);white-space:nowrap}',
      '#p7Layer .p7-roofl em{font-style:normal;font-weight:600;margin-left:5px}',
      '#p7Layer .p7-hot{position:absolute;pointer-events:auto;cursor:pointer;border:3px solid #1f6feb;border-radius:6px;background:rgba(31,111,235,.12)}',
      '#p7Layer .p7-hot span{position:absolute;left:0;top:-2px;transform:translateY(-100%);background:#1f6feb;color:#fff;font-size:12px;font-weight:700;padding:2px 7px;border-radius:5px;white-space:nowrap}',
      /* editor */
      '#p7Ed{display:none;position:fixed;right:16px;bottom:16px;z-index:9000;width:320px;max-width:calc(100vw - 32px);background:var(--panel,#161b22);color:var(--text);border:1px solid var(--border);border-radius:10px;box-shadow:0 10px 30px rgba(0,0,0,.45);padding:12px 14px;font-size:13px}',
      '.p7-ed-head{display:flex;justify-content:space-between;align-items:center;margin-bottom:4px}',
      '.p7-ed-head b{font-size:15px}', '.p7-ed-head button{background:none;border:0;color:var(--text-dim);font-size:16px;cursor:pointer}',
      '.p7-ed-sub{font-size:11.5px;color:var(--text-dim);margin-bottom:8px;line-height:1.4;max-height:72px;overflow:auto}',
      '.p7-ed-stages{display:grid;grid-template-columns:repeat(5,1fr);gap:4px;margin-bottom:8px}',
      '.p7-ed-stages button{border:1px solid rgba(127,127,127,.5);border-radius:6px;padding:7px 2px;font-size:11.5px;font-weight:700;cursor:pointer}',
      '.p7-ed-stages button.cur{box-shadow:0 0 0 2px #1f6feb}',
      '.p7-ed-row{display:flex;align-items:center;gap:8px;margin:6px 0}', '.p7-ed-row.p7-col{flex-direction:column;align-items:stretch}',
      '.p7-ed-row input[type=date],.p7-ed-row input[type=number],.p7-ed-row textarea{background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 7px;font:inherit}',
      '.p7-ed-roof{border:1px dashed var(--border);border-radius:8px;padding:8px;margin:6px 0}', '.p7-ed-note{font-size:11px;color:var(--text-dim)}',
      '.p7-ed-frame{width:100%;margin:6px 0;background:var(--panel-2);border:1px solid var(--border);color:var(--text);border-radius:6px;padding:6px;cursor:pointer;font-size:12px}',
      '.p7-ed-hist{font-size:11px;color:var(--text-dim);margin:4px 0}',
      '.p7-ed-foot{display:flex;justify-content:flex-end;margin-top:8px}',
      /* cards */
      '#p7Cards{margin-bottom:16px}', '.p7-cards-head{font-size:12px;color:var(--text-dim);margin:0 2px 8px}',
      '.p7-cards{display:grid;grid-template-columns:repeat(auto-fill,minmax(138px,1fr));gap:8px}',
      '.p7-card.kpi-card{padding:11px 13px}', '.p7-card .kpi-label{font-size:10.5px;min-height:26px}', '.p7-card .kpi-value{font-size:24px}',
      '.p7-card .kpi-value small{font-size:12px;font-weight:600;opacity:.7}',
      '.p7-bar{display:flex;height:6px;border-radius:3px;overflow:hidden;background:rgba(127,127,127,.2);margin-top:8px}',
      '.p7-bar i{display:block;height:100%}', '.p7-bar i.p7-st-site{background:#d4a300!important}',
      '.p7-mini{font-size:10.5px;color:var(--text-dim);margin-top:4px;min-height:13px}',
      '.p7-iss{color:#f85149;font-size:10.5px;font-weight:700}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // ------------------------------------------------------------- wire in
  function refresh() { baselineSync(); paintNav(); paintCards(); }
  function wrap(name, before, after) {
    var orig = window[name];
    if (typeof orig !== 'function') { console.warn('[p7] core function missing:', name); return; }
    window[name] = function () {
      if (before) { try { before.apply(null, arguments); } catch (e) { console.error('[p7] pre-' + name, e); } }
      var out = orig.apply(this, arguments);
      if (after) { try { after.apply(null, arguments); } catch (e) { console.error('[p7] post-' + name, e); } }
      return out;
    };
  }
  wrap('renderKPIs', null, refresh);
  wrap('renderPlan', null, function () { fitWrap(); renderOverlay(); paintNav(); });
  wrap('renderTable', null, paintList);
  /* core pans the plan with pointer capture on #planViewport, so the click that follows may be
     retargeted to the viewport — remember what was under the pointer at pointerdown instead,
     and ignore it if the pointer moved (that was a pan, not a click). */
  var down = null;
  document.addEventListener('pointerdown', function (ev) {
    var L = document.getElementById('p7Layer');
    down = (L && L.contains(ev.target)) ? { t: ev.target, x: ev.clientX, y: ev.clientY } : null;
  }, true);
  document.addEventListener('click', function (ev) {
    if (!down) return;
    var d = down; down = null;
    if (Math.hypot(ev.clientX - d.x, ev.clientY - d.y) > 5) return;
    onLayerClick(ev, d.t);
  }, true);
  window.addEventListener('resize', function () { fitWrap(); });

  injectCss();
  document.body && document.body.classList.add('p7-on');
  function bindImg() {
    var img = document.getElementById('planImg');
    if (img && !img._p7) { img._p7 = 1; img.addEventListener('load', function () { fitWrap(); try { planZoomReset(); } catch (e) {} }); }
  }
  /* 476 tiles in the core unit grid repeat the elevations; the glass donut reads CP2-style
     glass fields that P7 pieces do not have. Hidden here, not removed — delete these two
     lines to bring them back. */
  function hideCoreBits() {
    var g = document.getElementById('unitGrid'); if (g && g.closest('section')) g.closest('section').classList.add('p7-hide');
    var c = document.getElementById('glassDonutChart'); if (c && c.closest('.section')) c.closest('.section').classList.add('p7-hide');
    // core's Unit Detail Table → replaced by the full-width piece list (paintList); the daily log beside it takes the row
    var t = document.getElementById('tableBody'), ts = t && t.closest('section');
    if (ts) { ts.classList.add('p7-hide'); if (ts.parentNode && ts.parentNode.classList.contains('grid-2')) ts.parentNode.classList.add('p7-one-col'); }
  }
  function boot() { hideCoreBits(); bindImg(); injectCss(); document.body.classList.add('p7-on'); refresh(); fitWrap(); renderOverlay(); paintList(); try { planZoomReset(); } catch (e) {} }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
  console.log('[p7] Package 7 module ' + BUILD + ' loaded');
})();
