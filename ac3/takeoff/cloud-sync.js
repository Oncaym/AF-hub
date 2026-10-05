// ============================================================
//  cloud-sync.js  (classic script, 必须在 app.js 之后加载)
//  作用:把"各系统的主数据"(parts + accessories)与 Firestore 同步。
//   · 集合 systems,一个系统一个文档(doc.name = 系统名,如 IR501T / 1600 (10-1/2″))
//   · 全公司共享同一套零件库 + 配件规则,改了实时同步给所有人
//   · openings / 下料结果 不进云,只留本地 localStorage(app.js 原逻辑不变)
//   · 首次云端为空 → 用 systems.js 里的 SYSTEM_DEFS 初始化
//  依赖 app.js 全局: state, save, renderAll, STORAGE_KEY, uid
//  依赖 systems.js 全局: window.SYSTEM_DEFS, window.SYSTEM_ORDER
// ============================================================
(function () {
  var fb = null;
  var unsub = null;
  var pushTimer = null;
  var lastSyncedSystemsJSON = null;  // 最近一次与云端一致的"系统主数据"快照
  var applyingRemote = false;        // 正在应用远程数据时不要回推
  var firstSnapshotDone = false;     // 收到首个云端快照前不推送
  var missingSeedDone = false;       // "补种缺失系统"每次会话只做一次(防写入循环)

  function $(id) { return document.getElementById(id); }
  function setStatus(text, color) {
    var el = $("cloud-status");
    if (el) { el.textContent = text; el.style.color = color || "var(--af-fg-3,#888)"; }
  }

  // 系统名 → Firestore 文档 id(去掉 / \ # ? 等非法字符;真正系统名存在 doc.name 字段)
  function sysDocId(name) {
    return String(name || "").trim().replace(/[\/\\#?]+/g, "-").slice(0, 140) || "system";
  }
  function manufacturerFor(/* name */) { return "Kawneer"; }

  // 规整 parts / accessories(只保留主数据字段,去掉本地 id)
  function cleanParts(arr) {
    return (arr || []).map(function (p) {
      var o = {
        partNumber: p.partNumber || "",
        description: p.description || "",
        roles: Array.isArray(p.roles) ? p.roles.slice() : []
      };
      if (p.stockInches != null) o.stockInches = p.stockInches;
      if (p.continuous) o.continuous = true;   // 连续件标记(如 C Face Cover),云端保留
      if (p.roleQty && Object.keys(p.roleQty).length) o.roleQty = p.roleQty;   // #4: per-role part qty, cloud-shared
      return o;
    });
  }
  function cleanAccessories(arr) {
    return (arr || []).map(function (a) {
      return {
        partNumber: a.partNumber || "",
        description: a.description || "",
        rule: a.rule || "per_piece",
        positions: Array.isArray(a.positions) ? a.positions.slice() : [],
        param: (a.param != null ? a.param : 1),
        min: a.min || 0,
        unit: a.unit || "ea"
      };
    });
  }

  // 本地 state(扁平 parts/accessories,带 system 字段)→ 按系统分组的主数据 map
  function systemsFromState() {
    var bySys = {};
    function bucket(s) { return bySys[s] || (bySys[s] = { parts: [], accessories: [] }); }
    (state.parts || []).forEach(function (p) {
      var s = p.system || "";
      if (!s) return;                 // 无系统的零件不进云
      bucket(s).parts.push(cleanParts([p])[0]);
    });
    (state.accessories || []).forEach(function (a) {
      var s = a.system || "";
      if (!s) return;
      bucket(s).accessories.push(cleanAccessories([a])[0]);
    });
    return bySys;
  }

  // Firestore 文档数组 → 按系统分组的主数据 map(用 doc.name 作系统名)
  function systemsFromDocs(docs) {
    var m = {};
    docs.forEach(function (d) {
      var name = d.data && d.data.name;
      if (!name) return;
      m[name] = { parts: cleanParts(d.data.parts), accessories: cleanAccessories(d.data.accessories) };
    });
    return m;
  }

  // 把云端文档套到本地 state.parts / state.accessories(openings 不动),并重画
  function applySystemsDocs(docs) {
    applyingRemote = true;
    try {
      docs.sort(function (a, b) {
        var oa = (a.data && a.data.order != null) ? a.data.order : 999;
        var ob = (b.data && b.data.order != null) ? b.data.order : 999;
        if (oa !== ob) return oa - ob;
        return String(a.id).localeCompare(String(b.id));
      });
      var parts = [], accessories = [];
      docs.forEach(function (d) {
        var name = (d.data && d.data.name) || d.id;
        cleanParts(d.data && d.data.parts).forEach(function (p) {
          var np = { id: uid(), system: name, partNumber: p.partNumber, description: p.description, roles: p.roles.slice() };
          if (p.stockInches != null) np.stockInches = p.stockInches;
          if (p.continuous) np.continuous = true;
          if (p.roleQty) np.roleQty = p.roleQty;   // #4
          parts.push(np);
        });
        cleanAccessories(d.data && d.data.accessories).forEach(function (a) {
          accessories.push({ id: uid(), system: name, partNumber: a.partNumber, description: a.description, rule: a.rule, positions: a.positions.slice(), param: a.param, min: a.min, unit: a.unit });
        });
      });
      state.parts = parts;
      state.accessories = accessories;
      lastSyncedSystemsJSON = JSON.stringify(systemsFromState());
      try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
      renderAll();
    } finally {
      applyingRemote = false;
    }
  }

  // 把 SYSTEM_DEFS 里指定的系统写成云端文档(names 省略 = 全部)。
  // 用途:① 云端全空的首次初始化;② 云端已有数据但缺 systems.js 新定义的系统(如 750XT)时补种。
  function seedFromDefs(names) {
    var defs = window.SYSTEM_DEFS || {};
    var order = window.SYSTEM_ORDER || [];
    names = (names && names.length) ? names : Object.keys(defs);
    names = names.filter(function (n) { return defs[n]; });
    if (!names.length) { setStatus("● Cloud empty, no local seed", "#c62828"); return; }
    setStatus("● Initializing parts library…", "#d59300");
    var writes = names.map(function (name) {
      var d = defs[name] || {};
      var oi = order.indexOf(name);
      return fb.setDoc(fb.doc(fb.db, "systems", sysDocId(name)), {
        name: name,
        manufacturer: manufacturerFor(name),
        order: oi >= 0 ? oi : 999,
        parts: cleanParts(d.parts),
        accessories: cleanAccessories(d.accessories),
        updatedAt: fb.serverTimestamp()
      }, { merge: true });
    });
    Promise.all(writes).then(function () {
      setStatus("● Initialized & synced", "#1a9e4b");
      // 写完后 onSnapshot 会再次触发(这次有 docs)→ applySystemsDocs
    }).catch(function (e) {
      console.error("[cloud] seed failed:", e);
      setStatus("● Init failed (using local library)", "#c62828");
    });
  }

  // ---------- 写入云端(防抖,只写有变化的系统) ----------
  function schedulePush() {
    if (!firstSnapshotDone) return;
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(pushNow, 700);
  }

  function pushNow() {
    if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; }
    if (!fb) return Promise.resolve();
    var cur = systemsFromState();
    var curJSON = JSON.stringify(cur);
    if (curJSON === lastSyncedSystemsJSON) { setStatus("● Synced", "#1a9e4b"); return Promise.resolve(); }
    var prev = lastSyncedSystemsJSON ? JSON.parse(lastSyncedSystemsJSON) : {};
    var writes = [];
    Object.keys(cur).forEach(function (sys) {
      if (JSON.stringify(cur[sys]) === JSON.stringify(prev[sys])) return; // 该系统没变
      var oi = (window.SYSTEM_ORDER || []).indexOf(sys);
      writes.push(fb.setDoc(fb.doc(fb.db, "systems", sysDocId(sys)), {
        name: sys,
        manufacturer: manufacturerFor(sys),
        order: oi >= 0 ? oi : 999,
        parts: cur[sys].parts,
        accessories: cur[sys].accessories,
        updatedAt: fb.serverTimestamp()
      }, { merge: true }));
    });
    if (!writes.length) { lastSyncedSystemsJSON = curJSON; setStatus("● Synced", "#1a9e4b"); return Promise.resolve(); }
    setStatus("● Saving…", "#d59300");
    return Promise.all(writes).then(function () {
      lastSyncedSystemsJSON = curJSON;
      setStatus("● Synced", "#1a9e4b");
    }).catch(function (e) {
      console.error("[cloud] push failed:", e);
      setStatus("● Save failed (saved locally)", "#c62828");
    });
  }

  // ---------- 订阅 systems 集合 ----------
  function subscribe() {
    if (unsub) { try { unsub(); } catch (e) {} unsub = null; }
    if (!fb) return;
    firstSnapshotDone = false;
    setStatus("● Connecting…", "#888");
    unsub = fb.onSnapshot(fb.collection(fb.db, "systems"), function (snap) {
      if (snap.metadata && snap.metadata.hasPendingWrites) return;
      firstSnapshotDone = true;
      var docs = [];
      snap.forEach(function (d) { docs.push({ id: d.id, data: d.data() || {} }); });
      if (!docs.length) { seedFromDefs(); return; }     // 空 → 种子初始化
      // 云端有数据但缺本地 systems.js 里新定义的系统(如 750XT)→ 补种一次;
      // 写完 onSnapshot 会带着新文档再触发 → applySystemsDocs 把它同步给所有人。
      if (!missingSeedDone) {
        missingSeedDone = true;
        var have = {};
        docs.forEach(function (d) { have[(d.data && d.data.name) || d.id] = 1; });
        var missing = Object.keys(window.SYSTEM_DEFS || {}).filter(function (n) { return !have[n]; });
        if (missing.length) { seedFromDefs(missing); return; }
      }
      var incomingJSON = JSON.stringify(systemsFromDocs(docs));
      if (incomingJSON === JSON.stringify(systemsFromState())) {
        lastSyncedSystemsJSON = incomingJSON;
        setStatus("● Synced", "#1a9e4b");
        return;
      }
      applySystemsDocs(docs);
      setStatus("● Synced", "#1a9e4b");
    }, function (err) {
      console.error("[cloud] snapshot error:", err);
      setStatus("● Offline (using local library)", "#c62828");
    });
  }

  // ---------- 启动 ----------
  function patchSave() {
    if (typeof save !== "function" || save.__cloudPatched) return;
    var _localSave = save;
    save = function () {
      _localSave.apply(this, arguments);                       // 原逻辑:写 localStorage(含 openings)
      if (fb && !applyingRemote && firstSnapshotDone) schedulePush(); // 只把系统主数据同步到云端
    };
    save.__cloudPatched = true;
  }

  function start() {
    fb = window.__fb;
    patchSave();
    subscribe();
  }

  if (window.__fb) {
    start();
  } else {
    window.addEventListener("fb-ready", start, { once: true });
    window.addEventListener("fb-error", function () {
      setStatus("● Cloud connection failed (using local library)", "#c62828");
    }, { once: true });
  }
})();
