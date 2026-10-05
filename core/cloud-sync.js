/* ============================================================
   CP2 Cloud Sync — Firebase Auth + Realtime DB
   ============================================================
   What this does:
   - Gates the whole app behind a Firebase Auth login (email/password).
     Only emails you create in the Firebase Console can sign in.
   - Mirrors `window.state` into Firebase Realtime DB at /state.
     When anyone saves, every other open browser updates within ~1s.
   - Writes a row to /history every save (who, when, what).
   - Last write wins. No locking, no merge — the simple model.

   AF Hub (2026-10): every project has its OWN database inside the shared
   af-hub Firebase, and one login works for every project. Before reading or
   writing anything this file checks that the database's /meta/project equals
   PROJECT.hubId, and stamps every save with _project, which the database rules
   compare again on the server. A page pointed at the wrong database therefore
   stops with a red message instead of overwriting another project.

   How it plugs in:
   - The HTML calls window.CloudSync.init(firebaseConfig) at startup.
   - Existing code keeps calling saveState() — that triggers a push
     via a monkey-patch added at the bottom of this file.
   - Remote changes call window._cloudApplyRemoteState(remoteState)
     which replaces window.state and re-renders.
   ============================================================ */

(() => {
  // Unique per browser tab — used to ignore our own echo from Firebase.
  const CLIENT_ID = Math.random().toString(36).slice(2, 10);

  let auth = null;
  let db = null;
  let currentUser = null;

  let suppressNextSave = false;   // true while applying a remote snapshot (don't push it back)
  let pendingState = null;         // debounced push buffer
  let pushTimer = null;
  let lastDescription = null;      // optional description passed to next push (for history)

  // Read-only mode: user is signed in but not in the /allowlist node.
  // We detect this via a permission_denied error on the first state read
  // (or on the presence write). When true, any saveState() attempt is
  // intercepted: we toast the user and revert local state to the last
  // known cloud snapshot.
  let isReadOnly = false;
  let lastRemoteSnapshot = null;   // last good remote state (for revert)

  /* ── Role (AF Hub project databases, 2026-10) ─────────────────────────────
     One login now opens every project the person belongs to, so "can sign in"
     no longer means "is on this project". The database rules decide who reads;
     the page only works out which board to show:
       editor — on /allowlist                                  → full edit
       gc     — on /gcList                                     → the GC's narrowed view, read-only
       viewer — on /viewers, or a verified @advfacade.com      → the FULL internal board, read-only
     Each person can read only their OWN entry in those lists. The old fail-open
     rule ("no /gcList yet → every non-editor is the GC") is gone: a missing entry
     simply means "not that". */
  let role = null;                 // 'editor' | 'gc' | 'viewer', once resolved
  let projectOk = false;           // /meta/project matched PROJECT.hubId for this sign-in
  let roleSeq = 0;                 // ignores answers that arrive after a sign-out/sign-in

  /* Firebase paths cannot hold a '.', and the rules key on
     auth.token.email.replace('.', ','), whose replace is GLOBAL. Match it exactly:
     a single-dot replace looks right for leo@af.com and silently misses
     leo.sun@af.com — which is the shape of most of these addresses. */
  function emailKey(email) { return String(email || '').replace(/\./g, ','); }
  function isPermissionError(err) {
    return !!(err && (err.code === 'PERMISSION_DENIED' || /permission/i.test(err.message || '')));
  }

  function resolveRole() {
    const seq = ++roleSeq;
    if (!currentUser || !db) { role = null; return Promise.resolve(null); }
    const k = emailKey(currentUser.email);
    const has = (node) => db.ref(node + '/' + k).once('value').then(s => s.exists(), () => false);
    return has('allowlist').then(function (ed) {
      if (ed) return 'editor';
      return has('gcList').then(function (gc) { return gc ? 'gc' : 'viewer'; });
    }).then(function (r) {
      if (seq !== roleSeq) return role;
      role = r;
      if (r !== 'editor') enterReadOnlyMode(r === 'gc' ? 'General contractor — read-only' : 'View only — ask an admin for edit access');
      /* The GC-only narrowing in app.js keys off _isGC(), and this resolves AFTER the
         first paint, so poke the app to re-apply now that the answer is known. */
      try { if (typeof window._onReadOnly === 'function') window._onReadOnly(); } catch (e) {}
      return r;
    });
  }

  /* The database has to say it belongs to THIS page's project before anything is
     read into the app or written back. /meta is written once by the hub's
     migration / new-project workflow and no page can change it. */
  function checkProject() {
    const want = (window.PROJECT || {}).hubId;
    if (!want) return Promise.resolve({ ok: false, kind: 'config', detail: 'project-config.js has no hubId' });
    return db.ref('meta/project').once('value').then(function (snap) {
      const got = snap.val();
      if (got == null) return { ok: false, kind: 'unset', detail: 'this database has not been set up for a project (no /meta/project)' };
      if (got !== want) return { ok: false, kind: 'mismatch', detail: 'this page is "' + want + '" but the database belongs to "' + got + '"' };
      return { ok: true };
    }, function (err) {
      if (isPermissionError(err)) return { ok: false, kind: 'no-access' };
      return { ok: false, kind: 'error', detail: (err && err.message) || String(err) };
    });
  }

  // ---------- Public API ----------
  window.CloudSync = {
    init(config) {
      if (!config || !config.apiKey || /PASTE|YOUR_|XXXXX/i.test(config.apiKey)) {
        showSetupBanner();
        return;
      }
      try {
        firebase.initializeApp(config);
      } catch (e) {
        if (!/already exists/.test(e.message)) console.error(e);
      }
      auth = firebase.auth();
      db = firebase.database();
      auth.onAuthStateChanged(onAuthChanged);
      buildAuthGate();
    },
    // Call this RIGHT BEFORE saveState() to label the change.
    // e.g. CloudSync.describe('Updated SF06N → installed')
    describe(text) { lastDescription = text; },
    // Force-flush any pending push immediately
    flush() { if (pushTimer) { clearTimeout(pushTimer); pushTimer = null; flushPush(); } },
    isSignedIn() { return !!currentUser; },
    currentUser() { return currentUser; },
    isReadOnly() { return isReadOnly; },
    role() { return role; },
    isGC() { return role === 'gc'; },
    projectId() { return (window.PROJECT || {}).hubId || null; },
    logout() { if (auth) auth.signOut(); },
    openHistory() { openHistoryPanel(); },

    /* ---- F-037: GC inbox (/gcItems) ----
       /state stays editor-only, so read-only (GC) accounts write here instead: an
       append-only node any signed-in user can add their OWN entries to, and only
       allowlist editors can update/delete. The app mirrors it into window.GC_ITEMS. */
    submitGcItem(payload) {
      if (!db) return Promise.reject(new Error('cloud not initialized'));
      if (!currentUser) return Promise.reject(new Error('not signed in'));
      const rec = Object.assign({}, payload || {}, {
        by: currentUser.email,
        // Only an account actually on /gcList may stamp an item as coming from the GC.
        source: (role === 'gc') ? 'gc' : 'af',
        ts: firebase.database.ServerValue.TIMESTAMP,
      });
      Object.keys(rec).forEach(k => { if (rec[k] === undefined || rec[k] === '') delete rec[k]; });
      if (!rec.text) return Promise.reject(new Error('empty'));
      return db.ref('gcItems').push(rec).then(r => r.key);
    },
    updateGcItem(id, patch) {
      if (!db || !id) return Promise.reject(new Error('cloud not initialized'));
      return db.ref('gcItems/' + id).update(patch || {});
    },
    removeGcItem(id) {
      if (!db || !id) return Promise.reject(new Error('cloud not initialized'));
      return db.ref('gcItems/' + id).remove();
    },
  };

  // ---------- Auth gate UI ----------
  function buildAuthGate() {
    if (document.getElementById('cs-auth-gate')) return;
    const gate = document.createElement('div');
    gate.id = 'cs-auth-gate';
    gate.innerHTML = `
      <div class="cs-auth-card">
        <div class="cs-auth-brand">
          <div class="cs-auth-logo">${(window.PROJECT || {}).code || ""}</div>
          <div>
            <div class="cs-auth-title">${(window.PROJECT || {}).name || "Installation Tracker"}</div>
            <div class="cs-auth-sub">Installation Progress Monitor</div>
          </div>
        </div>
        <form id="cs-auth-form" autocomplete="on">
          <label>
            <span>Email</span>
            <input type="email" id="cs-email" required autocomplete="email" placeholder="you@advfacade.com">
          </label>
          <label>
            <span>Password</span>
            <input type="password" id="cs-password" required autocomplete="current-password">
          </label>
          <div id="cs-auth-error" class="cs-auth-error"></div>
          <button type="submit" id="cs-auth-submit">Sign in</button>
          <button type="button" id="cs-auth-forgot">First time here / forgot password</button>
        </form>
        <div id="cs-auth-msg" class="cs-auth-msg" style="display:none"></div>
        <div class="cs-auth-foot">
          One account for every AF project. Accounts are set up by your admin —<br>
          first time? Enter your email and tap <b>First time here</b> to set a password.
        </div>
      </div>
      <div class="cs-auth-bg"></div>
    `;
    document.body.appendChild(gate);

    /* The hub's Open ↗ passes the already-signed-in address as #u=... — a fragment,
       so it never reaches a server or a referrer. Fill it in, then strip it from the
       address bar so it is not what gets bookmarked or pasted into chat. */
    try {
      const m = /[#&]u=([^&]*)/.exec(location.hash || '');
      if (m && m[1]) {
        const em = document.getElementById('cs-email');
        if (em) em.value = decodeURIComponent(m[1]);
        history.replaceState(null, '', location.pathname + location.search);
        const pw = document.getElementById('cs-password');
        if (pw) pw.focus();
      }
    } catch (e) {}

    document.getElementById('cs-auth-form').addEventListener('submit', async (e) => {
      e.preventDefault();
      const email = document.getElementById('cs-email').value.trim();
      const pwd   = document.getElementById('cs-password').value;
      const errEl = document.getElementById('cs-auth-error');
      const btn   = document.getElementById('cs-auth-submit');
      errEl.textContent = '';
      btn.disabled = true; btn.textContent = 'Signing in…';
      try {
        await auth.signInWithEmailAndPassword(email, pwd);
      } catch (err) {
        errEl.textContent = humanAuthError(err);
        btn.disabled = false; btn.textContent = 'Sign in';
      }
    });
    document.getElementById('cs-auth-forgot').addEventListener('click', async () => {
      const email = document.getElementById('cs-email').value.trim();
      const errEl = document.getElementById('cs-auth-error');
      if (!email) { errEl.textContent = 'Enter your email first.'; return; }
      try {
        await auth.sendPasswordResetEmail(email);
        errEl.style.color = '#3fb950';
        errEl.textContent = `Email sent to ${email} — open the link in it to set your password, then sign in here.`;
      } catch (err) {
        errEl.style.color = '';
        errEl.textContent = humanAuthError(err);
      }
    });
  }

  function humanAuthError(err) {
    const code = (err && err.code) || '';
    if (code.includes('user-not-found') || code.includes('wrong-password') || code.includes('invalid-credential') || code.includes('invalid-login'))
      return 'Wrong email or password.';
    if (code.includes('too-many-requests'))
      return 'Too many attempts. Wait a few minutes.';
    if (code.includes('network'))
      return 'Network error. Check your connection.';
    if (code.includes('user-disabled'))
      return 'This account has been disabled.';
    return (err && err.message) || 'Sign-in failed.';
  }

  /* A message in the gate card instead of the sign-in form: email not verified yet,
     no access to this project, or this page and its database disagree. The app
     underneath stays locked and nothing is read from or written to the database. */
  function showGateMessage(html, buttons) {
    showAuthGate();
    const form = document.getElementById('cs-auth-form');
    const msg = document.getElementById('cs-auth-msg');
    if (!msg) return;
    if (form) form.style.display = 'none';
    msg.style.display = '';
    msg.innerHTML = '<div class="cs-auth-msg-body">' + html + '</div>' +
      '<div class="cs-auth-msg-actions">' + (buttons || []).map(function (b, i) {
        return '<button type="button" data-i="' + i + '"' + (b.primary ? ' class="primary"' : '') + '>' + escapeHtml(b.label) + '</button>';
      }).join('') + '</div><div class="cs-auth-msg-note"></div>';
    msg.querySelectorAll('button[data-i]').forEach(function (el) {
      el.addEventListener('click', function () {
        const b = buttons[+el.dataset.i];
        Promise.resolve().then(function () { return b.run(msg.querySelector('.cs-auth-msg-note')); })
          .catch(function (e) { const n = msg.querySelector('.cs-auth-msg-note'); if (n) n.textContent = humanAuthError(e); });
      });
    });
  }
  function hideGateMessage() {
    const form = document.getElementById('cs-auth-form');
    const msg = document.getElementById('cs-auth-msg');
    if (form) form.style.display = '';
    if (msg) { msg.style.display = 'none'; msg.innerHTML = ''; }
  }
  function signOutButton() { return { label: 'Sign out', run: function () { return auth.signOut(); } }; }

  function showVerifyStep(user) {
    showGateMessage(
      '<b>Confirm your email first.</b><br>Signed in as ' + escapeHtml(user.email) +
      '. We send a link to that address once; after you open it, this account works on every project you are added to.',
      [{ label: 'Send the link', primary: true, run: function (note) {
          return user.sendEmailVerification().then(function () { note.textContent = 'Sent to ' + user.email + '. Open it, then tap "I opened the link".'; });
        } },
       { label: 'I opened the link', run: function (note) {
          return user.reload().then(function () { return user.getIdToken(true); }).then(function () {
            if (auth.currentUser && auth.currentUser.emailVerified) onAuthChanged(auth.currentUser);
            else note.textContent = 'Not confirmed yet — open the newest email from Firebase and try again.';
          });
        } },
       signOutButton()]);
  }

  function showBlocked(check, user) {
    const P = window.PROJECT || {};
    if (check.kind === 'no-access') {
      showGateMessage('<b>No access to ' + escapeHtml(P.name || 'this project') + '.</b><br>Signed in as ' + escapeHtml(user.email) +
        '. Ask Leo or the project PM to add this email to the project.',
        [{ label: 'All projects', run: function () { location.href = '../'; } }, signOutButton()]);
      return;
    }
    console.error('[CloudSync] project check failed:', check);
    showGateMessage('<b style="color:#f85149">Stopped: this page and its database do not match.</b><br>' +
      escapeHtml(check.detail || check.kind) + '.<br>Nothing was read or saved. Send this message to Leo.',
      [signOutButton()]);
  }

  function showAuthGate() {
    const g = document.getElementById('cs-auth-gate');
    if (g) g.style.display = 'flex';
    document.body.classList.add('cs-locked');
  }
  function hideAuthGate() {
    const g = document.getElementById('cs-auth-gate');
    if (g) g.style.display = 'none';
    document.body.classList.remove('cs-locked');
  }
  function showFatal(msg) {
    const div = document.createElement('div');
    div.className = 'cs-fatal';
    div.textContent = msg;
    document.body.appendChild(div);
  }

  function showSetupBanner() {
    if (document.getElementById('cs-setup-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'cs-setup-banner';
    bar.innerHTML = `
      <div class="cs-setup-inner">
        <span class="cs-setup-icon">⚙</span>
        <div class="cs-setup-body">
          <strong>Cloud sync not configured yet</strong>
          <span>Running in local-only mode. Open <code>firebase-config.js</code> and paste your Firebase project keys to enable team sync. See <code>SETUP.md</code>.</span>
        </div>
        <button class="cs-setup-dismiss">Dismiss</button>
      </div>
    `;
    document.body.appendChild(bar);
    bar.querySelector('.cs-setup-dismiss').addEventListener('click', () => bar.remove());
  }

  // ---------- Auth state changes ----------
  function onAuthChanged(user) {
    currentUser = user;
    projectOk = false;
    if (user) {
      if (!user.emailVerified) { showVerifyStep(user); return; }
      checkProject().then(function (check) {
        if (currentUser !== user) return;            // signed out / switched meanwhile
        if (!check.ok) { showBlocked(check, user); return; }
        projectOk = true;
        hideGateMessage();
        hideAuthGate();
        mountStatusBadge();
        updateBadge();
        subscribeToState();
        subscribeToPresence();
        subscribeToGcItems();
        resolveRole();
      });
    } else {
      // Clear read-only flag + banner so the next sign-in starts clean.
      isReadOnly = false;
      role = null; roleSeq++;
      hideGateMessage();
      lastRemoteSnapshot = null;
      hideReadOnlyBanner();
      unmountStatusBadge();
      showAuthGate();
      // Stop listening (Firebase auto-unsubs when ref handle is dropped, but be defensive)
      if (db) try { db.ref('state').off(); } catch(e){}
      if (db) try { db.ref('gcItems').off(); } catch(e){}
      window.GC_ITEMS = [];
    }
  }

  // ---------- Header status badge ----------
  function mountStatusBadge() {
    if (document.getElementById('cs-status')) return;
    const actions = document.querySelector('.header-actions');
    if (!actions) return;
    const wrap = document.createElement('div');
    wrap.id = 'cs-status';
    wrap.className = 'cs-status';
    wrap.innerHTML = `
      <button class="cs-status-btn" id="cs-history-btn" title="View edit history">
        <span class="cs-dot" id="cs-conn-dot"></span>
        <span class="cs-status-text" id="cs-status-text">Connecting…</span>
      </button>
      <div class="cs-user-menu">
        <button class="cs-user-btn" id="cs-user-btn">
          <span class="cs-user-avatar" id="cs-user-avatar"></span>
          <span class="cs-user-email" id="cs-user-email"></span>
          <span class="cs-caret">▾</span>
        </button>
        <div class="cs-user-dropdown" id="cs-user-dropdown">
          <button data-action="history">📜 Edit history</button>
          <button data-action="presence">👥 Who's online</button>
          <button data-action="logout">↪ Sign out</button>
        </div>
      </div>
    `;
    // Insert at the start of header-actions (left of the lang switcher)
    actions.insertBefore(wrap, actions.firstChild);

    document.getElementById('cs-history-btn').addEventListener('click', openHistoryPanel);
    const userBtn = document.getElementById('cs-user-btn');
    const dropdown = document.getElementById('cs-user-dropdown');
    /* F-047 (Leo, 2026-08-05 — menu was half cut off on a phone): on mobile the host page
       makes .header-actions horizontally scrollable, and an `overflow` ancestor clips an
       absolutely-positioned child. The header also uses backdrop-filter, which makes it the
       containing block for `position:fixed` descendants — so simply switching to fixed is
       not enough either. Move the menu to <body> and place it from the button's screen
       rect: nothing can clip it, on any host layout. */
    document.body.appendChild(dropdown);
    const placeDropdown = () => {
      const r = userBtn.getBoundingClientRect();
      const w = dropdown.offsetWidth || 200;
      const vw = document.documentElement.clientWidth;
      const vh = document.documentElement.clientHeight;
      const left = Math.max(8, Math.min(r.right - w, vw - w - 8));
      // Flip above the button if there genuinely isn't room below (short landscape phones).
      const h = dropdown.offsetHeight || 140;
      const below = r.bottom + 6;
      const top = (below + h > vh - 8 && r.top - h - 6 > 8) ? (r.top - h - 6) : Math.min(below, vh - h - 8);
      dropdown.style.left = Math.round(left) + 'px';
      dropdown.style.top = Math.round(top) + 'px';
    };
    userBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      const opening = !dropdown.classList.contains('open');
      if (opening) placeDropdown();
      dropdown.classList.toggle('open');
    });
    window.addEventListener('resize', () => { if (dropdown.classList.contains('open')) placeDropdown(); });
    window.addEventListener('scroll', () => { if (dropdown.classList.contains('open')) placeDropdown(); }, true);
    document.addEventListener('click', () => dropdown.classList.remove('open'));
    dropdown.addEventListener('click', (e) => {
      const action = e.target.dataset.action;
      dropdown.classList.remove('open');
      if (action === 'history') openHistoryPanel();
      if (action === 'presence') openPresencePanel();
      if (action === 'logout') auth.signOut();
    });
  }
  function unmountStatusBadge() {
    const el = document.getElementById('cs-status');
    if (el) el.remove();
  }
  function updateBadge() {
    if (!currentUser) return;
    const email = currentUser.email || '';
    const emailEl = document.getElementById('cs-user-email');
    const avEl = document.getElementById('cs-user-avatar');
    if (emailEl) emailEl.textContent = email.split('@')[0];
    if (avEl) {
      avEl.textContent = (email[0] || '?').toUpperCase();
      avEl.style.background = colorFromEmail(email);
    }
  }
  function setConnState(state) {
    const dot = document.getElementById('cs-conn-dot');
    const txt = document.getElementById('cs-status-text');
    if (!dot) return;
    dot.className = 'cs-dot ' + state;
    if (txt) {
      txt.textContent = state === 'live' ? 'Live' :
                        state === 'syncing' ? 'Syncing…' :
                        state === 'offline' ? 'Offline' : 'Connecting…';
    }
  }
  function colorFromEmail(email) {
    let h = 0;
    for (let i = 0; i < email.length; i++) h = (h * 31 + email.charCodeAt(i)) % 360;
    return `hsl(${h}, 55%, 45%)`;
  }

  // ---------- State sync ----------
  function subscribeToState() {
    setConnState('connecting');
    const stateRef = db.ref('state');

    // Connection indicator
    db.ref('.info/connected').on('value', (snap) => {
      setConnState(snap.val() ? 'live' : 'offline');
    });

    stateRef.on('value', (snap) => {
      const remote = snap.val();
      if (!remote) {
        // First time anyone has touched this project's database (its /meta was
        // checked above). Seed it with whatever local state we have so the team
        // has a starting point. Read-only accounts never seed.
        if (window.state && !isReadOnly) {
          pushNow(window.state, 'Initialized cloud state from local snapshot');
        }
        return;
      }
      // Stash the cloud snapshot so we can revert read-only users to it.
      const { _clientId, _ts, _by, _desc, _project, ...stateData } = remote;
      lastRemoteSnapshot = JSON.parse(JSON.stringify(stateData));

      // Our own echo — ignore.
      if (remote._clientId === CLIENT_ID) return;

      // Remote update from another client — replace local state.
      window._cloudApplyRemoteState(stateData, { by: _by, ts: _ts, desc: _desc });
    }, (err) => {
      console.error('Firebase state listen failed:', err);
      setConnState('offline');
      // PERMISSION_DENIED on /state means this account is not in /allowlist.
      // Flip into read-only mode so save attempts are blocked locally.
      if (err && (err.code === 'PERMISSION_DENIED' || /permission/i.test(err.message || ''))) {
        enterReadOnlyMode('Your account is not on the allowlist — read-only mode');
      }
    });
  }

  // ---------- GC inbox subscription (F-037) ----------
  // Mirrors /gcItems into window.GC_ITEMS (oldest first) and pokes the app to re-render.
  // If the rules haven't been published yet the listen just fails — GC_ITEMS stays empty
  // and everything else keeps working, so this is safe to ship ahead of the rules update.
  function subscribeToGcItems() {
    if (!db) return;
    try {
      db.ref('gcItems').limitToLast(300).on('value', (snap) => {
        const val = snap.val() || {};
        const list = Object.keys(val).map(k => Object.assign({ _id: k }, val[k]));
        list.sort((a, b) => (a.ts || 0) - (b.ts || 0));
        window.GC_ITEMS = list;
        try { if (typeof window._onGcItems === 'function') window._onGcItems(list); } catch (e) {}
      }, (err) => {
        console.warn('[CloudSync] gcItems listen failed (rules not published?):', err && err.message);
        window.GC_ITEMS = [];
      });
    } catch (e) { window.GC_ITEMS = []; }
  }

  // ---------- Read-only mode ----------
  function enterReadOnlyMode(reason) {
    if (isReadOnly) return;
    isReadOnly = true;
    console.warn('[CloudSync] read-only mode:', reason);
    showReadOnlyBanner(reason);
    // A write was refused while we thought this was an editor (removed from the
    // allowlist mid-session): work out gc vs viewer again.
    if (role === 'editor' || role === null) { role = 'viewer'; resolveRole(); }
    // Let the app hide editor-only controls the moment we know (F-033 v2).
    try { if (typeof window._onReadOnly === 'function') window._onReadOnly(); } catch (e) {}
    // Snapshot whatever the app currently has as the "good" baseline so
    // we have something to revert to even if we never got a cloud read.
    // (The HTML exposes its local `state` as `window.state` for this.)
    if (!lastRemoteSnapshot && window.state) {
      try {
        lastRemoteSnapshot = JSON.parse(JSON.stringify(window.state));
      } catch (e) {
        console.warn('[CloudSync] failed to snapshot baseline state:', e);
      }
    }
  }

  function showReadOnlyBanner(reason) {
    // Suppressed (Leo, 2026-07-23): the read-only strip is noise for GC viewers — they
    // already can't edit; the editor-only buttons are hidden for them via applyReadOnlyUI.
    return;
    if (document.getElementById('cs-readonly-banner')) return;
    const bar = document.createElement('div');
    bar.id = 'cs-readonly-banner';
    bar.innerHTML = `
      <span class="cs-ro-icon">🔒</span>
      <span class="cs-ro-text">${escapeHtml(reason || 'Read-only mode — you do not have edit permission')}</span>
      <span class="cs-ro-hint">Ask an admin to add your email to the allowlist if you need to edit.</span>
    `;
    document.body.appendChild(bar);
  }
  function hideReadOnlyBanner() {
    const el = document.getElementById('cs-readonly-banner');
    if (el) el.remove();
  }

  // Called by the HTML's monkey-patched saveState() — debounces ~350ms.
  window._cloudQueuePush = function(state, description) {
    if (suppressNextSave) return;       // applying a remote update, don't echo
    if (!currentUser) return;            // not signed in, nothing to push
    if (!projectOk) return;              // database not confirmed as this project's — never push

    // Read-only user — block the save and revert UI to the cloud snapshot.
    if (isReadOnly) {
      if (window.toast) window.toast('⚠ You do not have edit permission — changes were not saved');
      revertToCloudSnapshot();
      return;
    }

    pendingState = state;
    if (description) lastDescription = description;
    setConnState('syncing');
    if (pushTimer) clearTimeout(pushTimer);
    pushTimer = setTimeout(flushPush, 350);
  };

  function revertToCloudSnapshot() {
    if (!window._cloudApplyRemoteState) return;
    if (!lastRemoteSnapshot) {
      // We have no baseline at all (e.g. read-only user with no localStorage
      // history). Best we can do is warn — the UI will stay as-is until the
      // user reloads.
      console.warn('[CloudSync] cannot revert — no baseline snapshot. Reload to discard changes.');
      return;
    }
    // Deep-clone so the caller can't mutate our baseline by reference.
    const fresh = JSON.parse(JSON.stringify(lastRemoteSnapshot));
    window._cloudApplyRemoteState(fresh, { by: 'cloud', desc: '(reverted — no edit permission)' });
  }

  function flushPush() {
    pushTimer = null;
    if (!pendingState || !currentUser) return;
    const desc = lastDescription;
    lastDescription = null;
    pushNow(pendingState, desc);
    pendingState = null;
  }

  function pushNow(state, description) {
    if (!projectOk || !currentUser) return;
    const payload = Object.assign({}, state, {
      _clientId: CLIENT_ID,
      _ts: firebase.database.ServerValue.TIMESTAMP,
      _by: currentUser.email,
      _desc: description || null,
      _project: (window.PROJECT || {}).hubId,   // checked against /meta/project by the rules
    });
    db.ref('state').set(payload).then(() => {
      setConnState('live');
      // Push history record
      db.ref('history').push({
        ts: firebase.database.ServerValue.TIMESTAMP,
        user: currentUser.email,
        desc: description || 'edit',
        snapshot: summarizeState(state),
      }).catch((e) => console.warn('History push failed', e));
    }).catch((err) => {
      console.error('State push failed:', err);
      setConnState('offline');
      // PERMISSION_DENIED here means the user is not allowed to write —
      // either removed from /allowlist mid-session, or never was.
      // Flip to read-only and revert their local changes.
      if (err && (err.code === 'PERMISSION_DENIED' || /permission/i.test(err.message || ''))) {
        enterReadOnlyMode('Your account is not on the allowlist — read-only mode');
        if (window.toast) window.toast('⚠ You do not have edit permission — changes were not saved');
        revertToCloudSnapshot();
        return;
      }
      // Surface to user
      if (window.toast) window.toast('⚠ Cloud save failed: ' + err.message);
    });
  }

  // Short numeric summary written into each history row so the panel
  // can show "29 installed · 4 issues · 12 logs" without re-loading state.
  function summarizeState(s) {
    if (!s || !s.units) return null;
    const counts = { installed: 0, ready: 0, issue: 0, pending: 0 };
    s.units.forEach(u => { if (counts[u.status] != null) counts[u.status]++; });
    return {
      units: s.units.length,
      installed: counts.installed,
      issues: counts.issue,
      log: (s.log || []).length,
    };
  }

  // The HTML implements _cloudApplyRemoteState (defined in the inline script)
  // — but provide a fallback in case the hook isn't installed.
  if (!window._cloudApplyRemoteState) {
    window._cloudApplyRemoteState = function(stateData, meta) {
      suppressNextSave = true;
      try {
        window.state = stateData;
        if (typeof window.render === 'function') window.render();
        if (window.toast && meta && meta.by) {
          window.toast(`↻ Updated by ${meta.by.split('@')[0]}`);
        }
      } finally {
        suppressNextSave = false;
      }
    };
  }
  // Expose suppress flag for the HTML hook
  window._cloudSetSuppress = (v) => { suppressNextSave = !!v; };
  window._cloudIsSuppressed = () => suppressNextSave;

  // ---------- Presence (who's online) ----------
  let presenceRef = null;
  function subscribeToPresence() {
    if (!currentUser) return;
    const id = currentUser.uid;
    presenceRef = db.ref('presence/' + id);
    db.ref('.info/connected').on('value', (snap) => {
      if (snap.val() === true) {
        // F-033 pilot: append-only access log — one record per browser session so we can
        // see who has opened the tracker and when (opens/last-seen in the 📊 Usage panel).
        // Guarded by _accessLogged so a reconnect during the same session doesn't double-count.
        if (!window._accessLogged) {
          window._accessLogged = true;
          try {
            db.ref('access').push({
              email: currentUser.email,
              ts: firebase.database.ServerValue.TIMESTAMP,
              ua: (navigator.userAgent || '').slice(0, 120),
            }).catch(() => {}); // read-only viewers may be denied; ignore
          } catch (e) {}
        }
        presenceRef.onDisconnect().remove();
        presenceRef.set({
          email: currentUser.email,
          since: firebase.database.ServerValue.TIMESTAMP,
          clientId: CLIENT_ID,
        }).catch((err) => {
          // Writing presence failed → almost certainly not in /allowlist.
          // This is the fastest signal that this user is read-only.
          if (err && (err.code === 'PERMISSION_DENIED' || /permission/i.test(err.message || ''))) {
            enterReadOnlyMode('Your account is not on the allowlist — read-only mode');
          }
        });
      }
    });
  }

  function openPresencePanel() {
    openPanel('Who\'s online', async (body) => {
      body.innerHTML = '<div class="cs-panel-loading">Loading…</div>';
      db.ref('presence').once('value').then(snap => {
        const val = snap.val() || {};
        const users = Object.values(val);
        if (users.length === 0) {
          body.innerHTML = '<div class="cs-panel-empty">No one else online.</div>';
          return;
        }
        body.innerHTML = users.map(u => `
          <div class="cs-presence-row">
            <span class="cs-user-avatar" style="background:${colorFromEmail(u.email)}">${(u.email[0]||'?').toUpperCase()}</span>
            <span>${escapeHtml(u.email)}</span>
            <span class="cs-presence-since">since ${formatTime(u.since)}</span>
          </div>
        `).join('');
      });
    });
  }

  // ---------- History panel ----------
  function openHistoryPanel() {
    openPanel('Edit History', (body) => {
      body.innerHTML = '<div class="cs-panel-loading">Loading…</div>';
      db.ref('history').limitToLast(200).once('value').then(snap => {
        const val = snap.val() || {};
        const rows = Object.entries(val).map(([k, v]) => ({ k, ...v })).sort((a, b) => b.ts - a.ts);
        if (rows.length === 0) {
          body.innerHTML = '<div class="cs-panel-empty">No edits yet.</div>';
          return;
        }
        body.innerHTML = `
          <div class="cs-history-list">
            ${rows.map(r => `
              <div class="cs-history-row">
                <div class="cs-history-time">${formatDateTime(r.ts)}</div>
                <div class="cs-history-body">
                  <div class="cs-history-user">
                    <span class="cs-user-avatar sm" style="background:${colorFromEmail(r.user||'?')}">${((r.user||'?')[0]||'?').toUpperCase()}</span>
                    <span>${escapeHtml((r.user||'?').split('@')[0])}</span>
                  </div>
                  <div class="cs-history-desc">${escapeHtml(r.desc || 'edit')}</div>
                  ${r.snapshot ? `<div class="cs-history-snap">
                    ${r.snapshot.installed||0} installed · ${r.snapshot.issues||0} issues · ${r.snapshot.log||0} logs
                  </div>` : ''}
                </div>
              </div>
            `).join('')}
          </div>
        `;
      });
    });
  }

  function openPanel(title, fill) {
    closePanel();
    const overlay = document.createElement('div');
    overlay.className = 'cs-overlay';
    overlay.innerHTML = `
      <div class="cs-panel" role="dialog">
        <div class="cs-panel-head">
          <h3>${escapeHtml(title)}</h3>
          <button class="cs-panel-close" aria-label="Close">×</button>
        </div>
        <div class="cs-panel-body"></div>
      </div>
    `;
    document.body.appendChild(overlay);
    overlay.addEventListener('click', (e) => { if (e.target === overlay) closePanel(); });
    overlay.querySelector('.cs-panel-close').addEventListener('click', closePanel);
    fill(overlay.querySelector('.cs-panel-body'));
  }
  function closePanel() {
    document.querySelectorAll('.cs-overlay').forEach(el => el.remove());
  }

  // ---------- Helpers ----------
  function escapeHtml(s) {
    return String(s).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  }
  function formatDateTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleString();
  }
  function formatTime(ts) {
    if (!ts) return '';
    const d = new Date(ts);
    return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  // ---------- Styles ----------
  const css = document.createElement('style');
  css.textContent = `
    body.cs-locked { overflow: hidden; }
    body.cs-locked > *:not(#cs-auth-gate) { filter: blur(8px); pointer-events: none; user-select: none; }

    #cs-auth-gate {
      position: fixed; inset: 0; z-index: 99999;
      display: flex; align-items: center; justify-content: center;
      background: rgba(15, 20, 25, 0.85);
      backdrop-filter: blur(12px);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      color: #e6edf3;
    }
    .cs-auth-bg {
      position: absolute; inset: 0; z-index: -1;
      background:
        radial-gradient(60% 60% at 30% 30%, rgba(68,147,248,0.18), transparent 70%),
        radial-gradient(50% 50% at 70% 70%, rgba(188,140,255,0.12), transparent 70%),
        #0f1419;
    }
    .cs-auth-card {
      background: rgba(26, 32, 40, 0.96);
      border: 1px solid #2d3744;
      border-radius: 16px;
      padding: 32px;
      width: 380px; max-width: calc(100vw - 24px);
      max-height: calc(100vh - 24px);
      overflow-y: auto;
      -webkit-overflow-scrolling: touch;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    @media (max-width: 480px) {
      #cs-auth-gate {
        padding: max(16px, env(safe-area-inset-top)) 12px
                 max(16px, env(safe-area-inset-bottom)) 12px;
        align-items: flex-start;
      }
      .cs-auth-card { padding: 20px 18px; border-radius: 14px; width: 100%; }
      .cs-auth-brand { margin-bottom: 18px; gap: 12px; }
      .cs-auth-logo { width: 42px; height: 42px; }
      .cs-auth-title { font-size: 16px; }
      #cs-auth-form label { margin-bottom: 12px; }
      #cs-auth-form input { font-size: 16px; padding: 11px 12px; }   /* 16px prevents iOS zoom-on-focus */
      #cs-auth-submit { padding: 13px; font-size: 15px; }
      .cs-auth-foot { margin-top: 16px; padding-top: 14px; }
    }
    .cs-auth-brand { display: flex; gap: 14px; align-items: center; margin-bottom: 24px; }
    .cs-auth-logo {
      width: 48px; height: 48px; border-radius: 12px;
      background: linear-gradient(135deg, #4493f8, #bc8cff);
      display: flex; align-items: center; justify-content: center;
      font-weight: 700; font-size: 15px; letter-spacing: 0.5px;
    }
    .cs-auth-title { font-size: 17px; font-weight: 600; }
    .cs-auth-sub { font-size: 12px; color: #8b949e; margin-top: 2px; }
    #cs-auth-form label { display: block; margin-bottom: 14px; }
    #cs-auth-form label span { display: block; font-size: 12px; color: #8b949e; margin-bottom: 6px; }
    #cs-auth-form input {
      width: 100%; padding: 10px 12px;
      background: #0f1419; color: #e6edf3;
      border: 1px solid #2d3744; border-radius: 8px;
      font-size: 14px; font-family: inherit;
      transition: border-color 0.15s;
    }
    #cs-auth-form input:focus { outline: none; border-color: #4493f8; }
    #cs-auth-submit {
      width: 100%; margin-top: 8px; padding: 11px;
      background: #4493f8; color: white; border: none; border-radius: 8px;
      font-size: 14px; font-weight: 600; font-family: inherit;
      cursor: pointer; transition: background 0.15s;
    }
    #cs-auth-submit:hover:not(:disabled) { background: #58a6ff; }
    #cs-auth-submit:disabled { opacity: 0.6; cursor: not-allowed; }
    #cs-auth-forgot {
      width: 100%; margin-top: 8px; padding: 8px;
      background: transparent; color: #8b949e; border: none;
      font-size: 12px; cursor: pointer; font-family: inherit;
    }
    #cs-auth-forgot:hover { color: #58a6ff; }
    .cs-auth-error {
      min-height: 18px; margin-bottom: 8px;
      font-size: 12px; color: #f85149;
    }
    .cs-auth-foot {
      margin-top: 24px; padding-top: 20px;
      border-top: 1px solid #2d3744;
      font-size: 11px; color: #8b949e; line-height: 1.5;
    }

    /* Header badge */
    .cs-status {
      display: flex; align-items: center; gap: 8px;
      margin-right: 6px;
    }
    .cs-status-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: #1a2028; border: 1px solid #2d3744;
      color: #e6edf3; padding: 6px 10px; border-radius: 8px;
      font-size: 12px; cursor: pointer; font-family: inherit;
    }
    .cs-status-btn:hover { background: #232b36; }
    .cs-dot {
      width: 8px; height: 8px; border-radius: 50%;
      background: #8b949e;
      box-shadow: 0 0 0 0 currentColor;
    }
    .cs-dot.live { background: #3fb950; box-shadow: 0 0 8px rgba(63,185,80,0.5); }
    .cs-dot.syncing { background: #d29922; animation: cs-pulse 1s infinite; }
    .cs-dot.offline { background: #f85149; }
    .cs-dot.connecting { background: #8b949e; animation: cs-pulse 1.5s infinite; }
    @keyframes cs-pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }

    .cs-user-menu { position: relative; }
    .cs-user-btn {
      display: inline-flex; align-items: center; gap: 6px;
      background: #1a2028; border: 1px solid #2d3744;
      color: #e6edf3; padding: 4px 10px 4px 4px; border-radius: 999px;
      font-size: 12px; cursor: pointer; font-family: inherit;
    }
    .cs-user-btn:hover { background: #232b36; }
    .cs-user-avatar {
      width: 22px; height: 22px; border-radius: 50%;
      display: inline-flex; align-items: center; justify-content: center;
      color: white; font-size: 11px; font-weight: 600;
    }
    .cs-user-avatar.sm { width: 18px; height: 18px; font-size: 9px; }
    .cs-user-email { max-width: 100px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .cs-caret { font-size: 9px; color: #8b949e; }
    .cs-user-dropdown {
      /* Placed from script against the button's screen rect (F-047) — it lives on <body>,
         so no scrolling/overflow ancestor in the host page can clip it. */
      position: fixed; top: 0; left: 0;
      min-width: 200px; max-width: calc(100vw - 16px);
      background: #1a2028; border: 1px solid #2d3744; border-radius: 8px;
      padding: 4px; box-shadow: 0 8px 24px rgba(0,0,0,0.4);
      opacity: 0; pointer-events: none; transform: translateY(-4px);
      transition: opacity 0.12s, transform 0.12s;
      z-index: 10000;   /* above the sticky header (100) and its stacking context */
    }
    .cs-user-dropdown.open { opacity: 1; pointer-events: auto; transform: translateY(0); }
    .cs-user-dropdown button {
      display: block; width: 100%; text-align: left;
      background: none; border: none; color: #e6edf3;
      padding: 8px 12px; border-radius: 5px;
      font-size: 13px; cursor: pointer; font-family: inherit;
      white-space: nowrap;
    }
    /* Finger-sized rows on touch screens — the menu is only ever three items. */
    @media (max-width: 720px) {
      .cs-user-dropdown { min-width: 214px; padding: 6px; }
      .cs-user-dropdown button { padding: 12px 14px; font-size: 14px; }
    }
    .cs-user-dropdown button:hover { background: #232b36; }

    /* Panels */
    .cs-overlay {
      position: fixed; inset: 0; z-index: 9999;
      background: rgba(0,0,0,0.55); backdrop-filter: blur(4px);
      display: flex; align-items: center; justify-content: center;
      padding: 20px;
      font-family: inherit;
    }
    .cs-panel {
      background: #1a2028; border: 1px solid #2d3744; border-radius: 12px;
      width: 580px; max-width: 100%; max-height: 80vh;
      display: flex; flex-direction: column;
      box-shadow: 0 20px 60px rgba(0,0,0,0.5);
    }
    .cs-panel-head {
      display: flex; justify-content: space-between; align-items: center;
      padding: 16px 20px; border-bottom: 1px solid #2d3744;
    }
    .cs-panel-head h3 { font-size: 15px; font-weight: 600; margin: 0; color: #e6edf3; }
    .cs-panel-close {
      background: none; border: none; color: #8b949e;
      font-size: 22px; cursor: pointer; padding: 0 8px; line-height: 1;
    }
    .cs-panel-close:hover { color: #e6edf3; }
    .cs-panel-body {
      padding: 16px 20px; overflow-y: auto;
      color: #e6edf3; font-size: 13px;
    }
    .cs-panel-loading, .cs-panel-empty {
      padding: 40px 20px; text-align: center;
      color: #8b949e; font-size: 13px;
    }
    .cs-history-list { display: flex; flex-direction: column; gap: 2px; }
    .cs-history-row {
      display: grid; grid-template-columns: 140px 1fr;
      gap: 14px; padding: 10px 4px;
      border-bottom: 1px solid #232b36;
    }
    .cs-history-row:last-child { border-bottom: none; }
    .cs-history-time { font-size: 11px; color: #8b949e; padding-top: 2px; }
    .cs-history-user { display: flex; align-items: center; gap: 6px; font-size: 12px; color: #8b949e; }
    .cs-history-desc { margin-top: 4px; font-size: 13px; color: #e6edf3; }
    .cs-history-snap { margin-top: 2px; font-size: 11px; color: #8b949e; }
    .cs-presence-row {
      display: flex; align-items: center; gap: 10px;
      padding: 10px 4px; border-bottom: 1px solid #232b36;
      font-size: 13px;
    }
    .cs-presence-since { margin-left: auto; font-size: 11px; color: #8b949e; }

    .cs-auth-msg { font-size: 14px; line-height: 1.55; color: #c9d1d9; }
    .cs-auth-msg b { color: #e6edf3; }
    .cs-auth-msg-actions { display: flex; flex-wrap: wrap; gap: 8px; margin-top: 16px; }
    .cs-auth-msg-actions button {
      flex: 1 1 auto; padding: 10px 12px; border-radius: 8px; cursor: pointer;
      border: 1px solid #2d3744; background: #21262d; color: #e6edf3; font: inherit; font-size: 13px;
    }
    .cs-auth-msg-actions button.primary { background: #4493f8; border-color: #4493f8; color: #fff; font-weight: 600; }
    .cs-auth-msg-note { margin-top: 10px; font-size: 12px; color: #3fb950; min-height: 1em; }
    .cs-fatal {
      position: fixed; top: 20px; left: 50%; transform: translateX(-50%);
      z-index: 999999;
      background: #f85149; color: white; padding: 12px 20px;
      border-radius: 8px; font-family: -apple-system, sans-serif; font-size: 13px;
    }

    #cs-setup-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99998;
      background: linear-gradient(90deg, #d29922, #ff8c42);
      color: #1a1a1a; font-family: -apple-system, sans-serif;
      box-shadow: 0 4px 12px rgba(0,0,0,0.3);
    }
    .cs-setup-inner {
      max-width: 1100px; margin: 0 auto;
      display: flex; align-items: center; gap: 14px;
      padding: 10px 20px;
    }
    .cs-setup-icon { font-size: 20px; }
    .cs-setup-body { flex: 1; display: flex; flex-direction: column; gap: 2px; font-size: 12px; }
    .cs-setup-body strong { font-size: 13px; }
    .cs-setup-body code { background: rgba(0,0,0,0.15); padding: 1px 5px; border-radius: 3px; font-size: 11px; }
    .cs-setup-dismiss {
      background: rgba(0,0,0,0.15); border: none; color: #1a1a1a;
      padding: 6px 12px; border-radius: 6px; cursor: pointer;
      font-size: 12px; font-weight: 500; font-family: inherit;
    }
    .cs-setup-dismiss:hover { background: rgba(0,0,0,0.25); }

    /* Read-only banner — shown at the top when user is not in /allowlist */
    #cs-readonly-banner {
      position: fixed; top: 0; left: 0; right: 0; z-index: 99997;
      background: linear-gradient(90deg, #5a4a3a, #3d2f24);
      color: #fde8d0;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      font-size: 12px;
      padding: 8px 20px;
      display: flex; align-items: center; gap: 10px;
      box-shadow: 0 2px 8px rgba(0,0,0,0.4);
      border-bottom: 1px solid rgba(232, 93, 31, 0.4);
    }
    #cs-readonly-banner .cs-ro-icon { font-size: 14px; }
    #cs-readonly-banner .cs-ro-text { font-weight: 600; color: #fff; }
    #cs-readonly-banner .cs-ro-hint { color: #c9b9a3; font-size: 11px; }
    @media (max-width: 720px) {
      #cs-readonly-banner .cs-ro-hint { display: none; }
    }

    @media (max-width: 720px) {
      .cs-user-email { display: none; }
      .cs-status-text { display: none; }
    }
  `;
  document.head.appendChild(css);

})();
