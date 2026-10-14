/* ============================================================
   Design Board — Claude endpoint (/design/ and the desktop helper)
   ============================================================
   POST /api/design
   Body: {
     token:  Firebase ID token of the signed-in person (required),
     board:  'ac3',
     mode:   'split' | 'ask',
     text:   pasted conversation / email (split) or a question (ask),
     images: ['data:image/jpeg;base64,…'] (split: up to 6 screenshots),
     context: { me, drawings: [{k, no, title, rev, owner, status}],
                issues: [{id, n, dwg, where, text, status, owner, reviewer, fixedRev}] }
   }
   Returns (split): { comments: [{ images:[i], dwg, where, text, orig, reviewer, owner,
                                   already_fixed, unclear, question }], note }
   Returns (ask):   { answer, actions: [{ kind, id|dwg, status, rev, owner, why }] }

   Nothing is written here. The page shows what Claude proposes and the
   person presses a button for each change; the database rules then apply
   to that person as usual.

   Only editors of the design database may call it: the token is checked by
   asking the design database itself for the caller's own allowlist entry
   (Firebase verifies the token; the rules return true only for that person).
   Requires ANTHROPIC_API_KEY in the Vercel project (same key as Tracker Chat).
   ============================================================ */

const MODEL = process.env.DESIGN_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const DESIGN_DB = 'https://af-hub-8f188-design.firebaseio.com';
const MAX_IMAGES = 6;
const MAX_BODY_CHARS = 4_200_000;

const SPLIT_TOOL = {
  name: 'propose_comments',
  description: 'Return the separate review comments found in the pasted material.',
  input_schema: {
    type: 'object',
    properties: {
      comments: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            images: { type: 'array', items: { type: 'integer' }, description: 'Indexes (0-based) of the screenshots this comment is about.' },
            dwg: { type: 'string', description: 'Key of the drawing from the drawing list, or "" when not sure.' },
            where: { type: 'string', description: 'Detail / section / elevation title as shown on the sheet, e.g. "Typ. Perimeter Section @ West Sunshade".' },
            text: { type: 'string', description: 'One change, in plain English, as an instruction to the drafter.' },
            orig: { type: 'string', description: 'The reviewer\'s own words, unchanged (any language). "" if the comment is only a markup.' },
            reviewer: { type: 'string', description: 'Who asked for the change (name as it appears).' },
            owner: { type: 'string', description: 'Who should fix it, if clear (name as it appears), else "".' },
            already_fixed: { type: 'boolean', description: 'True when the drafter already said it is fixed / sent the fixed picture.' },
            unclear: { type: 'boolean', description: 'True when the markup has no words and the intent is a guess.' },
            question: { type: 'string', description: 'When unclear: the question to ask the reviewer.' },
          },
          required: ['text'],
        },
      },
      note: { type: 'string', description: 'Anything the person should know (e.g. a promise that has no comment yet). "" if none.' },
    },
    required: ['comments'],
  },
};

const ASK_TOOL = {
  name: 'answer',
  description: 'Answer the question from the board data, and propose changes only when the person asked for a change.',
  input_schema: {
    type: 'object',
    properties: {
      answer: { type: 'string', description: 'Short, plain answer. Refer to comments as #n and drawings by number.' },
      actions: {
        type: 'array',
        description: 'Changes the person asked for. Each one is shown with a confirm button; nothing happens without it.',
        items: {
          type: 'object',
          properties: {
            kind: { type: 'string', enum: ['comment_status', 'drawing_status', 'drawing_owner'] },
            id: { type: 'string', description: 'comment_status: the comment id (not #n).' },
            dwg: { type: 'string', description: 'drawing_*: the drawing key.' },
            status: { type: 'string', description: 'comment: open | ask | fixed | closed. drawing: drafting | review | revise | submitted | returned | approved.' },
            rev: { type: 'string', description: 'comment_status fixed: the rev it was fixed in, if said.' },
            owner: { type: 'string', description: 'drawing_owner: who has the drawing now.' },
            why: { type: 'string', description: 'One line shown next to the confirm button.' },
          },
          required: ['kind', 'why'],
        },
      },
    },
    required: ['answer'],
  },
};

