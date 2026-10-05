/* ============================================================================
   lf.js — railing progress   (355 Lexington Avenue, project-specific)
   ----------------------------------------------------------------------------
   NOT a core file. app.js / app-log.js / cloud-sync.js stay byte-identical with
   CP2 + AC3 so they can be synced between trackers; everything this job needs
   that they don't have lives here, layered on top by wrapping the core
   functions after app.js has defined them. Load order matters: this script must
   come AFTER app.js in index.html.

   WHY IT EXISTS
   CP2 and AC3 count units — a storefront is either in or it isn't. Railings
   aren't like that:

     • A guardrail run is a LENGTH. The 12th floor is 264 LF that goes in over
       several days, and "which stretch is done" is a real question. So each run
       is drawn on the plan at its true surveyed shape (straight out of the
       Bluebeam markups in the CD set) and you DRAG ALONG IT to say how much is
       standing. Feet in, percentage out.
     • A terrace divider is a PANEL. Per Leo 2026-08-18 there is no LF
       percentage for dividers — a panel is in or it isn't. They're drawn as
       individual segments you click to toggle.
     • A shower door (159 of them, floors 2-25, added 2026-09-01) is a COUNTED
       item — the drawing marks each one with a 4' square, nothing is measured.
       One row per door, same as a divider panel: the row's status is the record,
       and the row is what carries the date, Field Verify and RFI. Keyed SD**.
     • An equipment screen (26th + 27th mech roofs, added 2026-08-27) is a
       LENGTH like the guardrail and behaves identically — same drag, same
       modal, same feet. It is kept as its own category only for REPORTING:
       its own card, its own column, its own bar on the trend, because it is a
       different product bought and built separately. Rows are keyed ES**;
       everything behavioural asks isRun(), not isGR().

   DATA ADDED TO EACH UNIT (seeded from project-config.js, which is generated
   from the drawings by _build/write_config.py — see that file before editing):

     Guardrail row          Terrace divider row
     ------------------     ----------------------------
     lf        total feet   lf          total feet (reference only)
     runs[]    {label,lf,pts}   panels[]    {label,lf,pts}
     runsDone[] feet per run    panelsDone[] one boolean per panel
     lfDone    sum(runsDone)

   `pts` are normalised 0..1 inside that floor's plan image, so the overlay
   lines up no matter how the image is scaled or zoomed.

   Install status is DERIVED from those numbers and written into the Calendar
   tab's Frame row before core saveUnit() reads it, so markers, charts, the
   daily log and Firebase sync all keep working exactly as on the other two
   projects. An 'Issue' status is never overwritten: that is a human judgement,
   not arithmetic.
   ========================================================================== */
