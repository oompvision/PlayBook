/**
 * Simple in-memory rate limiter using a sliding window.
 * Suitable for single-instance deployments (Vercel serverless functions
 * each get their own instance, so this provides per-instance protection).
 *
 * For multi-instance deployments, consider Upstash Redis rate limiting.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Periodically clean up expired entries to prevent memory leaks
const CLEANUP_INTERVAL = 60_000; // 1 minute
let lastCleanup = Date.now();

function cleanup() {
  const now = Date.now();
  if (now - lastCleanup < CLEANUP_INTERVAL) return;
  lastCleanup = now;
  for (const [key, entry] of store) {
    if (now > entry.resetAt) {
      store.delete(key);
    }
  }
}

/**
 * Check if a request should be rate limited.
 *
 * @param key - Unique identifier (e.g., IP address or IP + path)
 * @param limit - Maximum requests allowed in the window
 * @param windowMs - Time window in milliseconds
 * @returns { limited: boolean, remaining: number, resetAt: number }
 */
export function rateLimit(
  key: string,
  limit: number,
  windowMs: number
): { limited: boolean; remaining: number; resetAt: number } {
  cleanup();

  const now = Date.now();
  const entry = store.get(key);

  if (!entry || now > entry.resetAt) {
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count++;

  if (entry.count > limit) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt };
  }

  return { limited: false, remaining: limit - entry.count, resetAt: entry.resetAt };
}
