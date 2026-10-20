/* ============================================================
   📬 Follow-up (Leo, 2026-10-20) — /followup/
   ------------------------------------------------------------
   Outlook folders are no use for "did they answer me?": a team lead with
   eight projects doesn't reply, the email sinks, and three days later nobody
   remembers where it went. This page reads the mailbox (Microsoft Graph,
   read-only, in the browser — no mail is stored anywhere) and lists, per
   project, what needs following up:

     ⏳ Waiting  — the last email in the conversation is mine, to someone
                   else, and nobody has answered. Due to nudge after N
                   working days (default 3).
     ↩ To reply — the last email is someone else's, sent TO me (not just cc),
                   and not filed in an Archive / Reference folder.
     🚩 Flagged  — flagged in Outlook (any age), plus to-dos added by hand.

   Anything answered drops off by itself: a reply makes the conversation's
   last email theirs (or mine again). "Done" and "Snooze" are remembered per
   conversation only up to its last email — a new email brings it back.

   Project = (1) what I picked on the row, else (2) the Outlook project folder
   any email of the conversation is filed in (CP2, AC3, 355 Lex …: the
   top-level folders), else (3) a project keyword in the subject / preview,
   else (4) the people: an address that almost only appears in one project's
   folders. Otherwise "Not sorted" — pick one on the row.

   Stored (hub database, /followup/<uid>, only that user reads or writes it):
   marks per conversation { s: done|snooze, at, when, until?, p? }, hand-added
   to-dos, and settings (days, look-back, keywords, Microsoft app id).
   ============================================================ */
