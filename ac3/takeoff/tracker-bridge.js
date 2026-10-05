// ============================================================
//  tracker-bridge.js  (classic script, load AFTER app.js)
//  #M2-v2: the tracker's "⬆ Import DXF" button no longer stages a handoff or navigates here
//  (it now parses elevation regions in-page via dxf-elevations.js) — this file's IndexedDB
//  consumer (db af_dxf_handoff / store files / key "pending") is legacy/inert unless
//  something else manually writes that key. Kept only so a manually-staged handoff (if any
//  other tool ever populates it) still runs the same parse path as the tool's own
//  "Import DXF" button (parseRawDxfOpenings → appendParsedOpenings). No app.js behavior is
//  modified. No return-navigation — that was the superseded M2 round-trip UX.
// ============================================================
(function () {
  var DB = 'af_dxf_handoff', STORE = 'files', KEY = 'pending';
  var MAX_AGE_MS = 15 * 60 * 1000; // ignore stale handoffs (>15 min)

  function readAndClearPending() {
    return new Promise(function (resolve) {
      if (!window.indexedDB) return resolve(null);
      var req;
      try { req = indexedDB.open(DB, 1); } catch (e) { return resolve(null); }
      req.onupgradeneeded = function () {
        try { req.result.createObjectStore(STORE); } catch (e) {}
      };
      req.onerror = function () { resolve(null); };
      req.onsuccess = function () {
        var db = req.result;
        try {
          var tx = db.transaction(STORE, 'readwrite');
          var st = tx.objectStore(STORE);
          var g = st.get(KEY);
          g.onsuccess = function () {
            var v = g.result || null;
            try { st.delete(KEY); } catch (e) {}
            tx.oncomplete = function () { db.close(); resolve(v); };
            tx.onerror = function () { db.close(); resolve(v); };
          };
          g.onerror = function () { db.close(); resolve(null); };
        } catch (e) { db.close(); resolve(null); }
      };
    });
  }

  document.addEventListener('DOMContentLoaded', function () {
    // Registered after app.js's DOMContentLoaded listener → runs after init().
    readAndClearPending().then(function (pend) {
      if (!pend || !pend.text) return;
      if (pend.ts && (Date.now() - pend.ts) > MAX_AGE_MS) return;
      var statusEl = document.getElementById('dxf-status');
      if (statusEl) { statusEl.textContent = 'Loading ' + (pend.name || 'DXF') + '…'; statusEl.className = 'tk-dxf__status'; }
      // #S4: ask which system BEFORE parsing (same rule as onDxfFileChange/runDxfParse in
      // app.js) so classification runs against the confirmed system, not a per-mark guess.
      Promise.resolve(pickSystem({
        title: 'Import — Select System',
        msg: 'Which system is ' + (pend.name || 'this DXF') + '? (usually one at a time; the whole batch gets it — or keep auto-detect for a mixed schedule).',
        includeAuto: true,
      })).then(function (sys) {
        if (sys === undefined) {
          if (statusEl) { statusEl.textContent = 'Import cancelled'; statusEl.className = 'tk-dxf__status is-err'; }
          return;
        }
        var forcedSystem = sys || undefined;
        // Same flow as onDxfFileChange (app.js): geometry parse first, text fallback.
        var result = null;
        if (pend.text.indexOf('SECTION') !== -1 && pend.text.indexOf('ENTITIES') !== -1) {
          try { result = parseRawDxfOpenings(pend.text, { forcedSystem: forcedSystem }); }
          catch (e) { console.warn('DXF geometry parse failed, falling back to text:', e); }
        }
        if (!result || !result.openings || !result.openings.length) result = parseDxfText(pend.text, { forcedSystem: forcedSystem });
        return Promise.resolve(appendParsedOpenings(result, null, sys)).then(function () {
          if (statusEl) statusEl.textContent = (pend.name || 'DXF') + ': ' + statusEl.textContent;
        });
      }).catch(function (e) {
        console.error('tracker-bridge append failed:', e);
        if (statusEl) { statusEl.textContent = 'Could not import ' + (pend.name || 'DXF'); statusEl.className = 'tk-dxf__status is-err'; }
      });
    });
  });
})();
