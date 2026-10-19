/* ============================================================
   Morgan North in the AF hub — mn/hub-adapter.js
   ------------------------------------------------------------
   mn/index.html is Benji's Glass Replacement Tracker exactly as he builds
   it, plus three <script> lines added by mn/build.mjs. This file is the
   only hub code on the page:

   1. Login. The page is held off its database until someone signs in
      with an AF hub account (same login as the trackers). Who can do what
      is decided by the database rules (platform/mn-database.rules.json):
      editors on /allowlist change it; viewers, GC and company staff read.
   2. Database. The page calls firebase.initializeApp(ITS OWN config); it
      gets the hub app instead, on af-hub-8f188-mn. Benji's FIREBASE_CONFIG
      is left in the file and simply not used here.
   3. Overview. While someone has the page open, the progress numbers go to
      the hub overview (projects/mn/summary), like hub-report.js does for
      the trackers: replaced / panes in scope, per floor, last 7 days.
   4. A small chip, bottom left: who is signed in, back to the hub, sign out.

   Nothing in Benji's code is changed or patched beyond initializeApp; his
   page calls fbBoot() itself, and this file calls it once more after login.
   ============================================================ */
(function () {
  'use strict';
  var fb = window.firebase, HUB = window.AF_HUB_FIREBASE;
  if (!fb || !fb.initializeApp || !HUB) return;     // no SDK: the page stays on this device, as Benji's does
  var MN_DB = window.AF_MN_DB_URL || 'https://af-hub-8f188-mn.firebaseio.com';
  var PAGE_URL = 'https://af-hub-two.vercel.app/mn/';
  var TAG = '[mn hub]';

  var origInit = fb.initializeApp.bind(fb);
  var app;
  try { app = origInit(Object.assign({}, HUB, { databaseURL: MN_DB })); }
  catch (e) { console.warn(TAG, 'init failed', e); return; }
  // His fbInit() calls firebase.initializeApp(FIREBASE_CONFIG): hand back the hub app.
  fb.initializeApp = function (cfg, name) { return name ? origInit(cfg, name) : app; };
  window.__fbBlocked = 1;                            // his fbBoot() waits until someone signs in
  window.AF_MN = { app: app };

  var auth = fb.auth(app);
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); };
  var status = function (t) { try { if (typeof fbStat === 'function') fbStat(t, 'off'); } catch (e) {} };

  /* ---------- the login screen and the account chip ---------- */
  var st = document.createElement('style');
  st.textContent =
    '#afGate{position:fixed;inset:0;z-index:2147483000;display:flex;align-items:center;justify-content:center;' +
    'background:rgba(15,23,42,.55);backdrop-filter:blur(3px);-webkit-backdrop-filter:blur(3px);padding:16px}' +
    '#afGate[hidden]{display:none}' +
    '#afGate form{background:var(--panel,#fff);color:var(--ink,#0f172a);border-radius:14px;padding:22px 20px;width:100%;max-width:340px;' +
    'box-shadow:0 10px 40px rgba(0,0,0,.25);display:flex;flex-direction:column;gap:10px;font:15px/1.4 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif}' +
    '#afGate h2{margin:0;font-size:18px}#afGate p{margin:0;color:var(--muted,#64748b);font-size:13.5px}' +
    '#afGate input{border:1px solid var(--line2,#cbd5e1);background:var(--bg,#eef2f7);color:inherit;border-radius:8px;padding:11px 12px;font-size:16px}' +
    '#afGate button{background:var(--accent,#0ea5e9);color:#fff;border:0;border-radius:8px;padding:11px;font-size:15px;cursor:pointer}' +
    '#afGate .err{color:#dc2626;font-size:13px;min-height:16px}#afGate a{font-size:13px;color:var(--accent-ink,#0369a1)}' +
    '#afChip{position:fixed;left:10px;bottom:10px;z-index:2147482000;background:var(--panel,#fff);color:var(--muted,#64748b);' +
    'border:1px solid var(--line,#e2e8f0);border-radius:999px;padding:4px 10px;font:12px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;' +
    'box-shadow:0 1px 4px rgba(0,0,0,.12);opacity:.85}#afChip:hover{opacity:1}' +
    '#afChip a,#afChip button{color:var(--accent-ink,#0369a1);background:none;border:0;padding:0 2px;font:inherit;cursor:pointer;text-decoration:underline}' +
    '@media print{#afChip,#afGate{display:none!important}}';
  document.head.appendChild(st);

  var gate = document.createElement('div');
  gate.id = 'afGate';
  gate.innerHTML = '<form autocomplete="on"><h2>Morgan North</h2>' +
    '<p id="afGateMsg">Glass replacement tracker. Sign in with your AF hub account.</p>' +
    '<input type="email" id="afEmail" placeholder="you@advfacade.com" autocomplete="email" required>' +
    '<input type="password" id="afPw" placeholder="Password" autocomplete="current-password" required>' +
    '<button type="submit" id="afGo">Sign in</button><div class="err" id="afErr"></div>' +
    '<a href="/">First time here, or forgot your password? Use the hub →</a></form>';
  document.body.appendChild(gate);
  var $ = function (id) { return document.getElementById(id); };
  function showGate(msg, withForm) {
    gate.hidden = false;
    $('afGateMsg').innerHTML = msg || 'Glass replacement tracker. Sign in with your AF hub account.';
    ['afEmail', 'afPw', 'afGo'].forEach(function (id) { $(id).style.display = withForm === false ? 'none' : ''; });
    status('● Sign in to sync');
  }
  gate.querySelector('form').addEventListener('submit', function (e) {
    e.preventDefault();
    $('afErr').textContent = '';
    auth.signInWithEmailAndPassword($('afEmail').value.trim(), $('afPw').value).catch(function (er) {
      $('afErr').textContent = /wrong-password|invalid-credential|user-not-found|invalid-login/.test(er.code || '') ? 'Wrong email or password.' : (er.message || er.code);
    });
  });
  function chip(email) {
    var c = $('afChip') || document.body.appendChild(Object.assign(document.createElement('div'), { id: 'afChip' }));
    c.innerHTML = esc(String(email).split('@')[0]) + ' · <a href="/">Hub</a> · <button type="button" id="afOut">Sign out</button>';
    $('afOut').onclick = function () { auth.signOut().then(function () { location.reload(); }); };
  }

  /* ---------- after login: check the account can open this project, then let the page connect ---------- */
  var started = false;
  auth.onAuthStateChanged(function (u) {
    if (!u || u.isAnonymous) { showGate(); return; }
    if (!u.emailVerified) {
      showGate('Confirm your email first: open the <a href="/">hub</a>, tap “Send the link” and open it. Then reload this page. ' +
        '<button type="button" id="afOut2" style="background:none;color:inherit;padding:0;text-decoration:underline">Sign out</button>', false);
      $('afOut2').onclick = function () { auth.signOut(); };
      return;
    }
    fb.database(app).ref('meta/project').once('value').then(function (s) {
      if (s.val() !== 'mn') throw new Error('this database is not Morgan North');
      gate.hidden = true;
      chip(u.email);
      if (started) return;
      started = true;
      window.__fbBlocked = 0;
      try { if (typeof fbBoot === 'function') fbBoot(); } catch (e) { console.warn(TAG, 'fbBoot', e); }
      setTimeout(push, 4000);
      setInterval(push, 60000);
    }).catch(function (e) {
      var denied = /permission|denied/i.test(String(e && (e.code || e.message)));
      showGate((denied ? esc(u.email) + ' has no access to Morgan North yet. Ask Leo to add you.'
        : 'Could not open Morgan North: ' + esc(e && (e.code || e.message))) +
        ' <button type="button" id="afOut2" style="background:none;color:inherit;padding:0;text-decoration:underline">Sign out</button>', false);
      $('afOut2').onclick = function () { auth.signOut(); };
    });
  });

  /* ---------- progress for the hub overview ---------- */
  /** From the page's own state: panes in scope (window.replace), replaced, per floor, last 7 days. */
  function stats(st) {
    if (!st || !st.windows || !st.units) return null;
    var total = 0, done = 0, week = 0, floors = {}, now = Date.now();
    st.windows.forEach(function (w) {
      (w.replace || []).forEach(function (i) {
        if (!i) return;                                         // [0] = "no panes" placeholder
        var u = st.units[w.id + '#' + i] || {};
        var k = 'Glass replacement — Floor ' + w.floor;
        var f = floors[k] || (floors[k] = { scope: k, done: 0, total: 0, qtyDone: 0, qtyTotal: 0, unit: 'panes', n: +w.floor || 0 });
        total++; f.total++; f.qtyTotal++;
        if (u.status === 'replaced') {
          done++; f.done++; f.qtyDone++;
          var t = Date.parse(u.date || '');
          if (t && now - t < 7 * 864e5) week++;
        }
      });
    });
    var breakdown = Object.keys(floors).map(function (k) { return floors[k]; })
      .sort(function (a, b) { return b.n - a.n; })
      .map(function (f) { return { scope: f.scope, done: f.done, total: f.total, qtyDone: f.qtyDone, qtyTotal: f.qtyTotal, unit: f.unit }; });
    return { total: total, done: done, week: week, pct: total ? Math.round(done / total * 1000) / 10 : 0, breakdown: breakdown };
  }
  window.AF_MN.stats = stats;
  function pageState() {
    try { if (typeof state !== 'undefined' && state) return state; } catch (e) {}
    return window.state || null;
  }
  // Only figures that came from the database: before that the page shows the snapshot built into the file.
  function loaded() {
    try { return typeof fbRef !== 'undefined' && !!fbRef && typeof fbSynced !== 'undefined' && fbSynced && Object.keys(fbSynced).length > 0; }
    catch (e) { return false; }
  }
  var hubApp = null, lastSig = '';
  function push() {
    var s = stats(pageState());
    if (!s || !s.total || !loaded()) return;
    var sig = JSON.stringify([s.done, s.total, s.week, s.breakdown]);
    if (sig === lastSig) return;
    try { hubApp = hubApp || fb.apps.filter(function (a) { return a.name === 'afhub'; })[0] || origInit(HUB, 'afhub'); }
    catch (e) { return; }
    var a = fb.auth(hubApp);
    (a.currentUser ? Promise.resolve() : a.signInAnonymously()).then(function () {
      return fb.database(hubApp).ref('projects/mn/summary').set({
        name: 'Morgan North', unit: 'panes', scope: 'Glass replacement', url: PAGE_URL,
        done: s.done, total: s.total, pct: s.pct, weekRate: s.week, breakdown: s.breakdown, ts: Date.now() });
    }).then(function () { lastSig = sig; }).catch(function (e) { console.warn(TAG, 'overview not updated:', e && (e.code || e.message)); });
  }
  window.AF_MN.push = push;
})();
