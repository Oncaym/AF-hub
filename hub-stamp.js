/* af-hub — freshness stamps
 *
 * Shows when each project last reported, and dims the card once the number is
 * old enough to be misleading. Self-contained: injects its own CSS, keeps all
 * visible stamps ticking, survives re-renders.
 *
 * Wire-up:
 *   <script src="hub-stamp.js"></script>     before your render code
 *   afHubStamp(cardEl, summary.ts)           once per project card, per render
 *   afHubStamp(headerEl, oldestTs, {label:'oldest data'})   optional, page header
 *
 * Debug:  afHubAge(ts) -> { ms, text, stale }
 */
(function () {
  'use strict';

  var STALE_MS = 4 * 60 * 60 * 1000;   // past this, the number stops being "now"
  var TICK_MS  = 60 * 1000;            // iPad left open all day must not lie
  var MOUNTED  = [];                   // [el, ts, opts]

  function css() {
    if (document.getElementById('af-stamp-css')) return;
    var s = document.createElement('style');
    s.id = 'af-stamp-css';
    s.textContent = [
      '.af-stamp{display:inline-block;font-size:11px;font-weight:500;',
      'line-height:1;letter-spacing:.01em;color:#6b7785;white-space:nowrap;',
      'vertical-align:middle;margin-left:10px}',
      '.af-stamp--stale{color:#d99a2b}',
      '.af-stamp--never{color:#8a6d3b}',
      '.af-card--stale{opacity:.55;transition:opacity .15s ease}',
      '@media (prefers-reduced-motion:reduce){.af-card--stale{transition:none}}'
    ].join('');
    document.head.appendChild(s);
  }

  // Firebase may hand back seconds or milliseconds depending on who wrote it.
  function ms(ts) {
    if (ts == null || ts === '') return 0;
    var n = typeof ts === 'number' ? ts : Date.parse(ts);
    if (!n || isNaN(n)) return 0;
    return n < 1e12 ? n * 1000 : n;
  }

  function relative(age) {
    var m = Math.round(age / 60000);
    if (m < 1)  return 'just now';
    if (m < 60) return m + ' min ago';
    var h = Math.round(m / 60);
    if (h < 24) return h + (h === 1 ? ' hour ago' : ' hours ago');
    var d = Math.round(h / 24);
    return d + (d === 1 ? ' day ago' : ' days ago');
  }

  function age(ts) {
    var t = ms(ts);
    if (!t) return { ms: 0, text: 'never reported', stale: true, never: true };
    var a = Date.now() - t;
    if (a < 0) a = 0;                       // clock skew between site and server
    return { ms: a, text: relative(a), stale: a >= STALE_MS, never: false };
  }

  function paint(entry) {
    var el = entry[0], ts = entry[1], opts = entry[2] || {};
    if (!el || !el.isConnected) return false;

    var a = age(ts);
    var node = el.querySelector(':scope > .af-stamp');
    if (!node) {
      node = document.createElement('time');
      node.className = 'af-stamp';
      el.appendChild(node);
    }

    var label = opts.label || 'updated';
    node.textContent = a.never ? a.text : label + ' ' + a.text;
    node.className = 'af-stamp' +
      (a.never ? ' af-stamp--never' : a.stale ? ' af-stamp--stale' : '');

    if (ms(ts)) {
      var d = new Date(ms(ts));
      node.setAttribute('datetime', d.toISOString());
      node.title = d.toLocaleString();
    } else {
      node.removeAttribute('datetime');
      node.title = 'no summary has ever been written for this project';
    }

    var card = opts.card === null ? null : (opts.card || el.closest('[data-project]') || el);
    if (card && card.classList) card.classList.toggle('af-card--stale', a.stale);
    return true;
  }

  function stamp(el, ts, opts) {
    if (!el) return;
    css();
    for (var i = 0; i < MOUNTED.length; i++) {
      if (MOUNTED[i][0] === el) { MOUNTED[i] = [el, ts, opts]; paint(MOUNTED[i]); return; }
    }
    var entry = [el, ts, opts];
    MOUNTED.push(entry);
    paint(entry);
  }

  setInterval(function () {
    MOUNTED = MOUNTED.filter(paint);        // drops nodes removed by a re-render
  }, TICK_MS);

  // A tab woken from sleep shows an hour-old string until the next tick.
  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) MOUNTED = MOUNTED.filter(paint);
  });

  window.afHubStamp = stamp;
  window.afHubAge = age;
  window.afHubStaleMs = STALE_MS;
})();
