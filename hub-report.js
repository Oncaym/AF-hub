/* ─────────────────────────────────────────────────────────────────────────
   AF Hub 上报 — 每个 tracker 加这一个文件就够,界面一行不用改。

   index.html 里在 app.js 之后加两行:
     <script src="https://www.gstatic.com/firebasejs/9.23.0/firebase-app-compat.js"></script>  ← 已有则跳过
     <script src="hub-report.js?v=1"></script>

   并在 project-config.js 里加:
     window.PROJECT.hubId   = 'ac3';                 // hub 上的项目 key
     window.PROJECT.hubUnit = '樘';                  // 计量单位:樘 / 件 / 延米
     window.PROJECT.hubScope= 'Storefront / CW';     // 一行 scope 描述

   契约只有四组数字。老板屏比的是 % 和预计完工日,不是绝对数量,
   所以各项目单位不同也能同屏排。
   ───────────────────────────────────────────────────────────────────────── */
(function () {
  'use strict';

  var HUB = window.AF_HUB_FIREBASE;                 // 见 af-hub-config.js
  var P   = window.PROJECT || {};
  if (!HUB || !P.hubId || typeof firebase === 'undefined') return;

  var DAY = 864e5, app = null;

  function hubApp() {
    if (app) return app;
    try { app = firebase.apps.filter(function (a) { return a.name === 'afhub'; })[0]
               || firebase.initializeApp(HUB, 'afhub'); } catch (e) { return null; }
    return app;
  }

  // installed 的判定跟主看板保持一致:status === 'installed'
  function isDone(u) { return u && u.status === 'installed'; }

  function daysAgo(dateStr) {
    if (!dateStr) return null;
    var t = Date.parse(dateStr);
    if (isNaN(t)) return null;
    return (Date.now() - t) / DAY;
  }

  function summarize(state) {
    var units = (state && state.units) || [];
    var done = 0, w0 = 0, w1 = 0, w4 = 0;

    units.forEach(function (u) {
      if (!isDone(u)) return;
      done++;
      var d = daysAgo(u.date);
      if (d === null || d < 0) return;
      if (d < 7)  w0++;                              // 本周
      if (d >= 7 && d < 14) w1++;                    // 上周
      if (d < 28) w4++;                              // 近四周
    });

    // 损坏 / CO:第 2 步上线前恒为 0,字段先占位,接上时不用改 hub
    var dmg = (state && state.damage) || [];
    var openDamage = dmg.filter(function (x) { return x && !x.closed; }).length;
    var pendingCO  = dmg.filter(function (x) { return x && x.co === 'pending'; }).length;

    return {
      name: P.displayName || P.name || P.hubId,
      unit: P.hubUnit || '樘',
      scope: P.hubScope || '',
      done: done,
      total: units.length,
      weekRate: w0,
      prevWeekRate: w1,
      avg4w: Math.round(w4 / 4),
      openDamage: openDamage,
      pendingCO: pendingCO,
      ts: Date.now()
    };
  }

  var last = '', timer = null;

  function push() {
    var a = hubApp(); if (!a) return;
    var s = summarize(window.state);
    if (!s.total) return;                            // 还没载入数据,别推空的
    var sig = JSON.stringify(s); sig = sig.replace(/"ts":\d+/, '');
    if (sig === last) return;                        // 没变化就不写
    last = sig;
    a.database().ref('projects/' + P.hubId + '/summary').set(s).catch(function () {});
  }

  function schedule() { clearTimeout(timer); timer = setTimeout(push, 3000); }

  // 登录后开推:状态每次变化推一次(去抖 3 秒),另外每 10 分钟保一次底
  try {
    hubApp().auth().signInAnonymously().catch(function () {});
  } catch (e) {}

  window.addEventListener('af-state-changed', schedule);   // 主 app 若有事件则用
  document.addEventListener('DOMContentLoaded', schedule);
  setInterval(push, 10 * 60 * 1000);
  setTimeout(schedule, 8000);                              // 首次载入兜底
})();
