/* ============================================================================
   themes.js — the tracker's look-and-feel registry
   ----------------------------------------------------------------------------
   NOT a core file. app.js / app-log.js / cloud-sync.js stay byte-identical with
   the CP2 / AC3 trackers; this is one of this project's own files.

   ADDING A THEME IS DATA, NOT CODE. Append one entry to THEMES below:

     { key:'blueprint',
       name:{ en:'Blueprint', zh:'蓝图', ko:'청사진' },
       icon:'📐',
       mode:'light',                 // 'light' adds body.day-mode, so core's
                                     // isDayMode() picks the right plan twin
       vars:{ '--bg':'#1B3A5C', … },  // any CSS custom property
       css:'…' }                      // optional extra CSS, active only while
                                      // this theme is on

   The picker in the header builds itself from the list, and everything that
   depends on colour — the plan overlay, the charts, the plan image twin — is
   re-derived on every switch. Nothing else has to be touched.

   HOW IT AVOIDS FIGHTING THE STYLESHEET
   index.html declares its palette twice: `:root` (night) and `body.day-mode`
   (day). A third stylesheet block would have to win a specificity argument with
   those, so instead a theme's `vars` are written as INLINE custom properties on
   <body>, which beat any rule. Switching themes clears every property any theme
   might have set (VAR_NAMES) before applying the new one, so themes can never
   leak into each other.
   ========================================================================== */
