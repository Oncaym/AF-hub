#!/usr/bin/env node
/* ============================================================
   Daily Discord digest for the Design Boards (no AI).
   ------------------------------------------------------------
   Run by .github/workflows/discord-digest.yml (weekday mornings, or by
   hand). For every board listed in DISCORD_CHANNELS it reads the design
   database and posts one short message in that board's channel:
   how many review comments are still to fix (and for whom), waiting for an
   answer, fixed and waiting for the reviewer's check, what changed since
   yesterday, and the oldest open one. Nothing to report → no message.

   env  HUB_SERVICE_ACCOUNT  service account of af-hub-8f188 (reads the design DB)
        DISCORD_BOT_TOKEN    the AF bot (needs "Send Messages" in the channel)
        DISCORD_CHANNELS     {"ac3":"<channel id>", …}  (repo variable)
        DRY_RUN=1            print the messages, post nothing
   ============================================================ */
'use strict';
const DESIGN_DB = 'https://af-hub-8f188-design.firebaseio.com';
const SITE = 'https://af-hub-two.vercel.app';
const DAY = 86400000;

const nameOf = e => { e = String(e || '').trim(); return e ? (e.includes('@') ? e.split('@')[0] : e) : ''; };
const short = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };
function byPerson(list, field) {
  const m = {};
  list.forEach(i => { const k = nameOf(i[field]) || 'no one'; m[k] = (m[k] || 0) + 1; });
  return Object.entries(m).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([k, v]) => `${k} ${v}`).join(' · ');
}

/** The message for one board, or null when there is nothing to say. */
function build(boardId, info, issuesObj, drawingsObj, now) {
  const issues = Object.values(issuesObj || {}).filter(i => i && i.status);
  const dwgNo = k => ((drawingsObj || {})[k] || {}).no || k || '';
  const open = issues.filter(i => i.status === 'open');
  const ask = issues.filter(i => i.status === 'ask');
  const fixed = issues.filter(i => i.status === 'fixed');
  const since = now - DAY;
  const fresh = issues.filter(i => (+i.created || 0) >= since).length;
  const closed = issues.filter(i => i.status === 'closed' && (+i.closedAt || 0) >= since).length;
  const nowFixed = issues.filter(i => i.status === 'fixed' && (+i.fixedAt || 0) >= since).length;
  if (!open.length && !ask.length && !fixed.length && !fresh && !closed) return null;
  const day = new Date(now).toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'America/New_York' });
  const lines = [`**${(info && info.name) || boardId} · review comments** — ${day}`];
  lines.push(`🔴 To fix: **${open.length}**${open.length ? ' — ' + byPerson(open, 'owner') : ''}`);
  if (ask.length) lines.push(`❓ Asked, waiting for an answer: **${ask.length}**`);
  lines.push(`🟡 Fixed, waiting for the reviewer's check: **${fixed.length}**${fixed.length ? ' — ' + byPerson(fixed, 'reviewer') : ''}`);
  lines.push(`Last 24 h: ${fresh} new · ${nowFixed} fixed · ${closed} closed`);
  const oldest = open.concat(ask).sort((a, b) => (+a.created || 0) - (+b.created || 0))[0];
  if (oldest && oldest.created) {
    const days = Math.floor((now - +oldest.created) / DAY);
    lines.push(`Oldest still open: #${oldest.n}${oldest.dwg ? ' ' + dwgNo(oldest.dwg) : ''} "${short(oldest.text, 70)}"${days >= 1 ? ` (${days} day${days > 1 ? 's' : ''})` : ''}`);
  }
  lines.push(`${SITE}/design/#b=${boardId}`);
  return lines.join('\n');
}

async function post(token, channel, content) {
  const r = await fetch(`https://discord.com/api/v10/channels/${channel}/messages`, {
    method: 'POST',
    headers: { Authorization: 'Bot ' + token, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: [] } }),
  });
  if (r.ok) return;
  let code = 0; try { code = (await r.json()).code || 0; } catch (e) {}
  const why = { 50013: 'the bot needs "Send Messages" in this channel', 50001: 'the bot cannot see this channel', 10003: 'unknown channel id' }[code] || (r.status === 401 ? 'bot token is wrong' : '');
  throw new Error(`Discord said ${r.status}${code ? ' / ' + code : ''}${why ? ': ' + why : ''}`);
}

async function main() {
  const dry = !!process.env.DRY_RUN;
  let channels = {};
  try { channels = JSON.parse(process.env.DISCORD_CHANNELS || '{}'); } catch (e) { throw new Error('DISCORD_CHANNELS is not valid JSON'); }
  if (!Object.keys(channels).length) throw new Error('DISCORD_CHANNELS is empty: add the repo variable, e.g. {"ac3":"<channel id>"}');
  if (!dry && !process.env.DISCORD_BOT_TOKEN) throw new Error('DISCORD_BOT_TOKEN secret is missing');
  const admin = require('firebase-admin');
  const raw = process.env.HUB_SERVICE_ACCOUNT;
  if (!raw) throw new Error('HUB_SERVICE_ACCOUNT secret is missing');
  const app = admin.initializeApp({ credential: admin.credential.cert(JSON.parse(raw)), databaseURL: DESIGN_DB }, 'design-digest');
  const db = app.database();
  if ((await db.ref('meta/project').once('value')).val() !== 'design') throw new Error('not the design database');
  const now = Date.now();
  let failed = 0;
  for (const [board, channel] of Object.entries(channels)) {
    const [info, issues, drawings] = await Promise.all(['boardInfo/' + board, 'boards/' + board + '/issues', 'boards/' + board + '/drawings'].map(p => db.ref(p).once('value').then(s => s.val())));
    if (!info) { console.log(`- ${board}: no such board, skipped`); continue; }
    const msg = build(board, info, issues, drawings, now);
    if (!msg) { console.log(`- ${board}: nothing to report`); continue; }
    console.log(`--- ${board} → #${channel}${dry ? ' (dry run, not posted)' : ''}\n${msg}\n`);
    if (dry) continue;
    try { await post(process.env.DISCORD_BOT_TOKEN, channel, msg); console.log(`  posted`); }
    catch (e) { failed++; console.log(`  NOT posted: ${e.message}`); }
  }
  await app.delete();
  if (failed) process.exit(1);
}

module.exports = { build };
if (require.main === module) main().catch(e => { console.error(e.message || e); process.exit(1); });
