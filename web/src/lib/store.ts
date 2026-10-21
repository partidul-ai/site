// The quiz's storage: Cloudflare D1 (binding DB), a SQLite database created with
// --jurisdiction=eu, so it runs and keeps its data only in the European Union. Tables in
// migrations/0001_init.sql. Every write that touches more than one row is one batch, which D1 runs
// as a transaction. The averages are SQL aggregates over the rows, never running sums, so two
// visitors finishing at once can't overwrite each other's update.
import { env } from 'cloudflare:workers';

/** A stored answer. picked: the choice ids, [] for a skipped question. */
export type StoredAnswer = { qid: string; picked: string[]; probe: boolean };
export type StoredSession = {
  id: string;
  county: string;
  age: string;
  uuid: string;
  topics: string[] | null; // axis ids, in pick order
  finished: boolean;
  pending: string | null; // the token of the question the session waits on (quiz-server.ts answer)
  answers: StoredAnswer[]; // in the order they were given (sessions from before 2026-10-20: no order)
};
/** An answer to save. picked null: skipped. axis and outlook as in quiz.json (outlook null when
 *  the answer has none). */
export type NewAnswer = { qid: string; picked: string[] | null; probe: boolean; axis: number; outlook: number | null };
/** A session's expected score per axis (null where it has none), or null: leave them as they are. */
export type Expected = (number | null)[] | null;
/** Sums for one comparison line, per axis: the answers' outlooks and the sessions' expected scores. */
export type Totals = { sum: number[]; count: number[]; esum: number[]; ecount: number[] };

const db = () => env.DB;
// Times are kept to the day (UTC), not the moment: an answer's exact time could tie it to a person
// who said when they took the quiz.
const DAY = 24 * 60 * 60 * 1000;
const today = () => Date.now() - (Date.now() % DAY);
// Answers one session can hold: the quiz, then every area's rounds with room for skips. Only a
// replayed token could go past it (quiz-server.ts answer); this is the backstop.
export const MAX_ANSWERS = 120;

