// Quiz backend: stateless. D1 stores the sessions and their answers (src/lib/store.ts); quiz.json
// holds the questions; the browser holds a signed token for its own session.
//
// Session flow
//   start(county, age)  create the session (county, age, a random uuid), then ask which topics
//   answer(token, ids)  store the answer (the picked choices, or a skip), pick the next question
//
// Picking a question: the first one is yours to answer: which 3 topics you care about (stored with
// the session, in the order picked), a prior for every answer after it.
// Then 5 general ones ("Viața ta": a random opener, then random ones from romania-pe-scurt), so
// everyone gets a broad read, then the quiz rotates through your 3 topics in the order you picked
// them, 5 each. Within an area the question is the panel's pick (src/lib/panel.ts): a posterior
// over synthetic personas from your county, age, topics and answers, and a question sampled by how
// much its answer would tell about you (information gain) and how worthwhile it is likely to feel
// to you (appeal, data/appeal.json). On the synthetic cohort that predicts
// your other answers best of everything tried; without the panel
// the pick is random. Every session is in the experiment arm (armOf): the panel's picks, except the
// last question of each area (steps 5, 18, 19, 20: "Viața ta" and each topic's fifth; and the fifth
// of every extra round), random within that area: the probes. The panel's picks ignore the probes'
// answers, so no later question depends on one. Probes are marked in the stored answers; predicting
// each from all the session's other answers measures any model's accuracy offline (areas weighted
// by size: the full pool). Until 2026-10-21 1/16 of sessions were control (every question random)
// and 14/16 regular (no probes); their stored arm says which (scripts/ab-report.mjs). Nothing random ever leaves the schedule's area. Results scores use every answer.
import { env } from 'cloudflare:workers';
import quiz from '../data/quiz.json';
import appealScores from '../data/appeal.json';
import { expectedArea, loadPanel, pick, pickByAppeal, posterior, type Appeal, type Panel, type SessionEvidence } from './panel';
import * as store from './store';
import type { Expected, StoredAnswer, StoredSession } from './store';

export const TOTAL = 21; // the topic pick, 5 general, 15 topic questions
const GENERAL_COUNT = 5; // general questions, steps 1..5 after the topic pick at step 0
const FIRST_TOPIC = 1 + GENERAL_COUNT; // the first topic question's step
const PICK = 3; // topics a session picks
const TOKEN_TTL = 30 * 24 * 60 * 60 * 1000; // a quiz left open for days still continues where it was (until 2026-10-21: an hour)

type Choice = { id: string; label: string };
type Question = {
  domain: string;
  tier: 'core' | 'pool';
  type: 'single' | 'yesno' | 'scale' | 'multi';
  text: string;
  maxSelect?: number;
  scale?: { minLabel: string; maxLabel: string };
  choices: Choice[];
  axis: number;
  measures?: string; // experience | satisfaction | priority | trend | tradeoff | expectation | trust | opinion
  outlook?: Record<string, number>;
  profile?: boolean; // a fact about you the area's other questions build on (questions/README.md)
  group?: string; // the same question in other words: at most one per quiz
  where?: 'romania' | 'diaspora'; // who can answer it: residents only, or the diaspora only (absent: anyone)
};
const QUESTIONS = quiz.questions as Record<string, Question>;
const COHORTS = new Set(quiz.cohorts as string[]); // "<county>/<age>"
const AXES = quiz.axes as { id: string; label: string }[];
// The topics to pick from, in wheel order: every axis but "Viața ta".
const TOPICS = (quiz.topics as string[]).map((id) => ({ id, label: AXES.find((a) => a.id === id)!.label }));
const TOPIC_Q = 'topics'; // the token's question id while the topics are being picked
// Opening questions: the overview's core set ("how is your life going", "right direction?").
// Scored ones only (with an outlook), so "Viața ta" has a value from the first answer.
const OPENERS = Object.keys(QUESTIONS).filter((id) => QUESTIONS[id].domain === 'romania-pe-scurt' && QUESTIONS[id].tier === 'core' && QUESTIONS[id].outlook);
const AXIS_BY_ID = new Map(AXES.map((a, i) => [a.id, i]));

