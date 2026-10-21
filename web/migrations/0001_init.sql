-- The quiz's storage (src/lib/store.ts). D1 database "partidul-ai", created with
-- --jurisdiction=eu: it runs and keeps its data only in the European Union.

-- One row per quiz session. id is the result's id (/r/<id>, and in the browser's signed token).
-- uuid's first byte fixes the arm (quiz-server.ts armOf); arm is that, written down for queries.
-- topics: the 3 picked areas as a JSON array of axis ids, in pick order (null until picked).
-- finished_at: set once, when the quiz ends; from then on the session counts in the averages.
-- Sessions from before 2026-10-20, copied from the previous store: created_at null,
-- finished_at the time of the copy.
-- Deleting a result deletes its row and everything below in one transaction.
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  county TEXT NOT NULL,
  age TEXT NOT NULL,
  uuid TEXT NOT NULL,
  arm TEXT NOT NULL,
  topics TEXT,
  created_at INTEGER,
  finished_at INTEGER
);
CREATE INDEX sessions_finished ON sessions (finished_at, county);

-- One row per question asked and answered (or skipped) in a session.
-- choices: the picked choice ids as a JSON array, null when skipped.
-- step, answered_at: the answer's order in its session (1, 2, …) and time; null for sessions copied
--   from before 2026-10-20, whose store kept neither.
-- probe: 1 if the question was a probe (control and experiment arms; quiz-server.ts header).
-- axis, outlook: copied from quiz.json when answered (outlook: the answer's -1..1 value, null if
--   the question isn't scored or the answer was "doesn't apply" or a skip), so the averages are
--   one SQL aggregate.
CREATE TABLE answers (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  qid TEXT NOT NULL,
  choices TEXT,
  step INTEGER,
  probe INTEGER NOT NULL DEFAULT 0,
  axis INTEGER NOT NULL,
  outlook REAL,
  answered_at INTEGER,
  PRIMARY KEY (session_id, qid)
);

-- A finished session's "you" score per open area (the panel's expected outlook, -1..1), what the
-- comparison lines average. Rewritten whole when the session finishes and after each round answer.
CREATE TABLE expected (
  session_id TEXT NOT NULL REFERENCES sessions (id) ON DELETE CASCADE,
  axis INTEGER NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (session_id, axis)
);