(function () {
  'use strict';

  var HIDDEN_SCOPES = ['caulking', 'beautyCap'];   // CP2 scopes with no meaning here

  /* Colours come from the theme, not from here (themes.js). Read live rather than
     cached at load: switching theme re-runs renderOverlay()/renderCharts(), and both
     must pick up the new palette. Fallbacks are the night-theme values, so this still
     works if themes.js is ever absent. */
  function cssVar(name, fallback) {
    try {
      var v = getComputedStyle(document.body).getPropertyValue(name);
      if (v && v.trim()) return v.trim();
    } catch (e) {}
    return fallback;
  }
  function grColor() { return cssVar('--rail-gr', '#7ee787'); }
  function tdColor() { return cssVar('--rail-td', '#a371f7'); }
  function esColor() { return cssVar('--rail-es', '#e3b341'); }
  function sdColor() { return cssVar('--rail-sd', '#39d0d6'); }
  function trackColor() { return cssVar('--rail-track', 'rgba(140,150,165,.55)'); }
  function issueColor() { return cssVar('--red', '#f85149'); }

  /* Bumped whenever this file changes shape, and shown on the plan header. v2 shipped
     under v1's ?v= query, so browsers kept running the old script against the new files
     and the interactive railings simply never appeared — with no error to go on. The
     badge makes "which build is actually loaded" answerable at a glance; keep it in step
     with the ?v= strings in index.html. */
  var BUILD = 'scopes·2026-09-01b';

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function num(n) {
    return (Math.round((Number(n) || 0) * 100) / 100)
      .toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  function today() { return new Date().toISOString().slice(0, 10); }
  function pct(done, total) { return total > 0 ? Math.round((done / total) * 100) : 0; }
  function units() {
    return (typeof state !== 'undefined' && state && Array.isArray(state.units)) ? state.units : [];
  }
  function unitByKey(k) { return units().find(function (u) { return u.key === k; }) || null; }

  /* --- the baseline is the whitelist (Leo 2026-09-01) ------------------------
     Everything this file draws and counts comes from rows that are IN the current
     project-config seed. A row whose key the seed no longer has is a leftover — the
     floor-level `TD17` divider rows this tracker used before the one-row-per-panel
     split, say, pushed back into the cloud by a browser that still had them cached.
     baselineSync() can't correct such a row (there is no seed entry to copy from), so
     it keeps whatever geometry it was saved with — an old crop's normalised coordinates,
     which on today's wider plan image draw a second, shifted divider above the real one.
     Leo saw exactly that on the 17th floor. Filtering here means a stale row can never
     paint a ghost again, whatever its key; the migration below deletes the ones we know. */
  var _seedKeys = null;
  function seedKeys() {
    if (!_seedKeys) {
      _seedKeys = {};
      var s = (window.PROJECT && Array.isArray(PROJECT.seedUnits)) ? PROJECT.seedUnits : [];
      s.forEach(function (u) { if (u && u.key) _seedKeys[u.key] = 1; });
    }
    return _seedKeys;
  }
  function inBaseline(u) { return !!(u && _seedKeysHas(u.key)); }
  function _seedKeysHas(k) { var m = seedKeys(); return !!(k && m[k]); }
  // every row this file is allowed to draw or count
  function scoped() { return units().filter(inBaseline); }

  /* A piece counts as geometry only if it carries a polyline. v1 of this tracker stored
     `runs` as an array of LABEL STRINGS ("35'-0\""), and a browser that still has that in
     localStorage would otherwise reach the drawing code and blow up on `run.pts`. Checking
     the shape — not just the key — makes every path below safe against older saved state,
     which baselineSync() then replaces with the real geometry. */
  function hasGeom(list) {
    return Array.isArray(list) && list.length > 0 &&
      list.every(function (p) { return p && Array.isArray(p.pts) && p.pts.length >= 2; });
  }
  /* Three categories, two behaviours. Guardrail and equipment screen are both RUN-based
     (feet, dragged along the line); dividers are panels. So the drawing / dragging / modal
     code all asks isRun(), and only the reporting split — cards, floor table, trend,
     colour — cares which of the two a run belongs to.

     isRun stays a SHAPE test for the upgrade reason in hasGeom() above; the ES/GR split on
     top of it is by key, which is safe because no older saved state has ES rows at all. */
  function isRun(u) { return !!u && hasGeom(u.runs); }
  function isES(u) { return isRun(u) && /^ES/.test(u.key || ''); }
  function isGR(u) { return isRun(u) && !isES(u); }
  /* Panel-shaped scopes: a divider panel and a shower door are both ONE piece per row whose
     status IS the record. They share every code path — drawing, tapping, the modal — and are
     split only for reporting: their own card, column, colour and bar. Same arrangement as
     guardrail vs equipment screen above. Shower doors are counted, not measured: the markup
     is a 4' square stamped on each door. */
  function isPanel(u) { return !!u && hasGeom(u.panels); }
  function isSD(u) { return isPanel(u) && /^SD/.test(u.key || ''); }
  function isTD(u) { return isPanel(u) && !isSD(u); }

  function lfOf(u) { var v = Number(u && u.lf); return isFinite(v) && v > 0 ? v : 0; }
  function runDone(u, i) {
    var v = Number((u.runsDone || [])[i]);
    if (!isFinite(v) || v < 0) v = 0;
    var cap = Number(u.runs[i].lf) || 0;
    return Math.min(v, cap);
  }
  function grDone(u) {
    return u.runs.reduce(function (s, r, i) { return s + runDone(u, i); }, 0);
  }
  /* One row per panel since 2026-08-27, so the ROW's status is the panel's status — which
     is the whole point: a status carries a date, and a row carries Field Verify, RFIs,
     issues and photos with it. panelsDone is kept in step (baselineSync) purely so the
     seed, older saved state and the plan all keep the same shape; it is never the truth.
     The multi-panel branch stays for any row that predates the split. */
  function tdDone(u) {
    if (u.panels && u.panels.length === 1) return u.status === 'installed' ? 1 : 0;
    return (u.panelsDone || []).filter(Boolean).length;
  }
  /* One progress reading for any row, so the cards / table / drill-down don't each
     re-derive it: {done,total,unit,pctv} where unit is 'LF' or 'panels'. */
  function progress(u) {
    if (isRun(u)) { var d = grDone(u), t = lfOf(u); return { done: d, total: t, unit: 'LF', pctv: pct(d, t) }; }
    if (isPanel(u)) {
      var n = tdDone(u), m = u.panels.length;
      return { done: n, total: m, unit: isSD(u) ? 'doors' : 'panels', pctv: pct(n, m) };
    }
    return { done: 0, total: 0, unit: '', pctv: 0 };
  }
  function sumProgress(list) {
    return list.reduce(function (a, u) {
      var p = progress(u); a.done += p.done; a.total += p.total; return a;
    }, { done: 0, total: 0 });
  }
  function grUnits() { return scoped().filter(isGR); }
  function esUnits() { return scoped().filter(isES); }
  function tdUnits() { return scoped().filter(isTD); }
  function sdUnits() { return scoped().filter(isSD); }

  /* ==========================================================================
     SCOPE FILTER (Leo 2026-09-01: "floor 数量太多 … 只显示对应楼层，可多选")
     --------------------------------------------------------------------------
     The shower doors took this job from 9 floor tabs to 26, and most of those floors
     carry one scope only. So the plan gets a row of scope chips: turn a scope off and
     every floor that has nothing but that scope leaves the floor bar and the unit-grid
     tab row, and the plan stops drawing it. Multi-select, remembered per browser.

     What it does NOT touch: the KPI cards, the by-floor rollup table and the trend chart
     always report the whole job. A filter that quietly changed the numbers would be a
     way to mis-read progress, and nobody asked for that.
     ========================================================================== */
  var SCOPE_STORE = 'lex355_scopes_v1';
  var SCOPES = [
    { k: 'gr', is: isGR, color: grColor, name: { en: 'Guardrail', zh: '护栏', ko: '가드레일' } },
    { k: 'td', is: isTD, color: tdColor, name: { en: 'Terrace Divider', zh: '露台隔板', ko: '테라스 디바이더' } },
    { k: 'es', is: isES, color: esColor, name: { en: 'Equipment Screen', zh: '设备屏', ko: '장비 스크린' } },
    { k: 'sd', is: isSD, color: sdColor, name: { en: 'Shower Door', zh: '淋浴门', ko: '샤워 도어' } }
  ];
  var ALL_SCOPES = SCOPES.map(function (s) { return s.k; });
  var _scopes = null;

  function scopesOn() {
    if (!_scopes) {
      var a = null;
      try { a = JSON.parse(localStorage.getItem(SCOPE_STORE) || 'null'); } catch (e) {}
      _scopes = (Array.isArray(a) && a.length) ? ALL_SCOPES.filter(function (k) { return a.indexOf(k) >= 0; }) : [];
      if (!_scopes.length) _scopes = ALL_SCOPES.slice();
    }
    return _scopes;
  }
  function scopeOf(u) {
    for (var i = 0; i < SCOPES.length; i++) if (SCOPES[i].is(u)) return SCOPES[i].k;
    return null;
  }
  function scopeShown(u) { var k = scopeOf(u); return !!k && scopesOn().indexOf(k) >= 0; }
  /* {floorKey: {scopeKey: count}} over the baseline — what each floor actually has. */
  function floorScopes() {
    var m = {};
    scoped().forEach(function (u) {
      var k = scopeOf(u);
      if (!k || !u.level) return;
      m[u.level] = m[u.level] || {};
      m[u.level][k] = (m[u.level][k] || 0) + 1;
    });
    return m;
  }
  /* A floor with no scope at all (shouldn't happen, but never lose a tab over it) stays. */
  function floorShown(key, map) {
    var m = (map || floorScopes())[key];
    if (!m) return true;
    return scopesOn().some(function (k) { return !!m[k]; });
  }
  function setScopes(list) {
    _scopes = ALL_SCOPES.filter(function (k) { return list.indexOf(k) >= 0; });
    if (!_scopes.length) _scopes = ALL_SCOPES.slice();     // never an empty plan
    try { localStorage.setItem(SCOPE_STORE, JSON.stringify(_scopes)); } catch (e) {}
    applyScopeFilter();
    if (!ensureLevelShown() && typeof renderPlan === 'function') renderPlan();
    ensureZoneShown();
  }
  function toggleScope(k) {
    if (k === '*') return setScopes(ALL_SCOPES.slice());
    var on = scopesOn().slice();
    var i = on.indexOf(k);
    if (i >= 0) on.splice(i, 1); else on.push(k);
    setScopes(on);
  }
  /* The chip row is inserted BEFORE .plan-toolbar rather than inside it: gc-view hides
     every toolbar child but the first, and the filter should survive that the way the
     lens bar does. */
  function scopeBarHost() {
    var tb = document.querySelector('#planSection .plan-toolbar') || document.querySelector('.plan-toolbar');
    var host = document.getElementById('lfScopeBar');
    if (host) {
      // core's lens bar inserts itself before the toolbar too, and it renders after us —
      // so re-seat the chips on every pass to keep them directly above the floor buttons.
      if (tb && tb.parentElement && host.nextElementSibling !== tb) tb.parentElement.insertBefore(host, tb);
      return host;
    }
    if (!tb || !tb.parentElement) return null;
    host = document.createElement('div');
    host.id = 'lfScopeBar';
    host.addEventListener('click', function (ev) {
      var b = ev.target.closest ? ev.target.closest('[data-scope]') : null;
      if (b) toggleScope(b.getAttribute('data-scope'));
    });
    tb.parentElement.insertBefore(host, tb);
    return host;
  }
  function lang() { return (typeof currentLang !== 'undefined' && currentLang) ? currentLang : 'en'; }
  function paintScopeBar() {
    var host = scopeBarHost();
    if (!host) return;
    var fmap = floorScopes(), on = scopesOn(), L = lang();
    var floorsWith = {};
    Object.keys(fmap).forEach(function (fk) {
      Object.keys(fmap[fk]).forEach(function (s) { floorsWith[s] = (floorsWith[s] || 0) + 1; });
    });
    var shown = 0, total = 0;
    ((typeof getFloors === 'function') ? getFloors() : []).forEach(function (f) {
      total++; if (floorShown(f.key, fmap)) shown++;
    });
    var lab = { en: 'Scope', zh: '范围', ko: '범위' }[L] || 'Scope';
    var flab = { en: 'floors', zh: '层', ko: '층' }[L] || 'floors';
    var html = '<span class="lf-scope-label">' + esc(lab) + '</span>' + SCOPES.map(function (s) {
      var act = on.indexOf(s.k) >= 0;
      return '<button type="button" class="lf-scope-chip' + (act ? ' on' : '') + '" data-scope="' + s.k +
        '" style="--chip:' + s.color() + '" aria-pressed="' + (act ? 'true' : 'false') + '">' +
        '<i class="lf-scope-dot"></i>' + esc(s.name[L] || s.name.en) +
        '<b class="lf-scope-n">' + (floorsWith[s.k] || 0) + '</b></button>';
    }).join('') +
      '<button type="button" class="lf-scope-chip lf-scope-all' + (on.length === ALL_SCOPES.length ? ' on' : '') +
      '" data-scope="*">' + esc({ en: 'All', zh: '全部', ko: '전체' }[L] || 'All') + '</button>' +
      '<span class="lf-scope-count">' + shown + ' / ' + total + ' ' + esc(flab) + '</span>';
    host.innerHTML = html;
  }
  /* Core rebuilds both rows from PROJECT.floors on every render, so this runs as a
     post-hook on renderFloorControls() and hides rather than removes: core looks the
     per-floor count spans up by id (#cnt-L05) and a missing floor must not break that. */
  function applyScopeFilter() {
    paintScopeBar();
    var fmap = floorScopes();
    document.querySelectorAll('.plan-toolbar .level-btn').forEach(function (b) {
      b.style.display = floorShown(b.dataset.level, fmap) ? '' : 'none';
    });
    document.querySelectorAll('#zoneTabs .tab').forEach(function (tab) {
      var z = tab.dataset.zone;
      tab.style.display = (z === 'all' || floorShown(z, fmap)) ? '' : 'none';
    });
  }
  function ensureLevelShown() {
    if (typeof currentLevel === 'undefined' || typeof setLevel !== 'function') return false;
    var fmap = floorScopes();
    if (floorShown(currentLevel, fmap)) return false;
    var f = ((typeof getFloors === 'function') ? getFloors() : []).find(function (x) { return floorShown(x.key, fmap); });
    if (!f) return false;
    setLevel(f.key);          // repaints the plan itself
    return true;
  }
  function ensureZoneShown() {
    if (typeof currentZone === 'undefined' || currentZone === 'all') return;
    if (floorShown(currentZone)) return;
    currentZone = 'all';
    document.querySelectorAll('#zoneTabs .tab').forEach(function (tab) {
      tab.classList.toggle('active', tab.dataset.zone === 'all');
    });
    if (typeof renderUnitGrid === 'function') renderUnitGrid();
  }

  /* --- baseline sync -------------------------------------------------------
     lf / runs / panels / sheet are DRAWING data, not user input — force them to
     match project-config.js on every load (same reasoning as core's `zone` sync),
     so a corrected extraction reaches live cloud data without a /state reset.
     runsDone / panelsDone are the team's work and are only ever resized, never
     cleared. */
  function baselineSync() {
    var seeds = (window.PROJECT && Array.isArray(PROJECT.seedUnits)) ? PROJECT.seedUnits : [];
    var byKey = {};
    seeds.forEach(function (s) { byKey[s.key] = s; });
    units().forEach(function (u) {
      var s = byKey[u.key];
      if (s) {
        if (typeof s.lf === 'number') u.lf = s.lf;
        if (s.sheet) u.sheet = s.sheet;
        if (Array.isArray(s.runs)) u.runs = JSON.parse(JSON.stringify(s.runs));
        if (Array.isArray(s.panels)) u.panels = JSON.parse(JSON.stringify(s.panels));
      }
      if (isRun(u)) {
        if (!Array.isArray(u.runsDone)) u.runsDone = [];
        u.runsDone.length = u.runs.length;
        for (var i = 0; i < u.runs.length; i++) {
          var v = Number(u.runsDone[i]);
          u.runsDone[i] = (isFinite(v) && v > 0) ? Math.min(v, u.runs[i].lf) : 0;
        }
        u.lfDone = Math.round(grDone(u) * 100) / 100;
      }
      if (isPanel(u)) {
        if (!Array.isArray(u.panelsDone)) u.panelsDone = [];
        u.panelsDone.length = u.panels.length;
        for (var j = 0; j < u.panels.length; j++) u.panelsDone[j] = !!u.panelsDone[j];
        // single-panel rows: derive it from the row, never the other way round
        if (u.panels.length === 1) u.panelsDone = [u.status === 'installed'];
      }
    });
  }

  /* --- commit ---------------------------------------------------------------
     Everything that changes progress funnels through here: derive the status,
     write the daily-log delta, persist. `describe` labels the change in the
     cloud Edit History the same way core's own edits do. */
  function deriveStatus(u) {
    if (u.status === 'issue') return u.status;      // human judgement, never overwritten
    var p = progress(u);
    if (p.done <= 0) return 'pending';
    return (p.total > 0 && p.done >= p.total - 1e-6) ? 'installed' : 'in-progress';
  }
  function commit(u, before, label) {
    if (isRun(u)) u.lfDone = Math.round(grDone(u) * 100) / 100;
    var st = deriveStatus(u);
    u.status = st;
    if (!u.scopes) u.scopes = {};
    if (st === 'pending') { u.date = ''; }
    else if (!u.date) { u.date = today(); }
    u.scopes.frame = { status: st, date: u.date || '' };
    logDelta(u, before, progress(u).done);
    if (typeof CloudSync !== 'undefined' && CloudSync.describe) CloudSync.describe(label);
    if (typeof saveState === 'function') saveState(false, label);
    if (typeof render === 'function') render(); else refresh();
  }

  /* --- daily log: the day's production ------------------------------------
     Core only logs a unit when it reaches 'installed' or 'issue' — right for a
     storefront, wrong here: putting in 100 of the 12th floor's 264 LF is a real
     day's work and has to show on the trend. One entry per row per day,
     rewritten (not duplicated) when the number is corrected later the same day;
     if the day nets out to zero the entry is removed again.

     Deliberately NOT shaped like a core auto-entry (`auto:true` + `categories[]`
     is what removeUnitFromUnitLogs() sweeps) so these survive core's sweep. */
  function logDelta(u, before, after) {
    if (typeof state === 'undefined' || !state || !Array.isArray(state.log)) return;
    if (Math.abs(after - before) < 0.005) return;
    var date = u.date || today();
    var e = state.log.find(function (l) {
      return l && l.lfEntry === true && l.unitKey === u.key && l.date === date;
    });
    if (!e) {
      e = { date: date, category: 'framing', lfEntry: true, unitKey: u.key, from: before };
      state.log.push(e);
    }
    e.to = after;
    if (Math.abs(e.to - e.from) < 0.005) { state.log.splice(state.log.indexOf(e), 1); return; }
    var d = Math.round((e.to - e.from) * 100) / 100;
    var p = progress(u);
    e.unit = p.unit;
    e.content = u.id + ' · ' + (d > 0 ? '+' : '') + num(d) + ' ' + p.unit +
      ' (' + num(e.to) + ' / ' + num(p.total) + ' · ' + pct(e.to, p.total) + '%)';
  }

  // ------------------------------------------------------------ headline cards
  function card(valueId, subId, done, total, unitLabel) {
    var v = document.getElementById(valueId);
    if (v) v.textContent = pct(done, total) + '%';
    var s = document.getElementById(subId);
    if (s) s.textContent = num(done) + ' / ' + num(total) + ' ' + unitLabel;
  }
  function paintCards() {
    var g = sumProgress(grUnits()), d = sumProgress(tdUnits()), e = sumProgress(esUnits());
    var sd = sumProgress(sdUnits());
    card('kpi-lf-gr', 'kpi-lf-gr-sub', g.done, g.total, 'LF');
    card('kpi-lf-td', 'kpi-lf-td-sub', d.done, d.total, 'panels');
    card('kpi-lf-es', 'kpi-lf-es-sub', e.done, e.total, 'LF');
    card('kpi-lf-sd', 'kpi-lf-sd-sub', sd.done, sd.total, 'doors');
  }

  // -------------------------------------------------------- by-floor rollup
  function bar(done, total, color) {
    var p = pct(done, total);
    return '<span class="lf-bar" title="' + p + '%"><span style="width:' + p + '%;background:' + color + '"></span></span>';
  }
  function rollupRow(label, g, d, e, sd, isTotal) {
    var overall = pct((g.total ? g.done / g.total : 0) * (g.total ? 1 : 0) + 0, 1); // placeholder, replaced below
    // A floor's headline % weights the two scopes by their own units, which don't mix
    // (feet vs panels) — so show them side by side and give the floor an LF-weighted
    // number only when there is guardrail on it.
    /* The floor headline weights the two FOOT scopes together (same unit) and falls back to
       panels on a floor that has nothing but dividers. */
    var ftDone = g.done + e.done, ftTotal = g.total + e.total;
    /* Feet first where there are any; otherwise the piece counts, which is what a floor with
       nothing but shower doors on it actually has. */
    var floorPct = ftTotal ? pct(ftDone, ftTotal)
                 : (d.total + sd.total ? pct(d.done + sd.done, d.total + sd.total) : 0);
    return '<tr' + (isTotal ? ' class="lf-total"' : '') + '>' +
      '<td>' + esc(label) + '</td>' +
      '<td class="lf-n">' + (g.total ? num(g.done) + ' / ' + num(g.total) + ' LF' : '—') + '</td>' +
      '<td class="lf-b">' + (g.total ? bar(g.done, g.total, grColor()) : '') + '</td>' +
      '<td class="lf-n">' + (d.total ? d.done + ' / ' + d.total : '—') + '</td>' +
      '<td class="lf-b">' + (d.total ? bar(d.done, d.total, tdColor()) : '') + '</td>' +
      '<td class="lf-n">' + (e.total ? num(e.done) + ' / ' + num(e.total) + ' LF' : '—') + '</td>' +
      '<td class="lf-b">' + (e.total ? bar(e.done, e.total, esColor()) : '') + '</td>' +
      '<td class="lf-n">' + (sd.total ? sd.done + ' / ' + sd.total : '—') + '</td>' +
      '<td class="lf-b">' + (sd.total ? bar(sd.done, sd.total, sdColor()) : '') + '</td>' +
      '<td class="lf-n lf-strong">' + floorPct + '%</td>' +
      '</tr>';
  }
  function paintByFloor() {
    var host = document.getElementById('lfByFloor');
    if (!host) return;
    var floors = (typeof getFloors === 'function') ? getFloors() : [];
    var rows = floors.map(function (f) {
      var on = scoped().filter(function (u) { return (u.level || '') === f.key; });
      return rollupRow((typeof floorLabel === 'function') ? floorLabel(f) : f.key,
        sumProgress(on.filter(isGR)), sumProgress(on.filter(isTD)),
        sumProgress(on.filter(isES)), sumProgress(on.filter(isSD)), false);
    }).join('');
    rows += rollupRow('All floors', sumProgress(grUnits()), sumProgress(tdUnits()),
      sumProgress(esUnits()), sumProgress(sdUnits()), true);
    host.innerHTML = '<table class="lf-table"><thead><tr>' +
      '<th>Floor</th><th colspan="2">Guardrail</th><th colspan="2">Terrace Divider (panels)</th>' +
      '<th colspan="2">Equipment Screen</th><th colspan="2">Shower Door (doors)</th>' +
      '<th>Floor</th>' +
      '</tr></thead><tbody>' + rows + '</tbody></table>';
  }

  /* ==========================================================================
     PLAN OVERLAY — the railing drawn at its real shape, draggable
     --------------------------------------------------------------------------
     An SVG sits on top of the plan image inside #planWrap. viewBox is 0 0 1000
     1000 with preserveAspectRatio="none", so normalised 0..1 geometry stretches
     to exactly cover the image at any size; `vector-effect:non-scaling-stroke`
     keeps the lines a constant on-screen width despite that distortion.

     Progress is drawn as its own path — the run's polyline cut at the booked
     fraction — so the filled part follows the true shape around every corner
     and 100% is literally the whole line, with nothing left over.

     Hit testing walks the path in SCREEN space, not user space: the viewBox is
     deliberately non-uniform, so "closest point" measured in user units would
     be wrong on any plan that isn't square.
     ========================================================================== */
  var SVGNS = 'http://www.w3.org/2000/svg';
  var _drag = null;
  var _tap = null;

  function planUnitsOnFloor() {
    var lvl = (typeof currentLevel !== 'undefined') ? currentLevel : null;
    return scoped().filter(function (u) {
      return u.level === lvl && (isRun(u) || isPanel(u)) && scopeShown(u);
    });
  }
  /* --- measuring a run ------------------------------------------------------
     The overlay's viewBox is 0 0 1000 1000 with preserveAspectRatio="none", so it is a
     NON-UNIFORM stretch of the plan: one user unit across is not one user unit down. Feet
     are uniform. So anything that has to mean feet — how much of a run is booked, where the
     pointer is along it — must be measured in PLAN PIXELS (normalised × planSize), or in
     screen pixels, which is the same thing scaled evenly. Never in the SVG's own user units.

     That is the bug this replaced: the fill was a dash of `frac` of the path's USER length,
     so on an L-shaped run the horizontal and vertical legs were weighted wrongly, and "100%"
     drew a dash that ran out before the end of the line — 196.33 of 196.33 LF in the data,
     a grey tail on the plan (Leo 2026-08-27). */
  function planSize() {
    var fs = (typeof getFloors === 'function') ? getFloors() : [];
    var lvl = (typeof currentLevel !== 'undefined') ? currentLevel : null;
    var f = fs.find(function (x) { return x.key === lvl; });
    var s = f && f.planSize;
    return (s && s[0] > 0 && s[1] > 0) ? [s[0], s[1]] : [1000, 1000];
  }
  function legs(pts, sx, sy) {
    var out = { seg: [], total: 0 };
    for (var i = 1; i < pts.length; i++) {
      var d = Math.hypot((pts[i][0] - pts[i - 1][0]) * sx, (pts[i][1] - pts[i - 1][1]) * sy);
      out.seg.push(d); out.total += d;
    }
    return out;
  }
  /* The booked part of a run as its own polyline — an exact cut, no dash pattern, so 100%
     is the whole line and nothing is left over. */
  function cutPts(pts, frac) {
    if (!(frac > 0)) return [];
    if (frac >= 1) return pts.slice();
    var ps = planSize(), L = legs(pts, ps[0], ps[1]);
    if (!(L.total > 0)) return [];
    var want = L.total * frac, acc = 0, out = [pts[0]];
    for (var i = 0; i < L.seg.length; i++) {
      if (acc + L.seg[i] >= want) {
        var t = L.seg[i] ? (want - acc) / L.seg[i] : 0;
        out.push([pts[i][0] + (pts[i + 1][0] - pts[i][0]) * t,
                  pts[i][1] + (pts[i + 1][1] - pts[i][1]) * t]);
        return out;
      }
      acc += L.seg[i];
      out.push(pts[i + 1]);
    }
    return out;
  }

  function d_of(pts) {
    if (!Array.isArray(pts) || pts.length < 2) return '';
    return pts.map(function (p, i) {
      return (i ? 'L' : 'M') + (p[0] * 1000).toFixed(2) + ' ' + (p[1] * 1000).toFixed(2);
    }).join(' ');
  }
  function statusColor(u) {
    if (u.status === 'issue') return issueColor();
    return isSD(u) ? sdColor() : isPanel(u) ? tdColor() : isES(u) ? esColor() : grColor();
  }

  function renderOverlay() {
    var wrap = document.getElementById('planWrap');
    if (!wrap) return;
    var svg = document.getElementById('lfOverlay');
    if (!svg) {
      svg = document.createElementNS(SVGNS, 'svg');
      svg.id = 'lfOverlay';
      svg.setAttribute('viewBox', '0 0 1000 1000');
      svg.setAttribute('preserveAspectRatio', 'none');
      wrap.appendChild(svg);
    }
    if (svg.parentNode !== wrap) wrap.appendChild(svg);
    while (svg.firstChild) svg.removeChild(svg.firstChild);

    /* Sync the baseline BEFORE drawing. core's render() calls renderPlan() before
       renderKPIs(), so on the very first paint after an upgrade the units still hold
       whatever was in localStorage — v1 shape included. Waiting for the renderKPIs hook
       to fix them was how the overlay came up empty with a TypeError in the console. */
    baselineSync();

    var on = planUnitsOnFloor();
    on.forEach(function (u) {
      if (isRun(u)) u.runs.forEach(function (r, i) {
        try { drawRun(svg, u, r, i); } catch (e) { console.error('[lf] run', u.key, i, e); }
      });
      if (isPanel(u)) u.panels.forEach(function (p, i) {
        try { drawPanel(svg, u, p, i); } catch (e) { console.error('[lf] panel', u.key, i, e); }
      });
    });
    selfCheck(svg, on);
  }

  /* If the seed has geometry for this floor but nothing was drawn, say so loudly. The
     failure mode this catches is a stale cached lf.js / project-config.js: the page looks
     fine, just inert, and there is no error anywhere to explain it. */
  function selfCheck(svg, on) {
    var want = on.reduce(function (s, u) {
      return s + (isRun(u) ? u.runs.length : 0) + (isPanel(u) ? u.panels.length : 0);
    }, 0);
    var got = svg.querySelectorAll('.lf-run-g, .lf-panel-g').length;
    var warn = document.getElementById('lfWarn');
    if (want > 0 && got < want) {
      if (!warn) {
        warn = document.createElement('div');
        warn.id = 'lfWarn';
        var sec = document.getElementById('planSection');
        if (sec) sec.insertBefore(warn, sec.firstChild);
      }
      warn.textContent = '⚠ Only ' + got + ' of ' + want + ' railing pieces drew on this floor. ' +
        'Hard-refresh (Ctrl+Shift+R / ⌘+Shift+R); if that does not fix it, the browser console ' +
        'will name the piece that failed.';
      warn.style.display = 'block';
      console.warn('[lf] ' + BUILD + ': expected ' + want + ' pieces on this floor, drew ' + got);
    } else if (warn) {
      warn.style.display = 'none';
    }
  }

  /* Which build is on screen, without opening devtools. */
  function stampBuild() {
    var head = document.querySelector('#planSection .section-header');
    if (!head || document.getElementById('lfBuild')) return;
    var b = document.createElement('span');
    b.id = 'lfBuild';
    b.textContent = BUILD;
    b.title = 'lf.js build. If this does not match what you were told to expect, hard-refresh.';
    head.appendChild(b);
  }

  function mk(tag, attrs) {
    var el = document.createElementNS(SVGNS, tag);
    Object.keys(attrs).forEach(function (k) { el.setAttribute(k, attrs[k]); });
    return el;
  }

  function drawRun(svg, u, run, i) {
    var d = d_of(run.pts);
    var g = mk('g', { class: 'lf-run-g', 'data-key': u.key, 'data-i': i });
    g.appendChild(mk('path', { d: d, class: 'lf-track', stroke: trackColor() }));
    var done = runDone(u, i);
    var frac = run.lf > 0 ? Math.max(0, Math.min(1, done / run.lf)) : 0;
    var fill = mk('path', { class: 'lf-fill' });
    var end = paintFill(fill, run, frac, u);
    g.appendChild(fill);
    var hit = mk('path', { d: d, class: 'lf-hit' });
    var t = document.createElementNS(SVGNS, 'title');
    t.textContent = u.id + ' · run ' + (i + 1) + '/' + u.runs.length + ' · ' + run.label +
      ' · ' + num(done) + ' / ' + num(run.lf) + ' LF (' + pct(done, run.lf) + '%)' +
      '\nDrag along the line to set how much is installed · click to open the row';
    hit.appendChild(t);
    g.appendChild(hit);
    svg.appendChild(g);

    moveKnob(fill, end, u);
    hit.addEventListener('pointerdown', function (ev) { startDrag(ev, u, i, fill, hit); });
  }

  /* The handle: ONE point per run, sitting at the end of the green, and it MOVES with the
     drag (Leo 2026-08-27) — grab it at one end of the segment, pull it to the other, the
     segment goes green behind it.

     It is drawn only once the run has something booked, and that is the whole trick to
     "one point per segment": runs meet end to end, so a point pinned at every run's START
     would put a second dot on the far end of every middle segment — the next run's. A point
     that lives at the end of the green always sits INSIDE the run it belongs to.

     getPointAtLength is real-browser-only (jsdom has no SVG geometry) and throws on a path
     that has not been laid out yet. The knob is decoration — never let it take the overlay
     down with it. */
  /* Paint the booked part of a run as its own path.

     This used to be a stroke-dasharray on a copy of the full path, which went wrong twice.
     `"0 1"` is not "draw nothing" — a zero-length dash under `stroke-linecap: round` renders
     as a DOT, so every untouched run painted a green bead at its own start, and since runs
     meet end to end, every middle segment carried the next run's bead on its far end. And
     the dash was measured in the SVG's distorted user units, so a full run stopped short of
     its own end. Cutting the polyline instead has neither problem: nothing booked draws
     nothing, and 100% is literally the whole line. */
  function paintFill(fill, run, frac, u) {
    var cut = cutPts(run.pts, frac);
    fill.setAttribute('data-frac', Math.round(frac * 10000) / 10000);
    if (cut.length < 2) {
      fill.setAttribute('d', '');
      fill.setAttribute('stroke', 'none');
      return null;
    }
    fill.setAttribute('d', d_of(cut));
    fill.setAttribute('stroke', statusColor(u));
    return cut[cut.length - 1];
  }

  function moveKnob(fill, end, u) {
    var g = fill.parentNode;
    if (!g) return;
    var knob = g.querySelector('.lf-knob');
    if (!end) { if (knob) g.removeChild(knob); return; }
    if (!knob) { knob = mk('circle', { r: 6, class: 'lf-knob' }); g.appendChild(knob); }
    knob.setAttribute('cx', (end[0] * 1000).toFixed(2));
    knob.setAttribute('cy', (end[1] * 1000).toFixed(2));
    knob.setAttribute('fill', statusColor(u));
  }

  function drawPanel(svg, u, panel, i) {
    var done = u.panels.length === 1 ? tdDone(u) === 1 : !!(u.panelsDone || [])[i];
    var g = mk('g', { class: 'lf-panel-g', 'data-key': u.key, 'data-i': i });
    g.appendChild(mk('path', { d: d_of(panel.pts), class: 'lf-track lf-track-td', stroke: trackColor() }));
    var line = mk('path', {
      d: d_of(panel.pts), class: 'lf-panel' + (done ? ' on' : ''),
      stroke: done ? statusColor(u) : trackColor()
    });
    g.appendChild(line);
    var hit = mk('path', { d: d_of(panel.pts), class: 'lf-hit' });
    var t = document.createElementNS(SVGNS, 'title');
    t.textContent = u.id + ' · ' + panel.label + ' · ' + (u.status || 'pending') +
      (u.date ? ' ' + u.date : '') + '\nClick to open this panel — date, Field Verify, RFI';
    hit.appendChild(t);
    g.appendChild(hit);
    svg.appendChild(g);
    /* Toggling on `click` looks obvious and does not work. app.js pans the plan by calling
       setPointerCapture() on #planViewport from ITS pointerdown handler, and pointer capture
       retargets everything that follows — mouseup included — to the viewport. The browser
       then computes the click target as the common ancestor of mousedown (this path) and
       mouseup (the viewport), so no `click` ever reaches the panel: press lands, release
       goes somewhere else, nothing happens. Guardrail runs never hit this because
       startDrag() stops the pointerdown from reaching the viewport at all.

       So panels do the same thing: swallow the pointerdown, take the capture themselves, and
       decide on pointerup. Which also buys the movement threshold — on a phone, sliding the
       plan with a finger that happened to land on a panel must not book that panel. */
    hit.addEventListener('pointerdown', function (ev) { startTap(ev, u); });
  }

  /* Closest point along a path to a screen-space pointer. Sample coarsely, then
     refine — cheap, and immune to the non-uniform viewBox because every sample is
     converted to screen coordinates before the distance is measured. */
  /* How far along a run the pointer is, 0..1, measured in SCREEN pixels — which are a plain
     even scale of the plan, and therefore of feet. Exact closest-point-on-polyline; no
     sampling, and no SVG geometry API (getPointAtLength lives only in a real browser). */
  function fracAtPointer(run, ev) {
    var svg = document.getElementById('lfOverlay');
    var m = svg && svg.getScreenCTM && svg.getScreenCTM();
    if (!m || !run || !run.pts || run.pts.length < 2) return 0;
    var sp = run.pts.map(function (p) {
      var x = p[0] * 1000, y = p[1] * 1000;
      return [m.a * x + m.c * y + m.e, m.b * x + m.d * y + m.f];
    });
    var seg = [], total = 0, i;
    for (i = 1; i < sp.length; i++) {
      var d = Math.hypot(sp[i][0] - sp[i - 1][0], sp[i][1] - sp[i - 1][1]);
      seg.push(d); total += d;
    }
    if (!(total > 0)) return 0;
    var best = 0, bestD = Infinity, acc = 0;
    for (i = 0; i < seg.length; i++) {
      var ax = sp[i][0], ay = sp[i][1];
      var vx = sp[i + 1][0] - ax, vy = sp[i + 1][1] - ay;
      var L2 = vx * vx + vy * vy;
      var t = L2 ? ((ev.clientX - ax) * vx + (ev.clientY - ay) * vy) / L2 : 0;
      t = Math.max(0, Math.min(1, t));
      var qx = ax + vx * t - ev.clientX, qy = ay + vy * t - ev.clientY;
      var d2 = qx * qx + qy * qy;
      if (d2 < bestD) { bestD = d2; best = (acc + seg[i] * t) / total; }
      acc += seg[i];
    }
    return Math.max(0, Math.min(1, best));
  }

  /* --- one run, and only that run ------------------------------------------
     A drag books the run it started on and nothing else. A previous build let a drag hand
     over to a neighbouring run of the same row once the pointer walked past a corner, so a
     railing could be swept green in one gesture — but it also meant a run reacted to a drag
     that was never aimed at it, which is worse (Leo 2026-08-27). Runs meet at corners and
     their hit strokes overlap there; the only way a press can be unambiguous is if it owns
     exactly one run for the whole gesture. Each run is dragged on its own, from its own
     start point. */

  function startDrag(ev, u, i, fillPath, hitPath) {
    /* F-058 (2026-09-18): app.js's _isRO() was split into _noEdit() / _isGC().
       Dragging a run WRITES progress, so the question here is "can this session
       write", not "is this the GC". The typeof guard means a stale name fails
       OPEN, not closed — a viewer would have been able to drag. */
    if (typeof _noEdit === 'function' && _noEdit()) return;
    // Leave the core position-editing tools alone if someone has them switched on.
    var em = document.getElementById('editPositionMode');
    if (em && em.checked) return;
    ev.preventDefault();
    ev.stopPropagation();
    _drag = {
      u: u, i: i, fill: fillPath, hit: hitPath,
      before: progress(u).done, startX: ev.clientX, startY: ev.clientY, moved: false,
      orig: runDone(u, i)
    };
    try { hitPath.setPointerCapture(ev.pointerId); } catch (e) {}
    document.body.classList.add('lf-dragging');
  }

  /* A press on a divider panel. Mirrors startDrag(): the pointer belongs to us, not to the
     plan's pan handler — app.js captures every pointerdown on #planViewport to pan, and a
     captured pointer never lets the panel see its own click. onDragEnd() decides whether it
     was a tap (open the row) or a slide (the plan was being moved). */
  function startTap(ev, u) {
    var em = document.getElementById('editPositionMode');
    if (em && em.checked) return;
    ev.preventDefault();
    ev.stopPropagation();
    _tap = { u: u, startX: ev.clientX, startY: ev.clientY };
    try { ev.currentTarget.setPointerCapture(ev.pointerId); } catch (e) {}
  }

  function onDragMove(ev) {
    if (!_drag) return;
    if (Math.abs(ev.clientX - _drag.startX) > 3 || Math.abs(ev.clientY - _drag.startY) > 3) _drag.moved = true;
    if (!_drag.moved) return;
    var run = _drag.u.runs[_drag.i];
    var frac = fracAtPointer(run, ev);
    /* Snap the last (and first) six inches. Reaching exactly 1.0 means landing the pointer
       on the run's very last point, which on a long run is a pixel or two of slop between
       "installed" and "195.9 of 196.33" — nobody books a railing to the inch, and the whole
       segment going green is the thing being asked for. */
    var feet = Math.round(frac * run.lf * 100) / 100;
    if (run.lf - feet < 0.5) { feet = run.lf; frac = 1; }
    else if (feet < 0.5) { feet = 0; frac = 0; }
    _drag.u.runsDone[_drag.i] = feet;
    moveKnob(_drag.fill, paintFill(_drag.fill, run, frac, _drag.u), _drag.u);
    showDragHint(_drag.u, _drag.i, frac);
  }

  function onDragEnd(ev) {
    if (_tap) {
      var t = _tap; _tap = null;
      // Slid more than a thumb's wobble → they were moving the plan, not opening a panel.
      if (Math.abs(ev.clientX - t.startX) > 4 || Math.abs(ev.clientY - t.startY) > 4) return;
      /* Open the panel's OWN row. It used to toggle a boolean here, which changed a colour
         and recorded nothing — no date, no Field Verify, no RFI (Leo 2026-08-27). Those all
         live on a row, so the row is what a tap has to open. */
      if (typeof openUnit === 'function') openUnit(t.u.key);
      return;
    }
    if (!_drag) return;
    var d = _drag; _drag = null;
    document.body.classList.remove('lf-dragging');
    hideDragHint();
    if (!d.moved) {                       // a click, not a drag → open the row
      d.u.runsDone[d.i] = d.orig;
      if (typeof openUnit === 'function') openUnit(d.u.key);
      return;
    }
    var run = d.u.runs[d.i];
    commit(d.u, d.before, d.u.id + ' run ' + (d.i + 1) + ' → ' +
      num(d.u.runsDone[d.i]) + ' / ' + num(run.lf) + ' LF');
  }

  function showDragHint(u, i, frac) {
    var el = document.getElementById('lfDragHint');
    if (!el) {
      el = document.createElement('div');
      el.id = 'lfDragHint';
      document.body.appendChild(el);
    }
    var run = u.runs[i];
    el.innerHTML = '<b>' + esc(u.id) + '</b> run ' + (i + 1) + '<br>' +
      '<span class="lf-hint-big">' + num(frac * run.lf) + ' LF</span> / ' + num(run.lf) +
      ' · ' + Math.round(frac * 100) + '%';
    el.style.display = 'block';
  }
  function hideDragHint() {
    var el = document.getElementById('lfDragHint');
    if (el) el.style.display = 'none';
  }

  /* ==========================================================================
     UNIT MODAL — the same edit, for anyone who'd rather type than drag
     ========================================================================== */
  function current() {
    if (typeof editingUnitId === 'undefined' || !editingUnitId) return null;
    return unitByKey(editingUnitId);
  }
  function modalBox() {
    var panel = document.getElementById('panel-cal');
    if (!panel) return null;
    var box = document.getElementById('lf-box');
    if (!box) {
      box = document.createElement('div');
      box.id = 'lf-box';
      box.className = 'lf-box';
      panel.insertBefore(box, panel.firstChild);
    }
    return box;
  }
  function seedModal() {
    var u = current(); if (!u) return;
    var box = modalBox(); if (!box) return;
    var p = progress(u);
    var head = '<div class="lf-box-head"><span><b>' + num(p.total) + ' ' + p.unit + '</b> scope · ' +
      esc(u.type || '') + '</span><span>' + (u.sheet ? '📄 ' + esc(u.sheet) : '') + '</span></div>';

    if (isRun(u)) {
      box.innerHTML = head +
        '<div class="lf-runs-list">' + u.runs.map(function (r, i) {
          var done = runDone(u, i);
          return '<div class="lf-run-row" data-i="' + i + '">' +
            '<span class="lf-run-name">Run ' + (i + 1) + '<em>' + esc(r.label) + '</em></span>' +
            '<input type="range" min="0" max="' + r.lf + '" step="0.25" value="' + done + '" class="lf-slider">' +
            '<input type="number" min="0" max="' + r.lf + '" step="0.25" value="' + done + '" class="lf-numin">' +
            '<span class="lf-run-of">/ ' + num(r.lf) + ' LF</span>' +
            '<span class="lf-run-pct">' + pct(done, r.lf) + '%</span>' +
            '</div>';
        }).join('') + '</div>' +
        '<div class="lf-box-foot"><button type="button" class="btn btn-sm" id="lf-all">All done</button>' +
        '<button type="button" class="btn btn-sm" id="lf-none">None</button>' +
        '<span class="lf-pct" id="lf-pct">' + p.pctv + '%</span></div>' +
        '<div class="lf-hint">Or drag straight along the run on the plan. Status follows the feet: ' +
        '0 = Pending · partial = Ready · full = Installed. An <b>Issue</b> status is never overwritten.</div>';
      box.querySelectorAll('.lf-run-row').forEach(function (row) {
        var i = +row.dataset.i;
        var sl = row.querySelector('.lf-slider'), nu = row.querySelector('.lf-numin');
        sl.addEventListener('input', function () { nu.value = sl.value; paintModal(); });
        nu.addEventListener('input', function () { sl.value = nu.value; paintModal(); });
      });
      box.querySelector('#lf-all').addEventListener('click', function () {
        box.querySelectorAll('.lf-run-row').forEach(function (row) {
          var i = +row.dataset.i;
          row.querySelector('.lf-slider').value = u.runs[i].lf;
          row.querySelector('.lf-numin').value = u.runs[i].lf;
        });
        paintModal();
      });
      box.querySelector('#lf-none').addEventListener('click', function () {
        box.querySelectorAll('.lf-slider,.lf-numin').forEach(function (el) { el.value = 0; });
        paintModal();
      });
    } else if (isPanel(u)) {
      /* One panel per row now, so there is nothing to tick here: the CALENDAR tab sets the
         status and the installation date, Field Verify records the measurements and RFI the
         inquiries — all of it against this panel, because this panel is the row. This box is
         just the identity card, so you can see WHICH panel you opened. The multi-panel chip
         grid is gone with the floor-level rows it belonged to. */
      var pn = u.panels[0] || {};
      var what = isSD(u) ? 'shower door' : 'divider panel';
      box.innerHTML = head +
        '<div class="lf-one-panel">' +
        '<span class="lf-one-dot" style="background:' +
          (tdDone(u) === 1 ? statusColor(u) : trackColor()) + '"></span>' +
        '<span><b>' + esc(u.id) + '</b> · ' + esc(pn.label || '') + '</span>' +
        '<span class="lf-pct" id="lf-pct">' + p.pctv + '%</span></div>' +
        '<div class="lf-hint">This row <b>is</b> one ' + what + '. Set the date on the ' +
        '<b>Calendar</b> tab, measurements on <b>Field Verify</b>, and anything open on ' +
        '<b>RFI</b> — they all belong to this ' + what + '. It is in or it is not; there is ' +
        'no part of one.</div>';
    } else {
      box.innerHTML = '';
    }
    paintModal();
  }
  function readModal(u) {
    var box = document.getElementById('lf-box');
    if (!box || !u) return null;
    if (isRun(u)) {
      var vals = [];
      box.querySelectorAll('.lf-run-row').forEach(function (row) {
        var i = +row.dataset.i, v = parseFloat(row.querySelector('.lf-numin').value);
        if (!isFinite(v) || v < 0) v = 0;
        vals[i] = Math.min(v, u.runs[i].lf);
      });
      return { done: vals.reduce(function (a, b) { return a + (b || 0); }, 0), runs: vals };
    }
    if (isPanel(u)) {
      // Nothing to read: the Calendar tab owns a divider row, and applyModal() copies its
      // status back onto panelsDone so the plan and the cards keep one number.
      return { done: tdDone(u), panels: (u.panelsDone || []).slice() };
    }
    return null;
  }
  function paintModal() {
    var u = current(); if (!u) return;
    var r = readModal(u); if (!r) return;
    var total = isRun(u) ? lfOf(u) : u.panels.length;
    var el = document.getElementById('lf-pct');
    if (el) el.textContent = pct(r.done, total) + '%';
    if (isRun(u)) {
      document.querySelectorAll('#lf-box .lf-run-row').forEach(function (row) {
        var i = +row.dataset.i;
        row.querySelector('.lf-run-pct').textContent = pct(r.runs[i] || 0, u.runs[i].lf) + '%';
      });
    }
  }
  function applyModal(u) {
    if (isPanel(u)) {
      /* A divider row runs the OTHER WAY: core's Calendar tab is the truth (status + date),
         and panelsDone just follows it so the plan colour and the KPI keep reading one
         number. Nothing to derive, nothing to push back. */
      var cal = document.querySelector('#cal-rows .cal-row[data-scope="frame"] .cal-status');
      if (cal) u.panelsDone = [cal.value === 'installed'];
      return;
    }
    var r = readModal(u);
    if (!r) return;
    u.runsDone = r.runs.map(function (v) { return Math.round((v || 0) * 100) / 100; });
    u.lfDone = Math.round(grDone(u) * 100) / 100;
    // Hand the derived status to core through the Calendar tab's Frame row, which
    // saveUnit() mirrors into u.status / u.date.
    var row = document.querySelector('#cal-rows .cal-row[data-scope="frame"]');
    if (!row) return;
    var sel = row.querySelector('.cal-status'), dateEl = row.querySelector('.cal-date');
    if (!sel || sel.value === 'issue') return;
    var want = deriveStatus(u);
    sel.value = want;
    if (dateEl) {
      if (want === 'pending') dateEl.value = '';
      else if (!dateEl.value) dateEl.value = today();
    }
  }

  /* ======================================================= trend + drill-down */
  function rebuildTrend() {
    var canvas = document.getElementById('trendChart');
    if (!canvas || typeof Chart === 'undefined') return;
    if (typeof state === 'undefined' || !state || !Array.isArray(state.log)) return;
    var byDate = {};
    state.log.forEach(function (l) {
      if (!l || l.lfEntry !== true) return;
      var delta = (Number(l.to) || 0) - (Number(l.from) || 0);
      if (!delta) return;
      var u = unitByKey(l.unitKey);
      if (u && isPanel(u)) return;                     // counted from the row's date, below
      var k = (u && isES(u)) ? 'es' : 'gr';
      if (!byDate[l.date]) byDate[l.date] = { gr: 0, td: 0, es: 0, sd: 0 };
      byDate[l.date][k] += delta;
    });
    /* Divider panels are ordinary rows now, booked through the Calendar tab, so their day
       is just the row's date — no delta entry to chase, and re-dating a panel moves it on
       the chart the way you would expect. */
    units().filter(isPanel).forEach(function (u) {
      if (u.status !== 'installed' || !u.date) return;
      if (!byDate[u.date]) byDate[u.date] = { gr: 0, td: 0, es: 0, sd: 0 };
      byDate[u.date][isSD(u) ? 'sd' : 'td'] += 1;
    });

    var dates = Object.keys(byDate).sort();
    if (typeof trendChart !== 'undefined' && trendChart) { trendChart.destroy(); trendChart = null; }
    // A theme may set these; core's helpers only know day vs night.
    var tick = cssVar('--chart-tick', (typeof chartTickColor === 'function') ? chartTickColor() : '#8b949e');
    var grid = cssVar('--chart-grid', (typeof chartGridColor === 'function') ? chartGridColor() : 'rgba(127,127,127,.2)');
    var fmt = (typeof formatDate === 'function') ? formatDate : function (d) { return d; };
    trendChart = new Chart(canvas, {
      type: 'bar',
      data: {
        labels: dates.map(fmt),
        datasets: [
          { label: 'Guardrail LF', yAxisID: 'y', backgroundColor: grColor(),
            data: dates.map(function (d) { return Math.round(byDate[d].gr * 100) / 100; }) },
          // Screens are booked in feet too, so they share the guardrail axis.
          { label: 'Screen LF', yAxisID: 'y', backgroundColor: esColor(),
            data: dates.map(function (d) { return Math.round(byDate[d].es * 100) / 100; }) },
          // Panels are a different unit from feet, so they get their own axis rather
          // than being stacked into a number that means nothing.
          { label: 'Divider panels', yAxisID: 'y2', backgroundColor: tdColor(),
            data: dates.map(function (d) { return Math.round(byDate[d].td); }) },
          // Doors are counted too, so they share the right-hand axis with the panels.
          { label: 'Shower doors', yAxisID: 'y2', backgroundColor: sdColor(),
            data: dates.map(function (d) { return Math.round(byDate[d].sd); }) }
        ]
      },
      options: {
        responsive: true, maintainAspectRatio: false,
        plugins: {
          legend: { display: false },
          tooltip: { callbacks: { label: function (c) {
            return c.dataset.label + ': ' + num(c.parsed.y) +
              (c.dataset.yAxisID === 'y2' ? ' panels' : ' LF');
          } } }
        },
        scales: {
          x: { ticks: { color: tick }, grid: { color: grid } },
          y: { position: 'left', beginAtZero: true, ticks: { color: tick }, grid: { color: grid },
               title: { display: true, text: 'Guardrail + Screen LF', color: tick } },
          y2: { position: 'right', beginAtZero: true, ticks: { color: tick, stepSize: 1 },
                grid: { drawOnChartArea: false },
                title: { display: true, text: 'Panels / doors', color: tick } }
        }
      }
    });
  }

  /* Core builds the status donut with its own hardcoded slice colours (they only know
     day vs night), which looks imported-from-another-app under a themed palette. Rather
     than rebuild the chart — and lose core's custom tooltip that lists the issue units —
     recolour it in place and update. */
  function reskinDonut() {
    if (typeof donutChart === 'undefined' || !donutChart) return;
    var ds = donutChart.data && donutChart.data.datasets && donutChart.data.datasets[0];
    if (!ds) return;
    ds.backgroundColor = [
      cssVar('--green', '#3fb950'),
      cssVar('--yellow', '#d29922'),
      cssVar('--red', '#f85149'),
      cssVar('--text-dim', '#4d5764')
    ];
    ds.borderColor = cssVar('--panel', '#1a2028');
    /* Only ever assign a LEAF value inside chart.options. Chart.js wraps options in a
       resolver proxy, so a read-then-write of a whole branch — `lg.labels = lg.labels || {}`
       — hands the proxy's getter back to its own setter and recurses until the stack dies
       ("Maximum call stack size exceeded" out of Chart.js, thousands deep). */
    try { donutChart.options.plugins.legend.labels.color = cssVar('--text-dim', '#8b949e'); }
    catch (e) {}
    try { donutChart.update('none'); } catch (e) { try { donutChart.update(); } catch (e2) {} }
  }

  function openDetail(kind) {
    var list = kind === 'guardrail' ? grUnits() : kind === 'divider' ? tdUnits()
             : kind === 'screen' ? esUnits() : kind === 'shower' ? sdUnits() : units();
    var title = kind === 'guardrail' ? 'Guardrail — by floor'
              : kind === 'divider' ? 'Terrace Divider — by floor'
              : kind === 'screen' ? 'Equipment Screen — by floor'
              : kind === 'shower' ? 'Shower Doors — by floor' : 'Every row';
    var modal = document.getElementById('kpiDetailModal');
    if (!modal) return;
    var t = sumProgress(list);
    var titleEl = document.getElementById('kpiDetailTitle');
    var countEl = document.getElementById('kpiDetailCount');
    var bodyEl = document.getElementById('kpiDetailBody');
    if (titleEl) titleEl.textContent = title;
    if (countEl) countEl.textContent = pct(t.done, t.total) + '%';
    if (!bodyEl) return;
    bodyEl.innerHTML = !list.length ? '<div class="kpi-detail-empty">Nothing here yet.</div>' :
      '<table class="kpi-detail-table"><thead><tr>' +
      '<th>Row</th><th>Floor</th><th>Scope</th><th>Complete</th><th>%</th><th>Pieces</th><th>Sheet</th>' +
      '</tr></thead><tbody>' +
      list.map(function (u) {
        var p = progress(u);
        var f = (typeof getFloors === 'function') ? getFloors().find(function (x) { return x.key === u.level; }) : null;
        return '<tr><td><strong>' + esc(u.id) + '</strong></td>' +
          '<td>' + esc(f && typeof floorLabel === 'function' ? floorLabel(f) : (u.level || '')) + '</td>' +
          '<td>' + num(p.total) + ' ' + p.unit + '</td>' +
          '<td>' + num(p.done) + '</td>' +
          '<td>' + p.pctv + '%</td>' +
          '<td>' + (isRun(u) ? u.runs.length + (isES(u) ? ' faces' : ' runs')
                              : u.panels.length + (isSD(u) ? ' door' : ' panels')) + '</td>' +
          '<td style="color:var(--text-dim);font-size:11px">' + esc(u.sheet || '') + '</td></tr>';
      }).join('') + '</tbody></table>';
    modal.classList.add('show');
  }

  // ------------------------------------------------------------------- styles
  function injectCss() {
    if (document.getElementById('lf-css')) return;
    var s = document.createElement('style');
    s.id = 'lf-css';
    s.textContent = [
      /* plan overlay */
      '#lfOverlay{position:absolute;left:0;top:0;width:100%;height:100%;overflow:visible;pointer-events:none}',
      '#lfOverlay path{fill:none;vector-effect:non-scaling-stroke;stroke-linecap:round;stroke-linejoin:round}',
      /* Widths go with the dimmed plan sheet (--plan-dim in index.html, Leo 2026-08-27):
         the drawing steps back, so our scope has to step forward or the tab reads as a
         faint plan with faint lines on it. */
      '#lfOverlay .lf-track{stroke:rgba(140,150,165,.55);stroke-width:9}',
      '#lfOverlay .lf-track-td{stroke:rgba(140,150,165,.4);stroke-width:8}',
      '#lfOverlay .lf-fill{stroke-width:9}',
      '#lfOverlay .lf-panel{stroke-width:8}',
      '#lfOverlay .lf-hit{stroke:transparent;stroke-width:22;pointer-events:stroke;cursor:pointer}',
      '#lfOverlay .lf-run-g:hover .lf-track{stroke:rgba(180,190,205,.8)}',
      '#lfOverlay .lf-run-g:hover .lf-fill{filter:drop-shadow(0 0 4px currentColor)}',
      '#lfOverlay .lf-knob{stroke:#0d1117;stroke-width:1.5;vector-effect:non-scaling-stroke;pointer-events:none}',
      'body.day-mode #lfOverlay .lf-knob{stroke:#fff}',
      'body.lf-dragging{user-select:none}',
      'body.lf-dragging #lfOverlay .lf-hit{cursor:grabbing}',
      /* the railing IS the marker here — core's dots would just sit on top */
      'body.lf-geo .plan-marker{display:none!important}',
      '#lfDragHint{position:fixed;left:50%;top:14px;transform:translateX(-50%);z-index:9999;display:none;' +
        'background:var(--card,#161b22);border:1px solid var(--border,#30363d);border-radius:8px;' +
        'padding:8px 14px;font-size:12px;color:var(--text,#e6edf3);box-shadow:0 6px 24px rgba(0,0,0,.45);text-align:center}',
      '#lfDragHint .lf-hint-big{font-size:19px;font-weight:700;font-variant-numeric:tabular-nums}',
      /* rollup table */
      '.lf-table{width:100%;border-collapse:collapse;font-size:13px}',
      '.lf-table th,.lf-table td{padding:7px 10px;border-bottom:1px solid var(--border);text-align:left}',
      '.lf-table th{font-size:11px;letter-spacing:.4px;text-transform:uppercase;color:var(--text-dim);font-weight:600}',
      '.lf-table td.lf-n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}',
      '.lf-table td.lf-b{width:22%}',
      '.lf-table .lf-strong{font-weight:700}',
      '.lf-table tr.lf-total td{border-top:2px solid var(--border);font-weight:700;background:rgba(127,127,127,.06)}',
      '.lf-bar{display:block;height:7px;border-radius:4px;background:rgba(127,127,127,.22);overflow:hidden;min-width:60px}',
      '.lf-bar>span{display:block;height:100%;border-radius:4px;transition:width .18s ease}',
      /* unit modal */
      '.lf-box{border:1px solid var(--border);border-radius:8px;padding:12px 14px;margin-bottom:14px;background:rgba(127,127,127,.05)}',
      '.lf-box-head{display:flex;justify-content:space-between;gap:10px;font-size:12px;color:var(--text-dim);margin-bottom:10px;flex-wrap:wrap}',
      '.lf-run-row{display:flex;align-items:center;gap:9px;margin-bottom:7px}',
      '.lf-run-name{min-width:112px;font-size:12px}',
      '.lf-run-name em{display:block;font-style:normal;color:var(--text-dim);font-size:11px;font-variant-numeric:tabular-nums}',
      '.lf-slider{flex:1;min-width:90px;accent-color:var(--rail-gr)}',
      '.lf-numin{width:82px;background:var(--bg);color:var(--text);border:1px solid var(--border);border-radius:6px;padding:5px 7px;font-size:13px}',
      '.lf-run-of{font-size:11px;color:var(--text-dim);min-width:64px;font-variant-numeric:tabular-nums}',
      '.lf-run-pct{font-size:12px;font-weight:600;min-width:38px;text-align:right;font-variant-numeric:tabular-nums}',
      '.lf-panels{display:flex;flex-wrap:wrap;gap:6px}',
      '.lf-one-panel{display:flex;align-items:center;gap:9px;font-size:13px}',
      '.lf-one-dot{width:11px;height:11px;border-radius:50%;flex:none}',
      '.lf-panel-chip{display:flex;align-items:center;gap:5px;border:1px solid var(--border);border-radius:6px;padding:5px 9px;cursor:pointer;font-size:12px}',
      '.lf-panel-chip.on{border-color:var(--rail-td);background:color-mix(in srgb, var(--rail-td) 16%, transparent)}',
      '.lf-panel-chip em{font-style:normal;color:var(--text-dim);font-size:11px;font-variant-numeric:tabular-nums}',
      '.lf-box-foot{display:flex;align-items:center;gap:8px;margin-top:10px}',
      '.lf-pct{margin-left:auto;font-size:20px;font-weight:700;font-variant-numeric:tabular-nums}',
      '.lf-hint{margin-top:9px;font-size:11px;color:var(--text-dim);line-height:1.5}',
      /* core writes the legend swatch colour as an inline --ut-color from its own fixed
         palette (mint/violet), which then disagrees with a themed overlay. An !important
         author declaration outranks an inline non-important one, so the legend follows the
         same two variables the plan does — in any theme. */
      '.legend-item[data-ut="guardrail"] .ut-swatch{--ut-color:var(--rail-gr)!important}',
      '.legend-item[data-ut="divider"] .ut-swatch{--ut-color:var(--rail-td)!important}',
      '.legend-item[data-ut="screen"] .ut-swatch{--ut-color:var(--rail-es)!important}',
      '.legend-item[data-ut="shower"] .ut-swatch{--ut-color:var(--rail-sd)!important}',
      /* scope filter chips */
      '#lfScopeBar{display:flex;align-items:center;gap:7px;flex-wrap:wrap;margin-bottom:10px}',
      '#lfScopeBar .lf-scope-label{font-size:11px;letter-spacing:.4px;text-transform:uppercase;' +
        'color:var(--text-dim);font-weight:600;margin-right:2px}',
      '#lfScopeBar .lf-scope-chip{display:inline-flex;align-items:center;gap:6px;cursor:pointer;' +
        'background:var(--panel-2);color:var(--text-dim);border:1px solid var(--border);border-radius:20px;' +
        'padding:5px 12px;font-size:12.5px;font-weight:600;font-family:inherit;transition:all .15s}',
      '#lfScopeBar .lf-scope-chip:hover{color:var(--text);border-color:var(--chip,var(--accent))}',
      '#lfScopeBar .lf-scope-chip.on{color:var(--text);border-color:var(--chip,var(--accent));' +
        'background:color-mix(in srgb, var(--chip,#888) 16%, transparent)}',
      '#lfScopeBar .lf-scope-dot{width:9px;height:9px;border-radius:50%;background:var(--chip,#888);' +
        'flex:none;opacity:.35}',
      '#lfScopeBar .lf-scope-chip.on .lf-scope-dot{opacity:1}',
      '#lfScopeBar .lf-scope-n{font-weight:600;font-size:10.5px;opacity:.75;font-variant-numeric:tabular-nums}',
      '#lfScopeBar .lf-scope-all{--chip:var(--accent)}',
      '#lfScopeBar .lf-scope-count{font-size:11.5px;color:var(--text-dim);' +
        'font-variant-numeric:tabular-nums;margin-left:2px}',
      '#lfBuild{margin-left:auto;font-size:10px;color:var(--text-dim);opacity:.65;font-variant-numeric:tabular-nums}',
      '#lfWarn{display:none;margin:0 0 10px;padding:9px 12px;border-radius:8px;font-size:12.5px;' +
        'background:rgba(248,81,73,.12);border:1px solid rgba(248,81,73,.5);color:var(--text)}'
    ].join('\n');
    document.head.appendChild(s);
  }

  // -------------------------------------------------------------- wire into core
  function refresh() {
    stampBuild();
    baselineSync();
    paintCards();
    paintByFloor();
    if (window.PROJECT && PROJECT.hidePlanMarkers) {
      document.body.classList.add('lf-geo');
      hideMarkerTools();
    }
  }

  /* With no dot markers there is nothing to place or drag into position, so core's
     marker tools would only invite confusion. Hidden rather than deleted: core still
     reads #editPositionMode, and lf.js checks it too so that if it is ever switched
     back on, dragging the plan stops fighting it. */
  function hideMarkerTools() {
    var pb = document.getElementById('placeBtn');
    if (pb) pb.style.display = 'none';
    var em = document.getElementById('editPositionMode');
    if (em && em.closest('.mode-toggle')) em.closest('.mode-toggle').style.display = 'none';
  }

  function wrap(name, before, after) {
    var orig = window[name];
    if (typeof orig !== 'function') { console.warn('[lf] core function missing:', name); return; }
    window[name] = function () {
      if (before) { try { before.apply(null, arguments); } catch (e) { console.error('[lf] pre-' + name, e); } }
      var out = orig.apply(this, arguments);
      if (after) { try { after.apply(null, arguments); } catch (e) { console.error('[lf] post-' + name, e); } }
      return out;
    };
  }

  wrap('renderKPIs', null, refresh);
  wrap('renderPlan', null, renderOverlay);
  /* Core rewrites the floor-button row and the zone tabs from PROJECT.floors here, so the
     scope filter has to be re-applied after every one of its runs, not just on a click. */
  wrap('renderFloorControls', null, applyScopeFilter);
  /* Re-entrancy guard: rebuildTrend() constructs a Chart, and a Chart construct/update
     can trigger a resize which some code paths answer by re-rendering the charts. Without
     the latch that becomes a loop that only shows up as a stack overflow. */
  var _inCharts = false;
  wrap('renderCharts', null, function () {
    if (_inCharts) return;
    _inCharts = true;
    try { rebuildTrend(); reskinDonut(); } finally { _inCharts = false; }
  });
  wrap('openUnit', null, function () { if (document.getElementById('panel-cal')) seedModal(); });
  wrap('saveUnit', function () { var u = current(); if (u) applyModal(u); }, function () {
    var u = current(); if (u && isRun(u)) u.lfDone = Math.round(grDone(u) * 100) / 100;
  });
  wrap('renderCalendar', null, function () {
    document.querySelectorAll('#cal-rows .cal-row').forEach(function (r) {
      if (HIDDEN_SCOPES.indexOf(r.dataset.scope) >= 0) r.remove();
    });
  });
  /* The Openings lens is storefront language (rough openings the GC prepares). A
     railing run has no opening, so the tab goes — Progress and Issues are the two
     that mean something here. */
  wrap('renderPlanLensBar', null, function () {
    // core inserts its lens bar before .plan-toolbar as well, and it renders after our
    // first pass — re-seat the scope chips so they always sit directly above the floors.
    paintScopeBar();
    var bar2 = document.getElementById('planLensBar');
    if (!bar2) return;
    bar2.querySelectorAll('.lens-btn').forEach(function (b) {
      if (/setPlanLens\('openings'\)/.test(b.getAttribute('onclick') || '')) b.remove();
    });
  });

  document.addEventListener('pointermove', onDragMove, { passive: true });
  document.addEventListener('pointerup', onDragEnd);
  document.addEventListener('pointercancel', onDragEnd);

  injectCss();
  console.log('[lf] 355 Lexington railing module ' + BUILD + ' loaded');
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function () { refresh(); renderOverlay(); });
  } else { refresh(); renderOverlay(); }

  window.LF = {
    build: BUILD, refresh: refresh, reskinDonut: reskinDonut, renderOverlay: renderOverlay, openDetail: openDetail,
    progress: progress, sumProgress: sumProgress, isGR: isGR, isTD: isTD, isES: isES, isRun: isRun,
    isSD: isSD, isPanel: isPanel,
    grDone: grDone, tdDone: tdDone, pct: pct, commit: commit, seedModal: seedModal,
    applyModal: applyModal, deriveStatus: deriveStatus, fracAtPointer: fracAtPointer,
    scopesOn: scopesOn, setScopes: setScopes, toggleScope: toggleScope, floorShown: floorShown,
    floorScopes: floorScopes, scopeOf: scopeOf, inBaseline: inBaseline, allScopes: ALL_SCOPES
  };
})();
