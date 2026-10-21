// End-to-end check of the quiz against a running site (default the dev server):
//   node scripts/quiz-e2e.mjs [base=http://localhost:4321] [runs=3] [--delete] [--report]
// --delete: delete the finished sessions after all runs (/api/delete, as their owner; also when a
// check fails), for runs against the live grid: they are taken back out of the averages.
// --report: first run scripts/ab-report.mjs (over every finished session, these included).
// HUMAN=<token>: the Turnstile token to send (default a dummy, which only dev's test keys accept).
// COUNTY=<code>: every run in that county (e.g. DIASPORA), aged 45-54.
// Plays whole quizzes through the HTTP API, then one extra round in a locked area, and checks the
// schedule (topic pick, 5 general with an opener first, 15 rotating through the 3 topics, scored
// ones first; the schedule's rules: no question whose "doesn't apply" was already answered, at most
// one "what's wrong" list among the general questions, at most one question of a group, a topic's
// profile questions first, a random trade-off as each topic's third question and each round's third),
// that no question repeats, and that the results page renders.
// From the database (scripts/d1.mjs: the local copy for a localhost base, else the live EU one;
// D1=local|remote overrides): each session's arm (quiz-server.ts armOf), that it is finished, its
// stored answers in the order given, its probes (steps 5, 18, 19, 20 and the
// round's fifth), its expected scores, and with --delete that nothing of it is left;
// and each pick's information-gain rank within its pool, per arm and kind (random picks: ~0.5).
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { buildPanel, posterior, soulUtility } from '../src/lib/panel.ts';
import { d1, sq } from './d1.mjs';

const args = process.argv.slice(2).filter((a) => !a.startsWith('--'));
const DELETE = process.argv.includes('--delete');
const REPORT = process.argv.includes('--report');
const owners = []; // [owner cookie, result id] per finished quiz
const BASE = args[0] ?? 'http://localhost:4321';
const RUNS = Number(args[1] ?? 3);
let cookie = '';
const quiz = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/quiz.json', import.meta.url)), 'utf8'));
const Q = quiz.questions;
const AXES = quiz.axes.map((a) => a.id);
const OPENERS = Object.keys(Q).filter((id) => Q[id].domain === 'romania-pe-scurt' && Q[id].tier === 'core' && Q[id].outlook);
const counties = quiz.cohorts.map((k) => k.split('/'));
// The panel as the server has it: each pick's rank by information gain within the pool it was
// drawn from (0.5 on average for random picks).
const pfile = (p) => fileURLToPath(new URL(`../public/panel/${p}`, import.meta.url));
const bin = readFileSync(pfile('panel.bin'));
const panel = buildPanel(JSON.parse(readFileSync(pfile('panel.json'), 'utf8')), bin.buffer.slice(bin.byteOffset, bin.byteOffset + bin.byteLength));
// The dev server sometimes drops a connection: retry those (never an HTTP error).
async function fetchRetry(url, init) {
  for (let attempt = 0; ; attempt++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (attempt >= 4) throw e;
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
    }
  }
}

async function post(path, body) {
  const res = await fetchRetry(BASE + path, { method: 'POST', headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }) }, body: JSON.stringify(body) });
  const set = res.headers.get('set-cookie');
  if (set) cookie = set.split(';')[0];
  const out = await res.json();
  if (!res.ok) throw new Error(`${path}: ${res.status} ${JSON.stringify(out)}`);
  return out;
}

const fail = (msg) => { throw new Error(msg); };

