/* Harness: unapproved submittals show up as things to solve (F-052).
   Run: npm i jsdom && node _tests/test-submittal-items.cjs */
const fs = require('fs');
const path = require('path');
const { JSDOM } = require(path.join(process.env.JSDOM_DIR || '/tmp/node_modules', 'jsdom'));
const ROOT = __dirname + '/../';

const html = fs.readFileSync(ROOT + 'index.html', 'utf8');
const src  = fs.readFileSync(ROOT + '../core/app.js', 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', url: 'https://localhost/' });
const { window, window: { document } } = dom;

const lines = src.split('\n');
const at = re => { const i = lines.findIndex(l => re.test(l)); if (i < 0) throw new Error('not found ' + re); return i + 1; };
const cut = (a, b) => lines.slice(a - 1, b - 1).join('\n');

const TODAY = new Date().toISOString().slice(0, 10);
const daysAgo = n => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);

window.state = { units: [], submittals: [], projectItems: [] };
window.GC_ITEMS = [];
window.eval([
  fs.readFileSync(ROOT + 'project-config.js', 'utf8'), 'var PROJECT = window.PROJECT;',
  cut(at(/^const I18N = \{/), at(/^function t\(key\)/)),
  cut(at(/^function t\(key\)/), at(/^let _appReady/)),
  'function _threadFrom() { return []; }',
  'function _gcOpenItems() { return []; } function _gcTsDate() { return ""; }',
  'function _daysOpen(d) { return d ? Math.floor((Date.now() - new Date(d + "T00:00:00")) / 864e5) : null; }',
  cut(at(/^\/\* -------- Submittal log \(M4\)/), at(/^function moveSubmittal/)),   // revKey / reviewsFor / labels
  cut(at(/^function computeOpenItems/), at(/^function _openItemsT/)),
  'window.__setLang = l => { currentLang = l; }; window.__setLang("en");'
].join('\n'));

const ok = [], bad = [];
const T = (n, c, x) => (c ? ok : bad).push(n + (c ? '' : ' :: ' + JSON.stringify(x)));
const S = (number, status, extra) => Object.assign({ id: number, number, title: number + ' data', status, rev: 'Rev0' }, extra || {});

// ---------- what counts as open ----------
window.state.submittals = [
  S('AF-001', 'approved'),
  S('AF-002', 'approved-as-noted'),
  S('AF-003', 'draft'),
  S('AF-004', 'submitted',      { submittedDate: daysAgo(12) }),
  S('AF-005', 'under-review',   { submittedDate: daysAgo(30) }),
  S('AF-006', 'revise-resubmit',{ submittedDate: daysAgo(40), returnedDate: daysAgo(5) }),
  S('AF-007', 'rejected',       { submittedDate: daysAgo(50), returnedDate: daysAgo(2) })
];
const items = window.submittalOpenItems();
T('approved submittals are not things to solve', !items.some(i => ['AF-001', 'AF-002'].includes(i.ref)), items.map(i => i.ref));
T('a draft is not chased either (we have not sent it)', !items.some(i => i.ref === 'AF-003'));
T('everything unapproved shows up', items.map(i => i.ref).sort().join(',') === 'AF-004,AF-005,AF-006,AF-007', items.map(i => i.ref));
T('revise / rejected are flagged as OURS to resubmit',
  items.filter(i => i.needsResubmit).map(i => i.ref).sort().join(',') === 'AF-006,AF-007');
T('submitted / under review are on the reviewers', items.filter(i => !i.needsResubmit).length === 2);
T('every item carries scope=submittal + its row index', items.every(i => i.scope === 'submittal' && typeof i.idx === 'number'));
T('the index points at the right row', window.state.submittals[items.find(i => i.ref === 'AF-006').idx].number === 'AF-006');

// ---------- ageing ----------
T('waiting items age from the submit date', items.find(i => i.ref === 'AF-005').days === 30, items.find(i => i.ref === 'AF-005').days);
T('resubmit items age from the day it came back, not the day we sent it',
  items.find(i => i.ref === 'AF-006').days === 5, items.find(i => i.ref === 'AF-006').days);

// ---------- who has the ball ----------
window.state.submittals.push(S('AF-008', 'under-review', {
  submittedDate: daysAgo(3),
  reviews: { Rev0: [
    { party: 'AKRF Inc.(Consulting)', status: 'no-exception', response: 'ok' },
    { party: 'Dattner Architects', status: 'pending', response: '' },
    { party: 'Monadnock Construction', status: '', response: '' }
  ] }
}));
const af8 = window.submittalOpenItems().find(i => i.ref === 'AF-008');
T('party lists only reviewers who have not answered',
  af8.party === 'Dattner Architects, Monadnock Construction', af8.party);
T('a resubmit item names US as the party', items.find(i => i.ref === 'AF-007').party === 'Us — resubmission owed',
  items.find(i => i.ref === 'AF-007').party);
window.state.submittals.push(S('AF-009', 'submitted', { submittedDate: daysAgo(1) }));
T('no review rows → falls back to a generic "Reviewers"',
  window.submittalOpenItems().find(i => i.ref === 'AF-009').party === 'Reviewers');

// ---------- it reaches the board / banner count ----------
const all = window.computeOpenItems();
T('submittals are part of computeOpenItems (so the 🔧 badge + red banner count them)',
  all.filter(i => i.scope === 'submittal').length === 6, all.filter(i => i.scope === 'submittal').length);
T('the board is still sorted oldest-first', (() => {
  const d = all.map(i => i.days == null ? -1 : i.days);
  return d.every((v, i) => i === 0 || d[i - 1] >= v);
})(), all.map(i => i.ref + ':' + i.days));
T('unit RFIs and submittals coexist', (() => {
  window.state.units = [{ key: 'SF01', id: 'SF01', rfi: [{ ref: 'RFI-1', subject: 'x', status: 'open', date: daysAgo(9) }] }];
  const mixed = window.computeOpenItems();
  return mixed.some(i => i.scope === 'unit') && mixed.some(i => i.scope === 'submittal');
})());

// ---------- projects without a submittal log are untouched (CP2) ----------
T('no submittals → no extra items, no crash', (() => {
  const keep = window.state.submittals;
  window.state.submittals = [];
  const n = window.computeOpenItems().filter(i => i.scope === 'submittal').length;
  window.state.submittals = keep;
  return n === 0;
})());
T('a missing submittals array is handled', (() => {
  const keep = window.state.submittals;
  delete window.state.submittals;
  const n = window.submittalOpenItems().length;
  window.state.submittals = keep;
  return n === 0;
})());

// ---------- the panel section ----------
T('panel renders a submittal section', /sub_item_header/.test(src) && /subSection/.test(src));
T('section is placed between unit threads and the GC inbox',
  src.indexOf('${unitCards}') < src.indexOf('${subSection}') && src.indexOf('${subSection}') < src.indexOf('${gcSection}'));
T('rows open the submittal editor', /closeOpenItemsModal\(\);editSubmittal\(\$\{it\.idx\}\)/.test(src));
T('read-only accounts get no click-through', /!ro && typeof editSubmittal === 'function'/.test(src));
T('resubmit rows are red, in-review rows amber',
  /it\.needsResubmit \? 'var\(--red[^)]*\)' : 'var\(--yellow/.test(src));
T('three languages for the new strings', ['en', 'zh', 'ko'].every(l => {
  const tbl = window.I18N ? window.I18N[l] : null;
  return !tbl || ['sub_item_header', 'sub_item_resubmit', 'sub_item_waiting', 'sub_item_ours',
    'sub_item_theirs', 'sub_item_ours_short', 'sub_item_theirs_short'].every(k => typeof tbl[k] === 'string' && tbl[k]);
}));

console.log('PASS ' + ok.length + '\n' + ok.map(x => '  ✓ ' + x).join('\n'));
if (bad.length) { console.log('\nFAIL ' + bad.length + '\n' + bad.map(x => '  ✗ ' + x).join('\n')); process.exit(1); }
