/**
 * Resource thresholds admin API (Insights → Resources, Section 5.19
 * follow-up).
 *
 *   GET /api/admin/resource-thresholds   List the configured settings.
 *   PUT /api/admin/resource-thresholds   Replace the full settings object.
 *
 * Drives the Insights → Resources page's workload-bucket and
 * performance-score math. Lives in `settings.json` because it's
 * org-wide configuration; same place as health thresholds.
 *
 * Read access is broader than write — any authenticated user with
 * `resources.view` benefits from seeing the thresholds in tooltips
 * — but only `admin.resource_thresholds.manage` can change them.
 *
 * No /recalculate endpoint here: unlike health scores, the workload
 * + performance scores aren't persisted on each resource. They're
 * computed live every time the Resources page renders. So saving
 * new thresholds takes effect on the next page load — no recalc
 * step needed.
 */

import { NextResponse } from "next/server";

import {
  requirePermission,
  requireSession,
  withAuth,
} from "@/lib/auth/permissions";
import {
  SettingsRepository,
  type ResourceSettings,
} from "@/lib/db";

export const runtime = "nodejs";

// ---------------------------------------------------------------------------
// GET — read current settings
// ---------------------------------------------------------------------------

export const GET = withAuth(async () => {
  await requireSession();
  const settings = await SettingsRepository.get();
  return NextResponse.json({
    resource_settings: settings.resource_settings,
  });
});

// ---------------------------------------------------------------------------
// PUT — replace settings
// ---------------------------------------------------------------------------

interface PutBody {
  resource_settings?: unknown;
}

/**
 * Coerce + validate one numeric field. Accepts numbers and numeric
 * strings (form inputs round-trip as strings). Returns null on
 * malformed input so the caller can decide to 400 with a useful
 * message rather than silently coerce to NaN.
 */
function num(value: unknown, min: number, max: number): number | null {
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isFinite(n)) return null;
  if (n < min || n > max) return null;
  return n;
}

/**
 * Validate the whole shape. We require every field to be present —
 * partial PUTs aren't supported here because the admin form ships
 * the full object. Falling back to defaults silently would mask
 * bugs in the editor.
 */
function shapeSettings(raw: unknown): ResourceSettings | string {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return "resource_settings must be an object.";
  }
  const r = raw as Record<string, unknown>;

  const allocation = num(r.default_allocation_percent, 0, 100);
  if (allocation === null) {
    return "default_allocation_percent must be a number between 0 and 100.";
  }

  const ww = r.workload_weights;
  if (!ww || typeof ww !== "object") {
    return "workload_weights must be an object.";
  }
  const wwo = ww as Record<string, unknown>;
  const weight = (k: string): number | null => num(wwo[k], 0, 1000);
  const project_assignment = weight("project_assignment");
  const open_task = weight("open_task");
  const past_due_task = weight("past_due_task");
  const bottleneck_task = weight("bottleneck_task");
  const complexity_low = weight("complexity_low");
  const complexity_medium = weight("complexity_medium");
  const complexity_high = weight("complexity_high");
  const complexity_very_high = weight("complexity_very_high");
  const priority_critical = weight("priority_critical");
  const priority_high = weight("priority_high");
  const priority_medium = weight("priority_medium");
  const priority_low = weight("priority_low");
  if (
    project_assignment === null ||
    open_task === null ||
    past_due_task === null ||
    bottleneck_task === null ||
    complexity_low === null ||
    complexity_medium === null ||
    complexity_high === null ||
    complexity_very_high === null ||
    priority_critical === null ||
    priority_high === null ||
    priority_medium === null ||
    priority_low === null
  ) {
    return "All workload weights must be numbers between 0 and 1000.";
  }

  const wb = r.workload_buckets;
  if (!wb || typeof wb !== "object") {
    return "workload_buckets must be an object.";
  }
  const wbo = wb as Record<string, unknown>;
  const light_max = num(wbo.light_max, 0, 100000);
  const balanced_max = num(wbo.balanced_max, 0, 100000);
  const heavy_max = num(wbo.heavy_max, 0, 100000);
  if (light_max === null || balanced_max === null || heavy_max === null) {
    return "Bucket thresholds must be non-negative numbers.";
  }
  if (!(light_max < balanced_max && balanced_max < heavy_max)) {
    return "Bucket thresholds must satisfy light < balanced < heavy.";
  }

  const pw = r.performance_weights;
  if (!pw || typeof pw !== "object") {
    return "performance_weights must be an object.";
  }
  const pwo = pw as Record<string, unknown>;
  const pw_on_time = num(pwo.on_time, 0, 100);
  const pw_blocked = num(pwo.blocked_inverse, 0, 100);
  if (pw_on_time === null || pw_blocked === null) {
    return "performance_weights values must be non-negative numbers.";
  }
  if (pw_on_time + pw_blocked === 0) {
    return "At least one performance weight must be greater than zero.";
  }

  const pt = r.performance_thresholds;
  if (!pt || typeof pt !== "object") {
    return "performance_thresholds must be an object.";
  }
  const pto = pt as Record<string, unknown>;
  const green_min = num(pto.green_min, 0, 1);
  const yellow_min = num(pto.yellow_min, 0, 1);
  if (green_min === null || yellow_min === null) {
    return "Performance thresholds must be numbers between 0 and 1.";
  }
  if (!(yellow_min < green_min)) {
    return "Performance thresholds must satisfy yellow_min < green_min.";
  }

  const window_days = num(r.performance_window_days, 1, 3650);
  if (window_days === null) {
    return "performance_window_days must be a number between 1 and 3650.";
  }

  return {
    default_allocation_percent: allocation,
    workload_weights: {
      project_assignment,
      open_task,
      past_due_task,
      bottleneck_task,
      complexity_low,
      complexity_medium,
      complexity_high,
      complexity_very_high,
      priority_critical,
      priority_high,
      priority_medium,
      priority_low,
    },
    workload_buckets: { light_max, balanced_max, heavy_max },
    performance_weights: {
      on_time: pw_on_time,
      blocked_inverse: pw_blocked,
    },
    performance_thresholds: { green_min, yellow_min },
    performance_window_days: window_days,
  };
}

export const PUT = withAuth(async (request: Request) => {
  await requirePermission("admin.resource_thresholds.manage");
  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  const shape = shapeSettings(body.resource_settings);
  if (typeof shape === "string") {
    return NextResponse.json({ error: shape }, { status: 400 });
  }
  const updated = await SettingsRepository.update({
    resource_settings: shape,
  });
  return NextResponse.json({
    resource_settings: updated.resource_settings,
  });
});
