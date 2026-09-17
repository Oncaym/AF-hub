/* ─────────────────────────────────────────────────────────────────────────
   AF Hub reporter — the only file a tracker adds. No UI changes.

   In index.html, after app.js:
     <script src="af-hub-config.js?v=1"></script>
     <script src="hub-report.js?v=1"></script>

   In project-config.js:
     hubId:    'ac3',                  // key on the hub: ac3 / cp2 / lex
     hubUnit:  'openings',             // openings / pieces / linear ft
     hubScope: 'Storefront / Curtain Wall',

   The contract is four groups of numbers. The overview compares percent and
   estimated completion, never raw counts, so projects measured in different
   units still share one list.

   This writes one node — projects/{hubId}/summary — using its own Firebase
   app instance named 'afhub'. It never touches the tracker's own Firebase
   connection, and a failed push cannot affect the tracker.
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var HUB = window.AF_HUB_FIREBASE;
  var P   = window.PROJECT || {};
  if (!HUB || !P.hubId || typeof firebase === 'undefined') return;

  var DAY = 864e5, app = null, signedIn = false;

  function hubApp() {
    if (app) return app;
    try {
      app = firebase.apps.filter(function (a) { return a.name === 'afhub'; })[0]
         || firebase.initializeApp(HUB, 'afhub');
    } catch (e) { return null; }
    return app;
  }

  // Matches the main dashboard's definition of installed.
  function isDone(u) { return u && u.status === 'installed'; }

  function daysAgo(dateStr) {
    if (!dateStr) return null;
    var t = Date.parse(dateStr);
    return isNaN(t) ? null : (Date.now() - t) / DAY;
  }

  function summarize(state) {
    var units = (state && state.units) || [];
    var done = 0, thisWeek = 0, lastWeek = 0, fourWeeks = 0;

    units.forEach(function (u) {
      if (!isDone(u)) return;
      done++;
      var d = daysAgo(u.date);
      if (d === null || d < 0) return;
      if (d < 7) thisWeek++;
      if (d >= 7 && d < 14) lastWeek++;
      if (d < 28) fourWeeks++;
    });

    // Damage / change orders land in step 2. The fields are reserved now so
    // the hub needs no change when they go live.
    var dmg = (state && state.damage) || [];
    var openDamage = dmg.filter(function (x) { return x && !x.closed; }).length;
    var pendingCO  = dmg.filter(function (x) { return x && x.co === 'pending'; }).length;

    return {
      name:  P.displayName || P.name || P.hubId,
      unit:  P.hubUnit  || 'openings',
      scope: P.hubScope || '',
      done:  done,
      total: units.length,
      weekRate: thisWeek,
      prevWeekRate: lastWeek,
      avg4w: Math.round(fourWeeks / 4),
      openDamage: openDamage,
      pendingCO: pendingCO,
      ts: Date.now()
    };
  }

  var lastSig = '', timer = null;

  function push() {
    var a = hubApp();
    if (!a || !signedIn) return;
    var s = summarize(window.state);
    if (!s.total) return;                               // nothing loaded yet
    var sig = JSON.stringify(s).replace(/"ts":\d+/, '');
    if (sig === lastSig) return;                        // unchanged — skip the write
    lastSig = sig;
    a.database().ref('projects/' + P.hubId + '/summary').set(s).catch(function () {});
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(push, 3000); }

  var a0 = hubApp();
  if (a0) {
    a0.auth().signInAnonymously()
      .then(function () { signedIn = true; schedule(); })
      .catch(function () {});
  }

  window.addEventListener('af-state-changed', schedule);   // if the app emits one
  document.addEventListener('DOMContentLoaded', schedule);
  setInterval(push, 10 * 60 * 1000);                       // safety net
  setTimeout(schedule, 8000);                              // first load
})();
