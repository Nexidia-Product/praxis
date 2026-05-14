/**
 * Velocity Dashboard API (Section 5.15, Step 9 of Section 9).
 *
 *   GET  /api/dashboard/velocity
 *
 * Returns the full metric set in one round trip: all seven Section 5.15
 * metrics, plus filter-option lists (project types, application/products,
 * project leads) and the calibration banner flag.
 *
 * Why one route instead of one per metric:
 *
 *   - The dashboard renders all charts together — a per-metric route
 *     would mean seven cold computes per page load for the same
 *     underlying records.
 *
 *   - A single payload is naturally cacheable. Section 5.15 calls for a
 *     1-hour TTL on velocity routes; we apply it once here in front of
 *     the orchestration layer instead of each metric maintaining its own.
 *
 * Filter set comes in via query parameters so the route plays nicely
 * with `<a href>`-driven dashboards and bookmarkable URLs:
 *
 *   range          one of `30d` | `90d` | `6mo` | `1yr` | `all` | `custom`
 *   start, end     YYYY-MM-DD; only consulted when `range=custom`
 *   types          comma-separated project types
 *   products       comma-separated application_product values
 *   leads          comma-separated user IDs
 *   individual     user_id for the individual-contributor view
 *
 * Authorization (Section 5.15, Section 4.7):
 *
 *   - Any authenticated user can pull the unscoped dashboard.
 *   - The `individual` filter is scoped: a non-Admin can only request
 *     their own user_id; otherwise we return 403. This matches the
 *     "visible to Admins and the individual; not visible across peers
 *     by default" rule from Section 5.15.
 *
 * Cache invalidation: write paths in the project, task, and idea service
 * layers call `invalidateVelocityCache()` so a fresh metric set is
 * computed on the next request after any mutation. The cache is purely
 * a perf optimization in front of pure functions — correctness never
 * depends on it.
 */

import { NextResponse } from "next/server";

import { ForbiddenError, requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  IdeaRepository,
  ProjectRepository,
  TaskRepository,
  type ProjectType,
} from "@/lib/db";
import { PORTFOLIO_PROJECT_TYPES, isAdminProject } from "@/lib/projects/display";
import {
  getCachedVelocityMetrics,
  setCachedVelocityMetrics,
} from "@/lib/velocity/cache";
import {
  computeVelocityMetrics,
  resolveRange,
} from "@/lib/velocity/metrics";
import type {
  VelocityFilters,
  VelocityMetrics,
  VelocityRangeKind,
} from "@/lib/velocity/types";

// pptxgenjs / file IO is never invoked here, but other Node-only modules
// in our chain (e.g. crypto via the repo layer) do not survive the edge
// runtime, so pin to nodejs to match the rest of the API surface.
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const RANGE_KINDS: VelocityRangeKind[] = [
  "30d",
  "90d",
  "6mo",
  "1yr",
  "all",
  "custom",
];

// ---------------------------------------------------------------------------
// Query-string parsing
// ---------------------------------------------------------------------------

/**
 * Split a comma-separated query parameter into trimmed, non-empty entries.
 * Returns `[]` when the parameter is absent or empty so the metrics layer
 * sees "no filter" rather than a `[""]` that filters out everything.
 */
