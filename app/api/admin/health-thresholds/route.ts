/**
 * Health-score thresholds admin API (Section 5.13, Section 5.19).
 *
 *   GET   /api/admin/health-thresholds   List the configured thresholds.
 *   PUT   /api/admin/health-thresholds   Replace the full thresholds object.
 *   POST  /api/admin/health-thresholds/recalculate
 *                                         Trigger an immediate recalc of
 *                                         every project's health score.
 *
 * The thresholds drive the Red / Yellow / Green scoring in `lib/health.ts`.
 * They live inside `settings.json` because they're org-wide configuration.
 *
 * Read access is broader than write: any authenticated user can fetch the
 * thresholds (the project quick-view's health-score breakdown explains
 * which threshold a project tripped), but only Admins can change them.
 *
 * Why a single PUT rather than per-field PATCH: the editor is a small
 * five-field form; the operator edits all of it locally and saves once.
 * Mirrors the pattern in `/api/admin/custom-fields/route.ts`.
 *
 * The recalculate endpoint is exposed because thresholds typically change
 * during a calibration period (Section 12 risk: "Health score thresholds
 * feel wrong for team's workflow"). Saving new thresholds doesn't
 * automatically reshape every project's score — the projects table reads
 * the persisted `health_score` field. The recalc button hits the same
 * codepath the daily sweep uses, so an Admin can see the effect of a
 * threshold change immediately rather than waiting for tomorrow's cron.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import {
  SettingsRepository,
  type HealthScoreThresholds,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// GET — read current thresholds
// ---------------------------------------------------------------------------

export const GET = withAuth(async () => {
  await requireSession();
  const settings = await SettingsRepository.get();
  return NextResponse.json({
    health_score_thresholds: settings.health_score_thresholds,
  });
});

// ---------------------------------------------------------------------------
// PUT — replace thresholds
// ---------------------------------------------------------------------------

interface PutBody {
  health_score_thresholds?: unknown;
}

/**
 * Coerce one threshold field. Accepts numbers (including those that come
 * back as strings from form inputs) and validates against a finite range.
 *
 * `min` and `max` are inclusive. The bounds are deliberately generous —
 * the design doc default is 20% Yellow / 40% Red but a permissive team
 * may want 10/30 or a strict one 30/60. We don't dictate beyond preventing
 * obviously broken values (negative percentages, days > a year).
 */
function asPercent(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${field} must be a number.`);
  }
  if (n < 0 || n > 100) {
    throw new Error(`${field} must be between 0 and 100.`);
  }
  return n;
}

function asDays(value: unknown, field: string): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) {
    throw new Error(`${field} must be a number.`);
  }
  if (n < 0 || n > 365) {
    throw new Error(`${field} must be between 0 and 365 days.`);
  }
  return Math.round(n);
}

export const PUT = withAuth(async (request: Request) => {
  await requirePermission("admin.health_thresholds.manage");

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const raw = body.health_score_thresholds;
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    return NextResponse.json(
      { error: "health_score_thresholds must be an object." },
      { status: 400 },
    );
  }
  const obj = raw as Record<string, unknown>;

  let cleaned: HealthScoreThresholds;
  try {
    cleaned = {
      yellow_blocked_or_overdue_pct: asPercent(
        obj.yellow_blocked_or_overdue_pct,
        "yellow_blocked_or_overdue_pct",
      ),
      red_blocked_or_overdue_pct: asPercent(
        obj.red_blocked_or_overdue_pct,
        "red_blocked_or_overdue_pct",
      ),
      yellow_inactivity_days: asDays(
        obj.yellow_inactivity_days,
        "yellow_inactivity_days",
      ),
      yellow_target_date_proximity_days: asDays(
        obj.yellow_target_date_proximity_days,
        "yellow_target_date_proximity_days",
      ),
      yellow_open_tasks_pct: asPercent(
        obj.yellow_open_tasks_pct,
        "yellow_open_tasks_pct",
      ),
      yellow_due_soon_tasks_pct: asPercent(
        obj.yellow_due_soon_tasks_pct,
        "yellow_due_soon_tasks_pct",
      ),
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Invalid value.";
    return NextResponse.json({ error: message }, { status: 400 });
  }

  // Cross-field invariant: the Red percentage must be strictly greater
  // than the Yellow percentage. A configuration where Red <= Yellow makes
  // the scorer behave unpredictably — projects could "flip past" Red
  // without ever showing Yellow, which defeats the warning tier. Better
  // to surface the misconfiguration as a 400 here than silently accept
  // it and produce confusing scores.
  if (cleaned.red_blocked_or_overdue_pct <= cleaned.yellow_blocked_or_overdue_pct) {
    return NextResponse.json(
      {
        error:
          "Red threshold must be greater than Yellow threshold for blocked-or-overdue percentage.",
      },
      { status: 400 },
    );
  }

  const updated = await SettingsRepository.update({
    health_score_thresholds: cleaned,
  });
  return NextResponse.json({
    health_score_thresholds: updated.health_score_thresholds,
  });
});
