// A made-up result for designing the results page without the database. Only served by the dev server
// at /r/demo. Query params switch scenarios:
//   ?cohort=0   too few people of your age in your county to compare
//   ?all=1      every area open (by default: Viața ta and three topics, the rest locked)
//   ?c=B&a=65+   another place / age
//   ?other=1    seen by someone else (not your result)
import type { Result } from './quiz-server';

const AXES = [
  { id: 'viata', label: 'Viața ta', you: 62, cohort: 55, ro: 51 },
  { id: 'bani', label: 'Bani și trai', you: 38, cohort: 44, ro: 41 },
  { id: 'munca', label: 'Muncă', you: 71, cohort: 58, ro: 49 },
  { id: 'sanatate', label: 'Sănătate', you: 25, cohort: 36, ro: 33 },
  { id: 'educatie', label: 'Educație', you: 50, cohort: 47, ro: 45 },
  { id: 'stat', label: 'Stat și justiție', you: 19, cohort: 27, ro: 30 },
  { id: 'infra', label: 'Infrastructură și mediu', you: 44, cohort: 52, ro: 39 },
  { id: 'siguranta', label: 'Siguranță și încredere', you: 66, cohort: 61, ro: 58 },
  { id: 'local', label: 'Localitatea ta', you: 74, cohort: 63, ro: 47 },
];

const mean = (v: number[]) => Math.round(v.reduce((a, b) => a + b, 0) / v.length);

export function mockResult(params: URLSearchParams): Result {
  const withCohort = params.get('cohort') !== '0';
  const open = params.get('all') ? AXES.map((a) => a.id) : ['viata', 'bani', 'sanatate', 'stat'];
  return {
    county: params.get('c') ?? 'CJ',
    age: params.get('a') ?? '25-34',
    finished: true,
    axes: AXES.map((a) => ({
      ...a,
      open: open.includes(a.id),
      answered: open.includes(a.id) ? 5 : a.id === 'munca' ? 2 : 0,
      you: open.includes(a.id) ? a.you : null,
      cohort: withCohort ? a.cohort : null,
    })),
    people: { cohort: withCohort ? 128 : 2, ro: 5312 },
    score: { you: mean(AXES.map((a) => a.you)), cohort: withCohort ? mean(AXES.map((a) => a.cohort)) : null, ro: mean(AXES.map((a) => a.ro)) },
  };
}
