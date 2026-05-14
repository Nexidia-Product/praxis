"use client";

/**
 * Project health-score sparkline (Section 5.13).
 *
 * Renders the last 30 daily snapshots of a project's health score as a
 * compact horizontal strip — one segment per snapshot, colored by the
 * score on that day. Designed to fit in the quick-view's Details tab
 * alongside the health badge so the operator can see how stable (or
 * volatile) the score has been.
 *
 * Why a colored strip rather than a line chart:
 *   - Health is a 3-value enum (Red / Yellow / Green), not a continuous
 *     measurement. A line chart with three plateaus would be misleading;
 *     it implies interpolation between values that don't have a midpoint.
 *   - A strip is unambiguous at a glance: blocks of red / yellow / green.
 *   - No chart library — matches the no-dependency philosophy of the
 *     roadmap module (`lib/roadmap/`).
 *
 * Snapshot resolution is one-per-day (enforced in `appendHistory` in
 * `lib/health.ts`), so 30 days of history = at most 30 segments. Older
 * entries get trimmed off the front by the same helper.
 *
 * Empty / single-snapshot cases:
 *   - 0 snapshots: render the placeholder text "No history yet."
 *   - 1 snapshot: render a single full-width segment so the user sees
 *     *something*.
 */

import type { HealthScore, HealthScoreSnapshot } from "@/lib/db";

interface HealthSparklineProps {
  history: HealthScoreSnapshot[];
  /** Optional currently-displayed score; used as a fallback if history empty. */
  currentScore?: HealthScore | null;
  width?: number;
  height?: number;
  /** Show the date range under the strip. Defaults to true. */
  showDateRange?: boolean;
}

const SEGMENT_FILL: Record<HealthScore, string> = {
  Green: "#10b981", // emerald-500
  Yellow: "#f59e0b", // amber-500
  Red: "#ef4444", // red-500
};

export function HealthSparkline({
  history,
  currentScore,
  width = 240,
  height = 18,
  showDateRange = true,
}: HealthSparklineProps) {
  // Empty case — show the badge color if a current score exists, else
  // a neutral placeholder. We never draw an empty SVG; an empty strip
  // looks broken.
  if (history.length === 0) {
    if (currentScore) {
      return (
        <div className="flex items-center gap-2 text-xs text-gray-500">
          <span
            className="inline-block h-3 w-12 rounded-sm"
            style={{ backgroundColor: SEGMENT_FILL[currentScore] }}
          />
          <span>No history yet (current: {currentScore}).</span>
        </div>
      );
    }
    return (
      <p className="text-xs text-gray-500">No health history yet.</p>
    );
  }

  // Each segment is the same width — a calendar-uniform layout would be
  // nicer (so a 5-day gap shows as a wider segment), but the daily-snapshot
  // contract makes equal-width segments the right default: each segment
  // is one calendar day, gaps mean "no recalc happened that day", and
  // squeezing-in-gap-days is more confusing than collapsing.
  const segmentWidth = width / history.length;
  const firstDate = history[0].date;
  const lastDate = history[history.length - 1].date;

  // Count by score, displayed in the title attribute as a textual summary
  // so screen readers / power users can read the breakdown without
  // hovering individual segments.
  const counts: Record<HealthScore, number> = { Red: 0, Yellow: 0, Green: 0 };
  for (const s of history) {
    counts[s.score]++;
  }
  const summary = `${history.length} day(s) of history: ${counts.Green} Green, ${counts.Yellow} Yellow, ${counts.Red} Red.`;

  return (
    <div>
      <svg
        role="img"
        aria-label={summary}
        width={width}
        height={height}
        viewBox={`0 0 ${width} ${height}`}
        className="rounded-sm"
      >
        <title>{summary}</title>
        {history.map((snapshot, i) => (
          <rect
            key={`${snapshot.date}-${i}`}
            x={i * segmentWidth}
            y={0}
            width={segmentWidth + 0.5 /* avoid hairline gaps from rounding */}
            height={height}
            fill={SEGMENT_FILL[snapshot.score]}
          >
            <title>
              {snapshot.date} — {snapshot.score}
            </title>
          </rect>
        ))}
      </svg>
      {showDateRange ? (
        <div className="mt-1 flex items-center justify-between text-[10px] uppercase tracking-wider text-gray-500">
          <span>{firstDate}</span>
          <span>{lastDate}</span>
        </div>
      ) : null}
    </div>
  );
}
