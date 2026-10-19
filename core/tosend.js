/* ============================================================
   🚚 To send (Leo, 2026-10-16; every project + the Shop page 2026-10-19)
   ------------------------------------------------------------
   The site asks for a frame or a door, someone puts it on the list, and it
   stays there, counting days, until the shop marks it sent.

   One line per request ("SD01 sidelite"), plus, only if useful: quantity,
   need-by date, a note and a photo. Nothing else: no trucks, no statuses.

   Where the requests live:
   - a project WITH a dashboard (ac3, cp2, lex …): /toSend/<id> in its own
     database. Editors (foremen, PM) and staff add; editors remove any, staff
     their own; editors, viewers and staff mark sent. The GC sees none of it.
   - a project WITHOUT a dashboard yet (Package 7, Forest Hill …): the hub
     database, /sendSites/<site> = { name } and /toSend/<site>/<id>. Staff
     (verified @advfacade.com) add and mark sent; a request is changed or
     removed only by whoever added it (or an admin).
   Each request: { what, by, at, _project, qty?, need? 'YYYY-MM-DD', note?,
   photo? (download link), sent?: { by, at } }.

   Where it shows:
   - each project's 📦 Warehouse page: that project's list, at the top (the
     tracker's Warehouse link carries "🚚 N", red when something is late);
   - /send/ — the Shop page: every project in one list, grouped by project,
     most urgent first, Sent ✓, printable;
   - the hub overview: a one-line count with the most urgent few, linking to
     the Shop page.
   Late: on or past its need-by date; with no date, 2+ days after it was asked.
   ============================================================ */