// --- what the schedule never or always asks (every arm) ---------------
// From reviewing what the picker served: whole quizzes of questions that don't apply, an opening
// block of "what's wrong" lists, and almost no trade-offs. On the synthetic cohort these rules
// cost no measurable accuracy (scripts/quiz-sim.mjs).
// After a "doesn't apply" answer, the questions with the same na label don't apply either
// ("Nu am mașină", "Nu lucrez în prezent"…). Not the labels that only mean "no answer".
const NA_LABEL = new Map(Object.entries(QUESTIONS).flatMap(([id, q]) => {
  const na = q.choices.find((c) => c.id === 'na');
  return na ? [[id, na.label] as const] : [];
}));
const GENERIC_NA = new Set(['Nu știu', 'Prefer să nu spun', 'Nu pot aprecia', 'Nu am o părere formată']);
// Known from the county alone: a Diaspora session never gets the questions whose na says you live
// abroad, a resident never the Diaspora-only ones (na "Locuiesc în România…").
const ABROAD_NA = /(?<!nu )locuiesc (acum )?(în străinătate|acolo)|sau în străinătate|^nu locuiesc în românia/i;
const HOME_NA = /^(locuiesc în românia|nu locuiesc în străinătate)/i;
// Each question's `where` (questions/README.md) says it outright: "romania" for residents only,
// "diaspora" for people abroad only; the na labels catch the rest.
const notForResidence = (abroad: boolean) => (id: string) => {
  const where = QUESTIONS[id]?.where;
  if (where) return where !== (abroad ? 'diaspora' : 'romania');
  const na = NA_LABEL.get(id);
  return !!na && (abroad ? ABROAD_NA : HOME_NA).test(na);
};
// The general block's "what's wrong" lists: at most one of them per quiz.
const PROBLEM_LISTS = new Set(['romania-pe-scurt-006', 'romania-pe-scurt-025', 'romania-pe-scurt-037', 'romania-pe-scurt-038']);
// Trade-offs (what people would choose) are what the panel's picks almost never reach: the first
// topic's third question (step 12) and every round's third is a trade-off in its area, the one that
// people like this session would find most worth answering (by appeal; random in the control arm).
// Three slots felt abstract to people in blind playthroughs; one, chosen by appeal, did not.
const TRADEOFFS = new Set(Object.keys(QUESTIONS).filter((id) => QUESTIONS[id].measures === 'tradeoff'));
const isTradeoffStep = (n: number) => n === FIRST_TOPIC + 2 * PICK;
// At most two trust-in-institutions scales per quiz: more read as a barometer, not as being asked.
const TRUST_CAP = 2;
const isTrust = (id: string) => QUESTIONS[id]?.measures === 'trust';
// Soulness (src/lib/panel.ts): every pick also weighs how worthwhile and
// about their own life a question feels (data/appeal.json, 1-5; 3 for a question not yet rated).
const APPEAL: Appeal = { of: (id) => (appealScores as Record<string, number>)[id] ?? 3, lambda: 2 };
// What a profile answer already says doesn't apply: answer -> the na labels it makes true, so those
// questions are never asked (as after a "doesn't apply", but from the profile answers and age).
// "Remember what I told you": a retiree isn't asked about their job, nobody childless about their
// child's school.
const NOT_WORKING = ['Nu lucrez în prezent', 'Nu lucrez', 'Nu lucrez sau nu lucrez peste program', 'Nu lucrez sau nu sunt lucrători străini în domeniul meu', 'Nu am lucrat și nu am căutat de lucru'];
const NOT_EMPLOYED = ['Nu sunt angajat(ă)', 'Nu sunt angajat(ă) cu contract în România'];
const NO_BUSINESS = ['Nu am o afacere proprie (firmă, PFA)'];
const NO_KIDS = ['Nu am copii', 'Nu am copii la școală', 'Nu e cazul (nu am copii la școală sau nu fac meditații)', 'Locuiesc în România sau nu am copii', 'Locuiesc în România sau nu am partener ori copii'];
const NO_BILLS = ['Nu plătesc eu facturile la energie', 'Nu plătesc eu factura la curent', 'Nu folosesc gaze sau nu plătesc eu factura', 'Nu plătesc impozit pe o locuință în România'];
const IMPLIES: Record<string, Record<string, string[]>> = {
  'demografie-munca-diaspora-005': { // situația de muncă
    a: NO_BUSINESS, b: NOT_EMPLOYED, c: [...NOT_EMPLOYED, ...NO_BUSINESS],
    d: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS],
    e: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS, 'Nu e cazul (pensionar(ă), elev(ă) sau student(ă))', 'Nu primesc pensie'],
    f: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS, 'Nu e cazul (pensionar(ă), elev(ă) sau student(ă))'],
    g: [...NOT_WORKING, ...NOT_EMPLOYED, ...NO_BUSINESS],
  },
  'demografie-munca-diaspora-070': { a: NO_KIDS }, // câți copii: niciunul
  'social-007': { c: ['Nu plătesc impozit pe o locuință în România'], d: NO_BILLS }, // cu chirie / la părinți
};
const AGE_IMPLIES: Record<string, string[]> = { '65+': ['Nu am copii la școală', 'Nu e cazul (nu am copii la școală sau nu fac meditații)'] };
const impliedNotApplying = (s: StoredSession) => [
  ...(AGE_IMPLIES[s.age] ?? []),
  ...s.answers.flatMap((a) => a.picked.flatMap((c) => IMPLIES[a.qid]?.[c] ?? [])),
];
// Profile questions (education, employment, children, housing, type of locality) come before
// anything else in their area, in pool order, so no question builds on what hasn't been asked yet.
const PROFILE = Object.keys(QUESTIONS).filter((id) => QUESTIONS[id].profile);
// Questions respondents read as one question in other words (questions/README.md): at most one each.
const groupOf = (id: string) => QUESTIONS[id]?.group;

