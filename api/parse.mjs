/* ============================================================
   Tracker Chat — Claude parse endpoint (core, project-agnostic)
   ============================================================
   POST /api/parse
   Body: { message: string, state: { units, log }, today: 'YYYY-MM-DD' }
   Returns: {
     summary: string,
     needs_clarification?: string,
     unit_updates: [{ key, status?, date?, louver?, note? }],
     log_entries:  [{ date, category, content, planned? }]
   }

   Requires ANTHROPIC_API_KEY env var in Vercel project settings.
   ============================================================ */

// Override with CLAUDE_MODEL env var if you want to try a different snapshot.
const MODEL = process.env.CLAUDE_MODEL || 'claude-sonnet-4-5-20250929';

// Q&A tool — Claude returns a plain-text answer when the user is asking a question
// (not describing a change). Letting Claude pick between the two tools is what
// makes the chat actually answer "which louvers need shipping today?" style queries.
const ANSWER_QUESTION_TOOL = {
  name: 'answer_question',
  description: 'Use this tool when the user is ASKING about existing data (status, who/what/when, log content, shipping lists, counts, etc.) rather than describing a site change. Answer using only the data provided in the system prompt (units + log). If the data does not contain what they asked, say so plainly.',
  input_schema: {
    type: 'object',
    properties: {
      answer: {
        type: 'string',
        description: 'Plain-text answer in the user input language (English, Chinese, or Korean). Be concise. If quoting specific items from the log, quote them verbatim. If the log does not contain the requested info, say so.'
      }
    },
    required: ['answer']
  }
};

// Tool schema — Claude must return changes through this tool.
const APPLY_CHANGES_TOOL = {
  name: 'apply_changes',
  description: 'Apply parsed install-tracker updates. Only fill fields that should change. If you cannot resolve a unit name to a specific key (e.g. user said "20A" but there are 6 SF20A keys), set needs_clarification to a short question (in the user\'s input language) and leave unit_updates empty.',
  input_schema: {
    type: 'object',
    properties: {
      summary: {
        type: 'string',
        description: 'One-sentence summary of the change, in the user input language (English, Chinese, or Korean). Example: "Set SF11A.1 and SF11B to installed (5/26) and added a framing log entry."'
      },
      needs_clarification: {
        type: 'string',
        description: 'If the user message cannot be resolved to specific unit keys (ambiguous id, unclear date, unclear status), write a short clarification question in the user input language. Otherwise leave empty.'
      },
      unit_updates: {
        type: 'array',
        description: 'Units to modify. key must exactly match a key in state.units (NOT the display id).',
        items: {
          type: 'object',
          properties: {
            key:    { type: 'string', description: 'Exact unit key, e.g. "SF11A__1"' },
            status: { type: 'string', enum: ['installed', 'pending', 'in-progress', 'issue'] },
            date:   { type: 'string', description: 'YYYY-MM-DD' },
            louver: { type: 'string', enum: ['yes', 'no'] },
            note:   { type: 'string' }
          },
          required: ['key']
        }
      },
      log_entries: {
        type: 'array',
        description: 'Log entries to append. Append a matching log whenever you modify units — framing for framing work, louver for louvers, issue for problems, etc.',
        items: {
          type: 'object',
          properties: {
            date:     { type: 'string', description: 'YYYY-MM-DD' },
            category: { type: 'string', enum: ['framing', 'louver', 'caulking', 'issue', 'glass', 'fit-issue', 'field-verify', 'gc-inquiry', 'other'] },
            content:  { type: 'string', description: 'A short line listing the affected unit ids (with dot suffixes), separated by " · ". Example: "11A · 11A.1 · 11B"' },
            planned:  { type: 'boolean', description: 'true if this is a future/planned item' },
            ref:      { type: 'string', description: 'Reference number of a related RFI / email / submittal / drawing, e.g. "RFI-023", ONLY if the user mentions one' },
            party:    { type: 'string', description: 'Counterparty involved (GC, another sub, factory, inspector), e.g. "Monadnock", ONLY if mentioned' },
            fault:    { type: 'string', description: 'Attribution of responsibility, ONLY if the user states a cause: e.g. "factory fab error", "GC opening out of tolerance", "drawing error"' }
          },
          required: ['date', 'category', 'content']
        }
      }
    },
    required: ['summary', 'unit_updates', 'log_entries']
  }
};

