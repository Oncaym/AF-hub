/* The round button: click opens the panel, drag moves it, right-click opens the menu. */
const b = document.getElementById('b'), n = document.getElementById('n');
let down = false;
b.addEventListener('mousedown', e => { if (e.button !== 0) return; down = true; window.bubble.down(e.screenX, e.screenY); });
window.addEventListener('mousemove', e => { if (down) window.bubble.move(e.screenX, e.screenY); });
window.addEventListener('mouseup', e => { if (!down) return; down = false; window.bubble.up(e.screenX, e.screenY); });
b.addEventListener('contextmenu', e => { e.preventDefault(); window.bubble.menu(); });
window.bubble.onBadge(c => { n.textContent = c > 99 ? '99+' : String(c); n.style.display = c > 0 ? 'block' : 'none'; });
