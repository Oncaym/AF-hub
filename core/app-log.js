/* app-log.js — daily log helpers, extracted from app.js so that file stays
   small enough for the Edit tool (which truncates ≥40KB files).
   Load BEFORE app.js. All functions live on the global window scope. */

/* State-driven Daily Log sync.
   Instead of recording a "diff", we treat the daily log as a projection of the
   unit's CURRENT state on u.date. Every save:
     1) Sweep this unit out of every existing unit-kind auto entry
     2) Re-add it to u.date's framing/issue/louver entry if it currently belongs
   Effects:
   - Status reversal (installed → pending) removes the unit instead of stacking suffixes.
   - Same unit ID never appears twice in one entry.
   - Log date follows u.date (not "today").
   - Glass panel changes are also logged here — upsert-only (no sweep), so a
     reverted panel may leave a stale entry, but historical data is never lost. */
function autoLogUnitChanges(u, old) {
  const oldId = (old && old.id) || u.id;
  removeUnitFromUnitLogs(oldId, u.key);
  if (oldId !== u.id) removeUnitFromUnitLogs(u.id, u.key);

  const date = u.date || new Date().toISOString().slice(0,10);

  if (u.status === 'installed') {
    upsertUnitLog(date, 'framing', u.id, u.key);
  } else if (u.status === 'issue') {
    upsertUnitLog(date, 'issue', u.id, u.key);
  }
  // pending / in-progress: no entry (the sweep above already cleaned any prior log)

  if (u.louver === 'yes') {
    upsertUnitLog(date, 'louver', u.id, u.key);
  }

  // --- M3: unit-level Calendar scopes (caulking / sunshade / beautyCap) — same
  // sweep-then-add pattern as frame/louver above, one log category per scope. ---
  const _scopeCat = { caulking: 'caulking', sunshade: 'sunshade', beautyCap: 'beauty-cap' };
  Object.keys(_scopeCat).forEach(function(scopeKey) {
    const cat = _scopeCat[scopeKey];
    const cur = (u.scopes && u.scopes[scopeKey]) || {};
    const scopeDate = cur.date || date;
    if (cur.status === 'installed') {
      upsertUnitLog(scopeDate, cat, u.id, u.key);
    } else if (cur.status === 'issue') {
      upsertUnitLog(scopeDate, 'issue', u.id, u.key);
    }
    // pending / in-progress / blank: no entry (sweep below cleans any prior one)
  });

  // --- Glass panel diff: log on actual status/date change. No sweep on purpose ---
  const _oldGP = (old && old.glassPanels) || [];
  const _newGP = u.glassPanels || [];
  _newGP.forEach(function(np, i) {
    const op = _oldGP[i] || {};
    const oldSt = op.status || '', newSt = np.status || '';
    const oldDt = op.date   || '', newDt = np.date   || '';
    if (oldSt === newSt && oldDt === newDt) return;
    /* F-053 (Leo, 2026-08-05): 'ready' means the glass is on site, not in the wall — it
       used to be logged as progress and inflated the Glass bar on the daily trend. Only
       an INSTALLED panel counts as installation; 'issue' still files under issue. */
    if (newSt !== 'installed' && newSt !== 'issue') return;
    const pDate = newDt || u.date || new Date().toISOString().slice(0,10);
    const cat   = newSt === 'issue' ? 'issue' : 'glass';
    upsertGlassLog(pDate, cat, u.id, np.panel || '', newSt, u.key);
  });
}

/* Treat both new kind='unit' entries AND legacy auto entries (no kind set)
   as the same "unit-kind" bucket. New glass-batch entries use kind='glass'
   so this sweep doesn't touch them. */
function isUnitAutoEntry(l) {
  return l && l.auto === true && Array.isArray(l.categories) && (!l.kind || l.kind === 'unit');
}