function buildSystemPrompt(state, today, projectName) {
  const units = (state && state.units) || [];
  const logs  = (state && state.log)   || [];
  const unitLines = units.map(u =>
    `${u.key}\t${u.id}\t${u.zone || '-'}\t${u.status || 'pending'}${u.date ? ' ('+u.date+')' : ''}${u.louver === 'yes' ? ' [louver]' : ''}${u.note ? ' · note: '+u.note : ''}`
  ).join('\n');
  // Include FULL log so Q&A can quote it. Sorted oldest→newest for natural reading.
  const sortedLogs = logs.slice().sort((a, b) => (a.date || '').localeCompare(b.date || ''));
  const logLines = sortedLogs.map(l => {
    const cats = Array.isArray(l.categories) ? l.categories.join(',') : (l.category || '-');
    return `${l.date || '?'}\t[${cats}]${l.planned ? ' (planned)' : ''}\t${l.content || ''}`;
  }).join('\n');

  return `You are the install-progress assistant for the ${projectName} construction site. Users either DESCRIBE site activity (in which case parse it into apply_changes) or ASK questions about existing data (in which case use answer_question). Users write in English, Chinese, or Korean.

Today's date: ${today}

## Data model
- Each unit has a unique "key" (e.g. SF11A__1) and a display "id" (e.g. SF11A, SF11A.1). Multiple keys can share the same id — you MUST update by key.
- status: installed / pending / issue
- louver: yes / no (whether the louver has been installed)
- Log categories: framing / louver / caulking / issue / glass / other, plus three EVIDENCE categories:
  - fit-issue: a dimensional conflict / something does not fit (record WHY it doesn't fit if stated)
  - field-verify: a proactive verification record — user measured/checked something and confirms it is OK / within tolerance. These matter precisely BECAUSE nothing is wrong: they are future proof of due diligence.
  - gc-inquiry: a written notice / question / inquiry sent to the GC or another party (paper trail)

## Current units (key / id / zone / status / louver / note)
${unitLines}

## Daily log entries (date / categories / content)
${logLines || '(none)'}

## How to decide which tool to call
- If the user is asking ABOUT the data ("what / which / when / how many / who / list / show / 哪些 / 什么时候 / 多少 / 어떤 / 언제 / 몇 개", or any question mark) → use answer_question. Answer using the units + log above. Quote log content verbatim when relevant (e.g. if user asks "which louvers go to site Tuesday", look for log entries on Tuesday's date with category 'louver' and quote their content). If the data doesn't contain the answer, say so plainly.
- If the user is REPORTING a site change ("installed X today", "X has issue", "added louver", etc.) → use apply_changes.
- When in doubt and the message is a question, prefer answer_question.

## Parsing rules (for apply_changes only)
1. "Installed X today" → find the pending key matching X, set status=installed, date=today, note="Framing ${today.slice(5)}".
2. "Added louver to X" → set that key louver=yes, append "Louver" to note.
3. "X has an issue" / "opening error on X" → set status=issue.
4. If a mentioned id maps to multiple keys (e.g. SF20A has 6 keys) AND context cannot disambiguate → leave unit_updates empty, set needs_clarification asking which ones (list candidate keys + their current status).
5. "Planning X tomorrow" → add a planned:true log_entry with that future date, DO NOT modify any unit.
6. Whenever unit_updates is non-empty, also add a matching log_entry. date = change date. content = affected ids joined with " · ".
7. If you cannot parse the message at all, set needs_clarification to a short question and leave unit_updates and log_entries as empty arrays.
7b. EVIDENCE extraction: when a message involves responsibility, verification, or correspondence, fill the evidence fields on the log entry — party (who else is involved), fault (stated cause/attribution), ref (RFI/email/submittal number). Examples:
   - "SF07W夹芯板卡不上，洞口比图纸小20mm，是Monadnock结构超差" → category=fit-issue, party="Monadnock", fault="GC opening out of tolerance (-20mm vs drawing)", plus unit_update status=issue.
   - "今天实测SF03门洞R.O. 2140x915，在公差内，GC代表在场确认" → category=field-verify, party="GC (on site)", content includes the measured values. Record it even though nothing is wrong — that is the point.
   - "给Monadnock发邮件问SF12钢结构进度，编号RFI-031" → category=gc-inquiry, party="Monadnock", ref="RFI-031", no unit_updates.
8. summary, needs_clarification, and answer must be in the SAME language the user used.
9. Reply ONLY via one of the two tools — no plain text.`;
}

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(200).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not set in Vercel env vars' });
  }

  let body = req.body;
  if (typeof body === 'string') {
    try { body = JSON.parse(body); } catch (e) { return res.status(400).json({ error: 'Invalid JSON' }); }
  }
  const { message, state, today, project } = body || {};
  if (!message || typeof message !== 'string') {
    return res.status(400).json({ error: 'message required' });
  }
  const todayStr = today || new Date().toISOString().slice(0, 10);

  try {
    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 2048,
        system: buildSystemPrompt(state, todayStr, project || 'this project'),
        tools: [APPLY_CHANGES_TOOL, ANSWER_QUESTION_TOOL],
        // 'any' lets Claude pick between updating data and answering a question.
        tool_choice: { type: 'any' },
        messages: [{ role: 'user', content: message }],
      }),
    });

    if (!r.ok) {
      const text = await r.text();
      console.error('Anthropic API error:', r.status, text);
      return res.status(502).json({ error: `Claude API ${r.status}: ${text.slice(0, 500)}` });
    }

    const data = await r.json();
    const toolUse = (data.content || []).find(b => b.type === 'tool_use' &&
      (b.name === 'apply_changes' || b.name === 'answer_question'));
    if (!toolUse) {
      return res.status(502).json({ error: 'Claude did not return a tool_use block', raw: data });
    }
    const parsed = toolUse.input || {};
    if (toolUse.name === 'answer_question') {
      // Q&A path — no updates, just a textual answer.
      return res.status(200).json({
        answer: parsed.answer || '',
        summary: '',
        needs_clarification: '',
        unit_updates: [],
        log_entries: [],
        _model: MODEL,
        _tool: 'answer_question',
        _usage: data.usage || null,
      });
    }
    return res.status(200).json({
      answer: '',
      summary: parsed.summary || '',
      needs_clarification: parsed.needs_clarification || '',
      unit_updates: Array.isArray(parsed.unit_updates) ? parsed.unit_updates : [],
      log_entries:  Array.isArray(parsed.log_entries)  ? parsed.log_entries  : [],
      _model: MODEL,
      _tool: 'apply_changes',
      _usage: data.usage || null,
    });
  } catch (e) {
    console.error('parse.js error:', e);
    return res.status(500).json({ error: String(e.message || e) });
  }
}
