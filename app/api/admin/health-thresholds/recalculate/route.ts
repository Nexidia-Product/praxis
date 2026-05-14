/**
 * Health-score recalculate-all endpoint (Section 5.13).
 *
 *   POST /api/admin/health-thresholds/recalculate
 *
 * Fires `recalculateAllHealthScores()` from `lib/health.ts` synchronously
 * and returns the count of projects whose score actually changed. Used
 * after a threshold edit so the operator can see the effect immediately
 * rather than waiting for the next daily sweep (Section 12: "Health
 * score thresholds feel wrong for team's workflow" recovery path).
 *
 * Pinned to the Node runtime — `lib/health.ts` transitively imports
 * `lib/db/store.ts` which uses `node:fs`, the same Edge-runtime hazard
 * called out elsewhere.
 *
 * Admin-only. The recalc is idempotent so a stuck-in-flight request
 * being retried is safe; same-day history snapshots collapse via
 * `appendHistory`.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { recalculateAllHealthScores } from "@/lib/health";

export const runtime = "nodejs";

export const POST = withAuth(async () => {
  await requirePermission("admin.health_thresholds.manage");
  const startedAt = Date.now();
  const changed = await recalculateAllHealthScores();
  const duration_ms = Date.now() - startedAt;
  return NextResponse.json({ changed, duration_ms });
});
