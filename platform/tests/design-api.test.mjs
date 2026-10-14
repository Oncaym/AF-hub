#!/usr/bin/env node
/* api/design.mjs with fetch stubbed: who may call it, what is sent to Claude,
   what comes back. No network, no API key spent.

     node platform/tests/design-api.test.mjs
*/
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const { default: handler } = await import(pathToFileURL(path.join(here, '..', '..', 'api', 'design.mjs')).href);

let pass = 0, fail = 0;
const ok = (c, m) => { if (c) pass++; else { fail++; console.log('FAIL  ' + m); } };

const jwt = payload => ['x', Buffer.from(JSON.stringify(payload)).toString('base64url'), 'sig'].join('.');
const EDITOR = jwt({ email: 'henry.kim@advfacade.com' }), OTHER = jwt({ email: 'joe.foreman@gmail.com' });
const PNG = 'data:image/png;base64,iVBORw0KGgo=';

let sent = null;
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://af-hub-8f188-design.firebaseio.com/allowlist/')) {
    const auth = new URL(url).searchParams.get('auth');
    const isHenry = decodeURIComponent(url).includes('henry,kim@advfacade,com') && auth === EDITOR;
    return { ok: true, json: async () => (isHenry ? true : null) };
  }
  if (url === 'https://api.anthropic.com/v1/messages') {
    sent = JSON.parse(opts.body);
    const tool = sent.tool_choice.name;
    const input = tool === 'propose_comments'
      ? { comments: [{ images: [0], dwg: 'AC3-103', text: 'Change TOB to T.O.HSS', orig: 'tob 대신에 t.o.hss', reviewer: 'SPARK' }], note: '' }
      : { answer: '#1 is still open.', actions: [{ kind: 'comment_status', id: 'i1', status: 'fixed', rev: '3', why: 'Mark #1 fixed in rev 3' }] };
    return { ok: true, json: async () => ({ content: [{ type: 'tool_use', name: tool, input }], usage: { input_tokens: 1 } }) };
  }
  throw new Error('unexpected fetch ' + url);
};
process.env.ANTHROPIC_API_KEY = 'test-key';

function call(body, method = 'POST') {
  return new Promise(resolve => {
    const res = { code: 0, body: null, status(c) { this.code = c; return this; }, json(b) { this.body = b; resolve(this); return this; }, end() { resolve(this); return this; } };
    handler({ method, body }, res);
  });
}
const CTX = { drawings: [{ k: 'AC3-103', no: 'AC3-103', title: 'CURTAIN WALL SECTION (SF-01)' }], issues: [{ id: 'i1', n: 1, dwg: 'AC3-103', text: 'x', status: 'open' }] };

let r = await call({ token: OTHER, board: 'ac3', mode: 'split', text: 'hi' });
ok(r.code === 403, 'someone who is not a design editor is refused');
r = await call({ board: 'ac3', mode: 'split', text: 'hi' });
ok(r.code === 403, 'no token is refused');
r = await call({ token: EDITOR, board: 'ac3', mode: 'delete', text: 'hi' });
ok(r.code === 400, 'unknown mode refused');
r = await call({ token: EDITOR, board: '../x', mode: 'ask', text: 'hi' });
ok(r.code === 400, 'bad board id refused');
r = await call({ token: EDITOR, board: 'ac3', mode: 'split', text: '  ' });
ok(r.code === 400, 'nothing to read refused');
r = await call({ token: EDITOR, board: 'ac3', mode: 'ask', text: 'x' }, 'GET');
ok(r.code === 405, 'GET refused');

sent = null;
r = await call(JSON.stringify({ token: EDITOR, board: 'ac3', mode: 'split', text: 'tob 대신에 t.o.hss 로 적어주세요', images: [PNG, 'javascript:1'], context: CTX }));
ok(r.code === 200 && r.body.comments.length === 1 && r.body.comments[0].dwg === 'AC3-103', 'split: proposals come back');
ok(sent && sent.tool_choice.name === 'propose_comments' && sent.max_tokens > 0, 'split: Claude is forced to the propose tool');
ok(sent.messages[0].content.filter(b => b.type === 'image').length === 1, 'split: only real images are sent');
ok(/AC3-103 \| AC3-103 \| CURTAIN WALL SECTION/.test(sent.system) && /henry\.kim@advfacade\.com/.test(sent.system), 'split: drawing list and caller are in the prompt');
ok(/✅ reaction only means "seen"/.test(sent.system), 'split: the ✅ rule is in the prompt');

r = await call({ token: EDITOR, board: 'ac3', mode: 'ask', text: 'what is left?', images: [PNG], context: CTX });
ok(r.code === 200 && r.body.answer === '#1 is still open.' && r.body.actions.length === 1, 'ask: answer and proposed actions come back');
ok(sent.tool_choice.name === 'answer' && !sent.messages[0].content.some(b => b.type === 'image'), 'ask: no images sent');
ok(/id=i1 #1 \[open\]/.test(sent.system), 'ask: comments are in the prompt');

delete process.env.ANTHROPIC_API_KEY;
r = await call({ token: EDITOR, board: 'ac3', mode: 'ask', text: 'x' });
ok(r.code === 500 && /ANTHROPIC_API_KEY/.test(r.body.error), 'missing key says so');

console.log(`design api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
