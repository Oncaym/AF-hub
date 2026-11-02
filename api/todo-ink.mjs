/* ============================================================
   ✍️ To-do handwriting reader (Leo 11-01)
   ============================================================
   POST /api/todo-ink
   Body: { token, image: 'data:image/jpeg;base64,…', today: 'YYYY-MM-DD', me: 'leo'|'jaesik', other }
   Returns: { text: string, tasks: [{ what, to, p, due, unsure }] }

   Who may use it: whoever may read the shared to-do list (the hub database rules decide —
   today only Leo and Jaesik). The picture is read and thrown away here; the page stores it.
   Requires ANTHROPIC_API_KEY in the Vercel project.
   ============================================================ */

const MODEL = process.env.TODO_MODEL || process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';
const HUB_DB = 'https://af-hub-8f188-default-rtdb.firebaseio.com';
const LIST = 'todo/leo-jaesik';
const PEOPLE = { leo: 'Leo', jaesik: 'Jaesik' };
const PROJECTS = {
  AC3: 'Atlantic Chestnut Building 3', CP2: 'Cooper Park 2 / Kingsland Commons', LEX: '355 Lexington',
  P7: 'Package 7 (Kingsbridge, 167th St)', FH: 'Forest Hill gutter', BAB: 'Babylon station', NPC: 'Nuyorican Poets Cafe',
};
const MAX_IMAGE_CHARS = 2_000_000;

const TASKS_TOOL = {
  name: 'tasks',
  description: 'Return what the handwritten page says, split into separate tasks.',
  input_schema: {
    type: 'object',
    properties: {
      text: { type: 'string', description: 'The whole page as written, line by line, in the language it was written in. Mark words you cannot read as [?].' },
      tasks: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            what: { type: 'string', description: 'One task as a short clear line, in the language it was written in (keep Chinese as Chinese, English as English, mixed as mixed). Do not translate. Leave out the project code and the date if they go into p and due.' },
            to: { type: 'string', enum: ['leo', 'jaesik'], description: 'Who does it. Default: the writer. The other person only if the note clearly says so (e.g. "Jaesik to review", "等 Jaesik 确认").' },
            p: { type: 'string', enum: ['', ...Object.keys(PROJECTS), 'Other'], description: 'Project code if the line names one, otherwise empty.' },
            due: { type: 'string', description: 'YYYY-MM-DD if the line gives a date or a day (周三, Wed, tomorrow, EOD, 下周一), worked out from today. Otherwise empty.' },
            unsure: { type: 'string', description: 'Words in this task you could not read for sure. Empty if none.' },
          },
          required: ['what', 'to'],
        },
      },
    },
    required: ['text', 'tasks'],
  },
};

async function allowed(token) {
  if (!token || typeof token !== 'string' || token.length > 5000) return false;
  const r = await fetch(`${HUB_DB}/${LIST}.json?shallow=true&auth=${encodeURIComponent(token)}`);
  return r.ok;
}

function weekday(iso) {
  const d = new Date(iso + 'T12:00:00Z');
  return isNaN(d) ? '' : ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getUTCDay()];
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return res.status(500).json({ error: 'ANTHROPIC_API_KEY is not set in the Vercel project' });
  let body = req.body;
  if (typeof body === 'string') { try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); } }
  const { token, image, today, me, other } = body || {};
  let ok = false;
  try { ok = await allowed(token); } catch (e) { ok = false; }
  if (!ok) return res.status(403).json({ error: 'Sign in again with your hub account.' });
  const m = /^data:(image\/(?:jpeg|png));base64,([A-Za-z0-9+/=]+)$/.exec(String(image || ''));
  if (!m || image.length > MAX_IMAGE_CHARS) return res.status(400).json({ error: 'The page picture is missing or too big.' });
  const day = /^\d{4}-\d\d-\d\d$/.test(today || '') ? today : new Date().toISOString().slice(0, 10);
  const writer = PEOPLE[me] ? me : 'leo', otherKey = PEOPLE[other] ? other : (writer === 'leo' ? 'jaesik' : 'leo');

  const system = `You read a handwritten page that ${PEOPLE[writer]} (an assistant project manager at Advanced Facade, a curtain wall and storefront subcontractor in New York) wrote on an iPad while ${PEOPLE[otherKey]} (the PM) gave him tasks.
Today is ${day} (${weekday(day)}).
The writing mixes Chinese and English, with construction shorthand: CW curtain wall, SF storefront, SD shop drawing, PD product data, EC engineering calc, CO change order, RFI, R&R revise and resubmit, GC general contractor, fab fabrication, calc calculation.
Projects and their codes: ${Object.entries(PROJECTS).map(([k, v]) => `${k} = ${v}`).join('; ')}.
Rules:
- Split the page into separate tasks: usually one per line or per bullet; join a line that clearly continues the one above.
- Keep the writer's language and words. Do not translate, do not add steps that are not written.
- Crossed-out writing is not a task.
- If a word is unreadable, keep your best guess and list it in "unsure".
- Always answer with the tasks tool.`;

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2000,
        system,
        tools: [TASKS_TOOL],
        tool_choice: { type: 'tool', name: 'tasks' },
        messages: [{ role: 'user', content: [
          { type: 'image', source: { type: 'base64', media_type: m[1], data: m[2] } },
          { type: 'text', text: 'Read this page and split it into tasks.' },
        ] }],
      }),
    });
    if (!r.ok) {
      const t = await r.text();
      console.error('Anthropic API error:', r.status, t);
      const credit = /credit balance/i.test(t);
      return res.status(502).json({ error: credit
        ? "The hub's Claude API credit has run out. Add credits at console.anthropic.com → Plans & Billing, then try again."
        : `Claude API ${r.status}` });
    }
    const data = await r.json();
    const use = (data.content || []).find(b => b.type === 'tool_use' && b.name === 'tasks');
    const out = (use && use.input) || {};
    const tasks = (Array.isArray(out.tasks) ? out.tasks : []).slice(0, 30).map(t => ({
      what: String(t.what || '').trim().slice(0, 300),
      to: t.to === otherKey ? otherKey : writer,
      p: Object.prototype.hasOwnProperty.call(PROJECTS, t.p) || t.p === 'Other' ? t.p : '',
      due: /^\d{4}-\d\d-\d\d$/.test(t.due || '') ? t.due : '',
      unsure: String(t.unsure || '').slice(0, 200),
    })).filter(t => t.what);
    return res.status(200).json({ text: String(out.text || '').slice(0, 4000), tasks, _model: MODEL, _usage: data.usage || null });
  } catch (e) {
    console.error('todo-ink error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
