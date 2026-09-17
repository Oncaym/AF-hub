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
      hubSignedIn: signedIn,
      trackerSignedIn: trackerReady(),
      wouldSend: s
    });
    return s;
  };
})();
