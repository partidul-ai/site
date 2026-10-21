// What people will be asked, and what picker rules cost: the live schedule and picker
// (src/lib/panel.ts, quiz-server.ts, the regular arm) replayed offline on the panel's personas.
//   node scripts/quiz-sim.mjs [sessions=300] [--rules a,b,...] [--out dir] [--seed n] [--panel dir]
// Each simulated respondent is a panel persona, left out of the panel while it answers (so the
// panel can't recognise it), answering from its own distributions. Reports:
//   acc       expected accuracy, after the 20 answers, on 100 random questions it wasn't asked
//             (the panel's top choice vs the persona's distribution);
//   na        "doesn't apply" answers per session (expected), overall / Diaspora / 65+;
//   problems  "what's wrong" lists among the 5 general questions (romania-pe-scurt 006 025 037 038);
//   tradeoff  trade-off questions per session; asked: distinct questions served.
// Rules (--rules, comma-separated; quiz-server.ts has the ones that went live):
//   residence  Diaspora sessions weigh only Diaspora personas, residents only residents
//   na         a question's information gain times (1 - its predicted "doesn't apply" share)
//   sibling    after a "doesn't apply", drop the questions with the same na label
//   place      Diaspora never gets questions whose na says you live abroad, residents never the
//              Diaspora-only ones
//   problems   at most one "what's wrong" list among the general questions
//   tradeoff   step 12-14 (each topic's third question): a random trade-off in that area
//   group      at most one question of a group (questions/README.md)
//   profile    a topic's profile questions first; then scored ones until two are asked in the area
//   live       all of the above (what quiz-server.ts does)
// Perceived value (the soulness study, 2026-10-20):
//   --appeal file   {id: mean rating 1-5} from simulated people: "would answering this feel worthwhile and about
//                   my life". Reported as appeal (mean over the asked questions) and peaks (asked with appeal >= 3.5).
//   --lambda L      the pick's utility: z(useful gain) + L * z(appeal), within the pool (0: the live picker)
//   --trustcap k    at most k trust scales (measures: trust) per quiz
//   --tradeslots s  trade-off slots at steps 12..(11+s) instead of the tradeoff rule's three
// Also reported: score, the RMS error of the session's area scores (0-100) against its persona's own.
// --out writes exposure.json and transcripts.md there. Personas, not people.
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanel, expectedArea, posterior } from '../src/lib/panel.ts';
import { LIVE, loadPolicy } from './picker-policy.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const args = process.argv.slice(2);
const opt = (k, d) => (args.includes(k) ? args[args.indexOf(k) + 1] : d);
const N = Number(args.find((a, i) => /^\d+$/.test(a) && !['--seed', '--panel', '--out'].includes(args[i - 1])) ?? 300);
const RULES = new Set((opt('--rules', '') || '').split(',').filter(Boolean).flatMap((r) => (r === 'live' ? LIVE : [r])));
const OUT = opt('--out', null);
const APPEAL = opt('--appeal', null) ? JSON.parse(readFileSync(opt('--appeal', null), 'utf8')) : null;
const LAMBDA = Number(opt('--lambda', 0));
const TRUSTCAP = Number(opt('--trustcap', Infinity));
const TRADESLOTS = opt('--tradeslots', null) === null ? null : Number(opt('--tradeslots', 0));
let seed = Number(opt('--seed', 12345));

const quiz = JSON.parse(readFileSync(here('../src/data/quiz.json'), 'utf8'));
const Q = quiz.questions;
const src = {};
for (const f of ['demografie-munca-diaspora', 'economie', 'educatie', 'energie-mediu-agricultura', 'infrastructura', 'justitie-administratie', 'politica', 'regiuni', 'romania-pe-scurt', 'sanatate', 'securitate-media', 'social'])
  for (const l of readFileSync(here(`../../questions/${f}.jsonl`), 'utf8').split('\n')) if (l.trim()) { const r = JSON.parse(l); src[r.id] = r; }
const PANEL = opt('--panel', here('../public/panel'));   // another panel export, to compare panels
const bin = readFileSync(`${PANEL}/panel.bin`);
const panel = buildPanel(JSON.parse(readFileSync(`${PANEL}/panel.json`, 'utf8')), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
const { meta } = panel;
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

const rand = () => ((seed = (seed * 1103515245 + 12345) % 2 ** 31) / 2 ** 31);
const choose = (weights) => {
  const s = weights.reduce((a, b) => a + b, 0);
  let r = rand() * s;
  for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) < 0) return i;
  return weights.length - 1;
};
const n = panel.n;
const col = (qid, c) => panel.col.get(qid)?.get(c);
const prob = (i, j) => panel.p[j * n + i] / 65535;
const isDiaspora = (i) => meta.county[i] === 'DIASPORA';

