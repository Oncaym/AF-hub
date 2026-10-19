#!/usr/bin/env node
/* ============================================================
   Morgan North: Benji's page → the hub's mn/index.html
   ------------------------------------------------------------
   Benji builds and changes the Glass Replacement Tracker himself (his
   Netlify site is his workshop). The hub serves the SAME page; this script
   only adds the hub's plumbing and touches nothing else:

   - removes what Netlify adds when it serves a page (its comment, two meta
     tags, the HUD script);
   - right after the page's firebase-database-compat <script>, adds
       firebase-auth-compat   (hub login)
       ../af-hub-config.js    (the hub's Firebase project)
       hub-adapter.js         (login screen, the af-hub-8f188-mn database,
                               progress on the hub overview)

   It refuses (exit 1, nothing written) when the page no longer looks like
   the tracker (no FIREBASE_CONFIG, no database-compat script, no fbBoot()),
   or when it starts saving something the hub rules do not allow yet (a new
   database path, a new per-pane field): the hub keeps the last good version.

     node mn/build.mjs                       # from his site (platform/projects.json → hosted mn .source)
     node mn/build.mjs page.html             # from a file he sent
     node mn/build.mjs <src> --out x.html    # somewhere else (tests)
   Run by .github/workflows/mn-update.yml.
   ============================================================ */
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(here, '..');
const MARK = '<!-- AF hub (mn/build.mjs)';
// What platform/mn-database.rules.json lets the page write (keep the two in step).
const ALLOWED_NODES = ['units', 'plan', 'toSend'];
const ALLOWED_FIELDS = ['status', 'date', 'crew', 'notes'];
const DB_TAG = /<script\b[^>]*\bsrc="https:\/\/www\.gstatic\.com\/firebasejs\/([0-9.]+)\/firebase-database-compat\.js"[^>]*><\/script>/;

/** html: Benji's page as served or as a file → { html, removed, version }. Throws if it does not look right. */
export function build(src, opts = {}) {
  let html = String(src);
  const removed = [];
  // our own lines from an earlier build (so building a built page is harmless)
  html = html.replace(/\n?<!-- AF hub \(mn\/build\.mjs\)[\s\S]*?<!-- \/AF hub -->/g, () => { removed.push('earlier hub lines'); return ''; });
  // what Netlify injects when it serves the page
  const NETLIFY = [
    /\n?<!--\s*This site is hosted on Netlify[\s\S]*?-->/g,
    /\n?<meta name="hosting-provider"[^>]*>/g,
    /\n?<meta name="netlify-deploy"[^>]*>/g,
    /\n?<script\b[^>]*src="\/\.netlify\/scripts\/[^"]*"[^>]*><\/script>/g,
  ];
  NETLIFY.forEach(re => { html = html.replace(re, m => { removed.push(m.trim().slice(0, 40)); return ''; }); });

  const problems = [];
  const min = opts.minSize != null ? opts.minSize : 20000;   // an error page is small; his page is ~800 KB
  if (html.length < min || html.length > 15 * 1048576) problems.push(`size ${html.length} bytes`);
  if (!/\bFIREBASE_CONFIG\s*=/.test(html)) problems.push('no FIREBASE_CONFIG');
  if (!/function\s+fbBoot\s*\(/.test(html)) problems.push('no fbBoot()');
  if (!/ref\(\s*['"]units['"]\s*\)/.test(html)) problems.push("no ref('units')");
  // The hub database only takes what platform/mn-database.rules.json allows. If his page starts
  // saving somewhere new, stop here: the hub keeps the last version that works until the rules follow.
  const paths = [...new Set([...html.matchAll(/\.ref\(\s*['"]([^'"]+)['"]\s*\)/g)].map(x => x[1].split('/')[0]))]
    .filter(r => r !== '.info' && !ALLOWED_NODES.includes(r));
  if (paths.length) problems.push(`it now saves to ${paths.join(', ')} (the hub rules allow ${ALLOWED_NODES.join(', ')} only)`);
  const sf = html.match(/\bSYNC_FIELDS\s*=\s*\[([^\]]*)\]/);
  const fields = sf ? [...sf[1].matchAll(/['"]([^'"]+)['"]/g)].map(x => x[1]) : [];
  const extra = fields.filter(f => !ALLOWED_FIELDS.includes(f));
  if (extra.length) problems.push(`it now saves ${extra.join(', ')} for each pane (the hub rules allow ${ALLOWED_FIELDS.join(', ')})`);
  const m = html.match(DB_TAG);
  if (!m) problems.push('no firebase-database-compat <script>');
  if (problems.length) throw new Error('this does not look like the Morgan North tracker: ' + problems.join(', '));

  const v = m[1];
  const adapter = opts.adapter != null ? opts.adapter : fs.readFileSync(path.join(here, 'hub-adapter.js'), 'utf8');
  const hash = crypto.createHash('sha1').update(adapter).digest('hex').slice(0, 8);
  const add = `\n${MARK}: hub login + the hub's Morgan North database. Everything else is Benji's page as-is. -->\n`
    + `<script defer src="https://www.gstatic.com/firebasejs/${v}/firebase-auth-compat.js" onerror="window.__fbBlocked=1"></script>\n`
    + `<script defer src="../af-hub-config.js"></script>\n`
    + `<script defer src="hub-adapter.js?v=${hash}"></script>\n`
    + `<!-- /AF hub -->`;
  html = html.replace(DB_TAG, t => t + add);
  return { html, removed, version: v };
}

async function main() {
  const args = process.argv.slice(2);
  const oi = args.indexOf('--out');
  const out = oi >= 0 ? args.splice(oi, 2)[1] : path.join(here, 'index.html');
  let from = args[0];
  if (!from) from = (JSON.parse(fs.readFileSync(path.join(ROOT, 'platform', 'projects.json'), 'utf8')).hosted || []).find(h => h.id === 'mn').source;
  let src;
  if (/^https?:\/\//.test(from)) {
    const r = await fetch(from, { cache: 'no-store', headers: { 'User-Agent': 'af-hub mn/build.mjs' } });
    if (!r.ok) throw new Error(`${from}: HTTP ${r.status}`);
    src = await r.text();
  } else src = fs.readFileSync(from, 'utf8');
  const { html, removed, version } = build(src);
  const before = fs.existsSync(out) ? fs.readFileSync(out, 'utf8') : '';
  if (before === html) { console.log(`mn: unchanged (${html.length} bytes)`); return; }
  fs.writeFileSync(out, html);
  console.log(`mn: wrote ${path.relative(ROOT, out)} (${html.length} bytes, Firebase SDK ${version}; removed: ${removed.join(' | ') || 'nothing'})`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(e => { console.error('mn build: ' + (e.message || e)); process.exit(1); });
}
