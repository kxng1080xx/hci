import { PID, WORDS, clean, validateResponse } from './validate.js';
import { json, readJson, limited, isAdmin } from './http.js';
import { quizRoutes } from './quiz.js';

async function join(req, env) {
  const b = await readJson(req);
  if (!b || typeof b.pid !== 'string' || !PID.test(b.pid)) return json({ error: 'bad pid' }, 400);
  if (await limited(env, b.pid)) return json({ error: 'slow down' }, 429);
  await env.DB.prepare(
    'INSERT INTO participants (id, nickname, created_at) VALUES (?1, ?2, ?3) ON CONFLICT (id) DO UPDATE SET nickname = excluded.nickname'
  ).bind(b.pid, clean(b.nickname, 20), Date.now()).run();
  return json({ ok: true });
}

async function saveResponse(req, env) {
  const r = validateResponse(await readJson(req));
  if (typeof r === 'string') return json({ error: r }, 400);
  if (await limited(env, r.pid)) return json({ error: 'slow down' }, 429);
  const now = Date.now();
  await env.DB.batch([
    env.DB.prepare('INSERT OR IGNORE INTO participants (id, created_at) VALUES (?1, ?2)').bind(r.pid, now),
    env.DB.prepare(
      `INSERT INTO responses (pid, round, design, task, feeling, words, comment, attempts, seconds, skipped, created_at)
       VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11)
       ON CONFLICT (pid, round) DO UPDATE SET feeling = excluded.feeling, words = excluded.words, comment = excluded.comment,
         attempts = excluded.attempts, seconds = excluded.seconds, skipped = excluded.skipped, created_at = excluded.created_at`
    ).bind(r.pid, r.round, r.design, r.task, r.feeling, r.words, r.comment, r.attempts, r.seconds, r.skipped, now),
  ]);
  return json({ ok: true });
}

async function results(req, env) {
  const nicknames = await isAdmin(req, env);
  const q = (sql) => env.DB.prepare(sql);
  const [joined, rounds, designs, words, hist, wall] = await env.DB.batch([
    q('SELECT COUNT(*) AS n FROM participants'),
    q('SELECT round, COUNT(*) AS n, AVG(feeling) AS feeling FROM responses GROUP BY round'),
    q('SELECT design, COUNT(*) AS n, AVG(attempts) AS attempts, AVG(seconds) AS seconds FROM responses GROUP BY design'),
    q('SELECT r.design, j.value AS word, COUNT(*) AS n FROM responses r, json_each(r.words) j GROUP BY r.design, j.value'),
    q('SELECT design, feeling, COUNT(*) AS n FROM responses GROUP BY design, feeling'),
    q(`SELECT r.id, r.design, r.comment, p.nickname FROM responses r LEFT JOIN participants p ON p.id = r.pid
       WHERE r.comment <> '' ORDER BY r.created_at DESC LIMIT 40`),
  ]);

  const out = {
    joined: joined.results[0].n,
    rounds: {},
    designs: {},
    words: { bad: {}, good: {} },
    hist: { bad: [0, 0, 0, 0, 0], good: [0, 0, 0, 0, 0] },
    wall: wall.results.map((w) => ({ id: w.id, design: w.design, text: w.comment, ...(nicknames && w.nickname ? { nick: w.nickname } : {}) })),
    nicknames,
  };
  for (const r of rounds.results) out.rounds[r.round] = { n: r.n, feeling: r.feeling };
  for (const d of designs.results) out.designs[d.design] = { n: d.n, attempts: d.attempts, seconds: d.seconds };
  for (const w of words.results) if (WORDS.includes(w.word)) out.words[w.design][w.word] = w.n;
  for (const h of hist.results) out.hist[h.design][h.feeling - 1] = h.n;
  return json(out);
}

async function reset(req, env) {
  if (await limited(env, 'reset:' + (req.headers.get('cf-connecting-ip') || ''))) return json({ error: 'slow down' }, 429);
  if (!(await isAdmin(req, env))) return json({ error: 'wrong admin key' }, 403);
  await env.DB.batch([env.DB.prepare('DELETE FROM responses'), env.DB.prepare('DELETE FROM participants')]);
  return json({ ok: true });
}

const routes = {
  'POST /api/join': join,
  'POST /api/response': saveResponse,
  'GET /api/results': results,
  'POST /api/reset': reset,
  ...quizRoutes,
};

// Static files in public/ are served before this runs, so only /api/* and unknown paths reach here.
export default {
  async fetch(req, env) {
    const handler = routes[`${req.method} ${new URL(req.url).pathname}`];
    if (!handler) return json({ error: 'not found' }, 404);
    try {
      return await handler(req, env);
    } catch (e) {
      console.error(e);
      return json({ error: 'server error' }, 500);
    }
  },
};
