-- pending: the signed token of the question the session waits on, null when it waits on none. Only
-- that token can add an answer (quiz-server.ts answer), so an older token can't be sent again to
-- answer questions past the quiz's 20.
ALTER TABLE sessions ADD COLUMN pending TEXT;

-- Times are kept to the day (UTC midnight, in ms), not the moment: an answer's exact time could tie
-- it to a person who said when they took the quiz.
UPDATE sessions SET created_at = created_at - created_at % 86400000 WHERE created_at IS NOT NULL;
UPDATE sessions SET finished_at = finished_at - finished_at % 86400000 WHERE finished_at IS NOT NULL;
UPDATE answers SET answered_at = answered_at - answered_at % 86400000 WHERE answered_at IS NOT NULL;
