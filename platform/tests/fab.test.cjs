#!/usr/bin/env node
/* Fab drawings (core/fab.js): which sheet belongs to which unit, and which one is current.
   The page texts are what pdf.js / pdftotext read off CP2's real fab sheets (Y: drive,
   4. Fabrication Drawing, 2026-10-16). */
const F = require('../../core/fab.js');
let pass = 0, fail = 0;
const ok = (c, m, x) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m + (x !== undefined ? '  :: ' + JSON.stringify(x) : '')); } };
const same = (a, b) => JSON.stringify([...a].sort()) === JSON.stringify([...b].sort());

const CP2 = ['SF40', 'SF37', 'SF32', 'SF30', 'SF35B', 'SF20A', 'SF20', 'SF22B', 'SF02', 'SF12A', 'SF06E', 'SF06N', 'IS05', 'IS21', 'SF01L', 'SF01R'];

// 1. reading unit numbers off a sheet
const find = F.tagMatcher(CP2);
ok(same(find('Jamb "F" End Anchor E1-1234 x 4 SF40 SF40 SF40 SF40 Advanced Facade 13-75 Redfern Ave.'), ['SF40']), 'SF40 sheet → SF40 (once)');
ok(same(find('Jamb "F" End Anchor E1-1234 x 4 SF37 SF32 Advanced Facade'), ['SF37', 'SF32']), 'two units on one sheet → both');
ok(same(find('SF30-L SF35B SF30'), ['SF30', 'SF35B']), '"SF30-L" (left part) files under SF30');
ok(same(find('SF02 SF22B SF22B-L'), ['SF02', 'SF22B']), '"SF22B-L" files under SF22B');
ok(same(find('SF20A SF20A-L'), ['SF20A']), 'SF20A is not SF20');
ok(same(find('SF12A.1, SF12A.2'), ['SF12A']), '"SF12A.1" files under SF12A');
ok(same(find('sf06e  sf06n'), ['SF06E', 'SF06N']), 'case does not matter');
ok(find('E1-1234 Advanced Facade 13-75 Redfern Ave.').length === 0, 'a sheet without a unit number → nothing');
ok(same(find('ISF40 SF400 XSF40'), []), 'only whole tokens count');
ok(F.tagMatcher([])('SF40').length === 0, 'project without units → nothing');

// 2. a file: pages by text, file name only when no page has text
ok(JSON.stringify(F.indexPages(['SF21A SF21B', 'TYPE 1-2 details', 'SF08E'], ['SF21A', 'SF21B', 'SF08E'], 'SF Fab Part 2_REV.pdf')) === JSON.stringify([['SF21A', 'SF21B'], [], ['SF08E']]), 'combined set: each page filed on its own; detail pages get nothing');
ok(JSON.stringify(F.indexPages(['', ''], CP2, 'IS05.pdf')) === JSON.stringify([['IS05'], ['IS05']]), 'no text at all → the file name (IS05.pdf)');
ok(JSON.stringify(F.indexPages([''], CP2, 'Need to Check Again.pdf')) === JSON.stringify([[]]), 'no text and a plain name → nothing');

// 3. which sheet is current
const files = {
  a: { name: 'SF Fab Part 3.pdf', uploadedAt: 100, pages: [{ img: 'a1', tags: ['SF37', 'SF32'] }, { img: 'a2', tags: ['SF35B'] }] },
  b: { name: 'Ex SF Fab Part4.pdf', uploadedAt: 300, pages: [{ img: 'b1', tags: ['SF37', 'SF32'] }, { img: 'b2', tags: ['SF30', 'SF35B'] }, { img: 'b3' }] },
  c: { name: '40.pdf', uploadedAt: 200, pages: [{ img: 'c1', tags: ['SF40'] }] },
  d: { name: 'IS05 site measure.pdf', uploadedAt: 50, pages: { 0: { img: 'd1' } }, manualTags: ['is05'] },
};
let s = F.sheetsFor(files, 'SF37');
ok(s.length === 2 && s[0].id === 'b' && s[0].current && !s[1].current, 'SF37: newest upload (Part 4) is current, Part 3 is older', s.map(x => [x.id, x.current]));
s = F.sheetsFor(files, 'sf35b');
ok(s.length === 2 && s[0].id === 'b' && s[0].page === 1 && s[1].id === 'a', 'SF35B: current is sheet 2 of Part 4', s.map(x => [x.id, x.page]));
s = F.sheetsFor(files, 'SF40');
ok(s.length === 1 && s[0].current && s[0].id === 'c', 'SF40: its only sheet is current');
ok(F.sheetsFor(files, 'SF99').length === 0 && F.sheetsFor(files, '').length === 0, 'unknown unit / empty → no sheets');
s = F.sheetsFor(files, 'IS05');
ok(s.length === 1 && s[0].id === 'd', 'units added by hand to a file count (and pages stored as an object read fine)');
const two = { x: { name: 'x', uploadedAt: 9, pages: [{ img: 1, tags: ['SF12A'] }, { img: 2, tags: ['SF12A'] }] } };
ok(F.sheetsFor(two, 'SF12A').filter(x => x.current).length === 2, 'a unit over two sheets of the newest file: both current');
ok(F.sheetsFor({ n: null, a: files.a }, 'SF37').length === 1, 'a removed row (null) is skipped');

// 4. search
let r = F.search(files, 'sf3', CP2);
ok(r.units.map(u => u.unit).join() === 'SF30,SF32,SF35B,SF37', 'search "sf3" → SF30, SF32, SF35B, SF37 in natural order', r.units.map(u => u.unit));
r = F.search(files, 'SF40', CP2);
ok(r.units[0].unit === 'SF40' && r.units[0].sheets.length === 1, 'exact unit first, with its sheet');
ok(!F.search(files, 'SF12', CP2).units.length, 'units without a sheet are not listed (SF12A has none)');
r = F.search(files, 'part4', CP2);
ok(r.units.length === 0 && r.files.length === 1 && r.files[0].id === 'b', 'file name search');
r = F.search(files, '', CP2);
ok(r.files.map(x => x.id).join() === 'b,c,a,d', 'empty search → every file, newest first', r.files.map(x => x.id));
ok(F.search({ z: { name: 'z', uploadedAt: 1, pages: [{ tags: ['SF99X'] }] } }, 'SF99', CP2).units.some(u => u.unit === 'SF99X'), 'a unit only a sheet knows about is still findable');
ok(F.fileTags(files.b).join() === 'SF30,SF32,SF35B,SF37', 'a file lists its units');

console.log(`fab drawings: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
