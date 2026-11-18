/* ============================================================
   Carbon Skin — the embodied-carbon layer on the AF tracker.
   ------------------------------------------------------------
   Loaded after core/app.js. The tracker underneath is unchanged:
   the same plan, markers, unit records, daily log and charts the
   live projects use. This file adds:
     · KPI cards: carbon booked, against the design baseline, today
     · a 🌱 Carbon lens on the plan: installed units take their
       carbon as colour (one sequential ramp), open units are hollow
     · Tap to Book: in the Carbon lens a marker opens a booking sheet;
       one press marks the unit installed AND books its carbon
     · a Carbon ledger section: per day, per assembly, the elevation
       drawn from the shop-drawing bays, and today's bookings
   Carbon per unit = its area x its own A1–A3 intensity (kgCO2e/m2),
   taken from the assembly's EPD. In this demo the factors are
   representative values, not a published declaration.
   ============================================================ */
(function () {
  'use strict';
  const P = window.PROJECT || {};
  const CU = P.carbonUnits || {};
  const DESIGN = { 'Storefront': 134, 'Door': 172, 'Metal Panel': 104 };      // design baseline, kg/m2
  const EPD = { 'Storefront': 'SF assembly EPD', 'Door': 'entrance door EPD', 'Metal Panel': 'ACM panel EPD' };
  const PARTS = {
    'Storefront': [['Aluminium framing', .46], ['Insulated glass', .38], ['Anchors & hardware', .09], ['Gaskets & seals', .07]],
    'Door': [['Aluminium framing', .41], ['Glass', .27], ['Hardware & closers', .25], ['Seals', .07]],
    'Metal Panel': [['Composite panel', .58], ['Sub-framing', .24], ['Insulation', .13], ['Fixings', .05]],
  };
  const LABEL = { 'Storefront': 'Storefront', 'Door': 'Entrance doors', 'Metal Panel': 'Metal panel' };
  const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const t1 = kg => (kg / 1000).toFixed(1);
  const today = () => new Date().toISOString().slice(0, 10);
  const hash = s => { let x = 2166136261; for (const c of String(s)) { x ^= c.charCodeAt(0); x = Math.imul(x, 16777619); } return x >>> 0; };

  /* ----------------------------------------------- words (EN/中/한) -- */
  const W = {
    en: { booked: 'Carbon booked', units: (n, N) => `${n} of ${N} units booked at the wall`, forecast: 'forecast', vs: 'Against design',
          avoided: 'avoided on what is built', over: 'over on what is built', today: 'Booked today', unit1: 'unit', unitN: 'units',
          hint: 'Filled = installed, coloured by its own carbon. Hollow = still to install. Tap a unit to book it.', light: 'light', heavy: 'heavy',
          toInstall: 'to install', face: 'face', perUnit: 'books with this unit', bookedW: 'booked', intensity: 'Intensity', design: 'Design',
          vsD: 'Vs design', open: 'Open record', undo: 'Undo booking', book: k => `✓ Installed · book ${k} kg`,
          ledger: '🌱 Carbon ledger · booked at the wall, unit by unit', perDay: 'Booked per day · last 30 days', byAsm: 'By assembly',
          bf: 'booked / forecast', own: 'Each unit books its own figure (area × its own intensity), not a project average.',
          elev: 'Elevation · from the shop drawing', tap: 'tap to book', latest: 'Latest bookings', nothing: 'Nothing booked yet',
          audit: 'Every booking is a tracker save: who, when and which unit are kept in the edit history, and the day’s entries show in the Daily Installation Log below.',
          todayW: 'today', st: { installed: 'Installed', issue: 'Issue', 'in-progress': 'Ready', pending: 'To install' } },
    zh: { booked: '已记入碳排', units: (n, N) => `${N} 个单元中 ${n} 个已在现场记入`, forecast: '预计', vs: '对比设计',
          avoided: '已建部分节省', over: '已建部分超出', today: '今日记入', unit1: '个单元', unitN: '个单元',
          hint: '实心 = 已安装，颜色代表它自己的碳排。空心 = 待安装。点单元即可记入。', light: '轻', heavy: '重',
          toInstall: '待安装', face: '立面', perUnit: '安装后记入', bookedW: '已记入', intensity: '强度', design: '设计值',
          vsD: '对比设计', open: '打开记录', undo: '撤销', book: k => `✓ 已安装 · 记入 ${k} kg`,
          ledger: '🌱 碳账本 · 在墙边逐个单元记入', perDay: '每日记入 · 近 30 天', byAsm: '按系统', bf: '已记入 / 预计',
          own: '每个单元记自己的数（面积 × 自己的强度），不是项目平均值。', elev: '立面 · 来自加工图', tap: '点击记入',
          latest: '最近记入', nothing: '还没有记入', audit: '每次记入都是一次 tracker 保存：谁、什么时候、哪个单元都在编辑历史里，当天的记录也会出现在下面的每日安装记录中。',
          todayW: '今天', st: { installed: '已安装', issue: '有问题', 'in-progress': '待装', pending: '待安装' } },
    ko: { booked: '탄소 기록', units: (n, N) => `${N}개 유닛 중 ${n}개 현장 기록`, forecast: '예상', vs: '설계 대비',
          avoided: '시공분 절감', over: '시공분 초과', today: '오늘 기록', unit1: '유닛', unitN: '유닛',
          hint: '채움 = 설치 완료, 색은 그 유닛의 탄소. 빈 원 = 설치 예정. 유닛을 누르면 기록됩니다.', light: '가벼움', heavy: '무거움',
          toInstall: '설치 예정', face: '입면', perUnit: '설치 시 기록', bookedW: '기록됨', intensity: '강도', design: '설계',
          vsD: '설계 대비', open: '기록 열기', undo: '취소', book: k => `✓ 설치 · ${k} kg 기록`,
          ledger: '🌱 탄소 장부 · 현장에서 유닛별로 기록', perDay: '일별 기록 · 최근 30일', byAsm: '시스템별', bf: '기록 / 예상',
          own: '각 유닛은 자기 수치(면적 × 자체 강도)를 기록합니다. 프로젝트 평균이 아닙니다.', elev: '입면 · 제작도면 기준', tap: '눌러서 기록',
          latest: '최근 기록', nothing: '아직 기록 없음', audit: '모든 기록은 트래커 저장입니다. 누가, 언제, 어떤 유닛인지 편집 기록에 남고, 그날 항목은 아래 일일 설치 기록에 표시됩니다.',
          todayW: '오늘', st: { installed: '설치 완료', issue: '문제', 'in-progress': '준비', pending: '설치 예정' } },
  };
  const L = () => W[(typeof currentLang !== 'undefined' && W[currentLang]) ? currentLang : 'en'];

  /* ---------------------------------------------------------- model -- */
  const typeOf = u => (CU[u.id] || {}).type || u.type || 'Storefront';
  const area = u => { const c = CU[u.id]; return c ? c.w * c.h : 0; };
  // as-built intensity: the unit's own, from what was actually delivered (79–102 % of design)
  const inten = u => Math.round((DESIGN[typeOf(u)] || 130) * (0.79 + (hash(u.id) % 24) / 100));
  const kgOf = u => Math.round(area(u) * inten(u));
  const designKgOf = u => Math.round(area(u) * (DESIGN[typeOf(u)] || 130));
  const booked = u => u.status === 'installed';
  let BINS = [0, 0, 0, 0];                        // intensity quintile edges, set from the scope
  function setBins() {
    const v = state.units.filter(u => CU[u.id]).map(inten).sort((a, b) => a - b);
    if (!v.length) return;
    BINS = [1, 2, 3, 4].map(k => v[Math.min(v.length - 1, Math.floor(k * v.length / 5))]);
  }
  const bin = u => { const i = inten(u); let b = 1; BINS.forEach(e => { if (i >= e) b++; }); return Math.min(5, b); };
  function totals() {
    const T = { kg: 0, dkgBooked: 0, forecast: 0, design: 0, n: 0, N: 0, todayKg: 0, todayN: 0, byType: {} };
    state.units.forEach(u => {
      if (!CU[u.id]) return;
      const k = kgOf(u), d = designKgOf(u), ty = typeOf(u);
      const bt = T.byType[ty] = T.byType[ty] || { kg: 0, forecast: 0, n: 0, N: 0, area: 0 };
      T.N++; T.forecast += k; T.design += d; bt.forecast += k; bt.N++;
      if (booked(u)) {
        T.n++; T.kg += k; T.dkgBooked += d; bt.kg += k; bt.n++; bt.area += area(u);
        if (u.date === today()) { T.todayKg += k; T.todayN++; }
      }
    });
    T.vs = T.dkgBooked ? (T.kg / T.dkgBooked - 1) : 0;
    T.avoided = T.dkgBooked - T.kg;
    return T;
  }

  /* ------------------------------------------------------- KPI cards -- */
  function kpis() {
    const grid = document.querySelector('.kpi-grid'); if (!grid || !state) return;
    const T = totals();
    let box = document.getElementById('czKpis');
    if (!box) {
      box = document.createElement('div'); box.id = 'czKpis'; box.style.display = 'contents';
      grid.insertBefore(box, grid.firstChild);
    }
    const down = T.vs <= 0;
    box.innerHTML = `
      <div class="kpi-card cz-card cz-hero clickable" onclick="czScrollLedger()">
        <div class="kpi-label">🌱 ${L().booked} · A1–A3</div>
        <div class="kpi-value">${t1(T.kg)}<small>t CO₂e</small></div>
        <div class="kpi-sub">${L().units(T.n, T.N)} · ${L().forecast} ${t1(T.forecast)} t</div>
        <div class="cz-bar"><i style="width:${(T.kg / T.forecast * 100).toFixed(1)}%"></i></div>
      </div>
      <div class="kpi-card cz-card clickable" onclick="czScrollLedger()">
        <div class="kpi-label">${L().vs}</div>
        <div class="kpi-value"><span class="${down ? 'cz-down' : 'cz-up'}">${down ? '▼' : '▲'} ${Math.abs(T.vs * 100).toFixed(1)}%</span></div>
        <div class="kpi-sub">${t1(Math.abs(T.avoided))} t ${down ? L().avoided : L().over}</div>
      </div>
      <div class="kpi-card cz-card clickable" onclick="czScrollLedger()">
        <div class="kpi-label">${L().today}</div>
        <div class="kpi-value">${fmt(T.todayKg)}<small>kg</small></div>
        <div class="kpi-sub">${T.todayN} ${T.todayN === 1 ? L().unit1 : L().unitN} · ${esc(formatDate(today()))}</div>
      </div>`;
  }
  window.czScrollLedger = () => { const s = document.getElementById('czLedger'); if (s) s.scrollIntoView({ behavior: 'smooth', block: 'start' }); };

  /* ------------------------------------------------- the Carbon lens -- */
  if (typeof _LENSES !== 'undefined' && _LENSES.indexOf('carbon') < 0) _LENSES.unshift('carbon');
  try { _planLens = 'carbon'; } catch (e) {}
  let justBooked = null;
  const _mk = window._lensMarkerClass;
  window._lensMarkerClass = function (u, lens) {
    if (lens !== 'carbon') return _mk(u, lens);
    let c = booked(u) ? ' cz' + bin(u) : ' cz-open';
    if (u.status === 'issue') c += ' cz-issue';
    if (justBooked === u.key) c += ' cz-new';
    return c;
  };
  const _tt = window._lensMarkerTitle;
  window._lensMarkerTitle = function (u, lens) {
    if (lens !== 'carbon') return _tt(u, lens);
    return booked(u) ? `${u.id} · booked ${fmt(kgOf(u))} kgCO₂e · ${inten(u)} kg/m²`
                     : `${u.id} · ${fmt(kgOf(u))} kgCO₂e when installed · tap to book`;
  };
  const _rp = window.renderPlan;
  window.renderPlan = function () {
    _rp.apply(this, arguments);
    const w = document.getElementById('planWrap'); if (w) w.classList.toggle('lens-carbon', _lens() === 'carbon');
  };
  const _bar = window.renderPlanLensBar;
  window.renderPlanLensBar = function () {
    _bar.apply(this, arguments);
    const bar = document.getElementById('planLensBar'); if (!bar || !state) return;
    const tabs = bar.querySelector('.lens-tabs'); if (!tabs) return;
    const on = _lens() === 'carbon';
    const T = totals();
    const b = document.createElement('button');
    b.type = 'button'; b.className = 'lens-btn cz-lens' + (on ? ' active' : '');
    b.setAttribute('onclick', "setPlanLens('carbon')");
    b.innerHTML = `🌱 Carbon <span class="lens-count">${t1(T.kg)} t</span>`;
    tabs.insertBefore(b, tabs.firstChild);
    if (on) {
      tabs.querySelectorAll('.lens-btn:not(.cz-lens)').forEach(x => x.classList.remove('active'));
      const hint = bar.querySelector('.lens-hint');
      if (hint) hint.innerHTML = L().hint +
        `<span class="cz-key">${L().light} <i style="background:var(--cz1)"></i><i style="background:var(--cz2)"></i><i style="background:var(--cz3)"></i><i style="background:var(--cz4)"></i><i style="background:var(--cz5)"></i> ${L().heavy} kg/m²</span>` +
        `<span class="cz-key"><i class="open"></i> ${L().toInstall}</span>`;
    }
  };

  /* --------------------------------------------- Tap to Book (sheet) -- */
  const _open = window.openUnit;
  let bypass = false;
  window.openUnit = function (key) {
    if (!bypass && _lens() === 'carbon' && state && state.units.some(u => u.key === key && CU[u.id])) return sheet(key);
    return _open.apply(this, arguments);
  };
  function sheet(key) {
    const u = state.units.find(x => x.key === key); if (!u) return;
    let ov = document.getElementById('czSheet');
    if (!ov) {
      ov = document.createElement('div'); ov.id = 'czSheet'; ov.className = 'cz-sheet-ov';
      ov.addEventListener('mousedown', e => { if (e.target === ov) closeSheet(); });
      document.body.appendChild(ov);
    }
    const ty = typeOf(u), k = kgOf(u), i = inten(u), d = DESIGN[ty] || 130, dv = (i / d - 1) * 100;
    const st = L().st[u.status] || u.status;
    const parts = (PARTS[ty] || []).map(([n, s]) => `<div class="cz-part"><div>${esc(n)}<div class="cz-bar"><i style="width:${(s * 100).toFixed(0)}%"></i></div></div><em>${fmt(k * s)} kg</em></div>`).join('');
    const isB = booked(u);
    ov.innerHTML = `<div class="cz-sheet" role="dialog" aria-label="Book ${esc(u.id)}">
      <div class="cz-grab"></div>
      <div class="cz-sh-head">
        <div><div class="cz-sh-id">${esc(u.id)}</div><div class="cz-sh-sub">${esc(LABEL[ty] || ty)} · ${esc(u.zone || '')} ${L().face} · ${area(u).toFixed(1)} m²</div></div>
        <span class="cz-pill ${esc(u.status)}">${esc(st)}${isB && u.date ? ' · ' + esc(formatDate(u.date)) : ''}</span>
      </div>
      <div class="cz-big"><b>${isB ? '' : '+'}${fmt(k)}</b><span>kgCO₂e ${isB ? L().bookedW : L().perUnit}</span></div>
      <div class="cz-facts">
        <div><label>${L().intensity}</label><b>${i}</b> <small>kg/m²</small></div>
        <div><label>${L().design}</label><b>${d}</b> <small>kg/m²</small></div>
        <div><label>${L().vsD}</label><b class="${dv <= 0 ? 'cz-down' : 'cz-up'}">${dv <= 0 ? '▼' : '▲'} ${Math.abs(dv).toFixed(0)}%</b></div>
      </div>
      <div class="cz-parts">${parts}</div>
      <div class="cz-src">A1–A3 · ${esc(EPD[ty] || 'assembly EPD')} · demo values${u.status === 'issue' && u.note ? '<br>⚠ ' + esc(u.note) : ''}</div>
      <div class="cz-actions">
        <button type="button" class="btn" onclick="czFull('${esc(u.key)}')">${L().open}</button>
        ${isB ? `<button type="button" class="btn" onclick="czUnbook('${esc(u.key)}')">${L().undo}</button>`
              : `<button type="button" class="btn cz-book" onclick="czBook('${esc(u.key)}')">${L().book(fmt(k))}</button>`}
      </div>
    </div>`;
    ov.classList.add('show');
  }
  function closeSheet() { const ov = document.getElementById('czSheet'); if (ov) ov.classList.remove('show'); }
  window.czCloseSheet = closeSheet;
  document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
  window.czFull = key => { closeSheet(); bypass = true; try { _open(key); } finally { bypass = false; } };
  function setStatus(key, status, date) {
    const u = state.units.find(x => x.key === key); if (!u) return null;
    const old = { id: u.id, status: u.status, date: u.date || '', louver: u.louver, facecap: u.facecap, note: u.note || '',
                  glassPanels: JSON.parse(JSON.stringify(u.glassPanels || [])), scopes: JSON.parse(JSON.stringify(u.scopes || {})) };
    u.status = status; u.date = date;
    u.scopes = Object.assign({}, u.scopes || {}, { frame: { status, date } });
    try { autoLogUnitChanges(u, old); } catch (e) { console.warn(e); }
    return u;
  }
  window.czBook = key => {
    const u = setStatus(key, 'installed', today()); if (!u) return;
    justBooked = key; closeSheet();
    saveState(false, `Carbon Skin · ${u.id} installed, ${fmt(kgOf(u))} kgCO2e booked`);
    toast(`✓ ${u.id} installed · +${fmt(kgOf(u))} kg booked`);
    setTimeout(() => { justBooked = null; }, 3200);
  };
  window.czUnbook = key => {
    const u = setStatus(key, 'pending', ''); if (!u) return;
    closeSheet(); saveState(false, `Carbon Skin · ${u.id} booking undone`);
    toast(`↩ ${u.id} back to "to install"`);
  };

  /* ------------------------------------------------ the ledger section -- */
  let curBay = null;
  function ledger() {
    if (!state) return;
    let sec = document.getElementById('czLedger');
    if (!sec) {
      const plan = document.getElementById('planSection'); if (!plan) return;
      sec = document.createElement('section'); sec.className = 'section'; sec.id = 'czLedger';
      plan.parentNode.insertBefore(sec, plan.nextSibling);
    }
    const T = totals();
    // booked per day, last 30 days
    const days = [], byDay = {};
    state.units.forEach(u => { if (booked(u) && CU[u.id] && u.date) byDay[u.date] = (byDay[u.date] || 0) + kgOf(u); });
    for (let k = 29; k >= 0; k--) { const d = new Date(); d.setDate(d.getDate() - k); days.push(d.toISOString().slice(0, 10)); }
    const max = Math.max(1, ...days.map(d => byDay[d] || 0));
    const bars = days.map(d => { const v = byDay[d] || 0;
      return `<div class="${v ? '' : 'zero'}${d === today() ? ' today' : ''}" style="height:${v ? Math.max(4, v / max * 100) : 2}%" title="${esc(formatDate(d))} · ${fmt(v)} kgCO₂e"></div>`; }).join('');
    const types = Object.keys(T.byType).sort((a, b) => T.byType[b].forecast - T.byType[a].forecast);
    const rows = types.map(ty => { const b = T.byType[ty];
      return `<div class="cz-row"><div>${esc(LABEL[ty] || ty)}<small>${b.n}/${b.N} units · ${DESIGN[ty]} kg/m² design</small></div>
        <div class="cz-bar"><i style="width:${(b.kg / b.forecast * 100).toFixed(1)}%"></i></div><em>${t1(b.kg)} t</em></div>`; }).join('');
    const todays = state.units.filter(u => booked(u) && u.date === today() && CU[u.id]);
    const recent = todays.length ? todays : state.units.filter(u => booked(u) && CU[u.id]).sort((a, b) => (b.date || '').localeCompare(a.date || '')).slice(0, 4);
    const list = recent.map(u => `<li><span>${esc(u.id)} <small style="color:var(--text-dim)">· ${esc(LABEL[typeOf(u)] || '')}${todays.length ? '' : ' · ' + esc(formatDate(u.date))}</small></span><b>+${fmt(kgOf(u))} kg</b></li>`).join('');
    const bays = Object.values(window.ELEV_BAYS || {});
    if (!curBay || !bays.some(b => b.id === curBay)) curBay = bays.length ? bays[0].id : null;
    const pick = bays.map(b => `<button type="button" class="btn${b.id === curBay ? ' btn-primary' : ''}" onclick="czBay('${esc(b.id)}')">${esc(b.name)}</button>`).join('');
    sec.innerHTML = `
      <div class="section-header"><div class="section-title">${L().ledger}</div></div>
      <div class="cz-grid">
        <div class="cz-card"><h4><span>${L().perDay}</span><span>${t1(T.kg)} t</span></h4>
          <div class="cz-days">${bars}</div>
          <div class="cz-axis"><span>${esc(formatDate(days[0]))}</span><span>${L().todayW}</span></div></div>
        <div class="cz-card"><h4><span>${L().byAsm}</span><span>${L().bf}</span></h4>${rows}
          <div class="cz-note">${L().own}</div></div>
      </div>
      <div class="cz-grid" style="margin-top:18px">
        <div class="cz-card cz-elev"><h4><span>${L().elev}</span><span>${L().tap}</span></h4>
          <div class="cz-elev-pick">${pick}</div>${curBay ? elevSvg((window.ELEV_BAYS || {})[curBay]) : '<div class="cz-note">No elevation yet.</div>'}</div>
        <div class="cz-card cz-today"><h4><span>${todays.length ? L().today : L().latest}</span><span>${todays.length ? fmt(T.todayKg) + ' kg' : ''}</span></h4>
          <ul>${list || '<li>' + L().nothing + '</li>'}</ul>
          <div class="cz-note">${L().audit}</div></div>
      </div>`;
  }
  window.czBay = id => { curBay = id; ledger(); };
  function elevSvg(bay) {
    if (!bay) return '';
    const H = bay.h, W = bay.w, n = v => Math.round(v * 100) / 100, Y = (y, h) => n(H - y - (h || 0)), M = 24;
    const color = u => `var(--cz${bin(u)})`;
    let s = '', lbl = '';
    bay.openings.forEach(o => {
      const u = state.units.find(x => String(x.id).toLowerCase() === String(o.unit).toLowerCase());
      const isB = u && booked(u);
      s += `<g class="cz-op" onclick="${u ? `czOpen('${esc(u.key)}')` : ''}"><title>${esc(o.unit)}${u ? ' · ' + fmt(kgOf(u)) + ' kgCO₂e' + (isB ? ' booked' : ' to book') : ''}</title>`;
      (o.lites || []).forEach(l => {
        s += `<rect class="cz-lite${isB ? '' : ' open'}${l.t === 'door' ? ' door' : ''}" x="${n(l.x)}" y="${Y(l.y, l.h)}" width="${n(l.w)}" height="${n(l.h)}"${isB ? ` style="fill:${color(u)}"` : ''}/>`;
      });
      (o.frame || []).forEach(r => { s += `<rect class="cz-frame" x="${n(r[0])}" y="${Y(r[1], r[3])}" width="${n(r[2])}" height="${n(r[3])}"/>`; });
      if (u && u.key === justBooked) s += `<rect class="cz-sel" x="${n(o.x)}" y="${Y(o.y, o.h)}" width="${n(o.w)}" height="${n(o.h)}"/>`;
      s += `</g>`;
      const tx = n(o.tag[0]), ty = Y(o.tag[1]);
      lbl += `<g class="cz-tag"><path d="M${tx},${ty - 10}L${tx + 17},${ty}L${tx},${ty + 10}L${tx - 17},${ty}Z"/><text x="${tx}" y="${ty + 4}">${esc(o.unit)}</text></g>`;
      if (u) lbl += `<text class="cz-kg" x="${n(o.x + o.w / 2)}" y="${Y(o.y) - 8}">${isB ? '' : '+'}${fmt(kgOf(u))} kg</text>`;
    });
    return `<svg viewBox="${-M} ${-M} ${n(W + 2 * M)} ${n(H + 2 * M)}" role="img" aria-label="${esc(bay.name)} elevation, carbon by unit">${s}${lbl}</svg>`;
  }
  window.czOpen = key => { if (_lens() !== 'carbon') { try { setPlanLens('carbon'); } catch (e) {} } sheet(key); };

  /* ------------------------------------------------- unit grid badge -- */
  const _grid = window.renderUnitGrid;
  window.renderUnitGrid = function () {
    _grid.apply(this, arguments);
    if (!state) return;
    document.querySelectorAll('#unitGrid .unit-cell').forEach(el => {
      const m = /openUnit\('([^']+)'\)/.exec(el.getAttribute('onclick') || ''); if (!m) return;
      const u = state.units.find(x => x.key === m[1]); if (!u || !CU[u.id]) return;
      const tag = document.createElement('span'); tag.className = 'cz-kgtag';
      tag.textContent = booked(u) ? fmt(kgOf(u)) + ' kg' : '';
      el.appendChild(tag);
    });
  };

  /* ---------------------------------------------- wiring + first boot -- */
  const _kp = window.renderKPIs;
  window.renderKPIs = function () { _kp.apply(this, arguments); try { setBins(); kpis(); } catch (e) { console.warn('carbon kpis', e); } };
  const _after = window.__afterScopeRender;
  window.__afterScopeRender = function () { if (typeof _after === 'function') { try { _after(); } catch (e) {} } try { ledger(); } catch (e) { console.warn('carbon ledger', e); } };

  // The demo's install history: write each seeded installed unit into the Daily Installation
  // Log the way a tracker save would, once, so the log and the trend chart have the past weeks.
  let seeded = false;
  function seedLog() {
    if (seeded || !state || !Array.isArray(state.units)) return;
    seeded = true;
    if (state.units.some(u => (state.log || []).some(l => l && l.auto && l.kind !== 'floor-move'))) return;
    state.units.forEach(u => { if (u.status === 'installed' || u.status === 'issue') { try { autoLogUnitChanges(u, { id: u.id }); } catch (e) {} } });
    saveState(false, 'Demo history');
  }
  function bar() {
    if (document.getElementById('czDemoBar')) return;
    const b = document.createElement('div'); b.id = 'czDemoBar'; b.className = 'cs-demo-bar';
    b.innerHTML = '<span><b>Carbon Skin</b> · live demo on a fictional project — everything works, nothing is saved.</span>' +
      '<button type="button" onclick="location.reload()">↺ Start over</button>';
    document.body.insertBefore(b, document.body.firstChild);
  }
  // On a phone the plan gets a tall viewport, filled edge to edge, so the units are big enough
  // to tap with a glove; pan sideways for the rest of the floor.
  function phonePlan() {
    if (window.innerWidth > 640) return;
    const vp = document.getElementById('planViewport'), wrap = document.getElementById('planWrap');
    if (!vp || !wrap || typeof planView === 'undefined') return;
    vp.classList.add('cz-tall');
    requestAnimationFrame(() => {
      const k = vp.clientHeight / Math.max(1, wrap.offsetHeight);
      planView.s = Math.max(planView.s, k); planView.tx = 0; planView.ty = 0;
      try { clampPlanPan(); } catch (e) {}
      applyPlanTransform();
    });
  }
  function boot() {
    bar();
    // the demo signs every visitor in: the hub's back link and sign-in form have no job here
    setTimeout(() => { ['hubBtn', 'cs-auth-gate'].forEach(id => { const el = document.getElementById(id); if (el) el.remove(); }); }, 400);
    let tries = 0;
    const iv = setInterval(() => {
      tries++;
      if (typeof state !== 'undefined' && state && Array.isArray(state.units) && state.units.length) {
        clearInterval(iv); seedLog(); try { render(); } catch (e) {}
        setTimeout(phonePlan, 120);
      } else if (tries > 80) clearInterval(iv);
    }, 150);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot); else boot();
})();
