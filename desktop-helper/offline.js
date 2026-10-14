const q = new URLSearchParams(location.search);
document.getElementById('why').textContent = q.get('why') || '';
document.getElementById('again').onclick = () => { if (q.get('url')) location.href = q.get('url'); };
