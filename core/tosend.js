/* ============================================================
   🚚 To send (Leo, 2026-10-16)
   ------------------------------------------------------------
   The site asks Leo for a frame or a door, Leo tells the shop, and a
   sidelite asked for a week ago still had not gone out. Now the foreman
   puts it on the list himself, and it stays there, counting days, until
   someone marks it sent. Nothing else: no quantities, no trucks, no dates.

   Data: /toSend/<id> = { what, by, at, _project, sent?: { by, at } } in each
   project's own database. Editors (foremen, PM) add and remove; editors,
   viewers and staff mark sent (the shop). The GC sees none of it.

   Two places show it: a 🚚 button in every tracker, and one list of every
   project on the hub overview, for the shop.
   ============================================================ */
(function (root) {
  'use strict';
  const DAY = 864e5, LATE = 2, KEEP_SENT = 7;

  /** Open items oldest first, and what was sent in the last week (newest first). */
  function split(items, now) {
    const all = Object.keys(items || {}).map(id => Object.assign({ id }, items[id])).filter(x => x && x.what);
    const open = all.filter(x => !x.sent).sort((a, b) => (+a.at || 0) - (+b.at || 0));
    const sent = all.filter(x => x.sent && now - (+x.sent.at || 0) < KEEP_SENT * DAY).sort((a, b) => (+b.sent.at || 0) - (+a.sent.at || 0));
    return { open, sent };
  }
  const days = (at, now) => Math.max(0, Math.floor((now - (+at || now)) / DAY));
  const late = (x, now) => days(x.at, now) >= LATE;

  const API = { split, days, late, LATE };
  root.AF_SEND = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;

  /* ======================= browser ======================= */
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const who = e => String(e || '').split('@')[0];
  const me = () => { try { return firebase.auth().currentUser.email; } catch (e) { return ''; } };
  const TS = () => firebase.database.ServerValue.TIMESTAMP;
  const age = (x, now) => { const d = days(x.at, now); return d === 0 ? 'today' : d + (d === 1 ? ' day' : ' days'); };
  const small = 'font-size:12px;padding:3px 9px;min-height:0';
  const say = m => (typeof toast === 'function' ? toast(m) : alert(m));
  const fail = what => e => say(what + ': ' + ((e && (e.code || e.message)) || e));
  const badge = (x, now) => `<span style="font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;${late(x, now)
    ? 'background:var(--red,#e5484d);color:#fff' : 'border:1px solid var(--border);color:var(--text-dim)'}">${esc(age(x, now))}</span>`;

  function markSent(db, id) { return db.ref('toSend/' + id + '/sent').set({ by: me(), at: TS() }); }
  function unsend(db, id) { return db.ref('toSend/' + id + '/sent').remove(); }

  function rows(list, now, opts) {
    const { open, sent } = list;
    let h = open.map(x => `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid var(--border)">
        <span style="flex:1;min-width:0">${opts.project ? `<span style="color:var(--text-dim);font-size:12px">${esc(opts.project)} · </span>` : ''}${esc(x.what)}
          <span style="color:var(--text-dim);font-size:11.5px"> · ${esc(who(x.by))}</span></span>
        ${badge(x, now)}
        <button type="button" class="btn" style="${small}" data-sent="${esc(x.id)}">Sent ✓</button>
        ${opts.canRemove ? `<button type="button" class="btn" style="${small}" data-del="${esc(x.id)}" title="Remove (asked by mistake)">×</button>` : ''}
      </div>`).join('');
    if (!open.length) h = `<div style="color:var(--text-dim);font-size:12.5px;padding:8px 0">Nothing waiting to be sent.</div>`;
    if (sent.length && !opts.project) h += `<div style="margin-top:10px;font-size:11.5px;color:var(--text-dim)">${sent.map(x =>
      `<div style="padding:2px 0">✓ ${esc(x.what)} · sent ${esc(new Date(+x.sent.at).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }))} by ${esc(who(x.sent.by))}
        <button type="button" class="linkbtn" style="font-size:11px;background:none;border:0;color:var(--text-dim);text-decoration:underline;cursor:pointer" data-unsend="${esc(x.id)}">undo</button></div>`).join('')}</div>`;
    return h;
  }
  function wire(el, db) {
    el.querySelectorAll('[data-sent]').forEach(b => b.onclick = () => markSent(db, b.dataset.sent).catch(fail('Could not save')));
    el.querySelectorAll('[data-unsend]').forEach(b => b.onclick = () => unsend(db, b.dataset.unsend).catch(fail('Could not save')));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Remove this from the list?')) db.ref('toSend/' + b.dataset.del).remove().catch(fail('Could not remove')); });
  }

  /* ---------- tracker: 🚚 button + list ---------- */
  const T = { items: null, on: false, denied: false };
  API._tracker = T;
  const isGC = () => typeof _isGC === 'function' && _isGC();
  const canAdd = () => !(typeof _noEdit === 'function' && _noEdit());

  function button() {
    let b = document.getElementById('toSendBtn');
    if (isGC() || T.denied || !T.items) { if (b) b.style.display = 'none'; return; }
    const bar = document.querySelector('.header-actions'); if (!bar) return;
    if (!b) {
      b = document.createElement('button'); b.className = 'btn'; b.id = 'toSendBtn'; b.type = 'button';
      b.onclick = open;
      const solve = document.getElementById('openItemsBtn');
      solve ? bar.insertBefore(b, solve) : bar.appendChild(b);
    }
    const now = Date.now(), { open: o } = split(T.items, now);
    b.style.display = '';
    b.textContent = '🚚 ' + o.length;
    b.title = o.length ? `${o.length} thing(s) to send to site` : 'To send to site';
    const red = o.some(x => late(x, now));
    b.style.background = red ? 'var(--red,#e5484d)' : ''; b.style.color = red ? '#fff' : ''; b.style.fontWeight = red ? '600' : '';
  }
  function render() {
    button();
    const box = document.getElementById('toSendList'); if (!box) return;
    const db = firebase.database();
    box.innerHTML = rows(split(T.items, Date.now()), Date.now(), { canRemove: canAdd() });
    wire(box, db);
  }
  function open() {
    let ov = document.getElementById('toSendModal');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'toSendModal'; ov.className = 'modal-overlay';
      document.body.appendChild(ov);
      ov.addEventListener('click', e => { if (e.target === ov) ov.classList.remove('show'); });
    }
    ov.innerHTML = `<div class="modal" style="max-width:520px">
        <h3 style="margin-top:0">🚚 To send to site</h3>
        ${canAdd() ? `<div class="form-row" style="display:flex;gap:8px;margin:0 0 6px"><input type="text" id="toSendWhat" maxlength="200" placeholder="What, e.g. SD01 sidelite" style="flex:1" autocomplete="off">
          <button type="button" class="btn btn-primary" id="toSendAdd">Add</button></div>` : ''}
        <div id="toSendList"></div>
        <div class="modal-actions"><button class="btn" type="button" onclick="document.getElementById('toSendModal').classList.remove('show')">Close</button></div>
      </div>`;
    const inp = ov.querySelector('#toSendWhat');
    const add = () => {
      const what = (inp.value || '').trim().slice(0, 200); if (!what) return;
      firebase.database().ref('toSend').push().set({ what, by: me(), at: TS(), _project: (window.PROJECT || {}).hubId })
        .then(() => { inp.value = ''; inp.focus(); })
        .catch(fail('Could not save'));
    };
    if (inp) { ov.querySelector('#toSendAdd').onclick = add; inp.addEventListener('keydown', e => { if (e.key === 'Enter') add(); }); }
    ov.classList.add('show');
    render();
    if (inp) inp.focus();
  }
  function startTracker(tries) {
    if (T.on) return;
    // cloud-sync starts Firebase; wait for it rather than racing it.
    // (the hub summary has its own named app; the tracker's is the default one)
    if (typeof firebase === 'undefined' || !firebase.apps || !firebase.apps.some(a => a.name === '[DEFAULT]')) {
      if ((tries || 0) < 120) setTimeout(() => startTracker((tries || 0) + 1), 500);
      return;
    }
    T.on = true;
    firebase.auth().onAuthStateChanged(u => {
      if (!u || u.isAnonymous) return;
      firebase.database().ref('toSend').on('value', s => { T.items = s.val() || {}; T.denied = false; render(); },
        () => { T.denied = true; render(); });   // the GC, or no access: no button
    });
    setInterval(button, 60 * 60 * 1000);   // ages tick over without a reload
  }

  /* ---------- hub overview: every project in one list, for the shop ---------- */
  /** el: where to draw; projects: [{ id, name, databaseURL }]. Projects this account cannot read are left out. */
  function hub(el, projects) {
    if (!el || el.dataset.on) return;
    el.dataset.on = '1';
    const data = {}, dbs = {};
    const draw = () => {
      const now = Date.now();
      const open = [];
      projects.forEach(p => { if (data[p.id]) split(data[p.id], now).open.forEach(x => open.push(Object.assign({ p }, x))); });
      open.sort((a, b) => (+a.at || 0) - (+b.at || 0));
      el.hidden = false;
      el.innerHTML = `<h2 style="font-size:15px;margin:0 0 6px">🚚 To send to site <span style="color:var(--text-dim);font-weight:400">${open.length || ''}</span></h2>`
        + (open.length ? open.map(x => `<div data-p="${esc(x.p.id)}">${rows({ open: [x], sent: [] }, now, { project: x.p.name })}</div>`).join('')
          : '<div style="color:var(--text-dim);font-size:12.5px;padding:4px 0 8px">Nothing waiting to be sent.</div>');
      el.querySelectorAll('[data-p]').forEach(d => wire(d, dbs[d.dataset.p]));
    };
    projects.forEach(p => {
      try {
        const db = dbs[p.id] = firebase.app().database(p.databaseURL);
        db.ref('toSend').on('value', s => { data[p.id] = s.val() || {}; draw(); }, () => { delete data[p.id]; draw(); });
      } catch (e) { console.warn('[to send] ' + p.id, e); }
    });
    draw();
  }

  Object.assign(API, { open, hub, startTracker });
  if (typeof window !== 'undefined' && window.PROJECT && window.PROJECT.hubId) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startTracker()); else startTracker();
  }
})(typeof window !== 'undefined' ? window : globalThis);
