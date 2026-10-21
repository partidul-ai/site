// The panel: synthetic personas' answer distributions, built offline into
// public/panel/panel.bin + panel.json. For a session, a posterior over the personas from its
// county, age, topic pick and answers; from it the next question (sampled information gain) and
// each area's expected outlook. Pure functions here; loading lives in loadPanel().

export type PanelMeta = {
  version: string;
  personas: number;
  answers: number;
  gamma: number; // tempering of the evidence (real people are noisier than one persona)
  kappa: number; // prior weight per matching attribute (age band, county)
  temperature: number; // softmax temperature over the pool's standardised information gain
  questions: { id: string; choices: string[] }[];
  county: string[];
  age: string[];
  topicIds: string[];
  topics: number[][]; // [persona][topic]: the persona's topic-pick distribution
  areaIds: string[];
  area: number[][]; // [persona][area]: expected outlook over the area's evaluative questions
};

export type Panel = {
  meta: PanelMeta;
  n: number;
  col: Map<string, Map<string, number>>; // question id -> choice id -> answer column
  p: Uint16Array; // [answer][persona], probability * 65535 (read as p[i] / 65535: 10 MB, not 41 as floats)
  logTopic: Float64Array; // [topic][persona]
  area: Float64Array; // [area][persona]
};

export type SessionEvidence = {
  county: string;
  age: string;
  topics: string[];
  answers: { qid: string; picked: string[] }[]; // picked empty: skipped, no evidence
};

export function buildPanel(meta: PanelMeta, bin: ArrayBuffer): Panel {
  const n = meta.personas;
  const p = new Uint16Array(bin);
  if (p.length !== n * meta.answers) throw new Error(`panel.bin: ${p.length} values, expected ${n * meta.answers}`);
  const col = new Map<string, Map<string, number>>();
  let c = 0;
  for (const q of meta.questions) {
    const m = new Map<string, number>();
    for (const id of q.choices) m.set(id, c++);
    col.set(q.id, m);
  }
  const logTopic = new Float64Array(meta.topicIds.length * n);
  meta.topicIds.forEach((_, t) => { for (let i = 0; i < n; i++) logTopic[t * n + i] = Math.log(meta.topics[i][t] + 1e-6); });
  const area = new Float64Array(meta.areaIds.length * n);
  meta.areaIds.forEach((_, a) => { for (let i = 0; i < n; i++) area[a * n + i] = meta.area[i][a]; });
  return { meta, n, col, p, logTopic, area };
}

/** Normalised posterior weights over the personas. Questions or choices the panel doesn't know
 *  add no evidence. Residence is a hard match: a Diaspora session weighs only the Diaspora
 *  personas, any other only the residents (unless the panel has none of that kind). With county
 *  as a soft match (kappa), half a Diaspora session's weight sat on residents, and the picker kept
 *  asking questions that don't apply abroad. */
export function posterior(panel: Panel, s: SessionEvidence): Float64Array {
  const { n, meta, p } = panel;
  const lw = new Float64Array(n);
  const abroad = s.county === DIASPORA;
  const hard = meta.county.some((c) => (c === DIASPORA) === abroad);
  for (let i = 0; i < n; i++) {
    lw[i] = hard && (meta.county[i] === DIASPORA) !== abroad ? -Infinity
      : meta.kappa * ((meta.age[i] === s.age ? 1 : 0) + (meta.county[i] === s.county ? 1 : 0));
  }
  for (const t of s.topics) {
    const ti = meta.topicIds.indexOf(t);
    if (ti < 0) continue;
    for (let i = 0; i < n; i++) lw[i] += meta.gamma * panel.logTopic[ti * n + i];
  }
  const sum = new Float64Array(n);
  for (const a of s.answers) {
    const cols = panel.col.get(a.qid);
    const picked = a.picked.map((c) => cols?.get(c)).filter((c): c is number => c !== undefined);
    if (!picked.length) continue;
    sum.fill(0);
    for (const c of picked) for (let i = 0; i < n; i++) sum[i] += p[c * n + i] / 65535;
    for (let i = 0; i < n; i++) lw[i] += meta.gamma * Math.log(sum[i] + 1e-6);
  }
  let max = -Infinity;
  for (let i = 0; i < n; i++) if (lw[i] > max) max = lw[i];
  let z = 0;
  for (let i = 0; i < n; i++) z += (lw[i] = Math.exp(lw[i] - max));
  for (let i = 0; i < n; i++) lw[i] /= z;
  return lw;
}

const DIASPORA = 'DIASPORA';

/** What asking `qid` is worth: its information gain times the share of people like this session
 *  for whom it applies (1 - the predicted "doesn't apply" share). A question that likely doesn't
 *  apply tells little about how things are going, and costs the person a turn. */
export function usefulGain(panel: Panel, w: Float64Array, qid: string): number {
  const g = informationGain(panel, w, qid);
  const na = panel.col.get(qid)?.get('na');
  if (na === undefined) return g;
  const { n, p } = panel;
  let share = 0;
  for (let i = 0; i < n; i++) share += (w[i] * p[na * n + i]) / 65535;
  return g * (1 - share);
}