// --- tokens ---------------------------------------------------------------------------
// base64url(payload).base64url(HMAC-SHA256(payload)). Only the server can mint one, and
// a token only lets you answer the one question it was issued for.
// t: the session's topics (axis indices), in the order they rotate.
// v: the order the token's step counts in. 3 is this one. Tokens issued before it (they live an
// hour) get their step mapped onto it by stepOf: 2 had 5 general at 0..4, the pick at 5, topics at
// 6..20; none had the pick at 0, 4 general at 1..4, topics at 5..19.
// Topic rounds (unlocking an area from the results page): x the area, c answers there so far,
// g whether one of them has a score, k the session's "<county>/<age>".
// pr: this question is a probe.
type Token = { s: string; q: string; n: number; e: number; v?: number; t?: number[]; pr?: boolean; x?: number; c?: number; g?: boolean; k?: string };
const b64 = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const unb64 = (s: string) => Uint8Array.from(atob(s.replace(/-/g, '+').replace(/_/g, '/')), (c) => c.charCodeAt(0));
let keyPromise: Promise<CryptoKey> | undefined;
const hmacKey = () =>
  (keyPromise ??= crypto.subtle.importKey('raw', new TextEncoder().encode(env.TOKEN_SECRET), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign', 'verify']));

async function sign(t: Token) {
  const body = b64(new TextEncoder().encode(JSON.stringify(t)));
  const mac = new Uint8Array(await crypto.subtle.sign('HMAC', await hmacKey(), new TextEncoder().encode(body)));
  return `${body}.${b64(mac)}`;
}
// A finished quiz's last token also proves the result is yours, for unlocking more areas later,
// with no end date: it lasts as long as the owner cookie does (lib/owner-cookie.ts; until
// 2026-10-21, 90 days).
async function verify(token: string, owner = false): Promise<Token | null> {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  let t: Token;
  try {
    // Not base64: not ours either.
    const ok = await crypto.subtle.verify('HMAC', await hmacKey(), unb64(mac), new TextEncoder().encode(body));
    if (!ok) return null;
    t = JSON.parse(new TextDecoder().decode(unb64(body))) as Token;
  } catch {
    return null;
  }
  return owner || t.e > Date.now() ? t : null;
}

/** The session a finished quiz's token proves is yours, or null. */
export const ownerOf = async (token: string) => (token ? ((await verify(token, true))?.s ?? null) : null);

/** The finished result an owner token is for, with how many areas it has open (a score in them),
 *  or null if it has none (expired token, result deleted). */
export async function ownedFinished(token: string): Promise<{ result: string; done: number; total: number } | null> {
  const id = await ownerOf(token);
  if (!id) return null;
  const s = await store.loadSession(id); // throws if D1 is unreachable: no answer, rather than a wrong "you have none"
  if (!s?.finished) return null;
  const { count } = axisTotals(s.answers);
  return { result: id, done: count.filter((c) => c > 0).length, total: A };
}

// --- quiz -----------------------------------------------------------------------------
export type Step =
  | { done: false; token: string; n: number; total: number; question: Omit<Question, 'choices' | 'domain' | 'tier'> & { id: string; minSelect?: number; choices: { id: string; label: string }[] } }
  | { done: true; n: number; total: number; result: string };

// --- the panel ------------------------------------------------------------------------
// Static assets (public/panel/), read once per isolate through the ASSETS binding.
// (The binding ignores the host; dev's Vite server only answers localhost.)
const panel = () => loadPanel((path) => env.ASSETS.fetch(new Request(`http://localhost${path}`)));

/** The session's arm (see the header): experiment for every session, old ones included, so an
 *  extra round of a control or regular session gets probes too. 'control' and 'regular' remain
 *  only in sessions stored before 2026-10-21. */
export type Arm = 'control' | 'experiment' | 'regular';
export function armOf(_uuid: string): Arm {
  return 'experiment';
}
/** Steps whose question is the last of its area: the 5th general one, and each topic's 5th. */
const isProbeStep = (n: number) => n === FIRST_TOPIC - 1 || n >= TOTAL - PICK;

/** What the panel conditions on: the session's county and age, topic pick and answers. */
function evidenceOf(s: StoredSession, leaveOut: Set<string> = new Set()): SessionEvidence {
  const answers = s.answers.filter((a) => !leaveOut.has(a.qid)).map(({ qid, picked }) => ({ qid, picked }));
  return { county: s.county, age: s.age, topics: s.topics ?? [], answers };
}

type PickOptions = {
  axis: number;
  scoredFirst?: boolean; // a scored question in the area if there is one
  scoredUntil?: number; // the same, while the session has been asked fewer scored ones there
  profileFirst?: boolean; // the area's profile questions before anything else
  anywhere?: boolean; // nothing left in the area: any question
  only?: string[]; // narrows every pool (the openers)
  general?: boolean; // the general block: at most one "what's wrong" list
  tradeoff?: boolean; // a random trade-off in the area, if one is left
  probeStep?: boolean; // the area's last question (see the header)
};

/** A question this session hasn't been asked and that can apply to it (see above), from the first
 *  non-empty pool: the area's first unasked profile question if asked for, a random trade-off if asked for, a scored one in the area if asked for, else
 *  any in the area, else (if `anywhere`) any at all. The panel picks within the pool; the pick is
 *  random instead in the control arm, for the experiment arm's probes, or without the panel.
 *  probe: whether the question is to be recorded as a probe (control and experiment arms, on a
 *  probe step). */
async function pickQuestion(session: string, o: PickOptions): Promise<{ id: string; probe: boolean } | undefined> {
  const [s, model] = await Promise.all([store.loadSession(session), panel()]);
  if (!s) throw new QuizError('Nu se poate.');
  const answers = s.answers;
  const asked = new Set(answers.map((a) => a.qid));
  const notApplying = new Set([
    ...answers.filter((a) => a.picked.includes('na')).map((a) => NA_LABEL.get(a.qid)).filter((l): l is string => !!l && !GENERIC_NA.has(l)),
    ...impliedNotApplying(s),
  ]);
  const trustFull = answers.filter((a) => isTrust(a.qid)).length >= TRUST_CAP;
  const problemAsked = o.general && answers.some((a) => PROBLEM_LISTS.has(a.qid));
  const elsewhere = notForResidence(s.county === 'DIASPORA');
  const groups = new Set(answers.map((a) => groupOf(a.qid)).filter(Boolean));
  const fresh = (o.only ?? Object.keys(QUESTIONS)).filter((id) => !asked.has(id) && !notApplying.has(NA_LABEL.get(id) ?? '') && !(problemAsked && PROBLEM_LISTS.has(id)) && !elsewhere(id) && !groups.has(groupOf(id)) && !(trustFull && isTrust(id)));
  const inArea = fresh.filter((id) => QUESTIONS[id].axis === o.axis);
  const profile = o.profileFirst ? PROFILE.find((id) => inArea.includes(id)) : undefined;
  if (profile) return { id: profile, probe: false };
  const scoredFirst = o.scoredFirst || (o.scoredUntil !== undefined && answers.filter((a) => QUESTIONS[a.qid].axis === o.axis && QUESTIONS[a.qid].outlook).length < o.scoredUntil);
  const arm = armOf(s.uuid);
  const trade = o.tradeoff ? inArea.filter((id) => TRADEOFFS.has(id)) : [];
  if (trade.length) {
    const id = !model || arm === 'control' ? trade[Math.floor(Math.random() * trade.length)] : pickByAppeal(model, posterior(model, evidenceOf(s)), trade, Math.random(), APPEAL);
    return { id, probe: false };
  }
  const pools = [...(scoredFirst ? [inArea.filter((id) => QUESTIONS[id].outlook)] : []), inArea, ...(o.anywhere ? [fresh] : [])];
  const pool = pools.find((p) => p.length);
  if (!pool) return undefined;
  const probe = !!o.probeStep && arm !== 'regular';
  const evidence = arm === 'control' || probe ? null : evidenceOf(s, arm === 'experiment' ? new Set(answers.filter((a) => a.probe).map((a) => a.qid)) : undefined);
  const id = !model || !evidence ? pool[Math.floor(Math.random() * pool.length)] : pick(model, posterior(model, evidence), pool, Math.random(), APPEAL);
  return { id, probe };
}

/** The step asking `id`, its token carrying `extra`. */
async function ask(session: string, id: string, n: number, total: number, extra: Partial<Token>): Promise<Step> {
  const q = QUESTIONS[id];
  const token = await sign({ ...extra, s: session, q: id, n, v: 3, e: Date.now() + TOKEN_TTL });
  const { domain, tier, choices, ...shown } = q;
  return { done: false, token, n, total, question: { id, ...shown, choices: choices.map(({ id, label }) => ({ id, label })) } };
}

/** The first step: pick 3 topics. Shown like a multiple-choice question that needs exactly 3.
 *  n is 0, or a later step for a session that got to its topics without picking them (an older
 *  token's order). */
async function askTopics(session: string, n: number): Promise<Step> {
  const token = await sign({ s: session, q: TOPIC_Q, n, v: 3, e: Date.now() + TOKEN_TTL });
  return {
    done: false,
    token,
    n,
    total: TOTAL,
    question: {
      id: TOPIC_Q,
      type: 'multi',
      text: 'Ce contează cel mai mult pentru tine?',
      minSelect: PICK,
      maxSelect: PICK,
      axis: 0,
      choices: TOPICS.map(({ id, label }) => ({ id, label })),
    },
  };
}

/** The topic pick, stored with the session. */
async function pickTopics(t: Token, picked: string[] | null): Promise<Step> {
  const chosen = TOPICS.filter((x) => picked?.includes(x.id));
  if (!picked || chosen.length !== PICK || new Set(picked).size !== PICK) throw new QuizError(`Alege ${PICK} teme.`);
  await store.setTopics(t.s, picked);
  // They rotate in the order you picked them.
  return next(t.s, t.n + 1, picked.map((id) => AXIS_BY_ID.get(id)!));
}

/** Step n. */
async function next(session: string, n: number, topics: number[]): Promise<Step> {
  if (n >= TOTAL) return finish(session, n);
  // Got to the topics without picking them (a quiz started in the general-first order).
  if (n >= FIRST_TOPIC && !topics.length) return askTopics(session, n - 1);
  // The first general question is one of the openers; after it, one in this turn's area (general
  // first, then the topics in turn), the panel's pick in both.
  let got: { id: string; probe: boolean } | undefined;
  if (n === 1) got = await pickQuestion(session, { axis: 0, only: OPENERS, general: true });
  else {
    const axis = n < FIRST_TOPIC ? 0 : topics[(n - FIRST_TOPIC) % topics.length];
    // A topic opens with its profile questions. The first two other questions of each area are
    // scored ones (with an outlook), so every area gets a value even if one is skipped, and
    // the results shape closes: in a topic, until two scored ones have been asked there. Nothing
    // left in the area: any question.
    const topic = n >= FIRST_TOPIC;
    got = await pickQuestion(session, { axis, scoredFirst: n <= 2, scoredUntil: topic ? 2 : undefined, profileFirst: topic, anywhere: true, general: n < FIRST_TOPIC, tradeoff: isTradeoffStep(n), probeStep: isProbeStep(n) });
  }
  if (!got) return finish(session, n);
  return ask(session, got.id, n, TOTAL, { t: topics, ...(got.probe && { pr: true }) });
}

// --- topic rounds ----------------------------------------------------------------------
// From your results page, a locked area can be unlocked: questions from that area only, until
// you've answered ROUND of them there (and one has a score). Your own result already shows each
// answer; the averages get each scored answer as it comes, so leaving halfway loses nothing.
export const ROUND = 5;

export async function startRound(token: string, axisId: string): Promise<Step> {
  const t = await verify(token, true);
  if (!t) throw new QuizError('Sesiunea a expirat. Completează din nou chestionarul.');
  const x = AXIS_BY_ID.get(axisId);
  const s = await store.loadSession(t.s);
  if (x === undefined || !s?.finished) throw new QuizError('Nu se poate.');
  const answers = s.answers.filter((a) => QUESTIONS[a.qid]?.axis === x && a.picked.length);
  const c = answers.length;
  const g = answers.some((a) => outlookOf(a.qid, a.picked) !== null);
  return roundNext(t.s, { x, c, g, k: `${s.county}/${s.age}` });
}

async function roundNext(session: string, r: { x: number; c: number; g: boolean; k: string }): Promise<Step> {
  const done: Step = { done: true, n: r.c, total: ROUND, result: session };
  if (r.c >= ROUND && r.g) return done;
  // The round's fifth question is its probe in the control and experiment arms (see the header).
  const got = await pickQuestion(session, { axis: r.x, scoredFirst: !r.g || r.c < 2, profileFirst: true, tradeoff: r.c === 2 && r.g, probeStep: r.c === ROUND - 1 });
  return got ? ask(session, got.id, Math.min(r.c, ROUND - 1), ROUND, { ...r, ...(got.probe && { pr: true }) }) : done;
}

export class QuizError extends Error {}

export async function start(county: string, age: string): Promise<Step> {
  if (!COHORTS.has(`${county}/${age}`)) throw new QuizError('Județ sau vârstă necunoscute.');
  return askTopics(await store.createSession(county, age, armOf), 0);
}

/** A token's step in this order (see Token.v). */
const stepOf = (t: Token) => (t.v === 3 ? t.n : t.v === 2 ? (t.n < GENERAL_COUNT ? t.n + 1 : t.n) : t.n >= 5 ? t.n + 1 : t.n);

/** picked: choice ids, or null to skip the question. */
export async function answer(token: string, picked: string[] | null): Promise<Step> {
  const t = await verify(token);
  if (!t) throw new QuizError('Sesiunea a expirat. Reia chestionarul.');
  if (t.q === TOPIC_Q) return pickTopics(t, picked);
  const q = QUESTIONS[t.q];
  const round = t.x !== undefined ? { x: t.x, c: t.c ?? 0, g: !!t.g, k: t.k ?? '' } : null;
  if (picked === null) {
    await store.saveAnswer(t.s, { qid: t.q, picked: null, probe: !!t.pr, axis: q.axis, outlook: null });
    return round ? roundNext(t.s, round) : next(t.s, stepOf(t) + 1, t.t ?? []);
  }

  const max = q.type === 'multi' ? (q.maxSelect ?? q.choices.length) : 1;
  const chosen = q.choices.filter((c) => picked.includes(c.id));
  if (!chosen.length || chosen.length > max || chosen.length !== new Set(picked).size) throw new QuizError('Răspuns invalid.');
  if (chosen.some((c) => c.id === 'na') && chosen.length > 1) throw new QuizError('Răspuns invalid.');

  const value = outlookOf(t.q, picked);
  const saved = { qid: t.q, picked: chosen.map((c) => c.id), probe: !!t.pr, axis: q.axis, outlook: value };
  if (!round) {
    await store.saveAnswer(t.s, saved);
    return next(t.s, stepOf(t) + 1, t.t ?? []);
  }
  // A round's answer (the session is finished, so it counts in the averages at once) moves the
  // session's expected scores in every area: stored with it, in the same transaction. Without the
  // panel they stay as they were.
  let after: Expected = null;
  try {
    const [s, model] = await Promise.all([store.loadSession(t.s), panel()]);
    if (s) after = expectedOf(model, { ...s, answers: [...s.answers.filter((a) => a.qid !== t.q), saved] });
  } catch (e) {
    console.error('round: expected scores not updated for', t.s, e);
  }
  await store.saveAnswer(t.s, saved, after);
  return roundNext(t.s, { ...round, c: round.c + 1, g: round.g || value !== null });
}

// --- results --------------------------------------------------------------------------
// Each evaluative answer has an outlook in [-1, 1] (questions/README.md): how well things are
// going, by that answer. A person's score on an axis is the mean outlook of their answers
// there, shown as 0–100. The comparison lines (Romania, your county) are SQL aggregates over the
// finished sessions (store.averages): the mean outlook of their answers per area, the same
// quantity as yours.
const A = AXES.length;
const MIN_COHORT = 3; // below this many people, a cohort average says nothing

/** How well things are going by this answer, -1..1: the mean outlook of the picked choices.
 *  null when the question isn't evaluative or the answer was "doesn't apply". */
function outlookOf(qid: string, picked: string[]): number | null {
  const q = QUESTIONS[qid];
  const vals = picked.filter((c) => c !== 'na').map((c) => q.outlook?.[c]).filter((v): v is number => v !== undefined);
  return vals.length ? vals.reduce((x, y) => x + y, 0) / vals.length : null;
}

/** Per-axis outlook sums and counts for one person, and how many questions they answered there. */
function axisTotals(answers: StoredAnswer[]) {
  const sum = Array(A).fill(0), count = Array(A).fill(0), answered = Array(A).fill(0);
  for (const a of answers) {
    if (!QUESTIONS[a.qid]) continue; // left the pool since
    const axis = QUESTIONS[a.qid].axis;
    if (a.picked.length) answered[axis] += 1;
    const v = outlookOf(a.qid, a.picked);
    if (v === null) continue;
    sum[axis] += v;
    count[axis] += 1;
  }
  return { sum, count, answered };
}

/** The panel's expected outlook (-1..1, AXES order) over all of each area's evaluative questions
 *  given a session's answers, open area or not; null in areas the panel doesn't score. */
function panelAreas(model: Panel, s: StoredSession): (number | null)[] {
  const x = expectedArea(model, posterior(model, evidenceOf(s)));
  return AXES.map((a) => {
    const j = model.meta.areaIds.indexOf(a.id);
    return j >= 0 ? x[j] : null;
  });
}

/** A session's "you" score per area (outlook -1..1, AXES order): panelAreas in the open areas
 *  (a scored answer there), null in the rest. null without the panel. */
function expectedOf(model: Panel | null, s: StoredSession): Expected {
  if (!model) return null;
  const x = panelAreas(model, s);
  const { count } = axisTotals(s.answers);
  return x.map((v, i) => (count[i] > 0 ? v : null));
}

/** Last step of a session: it counts in the averages from now on, with its expected scores. */
async function finish(session: string, n: number): Promise<Step> {
  let expected: Expected = null;
  try {
    const [s, model] = await Promise.all([store.loadSession(session), panel()]);
    if (s) expected = expectedOf(model, s);
  } catch (e) {
    // The visitor still gets their results page; the comparison lines miss this session's expected
    // scores (its answers still count) until a round stores them.
    console.error('finish: expected scores not computed for', session, e);
  }
  await store.finishSession(session, expected);
  return { done: true, n, total: TOTAL, result: session };
}

/** Delete your result: the session and its answers, and so its part in the averages. */
export async function deleteSession(token: string) {
  const t = await verify(token, true);
  if (!t) throw new QuizError('Sesiunea a expirat.');
  if (!(await store.deleteSession(t.s))) throw new QuizError('Nu se poate.');
}

export type Result = {
  county: string;
  age: string;
  finished: boolean;
  axes: { id: string; label: string; open: boolean; answered: number; you: number | null; cohort: number | null; ro: number | null }[];
  people: { cohort: number; ro: number };
  /** The big score at the top, 0-100, for you and each line: the mean of all the areas, equal
   *  weights. null when an area has no score yet. */
  score: { you: number | null; cohort: number | null; ro: number | null };
};

const toScore = (sum: number, count: number) => (count ? Math.round(((sum / count + 1) / 2) * 100) : null);

/** Everything the results page shows, from D1. null if `session` isn't a quiz session. */
export async function results(session: string): Promise<Result | null> {
  if (!/^[\w-]{1,64}$/.test(session)) return null;
  const s = await store.loadSession(session).catch(() => null);
  if (!s) return null;

  // Compared with the whole county (all ages).
  const avg = await store.averages(s.county, A);
  const me = axisTotals(s.answers);
  // An area opens once it has a score (an answer with an outlook). The rest show locked, so the
  // open ones always form a closed shape.
  const open = me.count.map((c) => c > 0);
  const people = { cohort: avg.people.county, ro: avg.people.ro };
  const showCohort = people.cohort >= MIN_COHORT;
  // Your score in an open area: the mean outlook of your answers there, what you said. Not the
  // panel's expected outlook: from a few answers its posterior barely leaves the prior (two "Deloc"
  // answers in Localitatea ta still read 54), so the score didn't reflect the answers. The lines:
  // the mean outlook of everyone's answers there, the same quantity. The panel still picks the
  // questions; its expected scores are still stored (store.Totals esum) but not shown.
  const line = (v: store.Totals, i: number) => toScore(v.sum[i], v.count[i]);

  const axes = AXES.map((a, i) => ({
    ...a,
    open: open[i],
    answered: me.answered[i],
    you: open[i] ? toScore(me.sum[i], me.count[i]) : null,
    cohort: showCohort ? line(avg.county, i) : null,
    ro: line(avg.ro, i),
  }));

  // The big score: the mean over the areas you opened, and each line's over those same areas
  // (where it has a value), so the three numbers compare the same thing.
  const mean = (v: (number | null)[]) => {
    const xs = v.filter((x): x is number => x !== null);
    return xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length) : null;
  };
  const mine = axes.filter((a) => a.open);
  const score = {
    you: mean(mine.map((a) => a.you)),
    cohort: showCohort ? mean(mine.map((a) => a.cohort)) : null,
    ro: mean(mine.map((a) => a.ro)),
  };

  return { county: s.county, age: s.age, finished: s.finished, axes, people, score };
}
