/**
 * Pure computation of the Velocity & Throughput metrics (Section 5.15).
 *
 * Every function in this file is side-effect-free and synchronous: it
 * takes already-loaded projects / tasks / ideas plus a filter set, and
 * returns a `VelocityMetrics` shape. The API route is the place that
 * loads from the repositories and applies the cache wrapper around us.
 *
 * Section 5.15 lists seven metrics. Five of them are exact computations
 * over fields we persist; two (`stage_cycle_time`, `blocked_time`) ask
 * about transitions in project status / stage that we don't track in a
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
  ProjectType,
  Task,
  UserId,
} from "@/lib/db";
import {
  PORTFOLIO_PROJECT_TYPES,
  hasReachedProductization,
  stagesForTrack,
} from "@/lib/projects/display";
import { isDeployed, isPostDeployment } from "@/lib/projects/post-deployment";
import { daysInStage } from "@/lib/projects/stage-age";

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
  OnTimeDeliveryMetric,
  PostReleaseMetric,
  PostReleaseStageBar,
  StageCycleTimeMetric,
  QuarterBar,
  TaskThroughputMetric,
  ThroughputBar,
  VelocityFilters,
  VelocityMetrics,
  VelocityRange,
  VelocityRangeKind,
} from "./types";
import { matchesProductFilter } from "@/lib/products/logic";

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
      filters.programs.length > 0 &&
      !filters.programs.includes(p.program)
    ) {
      return false;
    }
    if (
      filters.project_leads.length > 0 &&
      !filters.project_leads.includes(p.project_lead)
    ) {
      return false;
    }
    if (
      filters.nice_product_ids &&
      !matchesProductFilter(p.nice_product_ids, filters.nice_product_ids)
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
 * "Delivered" means the project reached Productization (or a later stage):
 * the functionality has shipped. Post-release work (handover, services
 * validation, adoption) can run for months afterwards, so status
 * `Completed` is deliberately NOT the delivery signal.
 *
 * Canceled projects are excluded: closing one out parks it at
 * Productization (`closedOutStage`), which says nothing about shipping.
 *
 * Returns the date it shipped: `productization_reached_at` (migration
 * 0043), falling back to `stage_entered_at` then `updated_at` for rows
 * that predate it. Null when the project hasn't shipped.
 */
export function deliveredAt(p: Project): string | null {
  if (p.status === "Canceled") return null;
  if (!hasReachedProductization(p.track, p.stage)) return null;
  return p.productization_reached_at ?? p.stage_entered_at ?? p.updated_at;
}

/** Projects that shipped inside the range, with their delivery date. */
function deliveredInRange(
  projects: Project[],
  range: VelocityRange,
): { project: Project; delivered_at: string }[] {
  const out: { project: Project; delivered_at: string }[] = [];
  for (const project of projects) {
    const delivered_at = deliveredAt(project);
    if (delivered_at && withinRange(delivered_at, range)) {
      out.push({ project, delivered_at });
    }
  }
  return out;
}

/**
 * Count projects that reached Productization inside the configured range,
 * bucketed by the quarter they got there (see `deliveredAt`).
 */
