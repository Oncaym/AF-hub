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
ok(build('ac3', {}, { x: { n: 1, status: 'closed', closedAt: NOW - 5 * D } }, {}, NOW) === null, 'nothing open and nothing new → no message');
ok(m.length < 2000, 'fits in one Discord message');
console.log(`discord digest: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
