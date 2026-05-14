/**
 * On-demand health-score recalculate endpoint (Section 5.13).
 *
 *   POST /api/projects/recalculate-health
 *
 * Fires `recalculateAllHealthScores()` synchronously and returns the
 * count of projects whose score actually changed. Distinct from the
 * admin-only recalculate route at
 * `/api/admin/health-thresholds/recalculate`:
 *
 *   - That one is gated by `admin.health_thresholds.manage` and is
 *     used after a threshold edit, where the typical actor is the
 *     org admin who just changed the rules.
 *   - This one is gated by `projects.view` so any team member who
 *     spotted a stale-looking badge can force a refresh from the
 *     Projects page button. Threshold rules aren't changing, just the
 *     freshness of the cached scores.
 *
 * Both endpoints call the same underlying function — there's no
 * difference in what they compute, only in who is allowed to invoke
 * the recalculation. Splitting them avoids loosening the threshold
 * editor's permission floor; admins can still keep that gated even if
 * everyone has refresh.
 *
 * The recalc is idempotent so a stuck-in-flight request being retried
 * is safe; same-day history snapshots collapse via `appendHistory`.
 *
 * Pinned to the Node runtime — `lib/health.ts` transitively imports
 * `lib/db/store.ts` which uses `node:fs`, the same Edge-runtime hazard
 * called out elsewhere.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { recalculateAllHealthScores } from "@/lib/health";

export const runtime = "nodejs";

export const POST = withAuth(async () => {
  await requirePermission("projects.view");
  const startedAt = Date.now();
  const changed = await recalculateAllHealthScores();
  const duration_ms = Date.now() - startedAt;
  return NextResponse.json({ changed, duration_ms });
});
