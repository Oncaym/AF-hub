#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Scheduled reporter, step 1 of 2 — runs with NO secrets in its environment.

   The browser reporter builds the per-scope breakdown (and the headline pct)
   from three inputs: cloud /state, the tracker's project-config.js and its
   elevations.js. report.js reads /state itself. This script fetches the other
   two from each tracker's live deployment — the very files a browser runs —
   and saves them as plain JSON in report/.trackers/ for report.js to read.

   It evaluates another deployment's JavaScript, so it is deliberately a
   separate step with no service-account keys in the environment (Node's vm
   is not a security boundary). report.js only ever reads JSON.

   Which files to load is read off the tracker's own index.html, in document
   order, exactly as a browser would: a tracker with no elevations.js
   (Lexington) gets none, and a tracker that lists one but fails to serve it
   is reported as failed — never reported without its glass.
   ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const PROJECTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'projects.json'), 'utf8'));
const OUT = process.env.TRACKER_CONFIG_DIR || path.join(__dirname, '.trackers');
const WANT = /(?:^|\/)(project-config|elevations)\.js$/i;

async function get(url) {
  const r = await fetch(url, { signal: AbortSignal.timeout(20000), headers: { 'cache-control': 'no-cache' } });
  if (!r.ok) throw new Error(`${url} → HTTP ${r.status}`);
  return r.text();
}

/* Same-origin <script src> that the page actually loads, in order. Commented-out
   tags are dropped first — a browser ignores them, so must we. */
function scriptsOf(html, base) {
  const origin = new URL(base).origin;
  const live = html.replace(/<!--[\s\S]*?-->/g, '');
  const re = /<script\b[^>]*\bsrc\s*=\s*["']([^"']+)["']/gi;
  const out = [];
  let m;
  while ((m = re.exec(live))) {
    let u;
    try { u = new URL(m[1], base); } catch (e) { continue; }
    if (u.origin === origin && WANT.test(u.pathname) && !out.includes(u.href)) out.push(u.href);
  }
  return out;
}

/* Run the files the way a browser does: one global, `window` IS that global, so
   `var X`, `window.X = …` and a bare `X = …` all land in the same place. */
function evaluate(sources) {
  const g = { console: { log() {}, info() {}, debug() {}, warn() {}, error() {} } };
  vm.createContext(g);
  g.window = g.self = g;
  for (const s of sources) vm.runInContext(s.code, g, { filename: s.url, timeout: 5000 });
  /* hub-report.js reads PROJECT off window, and ELEVATIONS as a bare identifier
     first (it may be a top-level const), then off window. Mirror both. */
  const lexElev = vm.runInContext('typeof ELEVATIONS !== "undefined" ? ELEVATIONS : undefined', g);
  return { PROJECT: g.PROJECT, ELEVATIONS: lexElev || g.ELEVATIONS || {} };
}

/* Plain JSON for report.js. A RegExp becomes its source: the rules only ever
   rebuild patterns with new RegExp(p, 'i'), which discards the original flags,
   so source alone is exactly what the browser ends up matching with.
   Not `instanceof RegExp`: these were built inside the vm context, whose RegExp
   is a different constructor, so instanceof is false and the pattern would
   silently serialise as {} — which new RegExp() then turns into /[object Object]/,
   a character class that matches almost any unit id. */
const isRe = x => Object.prototype.toString.call(x) === '[object RegExp]';
const toJSON = v => JSON.stringify(v, (k, x) => (isRe(x) ? x.source : x));

(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  for (const f of fs.readdirSync(OUT)) if (f.endsWith('.json')) fs.unlinkSync(path.join(OUT, f));

  for (const cfg of PROJECTS) {
    try {
      if (!cfg.url) throw new Error('no url in projects.json');
      const base = cfg.url.replace(/\/+$/, '') + '/';
      const files = scriptsOf(await get(base), base);
      if (!files.some(f => /project-config\.js$/i.test(new URL(f).pathname)))
        throw new Error('index.html loads no project-config.js');

      const sources = [];
      for (const url of files) sources.push({ url, code: await get(url) });
      const { PROJECT, ELEVATIONS } = evaluate(sources);

      if (!PROJECT || typeof PROJECT !== 'object') throw new Error('project-config.js defined no window.PROJECT');
      if (PROJECT.hubId !== cfg.id)
        throw new Error(`${cfg.url} reports as hubId "${PROJECT.hubId}", not "${cfg.id}" — wrong url?`);

      fs.writeFileSync(path.join(OUT, cfg.id + '.json'),
        toJSON({ id: cfg.id, url: cfg.url, files, fetchedAt: new Date().toISOString(), PROJECT, ELEVATIONS }));
      console.log(`${cfg.id}: ${files.map(f => new URL(f).pathname).join(' + ')}`
        + ` — ${Object.keys(ELEVATIONS).length} elevations`);
    } catch (e) {
      // No file written: report.js counts this project as failed and leaves its
      // last report alone, so the hub's freshness stamp ages honestly.
      console.error(`${cfg.id}: FAILED — ${e.message}`);
    }
  }
})().catch(e => { console.error(e); process.exit(1); });
