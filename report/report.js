#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Scheduled reporter, step 2 of 2 — server side, no browser needed.

   hub-report.js only runs while somebody has a tracker open and signed in, so
   on its own the overview goes stale the moment nobody opens a project — and
   the one person who must never see a stale number opens the hub cold.

   This reads each tracker's /state straight from its own Firebase with a
   service account and writes the SAME summary the browser would write:

     · the maths is not copied — it is RULES from ../hub-report.js, the file
       every tracker loads, so the two writers cannot drift apart;
     · PROJECT and ELEVATIONS come from fetch-configs.js (step 1), which takes
       them from each tracker's live deployment.

   Why it must be the same payload, not a subset: the hub's headline figure is
   `pct`, computed from the scope breakdown. A job that wrote done/total but
   dropped `pct` made the card fall back to a row count, so the number jumped
   every time the browser and the job took turns — while a fresh `ts` told the
   freshness stamp it was all current.

   So a project this job cannot compute fully (config not fetched, /state
   unreadable) is SKIPPED, its last report untouched: the stamp then ages and
   turns amber on its own, which is the honest outcome.

   It also writes /projects/{id}/week — installs in the last seven days for EVERY
   scope (glass, frame, door, louver, metal panel…), plus how many installed items
   carry no install date. That lives beside the summary, not in it, because only
   this job writes it: the summary must stay byte-identical to what the browser
   sends, and the hub's rules reject any summary field they do not name.

   DRY_RUN=1 computes everything, prints how it compares with what is on the
   hub now, and writes nothing.
   ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');
const RULES = require(path.join(__dirname, '..', 'hub-report.js'));

const DAY = 864e5;
const PROJECTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'projects.json'), 'utf8'));
const CONF_DIR = process.env.TRACKER_CONFIG_DIR || path.join(__dirname, '.trackers');
const DRY = /^(1|true|yes)$/i.test(process.env.DRY_RUN || '');

function parseSA(raw, label) {
  if (!raw || !raw.trim()) throw new Error(`missing service account for ${label}`);
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`service account for ${label} is not valid JSON`); }
}

function loadConfig(id) {
  const f = path.join(CONF_DIR, id + '.json');
  if (!fs.existsSync(f)) throw new Error('tracker config was not fetched (see the "Fetch tracker configs" step)');
  return JSON.parse(fs.readFileSync(f, 'utf8'));
}

/* Units only. The tracker itself repairs nothing else the rules read when it
   applies cloud state (app.js _cloudApplyRemoteState), so repairing more here
   would make this job see data the browser does not — the opposite of the point. */
const arr = x => Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : []);
function normalize(state) {
  state.units = arr(state.units).filter(Boolean);
  return state;
}

function daysAgo(d) {
  if (!d) return null;
  const t = Date.parse(d);
  return isNaN(t) ? null : (Date.now() - t) / DAY;
}

/* Field for field, the payload hub-report.js summarize() sends. Only `url`
   differs in source: the browser reads its own folder (location), this takes the
   folder of the url in projects.json. */
function summarize(state, P, ELEV, url, now) {
  const units = state.units;
  let done = 0, thisWeek = 0, lastWeek = 0, fourWeeks = 0;

  for (const u of units) {
    if (!RULES.isDone(u)) continue;
    done++;
    const d = daysAgo(u.date);
    if (d === null || d < 0) continue;
    if (d < 7) thisWeek++;
    if (d >= 7 && d < 14) lastWeek++;
    if (d < 28) fourWeeks++;
  }

  const bd = RULES.breakdown(state, P, ELEV || {});
  const dmg = state.damage || [];

  return {
    name:  P.displayName || P.name || P.hubId,
    unit:  P.hubUnit  || 'openings',
    scope: P.hubScope || '',
    url:   url || '',
    done,
    total: units.length,
    weekRate: thisWeek,
    prevWeekRate: lastWeek,
    avg4w: fourWeeks / 4,            // unrounded, same as hub-report.js
    openDamage: dmg.filter(x => x && !x.closed).length,
    pendingCO:  dmg.filter(x => x && x.co === 'pending').length,
    breakdown: bd,
    pct: RULES.pct(bd),
    ts: now
  };
}

/* Installs in the last 7 days, per scope, in each scope's own unit. Same rules,
   same scope names as the breakdown — the hub matches the two up by name. */
function weekly(state, P, ELEV, now) {
  const bd = RULES.breakdown(state, P, ELEV || {}, { now });
  return {
    ts: now,
    days: 7,
    scopes: bd.map(b => ({ scope: b.scope, unit: b.unit || '', week: b.week || 0, undated: b.undated || 0 }))
  };
}
const weekLine = w => {
  const on = w.scopes.filter(x => x.week);
  const und = w.scopes.reduce((n, x) => n + x.undated, 0);
  return (on.length ? on.map(x => `${x.scope} ${x.week}${x.unit === 'LF' ? ' LF' : ''}`).join(' · ') : 'nothing')
       + (und ? `  (+${und} installed with no date)` : '');
};