/** The site's posterior, with the respondent left out (and the residence rule if on). */
function weights(self, ev) {
  const w = posterior(panel, ev);
  w[self] = 0;
  if (RULES.has('residence')) for (let i = 0; i < n; i++) if (isDiaspora(i) !== (ev.county === 'DIASPORA')) w[i] = 0;
  let z = 0;
  for (let i = 0; i < n; i++) z += w[i];
  for (let i = 0; i < n; i++) w[i] /= z;
  return w;
}
const mixOf = (w, j) => { let s = 0; for (let i = 0; i < n; i++) s += w[i] * prob(i, j); return s; };

const zs = (xs) => { const m = xs.reduce((a, b) => a + b, 0) / xs.length; const d = Math.sqrt(xs.reduce((a, b) => a + (b - m) ** 2, 0) / xs.length) + 1e-9; return xs.map((x) => (x - m) / d); };
const appealOf = (q) => APPEAL?.[q] ?? 3;
// --expected: a question's appeal for this session = its appeal where it applies times the predicted
// share it applies to, plus NA_APPEAL (what a "doesn't apply" feels like) for the rest
const EXPECTED = args.includes('--expected');
const NA_APPEAL = Number(opt('--na-appeal', 1.5));
function pickFrom(w, pool) {
  const gains = pool.map((q) => {
    const g = informationGain(panel, w, q);
    const na = col(q, 'na');
    return RULES.has('na') && na !== undefined ? g * (1 - mixOf(w, na)) : g;
  });
  const za = LAMBDA ? zs(pool.map((q) => {
    const na = col(q, 'na');
    if (!EXPECTED || na === undefined) return appealOf(q);
    const p = mixOf(w, na);
    return (1 - p) * appealOf(q) + p * NA_APPEAL;
  })) : null;
  const util = LAMBDA ? zs(gains).map((g, i) => g + LAMBDA * za[i]) : gains;
  const dist = pickDistribution(panel, util);
  return pool[choose(dist)];
}

const policy = await loadPolicy({ rules: [...RULES], appeal: APPEAL, lambda: LAMBDA, expected: EXPECTED, naAppeal: NA_APPEAL,
  trustcap: TRUSTCAP, tradeslots: TRADESLOTS, tradeAppeal: args.includes('--trade-appeal'), panel: PANEL, rand,
  peakSteps: opt('--peak', '').split(',').filter(Boolean).map(Number), peakLambda: Number(opt('--peak-lambda', 6)), general: Number(opt('--general', 5)) });
function session({ self, topics }) {
  const county = meta.county[self], age = meta.age[self];
  const s = policy.start({ county, age, topics, exclude: self });
  const { asked, answers } = s;
  let naExpected = 0;
  for (let step = 1; step <= 20; step++) {
    const qid = policy.next(s, step);
    const cs = Q[qid].choices.map((c) => c.id);
    const ps = cs.map((c) => prob(self, col(qid, c)));
    const picked = [cs[choose(ps)]];
    if (cs.includes('na')) naExpected += ps[cs.indexOf('na')] / ps.reduce((a, b) => a + b, 0);
    policy.record(s, qid, picked);
  }
  // accuracy on 100 questions it wasn't asked
  const w = weights(self, { county, age, topics, answers });
  const test = IDS.filter((id) => !asked.includes(id)).sort(() => rand() - 0.5).slice(0, 100);
  let acc = 0;
  for (const q of test) {
    const cs = [...panel.col.get(q).values()];
    const mix = cs.map((j) => mixOf(w, j)), own = cs.map((j) => prob(self, j));
    acc += own[mix.indexOf(Math.max(...mix))] / own.reduce((a, b) => a + b, 0);
  }
  const ex = expectedArea(panel, w);
  const score = Math.sqrt(ex.reduce((s, x, a) => s + (50 * (x - meta.area[self][a])) ** 2, 0) / ex.length);
  const ap = asked.map(appealOf);
  return { self, county, age, topics, answers, acc: acc / test.length, na: naExpected, profileLate: profileLate(asked), score,
    appeal: ap.reduce((a, b) => a + b, 0) / ap.length, peaks: ap.filter((x) => x >= 3.5).length,
    trust: asked.filter((q) => src[q]?.measures === 'trust').length, experience: asked.filter((q) => src[q]?.measures === 'experience').length,
    problems: asked.slice(0, 5).filter((q) => PROBLEMS.has(q)).length, tradeoff: asked.filter((q) => TRADEOFF.has(q)).length };
}

