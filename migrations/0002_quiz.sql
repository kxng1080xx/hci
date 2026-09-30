-- Live quiz: everyone answers the same question at the same time; the host moves the quiz on.
CREATE TABLE quiz_players (
  pid TEXT PRIMARY KEY,
  nickname TEXT NOT NULL,
  avatar TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

-- First answer counts: (pid, q) is the key and inserts use OR IGNORE.
CREATE TABLE quiz_answers (
  pid TEXT NOT NULL,
  q INTEGER NOT NULL,
  choice INTEGER NOT NULL CHECK (choice BETWEEN 0 AND 3),
  correct INTEGER NOT NULL CHECK (correct IN (0, 1)),
  points INTEGER NOT NULL,
  ms INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (pid, q)
);

-- Single row. phase is 'lobby', 'question' or 'final'; the ready and reveal sub-phases come from the clock.
CREATE TABLE quiz_state (
  id INTEGER PRIMARY KEY CHECK (id = 1),
  phase TEXT NOT NULL CHECK (phase IN ('lobby', 'question', 'final')),
  q INTEGER NOT NULL,
  started_at INTEGER NOT NULL
);
INSERT INTO quiz_state (id, phase, q, started_at) VALUES (1, 'lobby', -1, 0);