(function (root) {
  'use strict';
  const DAY = 864e5, LATE = 2, KEEP_SENT = 7;
  const NEED = /^\d{4}-\d{2}-\d{2}$/;

  const pad = n => String(n).padStart(2, '0');
  /** Local calendar day of a timestamp, 'YYYY-MM-DD'. */
  const ymd = t => { const d = new Date(t); return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); };
  const hasNeed = x => !!(x && typeof x.need === 'string' && NEED.test(x.need));
  const dayOf = s => { const [y, m, d] = s.split('-').map(Number); return new Date(y, m - 1, d).getTime(); };
  /** When it should go out: its need-by date, or LATE days after it was asked. Sorts the list. */
  /** When it was asked: the WeChat message's time when it was logged from WeChat, else when it was added. */
  const asked = x => +(x && x.askedAt) || +(x && x.at) || 0;
  const dueKey = x => (hasNeed(x) ? dayOf(x.need) : asked(x) + LATE * DAY);

  /** Open items most urgent first, and what was sent in the last week (newest first). */
  function split(items, now) {
    const all = Object.keys(items || {}).map(id => Object.assign({ id }, items[id])).filter(x => x && x.what);
    const open = all.filter(x => !x.sent).sort((a, b) => dueKey(a) - dueKey(b) || asked(a) - asked(b));
    const sent = all.filter(x => x.sent && now - (+x.sent.at || 0) < KEEP_SENT * DAY).sort((a, b) => (+b.sent.at || 0) - (+a.sent.at || 0));
    return { open, sent };
  }
  const days = (at, now) => Math.max(0, Math.floor((now - (+at || now)) / DAY));
  const late = (x, now) => (hasNeed(x) ? ymd(now) >= x.need : days(asked(x), now) >= LATE);
  /** "need Oct 22" / "need tomorrow" / "due today" / "late 3 days"; '' with no date. */
  function needLabel(x, now) {
    if (!hasNeed(x)) return '';
    const d = Math.round((dayOf(x.need) - dayOf(ymd(now))) / DAY);
    if (d < 0) return 'late ' + -d + (d === -1 ? ' day' : ' days');
    if (d === 0) return 'due today';
    if (d === 1) return 'need tomorrow';
    return 'need ' + new Date(dayOf(x.need)).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  }
  /** Lists of several projects → groups, the group with the most urgent request first.
      lists: [{ src, items }] → [{ src, open, sent }] (groups with nothing open are left out). */
  function groups(lists, now) {
    return lists.map(l => Object.assign({ src: l.src }, split(l.items, now)))
      .filter(g => g.open.length)
      .sort((a, b) => dueKey(a.open[0]) - dueKey(b.open[0]) || String(a.src.name).localeCompare(String(b.src.name)));
  }
  /** A site id for a project without a dashboard: 's_' + its name, unique among `taken`. */
  function siteId(name, taken) {
    const base = 's_' + (String(name || '').toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 30) || 'project');
    let id = base, n = 2;
    while (taken && taken[id]) id = base + '_' + n++;
    return id;
  }
  const safeUrl = u => (typeof u === 'string' && /^https?:\/\//i.test(u) ? u : '');

  /* ---------- 📋 from WeChat: pasted chat text → requests (no AI) ----------
     Leo 10-19: the site keeps asking on WeChat, so Leo records it. WeChat (PC) copies messages
     as "Name  10:21" / "Name 2026/10/19 10:21:33" header lines followed by the text, or as
     "Name: text". Each remaining line is one request, with who said it and when; chatter
     ("收到", "ok", [图片]) is left out. */
  const CHATTER = /^(\[(图片|照片|photo|image|表情|sticker|动画表情|语音|voice|视频|video|文件|file|链接|link)\]|收到|好的?|好嘞|嗯+|ok(ay)?|thanks?( you)?|谢谢|多谢|👍|🙏|👌)[\s!！。.~～]*$/i;
  const TIME = /((\d{4})[\/\-年.](\d{1,2})[\/\-月.](\d{1,2})日?\s*)?(上午|下午|早上|晚上|AM|PM)?\s*(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM)?/i;
  function chatTime(m, now) {
    let h = +m[6]; const min = +m[7], ap = (m[5] || m[8] || '').toUpperCase();
    if (/下午|晚上|PM/.test(ap) && h < 12) h += 12;
    if (/上午|早上|AM/.test(ap) && h === 12) h = 0;
    const d = new Date(now);
    const t = m[2] ? new Date(+m[2], +m[3] - 1, +m[4], h, min) : new Date(d.getFullYear(), d.getMonth(), d.getDate(), h, min);
    let v = t.getTime();
    if (!m[2] && v > now + 5 * 60e3) v -= DAY;          // a time later than now was yesterday
    return v;
  }
  const QTY = /(?:^|[\s,，(（])(?:[x×*]\s*(\d{1,5})|(\d{1,5})\s*(?:pcs?|pieces?|ea|sets?|个|片|件|套|根|块|樘|扇|支|条))(?=$|[\s,，.。)）])/i;
  /** text → [{ what, qty, askedBy, askedAt, quote }] */
  function parseChat(text, now) {
    const out = [];
    let who = '', when = 0;
    String(text || '').replace(/\r/g, '').split('\n').forEach(raw => {
      const line = raw.replace(/ /g, ' ').trim();
      if (!line) return;
      // "Name  10:21" or "Name 2026/10/19 10:21:33" alone on a line: who and when for what follows
      const t = line.match(new RegExp('^\\[?' + TIME.source + '\\]?$', 'i'));    // a time alone ("14:30", "下午 1:15")
      if (t) { when = chatTime(t, now); return; }
      const h = line.match(new RegExp('^(.{1,24}?)\\s+' + TIME.source + '\\s*$', 'i'));
      if (h && !/\d{3,}/.test(h[1]) && h[1].split(/\s+/).length <= 3) { who = h[1].trim(); when = chatTime(h.slice(1), now); return; }
      let body = line, by = who;
      const inl = line.match(/^([^:：\d\[\]]{1,16})[：:]\s*(.+)$/);    // "Name: text"
      if (inl) { by = who = inl[1].trim(); body = inl[2].trim(); }
      if (CHATTER.test(body)) return;
      const q = body.match(QTY);
      out.push({ what: body.slice(0, 200), qty: q ? +(q[1] || q[2]) : 0, askedBy: by.slice(0, 80), askedAt: when || 0, quote: line.slice(0, 300) });
    });
    return out;
  }

  const API = { split, days, late, LATE, ymd, dueKey, asked, needLabel, groups, siteId, safeUrl, parseChat };
  root.AF_SEND = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  if (typeof document === 'undefined') return;

  /* ======================= browser ======================= */
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const who = e => String(e || '').split('@')[0];
  const user = () => { try { return firebase.auth().currentUser; } catch (e) { return null; } };
  const me = () => (user() || {}).email || '';
  const isStaff = () => { const u = user(); return !!(u && u.emailVerified && /@advfacade\.com$/i.test(u.email || '')); };
  /* Only the shop marks a request Sent (Leo 10-19): the custom claim shop = true on the login
     (Actions → Project database, role shop). The rules refuse anyone else; the page just
     does not offer the button. Resolves to false when it cannot tell. */
  let shopP = null;
  const isShop = () => (shopP = shopP || (async () => {
    try { const u = user(); if (!u || !u.getIdTokenResult) return false; return !!((await u.getIdTokenResult()).claims || {}).shop; }
    catch (e) { return false; }
  })());
  const TS = () => firebase.database.ServerValue.TIMESTAMP;
  const age = (x, now) => { const d = days(asked(x), now); return d === 0 ? 'today' : d + (d === 1 ? ' day' : ' days'); };
  const say = m => (typeof toast === 'function' ? toast(m) : alert(m));
  const fail = what => e => say(what + ': ' + ((e && (e.code || e.message)) || e));
  const shortDate = t => new Date(+t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });

  function css() {
    if (document.getElementById('ts-css')) return;
    const s = document.createElement('style');
    s.id = 'ts-css';
    s.textContent = `
      .ts-row{display:flex;align-items:center;gap:10px;padding:9px 0;border-bottom:1px solid var(--border)}
      .ts-row:last-child{border-bottom:0}
      .ts-main{flex:1;min-width:0}
      .ts-what{font-size:14.5px;line-height:1.35;word-break:break-word}
      .ts-what b{font-weight:700}
      .ts-proj{color:var(--text-dim);font-size:12px}
      .ts-sub{color:var(--text-dim);font-size:12px;margin-top:2px;line-height:1.4;word-break:break-word}
      .ts-chip{font-size:11px;padding:1px 7px;border-radius:999px;white-space:nowrap;border:1px solid var(--border);color:var(--text-dim);display:inline-block}
      .ts-chip.red{background:var(--red,#e5484d);border-color:var(--red,#e5484d);color:#fff}
      .ts-chips{display:flex;flex-direction:column;align-items:flex-end;gap:3px}
      .ts-thumb{width:44px;height:44px;object-fit:cover;border-radius:6px;border:1px solid var(--border);display:block}
      .ts-row .ts-btn{font-size:12.5px;padding:5px 11px;min-height:0;background:var(--panel-2);color:var(--text);border:1px solid var(--border);border-radius:6px;cursor:pointer;white-space:nowrap}
      .ts-row .ts-btn.go{background:var(--green,#2da44e);border-color:var(--green,#2da44e);color:#fff;font-weight:600}
      .ts-x{background:none;border:0;color:var(--text-dim);font-size:17px;cursor:pointer;padding:2px 4px}
      .ts-empty{color:var(--text-dim);font-size:12.5px;padding:8px 0}
      .ts-sent{margin-top:10px;font-size:11.5px;color:var(--text-dim)}
      .ts-sent div{padding:2px 0}
      .ts-link{font-size:11px;background:none;border:0;color:var(--text-dim);text-decoration:underline;cursor:pointer;padding:0 2px}
      .ts-add{display:flex;flex-wrap:wrap;gap:8px;margin-bottom:6px}
      .ts-add input,.ts-add select{background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font-size:16px;color:var(--text);min-width:0;font-family:inherit}
      .ts-add .ts-whatin{flex:1 1 220px}
      .ts-add .ts-addbtn{background:var(--accent);color:#fff;border:0;border-radius:8px;font-size:15px;padding:0 18px;cursor:pointer;min-height:40px}
      .ts-more{display:flex;flex-wrap:wrap;gap:8px;width:100%;align-items:center}
      .ts-more[hidden]{display:none}
      .ts-more label{font-size:12px;color:var(--text-dim);display:flex;align-items:center;gap:6px}
      .ts-more .ts-qty{width:90px}
      .ts-more .ts-note{flex:1 1 220px}
      .ts-morebtn,.ts-photobtn{background:none;border:1px dashed var(--border);color:var(--text-dim);border-radius:8px;padding:6px 10px;font-size:12.5px;cursor:pointer}
      .ts-photobtn input{display:none}
    `;
    document.head.appendChild(s);
  }

  /* ---------- one request ---------- */
  function rowHtml(x, now, o) {
    const photo = safeUrl(x.photo), need = needLabel(x, now), red = late(x, now);
    const sub = [(x.askedBy ? esc(x.askedBy) + (x.src === 'wechat' ? ' (WeChat)' : '') : esc(who(x.by))) + ' · asked ' + esc(age(x, now))];
    if (x.note) sub.push(esc(x.note));
    return `<div class="ts-row" data-id="${esc(x.id)}"${x.askedBy ? ` title="Recorded by ${esc(who(x.by))}${x.askedAt ? ', asked ' + esc(new Date(+x.askedAt).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })) : ''}"` : ''}>
      ${photo ? `<a href="${esc(photo)}" target="_blank" rel="noopener" title="Photo"><img class="ts-thumb" src="${esc(photo)}" alt="photo" loading="lazy"></a>` : ''}
      <div class="ts-main">
        <div class="ts-what">${o.project ? `<span class="ts-proj">${esc(o.project)} · </span>` : ''}${esc(x.what)}${+x.qty ? ` <b>×${esc(+x.qty)}</b>` : ''}</div>
        <div class="ts-sub">${sub.join(' · ')}</div>
      </div>
      <div class="ts-chips">
        ${need ? `<span class="ts-chip${red ? ' red' : ''}">${esc(need)}</span>` : `<span class="ts-chip${red ? ' red' : ''}">${esc(age(x, now))}</span>`}
      </div>
      ${o.canSend ? `<button type="button" class="ts-btn${o.big ? ' go' : ''}" data-sent="${esc(x.id)}">Sent ✓</button>` : ''}
      ${o.canRemove && o.canRemove(x) ? `<button type="button" class="ts-x" data-del="${esc(x.id)}" title="Remove (asked by mistake)">×</button>` : ''}
    </div>`;
  }
  function sentHtml(list, o) {
    if (!list.length) return '';
    return `<div class="ts-sent">${o.title ? `<div style="font-weight:600;margin-bottom:2px">${esc(o.title)}</div>` : ''}${list.map(x =>
      `<div data-id="${esc(x.id)}">✓ ${o.project ? esc(o.project(x)) + ' · ' : ''}${esc(x.what)}${+x.qty ? ' ×' + esc(+x.qty) : ''} · sent ${esc(shortDate(x.sent.at))} by ${esc(who(x.sent.by))}
        ${o.canSend ? `<button type="button" class="ts-link" data-unsend="${esc(x.id)}">undo</button>` : ''}</div>`).join('')}</div>`;
  }

  /* ---------- writes (src: { id, name, db, base, store }) ---------- */
  const markSent = (src, id) => src.db.ref(src.base + '/' + id + '/sent').set({ by: me(), at: TS() });
  const unsend = (src, id) => src.db.ref(src.base + '/' + id + '/sent').remove();
  function wire(el, src) {
    el.querySelectorAll('[data-sent]').forEach(b => b.onclick = () => { b.disabled = true; markSent(src, b.dataset.sent).catch(e => { b.disabled = false; fail('Could not save')(e); }); });
    el.querySelectorAll('[data-unsend]').forEach(b => b.onclick = () => unsend(src, b.dataset.unsend).catch(fail('Could not save')));
    el.querySelectorAll('[data-del]').forEach(b => b.onclick = () => { if (confirm('Remove this from the list?')) src.db.ref(src.base + '/' + b.dataset.del).remove().catch(fail('Could not remove')); });
  }
  /** A photo from the camera, made small: longest side 1600 px, JPEG. */
  function shrink(file) {
    return new Promise((res, rej) => {
      const img = new Image(), url = URL.createObjectURL(file);
      img.onload = () => {
        const k = Math.min(1, 1600 / Math.max(img.width, img.height));
        const c = document.createElement('canvas');
        c.width = Math.max(1, Math.round(img.width * k)); c.height = Math.max(1, Math.round(img.height * k));
        c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
        URL.revokeObjectURL(url);
        c.toBlob(b => (b ? res(b) : rej(new Error('photo could not be read'))), 'image/jpeg', 0.8);
      };
      img.onerror = () => { URL.revokeObjectURL(url); rej(new Error('not a picture')); };
      img.src = url;
    });
  }
  async function addRequest(src, f) {
    const id = src.db.ref(src.base).push().key;
    const v = { what: f.what, by: me(), at: TS(), _project: src.id };
    if (f.qty) v.qty = f.qty;
    if (f.need) v.need = f.need;
    if (f.note) v.note = f.note;
    if (f.askedBy) v.askedBy = String(f.askedBy).slice(0, 80);
    if (f.askedAt) v.askedAt = +f.askedAt;
    if (f.src) v.src = f.src;
    if (f.photoUrl) v.photo = f.photoUrl;
    else if (f.photo) {
      try {
        const r = firebase.storage().ref(`p/${src.store}/send/${id}.jpg`);
        await r.put(await shrink(f.photo), { contentType: 'image/jpeg' });
        v.photo = await r.getDownloadURL();
      } catch (e) { say('The photo was not saved (' + ((e && (e.code || e.message)) || e) + '); the request is.'); }
    }
    return src.db.ref(src.base + '/' + id).set(v);
  }

  /* ---------- the add form (Warehouse page and Shop page) ---------- */
  function formHtml(withProject) {
    return `<div class="ts-add">
      ${withProject ? '<select id="tsProject" aria-label="Project" style="flex:0 1 220px"></select>' : ''}
      <input type="text" class="ts-whatin" id="toSendWhat" maxlength="200" placeholder="What, e.g. SD01 sidelite" autocomplete="off">
      <button type="button" class="ts-addbtn" id="toSendAdd">Add</button>
      <button type="button" class="ts-morebtn" id="tsMoreBtn">＋ qty · date · note · photo</button>
      <div class="ts-more" id="tsMore" hidden>
        <label>Qty <input type="number" class="ts-qty" id="tsQty" min="1" max="99999" step="1" inputmode="numeric"></label>
        <label>Need by <input type="date" id="tsNeed"></label>
        <input type="text" class="ts-note" id="tsNote" maxlength="300" placeholder="Note: which piece, where it goes…" autocomplete="off">
        <label class="ts-photobtn">📷 <span id="tsPhotoName">Photo</span><input type="file" id="tsPhoto" accept="image/*"></label>
      </div>
    </div>`;
  }
  /** Wires the form; target() → the source to add to (or null with a reason said). */
  function wireForm(el, target) {
    const $ = id => el.querySelector('#' + id);
    const what = $('toSendWhat'), more = $('tsMore'), photo = $('tsPhoto'), pname = $('tsPhotoName');
    $('tsMoreBtn').onclick = () => { more.hidden = !more.hidden; };
    photo.onchange = () => { pname.textContent = photo.files && photo.files[0] ? '1 photo' : 'Photo'; };
    let busy = false;
    const add = async () => {
      const w = (what.value || '').trim().slice(0, 200);
      if (!w || busy) { if (!w) what.focus(); return; }
      const src = target(); if (!src) return;
      const qty = Math.floor(+$('tsQty').value || 0);
      const need = NEED.test($('tsNeed').value || '') ? $('tsNeed').value : '';
      const note = ($('tsNote').value || '').trim().slice(0, 300);
      busy = true; $('toSendAdd').disabled = true;
      try {
        await addRequest(src, { what: w, qty: qty > 0 && qty <= 99999 ? qty : 0, need, note, photo: photo.files && photo.files[0] });
        what.value = ''; $('tsQty').value = ''; $('tsNeed').value = ''; $('tsNote').value = ''; photo.value = ''; pname.textContent = 'Photo';
        what.focus();
      } catch (e) { fail('Could not save')(e); }
      busy = false; $('toSendAdd').disabled = false;
    };
    $('toSendAdd').onclick = add;
    what.addEventListener('keydown', e => { if (e.key === 'Enter') add(); });
  }

  /* ---------- Warehouse page: this project's list, at the top ---------- */
  /** el: the card to draw into; opts.canAdd: this account is an editor here. */
  function mountList(el, opts) {
    if (!el || el.dataset.on) return;
    el.dataset.on = '1';
    css();
    const editor = !!(opts && opts.canAdd), can = editor || isStaff();
    const P = window.PROJECT || {};
    const src = { id: P.hubId, name: P.name || P.hubId, db: firebase.database(), base: 'toSend', store: P.hubId };
    el.hidden = false;
    el.innerHTML = `<h2>🚚 To send to site <a href="../send/" style="font-size:12px;font-weight:400;margin-left:6px;color:var(--text-dim)" title="Every project's list, for the shop">all projects →</a></h2>
      ${can ? formHtml(false) : ''}
      <div id="toSendList"><div class="empty">Loading…</div></div>`;
    const list = el.querySelector('#toSendList');
    let items = {}, shop = false;
    const draw = () => {
      const now = Date.now(), r = split(items, now);
      list.innerHTML = (r.open.length ? r.open.map(x => rowHtml(x, now, { canSend: shop, canRemove: x2 => editor || x2.by === me() })).join('')
        : '<div class="ts-empty">Nothing waiting to be sent.</div>') + sentHtml(r.sent, { canSend: shop });
      wire(list, src);
    };
    src.db.ref('toSend').on('value', snap => { items = snap.val() || {}; draw(); }, () => { el.hidden = true; });
    isShop().then(v => { shop = v; draw(); });
    if (can) wireForm(el, () => src);
  }

  /* ---------- tracker: the count rides on the 📦 Warehouse link ---------- */
  const T = { items: null, on: false };
  API._tracker = T;
  function linkCount() {
    const link = document.querySelector('a[href="warehouse.html"]'); if (!link) return;
    let b = link.querySelector('.to-send-n');
    const now = Date.now(), open = T.items ? split(T.items, now).open : [];
    if (!open.length) { if (b) b.remove(); link.title = 'Warehouse'; return; }
    if (!b) { b = document.createElement('span'); b.className = 'to-send-n'; link.appendChild(b); }
    const red = open.some(x => late(x, now));
    b.textContent = '🚚 ' + open.length;
    b.style.cssText = 'margin-left:6px;font-size:11px;font-weight:600;padding:1px 7px;border-radius:999px;'
      + (red ? 'background:var(--red,#e5484d);color:#fff' : 'border:1px solid var(--border);color:var(--text-dim)');
    link.title = `${open.length} thing(s) to send to site` + (red ? ' — some are late' : '');
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
      firebase.database().ref('toSend').on('value', snap => { T.items = snap.val() || {}; linkCount(); },
        () => { T.items = null; linkCount(); });   // the GC, or no access: nothing shown
    });
    setInterval(linkCount, 60 * 60 * 1000);   // ages tick over without a reload
  }

  /* ---------- every project at once (hub overview and Shop page) ---------- */
  /** projects: the dashboard projects [{ id, name, databaseURL }]; the projects without a
      dashboard come from the hub database (the default app's). onChange(state) on every change.
      Lists this account cannot read are left out. */
  function watch(projects, onChange) {
    const S = { srcs: {}, data: {}, sites: {}, sitesOk: false };
    const fire = () => onChange(S);
    const listen = (src, path) => src.db.ref(path).on('value',
      s => { S.data[src.id] = s.val() || {}; src.ok = true; fire(); },
      () => { delete S.data[src.id]; src.ok = false; fire(); });
    (projects || []).forEach(p => {
      if (!p.databaseURL) return;
      try {
        const src = S.srcs[p.id] = { id: p.id, name: p.name, db: firebase.app().database(p.databaseURL), base: 'toSend', store: p.id, dash: true };
        listen(src, 'toSend');
      } catch (e) { console.warn('[to send] ' + p.id, e); }
    });
    const hub = firebase.database();
    hub.ref('sendSites').on('value', snap => {
      const sites = S.sites = snap.val() || {};
      S.sitesOk = true;
      Object.keys(sites).forEach(id => {
        const s = sites[id] || {};
        if (S.srcs[id]) { Object.assign(S.srcs[id], { name: s.name || id, done: !!s.done }); return; }
        const src = S.srcs[id] = { id, name: s.name || id, db: hub, base: 'toSend/' + id, store: id, site: true, done: !!s.done };
        listen(src, src.base);
      });
      Object.keys(S.srcs).filter(id => S.srcs[id].site && !sites[id]).forEach(id => {
        hub.ref('toSend/' + id).off(); delete S.srcs[id]; delete S.data[id];
      });
      fire();
    }, () => { S.sitesOk = false; S.sitesDenied = true; fire(); });   // hub rules not put yet, or not staff
    fire();
    return S;
  }
  const listsOf = S => Object.keys(S.data).filter(id => S.srcs[id]).map(id => ({ src: S.srcs[id], items: S.data[id] }));

  /* ---------- hub overview: one line and the most urgent few ---------- */
  function hub(el, projects) {
    if (!el || el.dataset.on) return;
    el.dataset.on = '1';
    css();
    watch(projects, S => {
      const now = Date.now();
      const open = [];
      groups(listsOf(S), now).forEach(g => g.open.forEach(x => open.push(Object.assign({ src: g.src }, x))));
      open.sort((a, b) => dueKey(a) - dueKey(b));
      const nLate = open.filter(x => late(x, now)).length;
      el.hidden = false;
      el.innerHTML = `<div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <h2 style="font-size:15px;margin:0">🚚 To send to site</h2>
          <span style="color:var(--text-dim);font-size:13px">${open.length ? `<b style="color:var(--text)">${open.length}</b> waiting` : 'nothing waiting'}${nLate ? ` · <span class="ts-chip red">${nLate} late</span>` : ''}</span>
          <a class="btn" href="/send/" style="margin-left:auto;text-decoration:none;font-size:13px" id="toSendOpen">Open the shop list →</a>
        </div>
        <div id="toSendTop">${open.slice(0, 3).map(x => `<div class="ts-sub" style="font-size:12.5px;margin-top:6px">
          <span class="ts-chip${late(x, now) ? ' red' : ''}">${esc(needLabel(x, now) || age(x, now))}</span>
          ${esc(x.src.name)} · ${esc(x.what)}${+x.qty ? ' ×' + esc(+x.qty) : ''}</div>`).join('')}${open.length > 3 ? `<div class="ts-sub" style="margin-top:4px">+ ${open.length - 3} more</div>` : ''}</div>`;
    });
  }

  /* ---------- Shop page: every project, grouped, most urgent first ---------- */
  /** el: the page's main element (has #shopAdd, #shopFilter, #shopList, #shopSent, #shopSites, #shopCount). */
  function shop(el, projects) {
    if (!el || el.dataset.on) return;
    el.dataset.on = '1';
    css();
    const $ = id => el.querySelector('#' + id) || document.getElementById(id);
    const staff = isStaff();
    let shopper = false;
    let filter = '', lastProject = '';
    try { lastProject = localStorage.getItem('afSendProject') || ''; } catch (e) {}
    $('shopAdd').innerHTML = formHtml(true);
    const sel = $('tsProject');
    let S = null;
    wireForm($('shopAdd'), () => {
      const src = S && S.srcs[sel.value];
      if (!src) { say('Choose the project first.'); sel.focus(); return null; }
      try { localStorage.setItem('afSendProject', sel.value); } catch (e) {}
      return src;
    });

    const liveSrcs = () => Object.values(S.srcs).filter(s => !s.done && (s.ok || s.site)).sort((a, b) => String(a.name).localeCompare(String(b.name)));
    const projectOptions = () => '<option value="">Project…</option>' + liveSrcs().map(s => `<option value="${esc(s.id)}">${esc(s.name)}${s.site ? '' : ' ●'}</option>`).join('');
    const fillSelect = () => {
      const keep = sel.value || lastProject;
      sel.innerHTML = projectOptions() + (staff ? '<option value="__new">＋ New project (no dashboard)…</option>' : '');
      if (liveSrcs().some(s => s.id === keep)) sel.value = keep;
      sel.dataset.prev = sel.value;
      const wp = $('wcProject');
      if (wp) { const k = wp.value || keep; wp.innerHTML = projectOptions(); if (liveSrcs().some(s => s.id === k)) wp.value = k; }
    };
    // "＋ New project…" in the list: ask for the name, add it, select it.
    sel.addEventListener('change', () => {
      if (sel.value !== '__new') { sel.dataset.prev = sel.value; return; }
      const prev = sel.dataset.prev || '';
      sel.value = prev;
      newSite().then(id => { if (id) { sel.value = id; sel.dataset.prev = id; } });
    });
    const draw = () => {
      const now = Date.now(), lists = listsOf(S);
      const gs = groups(lists, now);
      const nOpen = gs.reduce((n, g) => n + g.open.length, 0), nLate = gs.reduce((n, g) => n + g.open.filter(x => late(x, now)).length, 0);
      $('shopCount').innerHTML = nOpen ? `<b>${nOpen}</b> waiting${nLate ? ` · <span class="ts-chip red">${nLate} late</span>` : ''}` : 'Nothing waiting.';
      if (filter && !gs.some(g => g.src.id === filter)) filter = '';
      $('shopFilter').innerHTML = gs.length > 1 ? [`<button type="button" class="chip${filter ? '' : ' on'}" data-f="">All ${nOpen}</button>`]
        .concat(gs.map(g => `<button type="button" class="chip${filter === g.src.id ? ' on' : ''}${g.open.some(x => late(x, now)) ? ' late' : ''}" data-f="${esc(g.src.id)}">${esc(g.src.name)} ${g.open.length}</button>`)).join('') : '';
      $('shopFilter').querySelectorAll('[data-f]').forEach(b => b.onclick = () => { filter = b.dataset.f; draw(); });
      const shown = gs.filter(g => !filter || g.src.id === filter);
      $('shopList').innerHTML = shown.length ? shown.map(g => `<section class="grp" data-src="${esc(g.src.id)}">
          <h3>${esc(g.src.name)} <span>${g.open.length}${g.src.site ? ' · no dashboard yet' : ''}</span></h3>
          ${g.open.map(x => rowHtml(x, now, { big: true, canSend: shopper, canRemove: x2 => x2.by === me() })).join('')}
        </section>`).join('') : '<div class="ts-empty" style="padding:24px 0;text-align:center">Nothing waiting to be sent. 🎉</div>';
      shown.forEach(g => wire($('shopList').querySelector(`[data-src="${CSS.escape(g.src.id)}"]`), g.src));
      // sent this week, newest first, each with its project
      const sent = [];
      lists.forEach(l => split(l.items, now).sent.forEach(x => sent.push(Object.assign({ src: l.src }, x))));
      sent.sort((a, b) => (+b.sent.at || 0) - (+a.sent.at || 0));
      $('shopSent').innerHTML = sent.length ? sentHtml(sent, { title: 'Sent in the last 7 days', project: x => x.src.name, canSend: shopper }) : '';
      const who = $('shopWho');
      if (who) who.textContent = shopper ? '' : 'Only the shop marks things Sent. You can see the list and add to it.';
      $('shopSent').querySelectorAll('[data-unsend]').forEach(b => {
        const x = sent.find(s => s.id === b.dataset.unsend);
        if (x) b.onclick = () => unsend(x.src, x.id).catch(fail('Could not save'));
      });
      drawSites();
      fillSelect();
    };
    const drawSites = () => {
      const box = $('shopSites');
      if (!staff) { box.innerHTML = ''; return; }
      if (!S.sitesOk) {
        box.innerHTML = !S.sitesDenied ? '' : `<div class="ts-empty">Projects without a dashboard are not switched on yet: the hub database needs its new rules
          (GitHub → Actions → Project database → Run workflow: mode <b>rules</b>, project <b>hub</b>). Then reload this page.</div>`;
        return;
      }
      const ids = Object.keys(S.sites).sort((a, b) => String(S.sites[a].name).localeCompare(String(S.sites[b].name)));
      box.innerHTML = `<details><summary>Projects without a dashboard (${ids.length})</summary>
        <div style="margin:8px 0">${ids.map(id => `<label style="display:flex;gap:8px;align-items:center;padding:3px 0;font-size:13px">
          <input type="checkbox" data-done="${esc(id)}"${S.sites[id].done ? ' checked' : ''}> ${esc(S.sites[id].name)} <span style="color:var(--text-dim);font-size:11.5px">finished (hide)</span></label>`).join('') || '<div class="ts-empty">None yet.</div>'}</div>
        <button type="button" class="ts-morebtn" id="shopNewSite">＋ Project without a dashboard</button></details>`;
      if (box.dataset.open) box.querySelector('details').open = true;
      box.querySelector('details').ontoggle = e => { box.dataset.open = e.target.open ? '1' : ''; };
      box.querySelectorAll('[data-done]').forEach(c => c.onchange = () => firebase.database().ref('sendSites/' + c.dataset.done + '/done').set(c.checked).catch(fail('Could not save')));
      $('shopNewSite').onclick = () => newSite();
    };
    function newSite(name) {
      if (!S.sitesOk) { say(S.sitesDenied ? 'Projects without a dashboard are not switched on yet: run GitHub → Actions → Project database (mode rules, project hub), then reload.' : 'Still loading, try again in a moment.'); return Promise.resolve(null); }
      name = (name || prompt('Project name (it has no dashboard yet), e.g. Package 7') || '').trim().slice(0, 80);
      if (!name) return Promise.resolve(null);
      const existing = Object.keys(S.sites).find(id => String(S.sites[id].name).toLowerCase() === name.toLowerCase());
      if (existing) { firebase.database().ref('sendSites/' + existing + '/done').set(false).catch(() => {}); sel.value = existing; return Promise.resolve(existing); }
      const id = siteId(name, Object.assign({}, S.sites, S.srcs));
      return firebase.database().ref('sendSites/' + id).set({ name, by: me(), at: TS() })
        .then(() => { lastProject = id; sel.value = id; return id; })
        .catch(e => { fail('Could not add the project')(e); return null; });
    }
    API._newSite = newSite;

    /* ---------- 📋 Record from WeChat (staff): paste the chat, check the lines, add them ---------- */
    const wc = $('shopWeChat');
    let wcShot = null, wcList = [];
    if (wc && staff) {
      wc.hidden = false;
      wc.innerHTML = `<details id="wcBox"><summary style="cursor:pointer;font-weight:600">📋 Record from WeChat
          <span style="font-weight:400;color:var(--text-dim);font-size:12.5px">paste the chat → check → add, with who asked and when</span></summary>
        <div class="ts-add" style="margin-top:10px">
          <select id="wcProject" aria-label="Project for these messages" style="flex:0 1 240px"></select>
          <label class="ts-photobtn">📷 <span id="wcShotName">Screenshot (proof)</span><input type="file" id="wcShot" accept="image/*"></label>
        </div>
        <textarea id="wcText" rows="6" style="width:100%;box-sizing:border-box;background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:9px 11px;font:inherit;font-size:14px;color:var(--text)"
          placeholder="In WeChat select the messages → Copy, then paste here. You can paste a screenshot too (Ctrl+V)."></textarea>
        <div style="display:flex;gap:8px;align-items:center;margin-top:6px"><button type="button" class="ts-addbtn" id="wcRead">Read it</button><span id="wcMsg" class="ts-sub"></span></div>
        <div id="wcRows" style="margin-top:8px"></div></details>`;
      const shotName = () => { $('wcShotName').textContent = wcShot ? '1 screenshot' : 'Screenshot (proof)'; };
      $('wcShot').onchange = e => { wcShot = (e.target.files || [])[0] || null; shotName(); };
      $('wcText').addEventListener('paste', e => {
        const f = [...((e.clipboardData && e.clipboardData.files) || [])].find(x => /^image\//.test(x.type));
        if (f) { wcShot = f; shotName(); e.preventDefault(); }
      });
      const when = t => (t ? new Date(t).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }) : 'now');
      $('wcRead').onclick = () => {
        wcList = parseChat($('wcText').value, Date.now());
        $('wcMsg').textContent = wcList.length ? `${wcList.length} line(s) — untick what isn't a request, fix anything, then add.` : 'Nothing to add in that text.';
        const opts = projectOptions(), def = $('wcProject').value;
        $('wcRows').innerHTML = wcList.length ? wcList.map((r, i) => `<div class="ts-add wc-row" data-i="${i}" style="align-items:center;margin-bottom:4px">
            <input type="checkbox" class="wcc" checked aria-label="Add this line" style="width:18px;height:18px">
            <select class="wcp" style="flex:0 1 170px">${opts}</select>
            <input type="text" class="wcw ts-whatin" maxlength="200" value="${esc(r.what)}">
            <input type="number" class="wcq" min="1" max="99999" placeholder="qty" value="${r.qty || ''}" style="width:80px">
            <input type="text" class="wcb" maxlength="80" placeholder="who asked" value="${esc(r.askedBy)}" style="width:120px">
            <span class="ts-sub" title="${esc(r.quote)}">${esc(when(r.askedAt))}</span></div>`).join('')
          + `<button type="button" class="ts-addbtn" id="wcAdd" style="margin-top:6px">Add ${wcList.length} to the list</button>` : '';
        $('wcRows').querySelectorAll('.wcp').forEach(x => { x.value = def; });
        const btn = $('wcAdd');
        const count = () => { if (btn) btn.textContent = `Add ${$('wcRows').querySelectorAll('.wcc:checked').length} to the list`; };
        $('wcRows').querySelectorAll('.wcc').forEach(c => c.onchange = count);
        if (btn) btn.onclick = addAll;
      };
      async function addAll() {
        const rows = [...$('wcRows').querySelectorAll('.wc-row')].filter(r => r.querySelector('.wcc').checked).map(r => {
          const base = wcList[+r.dataset.i] || {};
          const q = Math.floor(+r.querySelector('.wcq').value || 0);
          return { src: S.srcs[r.querySelector('.wcp').value], what: r.querySelector('.wcw').value.trim().slice(0, 200), qty: q > 0 && q <= 99999 ? q : 0,
            askedBy: r.querySelector('.wcb').value.trim().slice(0, 80), askedAt: base.askedAt || 0, quote: base.quote || '' };
        }).filter(r => r.what);
        if (!rows.length) { say('Nothing ticked.'); return; }
        if (rows.some(r => !r.src)) { say('Choose the project for every line.'); return; }
        const btn = $('wcAdd'); btn.disabled = true; btn.textContent = 'Adding…';
        let photoUrl = '';
        if (wcShot) {
          try {
            const r = firebase.storage().ref(`p/${rows[0].src.store}/send/wechat-${Date.now()}.jpg`);
            await r.put(await shrink(wcShot), { contentType: 'image/jpeg' });
            photoUrl = await r.getDownloadURL();
          } catch (e) { say('The screenshot was not saved (' + ((e && (e.code || e.message)) || e) + '); the lines are.'); }
        }
        let n = 0;
        for (const r of rows) {
          try {
            await addRequest(r.src, { what: r.what, qty: r.qty, askedBy: r.askedBy, askedAt: r.askedAt, src: 'wechat',
              note: r.quote && r.quote !== r.what ? r.quote.slice(0, 300) : '', photoUrl });
            n++;
          } catch (e) { fail('Could not save "' + r.what.slice(0, 40) + '"')(e); }
        }
        $('wcMsg').textContent = `✓ ${n} added${photoUrl ? ', with the screenshot' : ''}.`;
        $('wcRows').innerHTML = ''; $('wcText').value = ''; wcShot = null; shotName(); wcList = [];
      }
    }
    watch(projects, st => { S = st; draw(); });
    isShop().then(v => { shopper = v; if (S) draw(); });
    setInterval(() => S && draw(), 60 * 60 * 1000);
  }

  Object.assign(API, { mountList, hub, shop, watch, startTracker });
  // A tracker page (not the warehouse page, which mounts the list itself).
  if (typeof window !== 'undefined' && window.PROJECT && window.PROJECT.hubId && document.querySelector('script[src*="core/app.js"]')) {
    if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => startTracker()); else startTracker();
  }
})(typeof window !== 'undefined' ? window : globalThis);
