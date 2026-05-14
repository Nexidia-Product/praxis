/**
 * Pure computation of the Velocity & Throughput metrics (Section 5.15).
 *
 * Every function in this file is side-effect-free and synchronous: it
 * takes already-loaded projects / tasks / ideas plus a filter set, and
 * returns a `VelocityMetrics` shape. The API route is the place that
 * loads from the repositories and applies the cache wrapper around us.
 *
 * Section 5.15 lists seven metrics. Five of them are exact computations
 * over fields we persist; two (`phase_cycle_time`, `blocked_time`) ask
 * about transitions in project status / phase that we don't track in a
 * history log today. Rather than synthesize numbers that look real but
 * aren't, those two metrics fall back to a documented proxy and report
 * `data_quality: "proxy"` along with a `note` the UI surfaces. When the
 * project records carry no signal at all, the metric reports
 * `data_quality: "insufficient"` and an empty bar list.
 *
 * Why "proxy" and not "skip":
 *
 *   - Section 5.15 calls these metrics out as user-facing — hiding them
 *     would leave a hole in a dashboard the design promises will be
 *     "essential for capacity planning". Showing the best signal we
 *     have, with a clear note, is more useful than an absent chart.
 *
 *   - The proxies are conservative: phase cycle time uses
 *     `updated_at − date_added` against the *current* phase distribution,
 *     which becomes accurate once we track transitions and meaningless
 *     before then — but always non-negative. Blocked time counts the
 *     number of projects currently in Blocked status per quarter of
 *     `updated_at`, treating "still Blocked" as a one-day contribution.
 *
 *   - When status-history persistence ships, both metrics swap to
 *     authoritative computations without changing their public shape.
 */

import type {
  IsoDate,
  Project,
  ProjectIdea,
  ProjectPhase,
  ProjectType,
  Task,
  UserId,
} from "@/lib/db";
import {
  PORTFOLIO_PROJECT_TYPES,
  PROJECT_PHASES,
} from "@/lib/projects/display";

import type {
  AvgTimeByType,
  AvgTimeToCompletionMetric,
  AvgTimeTrendPoint,
  BlockedTimeBar,
  BlockedTimeMetric,
  CompletedByQuarterMetric,
  EstVsActualMetric,
  EstVsActualPoint,
  IdeaConversionMetric,
  PhaseCycleTimeMetric,
  QuarterBar,
  TaskThroughputMetric,
  ThroughputBar,
  VelocityFilters,
  VelocityMetrics,
  VelocityRange,
  VelocityRangeKind,
} from "./types";

// ---------------------------------------------------------------------------
// Range resolution
// ---------------------------------------------------------------------------

/**
 * Turn a `VelocityRangeKind` into a concrete `{ start, end }` window.
 * `now` is injectable for tests; production should pass `new Date()`.
 *
 * "all" returns `start: null` so downstream filters skip the lower bound.
 * "custom" passes through the caller-supplied dates unchanged.
 */
export function resolveRange(
  kind: VelocityRangeKind,
  now: Date,
  custom?: { start?: IsoDate | null; end?: IsoDate | null },
): VelocityRange {
  const end = isoDate(now);
  if (kind === "all") return { kind, start: null, end };
  if (kind === "custom") {
    return {
      kind,
      start: custom?.start ?? null,
      end: custom?.end ?? end,
    };
  }
  const days = kind === "30d" ? 30 : kind === "90d" ? 90 : kind === "6mo" ? 183 : 365;
  const start = isoDate(addDays(now, -days));
  return { kind, start, end };
}

// ---------------------------------------------------------------------------
// Filter application
// ---------------------------------------------------------------------------

/**
 * Apply the filter set's project-level filters (type, application, lead,
 * individual) to a project list. The range filter is handled per-metric
 * because each metric anchors on a different date field — `range` here
 * is a no-op.
 */
