/* The projects that ship with v2 (built by tools/build-seed.cjs). */
export const SEEDS = ['lex', 'ac3', 'fh', 'mta7'];
export async function fetchSeed(pid) {
  const r = await fetch(`seed/${pid}.json`, { cache: 'no-cache' });
  if (!r.ok) throw new Error(`seed ${pid}: HTTP ${r.status}`);
  return r.json();
}
export function splitSeed(seed) {
  const { items, ...meta } = seed;
  return { meta, items: items || {} };
}
