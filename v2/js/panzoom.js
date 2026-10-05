/* Drag to pan, wheel or pinch to zoom, double-tap to zoom in. Small on purpose.
   Transforms one child (`content`) inside a clipped `viewport`. */
export function panzoom(viewport, content, { max = 8 } = {}) {
  let s = 1, x = 0, y = 0, fit = 1;
  /* "Fit" = the whole drawing visible; that is also the furthest you can zoom out. */
  const computeFit = () => {
    const w = viewport.clientWidth, h = viewport.clientHeight, cw = content.offsetWidth, ch = content.offsetHeight;
    fit = (cw && ch) ? Math.min(w / cw, h / ch) : 1;
  };
  const pts = new Map();
  let last = null, pinch = null, moved = false, lastTap = 0;

  const apply = () => { content.style.transform = `translate(${x}px, ${y}px) scale(${s})`; };
  const clamp = () => {
    const w = viewport.clientWidth, h = viewport.clientHeight;
    const cw = content.offsetWidth * s, ch = content.offsetHeight * s;
    x = Math.min(0, Math.max(w - cw, x)); if (cw < w) x = (w - cw) / 2;
    y = Math.min(0, Math.max(h - ch, y)); if (ch < h) y = (h - ch) / 2;
  };
  const zoomAt = (cx, cy, ns) => {
    ns = Math.max(fit, Math.min(max * fit, ns));
    const r = viewport.getBoundingClientRect();
    const px = cx - r.left, py = cy - r.top;
    x = px - (px - x) * (ns / s); y = py - (py - y) * (ns / s); s = ns;
    clamp(); apply();
  };

  viewport.addEventListener('wheel', e => { e.preventDefault(); zoomAt(e.clientX, e.clientY, s * Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  viewport.addEventListener('pointerdown', e => {
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    moved = false; last = { x: e.clientX, y: e.clientY };
    if (pts.size === 2) {
      const [a, b] = [...pts.values()];
      pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), s };
    }
  });
  viewport.addEventListener('pointermove', e => {
    if (!pts.has(e.pointerId)) return;
    pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pts.size === 2 && pinch) {
      const [a, b] = [...pts.values()];
      zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, pinch.s * Math.hypot(a.x - b.x, a.y - b.y) / pinch.d);
      moved = true; return;
    }
    if (pts.size === 1 && last) {
      const dx = e.clientX - last.x, dy = e.clientY - last.y;
      if (Math.abs(dx) + Math.abs(dy) > 3) moved = true;
      if (moved) { x += dx; y += dy; clamp(); apply(); }
      last = { x: e.clientX, y: e.clientY };
    }
  });
  const end = e => {
    pts.delete(e.pointerId);
    if (pts.size < 2) pinch = null;
    if (!pts.size) last = null;
  };
  viewport.addEventListener('pointerup', e => {
    end(e);
    const now = Date.now();
    if (!moved && now - lastTap < 300) zoomAt(e.clientX, e.clientY, s * 2);
    lastTap = now;
  });
  viewport.addEventListener('pointercancel', end);
  viewport.addEventListener('pointerleave', end);
  // a drag must not count as a click on the shape it started on
  viewport.addEventListener('click', e => { if (moved) { e.stopPropagation(); e.preventDefault(); } }, true);

  const api = {
    reset() { computeFit(); s = fit; x = 0; y = 0; clamp(); apply(); },
    zoom(f) { const r = viewport.getBoundingClientRect(); zoomAt(r.left + r.width / 2, r.top + r.height / 2, s * f); },
    get scale() { return s; }
  };
  api.reset();
  window.addEventListener('resize', () => api.reset());
  return api;
}