// Firebase Realtime DB rejects '.', '#', '$', '/', '[', ']' in object keys.
// Unit IDs like 'SF20A.1' must be sanitized before being used as autoUnits keys.
function safeKey(s) { return String(s == null ? '' : s).replace(/[.#$\/\[\]]/g, '_'); }

// Normalize an autoUnits entry to the new {id,status} shape.
// Legacy entries stored a plain string (status, or '' for installed/unit) with
// the unsanitized id as the key — handle both forms.
function autoUnitNorm(k, v) {
  if (v && typeof v === 'object' && 'id' in v) return { id: v.id, status: v.status || '' };
  return { id: k, status: (typeof v === 'string') ? v : '' };
}
function autoUnitDisplay(v) { return v.status ? v.id + ' (' + v.status + ')' : v.id; }

// Rebuilds the content string from autoUnits. Preserves original storage keys so
// that multiple units sharing the same display ID all appear in the log.
function rebuildAutoUnitsContent(entry) {
  if (!entry) return;
  const cur = entry.autoUnits || {};
  const fresh = {};
  Object.entries(cur).forEach(function(kv) {
    const norm = autoUnitNorm(kv[0], kv[1]);
    if (!norm.id) return;
    // Keep original key — don't re-key by safeKey(norm.id) which would
    // collapse same-named units (e.g. two "SF20A") into one entry.
    fresh[kv[0]] = norm;
  });
  entry.autoUnits = fresh;
  entry.content = Object.values(fresh).map(autoUnitDisplay).join(' · ');
}

// unitKey: the unit's unique .key field (e.g. 'SF20A__2'). Used as the storage
// key so that multiple units with the same display unitId each get their own entry.
function upsertUnitLog(date, category, unitId, unitKey) {
  if (!Array.isArray(state.log)) state.log = Object.values(state.log || {});
  let entry = state.log.find(l =>
    isUnitAutoEntry(l) && l.date === date &&
    l.categories.length === 1 && l.categories[0] === category
  );
  if (!entry) {
    entry = {
      date: date,
      categories: [category],
      category: category,
      content: '',
      auto: true,
      kind: 'unit',
      autoUnits: {}
    };
    state.log.push(entry);
  }
  if (!entry.kind) entry.kind = 'unit';
  if (!entry.autoUnits) {
    // Legacy entry — migrate content tokens into the structured map
    entry.autoUnits = {};
    if (entry.content) {
      entry.content.split(' · ').forEach(tok => {
        const id = tok.split(' (')[0].trim();
        if (id) entry.autoUnits[id] = '';
      });
    }
  }
  // Use the unique unit key as storage key so same-named units each appear separately.
  const storageKey = unitKey ? safeKey(unitKey) : safeKey(unitId);
  entry.autoUnits[storageKey] = { id: unitId, status: '' };
  rebuildAutoUnitsContent(entry);
}

function removeUnitFromUnitLogs(unitId, unitKey) {
  if (!Array.isArray(state.log)) state.log = Object.values(state.log || {});
  const sk = safeKey(unitId);
  const kk = unitKey ? safeKey(unitKey) : null;
  for (let i = state.log.length - 1; i >= 0; i--) {
    const l = state.log[i];
    if (!isUnitAutoEntry(l)) continue;
    // Migrate legacy entries lazily so removal works
    if (!l.autoUnits) {
      l.autoUnits = {};
      if (l.content) {
        l.content.split(' · ').forEach(tok => {
          const id = tok.split(' (')[0].trim();
          if (id) l.autoUnits[id] = '';
        });
      }
    }
    let removed = false;
    // Remove by unique unit key first (new format), then fall back to display-id key (legacy)
    if (kk && kk in l.autoUnits) { delete l.autoUnits[kk]; removed = true; }
    if (sk in l.autoUnits) { delete l.autoUnits[sk]; removed = true; }
    // Also handle pre-existing in-memory dotted keys
    if (unitId !== sk && unitId in l.autoUnits) { delete l.autoUnits[unitId]; removed = true; }
    if (!removed) continue;
    if (Object.keys(l.autoUnits).length === 0) {
      state.log.splice(i, 1);
    } else {
      rebuildAutoUnitsContent(l);
    }
  }
}

/* Glass-batch entries — separate kind='glass' so unit-modal sweeps leave them alone.
   Display id is "unitId panel" (e.g. "12A 1F-3"); safeKey() sanitizes the dot. */
function upsertGlassLog(date, category, unitId, panel, status, unitKey) {
  if (!Array.isArray(state.log)) state.log = Object.values(state.log || {});
  // Migration: re-tag legacy kind='glass' entries that were stored as category 'framing'
  // (before glass became its own daily-log category). Idempotent.
  state.log.forEach(function(l) {
    if (l && l.auto === true && l.kind === 'glass' && Array.isArray(l.categories) &&
        l.categories.length === 1 && l.categories[0] === 'framing') {
      l.categories = ['glass'];
      l.category   = 'glass';
    }
  });
  let entry = state.log.find(l =>
    l && l.auto === true && l.kind === 'glass' && l.date === date &&
    Array.isArray(l.categories) && l.categories.length === 1 && l.categories[0] === category
  );
  if (!entry) {
    entry = {
      date: date,
      categories: [category],
      category: category,
      content: '',
      auto: true,
      kind: 'glass',
      autoUnits: {}
    };
    state.log.push(entry);
  }
  if (!entry.autoUnits) entry.autoUnits = {};
  const displayId = unitId + (panel ? ' ' + panel : '');
  // Use unitKey to differentiate same-named units (e.g. two 'SF20A' with different panels)
  const storageKey = unitKey
    ? safeKey(unitKey + (panel ? '_' + panel : ''))
    : safeKey(displayId);
  entry.autoUnits[storageKey] = {
    id: displayId,
    status: (status && status !== 'installed') ? status : ''
  };
  rebuildAutoUnitsContent(entry);
}

/* -------- RFI / GC-inquiry log sync (F-032) --------
   Keeps state.log in sync with u.rfi[] / state.projectItems[] rows so a status/party
   edit — or a deleted row — shows up in the daily log instead of drifting. Distinct
   from upsertUnitLog/upsertGlassLog's "sweep a day's entry" pattern because each RFI
   has its own date and is low-volume enough to earn its own log line.

   Identity: `rfiKey` = `${scopeKey}::${safeKey(ref||subject)}` — scopeKey is the unit's
   safeKey(u.key) for unit-level rows, or the literal 'project' for project-level rows
   (F-032 Q4). kind:'rfi' keeps this entirely invisible to isUnitAutoEntry() (requires
   !kind || kind==='unit') and to upsertGlassLog's kind==='glass' check — no risk of the
   two existing projection engines rewriting or sweeping these entries.

   Legacy migration: before this existed, saveUnit() pushed a bare `{date, category:
   'gc-inquiry', categories:['gc-inquiry'], content}` entry once, when an RFI row was
   first created — no `auto`, no `kind`, no `rfiKey`. On first encounter for a given
   row, adopt that legacy entry in place (stamp kind/rfiKey onto it) instead of creating
   a second one alongside it. Adoption match: same category, no kind yet, and content
   contains " RFI <ref> " (or, if the row has no ref, contains the subject). */
function _rfiLogMatchKey(ref, subject) {
  const k = String(ref || subject || '').trim();
  return k ? safeKey(k.toLowerCase()) : '';
}
function upsertRfiLog(scopeKey, ownerLabel, row) {
  if (!Array.isArray(state.log)) state.log = Object.values(state.log || {});
  const mk = _rfiLogMatchKey(row.ref, row.subject);
  if (!mk) return; // nothing identifying to key off of — skip (mirrors readRfiRows' own filter)
  const rfiKey = scopeKey + '::' + mk;

  let entry = state.log.find(l => l && l.kind === 'rfi' && l.rfiKey === rfiKey);

  if (!entry) {
    // Try to adopt a pre-F-032 legacy entry instead of creating a duplicate.
    const needle = row.ref ? ('RFI ' + row.ref) : (row.subject || '');
    entry = state.log.find(l =>
      l && !l.kind &&
      (l.category === 'gc-inquiry' || (Array.isArray(l.categories) && l.categories.indexOf('gc-inquiry') !== -1)) &&
      needle && String(l.content || '').indexOf(needle) !== -1
    );
    if (entry) {
      entry.kind = 'rfi';
      entry.rfiKey = rfiKey;
      entry.auto = true;
    }
  }

  if (!entry) {
    entry = { kind: 'rfi', rfiKey: rfiKey, auto: true, category: 'gc-inquiry', categories: ['gc-inquiry'] };
    state.log.push(entry);
  }

  entry.date = row.date || entry.date || new Date().toISOString().slice(0,10);
  entry.category = 'gc-inquiry';
  entry.categories = ['gc-inquiry'];
  entry.content = `${ownerLabel} · RFI ${row.ref||''} ${row.subject||''} · [${row.status||'open'}]${row.party ? ' · '+row.party : ''}${row.relatedUnits ? ' · affects: '+row.relatedUnits : ''}`.replace(/\s+/g,' ').trim();
  if (row.ref)   entry.ref   = row.ref;   else delete entry.ref;
  if (row.party) entry.party = row.party; else delete entry.party;
}

/* Remove log entries whose rfiKey belongs to `scopeKey` but is no longer present in
   `currentRows` (handles a deleted RFI row leaving an orphaned log line behind). */
function sweepOrphanRfiLogs(scopeKey, currentRows) {
  if (!Array.isArray(state.log)) return;
  const validKeys = new Set(
    (currentRows || []).map(r => scopeKey + '::' + _rfiLogMatchKey(r.ref, r.subject)).filter(k => k !== scopeKey + '::')
  );
  const prefix = scopeKey + '::';
  for (let i = state.log.length - 1; i >= 0; i--) {
    const l = state.log[i];
    if (l && l.kind === 'rfi' && typeof l.rfiKey === 'string' && l.rfiKey.indexOf(prefix) === 0 && !validKeys.has(l.rfiKey)) {
      state.log.splice(i, 1);
    }
  }
}
