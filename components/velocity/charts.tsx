"use client";

/**
 * Chart components for the Velocity & Throughput Dashboard (Section 5.15).
 *
 * Seven charts in one file, sharing a small set of layout primitives at
 * the top. Each chart is a pure SVG component (matching the rest of this
 * codebase — see `bubble-view.tsx`, `timeline-view.tsx`) so we don't drag
 * in a chart library for what's mostly bars and one scatter.
 *
 * Every chart accepts its already-computed metric as a prop. The
 * orchestration (loading, filters, range selection) lives in
 * `dashboard.tsx`. Charts only know how to draw what they're given —
 * no data fetching, no caching, no router awareness.
 *
 * Charts share a single chart-card frame that handles:
 *   - the title and subtitle line
 *   - a "proxy" / "insufficient" badge when the metric flags one
 *   - a footer note when the metric carries one
 *   - an "empty state" centered message when there's nothing to draw
 *
 * That uniformity makes the page read as one dashboard rather than
 * seven independent widgets glued together.
 */

import { PROJECT_PHASES } from "@/lib/projects/display";
import type {
  AvgTimeToCompletionMetric,
  BlockedTimeMetric,
  CompletedByQuarterMetric,
  DataQuality,
  EstVsActualMetric,
  IdeaConversionMetric,
  PhaseCycleTimeMetric,
  TaskThroughputMetric,
} from "@/lib/velocity/types";

// ---------------------------------------------------------------------------
// Chart card frame — every chart renders inside this.
// ---------------------------------------------------------------------------

interface ChartCardProps {
  title: string;
  subtitle?: string;
  data_quality: DataQuality;
  note?: string;
  /** Right-aligned metadata, e.g. "20 projects, 4 quarters". */
  meta?: string;
  /** Set when the chart wants to render its own empty-state. */
  isEmpty?: boolean;
  emptyMessage?: string;
  children: React.ReactNode;
}

function ChartCard({
  title,
  subtitle,
  data_quality,
  note,
  meta,
  isEmpty,
  emptyMessage,
  children,
}: ChartCardProps) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-5 shadow-sm">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h3 className="text-sm font-semibold text-gray-900">{title}</h3>
          {subtitle ? (
            <p className="mt-0.5 text-xs text-gray-500">{subtitle}</p>
          ) : null}
        </div>
        <div className="flex items-center gap-2">
          {meta ? (
            <span className="text-xs text-gray-500">{meta}</span>
          ) : null}
          <QualityBadge quality={data_quality} />
        </div>
      </div>

      <div className="mt-4">
        {isEmpty ? (
          <div className="flex h-48 items-center justify-center rounded border border-dashed border-gray-200 text-sm text-gray-400">
            {emptyMessage ?? "Not enough data yet."}
          </div>
        ) : (
          children
        )}
      </div>

      {note ? (
        <p className="mt-3 border-t border-gray-100 pt-3 text-xs italic text-gray-500">
          {note}
        </p>
      ) : null}
    </div>
  );
}

