// Live quiz, Kahoot style. The server owns the clock and the answer key:
// phones never learn the correct answer until the question has closed.
import { PID, clean } from './validate.js';
import { json, readJson, limited, isAdmin } from './http.js';

export const QUESTIONS = [
  {
    text: 'In HCI, automatic emotions (affect) are best described as:',
    options: [
      'Slow, deliberate judgments made after reflection',
      'Fast, unconscious reactions, such as being startled',
      'Feelings a user reports in a survey',
      'Emotions that only develop after repeated use',
    ],
    answer: 1,
    why: 'Affect is fast and automatic, like jumping at a sudden loud noise.',
  },
  {
    text: 'A user names their robot vacuum "Rover" and talks to it like a pet. This is an example of:',
    options: ['Affective computing', 'Visceral design', 'Indirect emotion detection', 'Anthropomorphism'],
    answer: 3,
    why: 'Anthropomorphism means giving human or animal qualities to objects.',
  },
  {
    text: "In Don Norman's model of emotional design, which level deals with usability, performance, and how well a product helps a user complete a task?",
    options: ['Visceral', 'Reflective', 'Behavioral', 'Automatic'],
    answer: 2,
    why: 'The behavioral level is about use: usability, performance and function.',
  },
  {
    text: "Robert Plutchik's wheel of emotions organizes emotions by:",
    options: [
      'Their relationships, intensities, and polar opposites',
      'How often people feel them each day',
      'The part of the brain that produces them',
      'The order in which children learn them',
    ],
    answer: 0,
    why: 'The wheel shows how emotions relate, how intense they are, and their opposites.',
  },
  {
    text: "Duolingo's owl mascot reacting to a user's success or failure is an example of:",
    options: ['A phishing technique', 'Passive sensing', 'Sustainable HCI', 'An expressive interface'],
    answer: 3,
    why: 'Expressive interfaces use characters, animation and sound to convey emotion.',
  },
  {
    text: "BiAffect estimates a user's mood from keystroke speed, accuracy, and backspace rate. This is an example of:",
    options: ['Indirect emotion detection', 'Self report', 'Emotional icons', 'Reflective design'],
    answer: 0,
    why: 'Mood is inferred from typing behaviour, without asking the user.',
  },
  {
    text: 'A message reads "Your account will be suspended. Act now!" Which emotions is this phishing attempt mainly exploiting?',
    options: ['Curiosity and trust', 'Fear and urgency', 'Joy and anticipation', 'Boredom and distraction'],
    answer: 1,
    why: 'Threats and deadlines trigger fear and urgency, so people act before they think.',
  },
  {
    text: 'Which of these is a feature of a well designed error message?',
    options: [
      'It shows a code such as "Error 51"',
      'It uses bright red alerts to grab attention',
      'It explains the problem in plain language and suggests a specific fix',
      'It clears the form so the user can start fresh',
    ],
    answer: 2,
    why: 'Good error messages are plain, specific and constructive.',
  },
];

export const LIMIT_MS = 20_000; // answering time per question
export const READY_MS = 4_000; // "get ready" countdown before answers open
export const AVATARS = ['🦊', '🐼', '🐸', '🐙', '🦉', '🐯', '🐨', '🦄', '🐧', '🐢', '🦁', '🐝', '🐳', '🦖', '🐵', '🐰'];

// Kahoot's formula: a correct answer is worth 1000 at 0 s, falling to 500 at the buzzer.
export const points = (ms) => Math.round(1000 * (1 - Math.min(Math.max(ms, 0), LIMIT_MS) / LIMIT_MS / 2));

// The stored phase plus the clock gives what players see right now.
export function phaseAt(st, now, answered, players) {
  if (st.phase !== 'question') return st.phase;
  if (now < st.started_at) return 'ready';
  if (now >= st.started_at + LIMIT_MS || (players > 0 && answered >= players)) return 'reveal';
  return 'question';
}