function csv(params: URLSearchParams, key: string): string[] {
  const raw = params.get(key);
  if (!raw) return [];
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseRangeKind(raw: string | null): VelocityRangeKind | null {
  if (!raw) return null;
  return (RANGE_KINDS as readonly string[]).includes(raw)
    ? (raw as VelocityRangeKind)
    : null;
}

function parseDate(raw: string | null): string | null {
  if (!raw) return null;
  // Accept both `YYYY-MM-DD` and full ISO timestamps; the metrics layer
  // slices to the date prefix anyway.
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return null;
  return raw.slice(0, 10);
}

/**
 * Parse the URL into a `VelocityFilters`. Returns either a filter object
 * or a 400-shaped error so the route handler can surface a friendly
 * message; we deliberately don't throw out of this function so the
 * calling code stays linear.
 */
function parseFilters(
  request: Request,
  now: Date,
):
  | { ok: true; filters: VelocityFilters }
  | { ok: false; status: number; message: string } {
  const params = new URL(request.url).searchParams;

  // Range — defaults to 90 days when omitted; matches the dashboard's
  // default selector position.
  const rangeKind = parseRangeKind(params.get("range")) ?? "90d";
  const customStart = parseDate(params.get("start"));
  const customEnd = parseDate(params.get("end"));
  if (rangeKind === "custom") {
    if (!customStart && !customEnd) {
      return {
        ok: false,
        status: 400,
        message: "range=custom requires at least one of `start` or `end`.",
      };
    }
    if (customStart && customEnd && customStart > customEnd) {
      return {
        ok: false,
        status: 400,
        message: "`start` must be on or before `end`.",
      };
    }
  }
  const range = resolveRange(rangeKind, now, {
    start: customStart,
    end: customEnd,
  });

  // Project types — every value must be a valid portfolio enum entry.
  // The "Admin" type is excluded here: Admin-classified work is filtered
  // out of the dashboard entirely (see `isAdminProject` filter below),
  // so accepting it as a query value would be a contradiction — the
  // request would silently match nothing. An unknown value is a typo,
  // not a "match nothing" silent filter.
  const types = csv(params, "types");
  for (const t of types) {
    if (!(PORTFOLIO_PROJECT_TYPES as readonly string[]).includes(t)) {
      return {
        ok: false,
        status: 400,
        message: `Invalid project_type: ${t}.`,
      };
    }
  }

  const products = csv(params, "products");
  const leads = csv(params, "leads");
  const individualUserId = params.get("individual");

  return {
    ok: true,
    filters: {
      range,
      project_types: types as ProjectType[],
      application_products: products,
      project_leads: leads,
      individual_user_id: individualUserId && individualUserId.length > 0
        ? individualUserId
        : null,
    },
  };
}

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export const GET = withAuth(async (request: Request) => {
  const session = await requirePermission("velocity.view");
  const now = new Date();

  const parsed = parseFilters(request, now);
  if (!parsed.ok) {
    return NextResponse.json({ error: parsed.message }, { status: parsed.status });
  }
  const filters = parsed.filters;

  // Authorization for the individual-contributor view (Section 5.15).
  // This is one of the few places where a hard role check is the right
  // model rather than a permission. The dashboard itself is gated by
  // `velocity.view`; this guard layers on a stricter "you can only see
  // your own individual breakdown" rule that intentionally isn't
  // delegable to non-Admin roles via the matrix — viewing another
  // person's individual numbers is a privacy-sensitive elevation that
  // should require explicit Admin authority. If that ever changes,
  // introduce e.g. `velocity.view_others` and migrate.
  if (
    filters.individual_user_id &&
    filters.individual_user_id !== session.user.user_id &&
    session.user.role !== "Admin"
  ) {
    throw new ForbiddenError(
      "Only Admins can view another user's individual velocity.",
    );
  }

  // Cache lookup. The cache key is the full filter set, so a
  // one-character change to any field misses cleanly.
  const cached = getCachedVelocityMetrics(filters);
  if (cached) {
    const payload: VelocityMetrics = { ...cached, from_cache: true };
    return NextResponse.json({ metrics: payload });
  }

  // Cold compute. Three repository reads run in parallel — they don't
  // touch the same file, and the JSON store's per-file locks already
  // serialize anything that does.
  const [allProjects, allTasks, ideas] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    IdeaRepository.getAll(),
  ]);

  // Drop Admin-classified work before any metric runs. Admin projects
  // (project_type "Admin" or application_product "Admin") track
  // internal team cadence rather than portfolio delivery; including
  // them in throughput, cycle-time, or completion charts would dilute
  // the signal those metrics are meant to carry. Tasks belonging to
  // dropped projects also drop, so the task-throughput chart stays
  // consistent with the project-level numbers.
  const projects = allProjects.filter((p) => !isAdminProject(p));
  const portfolioProjectIds = new Set(projects.map((p) => p.project_id));
  const tasks = allTasks.filter((t) => portfolioProjectIds.has(t.project_id));

  const computed = computeVelocityMetrics(
    projects,
    tasks,
    ideas,
    filters,
    now,
  );
  setCachedVelocityMetrics(filters, computed);

  const payload: VelocityMetrics = { ...computed, from_cache: false };
  return NextResponse.json({ metrics: payload });
});
