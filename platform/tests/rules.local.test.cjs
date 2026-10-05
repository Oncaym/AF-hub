#!/usr/bin/env node
/* Fast local check of platform/project-database.rules.json with targaryen, a
   pure-JS rules simulator. The emulator run (rules.emulator.test.mjs, in CI) is
   the authority; this one needs no Java and runs in a second:

     cd platform/tests && npm install && npm run test:local
*/
const fs = require('fs');
const path = require('path');
const targaryen = require('targaryen');
const { P, cases, NOW } = require('./rules.cases.cjs');

const RULES_FILE = path.join(__dirname, '..', 'project-database.rules.json');
const rules = JSON.parse(fs.readFileSync(RULES_FILE, 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n'));

function authOf(name) {
  const p = P[name];
  if (!p) return null;
  if (p.anonymous) return { uid: p.uid, provider: 'anonymous', token: { firebase: { sign_in_provider: 'anonymous' } } };
  return { uid: p.uid, provider: 'password',
    token: { email: p.email, email_verified: p.verified, firebase: { sign_in_provider: 'password' } } };
}
const clean = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

let pass = 0, fail = 0;
for (const k of cases) {
  const db = targaryen.database(rules, clean(k.data), NOW).with({ debug: true }).as(authOf(k.as));
  const r = k.op === 'read' ? db.read(k.path) : k.op === 'update' ? db.update(k.path, clean(k.value)) : db.write(k.path, clean(k.value));
  if (r.allowed === k.want) pass++;
  else {
    fail++;
    console.log(`FAIL  ${k.name}  (got ${r.allowed ? 'allowed' : 'denied'}, want ${k.want ? 'allowed' : 'denied'})`);
    if (process.env.DEBUG) console.log(r.info);
  }
}
console.log(`rules (local simulator): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