const ranks = {}; // "<arm> <kind>" -> ranks (kind: panel pick, probe, random)
const addRank = (k, x) => (ranks[k] ??= []).push(x);
const REMOTE = process.env.D1 ? process.env.D1 === 'remote' : !/^https?:\/\/(localhost|127\.0\.0\.1)\b/.test(BASE);
const rowOf = (id) => d1(`SELECT uuid, arm, county, age, topics, finished_at FROM sessions WHERE id = ${sq(id)}`, REMOTE)[0];
const armOf = () => 'experiment'; // as quiz-server.ts: every session since 2026-10-21
const sessionOf = (token) => JSON.parse(Buffer.from(token.split('.')[0], 'base64url')).s;
const PROBE_STEPS = [5, 18, 19, 20];
// as quiz-server.ts
const NA_LABEL = new Map(Object.entries(Q).flatMap(([id, q]) => { const na = q.choices.find((c) => c.id === 'na'); return na ? [[id, na.label]] : []; }));
const GENERIC_NA = new Set(['Nu știu', 'Prefer să nu spun', 'Nu pot aprecia', 'Nu am o părere formată']);
const PROBLEM_LISTS = new Set(['romania-pe-scurt-006', 'romania-pe-scurt-025', 'romania-pe-scurt-037', 'romania-pe-scurt-038']);
const PROFILE = Object.keys(Q).filter((id) => Q[id].profile);
if (!PROFILE.length) console.warn('quiz.json has no profile questions (not rebuilt since the question rework: run quiz:sync); the profile rule is not checked');
const TRADEOFFS = new Set(Object.keys(Q).filter((id) => Q[id].measures === 'tradeoff'));
if (!TRADEOFFS.size) throw new Error('quiz.json has no measures: run quiz:sync');
const ABROAD_NA = /(?<!nu )locuiesc (acum )?(în străinătate|acolo)|sau în străinătate|^nu locuiesc în românia/i;
const HOME_NA = /^(locuiesc în românia|nu locuiesc în străinătate)/i;
/** The questions the schedule's rules leave for a session in `county` with these answers. */
// as quiz-server.ts: the trust cap, what profile answers and age already rule out, and appeal
const APPEAL_SCORES = JSON.parse(readFileSync(fileURLToPath(new URL('../src/data/appeal.json', import.meta.url)), 'utf8'));
const APPEAL = { of: (id) => APPEAL_SCORES[id] ?? 3, lambda: 2 };
const NOT_WORKING = ['Nu lucrez în prezent', 'Nu lucrez', 'Nu lucrez sau nu lucrez peste program', 'Nu lucrez sau nu sunt lucrători străini în domeniul meu', 'Nu am lucrat și nu am căutat de lucru'];
const NOT_EMPLOYED = ['Nu sunt angajat(ă)', 'Nu sunt angajat(ă) cu contract în România'];
const NO_BUSINESS = ['Nu am o afacere proprie (firmă, PFA)'];
const NO_KIDS = ['Nu am copii', 'Nu am copii la școală', 'Nu e cazul (nu am copii la școală sau nu fac meditații)', 'Locuiesc în România sau nu am copii', 'Locuiesc în România sau nu am partener ori copii'];
const NO_BILLS = ['Nu plătesc eu facturile la energie', 'Nu plătesc eu factura la curent', 'Nu folosesc gaze sau nu plătesc eu factura', 'Nu plătesc impozit pe o locuință în România'];
const IMPLIES = {
  'demografie-munca-diaspora-005': { a: NO_BUSINESS, b: NOT_EMPLOYED, c: [...NOT_EMPLOYED, ...NO_BUSINESS], d: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS],
    e: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS, 'Nu e cazul (pensionar(ă), elev(ă) sau student(ă))', 'Nu primesc pensie'], f: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS, 'Nu e cazul (pensionar(ă), elev(ă) sau student(ă))'], g: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS] },
  'demografie-munca-diaspora-070': { a: NO_KIDS },
  'social-007': { c: ['Nu plătesc impozit pe o locuință în România'], d: NO_BILLS },
};
const AGE_IMPLIES = { '65+': ['Nu am copii la școală', 'Nu e cazul (nu am copii la școală sau nu fac meditații)'] };
const isTrust = (id) => Q[id]?.measures === 'trust';
let AGE = null; // the session being checked (allowed() is called with its answers)
function allowed(given, general, county) {
  const implied = [...(AGE_IMPLIES[AGE] ?? []), ...given.flatMap((a) => a.picked.flatMap((c) => IMPLIES[a.qid]?.[c] ?? []))];
  const trustFull = given.filter((a) => isTrust(a.qid)).length >= 2;
  const elsewhere = (id) => {
    if (Q[id].where) return Q[id].where !== (county === 'DIASPORA' ? 'diaspora' : 'romania');
    const na = NA_LABEL.get(id); return !!na && (county === 'DIASPORA' ? ABROAD_NA : HOME_NA).test(na);
  };
  const notApplying = new Set([...given.filter((a) => a.picked.includes('na')).map((a) => NA_LABEL.get(a.qid)).filter((l) => l && !GENERIC_NA.has(l)), ...implied]);
  const problemAsked = general && given.some((a) => PROBLEM_LISTS.has(a.qid));
  const groups = new Set(given.map((a) => Q[a.qid].group).filter(Boolean));
  return (id) => !given.some((a) => a.qid === id) && !notApplying.has(NA_LABEL.get(id) ?? '') && !(problemAsked && PROBLEM_LISTS.has(id)) && !elsewhere(id) && !groups.has(Q[id].group) && !(trustFull && isTrust(id));
}