export function computeCompletedByQuarter(
  projects: Project[],
  range: VelocityRange,
): CompletedByQuarterMetric {
  const inRange = deliveredInRange(projects, range);
  const counts = new Map<string, number>();
  for (const { delivered_at } of inRange) {
    const q = quarterKey(delivered_at);
    counts.set(q, (counts.get(q) ?? 0) + 1);
  }
  // Fill in zero-bars for any quarter inside the range that had no
  // completions, so the chart doesn't have phantom "gap" weeks the eye
  // misreads as discontinuity.
  const bars = expandQuartersInRange(range, counts);
  return {
    bars,
    total_completed: inRange.length,
    data_quality: "actual",
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
  const completed = deliveredInRange(projects, range)
    .map(({ project: p, delivered_at }) => {
      const lead_days = daysBetween(p.date_added, delivered_at);
      // Cycle time is only meaningful when both endpoints exist and
      // the start is at or before the end. We *don't* fall back to
      // date_added for missing start_date — that would silently
      // duplicate the lead-time metric and obscure how much real
      // cycle-time data we have.
      const cycle_days =
        p.roadmap_timeline_start &&
        p.roadmap_timeline_start <= delivered_at.slice(0, 10)
          ? daysBetween(p.roadmap_timeline_start, delivered_at)
          : null;
      return { project: p, delivered_at, days: lead_days, cycle_days };
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
    const q = quarterKey(row.delivered_at);
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
    data_quality: sample_size === 0 ? "insufficient" : "actual",
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
  const delivered = deliveredInRange(projects, range);

  const points: EstVsActualPoint[] = [];
  let excluded = 0;
  let deltaSum = 0;
  for (const { project: p, delivered_at } of delivered) {
    const actual_days = daysBetween(p.date_added, delivered_at);
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
      points.length === 0 ? "insufficient" : "actual",
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
// Metric: Time in current stage
// ---------------------------------------------------------------------------

/**
 * How long open projects have been sitting in their CURRENT stage, per
 * stage. Uses `stage_entered_at` (stamped by a database trigger whenever
 * the stage changes, migration 0042), so it is exact for the projects it
 * covers. It's a snapshot of today, so the date range doesn't apply; the
 * other filters (type, program, lead, product) still do.
 *
 * Completed and Canceled projects are skipped (they're no longer moving).
 * Projects past Productization are included: their post-release stages
 * (handover, validation, adoption) are exactly where time pools up.
 *
 * This is time-so-far in the current stage, not completed-stage duration:
 * a stage-history table would be needed to average finished stages.
 *
 * Bars follow each present track's own stage order (`stagesForTrack`),
 * then any stray stored value not in those lists.
 */
export function computeStageCycleTime(
  projects: Project[],
  now: Date,
): StageCycleTimeMetric {
  const open = projects.filter(
    (p) => p.status !== "Completed" && p.status !== "Canceled",
  );

  const buckets = new Map<string, { sum: number; n: number; max: number }>();
  const sampled: Project[] = [];
  for (const p of open) {
    const days = daysInStage(p, now);
    if (days === null) continue;
    sampled.push(p);
    const acc = buckets.get(p.stage) ?? { sum: 0, n: 0, max: 0 };
    acc.sum += days;
    acc.n += 1;
    acc.max = Math.max(acc.max, days);
    buckets.set(p.stage, acc);
  }

  const orderedStages = orderStagesForTracks(
    sampled.map((p) => p.track),
    () => true,
  );
  for (const s of buckets.keys()) {
    if (!orderedStages.includes(s)) orderedStages.push(s);
  }

  const bars = orderedStages.map((stage) => {
    const acc = buckets.get(stage);
    return {
      stage,
      avg_days: acc && acc.n > 0 ? acc.sum / acc.n : 0,
      sample_size: acc?.n ?? 0,
      max_days: acc?.max ?? 0,
    };
  });

  return {
    bars,
    data_quality: sampled.length === 0 ? "insufficient" : "actual",
    note:
      "Snapshot of open projects: days since each entered its current stage " +
      "(ignores the date range). Averages of finished stages need a stage-history table.",
  };
}

/**
 * Stage names for the tracks present, in each track's own order, de-duped,
 * keeping only stages `keep` accepts.
 */
function orderStagesForTracks(
  tracks: string[],
  keep: (track: string, stage: string) => boolean,
): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const t of new Set(tracks)) {
    for (const s of stagesForTrack(t)) {
      if (!seen.has(s) && keep(t, s)) {
        seen.add(s);
        out.push(s);
      }
    }
  }
  return out;
}

// ---------------------------------------------------------------------------
// Metric: Blocked Time
// ---------------------------------------------------------------------------

interface BlockedEpisode {
  project_id: string;
  /** Inclusive start / exclusive end, as YYYY-MM-DD. */
  start: string;
  end: string;
  ongoing: boolean;
}

/**
 * Blocked stretches reconstructed from a project's status history: an
 * episode starts at the entry that moves it to Blocked and ends at the next
 * entry that moves it elsewhere (or runs to today while it is still
 * Blocked). Summary-only notes (status unchanged) are ignored.
 */
function blockedEpisodes(p: Project, now: Date): BlockedEpisode[] {
  const hist = [...(p.status_history ?? [])].sort((a, b) =>
    a.changed_at.localeCompare(b.changed_at),
  );
  const out: BlockedEpisode[] = [];
  let start: string | null = null;
  for (const h of hist) {
    if (h.status === "Blocked") {
      if (start === null) start = h.changed_at.slice(0, 10);
    } else if (start !== null) {
      out.push({
        project_id: p.project_id,
        start,
        end: h.changed_at.slice(0, 10),
        ongoing: false,
      });
      start = null;
    }
  }
  if (start !== null && p.status === "Blocked") {
    out.push({
      project_id: p.project_id,
      start,
      end: isoDate(now),
      ongoing: true,
    });
  }
  return out;
}

/**
 * Real days spent in Blocked status, from status history, bucketed by the
 * quarter each blocked day falls in (an episode spanning quarters is split).
 * Episodes are clipped to the date range. Also reports the episode count,
 * the average length of finished episodes, and how many projects are blocked
 * right now.
 *
 * Blocked stretches that happened before status history was recorded can't
 * be seen; a project that is Blocked with no matching history entry
 * contributes nothing.
 */
export function computeBlockedTime(
  projects: Project[],
  range: VelocityRange,
  now: Date = new Date(),
): BlockedTimeMetric {
  const daysByQ = new Map<string, number>();
  const projectsByQ = new Map<string, Set<string>>();
  let episodeCount = 0;
  let finishedSum = 0;
  let finishedN = 0;

  for (const p of projects) {
    for (const ep of blockedEpisodes(p, now)) {
      const s = range.start && ep.start < range.start ? range.start : ep.start;
      const e = ep.end > range.end ? range.end : ep.end;
      if (e < s) continue;
      // An episode that starts and ends on the same day still counts as an
      // episode, just with zero full days.
      episodeCount++;
      if (!ep.ongoing) {
        finishedSum += daysBetween(ep.start, ep.end);
        finishedN++;
      }
      let cursor = s;
      let safety = 0;
      while (cursor < e && safety++ < 3660) {
        const q = quarterKey(cursor);
        daysByQ.set(q, (daysByQ.get(q) ?? 0) + 1);
        cursor = isoDate(addDays(new Date(cursor + "T00:00:00Z"), 1));
      }
      const q0 = quarterKey(s);
      const set = projectsByQ.get(q0) ?? new Set<string>();
      set.add(ep.project_id);
      projectsByQ.set(q0, set);
    }
  }
  // Make sure quarters that only have blocked days (not an episode start)
  // still appear in the axis.
  const axis = new Map<string, number>();
  for (const q of daysByQ.keys()) axis.set(q, projectsByQ.get(q)?.size ?? 0);
  for (const [q, set] of projectsByQ) axis.set(q, set.size);

  const bars: BlockedTimeBar[] = expandQuartersInRange(range, axis).map(
    (bar) => ({
      quarter: bar.quarter,
      days: daysByQ.get(bar.quarter) ?? 0,
      project_count: bar.count,
    }),
  );

  return {
    bars,
    total_blocked_days: bars.reduce((s, b) => s + b.days, 0),
    episode_count: episodeCount,
    avg_episode_days: finishedN === 0 ? null : finishedSum / finishedN,
    currently_blocked: projects.filter((p) => p.status === "Blocked").length,
    data_quality: episodeCount === 0 ? "insufficient" : "actual",
    note:
      "Days in Blocked status reconstructed from each project's status history, " +
      "split across quarters. Blocked stretches before history was recorded aren't included.",
  };
}

// ---------------------------------------------------------------------------
// Metric: Post-release work
// ---------------------------------------------------------------------------

/**
 * What happens after a project ships. Open post-release work (stage at or
 * past Productization, status still open) is a snapshot of today: how many
 * projects, where they sit (Productization awaiting handover, Services
 * Validation, ...), how long they've been there and since delivery. The
 * closed side is a range-filtered look at projects that finished that work:
 * days from reaching Productization to being marked Completed.
 */
export function computePostRelease(
  projects: Project[],
  range: VelocityRange,
  now: Date,
): PostReleaseMetric {
  const today = isoDate(now);
  const open = projects.filter(isPostDeployment);

  const buckets = new Map<
    string,
    { n: number; sinceSum: number; inStageSum: number; inStageN: number }
  >();
  let sinceSum = 0;
  let oldest: PostReleaseMetric["oldest"] = null;
  for (const p of open) {
    const delivered = deliveredAt(p);
    const since = delivered ? Math.max(0, daysBetween(delivered, today)) : 0;
    sinceSum += since;
    if (!oldest || since > oldest.days) {
      oldest = { project_id: p.project_id, project_name: p.name, days: since };
    }
    const acc = buckets.get(p.stage) ?? {
      n: 0,
      sinceSum: 0,
      inStageSum: 0,
      inStageN: 0,
    };
    acc.n += 1;
    acc.sinceSum += since;
    const inStage = daysInStage(p, now);
    if (inStage !== null) {
      acc.inStageSum += inStage;
      acc.inStageN += 1;
    }
    buckets.set(p.stage, acc);
  }

  const orderedStages = orderStagesForTracks(
    open.map((p) => p.track),
    (t, s) => hasReachedProductization(t, s),
  );
  for (const s of buckets.keys()) {
    if (!orderedStages.includes(s)) orderedStages.push(s);
  }
  const stages: PostReleaseStageBar[] = orderedStages.map((stage) => {
    const acc = buckets.get(stage);
    return {
      stage,
      count: acc?.n ?? 0,
      avg_days_in_stage:
        acc && acc.inStageN > 0 ? acc.inStageSum / acc.inStageN : null,
      avg_days_since_delivery: acc && acc.n > 0 ? acc.sinceSum / acc.n : null,
    };
  });

  // Closed side: delivered projects now marked Completed, closed in range.
  const closedDays: number[] = [];
  for (const p of projects) {
    if (p.status !== "Completed") continue;
    const delivered = deliveredAt(p);
    if (!delivered) continue;
    const completedEntry = [...(p.status_history ?? [])]
      .reverse()
      .find((h) => h.status === "Completed");
    const completedAt = completedEntry?.changed_at ?? p.updated_at;
    if (!withinRange(completedAt, range)) continue;
    closedDays.push(Math.max(0, daysBetween(delivered, completedAt)));
  }

  return {
    open_count: open.length,
    stages,
    avg_days_since_delivery: open.length === 0 ? null : sinceSum / open.length,
    oldest,
    closed_count: closedDays.length,
    avg_days_to_close:
      closedDays.length === 0
        ? null
        : closedDays.reduce((s, d) => s + d, 0) / closedDays.length,
    data_quality:
      open.length === 0 && closedDays.length === 0 ? "insufficient" : "actual",
    note:
      "Open work is a snapshot of today (ignores the date range). " +
      "Closed = delivered projects marked Completed within the range.",
  };
}

// ---------------------------------------------------------------------------
// Metric: On-time delivery
// ---------------------------------------------------------------------------

/**
 * Target vs actual delivery. For each project that reached Productization in
 * the range and had an Application Release target date (`target_date`),
 * compare the date it shipped with that target: on time when it shipped on
 * or before the target. Also counts open, not-yet-shipped projects whose
 * target date has already passed.
 */
export function computeOnTimeDelivery(
  projects: Project[],
  range: VelocityRange,
  now: Date,
): OnTimeDeliveryMetric {
  const delivered = deliveredInRange(projects, range);

  let onTime = 0;
  let late = 0;
  let noTarget = 0;
  let deltaSum = 0;
  let lateSum = 0;
  const byQ = new Map<string, { on_time: number; late: number }>();
  for (const { project: p, delivered_at } of delivered) {
    if (!p.target_date) {
      noTarget++;
      continue;
    }
    const delta = daysBetween(p.target_date, delivered_at);
    deltaSum += delta;
    const q = quarterKey(delivered_at);
    const acc = byQ.get(q) ?? { on_time: 0, late: 0 };
    if (delta <= 0) {
      onTime++;
      acc.on_time++;
    } else {
      late++;
      lateSum += delta;
      acc.late++;
    }
    byQ.set(q, acc);
  }
  const withTarget = onTime + late;

  const counts = new Map<string, number>();
  for (const [q, v] of byQ) counts.set(q, v.on_time + v.late);
  const by_quarter = expandQuartersInRange(range, counts).map((bar) => ({
    quarter: bar.quarter,
    on_time: byQ.get(bar.quarter)?.on_time ?? 0,
    late: byQ.get(bar.quarter)?.late ?? 0,
  }));

  const today = isoDate(now);
  const overdue_open = projects.filter(
    (p) =>
      p.status !== "Completed" &&
      p.status !== "Canceled" &&
      !isDeployed(p) &&
      !!p.target_date &&
      p.target_date < today,
  ).length;

  return {
    with_target: withTarget,
    on_time: onTime,
    late,
    no_target: noTarget,
    on_time_rate: withTarget === 0 ? 0 : (onTime / withTarget) * 100,
    mean_delta_days: withTarget === 0 ? 0 : deltaSum / withTarget,
    avg_days_late: late === 0 ? null : lateSum / late,
    overdue_open,
    by_quarter,
    data_quality: withTarget === 0 ? "insufficient" : "actual",
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
  const stage_cycle_time = computeStageCycleTime(filteredProjects, now);
  const blocked_time = computeBlockedTime(filteredProjects, filters.range, now);
  const post_release = computePostRelease(filteredProjects, filters.range, now);
  const on_time_delivery = computeOnTimeDelivery(
    filteredProjects,
    filters.range,
    now,
  );
  const idea_conversion = computeIdeaConversion(filteredIdeas, filters.range);

  // Section 5.15 calibration banner trigger.
  const insufficient_history = avg_time_to_completion.sample_size < 3;

  // Filter options from the unfiltered pool.
  const product_set = new Set<string>();
  const program_set = new Set<string>();
  const lead_set = new Set<UserId>();
  for (const p of allProjects) {
    if (p.application_product) product_set.add(p.application_product);
    if (p.program) program_set.add(p.program);
    if (p.project_lead) lead_set.add(p.project_lead);
  }

  return {
    filters,
    computed_at: now.toISOString(),
    completed_by_quarter,
    avg_time_to_completion,
    estimated_vs_actual,
    task_throughput,
    stage_cycle_time,
    blocked_time,
    post_release,
    on_time_delivery,
    idea_conversion,
    insufficient_history,
    filter_options: {
      project_types: [...PORTFOLIO_PROJECT_TYPES],
      application_products: Array.from(product_set).sort((a, b) => a.localeCompare(b)),
      programs: Array.from(program_set).sort((a, b) => a.localeCompare(b)),
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
