/* ============================================================
   Carbon Skin demo — the in-page "database".
   ------------------------------------------------------------
   demo-sdk.js sends every Firebase call here. Data lives in this
   page only: a reload starts the demo over, and nothing a visitor
   does is sent anywhere. Every visitor is signed in as the demo
   editor, so every control on the tracker works.
   Load order: demo-sdk.js → this → firebase-config → project-config
   → cloud-sync → app → carbon.
   ============================================================ */
(function () {
  'use strict';
  var EMAIL = 'demo.visitor@carbon-skin.demo';
  var KEY = EMAIL.replace(/\./g, ',');
  var DB = {};            // url -> tree
  var started = false;

  // A fresh demo on every load: forget anything an earlier visit cached in this browser.
  try {
    Object.keys(localStorage).forEach(function (k) {
      if (/^carbon_skin_demo|^fyc_/.test(k)) localStorage.removeItem(k);
    });
    localStorage.setItem('fakefb:user', JSON.stringify({ uid: 'demo-visitor', email: EMAIL, emailVerified: true }));
  } catch (e) {}

  function tree(url) {
    if (!DB[url]) {
      DB[url] = {};
      if (!started && url === (window.FIREBASE_CONFIG || {}).databaseURL) {
        started = true;
        DB[url] = { meta: { project: 'cs-demo', name: 'Foundry Yard C' }, allowlist: {} };
        DB[url].allowlist[KEY] = true;
      }
    }
    return DB[url];
  }
  function get(o, p) { return String(p).split('/').filter(Boolean).reduce(function (a, k) { return a == null ? a : a[k]; }, o); }
  function set(o, p, v) {
    var ks = String(p).split('/').filter(Boolean), x = o;
    if (!ks.length) return;
    for (var i = 0; i < ks.length - 1; i++) { if (x[ks[i]] == null || typeof x[ks[i]] !== 'object') x[ks[i]] = {}; x = x[ks[i]]; }
    if (v == null) delete x[ks[ks.length - 1]]; else x[ks[ks.length - 1]] = v;
  }
  var now = function () { return Date.now(); };
  function sv(v) {
    if (v && typeof v === 'object') {
      if (v['.sv'] === 'timestamp') return now();
      var o = Array.isArray(v) ? [] : {};
      Object.keys(v).forEach(function (k) { o[k] = sv(v[k]); });
      return o;
    }
    return v;
  }
  function clone(v) { return v === undefined ? undefined : JSON.parse(JSON.stringify(v)); }

  window.__fb = function (op, a) {
    a = a || {};
    var r = null;
    if (op === 'signIn') r = { uid: 'demo-visitor', email: EMAIL, emailVerified: true };
    else if (op === 'user') r = { emailVerified: true };
    else if (op === 'read') r = { allowed: true, value: clone(get(tree(a.url), a.path)) };
    else if (op === 'write') {
      var t = tree(a.url), v = sv(a.value);
      if (a.op === 'update' && v && typeof v === 'object') Object.keys(v).forEach(function (k) { set(t, a.path + '/' + k, v[k]); });
      else set(t, a.path, v);
      r = { allowed: true };
    }
    return Promise.resolve(r);
  };
  window.CARBON_SKIN_DEMO = { email: EMAIL, db: DB };
})();
