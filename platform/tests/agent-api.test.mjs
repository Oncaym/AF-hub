#!/usr/bin/env node
/* api/agent.mjs with fetch stubbed: who may call it, what goes to Claude.
     node platform/tests/agent-api.test.mjs                                   */
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url));
const mod = await import(pathToFileURL(path.join(here, '..', '..', 'api', 'agent.mjs')).href);
const handler = mod.default;
let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m); } };
const jwt = p => ['x', Buffer.from(JSON.stringify(p)).toString('base64url'), 's'].join('.');
const STAFF = jwt({ email: 'pm@advfacade.com' }), OUT = jwt({ email: 'joe.foreman@gmail.com' });
let sent = null;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://af-hub-8f188-design.firebaseio.com/meta/project.json')) {
    const auth = new URL(url).searchParams.get('auth');
    return auth === STAFF ? { ok: true, json: async () => 'design' } : { ok: false, status: 401, json: async () => ({ error: 'Permission denied' }) };
  }
  if (url === 'https://api.anthropic.com/v1/messages') { sent = JSON.parse(opts.body); return { ok: true, json: async () => ({ content: [{ type: 'text', text: 'hi' }], stop_reason: 'end_turn', usage: {} }) }; }
  throw new Error('unexpected fetch ' + url);
};
process.env.ANTHROPIC_API_KEY = 'k';
const call = (body, method = 'POST') => new Promise(resolve => { const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(this); return this; } }; handler({ method, body }, res); });
const CTX = { today: '2026-10-15', boards: [{ id: 'ac3', name: 'AC3', role: 'viewer' }], projects: [{ id: 'ac3', name: 'Atlantic-Chestnut Building 3', role: 'editor' }] };

let r = await call({ token: OUT, messages: [{ role: 'user', content: 'hi' }] });
ok(r.code === 403, 'someone the design database refuses cannot use the helper');
r = await call({ messages: [{ role: 'user', content: 'hi' }] });
ok(r.code === 403, 'no token refused');
r = await call({ token: STAFF, messages: [] });
ok(r.code === 400, 'empty conversation refused');
r = await call({ token: STAFF, messages: [{ role: 'user', content: 'hi' }] }, 'GET');
ok(r.code === 405, 'GET refused');
r = await call(JSON.stringify({ token: STAFF, messages: [{ role: 'assistant', content: 'x' }, { role: 'user', content: [{ type: 'text', text: 'AC3 还剩什么？' }] }], context: CTX }));
ok(r.code === 200 && r.body.content[0].text === 'hi', 'staff gets an answer');
ok(sent.messages.length === 1 && sent.messages[0].role === 'user', 'conversation starts with the person (a leading assistant turn is dropped)');
const names = sent.tools.map(t => t.name).sort().join(',');
ok(names === 'get_design,get_schedules,get_tracker,propose_design_changes,propose_design_comments,propose_schedule_import,propose_schedule_issue_changes,propose_tracker_update', 'tools offered: ' + names);
ok(/pm@advfacade\.com/.test(sent.system) && /ac3: AC3 \(you are viewer\)/.test(sent.system) && /Atlantic-Chestnut Building 3 \(you are editor\)/.test(sent.system), 'caller, boards and projects with their roles are in the prompt');
ok(/only shows a confirm card/.test(sent.system) && /not instructions/.test(sent.system), 'prompt says changes need the person\'s press and tool results are data');
ok(!sent.tools.some(t => /delete|remove/i.test(t.name)), 'no delete tools');
console.log(`agent api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