(function (root) {
  'use strict';
  const D = 864e5;
  const API = {};
  API.NUDGE_DAYS = 3;     // working days before a waiting email is due a nudge
  API.WINDOW = 45;        // days of mail to read
  API.REPLY_DUE = 2;      // working days before an unanswered email to me turns red

  // ------------------------------------------------------------ helpers
  const lc = s => String(s == null ? '' : s).toLowerCase();
  const addrOf = r => lc(r && r.emailAddress && r.emailAddress.address).trim();
  const nameOf = r => {
    const e = (r && r.emailAddress) || {};
    const n = String(e.name || '').trim();
    return n && n.indexOf('@') < 0 ? n : String(e.address || n || '').split('@')[0];
  };
  const firstName = n => String(n || '').replace(/,.*$/, '').trim().split(/\s+/)[0] || '';
  const tOf = m => Date.parse((m && (m.receivedDateTime || m.sentDateTime)) || 0) || 0;
  API.esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const esc = API.esc;

  /* Conversation id → a short database key (Graph ids hold / + = which RTDB keys can't). */
  API.key = function (s) {
    s = String(s || '');
    let h1 = 0x811c9dc5, h2 = 0x01000193 ^ s.length;
    for (let i = 0; i < s.length; i++) {
      const c = s.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = Math.imul(h2 ^ c, 2246822519) >>> 0;
      h2 = (h2 ^ (h2 >>> 13)) >>> 0;
    }
    return 'c' + h1.toString(36) + h2.toString(36);
  };

  const pad = n => String(n).padStart(2, '0');
  API.ymd = ms => { const d = new Date(ms); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
  const dayStart = ms => { const d = new Date(ms); d.setHours(0, 0, 0, 0); return d.getTime(); };
  /* Whole calendar days between two moments (by local date). */
  API.days = (from, to) => Math.max(0, Math.round((dayStart(to) - dayStart(from)) / D));
  /* Working days (Mon–Fri) after the day of `from`, up to and including the day of `to`. */
  API.workdays = function (from, to) {
    let n = 0;
    const d = new Date(dayStart(from)), end = dayStart(to);
    for (let i = 0; i < 400; i++) {
      d.setDate(d.getDate() + 1);
      if (d.getTime() > end) break;
      const w = d.getDay();
      if (w !== 0 && w !== 6) n++;
    }
    return n;
  };
  /* The date a snooze ends: 'tomorrow' | n days | 'mon' (next Monday). */
  API.snoozeUntil = function (what, now) {
    const d = new Date(dayStart(now));
    if (what === 'mon') { do d.setDate(d.getDate() + 1); while (d.getDay() !== 1); }
    else d.setDate(d.getDate() + (Number(what) || 1));
    return API.ymd(d.getTime());
  };

  /* Automatic mail: meeting traffic, out-of-office, bounces, no-reply senders. Never a reply. */
  const AUTO_FROM = /(^|[._-])(no-?reply|do-?not-?reply|donotreply|notifications?|mailer-daemon|postmaster|bounce[sd]?|calendar-notification|alerts?)([._@+-]|$)/i;
  const AUTO_SUBJ = /^\s*(automatic reply|auto(matic)?[- ]?reply|out of (the )?office|accepted|declined|tentative|tentatively accepted|canceled|cancelled|invitation|updated invitation|new time proposed|undeliverable|delivery (status|has failed)|mail delivery|read|not read|recall)\b\s*:/i;
  API.isAuto = function (m) {
    if (!m) return true;
    if (/eventMessage/i.test(m['@odata.type'] || '')) return true;
    if (AUTO_FROM.test(addrOf(m.from).split('@')[0] + '@')) return true;
    return AUTO_SUBJ.test(m.subject || '');
  };

  /* "Thanks!" / "Noted" / "收到" replies close a thread — nobody owes me anything. */
  const ACK1 = '(thanks?( you)?( so much| a lot| very much)?|thx|ty|noted|received|well received|got it|will do|ok(ay)?|sounds good|great|perfect|copy( that)?|understood|appreciated?|收到|好的|谢谢|明白)';
  const ACK = new RegExp('^(hi|hello|dear)?[\\s\\w.,]{0,20}?' + ACK1 + '([\\s!.,，。！~]*' + ACK1 + ')*[\\s!.,，。！~😊🙏]*$', 'iu');
  API.isAck = function (m) {
    if (!m || !/^\s*(re|aw|答复|回复)\s*[:：]/i.test(m.subject || '')) return false;
    const p = String(m.bodyPreview || '').replace(/\s+/g, ' ').trim();
    if (!p) return false;
    const first = p.split(/(?<=[.!。！])\s|\s(?=(?:best|regards|sincerely|cheers|leo)\b)/i)[0].trim();
    if (first.length > 60 || /\?|？|\b(please|pls|kindly|can you|could you|would you|let me know|confirm|need|send|provide|advise)\b|请|麻烦/i.test(p.slice(0, 160))) return false;
    return ACK.test(first) || ACK.test(first.replace(/^[^,]{0,25},\s*/, ''));
  };

  const cleanSubj = s => String(s || '').replace(/^\s*((re|fw|fwd|aw|答复|回复|转发)\s*[:：]\s*)+/i, '').trim() || '(no subject)';
  API.cleanSubj = cleanSubj;

  // --------------------------------------------------------- folders
  const SYSTEM = /^(rss feeds|rss subscriptions|conversation history|sync issues|notes|journal|outbox|scheduled|snoozed|clutter|social activity notifications|quick step settings|yammer root|files|externalcontacts|personmetadata|calendar|contacts|tasks)$/i;
  const ROLE = [
    [/archiv/i, 'archive'],
    [/reference|^0?3[_ ]/i, 'reference'],
    [/action|to ?do|todo/i, 'action'],
    [/await|waiting|pending/i, 'waiting'],
  ];
  /* folders: [{ id, displayName, parentFolderId }], wk: { inbox: id, sentitems: id, archive: id, … }.
     → { projects: [names], byId: { id: { name, project, role, wk, depth } } } */
  API.folders = function (folders, wk, skip) {
    wk = wk || {}; skip = new Set((skip || []).map(lc));
    const byWkId = {};
    Object.keys(wk).forEach(k => { if (wk[k]) byWkId[wk[k]] = k; });
    const raw = {};
    (folders || []).forEach(f => { if (f && f.id) raw[f.id] = f; });
    const rootId = wk.msgfolderroot || ((folders || []).find(f => byWkId[f.id] === 'inbox') || {}).parentFolderId;
    const out = {}, projects = [];
    const visit = (id, guard) => {
      if (out[id]) return out[id];
      const f = raw[id];
      if (!f || guard > 12) return null;
      const parent = f.parentFolderId && f.parentFolderId !== rootId ? visit(f.parentFolderId, guard + 1) : null;
      const top = !parent;
      const w = byWkId[id] || null;
      let role = w === 'archive' ? 'archive' : null;
      if (!role && !w) for (const [re, r] of ROLE) if (re.test(f.displayName || '')) { role = r; break; }
      if (!role && parent) role = parent.role;
      let project = parent ? parent.project : null;
      if (top && !w && !SYSTEM.test(f.displayName || '') && !skip.has(lc(f.displayName)) && !role) project = f.displayName;
      const o = { name: f.displayName || '', project, role, wk: w || (parent && /deleteditems|junkemail|drafts|outbox|conversationhistory/.test(parent.wk || '') ? parent.wk : null), depth: parent ? parent.depth + 1 : 0, top };
      out[id] = o;
      return o;
    };
    (folders || []).forEach(f => visit(f.id, 0));
    (folders || []).forEach(f => { const o = out[f.id]; if (o && o.top && o.project && projects.indexOf(o.project) < 0) projects.push(o.project); });
    return { projects, byId: out };
  };
  /* Folders whose mail never counts (deleted, junk, drafts, outbox, Teams chat history). */
  const DEAD = /^(deleteditems|junkemail|drafts|outbox|conversationhistory)$/;

  // --------------------------------------------------------- keywords
  const KNOWN = [
    [/^(cp2|cooper|copper)/i, 'CP2, Cooper Park, Copper Park, Broadway Builder'],
    [/^ac3|atlantic|chestnut/i, 'AC3, Atlantic Chestnut, Atlantic-Chestnut, Monadnock'],
    [/lex/i, '355 Lex, 355 Lexington, Lexington Ave, Promethean'],
    [/forest/i, 'Forest Hill'],
    [/package|pkg/i, 'Package 7, Package #7, Package#7, Pkg 7, PKG7'],
    [/morgan|^mn$/i, 'Morgan North'],
  ];
  /* The default keywords for a project folder: known ones for AF's projects, else its own name. */
  API.defaultKeywords = function (folderName) {
    for (const [re, kw] of KNOWN) if (re.test(folderName || '')) return kw;
    return String(folderName || '').replace(/[#_]/g, ' ').trim();
  };
  const kwCache = {};
  /* One keyword → a matcher. Short ALL-CAPS codes (AC3, CP2, JEAN) are case-sensitive, so "Jean" the person is not the JEAN project. */
  const kwRe = k => {
    if (kwCache[k]) return kwCache[k];
    const s = k.trim().replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]*');
    const cs = /^[A-Z0-9#]{2,5}$/.test(k.trim());
    return (kwCache[k] = new RegExp('(^|[^A-Za-z0-9])' + s + '(?![A-Za-z0-9])', cs ? '' : 'i'));
  };
  API.keywordProject = function (text, kw) {
    if (!text) return null;
    const hits = [];
    Object.keys(kw || {}).forEach(p => {
      const list = String(kw[p] || '').split(/[,;\n]/).map(s => s.trim()).filter(s => s.length >= 2);
      if (list.some(k => kwRe(k).test(text))) hits.push(p);
    });
    return hits.length === 1 ? hits[0] : null;
  };

  // --------------------------------------------------------- the lists
  /* raw: { me: [addresses], folders, wk, messages, flagged, samples }
     store: { marks: { key: mark }, todos: { id: todo }, cfg }
     → { items, projects, hidden: { done:[], snoozed:[] }, stats } */
  API.build = function (raw, store, now) {
    raw = raw || {}; store = store || {};
    const cfg = store.cfg || {};
    const prefs = API.prefs(cfg);
    const nudge = Number(cfg.days) || API.NUDGE_DAYS;
    const marks = store.marks || {};
    const F = API.folders(raw.folders, raw.wk, prefs.skip);
    const finfo = id => F.byId[id] || {};
    const me = new Set((raw.me || []).map(lc).filter(Boolean));
    (raw.messages || []).forEach(m => { if (finfo(m.parentFolderId).wk === 'sentitems' && addrOf(m.from)) me.add(addrOf(m.from)); });
    const isMe = a => me.has(a);
    const kw = {};
    F.projects.forEach(p => { kw[p] = prefs.kw[p] != null ? prefs.kw[p] : API.defaultKeywords(p); });

    // people: which project's folders an address shows up in
    const people = {};
    const seenIds = new Set();
    const learn = m => {
      if (!m || seenIds.has(m.id)) return;
      seenIds.add(m.id);
      const p = finfo(m.parentFolderId).project;
      if (!p) return;
      [m.from].concat(m.toRecipients || [], m.ccRecipients || []).forEach(r => {
        const a = addrOf(r);
        if (!a || isMe(a)) return;
        (people[a] = people[a] || {})[p] = (people[a][p] || 0) + 1;
      });
    };
    (raw.samples || []).forEach(learn);
    (raw.messages || []).forEach(learn);
    const owner = a => {
      const c = people[a];
      if (!c) return null;
      let tot = 0, best = null;
      Object.keys(c).forEach(p => { tot += c[p]; if (!best || c[p] > c[best]) best = p; });
      return c[best] >= 2 && c[best] >= 0.8 * tot ? best : null;
    };

    // folder evidence per conversation (window mail + older samples)
    const convFolders = {};
    const noteFolder = m => {
      const p = finfo(m.parentFolderId).project;
      if (p && m.conversationId) (convFolders[m.conversationId] = convFolders[m.conversationId] || {})[p] = ((convFolders[m.conversationId] || {})[p] || 0) + 1;
    };
    (raw.samples || []).forEach(noteFolder);

    // conversations
    const convs = {};
    let total = 0;
    (raw.messages || []).forEach(m => {
      if (!m || m.isDraft || !m.conversationId) return;
      const fi = finfo(m.parentFolderId);
      if (DEAD.test(fi.wk || '')) return;
      total++;
      noteFolder(m);
      (convs[m.conversationId] = convs[m.conversationId] || []).push(m);
    });

    const projectOf = (cid, msgs, mark) => {
      if (mark && mark.p) return { p: mark.p, src: 'you' };
      const f = convFolders[cid];
      if (f) { const best = Object.keys(f).sort((a, b) => f[b] - f[a])[0]; if (best) return { p: best, src: 'folder' }; }
      const last = msgs[msgs.length - 1];
      let p = API.keywordProject(cleanSubj(last.subject), kw);
      if (!p) for (const m of msgs) if ((p = API.keywordProject(cleanSubj(m.subject), kw))) break;
      if (!p) for (let i = msgs.length - 1; i >= 0 && !p; i--) p = API.keywordProject(msgs[i].bodyPreview, kw);
      if (p) return { p, src: 'keyword' };
      const votes = {};
      msgs.forEach(m => [m.from].concat(m.toRecipients || [], m.ccRecipients || []).forEach(r => {
        const o = owner(addrOf(r));
        if (o) votes[o] = (votes[o] || 0) + 1;
      }));
      const vs = Object.keys(votes).sort((a, b) => votes[b] - votes[a]);
      if (vs.length && (vs.length === 1 || votes[vs[0]] > votes[vs[1]])) return { p: vs[0], src: 'people' };
      return { p: null, src: null };
    };

    const today = API.ymd(now);
    const items = [], done = [], snoozed = [];
    let acks = 0;
    const flaggedConv = new Set((raw.flagged || []).filter(m => m && m.conversationId).map(m => m.conversationId));
    const place = (it, mark) => {
      if (mark && mark.s === 'done' && it.t <= (mark.at || 0)) { it.mark = mark; done.push(it); return; }
      if (mark && mark.s === 'snooze' && it.t <= (mark.at || 0) && String(mark.until || '') > today) { it.mark = mark; snoozed.push(it); return; }
      items.push(it);
    };

    Object.keys(convs).forEach(cid => {
      const msgs = convs[cid].sort((a, b) => tOf(a) - tOf(b));
      const real = msgs.filter(m => !API.isAuto(m));
      const last = real[real.length - 1];
      if (!last) return;
      const k = API.key(cid);
      const mark = marks[k];
      const mine = isMe(addrOf(last.from)) || finfo(last.parentFolderId).wk === 'sentitems';
      const flag = flaggedConv.has(cid);
      let type = null;
      const base = () => {
        const pr = projectOf(cid, msgs, mark);
        return {
          key: k, conv: cid, project: pr.p, src: pr.src, subject: cleanSubj(last.subject),
          t: tOf(last), days: API.days(tOf(last), now), wd: API.workdays(tOf(last), now),
          link: last.webLink || '', preview: String(last.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 220),
          n: msgs.length, flag, unread: !mine && last.isRead === false,
        };
      };
      if (mine) {
        const to = (last.toRecipients || []).filter(r => addrOf(r) && !isMe(addrOf(r)));
        const cc = (last.ccRecipients || []).filter(r => addrOf(r) && !isMe(addrOf(r)));
        if (!to.length && !cc.length) { if (!flag) return; }
        else if (API.isAck(last) && !flag) { acks++; return; }
        else type = 'wait';
        const it = base();
        it.type = type || 'flag';
        it.with = (to.length ? to : cc).map(nameOf);
        it.withFirst = firstName((to[0] || cc[0]) ? nameOf(to[0] || cc[0]) : '');
        it.due = it.type === 'wait' ? it.wd >= nudge : false;
        place(it, mark);
        return;
      }
      const fi = finfo(last.parentFolderId);
      const filed = fi.role === 'archive' || fi.role === 'reference';
      const toMe = (last.toRecipients || []).some(r => isMe(addrOf(r)));
      const other = last.inferenceClassification === 'other' && fi.wk === 'inbox';
      if (!filed && !other && (toMe || fi.role === 'action')) type = 'reply';
      else if (!flag) return;
      const it = base();
      it.type = type || 'flag';
      it.with = [nameOf(last.from)];
      it.withFirst = firstName(nameOf(last.from));
      it.due = it.type === 'reply' ? it.wd >= API.REPLY_DUE : false;
      place(it, mark);
    });

    // flagged emails from outside the window, or whose conversation had nothing to do
    const have = new Set(items.concat(done, snoozed).map(i => i.conv));
    (raw.flagged || []).forEach(m => {
      if (!m || !m.conversationId || have.has(m.conversationId)) return;
      have.add(m.conversationId);
      const k = API.key(m.conversationId), mark = marks[k];
      const pr = projectOf(m.conversationId, [m], mark);
      const dd = m.flag && m.flag.dueDateTime && m.flag.dueDateTime.dateTime;
      const dueAt = dd ? Date.parse(String(dd).slice(0, 19) + 'Z') || 0 : 0;
      place({
        key: k, conv: m.conversationId, project: pr.p, src: pr.src, type: 'flag', subject: cleanSubj(m.subject),
        t: tOf(m), days: API.days(tOf(m), now), wd: API.workdays(tOf(m), now), link: m.webLink || '',
        preview: String(m.bodyPreview || '').replace(/\s+/g, ' ').trim().slice(0, 220), n: 1, flag: true,
        with: [nameOf(m.from)], withFirst: firstName(nameOf(m.from)), due: !!dueAt && dueAt <= now, dueAt,
      }, mark);
    });

    // to-dos added by hand
    const todos = store.todos || {};
    Object.keys(todos).forEach(id => {
      const td = todos[id];
      if (!td || !td.what) return;
      const it = {
        key: 't_' + id, todo: id, type: 'todo', project: td.p || null, src: td.p ? 'you' : null, subject: td.what,
        t: td.at || 0, days: API.days(td.at || now, now), wd: API.workdays(td.at || now, now), link: '', preview: td.note || '',
        n: 0, with: [], need: td.due || '', due: !!td.due && td.due <= today,
      };
      if (td.done) { it.mark = { when: td.done }; done.push(it); } else items.push(it);
    });

    const projects = F.projects.slice();
    items.concat(done, snoozed).forEach(i => { if (i.project && projects.indexOf(i.project) < 0) projects.push(i.project); });
    return {
      items: API.sort(items), projects,
      hidden: { done: done.sort((a, b) => ((b.mark && b.mark.when) || 0) - ((a.mark && a.mark.when) || 0)), snoozed },
      stats: { mail: total, convs: Object.keys(convs).length, acks, nudge },
      kw,
    };
  };

  const TYPE_ORDER = { wait: 0, reply: 1, flag: 2, todo: 3 };
  /* Due first; then the oldest first (the longest someone has been waiting). */
  API.sort = items => items.sort((a, b) => (b.due - a.due) || (a.t - b.t) || (TYPE_ORDER[a.type] - TYPE_ORDER[b.type]));

  /* Items → project groups: projects with something due first, then by how much is open; "Not sorted" last. */
  API.groups = function (items, projects) {
    const g = {};
    (projects || []).forEach(p => { g[p] = []; });
    const none = [];
    items.forEach(i => { if (i.project) (g[i.project] = g[i.project] || []).push(i); else none.push(i); });
    const out = Object.keys(g).filter(p => g[p].length).map(p => ({ name: p, items: g[p], due: g[p].filter(i => i.due).length }));
    out.sort((a, b) => (b.due - a.due) || (b.items.length - a.items.length) || a.name.localeCompare(b.name));
    if (none.length) out.push({ name: null, items: none, due: none.filter(i => i.due).length });
    return out;
  };

  /* Settings kept as one JSON string (cfg.prefs): { kw: { project: "a, b" }, skip: [folder], nudgeText }. */
  API.prefs = function (cfg) {
    let p = {};
    try { p = JSON.parse((cfg && cfg.prefs) || '{}') || {}; } catch (e) { p = {}; }
    return { kw: p.kw || {}, skip: Array.isArray(p.skip) ? p.skip : [], nudgeText: p.nudgeText || '' };
  };
  API.NUDGE_TEXT = 'Hi {name},\n\nJust following up on my email below — any update on this?\n\nThanks,';
  API.nudgeText = (it, prefs) => String((prefs && prefs.nudgeText) || API.NUDGE_TEXT).replace(/\{name\}/g, it.withFirst || 'all').replace(/\{subject\}/g, it.subject);

  // --------------------------------------------------------- Microsoft Graph
  const GRAPH = 'https://graph.microsoft.com/v1.0';
  const SEL = 'id,conversationId,subject,from,toRecipients,ccRecipients,receivedDateTime,sentDateTime,parentFolderId,isDraft,isRead,flag,webLink,bodyPreview,inferenceClassification';
  const WK = ['msgfolderroot', 'inbox', 'sentitems', 'drafts', 'deleteditems', 'junkemail', 'outbox', 'archive', 'conversationhistory'];
  /* getToken: () => Promise<access token>. Read-only: GET only. */
  API.graph = function (getToken, fetchImpl) {
    const f = fetchImpl || (typeof fetch !== 'undefined' ? fetch.bind(root) : null);
    async function get(url, tries) {
      const tok = await getToken();
      const r = await f(url.startsWith('http') ? url : GRAPH + url, { headers: { Authorization: 'Bearer ' + tok, Prefer: 'outlook.timezone="UTC"' } });
      if ((r.status === 429 || r.status === 503) && (tries || 0) < 3) {
        const h = r.headers && r.headers.get ? r.headers.get('Retry-After') : null;
        const wait = h != null && isFinite(Number(h)) ? Math.min(10, Number(h)) : 2;
        await new Promise(res => setTimeout(res, wait * 1000));
        return get(url, (tries || 0) + 1);
      }
      if (!r.ok) {
        let msg = r.status + '';
        try { const j = await r.json(); msg += ' ' + ((j.error && (j.error.code + ': ' + j.error.message)) || ''); } catch (e) {}
        const err = new Error('Outlook: ' + msg); err.status = r.status; throw err;
      }
      return r.json();
    }
    async function all(url, max) {
      const out = [];
      let next = url;
      while (next && out.length < max) {
        const j = await get(next);
        (j.value || []).forEach(v => out.push(v));
        next = j['@odata.nextLink'];
      }
      return out.slice(0, max);
    }
    async function pool(list, n, fn) {
      const res = new Array(list.length);
      let i = 0;
      await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
        while (i < list.length) { const k = i++; try { res[k] = await fn(list[k]); } catch (e) { res[k] = null; } }
      }));
      return res;
    }
    return {
      get, all,
      async me() {
        let u;
        try { u = await get('/me?$select=mail,userPrincipalName,displayName,proxyAddresses'); }
        catch (e) { u = await get('/me?$select=mail,userPrincipalName,displayName'); }
        const a = [u.mail, u.userPrincipalName].concat((u.proxyAddresses || []).map(x => String(x).replace(/^smtp:/i, '')));
        return { name: u.displayName || '', addresses: a.filter(Boolean).map(lc) };
      },
      async folders() {
        const top = await all('/me/mailFolders?$top=250&$select=id,displayName,parentFolderId,childFolderCount', 1000);
        const list = top.slice();
        let level = top.filter(x => x.childFolderCount > 0);
        for (let depth = 0; depth < 4 && level.length; depth++) {
          const kids = await pool(level, 4, x => all(`/me/mailFolders/${encodeURIComponent(x.id)}/childFolders?$top=250&$select=id,displayName,parentFolderId,childFolderCount`, 1000));
          level = [];
          kids.forEach(k => (k || []).forEach(x => { list.push(x); if (x.childFolderCount > 0) level.push(x); }));
        }
        const wk = {};
        await pool(WK, 4, async n => { try { wk[n] = (await get(`/me/mailFolders/${n}?$select=id`)).id; } catch (e) { /* no such folder */ } });
        return { folders: list, wk };
      },
      messages(sinceMs, max) {
        const iso = new Date(sinceMs).toISOString().replace(/\.\d+Z$/, 'Z');
        return all(`/me/messages?$filter=receivedDateTime ge ${iso}&$orderby=receivedDateTime desc&$select=${SEL}&$top=500`, max || 8000);
      },
      flagged() {
        return all(`/me/messages?$filter=flag/flagStatus eq 'flagged'&$select=${SEL}&$top=200`, 400);
      },
      /* The latest emails of each project folder (any age): who belongs to which project, and older conversations' folders. */
      samples(folderIds, per) {
        return pool(folderIds, 4, id => all(`/me/mailFolders/${encodeURIComponent(id)}/messages?$select=id,conversationId,from,toRecipients,ccRecipients,parentFolderId,receivedDateTime&$orderby=receivedDateTime desc&$top=${per || 150}`, per || 150))
          .then(r => [].concat.apply([], r.filter(Boolean)));
      },
    };
  };

  /* Everything build() needs, in one go. progress(text) is told what it is reading. */
  API.load = async function (g, cfg, now, progress) {
    const say = progress || (() => {});
    const prefs = API.prefs(cfg);
    say('Reading folders…');
    const [me, fo] = await Promise.all([g.me(), g.folders()]);
    const F = API.folders(fo.folders, fo.wk, prefs.skip);
    const projIds = Object.keys(F.byId).filter(id => F.byId[id].project && F.byId[id].role !== 'archive');
    const archIds = Object.keys(F.byId).filter(id => F.byId[id].project && F.byId[id].role === 'archive');
    say('Reading mail…');
    const days = Number(cfg && cfg.win) || API.WINDOW;
    const [messages, flagged, samples] = await Promise.all([
      g.messages(now - days * D),
      g.flagged().catch(() => []),
      g.samples(projIds.concat(archIds), 150).catch(() => []),
    ]);
    return { me: me.addresses, name: me.name, folders: fo.folders, wk: fo.wk, messages, flagged, samples, at: now };
  };

  // --------------------------------------------------------- the page
  /* ctx = {
       store: { data: { marks, todos, cfg }, setMark(k, v|null), addTodo(v), setTodo(id, v|null), setCfg(field, v|null), onChange(fn) },
       mail:  { load(progress) → raw (API.load), disconnect() },
       now:   () => ms }
     Renders into `el`. Mail is read on open, on ↻, and every 10 minutes while the page is visible. */
  API.view = function (el, ctx) {
    const now = () => (ctx.now ? ctx.now() : Date.now());
    const S = { type: 'all', proj: '', more: {}, raw: null, loading: false, err: '', built: null, byKey: {} };
    const data = () => ctx.store.data || {};
    const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const md = ms => { const d = new Date(ms); return MON[d.getMonth()] + ' ' + d.getDate(); };
    const mdY = ymd => { const p = String(ymd || '').split('-'); return p.length === 3 ? MON[+p[1] - 1] + ' ' + (+p[2]) : ymd; };
    const ago = ms => { const m = Math.round((now() - ms) / 6e4); return m < 1 ? 'just now' : m < 60 ? m + ' min ago' : Math.round(m / 60) + ' h ago'; };
    const plural = (n, w) => n + ' ' + w + (n === 1 ? '' : 's');

    el.innerHTML = `
      <div class="fu-status"><span id="fuStatus">Connecting to Outlook…</span>
        <button class="btn" type="button" data-a="reload" title="Read the mailbox again">↻ Refresh</button></div>
      <div class="fu-chips" id="fuTypes"></div>
      <div class="fu-chips" id="fuProjs"></div>
      <div id="fuErr" class="fu-err" hidden></div>
      <div id="fuList"><div class="fu-empty">Reading your mailbox…</div></div>
      <details class="fu-box" id="fuAdd"><summary>➕ Add a to-do</summary>
        <form id="fuAddForm" class="fu-form">
          <input id="fuWhat" maxlength="300" placeholder="e.g. Call Forte about BABA letters" required>
          <select id="fuWhatP"></select>
          <input id="fuWhatDue" type="date" title="Due (optional)">
          <button class="btn go" type="submit">Add</button>
        </form></details>
      <details class="fu-box" id="fuSnoozed"><summary></summary><div></div></details>
      <details class="fu-box" id="fuDone"><summary></summary><div></div></details>
      <details class="fu-box" id="fuSet"><summary>⚙ Settings</summary><div></div></details>
      <div class="fu-toast" id="fuToast" hidden></div>`;
    const $ = id => el.querySelector('#' + id);

    const toast = msg => { const t = $('fuToast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.h); toast.h = setTimeout(() => { t.hidden = true; }, 3200); };

    function rebuild() {
      if (!S.raw) return;
      S.built = API.build(S.raw, data(), now());
      S.byKey = {};
      S.built.items.concat(S.built.hidden.done, S.built.hidden.snoozed).forEach(i => { S.byKey[i.key] = i; });
      render();
    }

    const projOptions = (cur, blank) => {
      const ps = (S.built && S.built.projects) || [];
      return `<option value="">${esc(blank || 'Not sorted')}</option>` +
        ps.map(p => `<option value="${esc(p)}"${p === cur ? ' selected' : ''}>${esc(p)}</option>`).join('') +
        (cur && ps.indexOf(cur) < 0 ? `<option value="${esc(cur)}" selected>${esc(cur)}</option>` : '');
    };

    function badge(i) {
      const red = i.due ? ' red' : '';
      if (i.type === 'wait') return `<span class="fu-badge wait${red}" title="Waiting for their answer, ${plural(i.wd, 'working day')}">⏳ ${i.days}d</span>`;
      if (i.type === 'reply') return `<span class="fu-badge reply${red}" title="They wrote to you ${plural(i.days, 'day')} ago">↩ ${i.days}d</span>`;
      if (i.type === 'todo') return `<span class="fu-badge todo${red}">☐ ${i.need ? (i.due ? 'due ' : 'by ') + esc(mdY(i.need)) : 'to-do'}</span>`;
      return `<span class="fu-badge flag${red}">🚩 ${i.dueAt ? 'due ' + md(i.dueAt) : 'flagged'}</span>`;
    }
    function meta(i) {
      const w = (i.with || []).slice(0, 3).map(esc).join(', ') + ((i.with || []).length > 3 ? ` +${i.with.length - 3}` : '');
      const bits = [];
      if (i.type === 'wait') bits.push(`To ${w}`, `you wrote ${md(i.t)}`);
      else if (i.type === 'reply') bits.push(`From ${w}`, md(i.t) + (i.unread ? ' · <b>unread</b>' : ''));
      else if (i.type === 'flag') bits.push(w ? `From ${w}` : '', md(i.t));
      else bits.push(`added ${md(i.t)}`);
      if (i.n > 1) bits.push(i.n + ' emails');
      if (i.flag && i.type !== 'flag') bits.push('🚩');
      if (i.src === 'people') bits.push('<span title="Project guessed from the people on it (they are in that project\'s Outlook folder) — pick another on the row to fix">guessed</span>');
      return bits.filter(Boolean).join(' · ');
    }
    function row(i, hiddenList) {
      const acts = [];
      if (i.link) acts.push(`<a class="fu-btn" href="${esc(i.link)}" target="_blank" rel="noopener">Open ↗</a>`);
      if (i.type === 'wait' && i.link) acts.push(`<button class="fu-btn" data-a="nudge" title="Copy a reminder and open the email — Reply all, paste">🔔 Nudge</button>`);
      if (hiddenList === 'done') acts.push(`<button class="fu-btn" data-a="undo">↶ Undo</button>`);
      else if (hiddenList === 'snoozed') acts.push(`<button class="fu-btn" data-a="undo">⏰ Wake</button>`);
      else {
        acts.push(`<button class="fu-btn ok" data-a="done" title="${i.type === 'wait' ? 'No need to wait — it comes back if they answer' : 'Handled'}">✓ Done</button>`);
        if (i.type !== 'todo') acts.push(`<select class="fu-btn" data-a="snooze" title="Hide until…"><option value="">💤 Snooze</option><option value="1">Tomorrow</option><option value="3">3 days</option><option value="mon">Next Monday</option><option value="7">1 week</option><option value="14">2 weeks</option></select>`);
      }
      acts.push(`<select class="fu-btn fu-p" data-a="proj" title="Project">${projOptions(i.project, '— project —')}</select>`);
      const extra = hiddenList === 'snoozed' && i.mark ? ` · until ${esc(mdY(i.mark.until))}` : hiddenList === 'done' && i.mark && i.mark.when ? ` · done ${md(i.mark.when)}` : '';
      return `<div class="fu-row${i.due ? ' due' : ''}${i.unread ? ' unread' : ''}" data-k="${esc(i.key)}">
        <div class="fu-main">
          <div class="fu-l1">${badge(i)} <span class="fu-subj">${esc(i.subject)}</span></div>
          <div class="fu-meta">${meta(i)}${extra}${hiddenList && i.project ? ' · ' + esc(i.project) : ''}</div>
          ${i.preview ? `<div class="fu-prev">${esc(i.preview)}</div>` : ''}
        </div>
        <div class="fu-acts">${acts.join('')}</div></div>`;
    }

    function render() {
      const B = S.built;
      if (!B) return;
      const shown = B.items.filter(i => S.type === 'all' || i.type === S.type || (S.type === 'flag' && i.type === 'todo') || (S.type === 'flag' && i.flag));
      const cnt = t => B.items.filter(i => i.type === t || (t === 'flag' && (i.type === 'todo' || i.flag))).length;
      const dueN = B.items.filter(i => i.due).length;
      const types = [['all', `All ${B.items.length}`], ['wait', `⏳ Waiting on them ${cnt('wait')}`], ['reply', `↩ To reply ${cnt('reply')}`], ['flag', `🚩 Flagged & to-do ${cnt('flag')}`]];
      $('fuTypes').innerHTML = types.map(([k, l]) => `<button class="chip${S.type === k ? ' on' : ''}" data-a="type" data-v="${k}">${l}</button>`).join('') +
        (dueN ? `<span class="fu-duecount">${dueN} due</span>` : '');
      const groups = API.groups(shown, B.projects);
      if (S.proj && !groups.some(g => (g.name || '\u0000') === S.proj)) S.proj = '';
      $('fuProjs').innerHTML = groups.length > 1 ? [`<button class="chip${!S.proj ? ' on' : ''}" data-a="proj-f" data-v="">All projects</button>`]
        .concat(groups.map(g => { const v = g.name || '\u0000'; return `<button class="chip${S.proj === v ? ' on' : ''}${g.due ? ' late' : ''}" data-a="proj-f" data-v="${esc(v)}">${esc(g.name || 'Not sorted')} ${g.items.length}</button>`; })).join('') : '';
      const vis = groups.filter(g => !S.proj || (g.name || '\u0000') === S.proj);
      $('fuList').innerHTML = vis.length ? vis.map(g => {
        const id = g.name || '\u0000';
        const now_ = g.items.filter(i => !(i.type === 'wait' && !i.due));
        const later = g.items.filter(i => i.type === 'wait' && !i.due);
        const open = S.more[id];
        return `<section class="grp${g.name ? '' : ' unsorted'}"><h3>${esc(g.name || '❓ Not sorted — pick a project on the row')}
            <span>${g.due ? `<b class="fu-red">${g.due} due</b> · ` : ''}${plural(g.items.length, 'open item')}</span></h3>
          ${now_.map(i => row(i)).join('')}
          ${later.length ? `<button class="fu-more" data-a="more" data-v="${esc(id)}">${open ? '▾' : '▸'} ${plural(later.length, 'email')} sent recently — not due for a nudge yet</button>
            ${open ? later.map(i => row(i)).join('') : ''}` : ''}
          ${!now_.length && !later.length ? '<div class="fu-empty">Nothing here.</div>' : ''}
        </section>`;
      }).join('') : `<div class="fu-empty">${B.items.length ? 'Nothing of this kind. ' : '🎉 Nothing to follow up. '}</div>`;
      const sn = B.hidden.snoozed, dn = B.hidden.done.filter(i => i.mark && i.mark.when && now() - i.mark.when < 7 * D);
      $('fuSnoozed').hidden = !sn.length;
      $('fuSnoozed').querySelector('summary').textContent = `💤 Snoozed ${sn.length}`;
      $('fuSnoozed').querySelector('div').innerHTML = sn.map(i => row(i, 'snoozed')).join('');
      $('fuDone').hidden = !dn.length;
      $('fuDone').querySelector('summary').textContent = `✓ Done in the last 7 days ${dn.length}`;
      $('fuDone').querySelector('div').innerHTML = dn.map(i => row(i, 'done')).join('');
      $('fuWhatP').innerHTML = projOptions($('fuWhatP').value || S.proj.replace('\u0000', ''), '— project —');
      const st = B.stats;
      $('fuStatus').innerHTML = S.loading ? 'Reading your mailbox…' :
        `Checked ${ago(S.raw.at)} · ${st.mail.toLocaleString()} emails, last ${Number(data().cfg && data().cfg.win) || API.WINDOW} days · nudge after ${plural(st.nudge, 'working day')}` +
        (st.acks ? ` · <span title="Your last email was a short &quot;thanks / noted / received&quot; reply — nothing to wait for">${st.acks} “thanks” replies left out</span>` : '');
      if (!$('fuSet').open) settings();
    }

    function settings() {
      const B = S.built, cfg = data().cfg || {}, pr = API.prefs(cfg);
      const all = API.folders(S.raw.folders, S.raw.wk, []).projects;
      const ms = cfg.ms || {};
      $('fuSet').querySelector('div').innerHTML = `<div class="fu-form col">
        <label>Nudge after <input id="fuDays" type="number" min="1" max="30" value="${Number(cfg.days) || API.NUDGE_DAYS}" style="width:64px"> working days without an answer</label>
        <label>Read the last <input id="fuWin" type="number" min="7" max="120" value="${Number(cfg.win) || API.WINDOW}" style="width:64px"> days of mail</label>
        <div><b>Projects</b> <span class="fu-dim">— your top-level Outlook folders. Keywords sort emails that are still in the Inbox / Sent (comma-separated; short ALL-CAPS codes match case exactly).</span></div>
        ${all.map(p => `<label class="fu-kw"><input type="checkbox" data-skip="${esc(p)}"${pr.skip.indexOf(p) < 0 ? ' checked' : ''}> <span>${esc(p)}</span>
          <input data-kw="${esc(p)}" value="${esc(pr.kw[p] != null ? pr.kw[p] : API.defaultKeywords(p))}"></label>`).join('') || '<div class="fu-dim">No project folders found.</div>'}
        <label><b>Nudge text</b> <span class="fu-dim">— {name} = their first name</span><textarea id="fuNudge" rows="4">${esc(pr.nudgeText || API.NUDGE_TEXT)}</textarea></label>
        <div><button class="btn go" type="button" data-a="save-set">Save</button></div>
        <div class="fu-dim">Outlook app: ${esc(ms.clientId || '—')}${ms.tenant ? ' · tenant ' + esc(ms.tenant) : ''}
          · <a href="#" data-a="disconnect">Sign out of Outlook</a> · <a href="#" data-a="reset-ms">Change the app id</a></div>
      </div>`;
    }

    async function load() {
      if (S.loading) return;
      S.loading = true; S.err = '';
      $('fuErr').hidden = true;
      $('fuStatus').textContent = 'Reading your mailbox…';
      try {
        S.raw = await ctx.mail.load(t => { $('fuStatus').textContent = t; });
      } catch (e) {
        S.err = (e && e.message) || String(e);
        $('fuErr').hidden = false;
        $('fuErr').textContent = 'Could not read Outlook — ' + S.err;
      }
      S.loading = false;
      if (S.raw) rebuild(); else $('fuStatus').textContent = 'Not loaded.';
    }

    const markOf = k => (data().marks || {})[k] || null;
    const keepP = m => (m && m.p ? { p: m.p } : null);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-a]');
      if (!b || b.tagName === 'SELECT') return;
      const a = b.getAttribute('data-a'), v = b.getAttribute('data-v');
      const rowEl = b.closest('[data-k]'), i = rowEl && S.byKey[rowEl.getAttribute('data-k')];
      if (a === 'reload') return load();
      if (a === 'type') { S.type = v; return render(); }
      if (a === 'proj-f') { S.proj = v; return render(); }
      if (a === 'more') { S.more[v] = !S.more[v]; return render(); }
      if (a === 'save-set') {
        const kw = {}, skip = [];
        el.querySelectorAll('[data-kw]').forEach(x => { kw[x.getAttribute('data-kw')] = x.value.trim(); });
        el.querySelectorAll('[data-skip]').forEach(x => { if (!x.checked) skip.push(x.getAttribute('data-skip')); });
        const txt = $('fuNudge').value.trim();
        const days = Math.max(1, Math.min(30, Math.round(Number($('fuDays').value) || API.NUDGE_DAYS)));
        const win = Math.max(7, Math.min(120, Math.round(Number($('fuWin').value) || API.WINDOW)));
        const reread = win !== (Number((data().cfg || {}).win) || API.WINDOW);
        Promise.all([ctx.store.setCfg('days', days), ctx.store.setCfg('win', win),
          ctx.store.setCfg('prefs', JSON.stringify({ kw, skip, nudgeText: txt === API.NUDGE_TEXT ? '' : txt }))])
          .then(() => { toast('Saved'); $('fuSet').open = false; if (reread) load(); else rebuild(); }, er => toast('Not saved: ' + (er.message || er)));
        return;
      }
      if (a === 'disconnect') { e.preventDefault(); return ctx.mail.disconnect(); }
      if (a === 'reset-ms') { e.preventDefault(); return ctx.store.setCfg('ms', null); }
      if (!i) return;
      if (a === 'nudge') {
        const txt = API.nudgeText(i, API.prefs((data().cfg) || {}));
        const done = () => toast('Reminder copied — in Outlook: Reply all, then paste (Ctrl+V)');
        try { navigator.clipboard.writeText(txt).then(done, done); } catch (er) { done(); }
        if (i.link) window.open(i.link, '_blank', 'noopener');
        return;
      }
      if (a === 'done') {
        if (i.todo) ctx.store.setTodo(i.todo, Object.assign({}, data().todos[i.todo], { done: now() }));
        else ctx.store.setMark(i.key, Object.assign({}, keepP(markOf(i.key)), { s: 'done', at: i.t, when: now() }));
        return toast('Done — it comes back if a new email arrives');
      }
      if (a === 'undo') {
        if (i.todo) { const td = Object.assign({}, data().todos[i.todo]); delete td.done; ctx.store.setTodo(i.todo, td); }
        else ctx.store.setMark(i.key, keepP(markOf(i.key)));
      }
    });
    el.addEventListener('change', e => {
      const s = e.target.closest('select[data-a]');
      if (!s) return;
      const a = s.getAttribute('data-a'), rowEl = s.closest('[data-k]'), i = rowEl && S.byKey[rowEl.getAttribute('data-k')];
      if (!i) return;
      if (a === 'snooze' && s.value) {
        const until = API.snoozeUntil(s.value, now());
        ctx.store.setMark(i.key, Object.assign({}, keepP(markOf(i.key)), { s: 'snooze', at: i.t, when: now(), until }));
        toast('Snoozed until ' + mdY(until));
      }
      if (a === 'proj') {
        const p = s.value;
        if (i.todo) { const td = Object.assign({}, data().todos[i.todo]); if (p) td.p = p; else delete td.p; ctx.store.setTodo(i.todo, td); }
        else { const m = Object.assign({}, markOf(i.key)); if (p) m.p = p; else delete m.p; ctx.store.setMark(i.key, Object.keys(m).length ? m : null); }
      }
    });
    $('fuAddForm').addEventListener('submit', e => {
      e.preventDefault();
      const what = $('fuWhat').value.trim();
      if (!what) return;
      const td = { what, at: now() };
      if ($('fuWhatP').value) td.p = $('fuWhatP').value;
      if ($('fuWhatDue').value) td.due = $('fuWhatDue').value;
      Promise.resolve(ctx.store.addTodo(td)).then(() => { $('fuWhat').value = ''; $('fuWhatDue').value = ''; toast('Added'); }, er => toast('Not added: ' + (er.message || er)));
    });

    ctx.store.onChange(rebuild);
    load();
    const tick = setInterval(() => { if (typeof document === 'undefined' || document.visibilityState === 'visible') { if (S.raw && now() - S.raw.at > 10 * 6e4) load(); else if (S.raw) render(); } }, 60e3);
    if (typeof document !== 'undefined') document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && S.raw && now() - S.raw.at > 5 * 6e4) load(); });
    return { reload: load, stop: () => clearInterval(tick), state: S };
  };

  if (typeof module !== 'undefined' && module.exports) module.exports = API;
  root.AF_FOLLOWUP = API;
})(typeof window !== 'undefined' ? window : globalThis);
