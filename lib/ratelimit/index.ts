/**
 * In-memory IP rate limiter for public endpoints.
 *
 * Section 5.17 calls out "CAPTCHA or rate limiting to prevent spam" on
 * the public idea submission portal. We pick rate limiting because it
 * needs zero third-party setup and matches the rest of the Phase-1
 * "no infrastructure" stance — the JSON store is single-process, and so
 * is this limiter.
 *
 * The limiter is a fixed-window counter per IP: each window holds a
 * count and a reset timestamp. Once the count exceeds `max`, requests
 * are rejected until the window expires.
 *
 * This is deliberately simple, with two known limitations the swap to
 * a database (Phase 2) is the right time to address:
 *
 *   - State is per-process. Two server instances behind a load balancer
 *     would each see half the traffic; the cap effectively doubles. Not
 *     a concern for the small-team, single-host deployment Section 12
 *     anticipates.
 *   - The IP is whatever `x-forwarded-for` or `x-real-ip` reports, which
 *     is trustworthy only when the deployment is behind a known proxy
 *     (Vercel, Railway, nginx with `set_real_ip_from`). Behind Cloudflare,
 *     we'd want `cf-connecting-ip`. Configure the proxy correctly or
 *     the limit is bypassable by spoofing the header.
 *
 * When the database swap happens (Section 10), this file's API stays —
 * the body becomes a query against a `rate_limits` table.
 */

interface Bucket {
  count: number;
  /** Epoch milliseconds when this bucket resets to zero. */
  resetsAt: number;
}

/**
 * The buckets Map is pinned to `globalThis` so Next.js's dev-mode
 * module hot-reload doesn't wipe it on every file save (AUTH-12). In
 * production, modules load once and the global pin is harmless; in dev,
 * any edit anywhere in the repo would otherwise reset every limiter to
 * zero, which made it look like the limit was lenient when the actual
 * issue was that the state was being thrown away repeatedly.
 *
 * The cast is required because TypeScript doesn't have a direct way to
 * extend the global type from inside a module without a global ambient
 * declaration; the augmentation block below makes the intent explicit
 * and gives us proper typing on the global.
 */
declare global {
  // eslint-disable-next-line no-var
  var __iim_rateLimitBuckets: Map<string, Bucket> | undefined;
}

const buckets: Map<string, Bucket> =
  globalThis.__iim_rateLimitBuckets ??
  (globalThis.__iim_rateLimitBuckets = new Map<string, Bucket>());

/**
 * Periodic cleanup so a long-running process doesn't accumulate a bucket
 * for every IP that ever hit the endpoint. Runs every 10 minutes; cheap
 * even with thousands of buckets since we just walk and prune.
 *
 * `setInterval(...).unref()` keeps Node's event loop free to exit when
 * the rest of the app does — without `unref()`, the timer would pin the
 * process alive forever in test runs.
 */
const CLEANUP_INTERVAL_MS = 10 * 60 * 1000;
let cleanupHandle: ReturnType<typeof setInterval> | null = null;

function startCleanup(): void {
  if (cleanupHandle) return;
  cleanupHandle = setInterval(() => {
    const now = Date.now();
    for (const [key, bucket] of buckets) {
      if (bucket.resetsAt <= now) buckets.delete(key);
    }
  }, CLEANUP_INTERVAL_MS);
  // Don't keep the process alive just for cleanup.
  if (typeof cleanupHandle.unref === "function") cleanupHandle.unref();
}

export interface RateLimitOptions {
  /** Cap on requests per window. */
  max: number;
  /** Window length in milliseconds. */
  windowMs: number;
}

export interface RateLimitResult {
  allowed: boolean;
  /** How many more requests are allowed in the current window. */
  remaining: number;
  /** Epoch ms when the window resets. */
  resetsAt: number;
  /** Seconds-until-reset, suitable for a Retry-After header. */
  retryAfterSec: number;
}

/**
 * Consume one slot for `key` against `opts`. Returns whether the request
 * is allowed and how many slots remain.
 *
 * The function is idempotent for already-rejected requests within the
 * same window — repeated calls keep returning `allowed: false` without
 * incrementing further. That avoids penalizing an attacker who keeps
 * banging on the door, but the practical effect is small either way.
 */
export function checkRateLimit(
  key: string,
  opts: RateLimitOptions,
): RateLimitResult {
  startCleanup();
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || existing.resetsAt <= now) {
    const fresh: Bucket = { count: 1, resetsAt: now + opts.windowMs };
    buckets.set(key, fresh);
    return {
      allowed: true,
      remaining: Math.max(0, opts.max - 1),
      resetsAt: fresh.resetsAt,
      retryAfterSec: Math.ceil(opts.windowMs / 1000),
    };
  }

  const retryAfterSec = Math.max(1, Math.ceil((existing.resetsAt - now) / 1000));
  if (existing.count >= opts.max) {
    return {
      allowed: false,
      remaining: 0,
      resetsAt: existing.resetsAt,
      retryAfterSec,
    };
  }

  existing.count += 1;
  return {
    allowed: true,
    remaining: Math.max(0, opts.max - existing.count),
    resetsAt: existing.resetsAt,
    retryAfterSec,
  };
}

/**
 * Resolve the caller's IP from a Next.js `Request`. Order matches the
 * common deployment topology: Cloudflare → Vercel/Railway → bare. Falls
 * back to a literal "unknown" so requests without any header get one
 * shared bucket — bad behavior is very limited even when collapsed.
 */
export function getClientIp(request: Request): string {
  const headers = request.headers;
  const cf = headers.get("cf-connecting-ip");
  if (cf) return cf.trim();
  const fwd = headers.get("x-forwarded-for");
  if (fwd) {
    // First entry is the original client; subsequent entries are proxies.
    const first = fwd.split(",")[0];
    if (first) return first.trim();
  }
  const real = headers.get("x-real-ip");
  if (real) return real.trim();
  return "unknown";
}

/**
 * Test-only helper: reset the limiter state so smoke tests can run in a
 * deterministic starting state. Not exported through any public surface.
 */
export function __resetRateLimitForTests(): void {
  buckets.clear();
}
