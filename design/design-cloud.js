/* ============================================================
   AF Design Board — sign-in and database access.
   ------------------------------------------------------------
   Same login as every tracker (Firebase project af-hub-8f188).
   Before anything is read or written, the page checks that the
   database it is pointed at says it is the design database
   (/meta/project = "design"); otherwise it stops.

   Who opens which board (Leo 10-20; platform/design-database.rules.json):
     design team = on /allowlist          -> edits every board
     viewer      = on /viewers            -> reads every board
     boss        = custom claim boss      -> reads every board
     PM          = on /members/<board>    -> "editor" or "viewer" of THAT board only
   A company address alone opens no board.
   DC.boardRoles has only the boards this person can open; DC.useBoard(id)
   sets DC.role for the board on screen, and DC.isEditor() answers for it.
   Exposes window.DC; design-app.js waits for DC.onReady().
   ============================================================ */
(function () {
  'use strict';
  const firebase = window.firebase;
  const app = firebase.initializeApp(window.FIREBASE_CONFIG);
  const auth = firebase.auth();
  const db = firebase.database();
  const DC = window.DC = {
    db, auth, TS: firebase.database.ServerValue.TIMESTAMP,
    user: null, email: '', role: null, ready: false,
    global: null,       // 'editor' (design team) | 'viewer' (/viewers, boss) | null
    boardRoles: {},     // board id -> 'editor' | 'viewer', boards this person can open
  };
  const readyCbs = [], outCbs = [];
  DC.onReady = cb => { readyCbs.push(cb); if (DC.ready) cb(DC); };
  DC.onSignedOut = cb => { outCbs.push(cb); };
  DC.emailKey = e => String(e || '').replace(/\./g, ',');
  DC.signOut = () => auth.signOut();
  DC.isEditor = board => (board ? DC.boardRoles[board] : DC.role) === 'editor';
  DC.canCreate = () => DC.global === 'editor';            // a new board: the design team only
  DC.roleFor = board => DC.boardRoles[board] || null;
  DC.useBoard = board => (DC.role = DC.roleFor(board));
  let rolesSeq = 0;
  /** Works out the role on each board id (one small read per board, unless on a list for all). */
  DC.loadRoles = async ids => {
    const seq = ++rolesSeq, key = DC.emailKey(DC.email), out = {};
    await Promise.all(ids.map(async id => {
      let m = null;
      if (DC.global !== 'editor') { try { m = (await db.ref('members/' + id + '/' + key).once('value')).val(); } catch (e) { m = null; } }
      const r = DC.global === 'editor' || m === 'editor' ? 'editor' : DC.global === 'viewer' || m === 'viewer' ? 'viewer' : null;
      if (r) out[id] = r;
    }));
    if (seq === rolesSeq) DC.boardRoles = out;
    return DC.boardRoles;
  };
  DC.idToken = () => (DC.user ? DC.user.getIdToken() : Promise.reject(new Error('Not signed in')));

  // ------------------------------------------------------------- gate --
  const gate = document.getElementById('gate');
  const appEl = document.getElementById('app');
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

  function show(html) {
    gate.innerHTML = '<div class="box">' + html + '</div>';
    gate.hidden = false; appEl.hidden = true;
  }
  function setMsg(text, err) {
    const m = gate.querySelector('.msg');
    if (m) { m.textContent = text || ''; m.classList.toggle('err', !!err); }
  }
  function human(e) {
    const c = (e && e.code) || '';
    if (/invalid-credential|wrong-password|user-not-found|invalid-login/.test(c)) return 'Email or password is not right. First time? Tap "First time here / forgot password".';
    if (/too-many-requests/.test(c)) return 'Too many tries. Wait a minute and try again.';
    if (/invalid-email/.test(c)) return 'That is not an email address.';
    if (/network/.test(c)) return 'No connection. Check the internet and try again.';
    return (e && e.message) || String(e);
  }

  function showSignIn() {
    let last = '';
    try { last = localStorage.getItem('afdesign_email') || ''; } catch (e) {}
    show(`<h2>AF Design Board</h2>
      <div class="dim">Sign in with your AF Hub account.</div>
      <form id="gForm">
        <label for="gEmail">Email</label><input id="gEmail" type="email" autocomplete="username" value="${esc(last)}" required>
        <label for="gPwd">Password</label><input id="gPwd" type="password" autocomplete="current-password">
        <div class="row"><button class="btn primary" type="submit">Sign in</button>
        <button class="btn ghost" type="button" id="gReset">First time here / forgot password</button></div>
      </form><div class="msg"></div>`);
    const email = () => gate.querySelector('#gEmail').value.trim();
    gate.querySelector('#gForm').addEventListener('submit', async ev => {
      ev.preventDefault();
      const pwd = gate.querySelector('#gPwd').value;
      if (!pwd) { setMsg('Enter your password, or tap "First time here".', true); return; }
      setMsg('Signing in…');
      try { localStorage.setItem('afdesign_email', email()); } catch (e) {}
      try { await auth.signInWithEmailAndPassword(email(), pwd); } catch (e) { setMsg(human(e), true); }
    });
    gate.querySelector('#gReset').addEventListener('click', async () => {
      if (!email()) { setMsg('Type your email first.', true); return; }
      try { await auth.sendPasswordResetEmail(email()); setMsg('Sent. Open the email, set a password, then sign in here.'); }
      catch (e) { setMsg(human(e), true); }
    });
  }

  function showVerify(user) {
    show(`<h2>Confirm your email</h2>
      <div class="dim">${esc(user.email)} is not confirmed yet. We send a link; open it, then come back.</div>
      <div class="row"><button class="btn primary" id="gSend">Send the link</button>
      <button class="btn" id="gDone">I opened the link</button>
      <button class="btn ghost" id="gOut">Sign out</button></div><div class="msg"></div>`);
    gate.querySelector('#gSend').onclick = () => user.sendEmailVerification().then(() => setMsg('Sent to ' + user.email + '.'), e => setMsg(human(e), true));
    gate.querySelector('#gDone').onclick = () => user.reload().then(() => user.getIdToken(true)).then(() => {
      if (auth.currentUser && auth.currentUser.emailVerified) onUser(auth.currentUser);
      else setMsg('Still not confirmed. Open the link in the email first.', true);
    }, e => setMsg(human(e), true));
    gate.querySelector('#gOut').onclick = () => auth.signOut();
  }

  function showBlocked(title, text) {
    show(`<h2>${esc(title)}</h2><div class="dim">${text}</div>
      <div class="row"><button class="btn" id="gOut">Sign out</button></div>`);
    gate.querySelector('#gOut').onclick = () => auth.signOut();
  }

  // ------------------------------------------------------------- auth --
  async function onUser(user) {
    if (!user || user.isAnonymous) {
      DC.ready = false; DC.user = null; DC.role = null; DC.global = null; DC.boardRoles = {};
      outCbs.forEach(cb => cb());
      showSignIn();
      return;
    }
    if (!user.emailVerified) { showVerify(user); return; }
    let meta;
    try { meta = (await db.ref('meta/project').once('value')).val(); }
    catch (e) {
      showBlocked('Could not open the Design Board', `Signed in as ${esc(user.email)}, but the design database did not answer (${esc((e && e.code) || 'no connection')}). Reload; if it keeps happening, send this to Leo.`);
      return;
    }
    if (meta !== 'design') {
      showBlocked('Wrong database', 'This page and its database do not match' + (meta ? ` (the database says "${esc(meta)}")` : ' (the database has not been set up)') + '. Nothing was read or written.');
      return;
    }
    const key = DC.emailKey(user.email), has = async p => { try { return (await db.ref(p + '/' + key).once('value')).exists(); } catch (e) { return false; } };
    const editor = await has('allowlist');
    let viewer = !editor && await has('viewers');
    if (!editor && !viewer) { try { viewer = (await user.getIdTokenResult()).claims.boss === true; } catch (e) { viewer = false; } }
    DC.user = user; DC.email = user.email; DC.global = editor ? 'editor' : viewer ? 'viewer' : null;
    DC.role = null; DC.boardRoles = {};
    gate.hidden = true; appEl.hidden = false;
    DC.ready = true;
    readyCbs.forEach(cb => cb(DC));
  }
  auth.onAuthStateChanged(u => { onUser(u).catch(e => showBlocked('Something went wrong', esc(human(e)))); });
})();