/* Dry run: what is on the hub now (usually the browser's last push) against what
   this run computed. Identical apart from ts means the two writers agree. */
function compare(id, now, next) {
  const ago = now && now.ts ? Math.round((Date.now() - now.ts) / 36e5 * 10) / 10 + ' h ago' : 'never';
  console.log(`\n${id} — hub now: written ${ago}`);
  if (!now) { console.log('  (nothing on the hub yet)'); return; }
  const diffs = [];
  for (const k of ['name', 'unit', 'scope', 'url', 'done', 'total', 'weekRate', 'prevWeekRate',
                   'avg4w', 'openDamage', 'pendingCO', 'pct']) {
    const a = now[k] === undefined ? '—' : now[k], b = next[k] === null || next[k] === undefined ? '—' : next[k];
    if (String(a) !== String(b)) diffs.push(`  ${k.padEnd(13)} ${String(a).padEnd(28)} → ${b}`);
  }
  const bdKey = b => `${b.scope}  ${b.qtyDone}/${b.qtyTotal} ${b.unit}  (${b.done}/${b.total} rows)`;
  const A = arr(now.breakdown).map(bdKey), B = next.breakdown.map(bdKey);
  A.filter(x => !B.includes(x)).forEach(x => diffs.push('  − ' + x));
  B.filter(x => !A.includes(x)).forEach(x => diffs.push('  + ' + x));
  if (!diffs.length) console.log('  MATCH — identical to what is on the hub, apart from ts');
  else { console.log('  differs (hub now → this run):'); diffs.forEach(d => console.log(d)); }
}

(async () => {
  const hub = admin.initializeApp({
    credential: admin.credential.cert(parseSA(process.env.HUB_SERVICE_ACCOUNT, 'hub')),
    databaseURL: process.env.HUB_DATABASE_URL
  }, 'hub');

  if (DRY) console.log('DRY RUN — nothing will be written to the hub');
  const failed = [];

  for (const cfg of PROJECTS) {
    let app = null;
    try {
      const conf = loadConfig(cfg.id);

      app = admin.initializeApp({
        credential: admin.credential.cert(parseSA(process.env[cfg.secret], cfg.id)),
        databaseURL: cfg.databaseURL
      }, cfg.id);

      const snap = await app.database().ref('state').once('value');
      const state = snap.val();
      if (!state || !state.units) {
        console.log(`${cfg.id}: no units in /state — skipped, leaving the last report in place`);
        continue;
      }
      normalize(state);
      if (!state.units.length) {
        console.log(`${cfg.id}: no units in /state — skipped, leaving the last report in place`);
        continue;
      }

      const now = Date.now();
      // The tracker's folder, as the browser reporter sends it (trackers can live
      // under the hub now: https://af-hub-two.vercel.app/ac3/).
      const s = summarize(state, conf.PROJECT, conf.ELEVATIONS, cfg.url ? new URL(cfg.url).href.replace(/[^\/]*$/, '') : '', now);
      const wk = weekly(state, conf.PROJECT, conf.ELEVATIONS, now);
      const ref = hub.database().ref(`projects/${cfg.id}/summary`);

      /* projects.json may not know a tracker's address; the browser reporter does.
         Never overwrite a good link with a blank one. */
      if (!s.url || DRY) {
        const prev = (await ref.once('value')).val();
        if (!s.url && prev && prev.url) s.url = prev.url;
        if (DRY) { compare(cfg.id, prev, s); console.log('  this week: ' + weekLine(wk)); continue; }
      }

      await ref.set(s);
      await hub.database().ref(`projects/${cfg.id}/week`).set(wk);
      console.log(`${cfg.id}: ${s.pct ?? Math.round(100 * s.done / s.total)}% · ${s.done}/${s.total} rows · `
        + `${s.breakdown.length} scopes\n      this week: ${weekLine(wk)}`);
    } catch (e) {
      failed.push(cfg.id);
      console.error(`${cfg.id}: FAILED — ${e.message}`);
    } finally {
      if (app) await app.delete().catch(() => {});
    }
  }

  await hub.delete().catch(() => {});

  /* The projects that did succeed have been written either way. Failing the job
     on ANY failure is what makes GitHub email the owner — the freshness stamp is
     the monitor on the screen, the red run is the monitor in the inbox. */
  if (failed.length) {
    console.error(`\n${failed.length} of ${PROJECTS.length} failed: ${failed.join(', ')}`);
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
