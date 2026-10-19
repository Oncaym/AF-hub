#!/usr/bin/env node
/* 🚚 To send (core/tosend.js): what is still open, most urgent first; what counts as late; need-by dates; groups. */
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

// need-by dates (2026-10-19): late on or after the date; the list sorts by when it must go out
const today = S.ymd(NOW), plus = n => S.ymd(NOW + n * D);
const withDates = {
  old: { what: 'asked 1 h ago, no date', by: 'joe', at: NOW - 3600e3 },          // due NOW + 2 days
  soon: { what: 'needed tomorrow', by: 'leo', at: NOW, need: plus(1) },
  past: { what: 'needed 3 days ago', by: 'leo', at: NOW - D, need: plus(-3) },
  far: { what: 'needed in 9 days', by: 'leo', at: NOW - 20 * D, need: plus(9) },  // asked long ago but not due: not late
  bad: { what: 'junk date', by: 'leo', at: NOW - 3 * D, need: 'next week' },       // ignored: treated as no date
};
const o = S.split(withDates, NOW).open.map(x => x.id);
ok(o.join() === 'past,bad,soon,old,far', 'most urgent first: past due, then by due date', o);
ok(S.late(withDates.past, NOW) && !S.late(withDates.soon, NOW) && !S.late(withDates.far, NOW), 'with a date, late means on or past it');
ok(S.late({ at: NOW, need: today }, NOW), 'due today counts as late (it has to go out today)');
ok(S.late(withDates.bad, NOW), 'a junk date falls back to the age rule');
ok(S.needLabel(withDates.past, NOW) === 'late 3 days' && S.needLabel({ need: today }, NOW) === 'due today'
  && S.needLabel(withDates.soon, NOW) === 'need tomorrow' && /^need [A-Z][a-z]{2} \d{1,2}$/.test(S.needLabel(withDates.far, NOW))
  && S.needLabel(withDates.old, NOW) === '', 'need-by labels', [S.needLabel(withDates.past, NOW), S.needLabel(withDates.far, NOW)]);

// several projects → groups, the one with the most urgent request first; empty projects left out
const g = S.groups([
  { src: { id: 'ac3', name: 'AC3' }, items: { a: { what: 'x', at: NOW } } },
  { src: { id: 's_pkg7', name: 'Package 7' }, items: { b: { what: 'y', at: NOW, need: plus(-1) }, c: { what: 'z', at: NOW } } },
  { src: { id: 'lex', name: 'Lex' }, items: { d: { what: 'w', at: NOW, sent: { by: 's', at: NOW } } } },
], NOW);
ok(g.map(x => x.src.id).join() === 's_pkg7,ac3' && g[0].open.length === 2, 'groups: most urgent project first, nothing-open projects left out', g.map(x => x.src.id));

ok(S.siteId('Package #7') === 's_package_7' && S.siteId('Forest Hill — Gutter') === 's_forest_hill_gutter', 'site ids from names', [S.siteId('Package #7'), S.siteId('Forest Hill — Gutter')]);
ok(S.siteId('Package 7', { s_package_7: 1 }) === 's_package_7_2' && S.siteId('!!!') === 's_project', 'site ids stay unique');
// 📋 from WeChat (Leo 10-19): pasted chat → one request per line, with who and when
{
  const now = new Date(2026, 9, 19, 12, 0).getTime();          // local noon
  const at = (h, m, dd = 19) => new Date(2026, 9, dd, h, m).getTime();
  const chat = ['王师傅 10:21', '明天要SD09 sidelite 2个', '[图片]', '收到', '', 'Joe Foreman 2026/10/19 11:05:12', 'SF04 glass stops x4',
    'need 3 shims too', 'Leo: ok', '小李：GL-4 IGU 1片 东面', '还有门锁', '14:30', 'door closer ×2', '下午 1:15', 'Sealant 3支'].join('\n');
  const r = S.parseChat(chat, now);
  ok(r.length === 7, 'chat → 7 requests (headers, [图片], 收到, ok left out)', r.map(x => x.what));
  ok(r[0].what === '明天要SD09 sidelite 2个' && r[0].qty === 2 && r[0].askedBy === '王师傅' && r[0].askedAt === at(10, 21), '"Name 10:21" header: who and when; 2个 → qty 2', r[0]);
  ok(r[1].qty === 4 && r[1].askedBy === 'Joe Foreman' && r[1].askedAt === at(11, 5) && r[2].askedBy === 'Joe Foreman' && r[2].qty === 0, 'dated header; x4 → 4; the next line keeps the speaker', [r[1], r[2]]);
  ok(r[3].askedBy === '小李' && r[3].what === 'GL-4 IGU 1片 东面' && r[3].qty === 1 && r[4].askedBy === '小李', '"Name：text" inline (full-width colon), and it carries to the next line', [r[3], r[4]]);
  ok(r[5].askedAt === at(14, 30, 18) && r[5].qty === 2, 'a time later than now was yesterday; ×2', r[5]);
  ok(r[6].askedAt === at(13, 15, 18) && r[6].qty === 3, '下午 1:15 → 13:15 (yesterday, it is noon); 3支 → 3', r[6]);
  ok(S.parseChat('', now).length === 0 && S.parseChat('收到\nok\n[Photo]', now).length === 0, 'nothing but chatter → nothing');
  ok(S.parseChat('SD09', now)[0].askedAt === 0 && S.parseChat('SD09', now)[0].askedBy === '', 'no header: when and who left empty (the page uses now and the person recording)');
  // the age and the order use when it was asked, not when it was recorded
  const items = { a: { what: 'old ask, recorded now', at: now, askedAt: now - 5 * D }, b: { what: 'new', at: now - D } };
  ok(S.split(items, now).open[0].id === 'a' && S.late(items.a, now) && S.days(S.asked(items.a), now) === 5, 'a request asked 5 days ago on WeChat is 5 days old and late, even if recorded today');
}
ok(S.safeUrl('https://firebasestorage.googleapis.com/x') && !S.safeUrl('javascript:alert(1)') && !S.safeUrl(42), 'only http(s) photo links are shown');
console.log(`to send: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
