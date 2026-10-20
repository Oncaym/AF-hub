#!/usr/bin/env node
/* 📬 Follow-up (core/followup.js): what counts as waiting / to reply / flagged, which project, done & snooze,
   working days, "thanks" replies, and the Graph reader (paging, sub-folders, throttling) against a fake fetch.
     node platform/tests/followup.test.cjs */
process.env.TZ = 'America/New_York';
const F = require('../../core/followup.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (x !== undefined ? '  :: ' + JSON.stringify(x) : '')); } };
const D = 864e5;
const NOW = Date.parse('2026-10-20T15:00:00-04:00');          // Tuesday
const at = s => new Date(Date.parse(s + (s.length <= 10 ? 'T10:00:00-04:00' : ''))).toISOString();
const ME = 'leosun@advfacade.com';
const p = (address, name) => ({ emailAddress: { address, name: name || address.split('@')[0] } });

// ---------------------------------------------------------------- dates
ok(F.workdays(Date.parse('2026-10-14T09:00:00-04:00'), NOW) === 4, 'Wed → next Tue = 4 working days (Thu Fri Mon Tue)', F.workdays(Date.parse('2026-10-14T09:00:00-04:00'), NOW));
ok(F.workdays(Date.parse('2026-10-16T17:00:00-04:00'), NOW) === 2, 'Fri → Tue = 2 working days (weekend skipped)');
ok(F.workdays(NOW - 3600e3, NOW) === 0 && F.days(NOW - 3600e3, NOW) === 0, 'same day = 0');
ok(F.workdays(Date.parse('2026-10-17T10:00:00-04:00'), Date.parse('2026-10-18T10:00:00-04:00')) === 0, 'Sat → Sun = 0');
ok(F.snoozeUntil('mon', NOW) === '2026-10-26' && F.snoozeUntil('1', NOW) === '2026-10-21' && F.snoozeUntil(7, NOW) === '2026-10-27', 'snooze dates', [F.snoozeUntil('mon', NOW)]);
ok(F.snoozeUntil('mon', Date.parse('2026-10-25T10:00:00-04:00')) === '2026-10-26', 'snooze to next Monday from a Sunday');

// ---------------------------------------------------------------- keys
const k1 = F.key('AAQkAGI2TG93AAA=/x+y'), k2 = F.key('AAQkAGI2TG93AAB=/x+y');
ok(/^c[a-z0-9]{2,20}$/.test(k1) && k1 === F.key('AAQkAGI2TG93AAA=/x+y') && k1 !== k2, 'conversation keys: stable, distinct, database-safe', [k1, k2]);

// ---------------------------------------------------------------- "thanks" replies
const ack = (subject, bodyPreview) => F.isAck({ subject, bodyPreview });
ok(ack('RE: AC3 calc', 'Thanks! Best regards, Leo Sun Advanced Facade'), '"Thanks!" + signature is an ack');
ok(ack('RE: AC3 calc', 'Hi Peter, thank you so much. Leo'), '"Hi Peter, thank you so much." is an ack');
ok(ack('答复: 样品', '收到，谢谢'), '收到，谢谢 is an ack');
ok(ack('RE: x', 'Noted.') && ack('RE: x', 'Well received, thanks') , 'noted / well received');
ok(!ack('RE: AC3 calc', 'Thanks. Please confirm the anchor spacing. Leo'), '"Thanks. Please confirm…" asks for something → not an ack');
ok(!ack('AC3 calc', 'Thanks'), 'not a reply (no RE:) → not an ack');
ok(!ack('RE: AC3 calc', 'Thanks. Can you send the revised calc by Friday?'), 'a question in it → not an ack');
ok(!ack('RE: AC3 calc', 'Please see the attached shop drawings for the north elevation and confirm the anchor spacing'), 'a real message → not an ack');

// ---------------------------------------------------------------- automatic mail
ok(F.isAuto({ subject: 'Automatic reply: AC3', from: p('peter@gc.com') }), 'out-of-office is automatic');
ok(F.isAuto({ subject: 'Accepted: OAC meeting', from: p('peter@gc.com') }), 'meeting response is automatic');
ok(F.isAuto({ subject: 'Daily log', from: p('no-reply@procore.com') }) && F.isAuto({ subject: 'x', from: p('notifications@github.com') }), 'no-reply senders are automatic');
ok(F.isAuto({ '@odata.type': '#microsoft.graph.eventMessageRequest', subject: 'OAC', from: p('peter@gc.com') }), 'meeting requests are automatic');
ok(!F.isAuto({ subject: 'RE: Reply needed', from: p('replyteam@gc.com') }), 'an ordinary sender is not automatic');

// ---------------------------------------------------------------- folders
const folders = [
  ['I', 'Inbox', 'R'], ['S', 'Sent Items', 'R'], ['DEL', 'Deleted Items', 'R'], ['DR', 'Drafts', 'R'], ['RSS', 'RSS Feeds', 'R'],
  ['A', 'Archive', 'R'], ['A_PO', 'P.O.', 'A'], ['A_REF', '03_Reference', 'A'],
  ['CP2', 'CP2', 'R'], ['CP2_ACT', '01_Action Required', 'CP2'], ['CP2_AW', '02_Awaiting Reply', 'CP2'], ['CP2_ARC', '04_Archive/Projects', 'CP2'],
  ['AC3', 'AC3', 'R'], ['AC3_ARC', 'Archived', 'AC3'], ['AC3_AW', 'Awaiting Reply', 'AC3'], ['AC3_REF', 'Reference', 'AC3'],
  ['LEX', '355 Lex', 'R'], ['LEX_ARC', 'Archived', 'LEX'], ['FH', 'Forest Hill', 'R'], ['JEAN', 'JEAN', 'R'], ['JEAN_PO', 'P.O.', 'JEAN'], ['JEAN_W', 'Warranty', 'JEAN'],
  ['PKG', 'ADA Package#7', 'R'], ['PKG_ARC', 'Archived', 'PKG'],
].map(([id, displayName, parentFolderId]) => ({ id, displayName, parentFolderId }));
const wk = { msgfolderroot: 'R', inbox: 'I', sentitems: 'S', deleteditems: 'DEL', drafts: 'DR', archive: 'A' };
const FO = F.folders(folders, wk);
ok(FO.projects.join('|') === 'CP2|AC3|355 Lex|Forest Hill|JEAN|ADA Package#7', 'projects = top-level folders (not Inbox / Archive / RSS)', FO.projects);
ok(FO.byId.CP2_ACT.project === 'CP2' && FO.byId.CP2_ACT.role === 'action', 'CP2 / 01_Action Required: project CP2, role action');
ok(FO.byId.CP2_ARC.role === 'archive' && FO.byId.AC3_REF.role === 'reference' && FO.byId.AC3_AW.role === 'waiting', 'Archived / Reference / Awaiting Reply roles');
ok(FO.byId.A_PO.role === 'archive' && !FO.byId.A_PO.project, 'Archive / P.O.: archived, no project');
ok(FO.byId.JEAN_PO.project === 'JEAN' && !FO.byId.JEAN_PO.role, 'JEAN / P.O.: project JEAN');
ok(F.folders(folders, wk, ['JEAN']).projects.indexOf('JEAN') < 0, 'a folder unticked in settings is not a project');
ok(F.defaultKeywords('ADA Package#7').indexOf('Package #7') >= 0 && F.defaultKeywords('355 Lex').indexOf('Lexington') >= 0 && F.defaultKeywords('JEAN') === 'JEAN', 'default keywords');

// ---------------------------------------------------------------- keywords
const KW = { 'AC3': 'AC3, Atlantic Chestnut', 'CP2': 'CP2, Cooper Park', 'JEAN': 'JEAN', 'ADA Package#7': 'Package 7, Package #7' };
ok(F.keywordProject('Atlantic-Chestnut storefront', { AC3: 'Atlantic Chestnut' }) === 'AC3', 'keyword with - or space');
ok(F.keywordProject("Jean's comments on the mockup", KW) === null && F.keywordProject('JEAN PO 1234', KW) === 'JEAN', 'short ALL-CAPS codes are case-sensitive (Jean ≠ JEAN)');
ok(F.keywordProject('AC3 and CP2 coordination', KW) === null, 'two projects named → no guess');
ok(F.keywordProject('Package #7 SOV', KW) === 'ADA Package#7' && F.keywordProject('PACKAGE 7 SOV', KW) === 'ADA Package#7', 'Package #7 / PACKAGE 7');
ok(F.keywordProject('BAC3X', KW) === null, 'no match inside a longer word');

// ---------------------------------------------------------------- the mailbox
let n = 0;
const msg = (o) => Object.assign({ id: 'm' + (++n), isDraft: false, isRead: true, toRecipients: [], ccRecipients: [], bodyPreview: '', webLink: 'https://outlook.office365.com/owa/?ItemID=m' + n, inferenceClassification: 'focused' }, o, { receivedDateTime: at(o.t), sentDateTime: at(o.t) });
const out = (conv, t, to, subject, extra) => msg(Object.assign({ conversationId: conv, t, subject, from: p(ME, 'Leo Sun'), toRecipients: to.map(a => p(a)), parentFolderId: 'S' }, extra));
const inn = (conv, t, from, subject, extra) => msg(Object.assign({ conversationId: conv, t, subject, from: p(from), toRecipients: [p(ME)], parentFolderId: 'I' }, extra));
const messages = [
  out('w1', '2026-10-14T09:00:00-04:00', ['chul@advfacade.com'], 'AC3 storefront calc — please review', { bodyPreview: 'Chul, please review the attached calc.' }),
  out('w2', '2026-10-19T09:00:00-04:00', ['pm@fortenyc.com'], 'Forest Hill gutter — BABA letters'),
  out('w3', '2026-10-12', ['x@broadwaybuilder.com'], 'Lintel enclosure'), inn('w3', '2026-10-13', 'x@broadwaybuilder.com', 'RE: Lintel enclosure', { parentFolderId: 'CP2' }),
  out('w4', '2026-10-12', ['y@broadwaybuilder.com'], 'Mockup date'), inn('w4', '2026-10-13', 'y@broadwaybuilder.com', 'RE: Mockup date', { parentFolderId: 'CP2_ARC' }),
  inn('ack', '2026-10-15', 'z@promethean.com', '355 Lex shower door hardware'), out('ack', '2026-10-15T15:00:00-04:00', ['z@promethean.com'], 'RE: 355 Lex shower door hardware', { bodyPreview: 'Thanks! Leo Sun | Advanced Facade' }),
  out('oof', '2026-10-13', ['vendor@berger.com'], 'Forest Hill — BABA certificate'), inn('oof', '2026-10-13T11:00:00-04:00', 'vendor@berger.com', 'Automatic reply: Forest Hill — BABA certificate'),
  inn('r1', '2026-10-16', 'gc@broadwaybuilder.com', 'RE: comments round 4', { isRead: false, bodyPreview: 'Leo, see our comments attached.' }),
  inn('cc1', '2026-10-16', 'a@gc.com', 'FYI site photos', { toRecipients: [p('b@gc.com')], ccRecipients: [p(ME)] }),
  inn('news', '2026-10-19', 'news@aamanet.org', 'Industry news', { inferenceClassification: 'other' }),
  inn('noreply', '2026-10-19', 'no-reply@procore.com', 'Daily log submitted'),
  out('self', '2026-10-12', [ME], 'note to self'),
  out('del', '2026-10-12', ['q@x.com'], 'deleted thing', { parentFolderId: 'DEL' }),
  out('done1', '2026-10-13', ['pm@gc.com'], 'AC3 RFI 12'),
  out('done2', '2026-10-13', ['pm@gc.com'], 'AC3 RFI 13'), inn('done2', '2026-10-19', 'pm@gc.com', 'RE: AC3 RFI 13', { parentFolderId: 'AC3' }),
  out('sn1', '2026-10-13', ['pm@gc.com'], 'AC3 RFI 14'),
  out('sn2', '2026-10-13', ['pm@gc.com'], 'AC3 RFI 15'),
  out('ovr', '2026-10-13', ['pm@gc.com'], 'AC3 sample'),
  out('jean', '2026-10-13', ['jean.park@arch.com'], "Jean's comments on the mockup"),
  out('jean2', '2026-10-13', ['sales@jean.com'], 'JEAN PO 1234 — delivery date'),
  out('amb', '2026-10-13', ['pm@gc.com'], 'AC3 and CP2 coordination'),
  inn('act', '2026-10-19', 'boss@gc.com', 'Need your SOV', { toRecipients: [p('pm@gc.com')], ccRecipients: [p(ME)], parentFolderId: 'CP2_ACT' }),
  inn('meet', '2026-10-19', 'boss@gc.com', 'OAC meeting', { '@odata.type': '#microsoft.graph.eventMessageRequest' }),
  out('draft', '2026-10-19', ['q@x.com'], 'unsent', { isDraft: true, parentFolderId: 'DR' }),
];
const samples = [
  ...[1, 2, 3].map(i => msg({ conversationId: 'old' + i, t: '2026-08-0' + i, subject: 'old', from: p('gc@broadwaybuilder.com'), toRecipients: [p(ME)], parentFolderId: 'CP2' })),
  msg({ conversationId: 'f1', t: '2026-07-01', subject: 'old flagged', from: p('owner@nycsca.org'), toRecipients: [p(ME)], parentFolderId: 'PKG' }),
  // chul shows up in two projects' folders → never decides a project on his own
  msg({ conversationId: 'o5', t: '2026-08-01', subject: 'x', from: p('chul@advfacade.com'), toRecipients: [p(ME)], parentFolderId: 'AC3' }),
  msg({ conversationId: 'o6', t: '2026-08-01', subject: 'x', from: p('chul@advfacade.com'), toRecipients: [p(ME)], parentFolderId: 'CP2' }),
];
const flagged = [
  msg({ conversationId: 'f1', t: '2026-07-01', subject: 'Package 7 closeout docs', from: p('owner@nycsca.org'), toRecipients: [p(ME)], parentFolderId: 'PKG', flag: { flagStatus: 'flagged', dueDateTime: { dateTime: '2026-10-18T00:00:00.0000000', timeZone: 'UTC' } } }),
  msg({ conversationId: 'r1', t: '2026-10-16', subject: 'RE: comments round 4', from: p('gc@broadwaybuilder.com'), toRecipients: [p(ME)], parentFolderId: 'I', flag: { flagStatus: 'flagged' } }),
];
const raw = { me: [ME], folders, wk, messages, flagged, samples, at: NOW };
const tOf = c => Date.parse(at(messages.filter(m => m.conversationId === c).slice(-1)[0].receivedDateTime));
const store = {
  marks: {
    [F.key('done1')]: { s: 'done', at: tOf('done1'), when: NOW - D },
    [F.key('done2')]: { s: 'done', at: Date.parse(at('2026-10-13')), when: NOW - 5 * D },     // a new email since → back
    [F.key('sn1')]: { s: 'snooze', at: tOf('sn1'), when: NOW, until: '2026-10-22' },
    [F.key('sn2')]: { s: 'snooze', at: tOf('sn2'), when: NOW - 9 * D, until: '2026-10-19' },  // snooze over → back
    [F.key('ovr')]: { p: 'CP2' },
  },
  todos: {
    t1: { what: 'Call Forte about BABA letters', at: NOW - 2 * D, p: 'Forest Hill', due: '2026-10-19' },
    t2: { what: 'Order sample chips', at: NOW - D },
    t3: { what: 'Old one', at: NOW - 9 * D, done: NOW - D },
  },
  cfg: {},
};
const B = F.build(raw, store, NOW);
const by = c => B.items.find(i => i.conv === c);
const hid = c => B.hidden.done.concat(B.hidden.snoozed).find(i => i.conv === c);

ok(by('w1') && by('w1').type === 'wait' && by('w1').due && by('w1').wd === 4 && by('w1').project === 'AC3' && by('w1').src === 'keyword', 'my email 4 working days unanswered → waiting, due, AC3 (subject)', by('w1'));
ok(by('w1').with.join() === 'chul' && by('w1').withFirst === 'chul', 'waiting on: the To people');
ok(by('w2') && by('w2').type === 'wait' && !by('w2').due && by('w2').project === 'Forest Hill', 'sent yesterday → waiting, not due yet');
ok(by('w3') && by('w3').type === 'reply' && by('w3').project === 'CP2' && by('w3').src === 'folder', 'they answered (filed in CP2) → my turn to reply, project from the folder', by('w3'));
ok(!by('w4') && !hid('w4'), 'their answer filed in an Archive folder → nothing to do');
ok(!by('ack') && B.stats.acks === 1, 'my last email was "Thanks!" → not waiting (counted)', B.stats);
ok(by('oof') && by('oof').type === 'wait' && by('oof').due, 'an out-of-office reply does not count as an answer');
ok(by('r1') && by('r1').type === 'reply' && by('r1').unread && by('r1').project === 'CP2' && by('r1').src === 'people' && by('r1').flag, 'unread email to me → to reply; CP2 from the people (sender lives in CP2\'s folder); flagged too', by('r1'));
ok(!by('cc1'), 'only cc\'d → nothing to do');
ok(!by('news') && !by('noreply') && !by('meet'), 'Other inbox / no-reply / meeting requests left out');
ok(!by('self') && !by('del') && !by('draft'), 'note to self, deleted, drafts left out');
ok(!by('done1') && hid('done1') && B.hidden.done.indexOf(hid('done1')) >= 0, 'Done → hidden');
ok(by('done2') && by('done2').type === 'reply', 'Done, then a new email arrived → back on the list');
ok(!by('sn1') && B.hidden.snoozed.some(i => i.conv === 'sn1'), 'snoozed until Thursday → hidden');
ok(by('sn2'), 'snooze ended yesterday → back');
ok(by('ovr').project === 'CP2' && by('ovr').src === 'you', 'project I picked beats the subject keyword');
ok(by('jean').project === null && by('jean2').project === 'JEAN', '"Jean\'s comments" is not JEAN; "JEAN PO" is');
ok(by('amb').project === null, 'two projects in the subject → Not sorted');
ok(by('act') && by('act').type === 'reply' && by('act').project === 'CP2', 'only cc\'d but filed in 01_Action Required → to reply');
const f1 = by('f1');
ok(f1 && f1.type === 'flag' && f1.project === 'ADA Package#7' && f1.due && f1.dueAt === Date.parse('2026-10-18T00:00:00Z'), 'flagged months ago (outside the window) → listed, project from its folder, due date passed', f1);
const t1 = B.items.find(i => i.todo === 't1'), t2 = B.items.find(i => i.todo === 't2');
ok(t1 && t1.type === 'todo' && t1.due && t1.project === 'Forest Hill' && t2 && !t2.due && !t2.project, 'to-dos: due date passed → due; project kept');
ok(B.hidden.done.some(i => i.todo === 't3') && !B.items.some(i => i.todo === 't3'), 'finished to-do → in Done');

// order: due first, oldest first
const dueKeys = B.items.filter(i => i.due).map(i => i.conv || i.todo);
ok(B.items.slice(0, dueKeys.length).every(i => i.due), 'due items first');
const G = F.groups(B.items, B.projects);
ok(G[G.length - 1].name === null && G[G.length - 1].items.some(i => i.conv === 'amb'), 'Not sorted is the last group');
ok(G[0].due >= G[1].due, 'project with the most due first', G.map(g => [g.name, g.due]));
ok(B.projects.indexOf('CP2') === 0, 'projects keep the folder order');

// nudge text and settings
ok(F.nudgeText(by('w1'), F.prefs({})).startsWith('Hi chul,'), 'nudge text uses their first name');
ok(F.nudgeText(by('w1'), F.prefs({ prefs: JSON.stringify({ nudgeText: 'Hey {name} — re {subject}?' }) })) === 'Hey chul — re AC3 storefront calc — please review?', 'custom nudge text');
ok(F.prefs({ prefs: '{bad json' }).skip.length === 0, 'broken settings fall back to defaults');
const B2 = F.build(raw, Object.assign({}, store, { cfg: { days: 5 } }), NOW);
ok(!B2.items.find(i => i.conv === 'w1').due && B2.stats.nudge === 5, 'nudge after 5 working days → 4 is not due');
const B3 = F.build(raw, Object.assign({}, store, { cfg: { prefs: JSON.stringify({ kw: { AC3: 'storefront' } }) } }), NOW);
ok(B3.items.find(i => i.conv === 'w1').project === 'AC3' && B3.items.find(i => i.conv === 'jean2').project === 'JEAN', 'edited keywords used');

// ---------------------------------------------------------------- Graph reader (fake fetch)
(async () => {
  const calls = [];
  let throttled = false;
  const json = (status, body, headers) => ({ ok: status < 300, status, json: async () => body, headers: { get: k => (headers || {})[k] } });
  const fake = async (url, opt) => {
    calls.push(url);
    if (!/Bearer tok/.test(opt.headers.Authorization)) return json(401, {});
    const u = decodeURIComponent(url.replace('https://graph.microsoft.com/v1.0', ''));
    if (u.startsWith('/me?')) return json(200, { mail: 'LeoSun@advfacade.com', userPrincipalName: 'leosun@advfacade.com', proxyAddresses: ['SMTP:leosun@advfacade.com', 'smtp:leo@advfacade.onmicrosoft.com'] });
    if (u.startsWith('/me/mailFolders?')) return json(200, { value: [{ id: 'I', displayName: 'Inbox', parentFolderId: 'R', childFolderCount: 0 }, { id: 'CP2', displayName: 'CP2', parentFolderId: 'R', childFolderCount: 1 }] });
    if (u.startsWith('/me/mailFolders/CP2/childFolders')) return json(200, { value: [{ id: 'CP2_ACT', displayName: '01_Action Required', parentFolderId: 'CP2', childFolderCount: 1 }] });
    if (u.startsWith('/me/mailFolders/CP2_ACT/childFolders')) return json(200, { value: [{ id: 'CP2_X', displayName: 'Deep', parentFolderId: 'CP2_ACT', childFolderCount: 0 }] });
    const w = /^\/me\/mailFolders\/(\w+)\?\$select=id$/.exec(u);
    if (w) return w[1] === 'archive' ? json(404, { error: { code: 'ErrorFolderNotFound', message: 'nope' } }) : json(200, { id: { msgfolderroot: 'R', inbox: 'I', sentitems: 'S' }[w[1]] || w[1].toUpperCase() });
    if (u.startsWith('/me/messages?$filter=receivedDateTime')) {
      if (!throttled) { throttled = true; return json(429, {}, { 'Retry-After': '0' }); }
      return json(200, { value: [messages[0], messages[1]], '@odata.nextLink': 'https://graph.microsoft.com/v1.0/me/messages?page=2' });
    }
    if (u === '/me/messages?page=2') return json(200, { value: [messages[2]] });
    if (u.startsWith("/me/messages?$filter=flag/flagStatus eq 'flagged'")) return json(200, { value: flagged });
    if (/^\/me\/mailFolders\/\w+\/messages/.test(u)) return json(200, { value: [samples[0]] });
    return json(400, { error: { code: 'BadRequest', message: u } });
  };
  const g = F.graph(async () => 'tok', fake);
  const steps = [];
  const R = await F.load(g, {}, NOW, s => steps.push(s));
  ok(R.me.indexOf('leo@advfacade.onmicrosoft.com') >= 0 && R.me.indexOf('leosun@advfacade.com') >= 0, 'my addresses (mail, UPN, aliases), lower-cased', R.me);
  ok(R.folders.map(f => f.id).join() === 'I,CP2,CP2_ACT,CP2_X', 'folders read down the tree', R.folders.map(f => f.id));
  ok(R.wk.inbox === 'I' && R.wk.sentitems === 'S' && !('archive' in R.wk), 'well-known folders; a missing Archive is fine', R.wk);
  ok(R.messages.length === 3 && throttled, 'messages: retried after 429, followed the next page');
  ok(calls.some(c => /receivedDateTime ge 2026-09-05T\d\d:00:00Z/.test(decodeURIComponent(c))), 'reads the last 45 days', calls.filter(c => /receivedDateTime/.test(c)).map(decodeURIComponent));
  ok(R.flagged.length === 2 && R.samples.length === 3, 'flagged + one sample per project folder (CP2, Action Required, Deep)', [R.flagged.length, R.samples.length]);
  ok(calls.every(c => c.startsWith('https://graph.microsoft.com/v1.0/')), 'talks only to Microsoft Graph');
  ok(steps.length === 2, 'progress shown');
  let err = null;
  try { await F.graph(async () => 'bad', fake).me(); } catch (e) { err = e; }
  ok(err && err.status === 401 && /Outlook: 401/.test(err.message), 'an error from Graph is reported, not swallowed', err && err.message);
  console.log(`follow-up: ${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
