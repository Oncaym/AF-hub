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
const DISCORD_MSGS = [
  { id: '1002', timestamp: '2026-09-28T14:19:00Z', author: { username: 'af_henry', global_name: 'AF_Henry' }, content: '네, 이거는 고쳤습니다.', referenced_message: { author: { username: 'spark' } }, attachments: [] },
  { id: '1001', timestamp: '2026-09-28T14:16:00Z', author: { username: 'spark', global_name: 'SPARK' }, content: 'tob 대신에 t.o.hss 로 적어주세요',
    attachments: [{ filename: 'markup.png', content_type: 'image/png', width: 2800, height: 1400, url: 'https://cdn.discordapp.com/a/markup.png?ex=1', proxy_url: 'https://media.discordapp.net/a/markup.png?ex=1' }],
    reactions: [{ emoji: { name: '✅' }, count: 1 }] },
];
let discordHits = [];
globalThis.fetch = async (url, opts) => {
  url = String(url);
  if (url.startsWith('https://discord.com/api/v10/channels/')) {
    discordHits.push(url);
    if ((opts.headers || {}).Authorization !== 'Bot bot-token') return { ok: false, status: 401, json: async () => ({}) };
    return { ok: true, json: async () => DISCORD_MSGS.slice() };
  }
  if (url.startsWith('https://media.discordapp.net/')) {
    discordHits.push(url);
    return { ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => Buffer.from('PNGDATA') };
  }
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
ok(/Counts \(exact[^)]*\): 1 drawings .*by series 100s: 1.* 1 comments — by status open: 1/.test(sent.system), 'ask: exact counts are given, so Claude does not count by itself');

// Discord pull
r = await call({ token: EDITOR, board: 'ac3', mode: 'pull', context: CTX });
ok(r.code === 400 && /not connected/.test(r.body.error), 'pull: says so when Discord is not set up');
process.env.DISCORD_BOT_TOKEN = 'bot-token';
process.env.DISCORD_CHANNELS = JSON.stringify({ ac3: '555' });
r = await call({ token: OTHER, board: 'ac3', mode: 'pull' });
ok(r.code === 403 && !discordHits.length, 'pull: a non-editor never reaches Discord');
r = await call({ token: EDITOR, board: 'hillview', mode: 'pull' });
ok(r.code === 400 && /not connected for "hillview"/.test(r.body.error), 'pull: only channels listed for that board');
sent = null; discordHits = [];
r = await call({ token: EDITOR, board: 'ac3', mode: 'pull', after: '1000', context: CTX });
ok(r.code === 200 && r.body.last_id === '1002' && r.body.images.length === 1 && /^data:image\/png;base64,/.test(r.body.images[0]), 'pull: returns last id and the screenshot');
ok(discordHits[0].includes('/channels/555/messages') && discordHits[0].includes('after=1000'), 'pull: reads the board\'s channel after the last pull');
ok(discordHits[1].startsWith('https://media.discordapp.net/a/markup.png?ex=1&width=1400&height=700'), 'pull: asks Discord for a smaller picture');
const tr = r.body.transcript || '';
ok(tr.indexOf('SPARK') < tr.indexOf('AF_Henry') && /reply to spark/.test(tr) && /\[screenshot 0\]/.test(tr) && /✅×1/.test(tr), 'pull: transcript oldest first, with replies, screenshots and reactions');
ok(sent.tool_choice.name === 'propose_comments' && sent.messages[0].content.filter(b => b.type === 'image').length === 1, 'pull: Claude splits it like a paste');
process.env.DISCORD_BOT_TOKEN = 'wrong';
r = await call({ token: EDITOR, board: 'ac3', mode: 'pull' });
ok(r.code === 400 && /token is wrong/.test(r.body.error), 'pull: a wrong bot token is reported plainly');

delete process.env.ANTHROPIC_API_KEY;
r = await call({ token: EDITOR, board: 'ac3', mode: 'ask', text: 'x' });
ok(r.code === 500 && /ANTHROPIC_API_KEY/.test(r.body.error), 'missing key says so');

console.log(`design api: ${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