function QualityBadge({ quality }: { quality: DataQuality }) {
  if (quality === "actual") return null; // Don't bother labeling the happy case.
  const label = quality === "proxy" ? "Approximate" : "Insufficient data";
  const classes =
    quality === "proxy"
      ? "bg-amber-50 text-amber-800 ring-amber-200"
      : "bg-gray-50 text-gray-600 ring-gray-200";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium ring-1 ring-inset ${classes}`}
      title={
        quality === "proxy"
          ? "Computed from a proxy field; see footnote."
          : "Not enough data yet for this metric."
      }
    >
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Tiny bar-chart primitive — used by quarter and week bar charts.
// ---------------------------------------------------------------------------

interface BarChartProps {
  bars: { label: string; value: number; secondary?: number }[];
  /** Width of one bar including the gap between bars, in pixels. */
  barWidth?: number;
  height?: number;
  /** Y-axis label format. Defaults to integer. */
  formatY?: (n: number) => string;
  /** Color for the primary value (uses Tailwind via `fill-` className). */
  primaryClass?: string;
  /** Optional second series stacked behind, for "submitted vs converted". */
  secondaryClass?: string;
  /** Hover label format. Falls back to "{label}: {value}". */
  formatTooltip?: (bar: { label: string; value: number; secondary?: number }) => string;
}

function BarChart({
  bars,
  barWidth = 56,
  height = 200,
  formatY = (n) => `${Math.round(n)}`,
  primaryClass = "fill-emerald-500",
  secondaryClass = "fill-emerald-200",
  formatTooltip,
}: BarChartProps) {
  const PADDING = { top: 12, right: 16, bottom: 36, left: 36 };
  const plotW = Math.max(80, bars.length * barWidth);
  const plotH = height - PADDING.top - PADDING.bottom;

  const max = Math.max(
    1,
    ...bars.map((b) => Math.max(b.value, b.secondary ?? 0)),
  );
  // Round up to a nice number for the Y axis ceiling.
  const yMax = niceCeil(max);

  // Y-axis ticks: 0, mid, max.
  const ticks = [0, yMax / 2, yMax];

  return (
    <div className="w-full overflow-x-auto">
      <svg
        width={plotW + PADDING.left + PADDING.right}
        height={height}
        className="block"
      >
        {/* Y-axis gridlines and labels */}
        {ticks.map((t, i) => {
          const y = PADDING.top + plotH - (t / yMax) * plotH;
          return (
            <g key={`y-${i}`}>
              <line
                x1={PADDING.left}
                x2={PADDING.left + plotW}
                y1={y}
                y2={y}
                className="stroke-gray-200"
                strokeDasharray={i === 0 ? "" : "2 3"}
              />
              <text
                x={PADDING.left - 6}
                y={y}
                textAnchor="end"
                dominantBaseline="middle"
                className="fill-gray-500 text-[10px]"
              >
                {formatY(t)}
              </text>
            </g>
          );
        })}

        {/* Bars */}
        {bars.map((b, i) => {
          const cx = PADDING.left + i * barWidth + barWidth / 2;
          const w = Math.max(8, barWidth * 0.6);
          const x = cx - w / 2;
          const yPrimary = PADDING.top + plotH - (b.value / yMax) * plotH;
          const hPrimary = PADDING.top + plotH - yPrimary;
          const tooltip = formatTooltip
            ? formatTooltip(b)
            : `${b.label}: ${formatY(b.value)}`;

          return (
            <g key={`bar-${i}`}>
              {/* Optional secondary series, drawn first so primary overlays. */}
              {typeof b.secondary === "number" && b.secondary > 0 ? (
                (() => {
                  const ySec =
                    PADDING.top + plotH - (b.secondary / yMax) * plotH;
                  const hSec = PADDING.top + plotH - ySec;
                  return (
                    <rect
                      x={x - 4}
                      y={ySec}
                      width={w + 8}
                      height={hSec}
                      className={secondaryClass}
                      rx={2}
                    >
                      <title>
                        {b.label}: {formatY(b.secondary)} (background)
                      </title>
                    </rect>
                  );
                })()
              ) : null}
              <rect
                x={x}
                y={yPrimary}
                width={w}
                height={hPrimary}
                className={primaryClass}
                rx={2}
              >
                <title>{tooltip}</title>
              </rect>
              {/* Value label above the bar (only when bar isn't tiny). */}
              {hPrimary > 18 ? (
                <text
                  x={cx}
                  y={yPrimary - 4}
                  textAnchor="middle"
                  className="fill-gray-700 text-[10px] font-medium"
                >
                  {formatY(b.value)}
                </text>
              ) : null}
              {/* X label */}
              <text
                x={cx}
                y={PADDING.top + plotH + 16}
                textAnchor="middle"
                className="fill-gray-600 text-[10px]"
              >
                {b.label}
              </text>
            </g>
          );
        })}

        {/* X-axis baseline */}
        <line
          x1={PADDING.left}
          x2={PADDING.left + plotW}
          y1={PADDING.top + plotH}
          y2={PADDING.top + plotH}
          className="stroke-gray-300"
        />
      </svg>
    </div>
  );
}

/**
 * Round `n` up to a "nice" number for axis ceilings: 1, 2, 5, 10, 20, 50,
 * 100, etc. Keeps tick labels short and the chart readable.
 */
function niceCeil(n: number): number {
  if (n <= 0) return 1;
  const exp = Math.floor(Math.log10(n));
  const base = Math.pow(10, exp);
  const mantissa = n / base;
  let nice: number;
  if (mantissa <= 1) nice = 1;
  else if (mantissa <= 2) nice = 2;
  else if (mantissa <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

// ---------------------------------------------------------------------------
// 1. Projects Completed per Quarter
// ---------------------------------------------------------------------------

export function CompletedByQuarterChart({
  metric,
}: {
  metric: CompletedByQuarterMetric;
}) {
  return (
    <ChartCard
      title="Projects completed per quarter"
      subtitle={`${metric.total_completed} project${
        metric.total_completed === 1 ? "" : "s"
      } completed in range`}
      data_quality={metric.data_quality}
      note="Bucketed by the quarter the project's last edit landed in (proxy for completion date)."
      meta={`${metric.bars.length} quarter${metric.bars.length === 1 ? "" : "s"}`}
      isEmpty={metric.bars.length === 0}
      emptyMessage="No completed projects in this range."
    >
      <BarChart
        bars={metric.bars.map((b) => ({ label: b.quarter, value: b.count }))}
        primaryClass="fill-emerald-500"
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 2. Average Time to Completion
// ---------------------------------------------------------------------------

export function AvgTimeToCompletionChart({
  metric,
}: {
  metric: AvgTimeToCompletionMetric;
}) {
  // Show by-type as a horizontal bar chart since type names are wider than
  // typical quarter labels — vertical bars would crowd the X axis.
  const isEmpty = metric.sample_size === 0;
  const leadOverall = `${Math.round(metric.overall_avg_days)}d lead time avg across ${metric.sample_size}`;
  const cycleOverall =
    metric.overall_avg_cycle_days !== null
      ? ` · ${Math.round(metric.overall_avg_cycle_days)}d cycle time avg across ${metric.cycle_sample_size}`
      : "";

  // Trim to types with at least one sample so empty bars aren't drawn.
  const filtered = metric.by_type.filter((t) => t.sample_size > 0);

  // Show cycle-time UI only when at least one bucket has data. Older
  // seeded projects predate the start_date auto-set, so a freshly
  // installed dataset will show only lead time until new projects
  // start completing.
  const hasCycleData = metric.cycle_sample_size > 0;

  return (
    <ChartCard
      title="Average time to completion"
      subtitle={
        isEmpty
          ? "Not enough completed projects in range."
          : `${leadOverall}${cycleOverall}`
      }
      data_quality={metric.data_quality}
      note={
        hasCycleData
          ? "Lead time = creation → done; cycle time = planned start → done. Cycle time is computed only over projects with a recorded start date."
          : "Days from project creation to last edit, broken down by type. Cycle time appears once projects with planned start dates begin completing."
      }
      isEmpty={isEmpty}
      emptyMessage="No completed projects in this range."
    >
      {/* Legend — only when cycle is present, since otherwise the
          legend would just say "Lead time" with one swatch and add
          noise. */}
      {hasCycleData ? (
        <div className="mb-3 flex items-center gap-4 text-xs text-gray-600">
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-sky-500" />
            Lead time
          </span>
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block h-2 w-3 rounded-sm bg-emerald-500" />
            Cycle time
          </span>
        </div>
      ) : null}

      <div className="space-y-2">
        {filtered.map((t) => {
          // The bar scale uses the larger of lead and cycle so both
          // bars share a common axis — otherwise a 100-day cycle and
          // 100-day lead would look like different magnitudes.
          const max = Math.max(
            ...filtered.flatMap((x) => [
              x.avg_days,
              x.avg_cycle_days ?? 0,
            ]),
            1,
          );
          const leadPct = (t.avg_days / max) * 100;
          const cyclePct =
            t.avg_cycle_days !== null ? (t.avg_cycle_days / max) * 100 : null;
          return (
            <div key={t.project_type} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-xs text-gray-700">
                {t.project_type}
              </div>
              <div className="relative h-5 flex-1">
                <div className="absolute inset-y-0 inset-x-0 rounded bg-gray-100" />
                {/* Lead bar (top half when cycle is present, full
                    height otherwise). */}
                <div
                  className={`absolute left-0 ${hasCycleData ? "top-0 h-1/2" : "inset-y-0"} rounded-l bg-sky-500`}
                  style={{ width: `${leadPct}%` }}
                  title={`Lead time: ${Math.round(t.avg_days)} days (n=${t.sample_size})`}
                />
                {/* Cycle bar (bottom half) — null when no cycle data
                    for this type. */}
                {hasCycleData && cyclePct !== null ? (
                  <div
                    className="absolute bottom-0 left-0 h-1/2 rounded-l bg-emerald-500"
                    style={{ width: `${cyclePct}%` }}
                    title={`Cycle time: ${Math.round(t.avg_cycle_days ?? 0)} days (n=${t.cycle_sample_size})`}
                  />
                ) : null}
              </div>
              <div className="w-32 shrink-0 text-right text-xs tabular-nums text-gray-700">
                {Math.round(t.avg_days)}d
                {hasCycleData && t.avg_cycle_days !== null ? (
                  <span className="text-emerald-700">
                    {" / "}
                    {Math.round(t.avg_cycle_days)}d
                  </span>
                ) : null}{" "}
                <span className="text-gray-400">(n={t.sample_size})</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Trend line as a small inline mini-chart. */}
      {metric.trend.some((p) => p.sample_size > 0) ? (
        <div className="mt-5">
          <p className="mb-1 text-xs font-medium text-gray-700">
            Trend by quarter (lead time)
          </p>
          <BarChart
            bars={metric.trend.map((p) => ({
              label: p.quarter,
              value: p.avg_days,
            }))}
            height={140}
            primaryClass="fill-sky-500"
            formatY={(n) => `${Math.round(n)}d`}
            formatTooltip={(b) => `${b.label}: ${Math.round(b.value)} days`}
          />
          {hasCycleData && metric.trend.some((p) => p.cycle_sample_size > 0) ? (
            <>
              <p className="mb-1 mt-3 text-xs font-medium text-gray-700">
                Trend by quarter (cycle time)
              </p>
              <BarChart
                bars={metric.trend.map((p) => ({
                  label: p.quarter,
                  value: p.avg_cycle_days ?? 0,
                }))}
                height={140}
                primaryClass="fill-emerald-500"
                formatY={(n) => `${Math.round(n)}d`}
                formatTooltip={(b) =>
                  `${b.label}: ${Math.round(b.value)} days`
                }
              />
            </>
          ) : null}
        </div>
      ) : null}
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 3. Estimated vs Actual Duration
// ---------------------------------------------------------------------------

export function EstimatedVsActualChart({
  metric,
}: {
  metric: EstVsActualMetric;
}) {
  // Layout constants for the scatter plot.
  const W = 560;
  const H = 280;
  const PADDING = { top: 16, right: 16, bottom: 36, left: 44 };
  const plotW = W - PADDING.left - PADDING.right;
  const plotH = H - PADDING.top - PADDING.bottom;

  const isEmpty = metric.sample_size === 0;

  // Axis bounds: cover both axes with a little headroom so dots aren't
  // pinned to the chart edge.
  const max = Math.max(
    ...metric.points.flatMap((p) => [p.estimated_days, p.actual_days]),
    1,
  );
  const axisMax = niceCeil(max * 1.1);

  const scaleX = (n: number) => PADDING.left + (n / axisMax) * plotW;
  const scaleY = (n: number) => PADDING.top + plotH - (n / axisMax) * plotH;

  return (
    <ChartCard
      title="Estimated vs actual duration"
      subtitle={
        isEmpty
          ? "No completed projects with parseable estimates."
          : `${metric.sample_size} dot${metric.sample_size === 1 ? "" : "s"} · mean delta ${
              metric.mean_delta_days >= 0 ? "+" : ""
            }${Math.round(metric.mean_delta_days)} days`
      }
      data_quality={metric.data_quality}
      note={
        metric.excluded_count > 0
          ? `Diagonal = perfect estimate. Above the line = took longer than estimated. ${metric.excluded_count} project${
              metric.excluded_count === 1 ? " was" : "s were"
            } excluded for missing or unparseable estimates (e.g. "soon").`
          : "Diagonal = perfect estimate. Above the line = took longer than estimated."
      }
      isEmpty={isEmpty}
      emptyMessage="No projects with parseable estimates yet."
    >
      <svg width={W} height={H} className="block">
        {/* Background panel */}
        <rect
          x={PADDING.left}
          y={PADDING.top}
          width={plotW}
          height={plotH}
          className="fill-gray-50 stroke-gray-200"
        />
        {/* Diagonal y = x reference line */}
        <line
          x1={scaleX(0)}
          y1={scaleY(0)}
          x2={scaleX(axisMax)}
          y2={scaleY(axisMax)}
          className="stroke-gray-300"
          strokeDasharray="4 3"
        />
        {/* Y-axis ticks and labels */}
        {[0, axisMax / 2, axisMax].map((t) => (
          <g key={`y-${t}`}>
            <text
              x={PADDING.left - 6}
              y={scaleY(t)}
              textAnchor="end"
              dominantBaseline="middle"
              className="fill-gray-500 text-[10px]"
            >
              {Math.round(t)}d
            </text>
          </g>
        ))}
        {/* X-axis ticks and labels */}
        {[0, axisMax / 2, axisMax].map((t) => (
          <g key={`x-${t}`}>
            <text
              x={scaleX(t)}
              y={PADDING.top + plotH + 16}
              textAnchor="middle"
              className="fill-gray-500 text-[10px]"
            >
              {Math.round(t)}d
            </text>
          </g>
        ))}
        {/* Axis labels */}
        <text
          x={PADDING.left + plotW / 2}
          y={H - 4}
          textAnchor="middle"
          className="fill-gray-600 text-[10px] font-medium"
        >
          Estimated days
        </text>
        <text
          x={10}
          y={PADDING.top + plotH / 2}
          textAnchor="middle"
          className="fill-gray-600 text-[10px] font-medium"
          transform={`rotate(-90, 10, ${PADDING.top + plotH / 2})`}
        >
          Actual days
        </text>

        {/* Data points */}
        {metric.points.map((p) => (
          <circle
            key={p.project_id}
            cx={scaleX(p.estimated_days)}
            cy={scaleY(p.actual_days)}
            r={5}
            className={
              p.actual_days > p.estimated_days * 1.1
                ? "fill-rose-500"
                : p.actual_days < p.estimated_days * 0.9
                  ? "fill-emerald-500"
                  : "fill-sky-500"
            }
            opacity={0.75}
          >
            <title>
              {p.project_id} {p.project_name}
              {"\n"}Estimated: {Math.round(p.estimated_days)} days
              {"\n"}Actual:    {Math.round(p.actual_days)} days
            </title>
          </circle>
        ))}
      </svg>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 4. Task Throughput
// ---------------------------------------------------------------------------

export function TaskThroughputChart({
  metric,
}: {
  metric: TaskThroughputMetric;
}) {
  // Compress week labels to MM-DD for visual density.
  const bars = metric.weeks.map((w) => ({
    label: w.week_start.slice(5), // MM-DD
    value: w.count,
  }));

  return (
    <ChartCard
      title="Task throughput per week"
      subtitle={
        metric.total_completed === 0
          ? "No tasks completed in range."
          : `${metric.total_completed} task${
              metric.total_completed === 1 ? "" : "s"
            } · ${metric.mean_per_week.toFixed(1)} avg/week`
      }
      data_quality={metric.data_quality}
      meta={`${metric.weeks.length} week${metric.weeks.length === 1 ? "" : "s"}`}
      isEmpty={metric.weeks.length === 0}
      emptyMessage="No tasks completed in this range."
    >
      <BarChart
        bars={bars}
        barWidth={42}
        primaryClass="fill-indigo-500"
      />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 5. Phase Cycle Time
// ---------------------------------------------------------------------------

export function PhaseCycleTimeChart({
  metric,
}: {
  metric: PhaseCycleTimeMetric;
}) {
  const isEmpty = metric.bars.every((b) => b.sample_size === 0);
  const max = Math.max(...metric.bars.map((b) => b.avg_days), 1);

  return (
    <ChartCard
      title="Phase cycle time"
      subtitle="Average days projects spend in each phase"
      data_quality={metric.data_quality}
      note={metric.note}
      isEmpty={isEmpty}
      emptyMessage="No phase data available yet."
    >
      <div className="space-y-1.5">
        {/* Render in canonical phase order (Section 4.1, Appendix C). */}
        {PROJECT_PHASES.map((phase) => {
          const bar = metric.bars.find((b) => b.phase === phase);
          if (!bar || bar.sample_size === 0) {
            return (
              <div key={phase} className="flex items-center gap-3">
                <div className="w-44 shrink-0 text-xs text-gray-400">
                  {phase}
                </div>
                <div className="h-4 flex-1 rounded bg-gray-50" />
                <div className="w-24 shrink-0 text-right text-xs text-gray-300">
                  —
                </div>
              </div>
            );
          }
          const pct = (bar.avg_days / max) * 100;
          return (
            <div key={phase} className="flex items-center gap-3">
              <div className="w-44 shrink-0 text-xs text-gray-700">
                {phase}
              </div>
              <div className="h-4 flex-1 rounded bg-gray-100">
                <div
                  className="h-full rounded bg-amber-500"
                  style={{ width: `${pct}%` }}
                />
              </div>
              <div className="w-24 shrink-0 text-right text-xs tabular-nums text-gray-700">
                {Math.round(bar.avg_days)}d{" "}
                <span className="text-gray-400">(n={bar.sample_size})</span>
              </div>
            </div>
          );
        })}
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 6. Blocked Time
// ---------------------------------------------------------------------------

export function BlockedTimeChart({
  metric,
}: {
  metric: BlockedTimeMetric;
}) {
  const bars = metric.bars.map((b) => ({
    label: b.quarter,
    value: b.days,
  }));

  return (
    <ChartCard
      title="Blocked time per quarter"
      subtitle={
        metric.total_blocked_days === 0
          ? "Nothing blocked in this range."
          : `${metric.total_blocked_days} project-day${
              metric.total_blocked_days === 1 ? "" : "s"
            } in Blocked status`
      }
      data_quality={metric.data_quality}
      note={metric.note}
      isEmpty={bars.length === 0}
      emptyMessage="No blocked-status data in this range."
    >
      <BarChart bars={bars} primaryClass="fill-rose-500" />
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// 7. Idea Conversion Rate
// ---------------------------------------------------------------------------

export function IdeaConversionChart({
  metric,
}: {
  metric: IdeaConversionMetric;
}) {
  const isEmpty = metric.total_submitted === 0;

  return (
    <ChartCard
      title="Idea conversion rate"
      subtitle={
        isEmpty
          ? "No ideas submitted in range."
          : `${metric.total_converted} of ${metric.total_submitted} converted (${Math.round(
              metric.conversion_rate,
            )}%)`
      }
      data_quality={metric.data_quality}
      isEmpty={isEmpty}
      emptyMessage="No ideas submitted in this range yet."
    >
      <div className="space-y-4">
        {/* Big-number band so the rate is readable at a glance. */}
        <div className="flex items-baseline gap-3">
          <div className="text-3xl font-semibold tabular-nums text-gray-900">
            {Math.round(metric.conversion_rate)}%
          </div>
          <div className="text-xs text-gray-500">
            {metric.total_converted} converted / {metric.total_submitted} submitted
          </div>
        </div>

        {/* Per-quarter trend, paired bars: submitted (background) + converted (foreground). */}
        {metric.by_quarter.length > 0 ? (
          <BarChart
            bars={metric.by_quarter.map((q) => ({
              label: q.quarter,
              value: q.converted,
              secondary: q.submitted,
            }))}
            height={160}
            primaryClass="fill-emerald-500"
            secondaryClass="fill-emerald-100"
            formatTooltip={(b) =>
              `${b.label}: ${b.value} converted / ${b.secondary ?? 0} submitted`
            }
          />
        ) : null}
      </div>
    </ChartCard>
  );
}

// ---------------------------------------------------------------------------
// Re-export the chart card so the dashboard can use it for the calibration
// banner and other one-off cards.
// ---------------------------------------------------------------------------

export { ChartCard };
