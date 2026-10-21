// The quiz's question choice as a policy with knobs, shared by scripts/quiz-sim.mjs (synthetic people) and
// the blind role-play harness, so both run the same logic. Mirrors quiz-server.ts's regular arm (schedule,
// pools, rules) and adds the soulness study's knobs (2026-10-20).
//   const P = await loadPolicy({ rules, appeal, lambda, expected, naAppeal, trustcap, tradeslots, tradeAppeal })
//   const s = P.start({ county, age, topics, exclude })   // exclude: a panel persona to leave out (the sim)
//   const qid = P.next(s, step)                            // steps 1..20 (0 is the topic pick)
//   P.record(s, qid, picked)                               // picked: choice ids, [] for a skip
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanel, informationGain, pickDistribution, posterior } from '../src/lib/panel.ts';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
export const LIVE = ['residence', 'na', 'sibling', 'place', 'problems', 'tradeoff', 'group', 'profile'];
// 'implies' (the soulness study): what a profile answer already says doesn't apply. Answer -> the na labels
// it makes true, so the questions with those labels are never asked (as the sibling rule, but from the
// profile answers and age, not only from an earlier "doesn't apply").
const NOT_WORKING = ['Nu lucrez în prezent', 'Nu lucrez', 'Nu lucrez sau nu lucrez peste program', 'Nu lucrez sau nu sunt lucrători străini în domeniul meu', 'Nu am lucrat și nu am căutat de lucru'];
const NOT_EMPLOYED = ['Nu sunt angajat(ă)', 'Nu sunt angajat(ă) cu contract în România'];
const NO_BUSINESS = ['Nu am o afacere proprie (firmă, PFA)'];
const NO_KIDS = ['Nu am copii', 'Nu am copii la școală', 'Nu e cazul (nu am copii la școală sau nu fac meditații)', 'Locuiesc în România sau nu am copii', 'Locuiesc în România sau nu am partener ori copii'];
const NO_BILLS = ['Nu plătesc eu facturile la energie', 'Nu plătesc eu factura la curent', 'Nu folosesc gaze sau nu plătesc eu factura', 'Nu plătesc impozit pe o locuință în România'];
export const IMPLIES = {
  'demografie-munca-diaspora-005': {
    a: [...NO_BUSINESS], b: [...NOT_EMPLOYED], c: [...NOT_EMPLOYED, ...NO_BUSINESS],
    d: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS], e: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS, 'Nu e cazul (pensionar(ă), elev(ă) sau student(ă))', 'Nu primesc pensie'],
    f: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS, 'Nu e cazul (pensionar(ă), elev(ă) sau student(ă))'], g: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS],
  },
  'demografie-munca-diaspora-070': { a: NO_KIDS },
  'social-007': { c: ['Nu plătesc impozit pe o locuință în România'], d: NO_BILLS },
};
export const AGE_IMPLIES = { '65+': ['Nu am copii la școală', 'Nu e cazul (nu am copii la școală sau nu fac meditații)'] };
const DOMAINS = ['demografie-munca-diaspora', 'economie', 'educatie', 'energie-mediu-agricultura', 'infrastructura', 'justitie-administratie', 'politica', 'regiuni', 'romania-pe-scurt', 'sanatate', 'securitate-media', 'social'];

