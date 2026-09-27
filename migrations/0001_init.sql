CREATE TABLE participants (
  id TEXT PRIMARY KEY,
  nickname TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);

-- One row per participant per round; resubmitting replaces the answer, so retries never double count.
CREATE TABLE responses (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  pid TEXT NOT NULL,
  round INTEGER NOT NULL CHECK (round BETWEEN 1 AND 4),
  design TEXT NOT NULL CHECK (design IN ('bad', 'good')),
  task TEXT NOT NULL CHECK (task IN ('signup', 'payment')),
  feeling INTEGER NOT NULL CHECK (feeling BETWEEN 1 AND 5),
  words TEXT NOT NULL DEFAULT '[]',
  comment TEXT NOT NULL DEFAULT '',
  attempts INTEGER NOT NULL,
  seconds INTEGER NOT NULL,
  skipped INTEGER NOT NULL CHECK (skipped IN (0, 1)),
  created_at INTEGER NOT NULL,
  UNIQUE (pid, round)
);
