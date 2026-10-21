// Overview of the whole pool: counts per domain, type and measure mix, and likely
// duplicates across files (word-overlap similarity of question texts). No dependencies.
// Usage: node questions/report.mjs [--threshold 0.6]
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const ti = process.argv.indexOf('--threshold');
const THRESHOLD = ti > 0 ? Number(process.argv[ti + 1]) : 0.6;

const qs = readdirSync(root)
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(join(root, f), 'utf8').split('\n').filter((l) => l.trim()).map((l) => JSON.parse(l)));

const tally = (key) => qs.reduce((m, q) => ((m[q[key]] = (m[q[key]] ?? 0) + 1), m), {});
const table = (obj) => Object.entries(obj).sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(' · ');

console.log(`${qs.length} questions, core ${qs.filter((q) => q.tier === 'core').length}\n`);
for (const [d, n] of Object.entries(tally('domain')).sort()) {
  const core = qs.filter((q) => q.domain === d && q.tier === 'core').length;
  console.log(`  ${d.padEnd(28)} ${String(n).padStart(3)}  (core ${core})`);
}
console.log(`\ntypes:    ${table(tally('type'))}`);
console.log(`measures: ${table(tally('measures'))}`);
console.log(`with na:  ${qs.filter((q) => q.na).length} · age-limited: ${qs.filter((q) => q.ageRanges).length}`);

// Content words only: drop short function words and diacritics so "să"/"sa" match.
const STOP = new Set('cat cate cum care ce cel cea cei din pentru este esti sunt fost sau mai foarte tau ta tale tai tine ultimele ultimii luni ani anul acest aceasta asta daca cand unde despre catre prin fata dupa intre doar inca deja'.split(' '));
const words = (t) =>
  new Set(
    t.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
      .replace(/[^a-z0-9 ]/g, ' ').split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
const sets = qs.map((q) => words(q.text));
const sim = (a, b) => {
  let inter = 0;
  for (const w of a) if (b.has(w)) inter++;
  return inter / (a.size + b.size - inter || 1);
};

const pairs = [];
for (let i = 0; i < qs.length; i++)
  for (let j = i + 1; j < qs.length; j++) {
    const s = sim(sets[i], sets[j]);
    if (s >= THRESHOLD) pairs.push([s, qs[i], qs[j]]);
  }
pairs.sort((a, b) => b[0] - a[0]);
const cross = pairs.filter(([, a, b]) => a.domain !== b.domain);
console.log(`\nlikely duplicates (similarity ≥ ${THRESHOLD}): ${pairs.length}, across domains: ${cross.length}`);
for (const [s, a, b] of pairs)
  console.log(`  ${s.toFixed(2)}  ${a.id}  ↔  ${b.id}\n        ${a.text}\n        ${b.text}`);
