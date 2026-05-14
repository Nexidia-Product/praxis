/**
 * Capacity helpers (Section 5.8).
 *
 * Pivots a flat list of projects (each with a Project Lead and a list of
 * Additional Resources) into a per-resource view: each row is one team
 * member, each cell is one of their active project assignments shown as
 * a horizontal bar over time.
 *
 * Originally part of the Roadmap; now consumed by the Capacity tab on
 * the Insights → Resources page (`components/resources/capacity-tab.tsx`).
 * The file lives under `lib/roadmap/` for historical reasons — it
 * predates the Resources page and the Resources tab reuses it directly
 * rather than forking.
 *
 * Active = status is one of the open buckets. We don't include Completed
 * or Canceled assignments — they'd dominate the view for any team that's
 * been running a while, and the user is trying to see *current* load.
 */

import {
  daysBetween,
  parseIsoDate,
  projectProjectBar,
  todayUtc,
  type ProjectedBar,
  type TimeWindow,
} from "./dates";
import type { Project, ProjectStatus } from "@/lib/db";

const ACTIVE_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
]);

export type AssignmentRole = "Lead" | "Resource";

export interface ResourceAssignment {
  resource: string;
  role: AssignmentRole;
  project: Project;
  bar: ProjectedBar;
}

export interface ResourceRow {
  resource: string;
  assignments: ResourceAssignment[];
  /** Number of bars overlapping the "now" cursor — used for overload calc. */
  concurrentNow: number;
  /** True if any moment in the window has more than the overload threshold. */
  overloaded: boolean;
}

/**
 * Group projects by resource. A project shows up under its lead AND under
 * each additional_resource — so a project lead with three reports on the
 * same project produces four rows for that project in the chart.
 */
export function buildResourceRows(
  projects: Project[],
  window: TimeWindow,
  overloadThreshold: number = 2,
): ResourceRow[] {
  const byResource = new Map<string, ResourceAssignment[]>();

  function add(name: string, role: AssignmentRole, project: Project) {
    const trimmed = name.trim();
    if (!trimmed) return;
    const bar = projectProjectBar(project, window);
    if (!bar || bar.hidden) return;
    const list = byResource.get(trimmed) ?? [];
    list.push({ resource: trimmed, role, project, bar });
    byResource.set(trimmed, list);
  }

  for (const p of projects) {
    if (!ACTIVE_STATUSES.has(p.status)) continue;
    if (p.project_lead) add(p.project_lead, "Lead", p);
    for (const r of p.additional_resources) add(r, "Resource", p);
  }

  const today = todayUtc();
  const totalMs = window.end.getTime() - window.start.getTime();
  const todayFrac =
    totalMs > 0
      ? Math.max(
          0,
          Math.min(
            1,
            (today.getTime() - window.start.getTime()) / totalMs,
          ),
        )
      : 0;

  const rows: ResourceRow[] = [];
  for (const [resource, assignments] of byResource.entries()) {
    // Sort assignments by start date so the bars stack predictably.
    assignments.sort((a, b) => {
      const ad = a.bar.start.getTime();
      const bd = b.bar.start.getTime();
      return ad - bd;
    });
    const concurrentNow = assignments.filter((a) => {
      return a.bar.leftFrac <= todayFrac && a.bar.rightFrac >= todayFrac;
    }).length;
    const overloaded = anyConcurrencyOver(assignments, overloadThreshold);
    rows.push({ resource, assignments, concurrentNow, overloaded });
  }

  rows.sort((a, b) => a.resource.localeCompare(b.resource));
  return rows;
}

/**
 * True if at any time within the window the resource has more than
 * `threshold` overlapping assignments. A sweep through all bar
 * start/end events is enough — the bars are already projected.
 */
function anyConcurrencyOver(
  assignments: ResourceAssignment[],
  threshold: number,
): boolean {
  if (assignments.length <= threshold) return false;
  const events: { frac: number; delta: 1 | -1 }[] = [];
  for (const a of assignments) {
    events.push({ frac: a.bar.leftFrac, delta: 1 });
    events.push({ frac: a.bar.rightFrac, delta: -1 });
  }
  events.sort((a, b) => {
    if (a.frac !== b.frac) return a.frac - b.frac;
    // ends before starts at the same point — exclusive intervals
    return a.delta - b.delta;
  });
  let active = 0;
  for (const e of events) {
    active += e.delta;
    if (active > threshold) return true;
  }
  return false;
}

/**
 * Given a resource and a project, identify "gaps" in their schedule
 * within the window. Returned as fractional ranges [leftFrac, rightFrac]
 * where the resource has no assignment. Used to render the gray
 * "available" backdrop on each row.
 */
export function findGaps(
  assignments: ResourceAssignment[],
): { leftFrac: number; rightFrac: number }[] {
  if (assignments.length === 0) {
    return [{ leftFrac: 0, rightFrac: 1 }];
  }
  const sorted = [...assignments].sort(
    (a, b) => a.bar.leftFrac - b.bar.leftFrac,
  );
  const gaps: { leftFrac: number; rightFrac: number }[] = [];
  let cursor = 0;
  for (const a of sorted) {
    if (a.bar.leftFrac > cursor) {
      gaps.push({ leftFrac: cursor, rightFrac: a.bar.leftFrac });
    }
    cursor = Math.max(cursor, a.bar.rightFrac);
  }
  if (cursor < 1) {
    gaps.push({ leftFrac: cursor, rightFrac: 1 });
  }
  return gaps;
}

/** Total assignment days for a resource in the window — used for sorting. */
export function totalDays(assignments: ResourceAssignment[]): number {
  let total = 0;
  for (const a of assignments) {
    total += daysBetween(a.bar.start, a.bar.end);
  }
  return total;
}

/** Resolve a date string for the Lead's start: roadmap_timeline_start
 *  → date_added → window.start. */
export function resolveResourceStart(p: Project, window: TimeWindow): Date {
  return (
    parseIsoDate(p.roadmap_timeline_start) ??
    parseIsoDate(p.date_added) ??
    window.start
  );
}
