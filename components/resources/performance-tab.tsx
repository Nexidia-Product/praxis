"use client";

/**
 * Resources → Performance tab.
 *
 * Per-resource view that combines the active-work signals from the
 * roster (workload, open tasks, past-due, blocked) with the
 * completed-task signals from the perf series (throughput,
 * on-time, cycle time). Every scoped resource gets a card —
 * resources with no completions in the window still show their
 * active load, with a small "no completions in window" caveat
 * where the charts would be.
 *
 * Charts are pure SVG (matching `components/velocity/charts.tsx`).
 * No chart library dependency.
 *
 * Why we accept both `roster` and `series`: the perf series carries
 * window-scoped completed-task analytics that the roster row
 * doesn't have (cycle-time arrays, weekly throughput points). The
 * roster carries the live capacity picture that doesn't depend on
 * having closed any tasks. Combining them per-card means a card
 * never tells you nothing useful as long as the resource has
 * *anything* going on.
 */

import { useMemo, useState } from "react";

import type {
  ResourcePerformanceSeries,
  ResourceRosterRow,
} from "@/lib/resources/roster";
import type { ResourceSettings } from "@/lib/db";

interface PerformanceTabProps {
  roster: ResourceRosterRow[];
  series: ResourcePerformanceSeries[];
  thresholds: ResourceSettings["performance_thresholds"];
  windowDays: number;
}

type SortKey =
  | "completed"
  | "on_time"
  | "cycle_time"
  | "workload"
  | "open_tasks"
  | "name";

