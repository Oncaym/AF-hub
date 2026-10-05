/* The same cases as rules.local.test.cjs, against the real Realtime Database
   emulator. Runs in CI (platform-tests.yml):

     cd platform/tests && npm install && npm run test:emulator
*/
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { initializeTestEnvironment } from '@firebase/rules-unit-testing';

const require = createRequire(import.meta.url);
const { P, cases } = require('./rules.cases.cjs');
const here = path.dirname(fileURLToPath(import.meta.url));
const rules = fs.readFileSync(path.join(here, '..', 'project-database.rules.json'), 'utf8')
  .split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');

const [host, port] = (process.env.FIREBASE_DATABASE_EMULATOR_HOST || '127.0.0.1:9000').split(':');
const env = await initializeTestEnvironment({
  projectId: 'demo-afhub',
  database: { rules, host, port: Number(port) },
});

function ctxOf(name) {
  const p = P[name];
  if (!p) return env.unauthenticatedContext();
  if (p.anonymous) return env.authenticatedContext(p.uid, { firebase: { sign_in_provider: 'anonymous' } });
  return env.authenticatedContext(p.uid, { email: p.email, email_verified: p.verified, firebase: { sign_in_provider: 'password' } });
}
const clean = v => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)));

let pass = 0, fail = 0;
for (const k of cases) {
  await env.withSecurityRulesDisabled(async (admin) => { await admin.database().ref().set(clean(k.data)); });
  const ref = ctxOf(k.as).database().ref(k.path);
  let allowed = true;
  try {
    if (k.op === 'read') await ref.once('value');
    else if (k.op === 'update') await ref.update(clean(k.value));
    else await ref.set(clean(k.value) === undefined ? null : clean(k.value));
  } catch (e) {
    if (!/permission|denied/i.test(String(e && (e.code || e.message)))) { console.log(`ERROR ${k.name}:`, e.message); }
    allowed = false;
  }
  if (allowed === k.want) pass++;
  else { fail++; console.log(`FAIL  ${k.name}  (got ${allowed ? 'allowed' : 'denied'}, want ${k.want ? 'allowed' : 'denied'})`); }
}
await env.cleanup();
console.log(`rules (emulator): ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
