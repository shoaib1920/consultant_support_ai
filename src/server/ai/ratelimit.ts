// Sliding-window rate limiter for AI calls (per user). In-process; for multi-instance production
// deployments back this with Firestore/Redis (see README "Production hardening").

const g = globalThis as unknown as { __vgRate?: Map<string, number[]> };
const hits = (g.__vgRate ??= new Map());

export class RateLimitError extends Error {
  constructor(readonly retryAfterSeconds: number) {
    super(`AI rate limit reached. Try again in ${retryAfterSeconds}s.`);
    this.name = "RateLimitError";
  }
}

export function checkRateLimit(key: string, perMinute = Number(process.env.AI_RATE_LIMIT_PER_MINUTE ?? 10)): void {
  const now = Date.now();
  const arr = (hits.get(key) ?? []).filter((t: number) => now - t < 60_000);
  if (arr.length >= perMinute) {
    hits.set(key, arr);
    throw new RateLimitError(Math.ceil((60_000 - (now - arr[0])) / 1000));
  }
  arr.push(now);
  hits.set(key, arr);
}