export function PerformanceTab({
  roster,
  series,
  thresholds,
  windowDays,
}: PerformanceTabProps) {
  const [sortKey, setSortKey] = useState<SortKey>("workload");
  const [filter, setFilter] = useState("");
  const [hideEmpty, setHideEmpty] = useState(false);

  // Index series by resource name for O(1) lookup per roster row.
  // Keys match the roster's `resource` because that's the join key
  // both modules use (display name).
  const seriesByResource = useMemo(() => {
    const m = new Map<string, ResourcePerformanceSeries>();
    for (const s of series) m.set(s.resource, s);
    return m;
  }, [series]);

  // Build per-card data by walking the roster — this is what makes
  // every scoped resource visible, not just those who completed
  // tasks in the window.
  const cards: PerfCard[] = useMemo(
    () =>
      roster.map((row) => ({
        row,
        series: seriesByResource.get(row.resource) ?? null,
      })),
    [roster, seriesByResource],
  );

  // Team-level aggregates. Only resources with at least one
  // completion contribute — including zero-completion resources
  // would skew the median to zero or null and isn't a fair
  // comparison.
  const teamStats = useMemo(() => {
    const active = series.filter((s) => s.completed_in_window > 0);
    if (active.length === 0) return null;
    const totalCompleted = active.reduce(
      (acc, s) => acc + s.completed_in_window,
      0,
    );
    const onTimeRates = active
      .map((s) => s.on_time_rate)
      .filter((v): v is number => v !== null);
    const teamOnTime =
      onTimeRates.length > 0
        ? onTimeRates.reduce((a, b) => a + b, 0) / onTimeRates.length
        : null;
    const allCycleTimes = active.flatMap((s) => s.cycle_times_days);
    const sorted = [...allCycleTimes].sort((a, b) => a - b);
    const median =
      sorted.length === 0 ? null : sorted[Math.floor(sorted.length / 2)];
    return {
      activeCount: active.length,
      totalCompleted,
      teamOnTime,
      median,
    };
  }, [series]);

  const sorted = useMemo(() => {
    const out = [...cards];
    out.sort((a, b) => {
      switch (sortKey) {
        case "name":
          return a.row.resource.localeCompare(b.row.resource);
        case "on_time": {
          // Resources with no completions sort to the bottom — they
          // don't have a meaningful on-time rate to compare against.
          const av = a.series?.on_time_rate ?? -1;
          const bv = b.series?.on_time_rate ?? -1;
          return bv - av;
        }
        case "cycle_time": {
          // Lower is better; null/undefined to the bottom.
          const av = a.series?.median_cycle_time_days ?? Infinity;
          const bv = b.series?.median_cycle_time_days ?? Infinity;
          return av - bv;
        }
        case "workload":
          return b.row.workload_score - a.row.workload_score;
        case "open_tasks":
          return b.row.open_tasks.length - a.row.open_tasks.length;
        case "completed":
        default: {
          const av = a.series?.completed_in_window ?? 0;
          const bv = b.series?.completed_in_window ?? 0;
          return bv - av;
        }
      }
    });
    return out;
  }, [cards, sortKey]);

  const filtered = useMemo(() => {
    let out = sorted;
    if (filter) {
      const needle = filter.toLowerCase();
      out = out.filter((c) =>
        c.row.resource.toLowerCase().includes(needle),
      );
    }
    if (hideEmpty) {
      // Hide resources with neither completions nor active work —
      // they've got nothing for this view to say.
      out = out.filter(
        (c) =>
          (c.series?.completed_in_window ?? 0) > 0 ||
          c.row.open_tasks.length > 0 ||
          c.row.active_projects.length > 0,
      );
    }
    return out;
  }, [sorted, filter, hideEmpty]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Window:
        </span>
        <span className="text-xs text-gray-700">last {windowDays} days</span>

        <span className="ml-4 text-xs font-medium uppercase tracking-wider text-gray-500">
          Sort:
        </span>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
          {(
            [
              { id: "workload", label: "Workload" },
              { id: "open_tasks", label: "Open tasks" },
              { id: "completed", label: "Completed" },
              { id: "on_time", label: "On-time" },
              { id: "cycle_time", label: "Cycle time" },
              { id: "name", label: "Name" },
            ] as const
          ).map((s) => (
            <button
              key={s.id}
              type="button"
              onClick={() => setSortKey(s.id)}
              className={`rounded px-3 py-0.5 text-xs ${
                sortKey === s.id
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>

        <label className="ml-2 inline-flex items-center gap-1.5 text-xs text-gray-700">
          <input
            type="checkbox"
            checked={hideEmpty}
            onChange={(e) => setHideEmpty(e.target.checked)}
            className="h-3 w-3"
          />
          Hide idle
        </label>

        <input
          type="search"
          placeholder="Filter resources…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs"
        />
      </div>

      {teamStats ? (
        <div
          className="pol-card"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 16,
            padding: "14px 16px",
          }}
        >
          <Stat
            label="Resources active"
            value={String(teamStats.activeCount)}
            sublabel="with ≥1 completion"
          />
          <Stat
            label="Tasks completed"
            value={String(teamStats.totalCompleted)}
            sublabel="across the team"
          />
          <Stat
            label="Team on-time"
            value={
              teamStats.teamOnTime !== null
                ? `${(teamStats.teamOnTime * 100).toFixed(0)}%`
                : "—"
            }
            sublabel="average across resources"
          />
          <Stat
            label="Median cycle time"
            value={teamStats.median !== null ? `${teamStats.median}d` : "—"}
            sublabel="across all completed tasks"
          />
        </div>
      ) : (
        <div
          className="pol-card"
          style={{ padding: 16, color: "var(--tm)", fontSize: "var(--fs-sm)" }}
        >
          No completed tasks in the last {windowDays} days. Per-resource
          cards below still show active workload and open-task signals.
        </div>
      )}

      {filtered.length === 0 ? (
        <div className="pol-card" style={{ padding: 24, textAlign: "center" }}>
          <p style={{ color: "var(--tm)", fontSize: "var(--fs-sm)" }}>
            {filter
              ? `No resources matching "${filter}".`
              : hideEmpty
                ? "All resources are idle. Untick \u201cHide idle\u201d to see them."
                : "No resources to display."}
          </p>
        </div>
      ) : (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(380px, 1fr))",
            gap: 12,
          }}
        >
          {filtered.map((c) => (
            <ResourceCard
              key={c.row.resource}
              row={c.row}
              series={c.series}
              thresholds={thresholds}
              windowDays={windowDays}
            />
          ))}
        </div>
      )}
    </div>
  );
}

interface PerfCard {
  row: ResourceRosterRow;
  series: ResourcePerformanceSeries | null;
}

// ---------------------------------------------------------------------------
// Stat — labeled number for the team summary row
// ---------------------------------------------------------------------------

function Stat({
  label,
  value,
  sublabel,
}: {
  label: string;
  value: string;
  sublabel: string;
}) {
  return (
    <div>
      <div
        style={{
          fontSize: "var(--fs-xs)",
          fontWeight: 700,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--tm)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 22,
          fontWeight: 700,
          color: "var(--t1)",
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {value}
      </div>
      <div style={{ fontSize: 11, color: "var(--tm)", marginTop: 2 }}>
        {sublabel}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// ResourceCard
// ---------------------------------------------------------------------------

function ResourceCard({
  row,
  series,
  thresholds,
  windowDays,
}: {
  row: ResourceRosterRow;
  series: ResourcePerformanceSeries | null;
  thresholds: ResourceSettings["performance_thresholds"];
  windowDays: number;
}) {
  const completed = series?.completed_in_window ?? 0;
  const hasCompletions = completed > 0;
  const totalOpen = row.open_tasks.length;
  const totalPastDue = row.past_due_tasks.length;
  const totalBlocked = row.blocked_tasks.length;
  const totalProjects = row.active_projects.length;

  // Card variants:
  //   - Has completions:  full charts + active-work strip
  //   - Has active work but no completions: workload + active-work
  //     strip + a single-line "no completions in window" caveat
  //   - Has nothing at all: minimal "idle" card
  const isIdle = !hasCompletions && totalOpen === 0 && totalProjects === 0;

  // Bucket cycle times into a small histogram. Dynamic edges based
  // on the data range so a team with mostly small cycle times
  // doesn't see one bucket for everything.
  const cycleHistogram = useMemo(() => {
    if (!series || series.cycle_times_days.length === 0) return [];
    const max = Math.max(...series.cycle_times_days, 1);
    const buckets = Math.min(
      8,
      Math.max(3, Math.ceil(Math.sqrt(series.cycle_times_days.length))),
    );
    const width = Math.max(1, Math.ceil(max / buckets));
    const counts = new Array(buckets).fill(0) as number[];
    for (const v of series.cycle_times_days) {
      const idx = Math.min(buckets - 1, Math.floor(v / width));
      counts[idx]++;
    }
    return counts.map((count, i) => ({
      label: `${i * width}-${(i + 1) * width - 1}d`,
      count,
    }));
  }, [series]);

  return (
    <div className="pol-card" style={{ padding: 14 }}>
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <h3
          style={{
            fontSize: "var(--fs-sm)",
            fontWeight: 700,
            color: "var(--t1)",
            margin: 0,
            flex: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {row.resource}
        </h3>
        <BucketChip value={row.workload_bucket} />
        {hasCompletions ? (
          <PerfPill
            on_time_rate={series?.on_time_rate ?? null}
            blocked_day_rate={series?.blocked_day_rate ?? null}
            thresholds={thresholds}
          />
        ) : null}
      </div>

      {/* Active-work strip — always visible (when there's any to
          show). Gives the card meaning even when no tasks have
          closed in the window. */}
      {!isIdle ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(4, 1fr)",
            gap: 8,
            margin: "10px 0",
          }}
        >
          <MiniStat label="Projects" value={String(totalProjects)} />
          <MiniStat
            label="Open"
            value={String(totalOpen)}
            tone={totalOpen > 0 ? undefined : "muted"}
          />
          <MiniStat
            label="Past-due"
            value={String(totalPastDue)}
            tone={totalPastDue > 0 ? "danger" : "muted"}
          />
          <MiniStat
            label="Blocked"
            value={String(totalBlocked)}
            tone={totalBlocked > 0 ? "danger" : "muted"}
          />
        </div>
      ) : null}

      {/* Completed-task signals. Render charts only when there's
          data; otherwise a single-line caveat that's far less
          visually heavy than an empty "no completed tasks" block. */}
      {hasCompletions && series ? (
        <>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(3, 1fr)",
              gap: 8,
              margin: "0 0 10px",
            }}
          >
            <MiniStat label="Completed" value={String(completed)} />
            <MiniStat
              label="On-time"
              value={
                series.on_time_rate !== null
                  ? `${(series.on_time_rate * 100).toFixed(0)}%`
                  : "—"
              }
            />
            <MiniStat
              label="Median cycle"
              value={
                series.median_cycle_time_days !== null
                  ? `${series.median_cycle_time_days}d`
                  : "—"
              }
            />
          </div>

          <ChartHeader>Throughput</ChartHeader>
          <Sparkline points={series.throughput} />

          <div style={{ marginTop: 10 }}>
            <ChartHeader>Cycle-time distribution</ChartHeader>
            <Histogram bins={cycleHistogram} />
          </div>
        </>
      ) : isIdle ? (
        <p style={{ marginTop: 8, fontSize: 12, color: "var(--tm)" }}>
          No active projects, open tasks, or completions in window.
        </p>
      ) : (
        <p style={{ marginTop: 0, fontSize: 11, color: "var(--tm)" }}>
          No tasks completed in the last {windowDays} days. The throughput
          and cycle-time charts will appear here once work closes out.
        </p>
      )}
    </div>
  );
}

function ChartHeader({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontSize: 11,
        fontWeight: 600,
        textTransform: "uppercase",
        letterSpacing: 0.5,
        color: "var(--tm)",
        marginBottom: 4,
      }}
    >
      {children}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sparkline — pure SVG, throughput-per-week
// ---------------------------------------------------------------------------

const SPARK_W = 320;
const SPARK_H = 50;
const SPARK_PAD = 4;

function Sparkline({ points }: { points: { week: string; count: number }[] }) {
  if (points.length === 0) {
    return <EmptyChart message="No throughput data" height={SPARK_H} />;
  }
  if (points.length === 1) {
    // A single data point can't draw a line — fall back to a dot
    // centered horizontally with a label so the card doesn't show
    // an empty area.
    const cx = SPARK_W / 2;
    const cy = SPARK_H / 2;
    return (
      <svg
        viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
        width="100%"
        height={SPARK_H}
        role="img"
        aria-label={`${points[0].count} task${points[0].count === 1 ? "" : "s"} completed in ${points[0].week}`}
      >
        <circle cx={cx} cy={cy} r={3} fill="#10b981" />
        <text x={cx + 8} y={cy + 4} fontSize="10" fill="var(--tm)">
          {points[0].count} in {points[0].week}
        </text>
      </svg>
    );
  }

  const max = Math.max(...points.map((p) => p.count), 1);
  const stepX = (SPARK_W - 2 * SPARK_PAD) / (points.length - 1);
  const yFor = (count: number) => {
    if (max === 0) return SPARK_H / 2;
    return SPARK_H - SPARK_PAD - (count / max) * (SPARK_H - 2 * SPARK_PAD);
  };
  const path = points
    .map((p, i) => {
      const x = SPARK_PAD + i * stepX;
      const y = yFor(p.count);
      return `${i === 0 ? "M" : "L"} ${x.toFixed(1)} ${y.toFixed(1)}`;
    })
    .join(" ");

  const summary = `Throughput across ${points.length} weeks: ${points
    .map((p) => `${p.week} ${p.count}`)
    .join(", ")}`;

  return (
    <svg
      viewBox={`0 0 ${SPARK_W} ${SPARK_H}`}
      width="100%"
      height={SPARK_H}
      role="img"
      aria-label={summary}
    >
      <title>{summary}</title>
      <path d={path} stroke="#10b981" strokeWidth={1.75} fill="none" />
      {points.map((p, i) => {
        const x = SPARK_PAD + i * stepX;
        const y = yFor(p.count);
        return (
          <circle key={i} cx={x} cy={y} r={1.75} fill="#10b981">
            <title>{`${p.week}: ${p.count} task${p.count === 1 ? "" : "s"}`}</title>
          </circle>
        );
      })}
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Histogram — pure SVG bars with bucket labels
// ---------------------------------------------------------------------------

const HIST_W = 320;
const HIST_H = 70;
const HIST_PAD_TOP = 4;
const HIST_PAD_BOTTOM = 14;
const HIST_PAD_X = 4;

function Histogram({
  bins,
}: {
  bins: { label: string; count: number }[];
}) {
  if (bins.length === 0) {
    return <EmptyChart message="No cycle-time data" height={HIST_H} />;
  }
  const max = Math.max(...bins.map((b) => b.count), 1);
  const innerW = HIST_W - 2 * HIST_PAD_X;
  const innerH = HIST_H - HIST_PAD_TOP - HIST_PAD_BOTTOM;
  const stepX = innerW / bins.length;
  const barW = Math.max(1, stepX - 2);

  return (
    <svg
      viewBox={`0 0 ${HIST_W} ${HIST_H}`}
      width="100%"
      height={HIST_H}
      role="img"
      aria-label={`Cycle-time distribution across ${bins.length} buckets`}
    >
      <line
        x1={HIST_PAD_X}
        x2={HIST_W - HIST_PAD_X}
        y1={HIST_H - HIST_PAD_BOTTOM}
        y2={HIST_H - HIST_PAD_BOTTOM}
        stroke="#e5e7eb"
        strokeWidth={1}
      />
      {bins.map((b, i) => {
        const h = (b.count / max) * innerH;
        const x = HIST_PAD_X + i * stepX + (stepX - barW) / 2;
        const y = HIST_H - HIST_PAD_BOTTOM - h;
        return (
          <g key={i}>
            <rect x={x} y={y} width={barW} height={h} fill="#3b82f6">
              <title>{`${b.label}: ${b.count} task${b.count === 1 ? "" : "s"}`}</title>
            </rect>
            <text
              x={x + barW / 2}
              y={HIST_H - 2}
              fontSize="9"
              fill="var(--tm)"
              textAnchor="middle"
            >
              {b.label}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function EmptyChart({
  message,
  height,
}: {
  message: string;
  height: number;
}) {
  return (
    <div
      style={{
        height,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 11,
        color: "var(--tm)",
      }}
    >
      {message}
    </div>
  );
}

function MiniStat({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "danger" | "muted";
}) {
  const valueColor =
    tone === "danger"
      ? "var(--err)"
      : tone === "muted"
        ? "var(--tm)"
        : "var(--t1)";
  return (
    <div>
      <div
        style={{
          fontSize: 10,
          fontWeight: 600,
          textTransform: "uppercase",
          letterSpacing: 0.5,
          color: "var(--tm)",
        }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 16,
          fontWeight: 700,
          color: valueColor,
          lineHeight: 1.1,
          marginTop: 2,
        }}
      >
        {value}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Workload bucket chip — small inline mirror of the roster-table chip
// ---------------------------------------------------------------------------

function BucketChip({
  value,
}: {
  value: ResourceRosterRow["workload_bucket"];
}) {
  const cls =
    value === "Overloaded"
      ? "bg-red-100 text-red-800"
      : value === "Heavy"
        ? "bg-amber-100 text-amber-900"
        : value === "Balanced"
          ? "bg-emerald-100 text-emerald-800"
          : "bg-gray-100 text-gray-700";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {value}
    </span>
  );
}

function PerfPill({
  on_time_rate,
  blocked_day_rate,
  thresholds,
}: {
  on_time_rate: number | null;
  blocked_day_rate: number | null;
  thresholds: ResourceSettings["performance_thresholds"];
}) {
  // Compute the same composite the roster does so the pill matches
  // the Overview's pill closely. We use 0.6/0.4 weights to avoid
  // threading the weights prop through every card; bucket boundaries
  // are still admin-tunable via `thresholds`. The Overview's
  // authoritative bucket lives on the roster row.
  if (on_time_rate === null && blocked_day_rate === null) return null;
  const score =
    (on_time_rate ?? 0) * 0.6 + (1 - (blocked_day_rate ?? 0)) * 0.4;
  const bucket =
    score >= thresholds.green_min
      ? "Green"
      : score >= thresholds.yellow_min
        ? "Yellow"
        : "Red";
  const cls =
    bucket === "Green"
      ? "bg-emerald-100 text-emerald-800"
      : bucket === "Yellow"
        ? "bg-amber-100 text-amber-900"
        : "bg-red-100 text-red-800";
  return (
    <span
      className={`rounded px-1.5 py-0.5 text-[10px] font-bold uppercase tracking-wider ${cls}`}
    >
      {bucket}
    </span>
  );
}