export function validateJoin(b) {
  if (!b || typeof b.pid !== 'string' || !PID.test(b.pid)) return 'bad pid';
  const nickname = clean(b.nickname, 20);
  if (!nickname) return 'nickname required';
  if (!AVATARS.includes(b.avatar)) return 'unknown avatar';
  return { pid: b.pid, nickname, avatar: b.avatar };
}

export function validateAnswer(b) {
  if (!b || typeof b.pid !== 'string' || !PID.test(b.pid)) return 'bad pid';
  if (!Number.isInteger(b.q) || b.q < 0 || b.q >= QUESTIONS.length) return 'bad question';
  if (!Number.isInteger(b.choice) || b.choice < 0 || b.choice > 3) return 'bad choice';
  return { pid: b.pid, q: b.q, choice: b.choice };
}

// Answers to the current question count only once it is revealed, so scores can't leak who got it right.
const PLAYERS_SQL = `
  SELECT p.pid, p.nickname, p.avatar,
    COALESCE(SUM(CASE WHEN a.q < s.q THEN a.points END), 0) AS prev,
    MAX(CASE WHEN a.q = s.q THEN a.choice END) AS choice,
    MAX(CASE WHEN a.q = s.q THEN a.points END) AS pts,
    MAX(CASE WHEN a.q = s.q THEN a.correct END) AS correct
  FROM quiz_players p CROSS JOIN quiz_state s LEFT JOIN quiz_answers a ON a.pid = p.pid
  WHERE s.id = 1
  GROUP BY p.pid
  ORDER BY p.created_at`;

async function load(env) {
  const [st, players] = await env.DB.batch([
    env.DB.prepare('SELECT phase, q, started_at FROM quiz_state WHERE id = 1'),
    env.DB.prepare(PLAYERS_SQL),
  ]);
  return { st: st.results[0], players: players.results };
}

const rankBy = (list, key) => {
  const sorted = [...list].sort((a, b) => b[key] - a[key]);
  return (p) => 1 + sorted.findIndex((x) => x[key] === p[key]); // ties share a rank
};

async function state(req, env) {
  const now = Date.now();
  const { st, players } = await load(env);
  const answered = players.filter((p) => p.choice != null).length;
  const phase = phaseAt(st, now, answered, players.length);
  const revealed = phase === 'reveal' || phase === 'final';
  const Q = QUESTIONS[st.q];

  for (const p of players) p.score = p.prev + (revealed ? p.pts || 0 : 0);
  const rank = rankBy(players, 'score'), prevRank = rankBy(players, 'prev');

  const out = {
    now, phase, q: st.q, total: QUESTIONS.length, limit: LIMIT_MS,
    startAt: st.started_at, endsAt: st.started_at + LIMIT_MS,
    players: players.length, answered,
    question: Q && phase !== 'lobby' ? { text: Q.text, options: Q.options } : null,
    me: null,
  };
  // Scores here hide the open question's points, and "answered" says nothing about right or wrong.
  out.roster = players.slice(-100).map((p) => ({ nickname: p.nickname, avatar: p.avatar, score: p.score, answered: p.choice != null }));
  if (revealed && Q) {
    out.correct = Q.answer;
    out.why = Q.why;
    out.counts = [0, 1, 2, 3].map((i) => players.filter((p) => p.choice === i).length);
  }
  if (revealed) {
    out.leaders = [...players].sort((a, b) => b.score - a.score).slice(0, 10)
      .map((p) => ({ nickname: p.nickname, avatar: p.avatar, score: p.score, gained: p.pts || 0 }));
  }

  const pid = new URL(req.url).searchParams.get('pid');
  const me = pid && players.find((p) => p.pid === pid);
  if (me) {
    out.me = {
      nickname: me.nickname, avatar: me.avatar, score: me.score, answered: me.choice != null,
      rank: revealed ? rank(me) : prevRank(me), prevRank: prevRank(me),
      ...(revealed ? { choice: me.choice, correct: me.correct === 1, points: me.pts || 0 } : {}),
    };
  }
  return json(out);
}

