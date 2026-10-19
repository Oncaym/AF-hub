#!/usr/bin/env node
/* The hub's own database (af-hub-8f188-default-rtdb, rules in /firebase-database-rules.json):
   trackers still push summaries anonymously, but only verified staff read the portfolio.
     node platform/tests/hub-rules.local.test.cjs */
const fs = require('fs');
const path = require('path');
const targaryen = require('targaryen');
const rules = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'firebase-database-rules.json'), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));
const who = (email, verified = true) => ({ uid: 'u_' + email.replace(/\W/g, '_'), provider: 'password',
  token: { email, email_verified: verified, firebase: { sign_in_provider: 'password' } } });
const ANON = { uid: 'anon', provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } };
const STAFF = who('boss@advfacade.com'), UNVER = who('x@advfacade.com', false), GC = who('pm@turner.com'), FOREMAN = who('joe@gmail.com');
const ADMIN_GMAIL = who('owner@gmail.com');
const SHOP = Object.assign(who('shop.lead@gmail.com'), {}); SHOP.token.shop = true;   // the shop list (custom claim)
const data = { admins: { [ADMIN_GMAIL.uid]: true }, projects: { ac3: { summary: { name: 'AC3', done: 1, total: 2, ts: 1 } } } };
const summary = { name: 'AC3', unit: 'openings', done: 2, total: 2, ts: 2, url: 'https://af-hub-two.vercel.app/ac3/' };
let pass = 0, fail = 0;
const c = (name, got, want) => { if (got === want) pass++; else { fail++; console.log(`FAIL  ${name} (got ${got}, want ${want})`); } };
const db = a => targaryen.database(rules, data, 1790000000000).as(a);
c('anonymous tracker pushes a summary', db(ANON).write('/projects/ac3/summary', summary).allowed, true);
c('anonymous cannot read the portfolio', db(ANON).read('/projects').allowed, false);
c('verified staff reads the portfolio', db(STAFF).read('/projects').allowed, true);
c('unverified @advfacade cannot read', db(UNVER).read('/projects').allowed, false);
c('GC cannot read the portfolio', db(GC).read('/projects').allowed, false);
c('foreman cannot read the portfolio', db(FOREMAN).read('/projects').allowed, false);
c('an admin by uid reads the portfolio', db(ADMIN_GMAIL).read('/projects').allowed, true);
c('a summary with an unknown field is refused', db(ANON).write('/projects/ac3/summary', Object.assign({ evil: 1 }, summary)).allowed, false);
c('GC cannot read damage', db(GC).read('/damage').allowed, false);
c('staff files damage', db(STAFF).write('/damage/ac3/d1', { type: 'glass', by: 'boss@advfacade.com', ts: 1 }).allowed, true);
c('GC cannot file damage', db(GC).write('/damage/ac3/d1', { type: 'glass', by: 'pm@turner.com', ts: 1 }).allowed, false);
c('no v2 tree any more', db(STAFF).read('/v2').allowed, false);

// 🚚 To send for projects without a dashboard (2026-10-19): staff only; own requests only
const STAFF2 = who('shop@advfacade.com');
const site = { name: 'Package 7', by: 'boss@advfacade.com', at: 1 };
const req = (by, extra) => Object.assign({ what: 'mullion caps', by, at: 1, _project: 's_package_7' }, extra || {});
const withSite = Object.assign({}, data, { sendSites: { s_package_7: site }, toSend: { s_package_7: { r1: req('boss@advfacade.com') } } });
const db2 = a => targaryen.database(rules, withSite, 1790000000000).as(a);
c('staff adds a project without a dashboard', db(STAFF).write('/sendSites/s_package_7', site).allowed, true);
c('a project id must start with s_', db(STAFF).write('/sendSites/ac3', site).allowed, false);
c('a project needs a name', db(STAFF).write('/sendSites/s_x', { name: '', by: 'boss@advfacade.com', at: 1 }).allowed, false);
c('GC cannot add a project', db(GC).write('/sendSites/s_x', site).allowed, false);
c('foreman (personal email) cannot read the list', db(FOREMAN).read('/toSend').allowed, false);
c('anonymous cannot read the list', db(ANON).read('/sendSites').allowed, false);
c('staff reads the list', db2(STAFF2).read('/toSend').allowed && db2(STAFF2).read('/sendSites').allowed, true);
c('staff marks a project finished', db2(STAFF2).write('/sendSites/s_package_7/done', true).allowed, true);
c('staff cannot delete a project', db2(STAFF2).write('/sendSites/s_package_7', null).allowed, false);
c('an admin can delete a project', db2(ADMIN_GMAIL).write('/sendSites/s_package_7', null).allowed, true);
c('staff adds a request with qty and need-by', db2(STAFF2).write('/toSend/s_package_7/r2', req('shop@advfacade.com', { qty: 12, need: '2026-10-21', note: 'bay 3' })).allowed, true);
c('a request for a project that does not exist is refused', db2(STAFF2).write('/toSend/s_nope/r2', Object.assign(req('shop@advfacade.com'), { _project: 's_nope' })).allowed, false);
c('a request stamped with another project is refused', db2(STAFF2).write('/toSend/s_package_7/r2', req('shop@advfacade.com', { _project: 's_other' })).allowed, false);
c('a request in somebody else\'s name is refused', db2(STAFF2).write('/toSend/s_package_7/r2', req('boss@advfacade.com')).allowed, false);
c('staff cannot remove somebody else\'s request', db2(STAFF2).write('/toSend/s_package_7/r1', null).allowed, false);
c('whoever added it removes it', db2(STAFF).write('/toSend/s_package_7/r1', null).allowed, true);
c('staff (not on the shop list) cannot mark it sent', db2(STAFF2).write('/toSend/s_package_7/r1/sent', { by: 'shop@advfacade.com', at: 2 }).allowed, false);
c('whoever added it cannot mark it sent either', db2(STAFF).write('/toSend/s_package_7/r1', req('boss@advfacade.com', { sent: { by: 'boss@advfacade.com', at: 2 } })).allowed, false);
c('the shop reads the list', db2(SHOP).read('/toSend').allowed && db2(SHOP).read('/sendSites').allowed, true);
c('the shop marks it sent', db2(SHOP).write('/toSend/s_package_7/r1/sent', { by: 'shop.lead@gmail.com', at: 2 }).allowed, true);
c('sent in somebody else\'s name is refused', db2(SHOP).write('/toSend/s_package_7/r1/sent', { by: 'boss@advfacade.com', at: 2 }).allowed, false);
c('the shop cannot add a request (only Sent)', db2(SHOP).write('/toSend/s_package_7/r9', req('shop.lead@gmail.com')).allowed, false);
c('GC cannot mark sent', db2(GC).write('/toSend/s_package_7/r1/sent', { by: 'pm@turner.com', at: 2 }).allowed, false);
c('an unknown field is refused', db2(STAFF2).write('/toSend/s_package_7/r2', req('shop@advfacade.com', { truck: 1 })).allowed, false);
c('staff records a WeChat request (who asked, when)', db2(STAFF2).write('/toSend/s_package_7/r3', req('shop@advfacade.com', { askedBy: '小李', askedAt: 5, src: 'wechat' })).allowed, true);
c('a bad need-by is refused', db2(STAFF2).write('/toSend/s_package_7/r2', req('shop@advfacade.com', { need: '10/21' })).allowed, false);
console.log(`hub rules (local simulator): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