/** Profile questions asked after another question of their area: the problem the profile rule fixes. */
const profileLate = (asked) => asked.filter((q, i) => PROFILE.includes(q) && asked.slice(5, i).some((a) => !PROFILE.includes(a) && Q[a].axis === Q[q].axis)).length;

// The respondents and their topic picks come first, from the seed alone, so every rule set
// meets the same people (a paired comparison); the picks and answers use the stream after.
const people = [];
for (let s = 0; s < N; s++) {
  const self = Math.floor(rand() * n);
  const tw = [...meta.topics[self]], topics = [];
  for (let k = 0; k < 3; k++) { const t = choose(tw); topics.push(meta.topicIds[t]); tw[t] = 0; }
  people.push({ self, topics });
}
const runs = people.map(session);
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const sd = (xs) => Math.sqrt(mean(xs.map((x) => (x - mean(xs)) ** 2)));
const seen = new Map();
for (const r of runs) for (const a of r.answers) seen.set(a.qid, (seen.get(a.qid) ?? 0) + 1);
const dia = runs.filter((r) => r.county === 'DIASPORA'), old = runs.filter((r) => r.age === '65+');
const accs = runs.map((r) => r.acc);
console.log(`rules: ${[...RULES].join(',') || 'none (live)'}  lambda ${LAMBDA}  trustcap ${TRUSTCAP}  tradeslots ${TRADESLOTS ?? 'rule'}  sessions ${N}`);
console.log(`  score ${mean(runs.map((r) => r.score)).toFixed(2)}  appeal ${mean(runs.map((r) => r.appeal)).toFixed(3)}  peaks ${mean(runs.map((r) => r.peaks)).toFixed(2)}  trust ${mean(runs.map((r) => r.trust)).toFixed(2)}  experience ${mean(runs.map((r) => r.experience)).toFixed(2)}`);
console.log(`  acc ${mean(accs).toFixed(4)} ±${(sd(accs) / Math.sqrt(N)).toFixed(4)}  na ${mean(runs.map((r) => r.na)).toFixed(2)} (diaspora ${dia.length ? mean(dia.map((r) => r.na)).toFixed(2) : '-'}, 65+ ${old.length ? mean(old.map((r) => r.na)).toFixed(2) : '-'})  problems ${mean(runs.map((r) => r.problems)).toFixed(2)}  tradeoff ${mean(runs.map((r) => r.tradeoff)).toFixed(2)}  profile ${mean(runs.map((r) => r.answers.filter((a) => PROFILE.includes(a.qid)).length)).toFixed(2)} (late ${mean(runs.map((r) => r.profileLate)).toFixed(2)})  asked ${seen.size}`);
const DUMP = opt('--dump', null); // per-session accuracy, for paired comparisons
if (DUMP) writeFileSync(DUMP, JSON.stringify(runs.map((r) => ({ acc: r.acc, na: r.na, score: r.score, appeal: r.appeal, peaks: r.peaks, trust: r.trust, experience: r.experience, asked: r.answers.map((a) => a.qid) }))));
if (OUT) {
  mkdirSync(OUT, { recursive: true });
  const exposure = IDS.map((id) => ({ id, area: AXES[Q[id].axis], share: (seen.get(id) ?? 0) / N, text: Q[id].text })).sort((a, b) => b.share - a.share);
  writeFileSync(`${OUT}/exposure.json`, JSON.stringify({ sessions: N, rules: [...RULES], questions: exposure }, null, 1));
  const label = (id, c) => Q[id].choices.find((x) => x.id === c)?.label ?? c;
  writeFileSync(`${OUT}/transcripts.md`, runs.slice(0, 12).map((r, k) => [
    `## Quiz ${k + 1}: ${r.county}, ${r.age}, topics ${r.topics.join(', ')}`,
    ...r.answers.map((a, i) => `${i + 1}. [${AXES[Q[a.qid].axis]}] ${Q[a.qid].text}  \n   → ${a.picked.map((c) => label(a.qid, c)).join('; ')}  (${a.qid})`),
  ].join('\n')).join('\n\n') + '\n');
}