async function join(req, env) {
  const r = validateJoin(await readJson(req));
  if (typeof r === 'string') return json({ error: r }, 400);
  if (await limited(env, r.pid)) return json({ error: 'slow down' }, 429);
  await env.DB.prepare(
    `INSERT INTO quiz_players (pid, nickname, avatar, created_at) VALUES (?1, ?2, ?3, ?4)
     ON CONFLICT (pid) DO UPDATE SET nickname = excluded.nickname, avatar = excluded.avatar`
  ).bind(r.pid, r.nickname, r.avatar, Date.now()).run();
  return json({ ok: true });
}

async function answer(req, env) {
  const r = validateAnswer(await readJson(req));
  if (typeof r === 'string') return json({ error: r }, 400);
  if (await limited(env, r.pid)) return json({ error: 'slow down' }, 429);
  const now = Date.now();
  const { st, players } = await load(env);
  const answered = players.filter((p) => p.choice != null).length;
  if (st.q !== r.q || phaseAt(st, now, answered, players.length) !== 'question') return json({ error: 'closed' }, 409);
  if (!players.some((p) => p.pid === r.pid)) return json({ error: 'join first' }, 403);
  const ms = now - st.started_at, correct = r.choice === QUESTIONS[r.q].answer;
  await env.DB.prepare(
    'INSERT OR IGNORE INTO quiz_answers (pid, q, choice, correct, points, ms, created_at) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7)'
  ).bind(r.pid, r.q, r.choice, correct ? 1 : 0, correct ? points(ms) : 0, ms, now).run();
  return json({ ok: true });
}

// Host controls. "next" carries the question the host was looking at, so a double click can't skip one.
async function control(req, env) {
  if (!(await isAdmin(req, env))) return json({ error: 'wrong admin key' }, 403);
  const b = await readJson(req);
  const now = Date.now(), db = env.DB;
  if (b?.action === 'next' && Number.isInteger(b.from)) {
    const last = b.from >= QUESTIONS.length - 1;
    await db.prepare(
      `UPDATE quiz_state SET phase = ?1, q = ?2, started_at = ?3 WHERE id = 1 AND q = ?4 AND phase <> 'final'`
    ).bind(last ? 'final' : 'question', last ? b.from : b.from + 1, now + READY_MS, b.from).run();
  } else if (b?.action === 'close') {
    await db.prepare(`UPDATE quiz_state SET started_at = ?1 WHERE id = 1 AND phase = 'question' AND started_at > ?1`)
      .bind(now - LIMIT_MS).run();
  } else if (b?.action === 'kick' && typeof b.nickname === 'string' && typeof b.avatar === 'string') {
    // Players are listed by nickname and avatar only; the pid stays private because it is what lets a phone answer.
    const who = 'SELECT pid FROM quiz_players WHERE nickname = ?1 AND avatar = ?2';
    await db.batch([
      db.prepare(`DELETE FROM quiz_answers WHERE pid IN (${who})`).bind(b.nickname, b.avatar),
      db.prepare('DELETE FROM quiz_players WHERE nickname = ?1 AND avatar = ?2').bind(b.nickname, b.avatar),
    ]);
  } else if (b?.action === 'reset') {
    await db.batch([
      db.prepare('DELETE FROM quiz_answers'),
      db.prepare('DELETE FROM quiz_players'),
      db.prepare(`UPDATE quiz_state SET phase = 'lobby', q = -1, started_at = 0 WHERE id = 1`),
    ]);
  } else {
    return json({ error: 'unknown action' }, 400);
  }
  return json({ ok: true });
}

export const quizRoutes = {
  'GET /api/quiz': state,
  'POST /api/quiz/join': join,
  'POST /api/quiz/answer': answer,
  'POST /api/quiz/control': control,
};
