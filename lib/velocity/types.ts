/**
 * Result types for the Velocity & Throughput Dashboard (Section 5.15).
 *
 * The metric set is computed once per request in `lib/velocity/metrics.ts`,
 * cached for an hour by `lib/velocity/cache.ts`, served by the
 * `/api/dashboard/velocity` route, and consumed by both the on-page React
 * components and the PPTX `velocity` slide builder. Centralizing the shapes
 * here means a single edit covers all four surfaces.
 *
 * Each metric carries enough context to render itself without re-reading
 * the underlying records: chart points include their own labels and the
 * time range they were computed against. The dashboard never goes back to
 * the projects/tasks repos at render time.
 *
 * One field worth calling out: every metric reports `data_quality` so the
 * UI can show the "minimum data warning" Section 5.15 calls for. Without
 * a stable history for status transitions we mark the affected metrics as
 * `proxy` so consumers know the number is a best-effort approximation
 * (Section 5.15 implementation notes accept this — see the comment at the
 * top of `metrics.ts` for the full reasoning).
 */

import type {
  IsoDate,
  IsoTimestamp,
  ProjectPhase,
  ProjectType,
  UserId,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// Filters (the input)
// ---------------------------------------------------------------------------

/**
 * Pre-defined time windows from Section 5.15 plus a custom range escape
 * hatch. The window name flows through to chart titles ("Last 90 days") so
 * the reader doesn't have to interpret the date arithmetic themselves.
 */
export type VelocityRangeKind =
  | "30d"
  | "90d"
  | "6mo"
  | "1yr"
  | "all"
  | "custom";

/**
 * Concrete date window. Pre-defined `kind`s have their `start` and `end`
 * filled in by the resolver before metrics run, so downstream code never
 * branches on the kind — it only reads `start` / `end`.
 */
export interface VelocityRange {
  kind: VelocityRangeKind;
  /** Inclusive lower bound (UTC midnight). `null` when range is "all time". */
  start: IsoDate | null;
  /** Inclusive upper bound (UTC midnight). Always defaults to today. */
  end: IsoDate;
}

/**
 * Per-request filter set. Empty arrays / null values mean "no filter on
 * this dimension" — same convention as the roadmap filter bar.
 */
export interface VelocityFilters {
  range: VelocityRange;
  project_types: ProjectType[];
  application_products: string[];
  project_leads: UserId[];
  /**
   * Individual-contributor view (Section 5.15). When set, the throughput
   * and time-to-completion metrics are scoped to projects led by, or
   * tasks assigned to, this user. Authorization (Admin or self) is
   * enforced at the API route, not here.
   */
  individual_user_id: UserId | null;
}

// ---------------------------------------------------------------------------
// Data quality flag
// ---------------------------------------------------------------------------

/**
 * Some of the Section 5.15 metrics depend on a status-transition history we
 * don't currently persist. We expose the limitation rather than hiding it:
 *
 *   - `actual`         The metric is computed from authoritative fields
 *                      (e.g. task `created_at` and `updated_at` for
 *                      "tasks completed per week").
 *
 *   - `proxy`          The metric is approximated using the best fields
 *                      available (e.g. project `updated_at` as a stand-in
 *                      for "Completed at"). Consumers may want to flag
 *                      this in tooltips or footnotes.
 *
 *   - `insufficient`   The dataset doesn't have enough history yet to
 *                      produce a meaningful number (Section 5.15 calls
 *                      for a minimum-data warning at <3 completed
 *                      projects). The metric still renders, but the
 *                      caller should show a calibration banner.
 */
export type DataQuality = "actual" | "proxy" | "insufficient";

// ---------------------------------------------------------------------------
// Individual metrics
// ---------------------------------------------------------------------------

/** One bar in a quarter-axis chart. */
export interface QuarterBar {
  /** `YYYY-Qn` label — e.g. `2026-Q1`. Always sorts chronologically. */
  quarter: string;
  count: number;
}

export interface CompletedByQuarterMetric {
  bars: QuarterBar[];
  total_completed: number;
  data_quality: DataQuality;
}

/** Per-type breakdown of average days to completion. */
export interface AvgTimeByType {
  project_type: ProjectType;
  /** Lead time = `updated_at − date_added`. Always populated. */
  avg_days: number;
  sample_size: number;
  /**
   * Cycle time = `updated_at − roadmap_timeline_start`. Computed only
   * over the subset of projects that have a `roadmap_timeline_start`
   * set; absent when the subset is empty for this project type.
   */
  avg_cycle_days: number | null;
  /** Sample size for the cycle-time computation; always ≤ sample_size. */
  cycle_sample_size: number;
}

/** One trend point for the rolling average completion time chart. */
export interface AvgTimeTrendPoint {
  /** `YYYY-Qn` quarter the projects in this point completed in. */
  quarter: string;
  /** Lead-time average for projects completing in this quarter. */
  avg_days: number;
  sample_size: number;
  /**
   * Cycle-time average for the subset of those projects that had a
   * `roadmap_timeline_start` recorded. May be null when no projects
   * in the quarter had a start date.
   */
  avg_cycle_days: number | null;
  cycle_sample_size: number;
}

export interface AvgTimeToCompletionMetric {
  by_type: AvgTimeByType[];
  trend: AvgTimeTrendPoint[];
  /** Lead-time overall average (always populated when sample_size > 0). */
  overall_avg_days: number;
  /** Number of completed projects considered. */
  sample_size: number;
  /**
   * Cycle-time overall average across the subset with start_date.
   * Null when the subset is empty.
   */
  overall_avg_cycle_days: number | null;
  /** Sample size for the cycle-time computation. */
  cycle_sample_size: number;
  data_quality: DataQuality;
}

/** One point on the estimated-vs-actual scatter. */
export interface EstVsActualPoint {
  project_id: string;
  project_name: string;
  project_type: ProjectType;
  estimated_days: number;
  actual_days: number;
}

export interface EstVsActualMetric {
  points: EstVsActualPoint[];
  /** Mean signed delta (actual − estimated). Negative = under-estimate. */
  mean_delta_days: number;
  /**
   * Number of completed projects that had a parseable `ai_time_estimate`.
   * Projects without an estimate are excluded from `points` and from this
   * count.
   */
  sample_size: number;
  /**
   * Number of completed projects that lacked a parseable estimate. Helps
   * the dashboard explain why the scatter has fewer points than the
   * "Projects Completed" bar shows.
   */
  excluded_count: number;
  data_quality: DataQuality;
}

/** One bar in a week-axis throughput chart. */
export interface ThroughputBar {
  /** `YYYY-MM-DD` of the first day (Monday, UTC) of the week. */
  week_start: IsoDate;
  count: number;
}

export interface TaskThroughputMetric {
  weeks: ThroughputBar[];
  total_completed: number;
  /** Mean tasks completed per week across the range. */
  mean_per_week: number;
  data_quality: DataQuality;
}

/** Per-phase average duration. */
export interface PhaseCycleTimeBar {
  phase: ProjectPhase;
  avg_days: number;
  sample_size: number;
}

export interface PhaseCycleTimeMetric {
  bars: PhaseCycleTimeBar[];
  data_quality: DataQuality;
  /**
   * Free-form note explaining how the metric was computed. Surfaced in
   * the chart's footer so the reader knows what they're looking at.
   * Currently always set because we have no phase-history table yet.
   */
  note: string;
}

export interface BlockedTimeBar {
  /** `YYYY-Qn`. */
  quarter: string;
  /** Total days projects spent in Blocked status during this quarter. */
  days: number;
  project_count: number;
}

export interface BlockedTimeMetric {
  bars: BlockedTimeBar[];
  total_blocked_days: number;
  data_quality: DataQuality;
  note: string;
}

export interface IdeaConversionMetric {
  total_submitted: number;
  total_converted: number;
  /** 0–100 percentage. 0 when nothing has been submitted yet. */
  conversion_rate: number;
  /** Per-quarter trend. */
  by_quarter: { quarter: string; submitted: number; converted: number }[];
  data_quality: DataQuality;
}

// ---------------------------------------------------------------------------
// Composite payload — everything the dashboard needs in one round trip
// ---------------------------------------------------------------------------

export interface VelocityMetrics {
  /** Filters echoed back so the client can confirm what was applied. */
  filters: VelocityFilters;
  /** When this metric set was computed (UTC ISO). */
  computed_at: IsoTimestamp;
  /** Whether the response was served from the cache. */
  from_cache: boolean;

  completed_by_quarter: CompletedByQuarterMetric;
  avg_time_to_completion: AvgTimeToCompletionMetric;
  estimated_vs_actual: EstVsActualMetric;
  task_throughput: TaskThroughputMetric;
  phase_cycle_time: PhaseCycleTimeMetric;
  blocked_time: BlockedTimeMetric;
  idea_conversion: IdeaConversionMetric;

  /**
   * True when fewer than three projects are Completed in the active
   * filter set. Section 5.15 calls for a minimum-data warning at this
   * threshold. The dashboard surfaces it as a calibration banner.
   */
  insufficient_history: boolean;

  /**
   * Distinct values for filter dropdowns, returned alongside the metrics
   * so the dashboard doesn't need a second round trip to populate them.
   * Pulled from the project list before any range/type/product filtering
   * is applied.
   */
  filter_options: {
    project_types: ProjectType[];
    application_products: string[];
    project_leads: { user_id: UserId; label: string }[];
  };
}