export async function loadPolicy(o = {}) {
  const rules = new Set((o.rules ?? LIVE).flatMap((r) => (r === 'live' ? LIVE : [r])));
  const quiz = JSON.parse(readFileSync(o.manifest ?? here('../src/data/quiz.json'), 'utf8'));
  const Q = quiz.questions;
  const src = {};
  for (const f of DOMAINS) for (const l of readFileSync(here(`../../questions/${f}.jsonl`), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); src[r.id] = r; }
  const dir = o.panel ?? here('../public/panel');
  const bin = readFileSync(`${dir}/panel.bin`);
  const panel = buildPanel(JSON.parse(readFileSync(`${dir}/panel.json`, 'utf8')), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
  const { meta } = panel, n = panel.n;
  const AXES = quiz.axes.map((a) => a.id);
  const IDS = Object.keys(Q);
  const OPENERS = IDS.filter((id) => Q[id].domain === 'romania-pe-scurt' && Q[id].tier === 'core' && Q[id].outlook);
  const PROBLEMS = new Set(['romania-pe-scurt-006', 'romania-pe-scurt-025', 'romania-pe-scurt-037', 'romania-pe-scurt-038']);
  const PROFILE = IDS.filter((id) => src[id]?.profile);
  const groupOf = (id) => src[id]?.group;
  const TRADEOFF = new Set(IDS.filter((id) => src[id]?.measures === 'tradeoff'));
  const GENERIC_NA = new Set(['Nu știu', 'Prefer să nu spun', 'Nu pot aprecia', 'Nu am o părere formată']);
  const ABROAD_NA = /(?<!nu )locuiesc (acum )?(în străinătate|acolo)|sau în străinătate|^nu locuiesc în românia/i;
  const HOME_NA = /^(locuiesc în românia|nu locuiesc în străinătate)/i;
  const naLabel = (id) => (Q[id].choices.some((c) => c.id === 'na') ? src[id]?.na ?? null : null);
  const col = (qid, c) => panel.col.get(qid)?.get(c);
  const prob = (i, j) => panel.p[j * n + i] / 65535;
  const mixOf = (w, j) => { let s = 0; for (let i = 0; i < n; i++) s += w[i] * prob(i, j); return s; };
  const zs = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const d = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) + 1e-9; return xs.map((x) => (x - m) / d); };
  const APPEAL = o.appeal ?? null;
  // peak-end: on these steps (the opening, the last question) the pick leans much harder on appeal
  const PEAK_STEPS = new Set(o.peakSteps ?? []), PEAK_LAMBDA = o.peakLambda ?? 6;
  // the general block's length (steps 1..GEN), then the topics rotate over the rest of the 20
  const GEN = o.general ?? 5, FT = GEN + 1;
  const LAMBDA = o.lambda ?? 0, TRUSTCAP = o.trustcap ?? Infinity, TRADESLOTS = o.tradeslots ?? null;
  const NA_APPEAL = o.naAppeal ?? 1.5;
  const rand = o.rand ?? Math.random;
  const appealOf = (q) => APPEAL?.[q] ?? 3;

  function weights(s) {
    const w = posterior(panel, { county: s.county, age: s.age, topics: s.topics, answers: s.answers.filter((a) => a.picked.length) });
    if (s.exclude !== undefined) w[s.exclude] = 0;
    if (rules.has('residence')) for (let i = 0; i < n; i++) if ((meta.county[i] === 'DIASPORA') !== (s.county === 'DIASPORA')) w[i] = 0;
    let z = 0;
    for (let i = 0; i < n; i++) z += w[i];
    for (let i = 0; i < n; i++) w[i] /= z;
    return w;
  }
  /** Appeal for this session: where it applies, times the predicted share it applies to (with --expected). */
  const sessionAppeal = (w, q) => {
    const na = col(q, 'na');
    if (!o.expected || na === undefined) return appealOf(q);
    const p = mixOf(w, na);
    return (1 - p) * appealOf(q) + p * NA_APPEAL;
  };
  function sample(dist) {
    let r = rand(), acc = 0;
    for (let i = 0; i < dist.length; i++) if (r < (acc += dist[i])) return i;
    return dist.length - 1;
  }
  function pickFrom(w, pool, lambda = LAMBDA) {
    const gains = pool.map((q) => {
      const g = informationGain(panel, w, q);
      const na = col(q, 'na');
      return rules.has('na') && na !== undefined ? g * (1 - mixOf(w, na)) : g;
    });
    const util = lambda ? (() => { const za = zs(pool.map((q) => sessionAppeal(w, q))); return zs(gains).map((g, i) => g + lambda * za[i]); })() : gains;
    return pool[sample(pickDistribution(panel, util))];
  }

  /** Drop the questions whose "doesn't apply" label is one of `labels`. */
  function gate(s, labels) {
    if (!labels.length) return;
    const L = new Set(labels);
    for (const id of IDS) if (L.has(naLabel(id))) s.gone.add(id);
  }
  return {
    Q, src, panel, AXES, PROFILE, TRADEOFF, PROBLEMS, appealOf, weights,
    start({ county, age, topics, exclude }) {
      const s = { county, age, topics, exclude, asked: [], answers: [], gone: new Set() };
      if (rules.has('place')) for (const id of IDS) {
        const where = Q[id].where;
        if (where ? where !== (county === 'DIASPORA' ? 'diaspora' : 'romania') : naLabel(id) && (county === 'DIASPORA' ? ABROAD_NA : HOME_NA).test(naLabel(id))) s.gone.add(id);
      }
      if (rules.has('implies')) gate(s, AGE_IMPLIES[age] ?? []);
      return s;
    },
    next(s, step) {
      const { asked } = s;
      const area = step <= GEN ? 0 : AXES.indexOf(s.topics[(step - FT) % 3]);
      const scoredFirst = step <= 2 || (step >= FT && (rules.has('profile') ? asked.filter((a) => Q[a].axis === area && Q[a].outlook).length < 2 : step < FT + 6));
      const groups = new Set(rules.has('group') ? asked.map(groupOf).filter(Boolean) : []);
      const trustFull = asked.filter((a) => src[a]?.measures === 'trust').length >= TRUSTCAP;
      const ok = (id) => !asked.includes(id) && !s.gone.has(id) && !groups.has(groupOf(id))
        && !(rules.has('problems') && step <= GEN && PROBLEMS.has(id) && asked.some((a) => PROBLEMS.has(a)))
        && !(trustFull && src[id]?.measures === 'trust');
      const fresh = (step === 1 ? OPENERS : IDS).filter(ok);
      const inArea = fresh.filter((id) => Q[id].axis === area);
      const profile = rules.has('profile') && step >= FT ? PROFILE.find((id) => inArea.includes(id)) : undefined;
      if (profile) return profile;
      const tradeStep = TRADESLOTS === null ? rules.has('tradeoff') && step >= FT + 6 && step <= FT + 8 : step >= FT + 6 && step < FT + 6 + TRADESLOTS;
      const trade = tradeStep ? inArea.filter((id) => TRADEOFF.has(id)) : [];
      const w = weights(s);
      if (trade.length) {
        if (!o.tradeAppeal) return trade[Math.floor(rand() * trade.length)];
        return trade[sample(pickDistribution(panel, trade.map((q) => sessionAppeal(w, q))))];
      }
      const pool = [scoredFirst && step > 1 ? inArea.filter((id) => Q[id].outlook) : null, inArea, fresh].find((p) => p && p.length);
      return pickFrom(w, pool, PEAK_STEPS.has(step) ? PEAK_LAMBDA : LAMBDA);
    },
    record(s, qid, picked) {
      s.asked.push(qid);
      s.answers.push({ qid, picked });
      if (rules.has('implies')) gate(s, picked.flatMap((c) => IMPLIES[qid]?.[c] ?? []));
      if (rules.has('sibling') && picked.includes('na') && naLabel(qid) && !GENERIC_NA.has(naLabel(qid))) for (const id of IDS) if (naLabel(id) === naLabel(qid)) s.gone.add(id);
    },
  };
}
