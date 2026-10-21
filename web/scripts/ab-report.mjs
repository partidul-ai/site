// What live sessions say about prediction, from the probes (src/lib/quiz-server.ts, header):
//   node scripts/ab-report.mjs [--boot 2000] [--local]
// Arms, by the uuid's first byte: control (1/16, every question random within the schedule),
// experiment (1/16, the panel's picks but each area's last question random: the probes), regular
// (14/16, no probes; not read here). Both read arms mark their probes in their stored answers.
// A probe is uniform over the questions its session hadn't been asked in that area, so predicting it
// from the session's other answers estimates accuracy over the area. The experiment's picks ignore
// the probes' answers, so using answers that came after a probe leaks nothing. Per arm: the panel's
// prediction of each probe from county, age and topics alone ("prior"), then from all the other
// answers ("answers"), and the paired "gain". Experiment minus control gain: what the panel's picks
// add over random ones. Full pool: area means weighted by the areas' question counts. Each area is
// only measured on people who answered there: their topics, "Viața ta" for everyone, and extra
// rounds. hit = the predicted top choice was picked; log = log of the probability given to what was
// picked (natural log; higher is better). 95% intervals: bootstrap over sessions.
// Control sessions' questions don't depend on their answers, so every answer of theirs is also a
// fair test point (leave-one-out), ~5x the probes, over the schedule's mix of areas.
// Another model is compared the same way: replace predict() and re-run on the same probes.
// Reads the live EU database through wrangler (scripts/d1.mjs); --local: the dev server's copy.
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanel, posterior } from '../src/lib/panel.ts';
import { d1 } from './d1.mjs';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));
const REMOTE = !process.argv.includes('--local');
const BOOT = Number(process.argv[process.argv.indexOf('--boot') + 1]) || 2000;

const quiz = JSON.parse(readFileSync(here('../src/data/quiz.json'), 'utf8'));
const bin = readFileSync(here('../public/panel/panel.bin'));
const panel = buildPanel(JSON.parse(readFileSync(here('../public/panel/panel.json'), 'utf8')), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));

// as quiz-server.ts
const armOf = (uuid) => {
  const b = parseInt(uuid.slice(0, 2), 16);
  return b < 16 ? 'control' : b < 32 ? 'experiment' : 'regular';
};

/** The panel's distribution over `qid`'s choices given the evidence. */
function predict(evidence, qid) {
  const w = posterior(panel, evidence);
  const cols = panel.col.get(qid);
  const n = panel.n;
  return new Map([...cols].map(([c, j]) => {
    let s = 0;
    for (let i = 0; i < n; i++) s += w[i] * panel.p[j * n + i] / 65535;
    return [c, s];
  }));
}
function score(dist, picked) {
  const top = [...dist].sort((a, b) => b[1] - a[1])[0][0];
  return { hit: picked.includes(top) ? 1 : 0, log: Math.log(picked.reduce((s, c) => s + (dist.get(c) ?? 0), 0) + 1e-9) };
}
/** One held-out answer: predicted from the prior alone and from every other answer. */
function test(base, answers, a) {
  const rest = answers.filter((b) => b !== a).map(({ qid, picked }) => ({ qid, picked }));
  return { area: quiz.questions[a.qid].axis, prior: score(predict(base, a.qid), a.picked), full: score(predict({ ...base, answers: rest }, a.qid), a.picked) };
}

// The finished sessions of the two read arms, with their answers (skips: no choices).
const READ = "finished_at IS NOT NULL AND arm IN ('control', 'experiment')";
const byId = new Map();
for (const r of d1(`SELECT session_id, qid, choices, probe FROM answers WHERE session_id IN (SELECT id FROM sessions WHERE ${READ}) ORDER BY session_id, step`, REMOTE))
  (byId.get(r.session_id) ?? byId.set(r.session_id, []).get(r.session_id)).push({ qid: r.qid, picked: r.choices ? JSON.parse(r.choices) : [], probe: !!r.probe });