function systemPrompt(mode, board, ctx) {
  const ds = (ctx.drawings || []).slice(0, 400).map(d => `${d.k} | ${d.no} | ${d.title || ''}${d.rev ? ' | rev ' + d.rev : ''}${d.owner ? ' | with ' + d.owner : ''}${d.status ? ' | ' + d.status : ''}`).join('\n');
  const is = (ctx.issues || []).slice(0, 600).map(i => `id=${i.id} #${i.n} [${i.status}] dwg=${i.dwg || '-'} ${i.where ? '(' + i.where + ') ' : ''}${i.text}${i.owner ? ' | for ' + i.owner : ''}${i.reviewer ? ' | from ' + i.reviewer : ''}${i.fixedRev ? ' | fixed in rev ' + i.fixedRev : ''}`).join('\n');
  const common = `You help Advanced Facade's design team (curtain wall / storefront shop drawings) keep track of review comments on project "${board}".
The person using this is ${ctx.me || 'a designer'}. Today is ${new Date().toISOString().slice(0, 10)}.
A review comment closes twice: the drafter marks it "fixed" (with the rev), then the reviewer checks and "closes" it. Status words: open = to fix, ask = waiting for the reviewer to explain, fixed = drafter says done, waiting for the reviewer's check, closed = checked.
Drawing list (key | number | title | …):
${ds || '(no drawings yet)'}`;
  if (mode === 'split') {
    return common + `

Your job: the person pastes a review conversation (often Discord, Korean / English / Chinese mixed) and/or screenshots of shop drawings with hand markups. Turn it into SEPARATE review comments, one change each.
- Write "text" as a short English instruction a drafter can act on ("Change TOB to T.O.HSS at the East Glass Canopy HSS"). Keep units and callouts exactly as written (6'-5", T.O.HSS, W8X20).
- Keep the reviewer's own words in "orig" unchanged.
- A promise like "will do the same for South & East" is its own comment (it is the one most often forgotten).
- If the drafter already replied that it is fixed (or posted the corrected picture), set already_fixed = true.
- A markup with no words: make a comment with unclear = true, describe what is circled, and write the question to ask.
- A thumbs-up or ✅ reaction only means "seen", not "fixed".
- Match the drawing from the sheet/detail title visible in the screenshot against the drawing list; use its key in "dwg". If you are not sure, leave dwg "" and put the detail title in "where". Never invent a drawing number.
- Do not repeat comments that already exist below (same drawing and same change).
Existing comments:
${is || '(none)'}`;
  }
  return common + `

Existing comments:
${is || '(none)'}

Answer the person's question from this data only. Be brief. If they ask "what is left", list open/ask comments for them or for the drawing they name. "What changed in rev X" = comments fixed in rev X.
Only propose actions when the person asks for a change ("mark #3 fixed in rev 2", "AC3-103 is submitted", "give AC3-500 to Henry"). A comment can only become closed from fixed.`;
}

function decodeJwt(t) {
  try { return JSON.parse(Buffer.from(String(t).split('.')[1], 'base64url').toString('utf8')); } catch (e) { return null; }
}
async function isEditor(token) {
  const p = decodeJwt(token);
  if (!p || !p.email) return null;
  const key = encodeURIComponent(String(p.email).replace(/\./g, ','));
  const r = await fetch(`${DESIGN_DB}/allowlist/${key}.json?auth=${encodeURIComponent(token)}`);
  if (!r.ok) return null;
  return (await r.json()) === true ? p.email : null;
}

function imageBlock(d) {
  const m = /^data:(image\/(?:jpeg|png|webp|gif));base64,(.+)$/.exec(String(d || ''));
  return m ? { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } } : null;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in the Vercel project' });

  let body = req.body;
  if (typeof body === 'string') {
    if (body.length > MAX_BODY_CHARS) return res.status(413).json({ error: 'Too much at once: fewer or smaller screenshots.' });
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const { token, board, mode, text, images, context } = body || {};
  if (mode !== 'split' && mode !== 'ask') return res.status(400).json({ error: 'mode must be split or ask' });
  if (!/^[a-z0-9][a-z0-9-]{1,23}$/.test(String(board || ''))) return res.status(400).json({ error: 'board?' });

  let who;
  try { who = await isEditor(token); } catch (e) { who = null; }
  if (!who) return res.status(403).json({ error: 'Only design-board editors can use Claude here. Sign in again, or ask Leo to add you.' });

  const imgs = mode === 'split' ? (Array.isArray(images) ? images : []).slice(0, MAX_IMAGES).map(imageBlock).filter(Boolean) : [];
  const t = String(text || '').slice(0, 20000);
  if (!t.trim() && !imgs.length) return res.status(400).json({ error: 'Nothing to read: paste the conversation or a screenshot.' });

  const content = [];
  imgs.forEach((b, i) => { content.push({ type: 'text', text: `Screenshot ${i}:` }); content.push(b); });
  content.push({ type: 'text', text: mode === 'split' ? (t.trim() ? 'Pasted text:\n' + t : 'Only screenshots were pasted.') : t });

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 4096,
        system: systemPrompt(mode, board, Object.assign({}, context || {}, { me: who })),
        tools: [mode === 'split' ? SPLIT_TOOL : ASK_TOOL],
        tool_choice: { type: 'tool', name: mode === 'split' ? SPLIT_TOOL.name : ASK_TOOL.name },
        messages: [{ role: 'user', content }],
      }),
    });
    if (!r.ok) {
      const errText = await r.text();
      console.error('Anthropic API error:', r.status, errText);
      return res.status(502).json({ error: `Claude API ${r.status}: ${errText.slice(0, 300)}` });
    }
    const data = await r.json();
    const use = (data.content || []).find(b => b.type === 'tool_use');
    if (!use) return res.status(502).json({ error: 'Claude did not answer in the expected form' });
    const out = use.input || {};
    if (mode === 'split') {
      return res.status(200).json({ comments: Array.isArray(out.comments) ? out.comments : [], note: out.note || '', _model: MODEL, _usage: data.usage || null });
    }
    return res.status(200).json({ answer: out.answer || '', actions: Array.isArray(out.actions) ? out.actions : [], _model: MODEL, _usage: data.usage || null });
  } catch (e) {
    console.error('design.mjs error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
