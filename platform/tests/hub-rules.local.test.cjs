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
console.log(`hub rules (local simulator): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