/** Information gain of asking `qid`: H(sum_i w_i P_i(.)) - sum_i w_i H(P_i(.)); 0 if unknown. */
export function informationGain(panel: Panel, w: Float64Array, qid: string): number {
  const cols = panel.col.get(qid);
  if (!cols) return 0;
  const { n, p } = panel;
  let h = 0;
  for (const c of cols.values()) {
    let mix = 0, cond = 0;
    for (let i = 0; i < n; i++) {
      const x = p[c * n + i] / 65535;
      mix += w[i] * x;
      cond += w[i] * x * Math.log(x + 1e-12);
    }
    h += -mix * Math.log(mix + 1e-12) + cond;
  }
  return h;
}

/** The pick's distribution over the pool: softmax of the standardised information gain / T. */
export function pickDistribution(panel: Panel, gains: number[]): number[] {
  const m = gains.reduce((a, b) => a + b, 0) / gains.length;
  const sd = Math.sqrt(gains.reduce((a, b) => a + (b - m) ** 2, 0) / gains.length);
  const z = gains.map((g) => (g - m) / (sd + 1e-9) / panel.meta.temperature);
  const top = Math.max(...z);
  const e = z.map((x) => Math.exp(x - top));
  const s = e.reduce((a, b) => a + b, 0);
  return e.map((x) => x / s);
}

/** One question from `pool`, sampled by its useful gain; `rand` in [0, 1). */
export function pick(panel: Panel, w: Float64Array, pool: string[], rand: number, appeal?: Appeal): string {
  return sample(pool, pickDistribution(panel, appeal ? soulUtility(panel, w, pool, appeal) : pool.map((q) => usefulGain(panel, w, q))), rand);
}

function sample<T>(pool: T[], dist: number[], rand: number): T {
  let acc = 0;
  for (let i = 0; i < pool.length; i++) if (rand < (acc += dist[i])) return pool[i];
  return pool[pool.length - 1];
}

// --- soulness (2026-10-20) --------------------------------------------------------------------
// Picking only by information gain made the quiz feel like a form: trust scales and national-mood
// questions, few about the person's own life. Each question has an appeal score, 1-5: how
// worthwhile and about their own life it felt to the people it applies to (8 simulated raters,
// updated with 1,500 first-sight reactions from simulated blind playthroughs). The pick weighs both:
//   utility = z(useful gain) + lambda * z(expected appeal), within the pool,
// expected appeal = (1 - the predicted "doesn't apply" share) * appeal + that share * naAppeal.
// lambda 2 was the knee in three blind rounds (12 + 12 + 24 simulated people): soulness 4.7 -> 6.8 of 10,
// at -0.4 points of accuracy on the synthetic cohort.
export type Appeal = { of: (qid: string) => number; lambda: number; naAppeal?: number };

/** A question's appeal for this session: its appeal where it applies, weighted by how likely it is
 *  to apply to people like this session (a "doesn't apply" feels like naAppeal). */
export function expectedAppeal(panel: Panel, w: Float64Array, qid: string, appeal: Appeal): number {
  const a = appeal.of(qid);
  const na = panel.col.get(qid)?.get('na');
  if (na === undefined) return a;
  const { n, p } = panel;
  let share = 0;
  for (let i = 0; i < n; i++) share += (w[i] * p[na * n + i]) / 65535;
  return (1 - share) * a + share * (appeal.naAppeal ?? 1.5);
}

const zscores = (xs: number[]) => {
  const m = xs.reduce((a, b) => a + b, 0) / xs.length;
  const sd = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) + 1e-9;
  return xs.map((x) => (x - m) / sd);
};

/** The pick's utility over `pool` (see above). */
export function soulUtility(panel: Panel, w: Float64Array, pool: string[], appeal: Appeal): number[] {
  const g = zscores(pool.map((q) => usefulGain(panel, w, q)));
  const a = zscores(pool.map((q) => expectedAppeal(panel, w, q, appeal)));
  return g.map((x, i) => x + appeal.lambda * a[i]);
}

/** One question from `pool` sampled by expected appeal alone (the trade-off slot). */
export function pickByAppeal(panel: Panel, w: Float64Array, pool: string[], rand: number, appeal: Appeal): string {
  return sample(pool, pickDistribution(panel, pool.map((q) => expectedAppeal(panel, w, q, appeal))), rand);
}

/** Each area's expected outlook (-1..1) under the posterior, in meta.areaIds order. */
export function expectedArea(panel: Panel, w: Float64Array): number[] {
  const { n } = panel;
  return panel.meta.areaIds.map((_, a) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += w[i] * panel.area[a * n + i];
    return s;
  });
}

// --- loading (Worker) -------------------------------------------------------------------
// Once per isolate: the files are static assets (public/panel/), read through the ASSETS binding.
let loading: Promise<Panel | null> | undefined;

export function loadPanel(fetchAsset: (path: string) => Promise<Response>): Promise<Panel | null> {
  return (loading ??= (async () => {
    try {
      const [m, b] = await Promise.all([fetchAsset('/panel/panel.json'), fetchAsset('/panel/panel.bin')]);
      if (!m.ok || !b.ok) throw new Error(`panel assets: ${m.status} / ${b.status}`);
      const panel = buildPanel((await m.json()) as PanelMeta, await b.arrayBuffer());
      console.log(`panel ${panel.meta.version} loaded: ${panel.n} personas`);
      return panel;
    } catch (e) {
      console.error('panel unavailable, falling back to random picks', e);
      loading = undefined; // try again on a later request
      return null;
    }
  })());
}