/** Where `qid` ranks by information gain within `pool` (null for a pool of one); `given` without
 *  `leaveOut` is what the server's posterior used. */
function rankOf(qid, pool, ev, given, leaveOut) {
  if (pool.length < 2) return null;
  const w = posterior(panel, { ...ev, answers: given.filter((a) => !leaveOut.includes(a.qid)) });
  const gains = soulUtility(panel, w, pool, APPEAL);
  const mine = gains[pool.indexOf(qid)];
  return gains.filter((g) => g < mine).length / (pool.length - 1);
}
function randomAnswer(q) {
  const ids = q.choices.map((c) => c.id).filter((c) => c !== 'na' || Math.random() < 0.1);
  const m = q.type === 'multi' ? Math.min(ids.length, 1 + Math.floor(Math.random() * Math.min(2, q.maxSelect ?? 2))) : 1;
  const picked = [...ids].sort(() => Math.random() - 0.5).slice(0, m);
  return picked.includes('na') ? ['na'] : picked;
}
const scored = (qid, picked) => picked.some((c) => c !== 'na' && Q[qid].outlook?.[c] !== undefined);

async function play(run) {
  const [county, age] = process.env.COUNTY ? [process.env.COUNTY, '45-54'] : counties[Math.floor(Math.random() * counties.length)];
  AGE = age;
  let step = await post('/api/session', { judet: county, varsta: age, website: '', elapsed: 5000, human: process.env.HUMAN ?? 'XXXX.DUMMY.TOKEN.XXXX' });
  const asked = [], given = [], probes = [];
  let topics = null, arm = null, session = null;
  const kindOf = (isProbe, isTrade) => (isTrade ? 'tradeoff' : arm === 'control' ? 'random' : isProbe && arm === 'experiment' ? 'probe' : 'panel pick');
  while (!step.done) {
    const q = step.question;
    if (q.id === 'topics') {
      if (step.n !== 0) fail(`topic pick at step ${step.n}`);
      topics = [...q.choices].sort(() => Math.random() - 0.5).slice(0, 3).map((c) => c.id);
      session = sessionOf(step.token);
      const row = rowOf(session);
      if (!row) fail(`session ${session} is not in the database`);
      arm = armOf(row.uuid);
      if (row.arm !== arm) fail(`session ${session}: stored arm ${row.arm}, its uuid says ${arm}`);
      step = await post('/api/answer', { token: step.token, choices: topics });
      continue;
    }
    const n = step.n, meta = Q[q.id];
    if (!meta) fail(`unknown question ${q.id}`);
    if (asked.includes(q.id)) fail(`question ${q.id} asked twice`);
    const area = AXES[meta.axis];
    const want = n <= 5 ? 'viata' : topics[(n - 6) % 3];
    if (area !== want) fail(`step ${n}: ${q.id} is in ${area}, the schedule says ${want}`);
    if (n === 1 && !OPENERS.includes(q.id)) fail(`step 1: ${q.id} is not an opener`);
    // the pool the server drew from (quiz-server.ts pickQuestion), and where the pick ranked in it
    const fresh = (n === 1 ? OPENERS : Object.keys(Q)).filter(allowed(given, n <= 5, county));
    const inArea = fresh.filter((id) => Q[id].axis === AXES.indexOf(want));
    const profile = n >= 6 ? PROFILE.find((id) => inArea.includes(id)) : undefined;
    if (profile && q.id !== profile) fail(`step ${n}: ${q.id}, but the topic's profile question ${profile} comes first`);
    const scoredFirst = n <= 2 || (n >= 6 && given.filter((a) => Q[a.qid].axis === meta.axis && Q[a.qid].outlook).length < 2);
    const trade = n === 12 ? inArea.filter((id) => TRADEOFFS.has(id)) : [];
    const pool = profile ? [profile] : [trade, scoredFirst && n > 1 ? inArea.filter((id) => Q[id].outlook) : null, inArea, fresh].find((p) => p && p.length);
    if (!pool.includes(q.id)) fail(`step ${n}: ${q.id} is not in the pool the rules give`);
    if (n <= 5 && PROBLEM_LISTS.has(q.id) && asked.some((a) => PROBLEM_LISTS.has(a))) fail(`step ${n}: a second "what's wrong" list, ${q.id}`);
    const isProbe = PROBE_STEPS.includes(n);
    const r = arm && rankOf(q.id, pool, { county, age, topics }, given, arm === 'experiment' ? probes : []);
    if (r !== null && arm) addRank(`${arm} ${kindOf(isProbe, trade.length > 0)}`, r);
    if (isProbe && arm !== 'regular') probes.push(q.id);
    asked.push(q.id);
    const sent = randomAnswer(q);
    given.push({ qid: q.id, picked: sent });
    step = await post('/api/answer', { token: step.token, choices: sent });
  }
  if (asked.length !== 20) fail(`run ${run}: ${asked.length} questions, expected 20`);
  const result = step.result;
  const page = await fetchRetry(`${BASE}/r/${result}`);
  if (!page.ok) fail(`results page: ${page.status}`);
  owners.push([cookie, result]);

  // One extra round in an area that isn't open yet (no scored answer there).
  const open = new Set(given.filter((a) => scored(a.qid, a.picked)).map((a) => Q[a.qid].axis));
  const locked = AXES.map((id, i) => [id, i]).filter(([, i]) => i > 0 && !open.has(i));
  const round = [];
  if (locked.length) {
    const [areaId, x] = locked[Math.floor(Math.random() * locked.length)];
    step = await post('/api/round', { area: areaId });
    let c = given.filter((a) => Q[a.qid].axis === x && a.picked.length).length;
    let g = false;
    while (!step.done) {
      const q = step.question;
      if (Q[q.id].axis !== x) fail(`round in ${areaId}: ${q.id} is in ${AXES[Q[q.id].axis]}`);
      if ([...asked, ...round].includes(q.id)) fail(`round: ${q.id} asked twice`);
      const inArea = Object.keys(Q).filter((id) => Q[id].axis === x && allowed(given, false, county)(id));
      const profile = PROFILE.find((id) => inArea.includes(id));
      const trade = c === 2 && g ? inArea.filter((id) => TRADEOFFS.has(id)) : [];
      const pool = profile ? [profile] : [trade, !g || c < 2 ? inArea.filter((id) => Q[id].outlook) : null, inArea].find((p) => p && p.length);
      if (!pool.includes(q.id)) fail(`round: ${q.id} is not in the pool the rules give`);
      const isProbe = c === 4;
      const r = arm && rankOf(q.id, pool, { county, age, topics }, given, arm === 'experiment' ? probes : []);
      if (r !== null && arm) addRank(`${arm} ${kindOf(isProbe, trade.length > 0)}`, r);
      if (isProbe && arm !== 'regular') probes.push(q.id);
      round.push(q.id);
      const sent = randomAnswer(q);
      given.push({ qid: q.id, picked: sent });
      c += 1;
      g ||= scored(q.id, sent);
      step = await post('/api/answer', { token: step.token, choices: sent });
    }
    owners.at(-1)[0] = cookie; // the round's last token is an owner token too
    if (round.length < 5) fail(`round in ${areaId}: ${round.length} questions`);
  }
  {
    // What the database holds: the session, finished, with its topics; every answer in the order
    // given (skips have no choices); the probes; an expected score in each open area (the panel's).
    const row = rowOf(result);
    if (!row?.finished_at) fail(`session ${result} is not finished in the database`);
    if (row.county !== county || row.age !== age || row.topics !== JSON.stringify(topics)) fail(`session ${result}: stored ${row.county}/${row.age} ${row.topics}`);
    const stored = d1(`SELECT qid, choices, probe FROM answers WHERE session_id = ${sq(result)} ORDER BY step`, REMOTE);
    const order = [...asked, ...round];
    if (stored.map((a) => a.qid).join() !== order.join()) fail(`session ${result}: answers stored as ${stored.map((a) => a.qid).join(' ')}, asked ${order.join(' ')}`);
    const ids = (picked) => JSON.stringify(picked && [...picked].sort());
    const sent = new Map(given.map((a) => [a.qid, ids(a.picked)]));
    const off = stored.find((a) => ids(JSON.parse(a.choices)) !== sent.get(a.qid));
    if (off) fail(`session ${result}: ${off.qid} stored as ${off.choices}, sent ${sent.get(off.qid)}`);
    const storedProbes = stored.filter((a) => a.probe).map((a) => a.qid);
    if (storedProbes.join() !== probes.join()) fail(`${arm} arm: probes stored ${storedProbes.join(' ') || 'none'}, expected ${probes.join(' ') || 'none'}`);
    const openNow = new Set(given.filter((a) => scored(a.qid, a.picked)).map((a) => Q[a.qid].axis));
    const exp = d1(`SELECT axis FROM expected WHERE session_id = ${sq(result)}`, REMOTE).map((e) => e.axis);
    if (exp.some((x) => !openNow.has(x)) || exp.length !== [...openNow].filter((x) => panel.meta.areaIds.includes(AXES[x])).length) fail(`session ${result}: expected scores in areas ${exp.join(' ')}, open ${[...openNow].join(' ')}`);
  }
  console.log(`run ${run}: ${arm ?? '?'} arm, ${county}/${age}, topics ${topics.join(' ')}, 20 questions + ${round.length} in a round, ${probes.length} probes, results ${page.status} /r/${result}`);
  cookie = '';
}

