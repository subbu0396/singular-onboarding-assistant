// Per-IP sliding-window rate limiter.
//
// In-memory + serverless is imperfect — each Vercel function instance carries
// its own bucket, so limits are best-effort. That's still fine as a stopgap:
// (a) the app is currently internal, (b) instance re-use is high enough
// during a burst that most abuse hits the same bucket, and (c) the cost of a
// missed limit here is bounded by ANTHROPIC_API_KEY spend, not data leaks.
//
// When SE auth lands, swap the bucket key from IP to SE identity and, if we
// scale beyond one Vercel region, move the store to Upstash Redis.

const buckets = new Map();

// Reap old buckets so a long-running instance doesn't grow forever. Called
// opportunistically at the start of each check.
function reap(now) {
  if (buckets.size < 200) return;
  for (const [key, entries] of buckets) {
    const fresh = entries.filter((t) => now - t < 60 * 60 * 1000);
    if (fresh.length === 0) buckets.delete(key);
    else buckets.set(key, fresh);
  }
}

function clientKey(req) {
  const fwd = req.headers.get('x-forwarded-for') || '';
  const ip = fwd.split(',')[0].trim() || req.headers.get('x-real-ip') || 'unknown';
  return ip;
}

/**
 * Sliding-window limit. Returns `{ ok: true }` or `{ ok: false, retryAfter }`.
 *
 * Defaults are deliberately generous — the goal is to stop runaway loops
 * (a stuck client hammering /api/generate) and casual abuse, not to
 * throttle a legitimate SE testing an integration.
 */
export function checkRateLimit(req, { limit = 20, windowMs = 60_000, bucket = 'default' } = {}) {
  const now = Date.now();
  reap(now);
  const key = `${bucket}:${clientKey(req)}`;
  const entries = (buckets.get(key) || []).filter((t) => now - t < windowMs);
  if (entries.length >= limit) {
    const oldest = entries[0];
    const retryAfter = Math.max(1, Math.ceil((windowMs - (now - oldest)) / 1000));
    return { ok: false, retryAfter };
  }
  entries.push(now);
  buckets.set(key, entries);
  return { ok: true };
}

export function rateLimitResponse(retryAfter, message = 'Too many requests') {
  return new Response(
    JSON.stringify({ error: message, retryAfter }),
    {
      status: 429,
      headers: {
        'Content-Type': 'application/json',
        'Retry-After': String(retryAfter),
      },
    }
  );
}
