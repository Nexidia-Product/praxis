"use client";

/**
 * Resources → Capacity tab.
 *
 * Swim-lane Gantt scoped to the resources visible in the parent
 * workspace's roster (so My team / Everyone scoping flows through),
 * with a task density strip layered under each resource's project
 * bars so you can see *when* their task load is concentrated.
 *
 * This used to coexist with a simpler swim-lane view on the Roadmap
 * page; the Roadmap version has been removed and Resources is now the
 * single home for capacity. The view is implemented fresh here rather
 * than as a wrapper because:
 *   - The roster has already applied dedupe + My team / Everyone
 *     scoping, and we want to use that scoped list rather than rebuild
 *     it from raw projects;
 *   - Each row layers task data on top of the project bars, which
 *     wasn't part of the original Roadmap version (project-only
 *     mental model);
 *   - It avoids prop-drilling task data through plumbing that didn't
 *     anticipate it.
 *
 * The date math (`buildWindow`, `generateTicks`, `projectProjectBar`)
 * is reused as-is from `lib/roadmap/dates.ts`. The capacity row builder
 * (`findGaps`) is reused from `lib/roadmap/capacity.ts`. Both files
 * remain under `lib/roadmap/` for historical reasons; they're shared
 * helpers, and the import paths give continuity for anyone navigating
 * via the prior history.
 */

import { useMemo, useState } from "react";

import {
  buildWindow,
  generateTicks,
  projectProjectBar,
  todayUtc,
  type DateGranularity,
  type TimeWindow,
} from "@/lib/roadmap/dates";
import { findGaps } from "@/lib/roadmap/capacity";
import {
  priorityBadgeClass,
  statusBadgeClass,
} from "@/lib/projects/display";
import type { Project, Task } from "@/lib/db";
import type { ResourceRosterRow } from "@/lib/resources/roster";

interface CapacityTabProps {
  roster: ResourceRosterRow[];
}

type ColorBy = "priority" | "status" | "project";

const SIDEBAR_WIDTH = 220;
const HEADER_HEIGHT = 32;
const ROW_HEIGHT_BASE = 64;
const BAR_HEIGHT = 14;
const BAR_GAP = 2;
const TASK_STRIP_HEIGHT = 14;

/** Stable color palette for "color by project" mode. */
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

