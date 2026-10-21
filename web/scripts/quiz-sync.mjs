// Writes the manifest the site ships with, src/data/quiz.json, from the question pool
// (questions/*.jsonl): questions, choices, axes, cohorts and topics. Run after changing the pool,
// before deploying:  npm run quiz:sync
// quiz.json is the only source of the questions; D1 stores answers by question and choice id.
//
// --preview: write the manifest as it will be to .cache/quiz-preview.json instead, leaving
// quiz.json as it is (to try a changed pool offline before it goes live).
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const here = (p) => fileURLToPath(new URL(p, import.meta.url));

// --- config ---------------------------------------------------------------------------
const TYPES = new Set(['single', 'yesno', 'scale', 'multi']); // what the quiz UI can show

// Results chart axes: each groups one or more wiki domains.
const AXES = [
  { id: 'viata', label: 'Viața ta', domains: ['romania-pe-scurt'] },
  { id: 'bani', label: 'Bani și trai', domains: ['economie', 'social'] },
  { id: 'munca', label: 'Muncă', domains: ['demografie-munca-diaspora'] },
  { id: 'sanatate', label: 'Sănătate', domains: ['sanatate'] },
  { id: 'educatie', label: 'Educație', domains: ['educatie'] },
  { id: 'stat', label: 'Stat și justiție', domains: ['justitie-administratie', 'politica'] },
  { id: 'infra', label: 'Infrastructură și mediu', domains: ['infrastructura', 'energie-mediu-agricultura'] },
  { id: 'siguranta', label: 'Siguranță și încredere', domains: ['securitate-media'] },
  { id: 'local', label: 'Localitatea ta', domains: ['regiuni'] },
];
const axisOf = (domain) => AXES.findIndex((a) => a.domains.includes(domain));
const AGES = ['18-24', '25-34', '35-44', '45-54', '55-64', '65+'];

// --- what should exist ----------------------------------------------------------------
const questions = readdirSync(here('../../questions/'))
  .filter((f) => f.endsWith('.jsonl'))
  .flatMap((f) => readFileSync(here(`../../questions/${f}`), 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)))
  .filter((q) => TYPES.has(q.type));

const counties = [...readFileSync(here('../src/data/counties.ts'), 'utf8').matchAll(/code: '([A-Z]+)', name: '([^']+)'/g)].map(([, code, name]) => ({ code, name }));

function choicesOf(q) {
  const list =
    q.type === 'yesno'
      ? [{ id: 'da', label: 'Da' }, { id: 'nu', label: 'Nu' }]
      : q.type === 'scale'
        ? [1, 2, 3, 4, 5].map((n) => ({ id: String(n), label: n === 1 ? q.scale.minLabel : n === 5 ? q.scale.maxLabel : String(n) }))
        : q.options.map((o) => ({ id: o.id, label: o.label }));
  return q.na ? [...list, { id: 'na', label: q.na }] : list;
}


const TOPICS = AXES.slice(1);
const manifest = {
  axes: AXES.map(({ id, label }) => ({ id, label })),
  questions: {},
  cohorts: counties.flatMap((c) => AGES.map((a) => `${c.code}/${a}`)),
  topics: TOPICS.map((a) => a.id), // what the first question offers: every axis but "Viața ta"
};
for (const q of questions) {
  const choices = choicesOf(q);
  manifest.questions[q.id] = {
    domain: q.domain,
    tier: q.tier,
    type: q.type,
    text: q.text,
    ...(q.maxSelect && { maxSelect: q.maxSelect }),
    ...(q.scale && { scale: q.scale }),
    axis: axisOf(q.domain),
    ...(q.measures && { measures: q.measures }),
    ...(q.profile && { profile: true }),
    ...(q.group && { group: q.group }),
    ...(q.where && { where: q.where }),
    ...(q.outlook && { outlook: q.outlook }),
    choices: choices.map((c) => ({ id: c.id, label: c.label })),
  };
}

const out = process.argv.includes('--preview') ? '../.cache/quiz-preview.json' : '../src/data/quiz.json';
mkdirSync(here('../.cache'), { recursive: true });
writeFileSync(here(out), JSON.stringify(manifest));
console.log(`${Object.keys(manifest.questions).length} questions · manifest ${out.replace('../', '')}`);

