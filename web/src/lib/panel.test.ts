// The site's panel maths against reference scenarios computed by the offline panel builder, on the same files.
//   node --test web/src/lib/panel.test.ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanel, expectedAppeal, expectedArea, informationGain, pick, pickByAppeal, pickDistribution, posterior, soulUtility, usefulGain, type PanelMeta } from './panel.ts';

const here = (p: string) => fileURLToPath(new URL(p, import.meta.url));
const meta = JSON.parse(readFileSync(here('../../public/panel/panel.json'), 'utf8')) as PanelMeta;
const bin = readFileSync(here('../../public/panel/panel.bin'));
const panel = buildPanel(meta, bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const ref = JSON.parse(readFileSync(here('./panel-reference.json'), 'utf8'));

const close = (a: number, b: number, tol = 1e-9, what = '') =>
  assert.ok(Math.abs(a - b) <= tol * Math.max(1, Math.abs(b)), `${what}: ${a} vs ${b}`);

test('reference matches this panel', () => assert.equal(ref.version, meta.version));

for (const [k, s] of ref.scenarios.entries()) {
  test(`scenario ${k}: ${s.answers.length} answers`, () => {
    const w = posterior(panel, s);
    close(w.reduce((a, b) => a + b, 0), 1, 1e-12, 'weights sum');
    for (const [x, i] of s.top_weights) close(w[i], x, 1e-9, `weight ${i}`);
    const gains = s.pool.map((q: string) => informationGain(panel, w, q));
    gains.forEach((g: number, i: number) => close(g, s.gains[i], 1e-9, `gain ${s.pool[i]}`));
    const useful = s.pool.map((q: string) => usefulGain(panel, w, q));
    useful.forEach((g: number, i: number) => close(g, s.useful[i], 1e-9, `useful gain ${s.pool[i]}`));
    pickDistribution(panel, useful).forEach((x, i) => close(x, s.softmax[i], 1e-9, `softmax ${i}`));
    expectedArea(panel, w).forEach((x, a) => close(x, s.area[a], 1e-9, `area ${a}`));
  });
}

test('pick follows its distribution and stays in the pool', () => {
  const s = ref.scenarios[1];
  const w = posterior(panel, s);
  const dist = pickDistribution(panel, s.pool.map((q: string) => usefulGain(panel, w, q)));
  const counts = new Map<string, number>();
  const N = 20000;
  for (let i = 0; i < N; i++) {
    const q = pick(panel, w, s.pool, (i + 0.5) / N); // a deterministic sweep of [0, 1)
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  s.pool.forEach((q: string, i: number) => close((counts.get(q) ?? 0) / N, dist[i], 1e-3, `share of ${q}`));
});

test('unknown questions and choices add nothing', () => {
  const base = { county: 'CJ', age: '25-34', topics: [], answers: [] };
  const w0 = posterior(panel, base);
  const w1 = posterior(panel, { ...base, answers: [{ qid: 'nu-exista-001', picked: ['a'] }, { qid: meta.questions[0].id, picked: [] }] });
  w0.forEach((x, i) => close(w1[i], x, 1e-15, `weight ${i}`));
  assert.equal(informationGain(panel, w0, 'nu-exista-001'), 0);
});

test('residence is a hard match', () => {
  const abroad = posterior(panel, { county: 'DIASPORA', age: '25-34', topics: [], answers: [] });
  const home = posterior(panel, { county: 'CJ', age: '25-34', topics: [], answers: [] });
  meta.county.forEach((c, i) => assert.equal(c === 'DIASPORA' ? home[i] : abroad[i], 0, `persona ${i} (${c})`));
});

test('soul utility: z(useful gain) + lambda * z(expected appeal), as the soulness study ran it', () => {
  const s = ref.scenarios[2];
  const w = posterior(panel, s);
  const scores = Object.fromEntries(s.pool.map((q: string, i: number) => [q, 1 + (i % 5)]));
  const appeal = { of: (q: string) => scores[q] ?? 3, lambda: 2 };
  // independently: the na share from the panel's columns, then z-scores
  const naShare = (q: string) => {
    const j = panel.col.get(q)?.get('na');
    if (j === undefined) return null;
    let x = 0;
    for (let i = 0; i < panel.n; i++) x += (w[i] * panel.p[j * panel.n + i]) / 65535;
    return x;
  };
  const exp = s.pool.map((q: string) => { const p = naShare(q); return p === null ? scores[q] : (1 - p) * scores[q] + p * 1.5; });
  s.pool.forEach((q: string, i: number) => close(expectedAppeal(panel, w, q, appeal), exp[i], 1e-12, `appeal ${q}`));
  const z = (xs: number[]) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const d = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) + 1e-9; return xs.map((x) => (x - m) / d); };
  const g = z(s.pool.map((q: string) => usefulGain(panel, w, q))), a = z(exp);
  soulUtility(panel, w, s.pool, appeal).forEach((u, i) => close(u, g[i] + 2 * a[i], 1e-9, `utility ${i}`));
  // pick with appeal follows the softmax of that utility; pickByAppeal the softmax of the appeal
  const N = 20000;
  for (const [fn, dist] of [
    [(r: number) => pick(panel, w, s.pool, r, appeal), pickDistribution(panel, g.map((x, i) => x + 2 * a[i]))],
    [(r: number) => pickByAppeal(panel, w, s.pool, r, appeal), pickDistribution(panel, exp)],
  ] as const) {
    const counts = new Map<string, number>();
    for (let k = 0; k < N; k++) { const q = (fn as (r: number) => string)((k + 0.5) / N); counts.set(q, (counts.get(q) ?? 0) + 1); }
    s.pool.forEach((q: string, i: number) => close((counts.get(q) ?? 0) / N, (dist as number[])[i], 1e-3, `share of ${q}`));
  }
});