(function () {
  'use strict';

  /* Base palette values, so a theme can leave a slot alone and still be listed
     here for the clearing pass. Night = whatever index.html's :root says. */
  var THEMES = [
    {
      key: 'night',
      name: { en: 'Night', zh: '夜间', ko: '야간' },
      icon: '🌙',
      hint: 'Night — the original dark dashboard',
      mode: 'dark',
      vars: {},                 // index.html's :root is already this theme
      css: ''
    },
    {
      key: 'day',
      name: { en: 'Day', zh: '日间', ko: '주간' },
      icon: '☀️',
      hint: 'Day — light, and what prints',
      mode: 'light',
      vars: {},                 // index.html's body.day-mode block is this theme
      css: ''
    },
    /* ------------------------------------------------------------------------
       SIGNALS ROOM — a wartime clandestine radio/telegraph room.
       Blackout-dark bakelite panels, amber dial phosphor, aged brass rules,
       teleprinter type. Progress reads as a live signal (amber), dividers as
       verdigris copper, trouble as signal red. Deliberately no insignia or
       military iconography of any kind — the reference is the equipment and
       the paperwork, not an army.
       ---------------------------------------------------------------------- */
    {
      key: 'signals',
      name: { en: 'Signals Room', zh: '报房', ko: '통신실' },
      icon: '📻',
      hint: 'Signals Room — wartime radio desk: amber dials, brass, teleprinter type',
      mode: 'dark',
      vars: {
        '--bg': '#0A0906',            // blackout curtain
        '--panel': '#13110C',         // bakelite
        '--panel-2': '#1C1810',
        '--border': '#3E3527',        // aged brass
        '--text': '#E9DEC3',          // lamp-lit paper
        '--text-dim': '#9A8A6B',
        '--accent': '#E0A03C',        // dial phosphor
        '--accent-2': '#F5C267',
        '--green': '#8FB33B',         // radium dial paint
        '--yellow': '#D9A233',
        '--red': '#C4462C',           // signal red
        '--purple': '#6E9A8D',        // verdigris
        '--orange': '#D9752F',
        '--caulk-ring': '#D9A233',
        '--fc-ring': '#6E9A8D',
        '--int-sf': '#8FB33B',
        '--fire-door': '#D9752F',
        '--follow-op': '#6E9A8D',
        /* The railing overlay reads these (see lf.js). Guardrail is the live
           signal, dividers the cooler copper, screens the pale paper, so the
           three never blur together at a glance on a dark plan. */
        '--rail-gr': '#E8B04B',
        '--rail-td': '#6E9A8D',
        '--rail-es': '#CBB994',       // telegram paper — the equipment screens
        '--rail-sd': '#7FA8B8',       // signal blue — the shower doors
        '--rail-track': 'rgba(154,138,107,0.42)',
        /* Charts: core's tick/grid helpers are hardcoded per day/night, so
           lf.js prefers these when a theme provides them. */
        '--chart-tick': '#9A8A6B',
        '--chart-grid': 'rgba(154,138,107,0.16)',
        '--theme-color': '#0A0906'
      },
      css: [
        /* ---- teleprinter type ------------------------------------------- */
        'body, .btn, input, select, textarea, button {',
        '  font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas,',
        '    "DejaVu Sans Mono", "Courier New", monospace;',
        '}',
        'body { letter-spacing: .01em; }',
        /* Anything that acts as a label gets stamped uppercase with tracking —
           the single strongest cue that this is a signals log, not a web app. */
        '.kpi-label, .section-title, .tab, .btn, .level-btn, .filter-chip,',
        '.lens-btn, th, .lf-table th, .kpi-detail-table th, .legend-item,',
        '.timeline-date, .modal-tab, .lf-run-name, .lf-box-head {',
        '  text-transform: uppercase; letter-spacing: .09em;',
        '}',
        '.section-title { font-weight: 700; }',
        /* ---- dial faces -------------------------------------------------- */
        '.kpi-value {',
        '  color: var(--accent); font-weight: 700;',
        '  text-shadow: 0 0 14px rgba(224,160,60,.35), 0 0 3px rgba(224,160,60,.5);',
        '  font-variant-numeric: tabular-nums;',
        '}',
        '.kpi-card, .section, .modal, .lf-box {',
        '  border-radius: 2px;',
        '  background-image: linear-gradient(180deg, rgba(233,222,195,.035), transparent 42%);',
        '}',
        '.kpi-card { border-color: var(--border); }',
        /* a hairline of brass under the header, like a bench edge */
        'header { border-bottom: 1px solid var(--border); box-shadow: 0 2px 0 rgba(224,160,60,.12); }',
        /* ---- punched-tape rules ------------------------------------------ */
        '.lf-table td, .kpi-detail-table td, .table-wrap td {',
        '  border-bottom-style: dashed !important;',
        '}',
        '.lf-table th, .kpi-detail-table th { border-bottom: 1px solid var(--border); }',
        /* ---- the daily log reads as a wire message ----------------------- */
        '.timeline-content::after { content: " · STOP"; color: var(--text-dim); }',
        '.timeline-date { color: var(--accent); }',
        /* ---- tape labels ------------------------------------------------- */
        '#lfBuild {',
        '  background: rgba(233,222,195,.07); border: 1px dashed var(--border);',
        '  border-radius: 1px; padding: 1px 6px; opacity: .8;',
        '}',
        '#lfDragHint {',
        '  border-radius: 1px; border-color: var(--accent);',
        '  background: var(--panel); letter-spacing: .06em;',
        '  box-shadow: 0 0 0 1px rgba(224,160,60,.25), 0 10px 30px rgba(0,0,0,.6);',
        '}',
        '#lfDragHint .lf-hint-big { color: var(--accent); text-shadow: 0 0 12px rgba(224,160,60,.4); }',
        /* ---- the plan sits in a brass-framed viewport -------------------- */
        '.plan-viewport { border-radius: 2px; box-shadow: inset 0 0 0 1px rgba(224,160,60,.14); }',
        /* ---- selection + focus in dial amber ----------------------------- */
        '::selection { background: rgba(224,160,60,.3); }',
        'input:focus, select:focus, textarea:focus { outline: 1px solid var(--accent); }',
        /* ---- lamplight and a whisper of scanline ------------------------- */
        /* Very low contrast on purpose: enough to read as equipment, not enough
           to fight the plan linework. pointer-events:none so it never eats a drag. */
        'body::after {',
        '  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 9998;',
        '  background: repeating-linear-gradient(180deg, rgba(0,0,0,.20) 0 1px, transparent 1px 3px);',
        '  opacity: .30;',
        '}',
        /* The lamp glow sits BEHIND the content (z-index -1 on a body::before), not over
           it: as an overlay it washed the header and the sticky banner orange. */
        'body::before {',
        '  content: ""; position: fixed; inset: 0; pointer-events: none; z-index: 0;',
        '  background: radial-gradient(120% 80% at 50% -10%, rgba(224,160,60,.10), transparent 55%);',
        '}',
        'header, main { position: relative; z-index: 1; }',
        /* core's setup banner is a bright orange slab — loud enough to fight the room,
           and it stays up until Firebase is configured. Same message, house colours. */
        '#cs-setup-banner {',
        '  background: linear-gradient(180deg, #1C1810, #13110C) !important;',
        '  color: var(--text) !important; border-bottom: 1px solid var(--accent) !important;',
        '}',
        '#cs-setup-banner b, #cs-setup-banner strong { color: var(--accent) !important; }',
        '#cs-setup-banner code { background: rgba(233,222,195,.08) !important; color: var(--accent-2) !important; }',
        '#cs-setup-banner button { background: var(--panel-2) !important; color: var(--text) !important;',
        '  border: 1px solid var(--border) !important; }',
        /* keep the overlay out of print */
        '@media print { body::after { display: none; } }'
      ].join('\n')
    }
  ];

  /* Every custom property any theme touches. Cleared before each apply so a
     theme that omits a slot falls back to the stylesheet instead of inheriting
     the previous theme's value. */
  var VAR_NAMES = (function () {
    var seen = {};
    THEMES.forEach(function (t) {
      Object.keys(t.vars || {}).forEach(function (k) { seen[k] = 1; });
    });
    return Object.keys(seen);
  })();

  function storeKey() {
    return ((window.PROJECT || {}).code || 'tracker').toLowerCase() + '_theme';
  }
  function def(key) {
    for (var i = 0; i < THEMES.length; i++) if (THEMES[i].key === key) return THEMES[i];
    return null;
  }
  function saved() {
    var v;
    try { v = localStorage.getItem(storeKey()); } catch (e) {}
    return def(v) ? v : 'night';
  }
  function current() {
    var m = /(?:^|\s)theme-([\w-]+)/.exec(document.body.className || '');
    return (m && def(m[1])) ? m[1] : 'night';
  }
  function label(t) {
    var lang = (typeof currentLang !== 'undefined' && currentLang) ? currentLang : 'en';
    return (t.name && (t.name[lang] || t.name.en)) || t.key;
  }

  function styleTag() {
    var el = document.getElementById('theme-extra');
    if (!el) {
      el = document.createElement('style');
      el.id = 'theme-extra';
      document.head.appendChild(el);
    }
    return el;
  }

  function apply(key, opts) {
    var t = def(key) || def('night');
    var body = document.body;
    if (!body) return;

    THEMES.forEach(function (x) { body.classList.remove('theme-' + x.key); });
    body.classList.add('theme-' + t.key);
    // core's isDayMode() — and therefore which plan twin loads, and the chart
    // colours it picks — keys off this one class.
    body.classList.toggle('day-mode', t.mode === 'light');

    VAR_NAMES.forEach(function (n) { body.style.removeProperty(n); });
    Object.keys(t.vars || {}).forEach(function (n) { body.style.setProperty(n, t.vars[n]); });

    styleTag().textContent = t.css || '';

    var meta = document.querySelector('meta[name="theme-color"]');
    if (meta) {
      meta.setAttribute('content',
        (t.vars && t.vars['--theme-color']) || (t.mode === 'light' ? '#f2f4f7' : '#0f1419'));
    }

    try { localStorage.setItem(storeKey(), t.key); } catch (e) {}
    paintPicker();

    if (opts && opts.quiet) return t.key;
    // Everything colour-derived is rebuilt rather than left stale.
    try { if (typeof applyPlanTheme === 'function') applyPlanTheme(); } catch (e) {}
    try { if (typeof renderCharts === 'function') renderCharts(); } catch (e) {}
    try { if (window.LF && LF.renderOverlay) LF.renderOverlay(); } catch (e) {}
    return t.key;
  }

  function cycle() {
    var i = 0;
    for (var n = 0; n < THEMES.length; n++) if (THEMES[n].key === current()) i = n;
    return apply(THEMES[(i + 1) % THEMES.length].key);
  }

  /* The picker builds itself from THEMES, so a new theme needs no markup. */
  function paintPicker() {
    var host = document.getElementById('themePicker');
    if (!host) return;
    var cur = current();
    host.innerHTML = THEMES.map(function (t) {
      return '<button type="button" class="theme-btn' + (t.key === cur ? ' active' : '') + '"' +
        ' data-theme="' + t.key + '" title="' + String(t.hint || label(t)).replace(/"/g, '&quot;') + '"' +
        ' aria-pressed="' + (t.key === cur) + '">' + t.icon + '</button>';
    }).join('');
    Array.prototype.forEach.call(host.querySelectorAll('.theme-btn'), function (b) {
      b.addEventListener('click', function () { apply(b.dataset.theme); });
    });
  }

  window.Theme = {
    list: THEMES, def: def, apply: apply, set: apply, cycle: cycle,
    current: current, label: label, vars: VAR_NAMES
  };
  // The old header button called toggleTheme(); keep it working as a cycle.
  window.toggleTheme = cycle;
  window.applyThemeUI = paintPicker;

  apply(saved(), { quiet: true });     // before first paint; nothing to re-render yet
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', paintPicker);
  } else { paintPicker(); }
})();
