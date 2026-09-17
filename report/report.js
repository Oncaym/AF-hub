#!/usr/bin/env node
/* ─────────────────────────────────────────────────────────────────────────
   Scheduled reporter — server side, no browser needed.

   hub-report.js only runs while somebody has a tracker open and signed in.
   That is fine for freshness during the working day, but it means the
   overview goes stale the moment nobody opens a project — and the one person
   who must never see a stale number is the one who opens the hub cold.

   This reads each tracker's /state straight from its own Firebase with a
   service account, computes the identical summary, and writes it to the hub.
   Runs from .github/workflows/report.yml.

   The summary maths is deliberately a mirror of hub-report.js. If you change
   one, change the other — there is a check for that at the bottom of the
   workflow file.
   ───────────────────────────────────────────────────────────────────────── */

const fs = require('fs');
const path = require('path');
const admin = require('firebase-admin');

const DAY = 864e5;
const PROJECTS = JSON.parse(fs.readFileSync(path.join(__dirname, 'projects.json'), 'utf8'));

function parseSA(raw, label) {
  if (!raw || !raw.trim()) throw new Error(`missing service account for ${label}`);
  try { return JSON.parse(raw); }
  catch (e) { throw new Error(`service account for ${label} is not valid JSON`); }
}

function isDone(u) { return u && u.status === 'installed'; }

function daysAgo(d) {
  if (!d) return null;
  const t = Date.parse(d);
  return isNaN(t) ? null : (Date.now() - t) / DAY;
}

function summarize(state, cfg) {
  const units = (state && state.units) || [];
  let done = 0, thisWeek = 0, lastWeek = 0, fourWeeks = 0;

  for (const u of units) {
    if (!isDone(u)) continue;
    done++;
    const d = daysAgo(u.date);
    if (d === null || d < 0) continue;
    if (d < 7) thisWeek++;
    if (d >= 7 && d < 14) lastWeek++;
    if (d < 28) fourWeeks++;
  }

  const dmg = (state && state.damage) || [];

  return {
    name:  cfg.name,
    unit:  cfg.unit || 'openings',
    scope: cfg.scope || '',
    url:   cfg.url || '',
    done,
    total: units.length,
    weekRate: thisWeek,
    prevWeekRate: lastWeek,
    avg4w: Math.round(fourWeeks / 4),
    openDamage: dmg.filter(x => x && !x.closed).length,
    pendingCO:  dmg.filter(x => x && x.co === 'pending').length,
    ts: Date.now()
  };
}

(async () => {
  const hub = admin.initializeApp({
    credential: admin.credential.cert(parseSA(process.env.HUB_SERVICE_ACCOUNT, 'hub')),
    databaseURL: process.env.HUB_DATABASE_URL
  }, 'hub');

  let failures = 0;

  for (const cfg of PROJECTS) {
    let app = null;
    try {
      app = admin.initializeApp({
        credential: admin.credential.cert(parseSA(process.env[cfg.secret], cfg.id)),
        databaseURL: cfg.databaseURL
      }, cfg.id);

      const snap = await app.database().ref('state').once('value');
      const state = snap.val();

      if (!state || !Array.isArray(state.units) || !state.units.length) {
        console.log(`${cfg.id}: no units in /state — skipped, leaving the last report in place`);
        continue;
      }

      const s = summarize(state, cfg);

      /* The tracker's own hub-report.js reports its real location.origin. This job
         only knows what is in projects.json, so when that url is blank we must keep
         whatever is already on the hub — otherwise every run would wipe a good link
         two hours after the browser supplied it. */
      if (!s.url) {
        const prev = await hub.database().ref(`projects/${cfg.id}/summary/url`).once('value');
        if (prev.val()) s.url = prev.val();
      }

      /* Same reasoning for the per-scope breakdown, for a different reason: it is
         computed from isDoor() / isInterior() / doorTypeOf(), which live in the
         tracker's app.js and only exist in a browser. Duplicating them here would
         mean two copies of the classification rules drifting apart — exactly what
         the four-numbers contract exists to avoid. So this job never produces a
         breakdown and never destroys one: the browser reporter owns that field. */
      const prevBd = await hub.database().ref(`projects/${cfg.id}/summary/breakdown`).once('value');
      if (prevBd.val()) s.breakdown = prevBd.val();

      await hub.database().ref(`projects/${cfg.id}/summary`).set(s);
      console.log(`${cfg.id}: ${s.done}/${s.total} installed, ${s.weekRate} this week`);
    } catch (e) {
      failures++;
      console.error(`${cfg.id}: FAILED — ${e.message}`);
    } finally {
      if (app) await app.delete().catch(() => {});
    }
  }

  await hub.delete().catch(() => {});

  // A partial run still leaves the hub better off than it was, so only fail the
  // job when every project errored — that is the signal worth waking up to.
  if (failures === PROJECTS.length) {
    console.error('every project failed');
    process.exit(1);
  }
  process.exit(0);
})().catch(e => { console.error(e); process.exit(1); });