/** A new session's id: 16 hex characters (64 random bits), the result's id in its URL. */
function newId() {
  const b = crypto.getRandomValues(new Uint8Array(8));
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export async function createSession(county: string, age: string, arm: (uuid: string) => string): Promise<string> {
  const id = newId();
  const uuid = crypto.randomUUID();
  await db()
    .prepare('INSERT INTO sessions (id, county, age, uuid, arm, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, county, age, uuid, arm(uuid), today())
    .run();
  return id;
}

/** The session with its answers, or null if there is none. */
export async function loadSession(id: string): Promise<StoredSession | null> {
  const [s, a] = await db().batch([
    db().prepare('SELECT id, county, age, uuid, topics, finished_at, pending FROM sessions WHERE id = ?').bind(id),
    db().prepare('SELECT qid, choices, probe FROM answers WHERE session_id = ? ORDER BY step, rowid').bind(id),
  ]);
  const row = s.results[0] as { id: string; county: string; age: string; uuid: string; topics: string | null; finished_at: number | null; pending: string | null } | undefined;
  if (!row) return null;
  return {
    id: row.id,
    county: row.county,
    age: row.age,
    uuid: row.uuid,
    topics: row.topics ? JSON.parse(row.topics) : null,
    finished: row.finished_at !== null,
    pending: row.pending,
    answers: (a.results as { qid: string; choices: string | null; probe: number }[]).map((r) => ({
      qid: r.qid,
      picked: r.choices ? JSON.parse(r.choices) : [],
      probe: !!r.probe,
    })),
  };
}

export async function setTopics(id: string, topics: string[]) {
  await db().prepare('UPDATE sessions SET topics = ? WHERE id = ?').bind(JSON.stringify(topics), id).run();
}

/** The question the session now waits on: its token, or null for none. */
export async function setPending(id: string, token: string | null) {
  await db().prepare('UPDATE sessions SET pending = ? WHERE id = ?').bind(token, id).run();
}

/** Take the session's waiting question if it is still `token`'s, so of two requests with the same
 *  token only one goes on to the next question. false: it was already taken. */
export async function claimPending(id: string, token: string): Promise<boolean> {
  const r = await db().prepare('UPDATE sessions SET pending = NULL WHERE id = ? AND pending = ?').bind(id, token).run();
  return r.meta.changes > 0;
}

/** Replace the session's expected scores (statements for a batch; none if `x` is null). */
function expectedStatements(id: string, x: Expected) {
  if (!x) return [];
  const rows = x.flatMap((s, axis) => (s === null ? [] : [[id, axis, s]]));
  return [
    db().prepare('DELETE FROM expected WHERE session_id = ?').bind(id),
    ...(rows.length ? [db().prepare(`INSERT INTO expected (session_id, axis, score) VALUES ${rows.map(() => '(?, ?, ?)').join(', ')}`).bind(...rows.flat())] : []),
  ];
}

/** Save an answer (again: it overwrites the first, keeping its place), and with it the session's new
 *  expected scores if given. One transaction. false: the session already holds MAX_ANSWERS, nothing
 *  saved. */
export async function saveAnswer(id: string, a: NewAnswer, expected: Expected = null): Promise<boolean> {
  const [r] = await db().batch([
    db()
      .prepare(
        `INSERT INTO answers (session_id, qid, choices, step, probe, axis, outlook, answered_at)
         SELECT ?1, ?2, ?3, (SELECT COALESCE(MAX(step), 0) + 1 FROM answers WHERE session_id = ?1), ?4, ?5, ?6, ?7
         WHERE (SELECT COUNT(*) FROM answers WHERE session_id = ?1) < ?8
         ON CONFLICT (session_id, qid) DO UPDATE SET choices = excluded.choices, outlook = excluded.outlook,
           probe = MAX(probe, excluded.probe), answered_at = excluded.answered_at`,
      )
      .bind(id, a.qid, a.picked && JSON.stringify(a.picked), a.probe ? 1 : 0, a.axis, a.outlook, today(), MAX_ANSWERS),
    ...expectedStatements(id, expected),
  ]);
  return r.meta.changes > 0;
}

/** Mark the session finished (once: a replay keeps the first time) and store its expected scores.
 *  From then on its answers and expected scores count in the averages. One transaction. */
export async function finishSession(id: string, expected: Expected) {
  await db().batch([
    db().prepare('UPDATE sessions SET finished_at = COALESCE(finished_at, ?), pending = NULL WHERE id = ?').bind(today(), id),
    ...expectedStatements(id, expected),
  ]);
}

/** Delete the session and all it holds, so it leaves the averages too. false: there was none. */
export async function deleteSession(id: string): Promise<boolean> {
  const [, , s] = await db().batch([
    db().prepare('DELETE FROM expected WHERE session_id = ?').bind(id),
    db().prepare('DELETE FROM answers WHERE session_id = ?').bind(id),
    db().prepare('DELETE FROM sessions WHERE id = ?').bind(id),
  ]);
  return s.meta.changes > 0;
}

export type Averages = { ro: Totals; county: Totals; people: { ro: number; county: number } };

// Every results page view needs the averages, and they change slowly: each Worker instance keeps
// them a minute per county. A new or deleted result shows in them within that.
const AVERAGES_TTL = 60_000;
const recent = new Map<string, { at: number; value: Promise<Averages> }>();

/** The comparison lines, over the finished sessions: Romania's and `county`'s (all its ages), each
 *  with how many people it has, at most a minute old. `axes`: how many axes there are. */
export function averages(county: string, axes: number): Promise<Averages> {
  const hit = recent.get(county);
  if (hit && Date.now() - hit.at < AVERAGES_TTL) return hit.value;
  const value = computeAverages(county, axes);
  recent.set(county, { at: Date.now(), value });
  value.catch(() => recent.delete(county)); // a failed read isn't kept
  return value;
}

async function computeAverages(county: string, axes: number): Promise<Averages> {
  const [ans, exp, ppl] = await db().batch([
    db()
      .prepare(
        `SELECT a.axis, SUM(a.outlook) AS ro_sum, COUNT(a.outlook) AS ro_n,
           SUM(CASE WHEN s.county = ?1 THEN a.outlook END) AS c_sum, COUNT(CASE WHEN s.county = ?1 THEN a.outlook END) AS c_n
         FROM answers a JOIN sessions s ON s.id = a.session_id
         WHERE s.finished_at IS NOT NULL AND a.outlook IS NOT NULL GROUP BY a.axis`,
      )
      .bind(county),
    db()
      .prepare(
        `SELECT e.axis, SUM(e.score) AS ro_sum, COUNT(*) AS ro_n,
           SUM(CASE WHEN s.county = ?1 THEN e.score END) AS c_sum, COUNT(CASE WHEN s.county = ?1 THEN 1 END) AS c_n
         FROM expected e JOIN sessions s ON s.id = e.session_id
         WHERE s.finished_at IS NOT NULL GROUP BY e.axis`,
      )
      .bind(county),
    db().prepare('SELECT COUNT(*) AS ro, COUNT(CASE WHEN county = ? THEN 1 END) AS county FROM sessions WHERE finished_at IS NOT NULL').bind(county),
  ]);
  const empty = (): Totals => ({ sum: Array(axes).fill(0), count: Array(axes).fill(0), esum: Array(axes).fill(0), ecount: Array(axes).fill(0) });
  const ro = empty(), here = empty();
  type Row = { axis: number; ro_sum: number | null; ro_n: number; c_sum: number | null; c_n: number };
  for (const r of ans.results as Row[]) {
    if (r.axis >= axes) continue;
    (ro.sum[r.axis] = r.ro_sum ?? 0), (ro.count[r.axis] = r.ro_n), (here.sum[r.axis] = r.c_sum ?? 0), (here.count[r.axis] = r.c_n);
  }
  for (const r of exp.results as Row[]) {
    if (r.axis >= axes) continue;
    (ro.esum[r.axis] = r.ro_sum ?? 0), (ro.ecount[r.axis] = r.ro_n), (here.esum[r.axis] = r.c_sum ?? 0), (here.ecount[r.axis] = r.c_n);
  }
  const p = ppl.results[0] as { ro: number; county: number };
  return { ro, county: here, people: { ro: p.ro, county: p.county } };
}
