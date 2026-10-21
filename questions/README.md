# Întrebări

The question pool for the quiz, generated from [`wiki/`](../wiki/README.md). One file per wiki page: `questions/<domain>.jsonl`, one question per line. Check files with:

```sh
node questions/validate.mjs                           # all files
node questions/validate.mjs questions/sanatate.jsonl  # one file
```

## What the quiz is

An anonymous opinion survey. A visitor picks a județ (or Diaspora) and an age range (18–24, 25–34, 35–44, 45–54, 55–64, 65+), then answers 20 questions. Answers are aggregated per county and age range: "what people in Cluj are happy and unhappy with". It is not a knowledge quiz and not a poll about parties.

Every question is **general**: it makes sense in any county, and in the diaspora where relevant (otherwise `na` covers it).

## Tiers

- **core**: the best ~12–15 per domain. Asked often, they feed the county map and the results page. Broad, answerable by nearly everyone, comparable across counties.
- **pool**: everything else that follows the rules. Depth on a topic; the recommender learns which are worth asking.

## Rules

Every question follows the rules in [QUIZ.md](QUIZ.md).

## Schema

```jsonc
{
  "id": "sanatate-001",              // <domain>-<3 digits>, unique
  "domain": "sanatate",              // wiki page slug
  "tier": "core",                    // core | pool
  "type": "single",                  // single | multi | scale | yesno | ranking | budget | text
  "measures": "experience",          // experience | satisfaction | priority | trend | tradeoff | expectation | trust | opinion
  "topic": "medic-de-familie",       // short kebab-case slug, for grouping and dedup
  "text": "Cât de mulțumit(ă) ești de medicul tău de familie?",
  "options": [{ "id": "a", "label": "…" }],   // single, multi, ranking, budget: 2–8 options
  "maxSelect": 3,                    // multi only (optional)
  "scale": { "minLabel": "Deloc mulțumit(ă)", "maxLabel": "Foarte mulțumit(ă)" },  // scale only; always 1–5
  "budget": { "total": 100, "unit": "lei" },  // budget only: split the total across options
  "na": "Nu am medic de familie",    // label of the "doesn't apply" answer, or null if everyone can answer
  "ageRanges": null,                 // null = everyone; or a subset like ["55-64", "65+"]
  "profile": true,                   // optional: a fact about you other questions build on (see below)
  "group": "ue",                     // optional: same thing asked another way (see below)
  "where": "romania",                // optional: only residents ("romania") or only the diaspora ("diaspora") can answer it; absent: anyone (see below)
  "wiki": { "section": "Ce nu merge", "sources": [3, 5] },  // H2 heading in the wiki page; numbers from its Surse list
  "rationale": "One sentence: what this reveals and why it matters."
}
```

`yesno` has no `options` (it's Da / Nu, plus `na` if set). `text` has no `options`.

### `profile`, `group` and `where` (for the quiz's schedule)

- **`profile: true`** marks a fact about the respondent that other questions in the same area build on: education level, employment, children, housing, type of locality. The quiz asks an area's profile questions before anything else in it, so nobody is asked about their job before being asked whether they have one. A profile question has no `outlook`, and an `na` like "Prefer să nu spun" if nothing else lets you opt out.
- **`group`** (kebab-case) ties together questions that respondents read as the same question in other words ("is the EU good for Romania" / "for you"). The quiz asks at most one question of a group. A group needs two or more questions.
- **`where`** says who can answer it truthfully about their own life: `"romania"` for residents only (their locality, county, local services, Romanian bills and taxes, amounts in lei, their job market here), `"diaspora"` for people living abroad only (life and work abroad, remittances, returning). Absent: anyone, including opinions about Romania, which someone abroad holds too. The quiz never shows a Diaspora session a `"romania"` question, or a resident a `"diaspora"` one. When unsure, leave it out.

### `outlook` (for the results chart)

Optional. Present only on **evaluative** questions: ones whose answers say how well things are going, for the respondent or the country, in this question's area. It maps every non-`na` choice id to one of `-1, -0.5, 0, 0.5, 1`:

- `1`: things are going well (satisfied, trusting, not worried, good experience, improving)
- `-1`: things are going badly (dissatisfied, distrustful, worried, bad experience, worsening, had to pay a bribe, went without care)
- `0`: neutral or mixed ("nici bine, nici rău", "la fel", "nu știu")

Choice ids are the option ids; `yesno` uses `da` / `nu`; `scale` uses `"1"`…`"5"`. Leave `outlook` out for questions that are preferences or plain behaviour, not verdicts: priorities, budget splits, rankings, policy trade-offs ("taxes vs services"), how you travel, where you get news, free text. When in doubt, leave it out.

```jsonc
"outlook": { "1": -1, "2": -0.5, "3": 0, "4": 0.5, "5": 1 }   // "Cât de mulțumit(ă) ești de…?"
"outlook": { "a": -1, "b": -1, "c": -0.5, "d": 1 }              // "Ți s-au cerut bani…?" (d = "Nu")
```

