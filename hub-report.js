/* ─────────────────────────────────────────────────────────────────────────
   AF Hub reporter — the only file a tracker adds. No UI changes.

   In index.html, after app.js:
     <script src="af-hub-config.js?v=3"></script>
     <script src="hub-report.js?v=3"></script>

   In project-config.js:
     hubId:    'ac3',                  // key on the hub: ac3 / cp2 / lex
     hubUnit:  'openings',             // openings / pieces / linear ft
     hubScope: 'Storefront / Curtain Wall',

   The contract is four groups of numbers. The overview compares percent and
   estimated completion, never raw counts, so projects measured in different
   units still share one list.

   Writes one node — projects/{hubId}/summary — on its own Firebase app
   instance named 'afhub'. It never touches the tracker's own connection, and
   a failed push is silent to the user.

   Debug from the console:
     afHubDebug()   → what it would send, and why it might not
     afHubPush()    → force a push now
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var HUB = (typeof window !== 'undefined' && window.AF_HUB_FIREBASE) || null;
  var P   = (typeof window !== 'undefined' && window.PROJECT) || {};
  var TAG = '[af-hub]';

  var DAY = 864e5, app = null, signedIn = false, lastSig = '', timer = null;

  function hubApp() {
    if (app) return app;
    try {
      app = firebase.apps.filter(function (a) { return a.name === 'afhub'; })[0]
         || firebase.initializeApp(HUB, 'afhub');
    } catch (e) { console.warn(TAG, 'init failed', e); return null; }
    return app;
  }

  /* app.js declares `let state = null` at the top level of a classic script.
     That is a global LEXICAL binding: other classic scripts on the page can
     read it by name, but it is NOT a property of window. */
  function getState() {
    try { if (typeof state !== 'undefined' && state && state.units) return state; } catch (e) {}
    if (window.state && window.state.units) return window.state;
    try {
      var raw = localStorage.getItem(P.storageKey || '');
      if (raw) { var j = JSON.parse(raw); if (j && j.units) return j; }
    } catch (e) {}
    return null;
  }

  /* Only report when the tracker itself is signed in.
     A logged-out visitor sees the embedded seed (AC3: 17 units, 0 installed).
     Pushing that would overwrite the real figures on the hub with seed data —
     anyone opening the public tracker URL would silently reset the overview. */
  function trackerReady() {
    try { return !!firebase.app().auth().currentUser; } catch (e) { return false; }
  }

  function isDone(u) { return u && u.status === 'installed'; }   // matches the dashboard

  /* ── The rules, as a pure function of data ───────────────────────────────
     No DOM, no globals: everything below takes (state, PROJECT, ELEVATIONS) and
     returns numbers. It is exposed on window.AF_HUB_RULES so the scheduled
     reporter can fetch THIS file and run the identical maths in Node — one copy,
     so the browser and the two-hourly job can never drift apart.

     The classifiers are re-implemented here rather than borrowed from the
     tracker's app.js, because app.js needs a DOM and the job has none. That
     duplication is real, so _tests/test-breakdown.cjs runs BOTH versions over
     every tracker's seed data and fails if they ever disagree.                */
  var RULES = (function () {

    function rxs(list) {
      return (list || []).map(function (p) { try { return new RegExp(p, 'i'); } catch (e) { return null; } })
                         .filter(Boolean);
    }
    function isDoor(u, cfg) {
      if (!u) return false;
      if (u.type === 'Door' || /door/i.test(u.type || '')) return true;
      return rxs((cfg.doorPatterns && cfg.doorPatterns.length) ? cfg.doorPatterns : ['^SD'])
             .some(function (r) { return r.test(u.id || ''); });
    }
    function isInterior(u, cfg) {
      if (!u) return false;
      if (u.interior === 'yes') return true;
      if (u.interior === 'no') return false;
      if (/interior/i.test(u.type || '')) return true;
      return rxs(cfg.interiorPatterns).some(function (r) { return r.test(u.id || ''); });
    }
    function doorTypeOf(u, cfg) {
      if (!isDoor(u, cfg)) return '';
      var v = String(u.doorType || '').trim();
      if (['exterior', 'interior', 'fire-rated'].indexOf(v) !== -1) return v;
      return isInterior(u, cfg) ? 'interior' : 'exterior';
    }

    /* What KIND of thing this unit is — the first half of a scope name.
       `type` first: Lexington already names its scope there (Guardrail, Shower
       Door, …) and isDoor() matches anything containing "door", which would
       otherwise file its 159 shower doors as exterior doors. */
    function classOf(u, cfg) {
      var t = String((u && u.type) || '').trim();
      if (t && !/^storefront$/i.test(t)) return t;
      if (isDoor(u, cfg)) {
        var dt = doorTypeOf(u, cfg);
        return dt ? 'Door · ' + dt : 'Door';
      }
      return isInterior(u, cfg) ? 'Storefront · interior' : 'Storefront · exterior';
    }

    /* Elevation-backed element counts. `state.elevations[key].el[id].status` is the
       progress; `ELEVATIONS[key].elements` is the shipped part list. A key can serve
       SEVERAL units (SF04 appears on the plan more than once), so callers must count
       each key ONCE — sum per unit and the glass is counted twice. */
    function elementCounts(key, state, ELEV) {
      var out = {};
      var E = (ELEV || {})[key];
      if (!E || !Array.isArray(E.elements)) return out;
      var S = ((state || {}).elevations || {})[key] || {};
      var el = S.el || {}, gone = S.deleted || [];
      var parts = E.elements.map(function (e) { return { id: e.id, t0: e.t0 }; })
        .concat((S.custom || []).map(function (c) { return { id: c.id, t0: c.type }; }))
        .filter(function (p) { return gone.indexOf(p.id) === -1; });
      parts.forEach(function (p) {
        var r = el[p.id] || {}, type = r.type || p.t0;
        if (!type || type === 'hidden') return;
        if (!out[type]) out[type] = [0, 0];
        out[type][1]++;
        if ((r.status || 'pending') === 'installed') out[type][0]++;
      });
      return out;
    }

    /* Which elevation a unit reads from. Mirrors the tracker's _elevKey(): its own
       id when it has one, otherwise the parent it shares. */
    function elevKeyOf(u, ELEV) {
      if (!u || !u.id) return null;
      if ((ELEV || {})[u.id]) return u.id;
      var base = String(u.id).replace(/__\d+$/, '');       // SF04__2 -> SF04
      return (ELEV || {})[base] ? base : null;
    }

    /* Sub-scopes the boss does not want. Crew workflow on a unit, not scope of work. */
    var HIDE = { caulking: 1, beautycap: 1, facecover: 1 };
    var LABEL = { frame: 'Frame', glass: 'Glass', panel: 'Metal Panel', metalpanel: 'Metal Panel',
                  louver: 'Louver', door: 'Door', doors: 'Door', sunshade: 'Sun Shade' };
    function label(k) { return LABEL[String(k).toLowerCase()] || (String(k).charAt(0).toUpperCase() + String(k).slice(1)); }

    function isDone(u) { return !!u && u.status === 'installed'; }

    /* Glass is tracked in TWO different places, because the two projects went
       different ways: Cooper Park 2 keeps it on the unit as
       glassPanels[{panel,status}] (with a pre-F-012 fallback of u.glass + u.panels),
       while AC3's M3 moved it onto elevation elements. Same scope of work, two
       storages — read whichever this unit actually has, elements first, since a unit
       with an elevation has its glass there. */
    function panelsOn(u) {
      var gp = Array.isArray(u && u.glassPanels)
        ? u.glassPanels.filter(function (g) { return g && (g.panel || g.status); }) : [];
      if (!gp.length && u && u.glass) gp = [{ panel: u.panels || '', status: u.glass }];
      return gp;
    }

    /* Scopes that live on the unit itself rather than on an elevation. Returns
       {name: [done, total]}. */
    function unitScopes(u, hasElev) {
      var out = {};
      if (!hasElev) {
        var gp = panelsOn(u);
        if (gp.length) out.glass = [gp.filter(function (g) { return g.status === 'installed'; }).length, gp.length];
        /* CP2 records a louver as a yes/no on the unit, not as a counted element —
           so it contributes one item, not a piece count. */
        if (u && u.louver === 'yes') out.louver = [isDone(u) ? 1 : 0, 1];
      }
      return out;
    }

    /* Feet, or pieces. Lexington drags a guardrail run and an equipment-screen face
       along in FEET — those rows carry `runs` plus lf / lfDone. Everything else is one
       piece. The tracker's own test (lf.js asks isRun()), not a guess. */
    function qtyOf(u, cfg) {
      if (u && Array.isArray(u.runs) && u.runs.length) {
        var t = Number(u.lf), d = Number(u.lfDone);
        if (isFinite(t) && t > 0)
          return { unit: 'LF', total: t, done: Math.max(0, Math.min(isFinite(d) ? d : 0, t)) };
      }
      return { unit: cfg.hubUnit || 'units', total: 1, done: isDone(u) ? 1 : 0 };
    }

    function breakdown(state, cfg, ELEV) {
      var units = (state && state.units) || [], by = {}, seenKey = {};

      /* Does this project track anything BELOW the unit? Decided once for the whole
         project, not per unit — deciding per unit split AC3 into "Storefront · exterior"
         for the nine openings with no elevation drawn yet and "Storefront · exterior —
         Frame" for the eight that had one. That is how far the drawings got, not a
         scope of work. Lexington tracks nothing below the unit, so its scopes stay
         plain "Guardrail", "Shower Door". */
      var splitSub = Object.keys(ELEV || {}).length > 0
                  || units.some(function (u) { return panelsOn(u).length > 0; });
      function bucket(name, unit) {
        if (!by[name]) by[name] = { scope: name, done: 0, total: 0, qtyDone: 0, qtyTotal: 0, unit: unit };
        return by[name];
      }

      units.forEach(function (u) {
        var cls = classOf(u, cfg);

        /* The frame — or the door leaf itself, which is what `frame` means on a door
           row in the tracker's Calendar tab. A project with no elevations (Lexington)
           has only this, and it IS the unit, so it keeps the unit's own quantity. */
        var q = qtyOf(u, cfg);
        var sc = (u.scopes && u.scopes.frame) || null;
        var frameDone = sc ? sc.status === 'installed' : isDone(u);
        var hasElev = !!elevKeyOf(u, ELEV);
        var fname = splitSub ? cls + ' — ' + (isDoor(u, cfg) ? 'Door' : 'Frame') : cls;
        var b = bucket(fname, q.unit);
        b.total++;
        if (frameDone) b.done++;
        b.qtyTotal += q.total;
        b.qtyDone  += (q.unit === 'LF') ? q.done : (frameDone ? 1 : 0);

        /* Glass / metal panel / louver / doors come off the elevation, and an elevation
           can be shared, so each key is counted once and filed under the class of the
           first unit that reads it. */
        /* Unit-level scopes first — these are per unit, never shared, so no dedupe. */
        var us = unitScopes(u, hasElev);
        Object.keys(us).forEach(function (k) {
          if (HIDE[String(k).toLowerCase()]) return;
          var n = us[k];
          var ub = bucket(cls + ' \u2014 ' + label(k), 'pcs');
          ub.total += n[1]; ub.done += n[0];
          ub.qtyTotal += n[1]; ub.qtyDone += n[0];
        });

        var key = elevKeyOf(u, ELEV);
        if (!key || seenKey[key]) return;
        seenKey[key] = 1;
        var counts = elementCounts(key, state, ELEV);
        Object.keys(counts).forEach(function (k) {
          if (HIDE[String(k).toLowerCase()]) return;
          var n = counts[k];
          if (!n[1]) return;
          var eb = bucket(cls + ' — ' + label(k), 'pcs');
          eb.total += n[1]; eb.done += n[0];
          eb.qtyTotal += n[1]; eb.qtyDone += n[0];
        });
      });

      var out = Object.keys(by).map(function (k) {
        var b = by[k];
        b.qtyDone  = Math.round(b.qtyDone  * 10) / 10;
        b.qtyTotal = Math.round(b.qtyTotal * 10) / 10;
        return b;
      }).filter(function (b) { return b.qtyTotal > 0; });

      out.sort(function (a, b) { return (b.qtyTotal - a.qtyTotal) || (a.scope < b.scope ? -1 : 1); });
      return out.slice(0, 16);
    }

    /* One percentage for the project: each scope measured in its own unit, averaged
       weighted by row count. Rows are the weight because there is no honest conversion
       between a foot of railing and a shower door — put a real weight on the scope in
       project-config.js and use it here instead of b.total when one exists. */
    function pct(bd) {
      var num = 0, den = 0;
      bd.forEach(function (b) {
        if (!b.qtyTotal || !b.total) return;
        num += b.total * (b.qtyDone / b.qtyTotal);
        den += b.total;
      });
      return den ? Math.round(100 * num / den) : null;
    }

    return { classOf: classOf, isDoor: isDoor, isInterior: isInterior, doorTypeOf: doorTypeOf,
             qtyOf: qtyOf, elementCounts: elementCounts, elevKeyOf: elevKeyOf,
             panelsOn: panelsOn, unitScopes: unitScopes,
             breakdown: breakdown, pct: pct, isDone: isDone };
  })();

  try { window.AF_HUB_RULES = RULES; } catch (e) {}
  try { if (typeof module !== 'undefined' && module.exports) module.exports = RULES; } catch (e) {}

  /* Everything above is pure and runs anywhere. Everything below needs a browser,
     so bail here when there isn't one — that is what lets the scheduled job load
     this same file and reuse the maths instead of keeping a second copy. */
  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (!HUB)     { console.warn(TAG, 'no AF_HUB_FIREBASE — af-hub-config.js missing or empty'); return; }
  if (!P.hubId) { console.warn(TAG, 'no PROJECT.hubId — add hubId/hubUnit/hubScope to project-config.js'); return; }
  if (typeof firebase === 'undefined') { console.warn(TAG, 'firebase SDK not loaded'); return; }

  function daysAgo(d) {
    if (!d) return null;
    var t = Date.parse(d);
    return isNaN(t) ? null : (Date.now() - t) / DAY;
  }

  function summarize() {
    var st = getState();
    var units = (st && st.units) || [];
    var done = 0, thisWeek = 0, lastWeek = 0, fourWeeks = 0, dated = 0;

    units.forEach(function (u) {
      if (!isDone(u)) return;
      done++;
      var d = daysAgo(u.date);
      if (d === null || d < 0) return;
      dated++;
      if (d < 7) thisWeek++;
      if (d >= 7 && d < 14) lastWeek++;
      if (d < 28) fourWeeks++;
    });

    /* ELEVATIONS is a file the tracker ships (elevations.js); the per-element progress
       lives in cloud state. Glass and metal panel counts need both. A tracker without
       one (Lexington) just gets no element scopes, which is correct for it. */
    var bd = RULES.breakdown(st, P, (typeof ELEVATIONS !== 'undefined' && ELEVATIONS) || window.ELEVATIONS || {});

    // Damage / change orders arrive in step 2; reserved so the hub needs no change.
    var dmg = (st && st.damage) || [];
    var openDamage = dmg.filter(function (x) { return x && !x.closed; }).length;
    var pendingCO  = dmg.filter(function (x) { return x && x.co === 'pending'; }).length;

    return {
      _dated: dated,                                  // stripped before sending
      name:  P.displayName || P.name || P.hubId,
      unit:  P.hubUnit  || 'openings',
      scope: P.hubScope || '',
      url:   location.origin,          // lets the hub link straight to this tracker
      done:  done,
      total: units.length,
      weekRate: thisWeek,
      prevWeekRate: lastWeek,
      avg4w: Math.round(fourWeeks / 4),
      openDamage: openDamage,
      pendingCO: pendingCO,
      breakdown: bd,                   // optional: older hubs simply ignore it
      pct: RULES.pct(bd),              // authoritative % — done/total is rows only
      ts: Date.now()
    };
  }

  function push(force) {
    var a = hubApp();
    if (!a) return;
    if (!signedIn)      { console.debug(TAG, 'waiting for hub sign-in'); return; }
    if (!trackerReady()) { console.debug(TAG, 'tracker not signed in — not reporting seed data'); return; }

    var s = summarize();
    delete s._dated;
    if (!s.total) { console.debug(TAG, 'state not loaded yet'); return; }

    var sig = JSON.stringify(s).replace(/"ts":\d+/, '');
    if (!force && sig === lastSig) return;
    lastSig = sig;

    var ref = a.database().ref('projects/' + P.hubId + '/summary');
    ref.set(s)
      .then(function () { console.info(TAG, 'pushed', P.hubId, s.done + '/' + s.total); })
      .catch(function (e) {
        /* The hub's rules end every summary child list with `$other: {".validate": false}`,
           so ONE unrecognised field rejects the WHOLE write and the project silently stops
           reporting altogether. That is what happened when `breakdown` was added on
           2026-09-17 and the rules were not updated with it — the boss's overview froze
           for a day and looked like a deployment problem.

           So: never let the rich fields take the plain ones down with them. Retry once
           with just the numbers, and say plainly what needs publishing. */
        var denied = /permission|denied/i.test((e && (e.code || e.message)) || '');
        if (!denied || !s.breakdown) {
          console.warn(TAG, 'push rejected —', e && e.message);
          lastSig = '';                       // don't let the signature suppress a retry
          return;
        }
        var plain = {};
        Object.keys(s).forEach(function (k) { if (k !== 'breakdown' && k !== 'pct') plain[k] = s[k]; });
        return ref.set(plain).then(function () {
          console.warn(TAG, 'the hub rejected the scope breakdown, so only the headline '
            + 'numbers were sent. Publish af-hub/firebase-database-rules.json in the '
            + 'Firebase Console (project af-hub-8f188) and the scope cards will fill in.');
        }).catch(function (e2) {
          console.warn(TAG, 'push rejected —', e2 && e2.message);
          lastSig = '';
        });
      });
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(push, 2500); }

  var a0 = hubApp();
  if (a0) {
    a0.auth().signInAnonymously()
      .then(function () { signedIn = true; schedule(); })
      .catch(function (e) {
        console.warn(TAG, 'anonymous sign-in failed —', e && e.code,
                     '(enable Anonymous in Firebase Console → Authentication → Sign-in method)');
      });
  }

  // Report as soon as the tracker's own login completes and its cloud state lands.
  try { firebase.app().auth().onAuthStateChanged(function () { schedule(); }); } catch (e) {}
  window.addEventListener('af-state-changed', schedule);
  document.addEventListener('DOMContentLoaded', schedule);
  setTimeout(schedule, 6000);
  setInterval(push, 20000);        // cheap: returns immediately when unchanged

  window.afHubPush  = function () { push(true); };
  window.afHubDebug = function () {
    var st = getState(), s = summarize();
    console.log(TAG, {
      hubId: P.hubId,
      stateFound: !!st,
      units: (st && st.units && st.units.length) || 0,
      installedWithDate: s._dated,
      scopes: (s.breakdown || []).map(function (b) { return b.scope + ' ' + b.done + '/' + b.total; }),
      hubSignedIn: signedIn,
      trackerSignedIn: trackerReady(),
      wouldSend: s
    });
    return s;
  };
})();
