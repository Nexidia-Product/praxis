/**
 * In-memory cache for the velocity metrics endpoint (Section 5.15).
 *
 * Section 5.15 calls for "1-hour TTL on all velocity API routes ... using
 * Next.js `unstable_cache` or a simple in-memory cache" so a busy
 * dashboard doesn't recompute the full metric set on every refresh of the
 * page. We use the simple in-memory variant: the metric set is a small
 * object (kilobytes, not megabytes), and the JSON store would not survive
 * a process restart anyway, so cache durability across processes is moot.
 *
 * The cache key is the JSON-stringified filter set. That makes the same
 * filter combination return a hit, while flipping any single dimension
 * misses cleanly. Adding a new filter dimension to `VelocityFilters`
 * automatically participates because the key is built from the value, not
 * a hand-maintained tuple.
 *
 * On any project / task / idea write, the API route should call
 * `invalidateVelocityCache()` so the next request recomputes. The cost of
 * a cold compute on the dataset sizes the design targets (hundreds of
 * records, Section 3.3) is small, so we are happy to bias toward
 * freshness.
 */

import type { VelocityFilters, VelocityMetrics } from "./types";

const TTL_MS = 60 * 60 * 1000; // 1 hour, per Section 5.15.

interface CacheEntry {
  expires_at: number;
  payload: Omit<VelocityMetrics, "from_cache">;
}

const cache = new Map<string, CacheEntry>();

function keyFor(filters: VelocityFilters): string {
  // Stable key: stringify with the filter fields in a consistent order.
  // We don't sort arrays inside the filter — `[High, Low]` and `[Low, High]`
  // are intentionally treated as different cache entries because the
  // UI emits whichever order the user clicked, and recomputing for both
  // is cheap.
  return JSON.stringify({
    range: filters.range,
    project_types: filters.project_types,
    application_products: filters.application_products,
    project_leads: filters.project_leads,
    individual_user_id: filters.individual_user_id,
  });
}

/**
 * Read a cached metric set. Returns `null` if missing or expired. Expired
 * entries are not deleted on read — `set` overwrites them on the next
 * write, and `invalidate` cleans up explicitly. That keeps the read path
 * branchless past the timestamp check.
 */
export function getCachedVelocityMetrics(
  filters: VelocityFilters,
  now: number = Date.now(),
): Omit<VelocityMetrics, "from_cache"> | null {
  const entry = cache.get(keyFor(filters));
  if (!entry) return null;
  if (entry.expires_at <= now) return null;
  return entry.payload;
}

/**
 * Store a metric set under the given filter key. The 1-hour TTL is fixed;
 * it isn't configurable per call because mixing TTLs leaks ambiguity into
 * the cache (a 10-minute entry served when a 1-hour was requested would
 * be hard to debug).
 */
export function setCachedVelocityMetrics(
  filters: VelocityFilters,
  payload: Omit<VelocityMetrics, "from_cache">,
  now: number = Date.now(),
): void {
  cache.set(keyFor(filters), {
    expires_at: now + TTL_MS,
    payload,
  });
}

/**
 * Drop every cached metric set. Called by service-layer write paths
 * after creating, updating, or deleting projects, tasks, and ideas so a
 * cached dashboard never serves data that's older than the underlying
 * mutation.
 *
 * This is a coarse invalidation — any write blows away every filter
 * combination's cached entry. That is fine: the velocity dashboard is a
 * low-traffic admin surface and the hot path the cache exists to protect
 * is "user opens dashboard, then resizes the time-range filter four
 * times in 10 seconds", not "user opens dashboard while the team is
 * actively editing tasks".
 */
export function invalidateVelocityCache(): void {
  cache.clear();
}

/** Test-only: dump the cache size. Used by the smoke test. */
export function _cacheSize(): number {
  return cache.size;
}

/** Internal constant exported for tests. */
export const VELOCITY_CACHE_TTL_MS = TTL_MS;
