/**
 * Sliding-window limiter, in memory. On serverless this is per warm instance, so it is a
 * speed bump against casual abuse, not a quota. The hard backstop for LLM spend is that only
 * `:free` models are ever callable (see llm.ts).
 */
const buckets = new Map<string, number[]>();
const MAX_KEYS = 5000;

export interface LimitResult { ok: boolean; remaining: number; retryAfterSec: number }

export function rateLimit(key: string, max: number, windowMs: number, now = Date.now()): LimitResult {
  const recent = (buckets.get(key) ?? []).filter((t) => now - t < windowMs);
  if (recent.length >= max) {
    buckets.set(key, recent);
    return { ok: false, remaining: 0, retryAfterSec: Math.ceil((windowMs - (now - recent[0])) / 1000) };
  }
  recent.push(now);
  if (buckets.size >= MAX_KEYS && !buckets.has(key)) buckets.delete(buckets.keys().next().value as string); // bound memory
  buckets.set(key, recent);
  return { ok: true, remaining: max - recent.length, retryAfterSec: 0 };
}

export function resetRateLimits(): void {
  buckets.clear();
}

/** Vercel sets x-forwarded-for itself; the left-most entry is the client. */
export function clientKey(req: Request): string {
  const fwd = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return fwd || req.headers.get("x-real-ip") || "unknown";
}