const sessions = [];
for (const row of d1(`SELECT id, county, age, uuid, topics FROM sessions WHERE ${READ}`, REMOTE)) {
  const arm = armOf(row.uuid);
  const answers = (byId.get(row.id) ?? []).filter((a) => panel.col.has(a.qid));
  const base = { county: row.county, age: row.age, topics: row.topics ? JSON.parse(row.topics) : [], answers: [] };
  // skipped probes have nothing to predict
  const probes = answers.filter((a) => a.probe && a.picked.length).map((a) => test(base, answers, a));
  const loo = arm === 'control' ? answers.filter((a) => a.picked.length).map((a) => test(base, answers, a)) : [];
  if (probes.length) sessions.push({ arm, county: row.county, age: row.age, probes, loo });
}

const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const fmt = (x) => (x >= 0 ? ' ' : '') + x.toFixed(3);
const value = (t, m, k) => (k === 'gain' ? t.full[m] - t.prior[m] : t[k][m]);
/** Mean over the sessions' tests (`of`: 'probes' or 'loo'). */
const over = (ss, of, m, k) => mean(ss.flatMap((s) => s[of].map((t) => value(t, m, k))));
const size = quiz.axes.map((_, a) => Object.values(quiz.questions).filter((q) => q.axis === a).length);
/** The full pool: the areas' means weighted by their question counts (the areas with tests). */
function pooled(ss, of, m, k) {
  let num = 0, den = 0;
  quiz.axes.forEach((_, a) => {
    const xs = ss.flatMap((s) => s[of].filter((t) => t.area === a).map((t) => value(t, m, k)));
    if (xs.length) (num += size[a] * mean(xs)), (den += size[a]);
  });
  return den ? num / den : NaN;
}
const resample = (ss) => ss.map(() => ss[Math.floor(Math.random() * ss.length)]);
function ci(f, ...groups) {
  if (groups.some((g) => g.length < 2)) return '[too few sessions]';
  const out = [];
  for (let b = 0; b < BOOT; b++) out.push(f(...groups.map(resample)));
  out.sort((a, b) => a - b);
  return `[${fmt(out[Math.floor(0.025 * BOOT)])}, ${fmt(out[Math.floor(0.975 * BOOT)])}]`;
}

const arms = { control: sessions.filter((s) => s.arm === 'control'), experiment: sessions.filter((s) => s.arm === 'experiment') };
const probeCount = (ss) => ss.reduce((a, s) => a + s.probes.length, 0);
console.log(`${sessions.length} finished sessions with answered probes: control ${arms.control.length} (${probeCount(arms.control)} probes), experiment ${arms.experiment.length} (${probeCount(arms.experiment)} probes)`);
console.log(`counties ${new Set(sessions.map((s) => s.county)).size}; ages ${[...new Set(sessions.map((s) => s.age))].sort().join(' ')}`);
for (const [title, f] of [['probes, mean', over], ['full pool, areas weighted by their questions', pooled]]) {
  console.log(`\n${title}`);
  for (const m of ['hit', 'log']) {
    for (const [name, ss] of Object.entries(arms)) {
      if (!ss.length) continue;
      console.log(`  ${m.padEnd(4)} ${name.padEnd(10)} prior ${fmt(f(ss, 'probes', m, 'prior'))}  answers ${fmt(f(ss, 'probes', m, 'full'))} ${ci((x) => f(x, 'probes', m, 'full'), ss)}  gain ${fmt(f(ss, 'probes', m, 'gain'))} ${ci((x) => f(x, 'probes', m, 'gain'), ss)}`);
    }
    if (arms.control.length && arms.experiment.length) {
      const d = (c, e) => f(e, 'probes', m, 'gain') - f(c, 'probes', m, 'gain');
      console.log(`  ${m.padEnd(4)} panel picks vs random (gain, experiment - control): ${fmt(d(arms.control, arms.experiment))} ${ci(d, arms.control, arms.experiment)}`);
    }
  }
}
const control = arms.control.filter((s) => s.loo.length);
if (control.length) {
  console.log(`\ncontrol, leave-one-out over every answer (${control.reduce((a, s) => a + s.loo.length, 0)} answers, ${control.length} sessions)`);
  for (const m of ['hit', 'log']) {
    console.log(`  ${m.padEnd(4)} prior ${fmt(over(control, 'loo', m, 'prior'))}  answers ${fmt(over(control, 'loo', m, 'full'))}  gain ${fmt(over(control, 'loo', m, 'gain'))} ${ci((x) => over(x, 'loo', m, 'gain'), control)}`);
  }
}