let failure = null;
try {
  for (let run = 0; run < RUNS; run++) await play(run);
} catch (e) {
  failure = e;
  console.error('FAILED:', e.message, '(cleaning up first)');
  if (cookie && !owners.some(([c]) => c === cookie)) console.error('the failed run\'s session may be left unfinished (not in the averages)');
}
if (REPORT) {
  const { execFileSync } = await import('node:child_process');
  try {
    console.log(execFileSync(process.execPath, ['--no-warnings', fileURLToPath(new URL('ab-report.mjs', import.meta.url)), ...(REMOTE ? [] : ['--local'])], { encoding: 'utf8' }));
  } catch (e) {
    console.error('ab-report failed (deleting anyway):', e.message);
  }
}
if (DELETE) {
  // Every session gets its try before anything fails; a dev server's 5xx is retried.
  const failed = [];
  for (const [c, result] of owners) {
    cookie = c;
    let out = null, status = 0;
    for (let attempt = 0; attempt < 4 && !(out?.ok && status === 404); attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000));
      if (!out?.ok) out = await post('/api/delete', {}).catch((e) => ({ error: e.message }));
      status = (await fetchRetry(`${BASE}/r/${result}`)).status;
    }
    const left = d1(`SELECT (SELECT COUNT(*) FROM sessions WHERE id = ${sq(result)}) + (SELECT COUNT(*) FROM answers WHERE session_id = ${sq(result)}) + (SELECT COUNT(*) FROM expected WHERE session_id = ${sq(result)}) AS n`, REMOTE)[0].n;
    console.log(`deleted /r/${result}: ${JSON.stringify(out)}, results page now ${status}, rows left ${left}`);
    if (!out?.ok || status !== 404 || left) failed.push(result);
  }
  if (failed.length) fail(`not deleted: ${failed.join(' ')}`);
}
for (const [k, r] of Object.entries(ranks).sort()) {
  console.log(`${k.padEnd(24)} information-gain rank within the pool: mean ${(r.reduce((a, b) => a + b, 0) / r.length).toFixed(2)} over ${r.length} (random: 0.50)`);
}
if (failure) throw failure;
console.log('all runs passed');
