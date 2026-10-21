# partidul.ai

An anonymous survey about life in Romania. Pick your județ (or Diaspora) and age range, pick 3 topics, answer 20 questions about what works and what doesn't, see how your answers compare.

Not a political party.

Live at [partidul.ai](https://partidul.ai).

## Running it

```sh
cd web && npm install
npm run dev      # http://localhost:4321
npm run build    # build into web/dist
```

The root `package.json` forwards `dev` and `build` to `web/`, so they also work from the repo root.

`npm run build` first runs `web/scripts/build-og.mjs`, which renders the social preview images (`public/og/`: one for the site, one for the wiki, one per wiki page, from its title) and the app icons (`public/icons/`). Both folders are generated, not committed; `npm run og` regenerates them on their own.

## Layout

| Path | What |
| --- | --- |
| `web/` | The site: Astro + React islands + Tailwind, deployed as a Cloudflare Worker |
| `web/src/components/Hero.tsx` | Landing page: headline, map, age and county pickers |
| `web/src/components/DotMap.tsx` | Canvas dot map of Romania; Diaspora is its own cluster |
| `web/src/data/counties.ts` | The 41 județe, București and Diaspora, with plate codes and NUTS3 ids |
| `web/src/data/dots.ts` | Generated dot grid — see below |
| `web/src/pages/quiz.astro`, `web/src/components/Quiz.tsx` | The quiz, at `/quiz`; continues the session the start button created (step, county and age in sessionStorage) |
| `web/src/lib/quiz-server.ts`, `web/src/lib/store.ts`, `web/src/pages/api/` | Quiz backend and its storage (see below) |
| `web/migrations/` | The D1 database's tables |
| `web/src/data/quiz.json` | Manifest written by `npm run quiz:sync`: questions, choices, areas, cohorts, topics |
| `questions/` | The question pool, one JSONL file per wiki page — spec in [`questions/README.md`](questions/README.md) |
| `web/src/styles/global.css` | Theme tokens for light and dark |

## Regenerating the map

`dots.ts` is built from Eurostat's NUTS3 boundaries (in Romania, NUTS3 = județe):

```sh
curl -o nuts3.geojson https://gisco-services.ec.europa.eu/distribution/v2/nuts/geojson/NUTS_RG_10M_2024_4326_LEVL_3.geojson
node web/scripts/build-dots.mjs nuts3.geojson
```

Boundaries © EuroGeographics — the credit in the footer is required by the licence.

## Quiz backend

The Worker is stateless; [Cloudflare D1](https://developers.cloudflare.com/d1/) stores the sessions and their answers. The database (`partidul-ai`) was created with `--jurisdiction=eu`, so it runs and keeps its data only in the European Union (the privacy page says so; a jurisdiction can only be set when a database is created). `quiz.json` is the only source of the questions. The questions are picked, and the results page's own scores computed, from a panel of synthetic personas shipped as static assets (below).

- **Tables** (`web/migrations/`, read and written only through `lib/store.ts`). `sessions`: one row per quiz (id = the result id in `/r/<id>`, county, age, uuid, arm, the 3 topics in pick order, the day it was created and finished, the token of the question it waits on). `answers`: one row per question asked (the picked choice ids, none for a skip; its order in the session and the day; whether it was a probe; its area and outlook, copied from `quiz.json`), at most 120 per session. Times are kept to the day, not the moment, so an answer can't be tied to someone who said when they took the quiz. `expected`: a finished session's "you" score per open area. Several-row writes (an answer with its expected scores, finishing, deleting) are one batch, which D1 runs as a transaction.
- **Topics.** The first question is a pick: exactly 3 of the 8 topics, stored with the session, a prior for everything after. Then come 5 general questions (an opener, then others from romania-pe-scurt), so everyone gets a broad read, then 5 from each topic, rotating in the order they were picked: 21 steps in all, the topic pick and 20 questions.
- **Picks.** Within the pool the schedule gives (opener, scored questions first, the turn's area), `lib/panel.ts` weights 1,144 synthetic personas (`public/panel/`, built offline) by your county, age, topics and answers. It samples the question whose answer would tell most about you (information gain). The same weights give your score per area: the expected outlook of the people most like you. Without the panel files, picks are random and scores are plain means. `node --test web/src/lib/panel.test.ts` checks it against the offline builder's reference scenarios; `node web/scripts/quiz-e2e.mjs [base] [runs] [--delete] [--report]` plays whole quizzes through the API and checks what the database holds (`ARM=all` covers every arm, `COUNTY=DIASPORA` the diaspora rules).
- **Arms and probes.** Every session is in the experiment arm: the panel's picks, but each area's last question random (steps 5, 18, 19, 20 and each extra round's fifth). Those last-of-area questions are marked as probes in `answers`. Until 2026-10-21, 1/16 of sessions were control (every question random) and 14/16 regular (nothing random); their stored arm says which. Predicting them from the other answers measures any model's accuracy offline, areas weighted by size for the full pool, and comparing the two arms measures the picks: `node web/scripts/ab-report.mjs` (live database; `--local` for dev's). Nothing random leaves the schedule's area.
- **Averages.** The results page's lines for your county and for Romania are SQL aggregates over the finished sessions: the mean of their "you" scores per area (`expected`), or, while fewer than 3 people have one there, the mean outlook of their answers. Each Worker instance keeps them a minute per county. Nothing keeps running sums, so concurrent quizzes can't lose each other's updates, and deleting a session takes it out of every average.
- **Bots.** Starting a session needs a Cloudflare Turnstile token (`lib/turnstile-client.ts`, checked in `lib/turnstile.ts`; invisible unless Cloudflare wants a box ticked) issued on partidul.ai, and is limited to 10 a minute per IP, an IPv6 one by its /64 (`SESSION_LIMIT` in `wrangler.jsonc`). IPs are never stored, and per-request logs are off. Request bodies over 16 KB are turned down.
- **Tokens.** The browser only ever holds an HMAC-signed token for its own session and current question. Only the token of the question the session waits on can answer, once; any other (the same request sent twice, a tab left open, an older token) gets that waiting question back, so nobody can answer more than the quiz asks. A waiting question never expires. Finishing the quiz or a round puts a separate owner token in an HttpOnly, Secure, SameSite=Lax cookie (`quiz-owner`, no end date: the server never expires it, and `/api/me` sets it again on every visit since browsers cap cookies at 400 days): it marks the result as yours for unlocking areas and deleting it, in any tab. The home page links back to it through `GET /api/me`, which answers with the result id only while that result still exists.

```sh
npm run quiz:sync   # write src/data/quiz.json from questions/ (--preview: .cache/quiz-preview.json instead)
npm run db:local    # create or migrate the dev server's local database (.wrangler/state)
npx wrangler d1 execute partidul-ai --remote --command "SELECT COUNT(*) FROM sessions WHERE finished_at IS NOT NULL"
```

Local secrets live in `web/.dev.vars` (`TOKEN_SECRET`, `TURNSTILE_SECRET`; in dev, Turnstile's test secret `1x0000000000000000000000000000000AA`); production ones are Worker secrets (`npx wrangler secret put …`). Run `quiz:sync` after changing the question pool and commit `quiz.json` with it; the deploy checks that they match.

## Deployment

Cloudflare Worker `partidul-ai`, serving `partidul.ai` and `www.partidul.ai` (custom domains in `web/wrangler.jsonc`).

Security headers (HSTS, a report-only Content Security Policy, no framing) come from `web/public/_headers` for the static pages and `web/src/middleware.ts` for the rest.

Every push to `main` deploys through GitHub Actions ([`.github/workflows/deploy.yml`](.github/workflows/deploy.yml)): it validates the question pool, checks that `quiz.json` matches `questions/`, runs the panel tests, builds, applies new D1 migrations, then deploys. **Run workflow** on the Actions tab redeploys `main` by hand. It needs two repository secrets: `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. Wrangler's output stays out of the public log; a failure shows only its error lines, with emails and account names blanked out.
