// ============================================================
//  firebase-init.js  (普通脚本 + 动态 import —— file:// 双击打开也能连云。
//  原来是 <script type="module">, 浏览器在 file:// 下会因 CORS 直接拦掉,
//  导致零件库只剩本地种子、"→ Tracker" 报"云端未连接"。)
//  初始化 Firebase + Firestore, 把句柄挂到 window.__fb,
//  然后派发 'fb-ready' 事件给 cloud-sync.js 使用。
//  注意:这里的 config 不是密码,可以放在前端代码里。
// ============================================================
// 2026-07-10: material-takeoff-tool 项目已删除。共享零件库改挂 AC3 项目
// (atlantic-chestnut-3) 的 Firestore——tracker 用它的 RTDB，Firestore 空着，
// 正好放全公司共享的 systems 零件库。其他楼盘的 takeoff 页也统一指这里。
// 前提：Firebase Console → atlantic-chestnut-3 → Firestore Database → 创建数据库,
// 并发布 firestore.rules（见 FIRESTORE-SETUP.md）。
(async () => {
  // CENTRAL_CONFIG = company-wide shared parts library (Firestore `systems`). SAME for EVERY project — do not change per project.
  const CENTRAL_CONFIG = {
    apiKey: "AIzaSyDzQiJFbU2hEjaFP39T4v0n6Y6M6DYU0j8",
    authDomain: "atlantic-chestnut-3.firebaseapp.com",
    projectId: "atlantic-chestnut-3",
    storageBucket: "atlantic-chestnut-3.firebasestorage.app",
    messagingSenderId: "809348858581",
    appId: "1:809348858581:web:d7d8a18efd7e3947b7185c",
    measurementId: "G-5MMLPWBB2R"
  };
  // PROJECT_CONFIG = THIS project's own Firebase (Firestore `elevGeo` elevations live here, same project as its tracker RTDB).
  // Atlantic-Chestnut 3 IS the central project, so they're identical. For ANY OTHER project, replace PROJECT_CONFIG with
  // that project's own Firebase config (the same one its tracker uses) so elevGeo never collides across projects.
  const PROJECT_CONFIG = CENTRAL_CONFIG;
  try {
    const { initializeApp } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-app.js");
    const {
      getFirestore, doc, getDoc, setDoc, onSnapshot,
      collection, getDocs, serverTimestamp
    } = await import("https://www.gstatic.com/firebasejs/10.14.1/firebase-firestore.js");
    const app = initializeApp(CENTRAL_CONFIG);
    const db = getFirestore(app);                       // systems (shared parts library)
    let elevDb = db;                                    // elevGeo (this project's elevations)
    if (PROJECT_CONFIG.projectId !== CENTRAL_CONFIG.projectId) {
      elevDb = getFirestore(initializeApp(PROJECT_CONFIG, "project"));
    }
    window.__fb = { db, elevDb, doc, getDoc, setDoc, onSnapshot, collection, getDocs, serverTimestamp };
    window.dispatchEvent(new Event("fb-ready"));
  } catch (e) {
    console.error("[firebase] init failed:", e);
    window.__fbError = e;
    window.dispatchEvent(new Event("fb-error"));
  }
})();
