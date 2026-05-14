"use client";

/**
 * Capacity / Resource roadmap view (Section 5.8).
 *
 * Pivots projects by their assignees: each row is a team member, each
 * bar is one of their active project assignments over time. The same
 * date-projection math powers the bars as in the Timeline view (Section
 * 5.4). Cells where a resource has more concurrent assignments than the
 * configured threshold are highlighted as overload.
 */

import { useMemo, useState } from "react";

import {
  PRIORITY_BADGE,
  STATUS_BADGE,
  priorityBadgeClass,
  statusBadgeClass,
} from "@/lib/projects/display";
import {
  buildWindow,
  generateTicks,
  todayUtc,
  type DateGranularity,
  type TimeWindow,
} from "@/lib/roadmap/dates";
import {
  buildResourceRows,
  findGaps,
  totalDays,
  type ResourceRow,
} from "@/lib/roadmap/capacity";
import type { Project } from "@/lib/db";

interface CapacityViewProps {
  projects: Project[];
  onOpenQuickView: (projectId: string) => void;
}

type ColorBy = "priority" | "status" | "project";

const SIDEBAR_WIDTH = 200;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT = 60;
const BAR_HEIGHT = 16;
const BAR_GAP = 2;

const PROJECT_COLORS = [
  "bg-blue-200 text-blue-900 ring-blue-300",
  "bg-emerald-200 text-emerald-900 ring-emerald-300",
  "bg-amber-200 text-amber-900 ring-amber-300",
  "bg-rose-200 text-rose-900 ring-rose-300",
  "bg-violet-200 text-violet-900 ring-violet-300",
  "bg-pink-200 text-pink-900 ring-pink-300",
  "bg-teal-200 text-teal-900 ring-teal-300",
  "bg-orange-200 text-orange-900 ring-orange-300",
];

