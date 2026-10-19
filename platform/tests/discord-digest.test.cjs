#!/usr/bin/env node
/* The daily Discord digest message (report/discord-digest.js), without Discord or Firebase. */
const { build } = require('../../report/discord-digest.js');
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m); } };
const NOW = Date.UTC(2026, 9, 17, 12, 45), D = 86400000;
const dw = { 'AC3-103': { no: 'AC3-103' } };
const issues = {
  a: { n: 3, dwg: 'AC3-103', text: 'Change TOB to T.O.HSS', status: 'open', owner: 'henry.kim@advfacade.com', created: NOW - 9 * D },
  b: { n: 5, text: 'Same on South & East', status: 'open', owner: 'henry.kim@advfacade.com', created: NOW - 2 * D },
  c: { n: 6, text: 'Dimension 3/4"', status: 'open', owner: 'sj', created: NOW - 3600e3 },
  d: { n: 7, text: '10\'-3 3/4" circled', status: 'ask', created: NOW - 5 * D },
  e: { n: 8, text: 'Louver color', status: 'fixed', reviewer: 'spark', fixedAt: NOW - 7200e3, created: NOW - 4 * D },
  f: { n: 9, text: 'Old one', status: 'closed', closedAt: NOW - 3600e3, created: NOW - 10 * D },
};
const m = build('ac3', { name: 'Atlantic-Chestnut Building 3' }, issues, dw, NOW);
ok(/^\*\*Atlantic-Chestnut Building 3 · review comments\*\* — Sat, Oct 17/.test(m), 'title with board name and New York date');
ok(/To fix: \*\*3\*\* — henry\.kim 2 · sj 1/.test(m), 'to fix: 3, by owner, names without @domain');
ok(/Asked, waiting for an answer: \*\*1\*\*/.test(m), 'asked: 1');
ok(/waiting for the reviewer's check: \*\*1\*\* — spark 1/.test(m), 'fixed waiting check: 1, by reviewer');
ok(/Last 24 h: 1 new · 1 fixed · 1 closed/.test(m), 'last 24 h counts');
ok(/Oldest still open: #3 AC3-103 "Change TOB to T\.O\.HSS" \(9 days\)/.test(m), 'oldest open with drawing number and age');
ok(/https:\/\/af-hub-two\.vercel\.app\/design\/#b=ac3$/.test(m), 'link to the board');
const allClosed = build('ac3', { name: 'AC3' }, { x: { n: 1, status: 'closed', closedAt: NOW - 5 * D } }, {}, NOW);
ok(/^\*\*AC3 · review comments\*\* — Sat, Oct 17\n✅ Nothing open on the board/.test(allClosed) && /#b=ac3$/.test(allClosed), 'nothing open → still posts: "Nothing open", and the link');
const empty = build('ac3', { name: 'AC3' }, null, {}, NOW);
ok(/📭 No review comments on the board yet\. Please put each review comment on the board/.test(empty), 'no comments at all → the nudge to use the board');
// the week's notice, under the counts, until its date (New York), only on its boards
const notice = { text: 'Q1?\nQ2?', until: '2026-10-17', boards: ['ac3'] };
ok(/Last 24 h[^\n]*\n[^\n]*\n\nQ1\?\nQ2\?\nhttps:/.test(build('ac3', { name: 'AC3' }, issues, dw, NOW, { notice })), 'the notice goes under the counts, before the link');
ok(/\n\nQ1\?\nQ2\?\nhttps:/.test(build('ac3', { name: 'AC3' }, null, {}, NOW, { notice })), '… and under the nudge');
ok(!/Q1/.test(build('ac3', { name: 'AC3' }, null, {}, NOW + 2 * D, { notice })), 'not after its date');
ok(!/Q1/.test(build('hillview', { name: 'H' }, null, {}, NOW, { notice })), 'not on other boards');
ok(/Q1/.test(build('hillview', { name: 'H' }, null, {}, NOW, { notice: { text: 'Q1', until: '2026-10-30' } })), 'every board when it names none');
// the second scheduled run does not post the same day twice
const { alreadyPosted } = require('../../report/discord-digest.js');
const bot = '42', mine = c => ({ author: { id: bot }, content: c });
ok(alreadyPosted([{ author: { id: '7' }, content: 'hi' }, mine('**AC3 · review comments** — Sat, Oct 17\n…')], bot, NOW), 'today\'s digest already in the channel → skip');
ok(!alreadyPosted([mine('**AC3 · review comments** — Fri, Oct 16\n…')], bot, NOW), 'yesterday\'s does not count');
ok(!alreadyPosted([{ author: { id: '7' }, content: '**AC3 · review comments** — Sat, Oct 17' }], bot, NOW), 'someone else quoting it does not count');
const realNotice = JSON.parse(require('fs').readFileSync(require('path').join(__dirname, '..', '..', 'report', 'discord-notice.json'), 'utf8'));
ok(/^\d{4}-\d{2}-\d{2}$/.test(realNotice.until) && build('ac3', { name: 'Atlantic-Chestnut Building 3' }, issues, dw, NOW, { notice: realNotice }).length < 2000, 'report/discord-notice.json is valid and the message still fits in one Discord message');
ok(m.length < 2000, 'fits in one Discord message');
// The Actions log is public: its copy has initials, no comment text, same counts.
const pub = build('ac3', { name: 'Atlantic-Chestnut Building 3' }, issues, dw, NOW, { pub: true });
ok(/To fix: \*\*3\*\* — h… 2 · s… 1/.test(pub), 'log copy: owners as initials');
ok(/reviewer's check: \*\*1\*\* — s… 1/.test(pub), 'log copy: reviewers as initials');
ok(!/henry|spark|TOB|T\.O\.HSS/.test(pub), 'log copy: no names, no comment text');
ok(/Oldest still open: #3 AC3-103 \(9 days\)/.test(pub), 'log copy: oldest keeps number, drawing and age');
console.log(`discord digest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
