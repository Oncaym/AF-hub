/* A stand-in for the Firebase compat SDK (app, auth, database, storage,
   firestore) used ONLY by the local end-to-end run (run.mjs --backend=fake).
   Every read and write goes to the test process through window.__fb(), which
   keeps the databases in memory and checks each operation against the real
   platform/project-database.rules.json with targaryen. CI runs the same
   scenarios against the real SDK and the Firebase emulators. */
(function () {
  if (window.firebase && window.firebase.__fake) return;
  const call = (op, args) => window.__fb(op, JSON.parse(JSON.stringify(args || {})));
  const TIMESTAMP = { '.sv': 'timestamp' };
  const listeners = [];           // { url, path, query, cb, err }

  function permissionError() { const e = new Error('permission_denied at this path'); e.code = 'PERMISSION_DENIED'; return e; }
  function snapshot(key, v) {
    return {
      key, val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))),
      exists: () => v !== undefined && v !== null,
      forEach(cb) { if (v && typeof v === 'object') Object.keys(v).sort().some(k => cb(snapshot(k, v[k])) === true); },
      child(p) { let x = v; String(p).split('/').filter(Boolean).forEach(k => { x = x && typeof x === 'object' ? x[k] : undefined; }); return snapshot(p, x); },
    };
  }
  function applyQuery(v, q) {
    if (!q || !v || typeof v !== 'object') return v;
    let keys = Object.keys(v);
    if (q.orderByChild) keys.sort((a, b) => ((v[a] || {})[q.orderByChild] > (v[b] || {})[q.orderByChild] ? 1 : -1));
    else keys.sort();
    if (q.limitToLast) keys = keys.slice(-q.limitToLast);
    const o = {}; keys.forEach(k => { o[k] = v[k]; }); return o;
  }

  let pushSeq = 0;
  function makeRef(app, path, query) {
    path = '/' + String(path || '').split('/').filter(Boolean).join('/');
    const url = app.options.databaseURL;
    const key = path === '/' ? null : path.split('/').pop();
    const authOf = () => (app.__auth && app.__auth.__token()) || null;
    const ref = {
      key, path,
      child: p => makeRef(app, path + '/' + p),
      limitToLast: n => makeRef(app, path, Object.assign({}, query, { limitToLast: n })),
      orderByChild: k => makeRef(app, path, Object.assign({}, query, { orderByChild: k })),
      once(ev) {
        if (path === '/.info/connected') return Promise.resolve(snapshot('connected', true));
        return call('read', { url, path, auth: authOf() }).then(r => {
          if (!r.allowed) throw permissionError();
          return snapshot(key, applyQuery(r.value, query));
        });
      },
      get() { return ref.once('value'); },
      on(ev, cb, err) {
        if (path === '/.info/connected') { setTimeout(() => cb(snapshot('connected', true)), 0); return cb; }
        const l = { url, path, query, cb, err, app };
        listeners.push(l);
        refreshOne(l);
        return cb;
      },
      off() { for (let i = listeners.length - 1; i >= 0; i--) if (listeners[i].url === url && listeners[i].path === path) listeners.splice(i, 1); },
      set(v) { return write('set', url, path, v, authOf()); },
      update(v) { return write('update', url, path, v, authOf()); },
      remove() { return write('set', url, path, null, authOf()); },
      push(v) {
        const k = 'k' + Date.now().toString(36) + (++pushSeq).toString(36).padStart(4, '0');
        const child = makeRef(app, path + '/' + k);
        const p = v === undefined ? Promise.resolve() : child.set(v);
        child.then = (a, b) => p.then(() => child).then(a, b);
        child.catch = b => p.catch(b);
        return child;
      },
      onDisconnect: () => ({ remove: () => Promise.resolve(), set: () => Promise.resolve() }),
    };
    return ref;
  }
  function write(op, url, path, value, auth) {
    return call('write', { op, url, path, value, auth }).then(r => {
      if (!r.allowed) throw permissionError();
      refreshAll();
    });
  }
  function refreshOne(l) {
    call('read', { url: l.url, path: l.path, auth: (l.app.__auth && l.app.__auth.__token()) || null }).then(r => {
      if (listeners.indexOf(l) < 0) return;
      if (!r.allowed) { if (l.err) l.err(permissionError()); return; }
      const v = applyQuery(r.value, l.query);
      const sig = JSON.stringify(v === undefined ? null : v);
      if (l.last === sig) return;
      l.last = sig;
      l.cb(snapshot(l.path.split('/').pop(), v));
    });
  }
  function refreshAll() { listeners.slice().forEach(refreshOne); }
  window.__fbRefresh = refreshAll;

  // ---------------------------------------------------------------- auth --
  const STORE = 'fakefb:user';
  function makeAuth(app) {
    const subs = [];
    let current = null;
    const persisted = app.name === '[DEFAULT]' ? (() => { try { return JSON.parse(localStorage.getItem(STORE)); } catch (e) { return null; } })() : null;
    function userObj(u) {
      if (!u) return null;
      const o = {
        uid: u.uid, email: u.email || null, emailVerified: !!u.emailVerified, isAnonymous: !!u.anonymous,
        reload: () => call('user', { uid: u.uid }).then(x => { if (x) { o.emailVerified = !!x.emailVerified; u.emailVerified = !!x.emailVerified; } }),
        getIdToken: () => Promise.resolve('fake-token'),
        sendEmailVerification: () => call('sendVerification', { uid: u.uid }),
      };
      return o;
    }
    function setUser(u) {
      current = userObj(u);
      auth.currentUser = current;
      if (app.name === '[DEFAULT]') { try { u && !u.anonymous ? localStorage.setItem(STORE, JSON.stringify(u)) : localStorage.removeItem(STORE); } catch (e) {} }
      subs.forEach(cb => setTimeout(() => cb(current), 0));
    }
    const auth = {
      currentUser: null,
      useEmulator() {},
      setPersistence: () => Promise.resolve(),
      onAuthStateChanged(cb) { subs.push(cb); setTimeout(() => cb(current), 0); return () => subs.splice(subs.indexOf(cb), 1); },
      signInWithEmailAndPassword(email, password) {
        return call('signIn', { email, password }).then(u => {
          if (!u) { const e = new Error('auth/invalid-credential'); e.code = 'auth/invalid-credential'; throw e; }
          setUser(u); return { user: current };
        });
      },
      signInAnonymously() { setUser({ uid: 'anon-' + Math.random().toString(36).slice(2), anonymous: true }); return Promise.resolve({ user: current }); },
      signOut() { setUser(null); return Promise.resolve(); },
      sendPasswordResetEmail: email => call('reset', { email }),
      __token() {
        if (!current) return null;
        if (current.isAnonymous) return { uid: current.uid, provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } };
        return { uid: current.uid, provider: 'password', token: { email: current.email, email_verified: current.emailVerified, firebase: { sign_in_provider: 'password' } } };
      },
    };
    if (persisted) { current = userObj(persisted); auth.currentUser = current; }
    return auth;
  }

  // ----------------------------------------------------------------- app --
  const apps = [];
  function makeApp(options, name) {
    const app = { name: name || '[DEFAULT]', options: Object.assign({}, options) };
    app.auth = () => (app.__auth = app.__auth || makeAuth(app));
    app.database = (url) => {
      const a = url ? Object.assign({}, app, { options: Object.assign({}, app.options, { databaseURL: url }) }) : app;
      app.auth();
      a.__auth = app.__auth;
      return { ref: p => makeRef(a, p), app: a, useEmulator() {} };
    };
    app.storage = () => ({
      ref: p => ({ fullPath: p, put: () => call('upload', { path: p }), getDownloadURL: () => Promise.resolve('https://firebasestorage.googleapis.com/v0/b/fake/o/' + encodeURIComponent(p) + '?alt=media&token=t') }),
      refFromURL: () => ({ delete: () => Promise.resolve() }),
    });
    app.firestore = () => ({ collection: () => ({ onSnapshot: (cb, err) => { setTimeout(() => err && err({ code: 'unavailable' }), 0); return () => {}; } }) });
    return app;
  }
  const firebase = {
    __fake: true,
    apps,
    initializeApp(options, name) {
      const n = name || '[DEFAULT]';
      if (apps.some(a => a.name === n)) { const e = new Error(`Firebase App named '${n}' already exists`); e.code = 'app/duplicate-app'; throw e; }
      const a = makeApp(options, n); apps.push(a); return a;
    },
    app: name => apps.find(a => a.name === (name || '[DEFAULT]')),
    auth: app => (app || firebase.app()).auth(),
    database: app => (app || firebase.app()).database(),
    storage: app => (app || firebase.app()).storage(),
    firestore: app => (app || firebase.app()).firestore(),
  };
  firebase.database.ServerValue = { TIMESTAMP };
  firebase.auth.Auth = { Persistence: { LOCAL: 'local', SESSION: 'session', NONE: 'none' } };
  window.firebase = firebase;
})();
