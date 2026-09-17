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

  var HUB = window.AF_HUB_FIREBASE;
  var P   = window.PROJECT || {};
  var TAG = '[af-hub]';

  if (!HUB)     { console.warn(TAG, 'no AF_HUB_FIREBASE — af-hub-config.js missing or empty'); return; }
  if (!P.hubId) { console.warn(TAG, 'no PROJECT.hubId — add hubId/hubUnit/hubScope to project-config.js'); return; }
  if (typeof firebase === 'undefined') { console.warn(TAG, 'firebase SDK not loaded'); return; }

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

  /* ── Per-scope split (Leo, 2026-09-17) ────────────────────────────────
     "Boss doesn't need to know how many caulking, beauty cap left, but he wants
     to know how many doors (ex, in, fire-rated) & storefronts (ex & in) left."

     Every classifier used here already exists in the tracker's own app.js and is
     byte-identical across all three, so this file stays the ONLY thing a tracker
     adds — no core change, no UI change. Caulking / beauty cap are deliberately
     absent: they are crew workflow on a unit, not a scope of work.

     `typeof` guards throughout: a tracker that predates a classifier, or a future
     fork that drops one, degrades to a coarser split instead of throwing. */
  function scopeOf(u) {
    var t = String((u && u.type) || '').trim();

    /* `type` first, and this order matters. Lexington already carries the real scope
       there (Guardrail / Terrace Divider / Equipment Screen / Shower Door), and its 159
       shower doors would otherwise be swallowed by isDoor() — which matches ANY type
       containing "door" — and reported as exterior doors on a curtain-wall split that
       does not apply to that job at all. If the tracker has already named the scope,
       believe it. */
    if (t && !/^storefront$/i.test(t)) return t;

    /* Left here: AC3 and CP2, where every single unit sits in one bucket literally
       called "Storefront". That is the bucket the boss wants opened up. */
    try {
      if (typeof isDoor === 'function' && isDoor(u)) {
        var dt = '';
        try { dt = (typeof doorTypeOf === 'function' && doorTypeOf(u)) || ''; } catch (e) {}
        return dt ? 'Door \u00b7 ' + dt : 'Door';
      }
    } catch (e) {}
    try { if (typeof isInterior === 'function' && isInterior(u)) return 'Storefront \u00b7 interior'; } catch (e) {}
    return t ? 'Storefront \u00b7 exterior' : 'Other';
  }

  function breakdownOf(units) {
    var by = {};
    units.forEach(function (u) {
      var k = scopeOf(u);
      if (!by[k]) by[k] = { scope: k, done: 0, total: 0 };
      by[k].total++;
      if (isDone(u)) by[k].done++;
    });
    var out = Object.keys(by).map(function (k) { return by[k]; });
    out.sort(function (a, b) { return (b.total - a.total) || (a.scope < b.scope ? -1 : 1); });
    return out.slice(0, 12);            // a boss screen, not a report
  }

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
      breakdown: breakdownOf(units),   // optional: older hubs simply ignore it
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

    a.database().ref('projects/' + P.hubId + '/summary').set(s)
      .then(function () { console.info(TAG, 'pushed', P.hubId, s.done + '/' + s.total); })
      .catch(function (e) { console.warn(TAG, 'push rejected —', e && e.message); });
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