export function applyProjectFilters(
  projects: Project[],
  filters: VelocityFilters,
): Project[] {
  return projects.filter((p) => {
    if (
      filters.project_types.length > 0 &&
      !filters.project_types.includes(p.project_type)
    ) {
      return false;
    }
    if (
      filters.application_products.length > 0 &&
      !filters.application_products.includes(p.application_product)
    ) {
      return false;
    }
    if (
      filters.project_leads.length > 0 &&
      !filters.project_leads.includes(p.project_lead)
    ) {
      return false;
    }
    if (filters.individual_user_id) {
      // Individual view: lead OR additional_resources contains the user.
      const me = filters.individual_user_id;
      const inResources = p.additional_resources.includes(me);
      if (p.project_lead !== me && !inResources) return false;
    }
    return true;
  });
}

/**
 * Restrict tasks to those whose parent projects are in the filtered set
 * (delivered as a Set for O(1) lookup), and — when the filter set names
 * an individual — those whose `responsible` is that user.
 */
export function applyTaskFilters(
  tasks: Task[],
  filteredProjectIds: ReadonlySet<string>,
  filters: VelocityFilters,
): Task[] {
  return tasks.filter((t) => {
    if (!filteredProjectIds.has(t.project_id)) return false;
    if (
      filters.individual_user_id &&
      t.responsible !== filters.individual_user_id &&
      !t.additional_assignees.includes(filters.individual_user_id)
    ) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// Metric: Projects Completed per Quarter
// ---------------------------------------------------------------------------

/**
 * Count projects whose status is `Completed` and whose `updated_at` —
 * our proxy for "completed at" — falls within the configured range.
 * Bucketed by the quarter that proxy date lands in.
 *
 * Why `updated_at` as the proxy: when a project transitions to
 * `Completed`, the project service writes the record, which sets
 * `updated_at`. Without a status-transition history this is the closest
 * timestamp the data offers; a project that's been Completed for months
 * but hasn't been touched will register on the date of its last edit,
 * which is the same convention used elsewhere in the app.
 */
export function computeCompletedByQuarter(
  projects: Project[],
  range: VelocityRange,
): CompletedByQuarterMetric {
  const completed = projects.filter((p) => p.status === "Completed");
  const inRange = completed.filter((p) => withinRange(p.updated_at, range));
  const counts = new Map<string, number>();
  for (const p of inRange) {
    const q = quarterKey(p.updated_at);
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  // Fill in zero-bars for any quarter inside the range that had no
  // completions, so the chart doesn't have phantom "gap" weeks the eye
  // misreads as discontinuity.
  const bars = expandQuartersInRange(range, counts);
  return {
    bars,
    total_completed: inRange.length,
    data_quality: "proxy",
  };
}

// ---------------------------------------------------------------------------
// Metric: Average Time to Completion
// ---------------------------------------------------------------------------

/**
 * For each completed project in the range, compute days from
 * `date_added` to `updated_at` (proxy for completed-at) — that's the
 * lead-time metric.
 *
 * Also compute cycle time (`updated_at - roadmap_timeline_start`) for
 * the subset of projects that have a planned start date recorded. Both
 * metrics are reported in parallel: the lead-time line is the historic
 * "wall-clock from spreadsheet entry to done" measure, while cycle
 * time more honestly captures actual delivery duration. Most older
 * seeded projects don't have start dates, so cycle time will populate
 * only as new projects flow through the auto-set logic in
 * `lib/projects/service.ts`.
 */
export function computeAvgTimeToCompletion(
  projects: Project[],
  range: VelocityRange,
): AvgTimeToCompletionMetric {
  const completed = projects
    .filter((p) => p.status === "Completed")
    .filter((p) => withinRange(p.updated_at, range))
    .map((p) => {
      const lead_days = daysBetween(p.date_added, p.updated_at);
      // Cycle time is only meaningful when both endpoints exist and
      // the start is at or before the end. We *don't* fall back to
      // date_added for missing start_date — that would silently
      // duplicate the lead-time metric and obscure how much real
      // cycle-time data we have.
      const cycle_days =
        p.roadmap_timeline_start &&
        p.roadmap_timeline_start <= p.updated_at.slice(0, 10)
          ? daysBetween(p.roadmap_timeline_start, p.updated_at)
          : null;
      return { project: p, days: lead_days, cycle_days };
    })
    // Defensive guard — a hand-edited record could give a negative.
    .filter((row) => row.days >= 0);

  // By type — track both totals.
  const byTypeMap = new Map<
    ProjectType,
    { sum: number; n: number; cycleSum: number; cycleN: number }
  >();
  for (const row of completed) {
    const acc = byTypeMap.get(row.project.project_type) ?? {
      sum: 0,
      n: 0,
      cycleSum: 0,
      cycleN: 0,
    };
    acc.sum += row.days;
    acc.n += 1;
    if (row.cycle_days !== null && row.cycle_days >= 0) {
      acc.cycleSum += row.cycle_days;
      acc.cycleN += 1;
    }
    byTypeMap.set(row.project.project_type, acc);
  }
  // Portfolio types only — Admin work is filtered out of the velocity
  // dataset upstream (see the API route). Iterating PROJECT_TYPES here
  // would emit an Admin row with sample_size 0 forever, which would
  // confuse anyone reading the chart; iterate the portfolio list so
  // the breakdown matches the data the dashboard actually shows.
  const by_type: AvgTimeByType[] = PORTFOLIO_PROJECT_TYPES.map((t) => {
    const acc = byTypeMap.get(t);
    return {
      project_type: t,
      avg_days: acc && acc.n > 0 ? acc.sum / acc.n : 0,
      sample_size: acc?.n ?? 0,
      avg_cycle_days:
        acc && acc.cycleN > 0 ? acc.cycleSum / acc.cycleN : null,
      cycle_sample_size: acc?.cycleN ?? 0,
    };
  });

  // Quarterly trend — same dual-track aggregation.
  const trendMap = new Map<
    string,
    { sum: number; n: number; cycleSum: number; cycleN: number }
  >();
  for (const row of completed) {
    const q = quarterKey(row.project.updated_at);
    const acc = trendMap.get(q) ?? {
      sum: 0,
      n: 0,
      cycleSum: 0,
      cycleN: 0,
    };
    acc.sum += row.days;
    acc.n += 1;
    if (row.cycle_days !== null && row.cycle_days >= 0) {
      acc.cycleSum += row.cycle_days;
      acc.cycleN += 1;
    }
    trendMap.set(q, acc);
  }
  const trendCounts = new Map<string, number>();
  for (const [q, acc] of trendMap) trendCounts.set(q, acc.n);
  const trend: AvgTimeTrendPoint[] = expandQuartersInRange(
    range,
    trendCounts,
  ).map((bar) => {
    const acc = trendMap.get(bar.quarter);
    return {
      quarter: bar.quarter,
      avg_days: acc && acc.n > 0 ? acc.sum / acc.n : 0,
      sample_size: acc?.n ?? 0,
      avg_cycle_days:
        acc && acc.cycleN > 0 ? acc.cycleSum / acc.cycleN : null,
      cycle_sample_size: acc?.cycleN ?? 0,
    };
  });

  const sample_size = completed.length;
  const overall_avg_days =
    sample_size === 0
      ? 0
      : completed.reduce((s, r) => s + r.days, 0) / sample_size;

  const cycleSubset = completed.filter(
    (r) => r.cycle_days !== null && r.cycle_days >= 0,
  );
  const cycle_sample_size = cycleSubset.length;
  const overall_avg_cycle_days =
    cycle_sample_size === 0
      ? null
      : cycleSubset.reduce((s, r) => s + (r.cycle_days ?? 0), 0) /
        cycle_sample_size;

  return {
    by_type,
    trend,
    overall_avg_days,
    sample_size,
    overall_avg_cycle_days,
    cycle_sample_size,
    data_quality: sample_size === 0 ? "insufficient" : "proxy",
  };
}

// ---------------------------------------------------------------------------
// Metric: Estimated vs Actual Duration
// ---------------------------------------------------------------------------

/**
 * Compare each completed project's actual duration against the AI's
 * estimate. The estimate is a free-form string ("4-6 weeks", "2 months",
 * "10-15 days"); see `parseEstimateToDays` for the formats we handle.
 * Projects whose estimate doesn't parse are excluded from the scatter
 * but reported in `excluded_count` so the UI can explain the missing
 * dots.
 */
export function computeEstimatedVsActual(
  projects: Project[],
  range: VelocityRange,
): EstVsActualMetric {
  const completed = projects
    .filter((p) => p.status === "Completed")
    .filter((p) => withinRange(p.updated_at, range));

  const points: EstVsActualPoint[] = [];
  let excluded = 0;
  let deltaSum = 0;
  for (const p of completed) {
    const actual_days = daysBetween(p.date_added, p.updated_at);
    if (actual_days < 0) {
      excluded++;
      continue;
    }
    const estimated_days = parseEstimateToDays(p.ai_time_estimate);
    if (estimated_days === null) {
      excluded++;
      continue;
    }
    points.push({
      project_id: p.project_id,
      project_name: p.name,
      project_type: p.project_type,
      estimated_days,
      actual_days,
    });
    deltaSum += actual_days - estimated_days;
  }

  const mean_delta_days = points.length > 0 ? deltaSum / points.length : 0;

  return {
    points,
    mean_delta_days,
    sample_size: points.length,
    excluded_count: excluded,
    data_quality:
      points.length === 0 ? "insufficient" : "proxy",
  };
}

/**
 * Best-effort parser for the free-form `ai_time_estimate` field.
 *
 * Recognized shapes (case-insensitive, whitespace-tolerant):
 *
 *   "4-6 weeks"     → midpoint of (4 weeks, 6 weeks) = 35 days
 *   "10 days"       → 10 days
 *   "2 months"      → 60 days  (1 month = 30 days)
 *   "1.5 weeks"     → 10.5 days
 *   "~3 weeks"      → 21 days  (the tilde is stripped before parsing)
 *
 * Anything else returns null. Exported for the smoke test.
 */
export function parseEstimateToDays(estimate: string | null): number | null {
  if (!estimate) return null;
  const cleaned = estimate.toLowerCase().replace(/[~]/g, "").trim();

  // Range form: "4-6 weeks", "10-15 days", "1-2 months".
  const range = cleaned.match(/^(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months)$/);
  if (range) {
    const lo = parseFloat(range[1]);
    const hi = parseFloat(range[2]);
    const unit = unitToDays(range[3]);
    if (unit === null) return null;
    return ((lo + hi) / 2) * unit;
  }

  // Single form: "10 days", "2 months".
  const single = cleaned.match(/^(\d+(?:\.\d+)?)\s*(day|days|week|weeks|month|months)$/);
  if (single) {
    const n = parseFloat(single[1]);
    const unit = unitToDays(single[2]);
    if (unit === null) return null;
    return n * unit;
  }

  return null;
}

function unitToDays(unit: string): number | null {
  if (unit === "day" || unit === "days") return 1;
  if (unit === "week" || unit === "weeks") return 7;
  if (unit === "month" || unit === "months") return 30;
  return null;
}

// ---------------------------------------------------------------------------
// Metric: Task Throughput
// ---------------------------------------------------------------------------

/**
 * Count Complete-status tasks bucketed into ISO weeks (Monday start, UTC).
 * Uses task `updated_at` as the proxy for "completed at" — same proxy
 * convention as completed projects, for the same reason.
 */
export function computeTaskThroughput(
  tasks: Task[],
  range: VelocityRange,
): TaskThroughputMetric {
  const completed = tasks.filter((t) => t.status === "Complete");
  const inRange = completed.filter((t) => withinRange(t.updated_at, range));

  const counts = new Map<string, number>();
  for (const t of inRange) {
    const wk = weekKey(t.updated_at);
    counts.set(wk, (counts.get(wk) ?? 0) + 1);
  }
  const weeks: ThroughputBar[] = expandWeeksInRange(range, counts);
  const total = inRange.length;
  const mean_per_week =
    weeks.length === 0 ? 0 : weeks.reduce((s, w) => s + w.count, 0) / weeks.length;

  return {
    weeks,
    total_completed: total,
    mean_per_week,
    data_quality: "actual",
  };
}

// ---------------------------------------------------------------------------
// Metric: Phase Cycle Time
// ---------------------------------------------------------------------------

/**
 * Average days per phase. Without a phase-transition log (Phase 2 work,
 * Section 8/10), we approximate using each project's *current* phase and
 * the time elapsed since `date_added`. This means:
 *
 *   - A project that's been in Application Development for 30 days
 *     contributes 30 to that phase's bucket.
 *   - Projects in Closeout will skew long; projects in Qualification
 *     will skew short; that's expected for a snapshot proxy.
 *   - The number stops being meaningful once status-transition history
 *     ships and replaces this implementation.
 *
 * The metric reports `data_quality: "proxy"` and a note explaining the
 * limitation. The note flows into the chart card as a footnote.
 */
export function computePhaseCycleTime(
  projects: Project[],
  range: VelocityRange,
): PhaseCycleTimeMetric {
  // Anchor on `updated_at` for the range filter so a stale project
  // doesn't dominate when the user picks "last 30 days".
  const inRange = projects.filter((p) => withinRange(p.updated_at, range));

  const buckets = new Map<ProjectPhase, { sum: number; n: number }>();
  for (const p of inRange) {
    const days = daysBetween(p.date_added, p.updated_at);
    if (days < 0) continue;
    const acc = buckets.get(p.phase) ?? { sum: 0, n: 0 };
    acc.sum += days;
    acc.n += 1;
    buckets.set(p.phase, acc);
  }

  const bars = PROJECT_PHASES.map((phase) => {
    const acc = buckets.get(phase);
    return {
      phase,
      avg_days: acc && acc.n > 0 ? acc.sum / acc.n : 0,
      sample_size: acc?.n ?? 0,
    };
  });

  return {
    bars,
    data_quality:
      inRange.length === 0 ? "insufficient" : "proxy",
    note:
      "Approximated from each project's current phase and time since creation. " +
      "Becomes exact once status-transition history is persisted.",
  };
}

// ---------------------------------------------------------------------------
// Metric: Blocked Time
// ---------------------------------------------------------------------------

/**
 * Total project-days spent in Blocked status, bucketed by quarter. With
 * no status history, "spent in Blocked" reduces to a one-day attribution
 * for any project whose current status is Blocked, anchored on the
 * project's `updated_at` quarter. The number tells you how many
 * blockages were live this quarter, not how long each one lasted.
 *
 * As with `phase_cycle_time`, this is a placeholder that swaps to the
 * exact computation when history persistence ships.
 */
export function computeBlockedTime(
  projects: Project[],
  range: VelocityRange,
): BlockedTimeMetric {
  const blocked = projects
    .filter((p) => p.status === "Blocked")
    .filter((p) => withinRange(p.updated_at, range));

  const counts = new Map<string, number>();
  for (const p of blocked) {
    const q = quarterKey(p.updated_at);
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  const bars: BlockedTimeBar[] = expandQuartersInRange(range, counts).map(
    (bar) => ({
      quarter: bar.quarter,
      // One day per blocked project as the proxy contribution.
      days: bar.count,
      project_count: bar.count,
    }),
  );

  return {
    bars,
    total_blocked_days: bars.reduce((s, b) => s + b.days, 0),
    data_quality:
      blocked.length === 0 ? "insufficient" : "proxy",
    note:
      "Approximated as one project-day per project currently in Blocked status. " +
      "Becomes exact once status-transition history is persisted.",
  };
}

// ---------------------------------------------------------------------------
// Metric: Idea Conversion Rate
// ---------------------------------------------------------------------------

/**
 * Two numbers: how many ideas were submitted in-range, and how many of
 * those were promoted to a project. The denominator is "submitted" so
 * the percentage stays interpretable even when a slow review backlog
 * means recent submissions haven't been processed yet.
 */
export function computeIdeaConversion(
  ideas: ProjectIdea[],
  range: VelocityRange,
): IdeaConversionMetric {
  const inRange = ideas.filter((i) => withinRange(i.submitted_at, range));
  const total_submitted = inRange.length;
  const total_converted = inRange.filter((i) => i.status === "Converted").length;
  const conversion_rate =
    total_submitted === 0
      ? 0
      : (total_converted / total_submitted) * 100;

  // Per-quarter breakdown.
  const submittedByQ = new Map<string, number>();
  const convertedByQ = new Map<string, number>();
  for (const i of inRange) {
    const q = quarterKey(i.submitted_at);
    submittedByQ.set(q, (submittedByQ.get(q) ?? 0) + 1);
    if (i.status === "Converted") {
      convertedByQ.set(q, (convertedByQ.get(q) ?? 0) + 1);
    }
  }
  const by_quarter = expandQuartersInRange(range, submittedByQ).map((bar) => ({
    quarter: bar.quarter,
    submitted: bar.count,
    converted: convertedByQ.get(bar.quarter) ?? 0,
  }));

  return {
    total_submitted,
    total_converted,
    conversion_rate,
    by_quarter,
    data_quality: total_submitted === 0 ? "insufficient" : "actual",
  };
}

// ---------------------------------------------------------------------------
// Top-level orchestration
// ---------------------------------------------------------------------------

/**
 * Compose every metric into the `VelocityMetrics` payload. The API route
 * is responsible for loading the underlying records and applying the
 * cache; this function just orchestrates the pure work and is therefore
 * trivially testable.
 *
 * Filter options (the values that populate the dashboard's filter
 * dropdowns) are computed from the *unfiltered* project list — restricting
 * them to the current filter set would mean a user can never broaden their
 * own selection.
 */
export function computeVelocityMetrics(
  allProjects: Project[],
  allTasks: Task[],
  allIdeas: ProjectIdea[],
  filters: VelocityFilters,
  now: Date,
): Omit<VelocityMetrics, "from_cache"> {
  const filteredProjects = applyProjectFilters(allProjects, filters);
  const filteredProjectIds = new Set(filteredProjects.map((p) => p.project_id));
  const filteredTasks = applyTaskFilters(allTasks, filteredProjectIds, filters);
  // Ideas are not parented to projects, so the only filter that meaningfully
  // applies is the time range (handled inside `computeIdeaConversion`).
  const filteredIdeas = allIdeas;

  const completed_by_quarter = computeCompletedByQuarter(
    filteredProjects,
    filters.range,
  );
  const avg_time_to_completion = computeAvgTimeToCompletion(
    filteredProjects,
    filters.range,
  );
  const estimated_vs_actual = computeEstimatedVsActual(
    filteredProjects,
    filters.range,
  );
  const task_throughput = computeTaskThroughput(filteredTasks, filters.range);
  const phase_cycle_time = computePhaseCycleTime(filteredProjects, filters.range);
  const blocked_time = computeBlockedTime(filteredProjects, filters.range);
  const idea_conversion = computeIdeaConversion(filteredIdeas, filters.range);

  // Section 5.15 calibration banner trigger.
  const insufficient_history = avg_time_to_completion.sample_size < 3;

  // Filter options from the unfiltered pool.
  const product_set = new Set<string>();
  const lead_set = new Set<UserId>();
  for (const p of allProjects) {
    if (p.application_product) product_set.add(p.application_product);
    if (p.project_lead) lead_set.add(p.project_lead);
  }

  return {
    filters,
    computed_at: now.toISOString(),
    completed_by_quarter,
    avg_time_to_completion,
    estimated_vs_actual,
    task_throughput,
    phase_cycle_time,
    blocked_time,
    idea_conversion,
    insufficient_history,
    filter_options: {
      project_types: [...PORTFOLIO_PROJECT_TYPES],
      application_products: Array.from(product_set).sort((a, b) => a.localeCompare(b)),
      project_leads: Array.from(lead_set)
        .sort((a, b) => a.localeCompare(b))
        .map((id) => ({ user_id: id, label: id })),
    },
  };
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

/** UTC `YYYY-MM-DD`. */
function isoDate(d: Date): IsoDate {
  return d.toISOString().slice(0, 10);
}

function addDays(d: Date, n: number): Date {
  const out = new Date(d);
  out.setUTCDate(out.getUTCDate() + n);
  return out;
}

/**
 * Days between two ISO timestamps / dates. Both endpoints can be either
 * a date string (`YYYY-MM-DD`) or a full ISO timestamp; we slice off any
 * time component so weekend timestamps don't shift quarter boundaries.
 */
export function daysBetween(start: string, end: string): number {
  const s = new Date(start.slice(0, 10) + "T00:00:00Z");
  const e = new Date(end.slice(0, 10) + "T00:00:00Z");
  return Math.round((e.getTime() - s.getTime()) / (24 * 60 * 60 * 1000));
}

/**
 * Is the given timestamp / date string inside the inclusive range?
 * `range.start === null` means "no lower bound" (the "all time" preset).
 */
export function withinRange(ts: string, range: VelocityRange): boolean {
  const date = ts.slice(0, 10);
  if (range.start && date < range.start) return false;
  if (date > range.end) return false;
  return true;
}

/** `YYYY-Q1` … `YYYY-Q4` for the calendar quarter the date falls in. */
export function quarterKey(ts: string): string {
  const date = new Date(ts.slice(0, 10) + "T00:00:00Z");
  const year = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${year}-Q${q}`;
}

/**
 * `YYYY-MM-DD` of the Monday at the start of the ISO week containing
 * the given date. Always UTC; the dashboard runs server-side so we
 * deliberately don't honor a client timezone here.
 */
export function weekKey(ts: string): IsoDate {
  const date = new Date(ts.slice(0, 10) + "T00:00:00Z");
  // getUTCDay(): 0=Sunday … 6=Saturday. Shift so Monday is 0.
  const dow = (date.getUTCDay() + 6) % 7;
  const monday = addDays(date, -dow);
  return isoDate(monday);
}

/**
 * Walk the range quarter by quarter, returning a bar for each — even
 * quarters with zero entries. The first quarter is the one containing
 * `range.start` (or the earliest counted value if start is null); the
 * last is the one containing `range.end`. Without explicit zero-fills,
 * bar charts get visually misleading gaps.
 */
function expandQuartersInRange(
  range: VelocityRange,
  counts: ReadonlyMap<string, number>,
): QuarterBar[] {
  // Determine bounds. If the range has no start, anchor on the earliest
  // quarter we have a data point for; that keeps the X-axis bounded.
  let firstQ: string;
  if (range.start) {
    firstQ = quarterKey(range.start);
  } else if (counts.size === 0) {
    return [];
  } else {
    firstQ = [...counts.keys()].sort()[0];
  }
  const lastQ = quarterKey(range.end);

  const bars: QuarterBar[] = [];
  let cursor = firstQ;
  // Hard cap to defend against pathological ranges (e.g. an out-of-range
  // start that lands in the year 1900 because of a hand-edit). At 200
  // quarters that's 50 years, which is well past anything the dashboard
  // will be asked to render.
  let safety = 0;
  while (cursor <= lastQ && safety++ < 200) {
    bars.push({ quarter: cursor, count: counts.get(cursor) ?? 0 });
    cursor = nextQuarter(cursor);
  }
  return bars;
}

function nextQuarter(q: string): string {
  // `q` is "YYYY-Qn".
  const [yearStr, qStr] = q.split("-Q");
  let year = Number(yearStr);
  let n = Number(qStr) + 1;
  if (n > 4) {
    n = 1;
    year++;
  }
  return `${year}-Q${n}`;
}

/**
 * Walk the range week by week (Monday starts), returning a bar for each.
 * Without a fixed-width axis the bars from a sparse week sit too close
 * together and the chart misreads as bursty when it's not.
 */
function expandWeeksInRange(
  range: VelocityRange,
  counts: ReadonlyMap<string, number>,
): ThroughputBar[] {
  let firstWeek: IsoDate;
  if (range.start) {
    firstWeek = weekKey(range.start);
  } else if (counts.size === 0) {
    return [];
  } else {
    firstWeek = [...counts.keys()].sort()[0];
  }
  const lastWeek = weekKey(range.end);

  const bars: ThroughputBar[] = [];
  let cursor = firstWeek;
  // 5-year safety cap; same reasoning as the quarters expansion.
  let safety = 0;
  while (cursor <= lastWeek && safety++ < 5 * 53) {
    bars.push({ week_start: cursor, count: counts.get(cursor) ?? 0 });
    // Advance 7 days.
    const next = addDays(new Date(cursor + "T00:00:00Z"), 7);
    cursor = isoDate(next);
  }
  return bars;
}
