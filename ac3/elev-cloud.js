// ============================================================
//  elev-cloud.js — 立面几何云端读取（项目文件，非 core）
//  takeoff 页（takeoff/ 的 "→ Tracker" 按钮）把每个 unit 的立面几何写进
//  takeoff 工具自己的 Firestore（atlantic-chestnut-3 项目，也放着全公司共用
//  的零件库）`elevGeo` 集合（文档 id = unit 显示 id，如 "SF04.1"）。这里实时
//  订阅并合并进 window.ELEVATIONS——云端条目覆盖 elevations.js 里的同名静态条目。
//
//  2026-10 AF Hub：tracker 本身搬进了 af-hub（进度存 af-hub-8f188-ac3 数据库），
//  但 takeoff 工具和它的 Firestore 暂时不动，所以这里单独开一个名为 'takeoff'
//  的 Firebase app 只读 elevGeo（那边的规则允许免登录读取）。和 tracker 的
//  登录、进度数据完全分开，互不影响。
// ============================================================
(function () {
  var TAKEOFF_FIRESTORE = {
    apiKey: "AIzaSyDzQiJFbU2hEjaFP39T4v0n6Y6M6DYU0j8",
    authDomain: "atlantic-chestnut-3.firebaseapp.com",
    projectId: "atlantic-chestnut-3",
    appId: "1:809348858581:web:d7d8a18efd7e3947b7185c"
  };
  var tries = 0;
  function start() {
    if (typeof firebase === 'undefined' || !firebase.firestore) {
      if (++tries > 100) return;                 // ~30s 后放弃（SDK 没加载）
      return setTimeout(start, 300);
    }
    try {
      var app = (firebase.apps || []).filter(function (a) { return a.name === 'takeoff'; })[0]
             || firebase.initializeApp(TAKEOFF_FIRESTORE, 'takeoff');
      firebase.firestore(app).collection('elevGeo').onSnapshot(function (snap) {
        var EL = window.ELEVATIONS = window.ELEVATIONS || {};
        var got = 0;
        snap.forEach(function (d) {
          var v = d.data() || {};
          if (v.viewBox && v.elements) { EL[d.id] = v; got++; }
        });
        if (got) console.log('[elevGeo] loaded ' + got + ' cloud elevations');
      }, function (err) {
        console.warn('[elevGeo] offline (takeoff Firestore unreachable):', err && err.code);
      });
    } catch (e) { console.warn('[elevGeo] init failed:', e); }
  }
  if (document.readyState !== 'loading') start();
  else document.addEventListener('DOMContentLoaded', start);
})();