export function CapacityView({
  projects,
  onOpenQuickView,
}: CapacityViewProps) {
  const [granularity, setGranularity] = useState<DateGranularity>("months");
  const [windowSpec, setWindowSpec] = useState<{
    before: number;
    after: number;
  }>({ before: 0, after: 5 });
  const [colorBy, setColorBy] = useState<ColorBy>("project");
  const [threshold, setThreshold] = useState(2);
  const [resourceFilter, setResourceFilter] = useState("");

  const window: TimeWindow = useMemo(
    () => buildWindow(granularity, windowSpec.before, windowSpec.after),
    [granularity, windowSpec],
  );

  const ticks = useMemo(() => generateTicks(window), [window]);

  const todayFrac = useMemo(() => {
    const today = todayUtc();
    if (today < window.start || today >= window.end) return null;
    return (
      (today.getTime() - window.start.getTime()) /
      (window.end.getTime() - window.start.getTime())
    );
  }, [window]);

  const rows = useMemo(
    () => buildResourceRows(projects, window, threshold),
    [projects, window, threshold],
  );

  // Stable color-by-project across resources so the same project bar
  // renders the same color everywhere it appears.
  const projectColors = useMemo(() => {
    const seen: string[] = [];
    for (const r of rows) {
      for (const a of r.assignments) {
        if (!seen.includes(a.project.project_id)) {
          seen.push(a.project.project_id);
        }
      }
    }
    const map = new Map<string, string>();
    seen.forEach((id, i) =>
      map.set(id, PROJECT_COLORS[i % PROJECT_COLORS.length]),
    );
    return map;
  }, [rows]);

  const filteredRows = useMemo(() => {
    if (!resourceFilter) return rows;
    const needle = resourceFilter.toLowerCase();
    return rows.filter((r) => r.resource.toLowerCase().includes(needle));
  }, [rows, resourceFilter]);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3 text-sm">
        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          View:
        </span>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
          {(["weeks", "months", "quarters"] as DateGranularity[]).map((g) => (
            <button
              key={g}
              type="button"
              onClick={() => setGranularity(g)}
              className={`rounded px-3 py-0.5 text-xs capitalize ${
                granularity === g
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {g}
            </button>
          ))}
        </div>

        <span className="text-xs font-medium uppercase tracking-wider text-gray-500">
          Color:
        </span>
        <div className="inline-flex rounded-md border border-gray-200 bg-white p-0.5">
          {(["project", "priority", "status"] as ColorBy[]).map((c) => (
            <button
              key={c}
              type="button"
              onClick={() => setColorBy(c)}
              className={`rounded px-3 py-0.5 text-xs capitalize ${
                colorBy === c
                  ? "bg-gray-900 text-white"
                  : "text-gray-600 hover:bg-gray-50"
              }`}
            >
              {c}
            </button>
          ))}
        </div>

        <label className="text-xs text-gray-700">
          Overload at &gt;{" "}
          <input
            type="number"
            min={1}
            max={10}
            value={threshold}
            onChange={(e) => {
              const n = Number(e.target.value);
              setThreshold(Number.isFinite(n) && n > 0 ? n : 2);
            }}
            className="w-12 rounded border border-gray-200 px-1 py-0.5 text-xs"
          />
        </label>

        <input
          type="search"
          placeholder="Filter resources…"
          value={resourceFilter}
          onChange={(e) => setResourceFilter(e.target.value)}
          className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs"
        />
      </div>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500">
          {resourceFilter
            ? `No resources matching "${resourceFilter}".`
            : "No active project assignments to plot."}
        </div>
      ) : (
        <div
          className="overflow-x-auto rounded-lg border border-gray-200 bg-white shadow-sm"
          style={{ minWidth: SIDEBAR_WIDTH + 700 }}
        >
          <div
            className="grid"
            style={{ gridTemplateColumns: `${SIDEBAR_WIDTH}px 1fr` }}
          >
            {/* Header */}
            <div
              className="border-b border-gray-200 bg-gray-50 px-3 text-xs font-medium uppercase tracking-wider text-gray-600 flex items-center"
              style={{ height: HEADER_HEIGHT }}
            >
              Resource
            </div>
            <CapacityHeader
              ticks={ticks}
              window={window}
              todayFrac={todayFrac}
            />

            {filteredRows.map((row) => (
              <CapacityRow
                key={row.resource}
                row={row}
                colorBy={colorBy}
                projectColors={projectColors}
                onOpenQuickView={onOpenQuickView}
                todayFrac={todayFrac}
              />
            ))}
          </div>
        </div>
      )}

      <div className="text-[11px] text-gray-500">
        {filteredRows.length} resource{filteredRows.length === 1 ? "" : "s"}
        {filteredRows.some((r) => r.overloaded) && (
          <>
            {" · "}
            <span className="rounded bg-red-100 px-1.5 py-0.5 font-medium text-red-800">
              Overload
            </span>{" "}
            indicates &gt; {threshold} concurrent assignments.
          </>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

interface CapacityHeaderProps {
  ticks: { date: Date; label: string }[];
  window: TimeWindow;
  todayFrac: number | null;
}

function CapacityHeader({ ticks, window, todayFrac }: CapacityHeaderProps) {
  const totalMs = window.end.getTime() - window.start.getTime();
  return (
    <div
      className="relative border-b border-gray-200 bg-gray-50"
      style={{ height: HEADER_HEIGHT }}
    >
      {ticks.map((t, i) => {
        const left = ((t.date.getTime() - window.start.getTime()) / totalMs) * 100;
        return (
          <div
            key={i}
            className="absolute top-0 h-full border-l border-gray-200 px-1.5 text-[11px] font-medium text-gray-600 flex items-center"
            style={{ left: `${left}%` }}
          >
            {t.label}
          </div>
        );
      })}
      {todayFrac !== null && (
        <div
          className="absolute top-0 h-full w-0.5 bg-blue-500"
          style={{ left: `${todayFrac * 100}%` }}
          aria-hidden
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Row (one per resource)
// ---------------------------------------------------------------------------

interface CapacityRowProps {
  row: ResourceRow;
  colorBy: ColorBy;
  projectColors: Map<string, string>;
  onOpenQuickView: (id: string) => void;
  todayFrac: number | null;
}

function CapacityRow({
  row,
  colorBy,
  projectColors,
  onOpenQuickView,
  todayFrac,
}: CapacityRowProps) {
  // Pack assignments into vertical lanes to handle overlap. A simple
  // first-fit allocator: scan each assignment, pick the first lane whose
  // last bar ends before this one starts.
  const lanes: typeof row.assignments[] = [];
  for (const a of row.assignments) {
    let placed = false;
    for (const lane of lanes) {
      const last = lane[lane.length - 1];
      if (last.bar.rightFrac <= a.bar.leftFrac) {
        lane.push(a);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([a]);
  }
  const rowHeight = Math.max(
    ROW_HEIGHT,
    HEADER_HEIGHT + lanes.length * (BAR_HEIGHT + BAR_GAP),
  );

  const gaps = findGaps(row.assignments);
  const days = totalDays(row.assignments);

  return (
    <>
      <div
        className="border-b border-gray-100 px-3 py-2 text-sm"
        style={{ minHeight: rowHeight }}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900">{row.resource}</span>
          {row.overloaded && (
            <span className="rounded bg-red-100 px-1.5 py-0.5 text-[10px] font-medium text-red-800">
              Overload
            </span>
          )}
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500">
          {row.assignments.length} project
          {row.assignments.length === 1 ? "" : "s"}
          {row.concurrentNow > 0 && ` · ${row.concurrentNow} active now`}
          {days > 0 && ` · ${days}d total`}
        </div>
      </div>
      <div
        className="relative border-b border-gray-100 bg-white"
        style={{ minHeight: rowHeight }}
      >
        {/* Available time backdrop */}
        {gaps.map((g, i) => (
          <div
            key={i}
            className="absolute top-1 bottom-1 bg-gray-50"
            style={{
              left: `${g.leftFrac * 100}%`,
              width: `${(g.rightFrac - g.leftFrac) * 100}%`,
            }}
            aria-hidden
          />
        ))}

        {/* Today line */}
        {todayFrac !== null && (
          <div
            className="absolute top-0 h-full w-0.5 bg-blue-500/30 pointer-events-none"
            style={{ left: `${todayFrac * 100}%` }}
            aria-hidden
          />
        )}

        {lanes.map((lane, laneIdx) =>
          lane.map((a) => {
            const widthPct = Math.max(
              1.5,
              (a.bar.rightFrac - a.bar.leftFrac) * 100,
            );
            const colorClass =
              colorBy === "priority"
                ? priorityBadgeClass(a.project.priority)
                : colorBy === "status"
                  ? statusBadgeClass(a.project.status)
                  : projectColors.get(a.project.project_id) ??
                    "bg-gray-200 text-gray-900 ring-gray-300";
            const top =
              4 + laneIdx * (BAR_HEIGHT + BAR_GAP);
            return (
              <button
                key={`${a.project.project_id}-${laneIdx}`}
                type="button"
                onClick={() => onOpenQuickView(a.project.project_id)}
                title={`${a.project.project_id} · ${a.project.name} (${a.role})`}
                className={`absolute flex items-center rounded px-1.5 text-[10px] font-medium ring-1 ring-inset truncate ${colorClass}`}
                style={{
                  top,
                  height: BAR_HEIGHT,
                  left: `${a.bar.leftFrac * 100}%`,
                  width: `${widthPct}%`,
                  opacity: a.role === "Lead" ? 1 : 0.85,
                }}
              >
                <span className="truncate">
                  {a.role === "Lead" ? "★ " : ""}
                  {a.project.name}
                </span>
              </button>
            );
          }),
        )}
      </div>
    </>
  );
}
