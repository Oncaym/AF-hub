/* Design Board — 🔍 Check DXF, in a worker so the page never freezes.
   Runs design/review.py (the same file the team can double-click as run_review.bat)
   in Python-in-the-browser (Pyodide). The DXF files never leave this computer.

   in:  { files: [{ name, bytes: ArrayBuffer }] }
   out: { status: '…' } while working, then { text } or { error } */
const PYODIDE = 'https://cdn.jsdelivr.net/pyodide/v0.26.4/full/';
let ready = null;

function boot() {
  if (ready) return ready;
  ready = (async () => {
    postMessage({ status: 'Loading the checker (first time only, about 20 seconds)…' });
    importScripts(PYODIDE + 'pyodide.js');
    const py = await loadPyodide({ indexURL: PYODIDE });
    await py.loadPackage(['micropip', 'numpy', 'fonttools', 'pyparsing', 'typing-extensions']);
    await py.pyimport('micropip').install('ezdxf==1.4.5');
    const src = await (await fetch('review.py', { cache: 'no-cache' })).text();
    py.FS.mkdirTree('/check');
    py.FS.writeFile('/check/review.py', src);
    py.runPython("import sys\nif '/check' not in sys.path: sys.path.insert(0, '/check')\nimport review");
    return py;
  })();
  ready.catch(() => { ready = null; });   // a failed load (offline) can be retried
  return ready;
}

onmessage = async (ev) => {
  const files = (ev.data && ev.data.files) || [];
  try {
    const py = await boot();
    postMessage({ status: `Checking ${files.length} file${files.length === 1 ? '' : 's'}…` });
    // A fresh folder each run: the file names are the person's own, kept for the report.
    py.runPython("import shutil, os\nshutil.rmtree('/check/in', ignore_errors=True)\nos.makedirs('/check/in')");
    const paths = files.map((f, i) => {
      const safe = String(f.name || ('sheet' + i + '.dxf')).replace(/[\\/]/g, '_');
      const p = '/check/in/' + safe;
      py.FS.writeFile(p, new Uint8Array(f.bytes));
      return p;
    });
    py.globals.set('_paths', py.toPy(paths));
    const text = py.runPython('review.run(list(_paths))');
    postMessage({ text: String(text) });
  } catch (e) {
    postMessage({ error: String((e && e.message) || e).split('\n').slice(-3).join(' ') });
  }
};