export function CapacityTab({ roster }: CapacityTabProps) {
  const [granularity, setGranularity] = useState<DateGranularity>("months");
  const [windowSpec, setWindowSpec] = useState<{
    before: number;
    after: number;
  }>({ before: 0, after: 5 });
  const [colorBy, setColorBy] = useState<ColorBy>("project");
  const [filter, setFilter] = useState("");

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

  // Build per-row swim-lane data from the roster. The roster already
  // grouped projects + tasks per resource; we just project each
  // assignment onto the time window using the existing date math.
  const swimRows = useMemo(
    () => buildSwimRows(roster, window),
    [roster, window],
  );

  // Stable per-project color so a project bar reads the same color
  // wherever it appears.
  const projectColors = useMemo(() => {
    const seen: string[] = [];
    for (const r of swimRows) {
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
  }, [swimRows]);

  const filteredRows = useMemo(() => {
    if (!filter) return swimRows;
    const needle = filter.toLowerCase();
    return swimRows.filter((r) =>
      r.row.resource.toLowerCase().includes(needle),
    );
  }, [swimRows, filter]);

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

        <input
          type="search"
          placeholder="Filter resources…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          className="ml-auto rounded-md border border-gray-200 px-2 py-1 text-xs"
        />
      </div>

      {filteredRows.length === 0 ? (
        <div className="rounded-lg border border-dashed border-gray-200 bg-gray-50 p-12 text-center text-sm text-gray-500">
          {filter
            ? `No resources matching "${filter}".`
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
            {/* Header row */}
            <div
              className="border-b border-r border-gray-200 bg-gray-50 px-3 text-[11px] font-medium uppercase tracking-wider text-gray-500 flex items-center"
              style={{ height: HEADER_HEIGHT }}
            >
              Resource
            </div>
            <CapacityHeader ticks={ticks} window={window} todayFrac={todayFrac} />

            {filteredRows.map((srow) => (
              <CapacityRow
                key={srow.row.resource}
                srow={srow}
                window={window}
                colorBy={colorBy}
                projectColors={projectColors}
                todayFrac={todayFrac}
              />
            ))}
          </div>
        </div>
      )}

      <Legend />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Roster → swim-lane data
// ---------------------------------------------------------------------------

interface SwimAssignment {
  project: Project;
  /** "Lead" if the resource is the project_lead, else "Resource". */
  role: "Lead" | "Resource";
  /**
   * Always non-null at insertion time — buildSwimRows skips bars
   * that come back null or hidden. Narrowed here so downstream
   * code doesn't need to re-check.
   */
  bar: NonNullable<ReturnType<typeof projectProjectBar>>;
}

interface SwimRow {
  row: ResourceRosterRow;
  assignments: SwimAssignment[];
  /** Open tasks projected as fractional positions on the same window. */
  taskMarks: TaskMark[];
}

interface TaskMark {
  task: Task;
  frac: number;
  kind: "blocked" | "past_due" | "open";
}

/**
 * Walk the roster, project each active project onto the time
 * window, and project each open task onto the same axis based on
 * its target_date. Tasks without a target_date don't appear on the
 * strip — there's nowhere to place them.
 */
function buildSwimRows(
  roster: ResourceRosterRow[],
  window: TimeWindow,
): SwimRow[] {
  const totalMs = window.end.getTime() - window.start.getTime();
  const today = todayUtc().toISOString().slice(0, 10);

  function dateToFrac(dateOnly: string): number | null {
    const t = new Date(`${dateOnly}T00:00:00Z`).getTime();
    if (!Number.isFinite(t)) return null;
    if (totalMs <= 0) return null;
    const frac = (t - window.start.getTime()) / totalMs;
    if (frac < 0 || frac > 1) return null;
    return frac;
  }

  const rows: SwimRow[] = [];
  for (const r of roster) {
    const assignments: SwimAssignment[] = [];
    for (const p of r.active_projects) {
      const bar = projectProjectBar(p, window);
      if (!bar || bar.hidden) continue;
      const role: "Lead" | "Resource" =
        p.project_lead === r.user_id || p.project_lead === r.resource
          ? "Lead"
          : "Resource";
      assignments.push({ project: p, role, bar });
    }
    // Sort by start so the lane-pack is deterministic.
    assignments.sort((a, b) => a.bar.start.getTime() - b.bar.start.getTime());

    const blockedIds = new Set(r.blocked_tasks.map((t) => t.task_id));
    const taskMarks: TaskMark[] = [];
    for (const t of r.open_tasks) {
      if (!t.target_date) continue;
      const frac = dateToFrac(t.target_date);
      if (frac === null) continue;
      const isBlocked = blockedIds.has(t.task_id);
      const isPastDue = !isBlocked && t.target_date < today;
      taskMarks.push({
        task: t,
        frac,
        kind: isBlocked ? "blocked" : isPastDue ? "past_due" : "open",
      });
    }
    rows.push({ row: r, assignments, taskMarks });
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Header
// ---------------------------------------------------------------------------

function CapacityHeader({
  ticks,
  window,
  todayFrac,
}: {
  ticks: { date: Date; label: string }[];
  window: TimeWindow;
  todayFrac: number | null;
}) {
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
// Row
// ---------------------------------------------------------------------------

function CapacityRow({
  srow,
  window,
  colorBy,
  projectColors,
  todayFrac,
}: {
  srow: SwimRow;
  window: TimeWindow;
  colorBy: ColorBy;
  projectColors: Map<string, string>;
  todayFrac: number | null;
}) {
  // Pack assignments into vertical lanes (first-fit). Same algorithm
  // as the existing CapacityView so visual density matches.
  const lanes: SwimAssignment[][] = [];
  for (const a of srow.assignments) {
    let placed = false;
    for (const lane of lanes) {
      const last = lane[lane.length - 1];
      if (last && last.bar.rightFrac <= a.bar.leftFrac) {
        lane.push(a);
        placed = true;
        break;
      }
    }
    if (!placed) lanes.push([a]);
  }
  const projectsHeight =
    lanes.length > 0 ? lanes.length * (BAR_HEIGHT + BAR_GAP) : 0;
  const rowHeight = Math.max(
    ROW_HEIGHT_BASE,
    8 + projectsHeight + 6 + TASK_STRIP_HEIGHT + 6,
  );

  // Convert the original ResourceRow gap finder shape to the
  // assignments shape it expects. We only need it for the visual
  // backdrop — the math is identical.
  const gaps = findGaps(
    srow.assignments.map((a) => ({
      resource: srow.row.resource,
      role: a.role,
      project: a.project,
      bar: a.bar,
    })),
  );

  // Mini-summary line under the resource name.
  const totalProjects = srow.assignments.length;
  const totalOpen = srow.row.open_tasks.length;
  const nPastDue = srow.row.past_due_tasks.length;
  const nBlocked = srow.row.blocked_tasks.length;

  return (
    <>
      <div
        className="border-b border-r border-gray-100 px-3 py-2 text-sm"
        style={{ minHeight: rowHeight }}
      >
        <div className="flex items-center gap-2">
          <span className="font-medium text-gray-900 truncate">
            {srow.row.resource}
          </span>
          <BucketChip value={srow.row.workload_bucket} />
        </div>
        <div className="mt-0.5 text-[11px] text-gray-500">
          {totalProjects} project{totalProjects === 1 ? "" : "s"} ·{" "}
          {totalOpen} task{totalOpen === 1 ? "" : "s"}
          {nPastDue > 0 ? (
            <span className="text-red-600"> · {nPastDue} past-due</span>
          ) : null}
          {nBlocked > 0 ? (
            <span className="text-red-600"> · {nBlocked} blocked</span>
          ) : null}
        </div>
      </div>

      <div
        className="relative border-b border-gray-100 bg-white"
        style={{ minHeight: rowHeight }}
      >
        {/* Available-time backdrop */}
        {gaps.map((g, i) => (
          <div
            key={i}
            className="absolute top-1 bg-gray-50"
            style={{
              bottom: TASK_STRIP_HEIGHT + 6,
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

        {/* Project bars */}
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
            const top = 6 + laneIdx * (BAR_HEIGHT + BAR_GAP);
            // Tooltip wires up the dates the user expects — project's
            // own start (roadmap_timeline_start ?? date_added) and
            // target_date — rather than the bar's clipped fractions
            // (ROAD-20). Falls back to a dash for missing values.
            const startLabel =
              a.project.roadmap_timeline_start ?? a.project.date_added;
            const targetLabel = a.project.target_date ?? "—";
            const tipLines = [
              `${a.project.project_id} · ${a.project.name}`,
              `Role: ${a.role}`,
              `Start: ${startLabel ?? "—"}`,
              `Target: ${targetLabel}`,
            ];
            return (
              <div
                key={`${a.project.project_id}-${laneIdx}`}
                title={tipLines.join("\n")}
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
              </div>
            );
          }),
        )}

        {/* Task density strip — separator + line of marks at task
            target_date positions. Below the project lanes so they're
            scannable as a separate axis. */}
        <div
          className="absolute left-0 right-0"
          style={{ bottom: 6, height: TASK_STRIP_HEIGHT }}
        >
          <div
            className="absolute left-0 right-0 top-1/2 h-px bg-gray-200"
            aria-hidden
          />
          {srow.taskMarks.map((m) => (
            <div
              key={m.task.task_id}
              title={taskMarkTitle(m)}
              className={`absolute top-1/2 h-2 w-2 -translate-y-1/2 -translate-x-1/2 rounded-full ${taskMarkColor(m.kind)}`}
              style={{ left: `${m.frac * 100}%` }}
              aria-hidden
            />
          ))}
        </div>
      </div>
    </>
  );
}

function taskMarkColor(kind: TaskMark["kind"]): string {
  if (kind === "blocked") return "bg-red-500";
  if (kind === "past_due") return "bg-orange-500";
  return "bg-emerald-500";
}

function taskMarkTitle(m: TaskMark): string {
  const status =
    m.kind === "blocked"
      ? "blocked"
      : m.kind === "past_due"
        ? "past due"
        : "open";
  return `${m.task.task_id} · ${m.task.task_name}\nDue ${m.task.target_date} (${status})`;
}

// ---------------------------------------------------------------------------
// Bucket chip — small inline mirror of the roster-table chip
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
      className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wider ${cls}`}
    >
      {value}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Legend
// ---------------------------------------------------------------------------

function Legend() {
  return (
    <div className="flex flex-wrap items-center gap-4 px-1 text-[11px] text-gray-500">
      <span>
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-emerald-500 align-middle" />
        Open task
      </span>
      <span>
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-orange-500 align-middle" />
        Past-due task
      </span>
      <span>
        <span className="mr-1 inline-block h-2 w-2 rounded-full bg-red-500 align-middle" />
        Blocked task
      </span>
      <span className="ml-auto">★ = Project Lead</span>
    </div>
  );
}
