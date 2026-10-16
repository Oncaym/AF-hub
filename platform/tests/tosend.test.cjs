#!/usr/bin/env node
/* 🚚 To send (core/tosend.js): what is still open, oldest first; what counts as late. */
const S = require('../../core/tosend.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (x !== undefined ? '  :: ' + JSON.stringify(x) : '')); } };
const D = 864e5, NOW = Date.UTC(2026, 9, 16, 15);
const items = {
  a: { what: 'SF04 sidelite', by: 'joe', at: NOW - 3600e3 },
  b: { what: 'SD01 sidelite', by: 'joe', at: NOW - 8 * D },
  c: { what: 'SF12A frame', by: 'joe', at: NOW - 3 * D, sent: { by: 'shop', at: NOW - D } },
  d: { what: 'SF40 glass stops', by: 'joe', at: NOW - 20 * D, sent: { by: 'shop', at: NOW - 10 * D } },
  e: { by: 'joe', at: NOW },   // nothing asked: ignored
  f: null,
};
const r = S.split(items, NOW);
ok(r.open.map(x => x.id).join() === 'b,a', 'open items, oldest first', r.open.map(x => x.id));
ok(r.sent.map(x => x.id).join() === 'c', 'sent in the last week only', r.sent.map(x => x.id));
ok(S.days(items.b.at, NOW) === 8 && S.days(items.a.at, NOW) === 0, 'age in whole days');
ok(S.late(items.b, NOW) && !S.late(items.a, NOW) && S.late({ at: NOW - 2 * D }, NOW) && !S.late({ at: NOW - 2 * D + 1 }, NOW), `late from ${S.LATE} days`);
ok(S.split(null, NOW).open.length === 0, 'empty list');
console.log(`to send: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
