/* Leona — the AF Helper on the desktop.
   Poses, timings and one-liners from Leo's desktop-pet (10-14). Here the
   whole window walks along the screen; click her to open the chat, drag
   her anywhere, right-click for options. She shows the to-do count, says
   new things out loud, and draws while the helper is working on a request.
   Only her body (and her speech bubble) catches the mouse; the rest of the
   window lets clicks through to whatever is underneath. */
(function () {
  'use strict';
  const api = window.pet;
  const $ = id => document.getElementById(id);
  const petEl = $('pet'), img = $('petImg'), say = $('say'), badgeEl = $('badge'), tag = $('tag'), doing = $('doing'), dot = $('dot');

  const P = window.POSES || {};
  const BOX = { l: 0.25, t: 0.08, r: 0.75, b: 1 };
  const POSE = {
    idle:   { cls: 'idle',     h: 215 },
    coffee: { cls: 'sipping',  h: 195 },
    sleep:  { cls: 'sleeping', h: 135 },
    wave:   { cls: 'greeting', h: 215 },
    draw:   { cls: 'drafting', h: 225 },
    walk:   { cls: 'walking',  h: 215 },
  };
  const src = k => (P[k] && P[k].src) || ('assets/pose-' + k + '.png');
  const box = k => (P[k] && P[k].box) || BOX;
  const WALK = ['walk', 'walk2'];
  const STATUS = {
    idle:   ['Staring into space…', 'lazy'],
    walk:   ['Patrolling the site…', ''],
    coffee: ['Coffee break…', 'lazy'],
    sleep:  ['Power napping Zzz', 'lazy'],
    wave:   ['Saying hi', ''],
    draw:   ['Crunching curtain wall details…', 'busy'],
    busy:   ['On it — working on your request…', 'busy'],
  };
  // Mostly English, with the occasional Chinese / Korean slip (Leo's list)
  const QUOTES = [
    "Shop drawings are done. Done-ish.",
    "Checked the glass sizes. Thrice.",
    "Coffee first, site walk later.",
    "Curtain wall nodes tonight. Promise.",
    "Chill, the submittal's already out.",
    "The GC changed the openings AGAIN?",
    "This mullion detail is chef's kiss.",
    "RFI #47 still pending. Just saying.",
    "Five more minutes… 让我再眯五分钟",
    "在改了在改了 …it's being revised!",
    "图纸今晚一定出。Tonight. For real.",
    "커피 한 잔만… just one coffee",
    "알겠어요, 알겠다고요~ okay okay, on it",
    "도면 확인했어. Drawing's checked.",
  ];
  const HELLO = ['What do you need?', '要我做什么？', '뭐 도와줄까요?', 'Tell me, I\'ll do it.'];
  const pick = a => a[Math.floor(Math.random() * a.length)];

  let scale = 1, walkOn = true, panelOpen = false, busy = false, badge = 0;
  let state = 'idle', facing = 1, walking = false, frameT = null, frame = 0, timer = null, sayT = null, held = false;

  // preload every frame
  Object.keys(POSE).concat(['walk2']).forEach(k => { const i = new Image(); i.src = src(k); });

  function place() {
    const k = state === 'walk' ? WALK[frame] : state;
    const h = POSE[state].h * scale, b = box(k);
    const flip = petEl.classList.contains('flip-x');
    const cx = (flip ? 1 - (b.l + b.r) / 2 : (b.l + b.r) / 2) - 0.5;   // head-ish centre, from the middle of the picture
    const head = 26 + h * (1 - b.t);                                    // px from the bottom of the window
    say.style.bottom = (head + 8) + 'px';
    say.style.left = 'calc(50% + ' + Math.round(cx * h) + 'px)';
    const right = (flip ? 1 - b.l : b.r) - 0.5;
    badgeEl.style.bottom = (head - 22) + 'px';
    badgeEl.style.left = 'calc(50% + ' + Math.round(right * h - 12) + 'px)';
  }
  function setStatus(k) { const s = STATUS[k] || STATUS.idle; doing.textContent = s[0]; dot.className = 'dot' + (s[1] ? ' ' + s[1] : ''); }
  function stopFrames() { if (frameT) { clearInterval(frameT); frameT = null; } }
  function setPose(name, status) {
    state = name; stopFrames();
    petEl.className = 'pet ' + POSE[name].cls + (held ? ' held' : '');
    petEl.classList.toggle('flip-x', name === 'walk' && facing > 0);   // the walk frames face left
    img.style.height = Math.round(POSE[name].h * scale) + 'px'; img.style.width = 'auto';
    if (name === 'walk') {
      frame = 0; img.src = src(WALK[0]);
      frameT = setInterval(() => { frame = 1 - frame; img.src = src(WALK[frame]); }, 280);
    } else img.src = src(name);
    setStatus(status || name);
    place();
  }
  let said = false;
  function speak(text, ms) {
    said = true; say.textContent = text; place();
    say.classList.add('show');
    clearTimeout(sayT); sayT = setTimeout(() => say.classList.remove('show'), ms || 2600);
  }
  function setBadge(n) {
    const up = n > badge; badge = n;
    badgeEl.textContent = n > 99 ? '99+' : String(n);
    badgeEl.style.display = n > 0 ? 'block' : 'none';
    place();
    if (up && !busy) { wave(); speak(n === 1 ? '1 thing waiting for you.' : n + ' things waiting for you.', 4000); }
  }

  /* ---------- her day ---------- */
  function later(fn, ms) { clearTimeout(timer); timer = setTimeout(fn, ms); }
  function walk(dx, done) {
    if (walking) return;
    walking = true; facing = dx >= 0 ? 1 : -1;
    setPose('walk');
    api.walk(Math.round(dx));
    walk.done = () => { walking = false; stopFrames(); if (done) done(); };
  }
  function cancelWalk() { if (!walking) return; walk.done = null; walking = false; stopFrames(); api.stop(); }
  function next() {
    clearTimeout(timer);
    if (busy) { setPose('draw', 'busy'); return; }
    if (held) return;
    const r = Math.random();
    const canWalk = walkOn && !panelOpen;
    if (r < 0.38 && canWalk) {
      const dx = (Math.random() < 0.5 ? -1 : 1) * (60 + Math.random() * 260) * scale;
      walk(dx, () => { setPose('idle'); later(next, 1200 + Math.random() * 1800); });
    } else if (r < 0.55) { setPose('coffee'); later(next, 4500 + Math.random() * 2000); }
    else if (r < 0.72) { setPose('draw'); later(next, 5500 + Math.random() * 2500); }
    else if (r < 0.88 && !panelOpen) { setPose('sleep'); later(next, 6500 + Math.random() * 3000); }
    else { setPose('idle'); later(next, 3000 + Math.random() * 2500); }
  }
  function wave(ms) {
    clearTimeout(timer);
    cancelWalk();
    setPose('wave');
    later(() => { setPose('idle'); next(); }, ms || 2600);
  }

  /* ---------- mouse: only her body is "solid" ---------- */
  let over = false;
  function inside(el, x, y, pad) { const r = el.getBoundingClientRect(); pad = pad || 0; return r.width > 0 && x >= r.left - pad && x <= r.right + pad && y >= r.top - pad && y <= r.bottom + pad; }
  function onBody(x, y) {
    const r = img.getBoundingClientRect(); if (!r.width) return false;
    const k = state === 'walk' ? WALK[frame] : state, b = box(k);
    const flip = petEl.classList.contains('flip-x');
    const l = flip ? 1 - b.r : b.l, rr = flip ? 1 - b.l : b.r;
    return x >= r.left + l * r.width && x <= r.left + rr * r.width && y >= r.top + b.t * r.height && y <= r.top + b.b * r.height;
  }
  function hover(v) { if (v === over) return; over = v; api.hover(v); tag.classList.toggle('show', v); }
  window.addEventListener('mousemove', e => {
    if (down) { api.move(e.screenX, e.screenY); return; }
    hover(onBody(e.clientX, e.clientY) || (say.classList.contains('show') && inside(say, e.clientX, e.clientY)) || (badge > 0 && inside(badgeEl, e.clientX, e.clientY, 2)));
  });
  document.addEventListener('mouseleave', () => { if (!down) hover(false); });

  let down = null;
  window.addEventListener('mousedown', e => {
    if (!over || e.button !== 0) return;
    down = { x: e.screenX, y: e.screenY, moved: false };
    api.down(e.screenX, e.screenY);
  });
  window.addEventListener('mouseup', e => {
    if (!down) return;
    const moved = Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4;
    down = null; api.up(e.screenX, e.screenY);
    if (held) { held = false; petEl.classList.remove('held'); }
    if (moved) { setPose('idle'); later(next, 2000); return; }
    // a click: open / close the chat
    api.toggle();
  });
  window.addEventListener('mousemove', e => {
    if (down && !held && Math.abs(e.screenX - down.x) + Math.abs(e.screenY - down.y) > 4) {
      held = true; clearTimeout(timer); cancelWalk();
      setPose('idle'); petEl.classList.add('held'); say.classList.remove('show');
    }
  });
  window.addEventListener('contextmenu', e => { e.preventDefault(); if (over) api.menu(); });

  /* ---------- from the app ---------- */
  api.on('walked', () => { if (walk.done) { const d = walk.done; walk.done = null; d(); } });
  api.on('badge', n => setBadge(Number(n) || 0));
  api.on('say', m => { wave(4500); speak(String(m || ''), 6000); });
  api.on('busy', v => {
    busy = !!v;
    if (busy) { clearTimeout(timer); cancelWalk(); setPose('draw', 'busy'); }
    else { setPose('idle'); later(next, 2500); }
  });
  api.on('panel', v => {
    panelOpen = !!v;
    if (busy) return;
    if (panelOpen) { wave(1800); speak(pick(HELLO), 2200); }
    else { wave(); speak(pick(QUOTES)); }
  });
  api.on('settings', s => {
    if (typeof s.scale === 'number') scale = s.scale;
    if (typeof s.walk === 'boolean') walkOn = s.walk;
    setPose(state === 'walk' && !walking ? 'idle' : state);
  });
  api.on('quote', () => { wave(); speak(badge > 0 && Math.random() < 0.35 ? (badge === 1 ? '1 thing waiting for you.' : badge + ' things waiting for you.') : pick(QUOTES)); });

  window.__pet = { get state() { return state; }, get badge() { return badge; }, walk: dx => walk(dx, () => setPose('idle')), next };

  // clock in
  setPose('idle');
  setTimeout(() => { if (!said) speak('Clocking in. Coffee first, obviously.'); later(next, 2400); }, 700);
})();
