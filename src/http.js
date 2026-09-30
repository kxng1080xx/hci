// Helpers shared by the demo and quiz handlers.

export const json = (data, status = 200) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json', 'cache-control': 'no-store' },
  });

export async function readJson(req) {
  const text = await req.text();
  if (text.length > 2048) return null;
  try { return JSON.parse(text); } catch { return null; }
}

// ponytail: rate limit keyed on participant ID only, because a whole class shares one Wi-Fi IP.
// A client can mint new IDs; each (pid, round) is still one row, so the ceiling is junk rows, not skewed averages.
export async function limited(env, key) {
  if (!env.LIMITER) return false;
  const { success } = await env.LIMITER.limit({ key });
  return !success;
}

export async function isAdmin(req, env) {
  const given = req.headers.get('x-admin-key');
  if (!given || !env.ADMIN_KEY) return false;
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([given, env.ADMIN_KEY].map((s) => crypto.subtle.digest('SHA-256', enc.encode(s))));
  return crypto.subtle.timingSafeEqual(a, b);
}
