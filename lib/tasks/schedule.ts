/**
 * Estimate-driven task scheduling (Section 4.2 follow-up).
 *
 * Computes each task's due date (`target_date`) from its own estimate and
 * its dependency chain, anchored at the project's `roadmap_timeline_start`
 * ("Start date"). Pure, no I/O — callers (`lib/tasks/service.ts`) fetch the
 * project/task rows and apply the result.
 *
 * `Task` only stores one date (`target_date`, the finish date) — there's no
 * separate `start_date` column. A task's start is derived on the fly as
 * `due − duration + 1 business day`, which is enough to correctly support
 * all four dependency types (FS/SS/FF/SF) without a schema change: once a
 * predecessor's finish date and duration are known, its start is implied.
 *
 * Scope, deliberately:
 *   - Per-project. A predecessor outside the provided task set (e.g. a
 *     cross-project dependency, which the data model allows) is treated as
 *     non-constraining — true cross-project forward scheduling is out of
 *     scope.
 *   - A task with no dependency edges at all, in either direction, is
 *     "isolated" and excluded from the result map entirely. There's no
 *     project-start relationship to an unconnected, purely-manual task —
 *     UNLESS it's a `friday_anchor` or has a `fixed_lag_business_days_after`
 *     (below), which is explicit intent to schedule it regardless.
 *   - A task with no `estimate_hours`, or whose required start can't be
 *     resolved (no project start date, or an unresolved/cyclic upstream
 *     predecessor), maps to `null`. Callers must never write `null` over
 *     an existing `target_date` — the absence of a computed value means
 *     "can't say," not "clear it."
 *
 * Two opt-in overrides exist for release-calendar milestone tasks (e.g.
 * executable/application deployment), which must land on a Friday and
 * stay an exact number of business days apart regardless of how many
 * ordinary tasks sit between them — see `friday_anchor` and
 * `fixed_lag_business_days_after` on `SchedulableTask`.
 *
 * A root task's date is normally derived fresh from `projectStart` on
 * every call. Pass `{ respectCurrentRootDates: true }` (via
 * `current_target_date` on each task) when a reschedule is triggered by
 * a task-level edit rather than a project-start change, so editing one
 * task's date cascades through its dependents instead of snapping the
 * edited root task back to its original project-start-derived value.
 */

import {
  addBusinessDays,
  isFriday,
  subtractBusinessDays,
} from "@/lib/projects/milestones";
import type { IsoDate, TaskDependency, TaskId } from "@/lib/db";

export const HOURS_PER_BUSINESS_DAY = 8;

/** At least 1 business day, even for a sub-day estimate. */
export function durationBusinessDays(hours: number): number {
  return Math.max(1, Math.ceil(hours / HOURS_PER_BUSINESS_DAY));
}

/** The next Friday on or after `iso` (itself, if already a Friday). */
function nextFriday(iso: IsoDate): IsoDate {
  let d = iso;
  while (!isFriday(d)) d = addBusinessDays(d, 1);
  return d;
}

export interface SchedulableTask {
  task_id: TaskId;
  estimate_hours: number | null;
  dependencies: TaskDependency[];
  /**
   * Snap the computed due date forward to the next Friday if it doesn't
   * already land on one. See `Task.friday_anchor`.
   */
  friday_anchor?: boolean;
  /**
   * Override the normal dependency-chain date computation: this task's
   * due date is exactly `business_days` business days after the
   * referenced task's own (possibly Friday-snapped) due date. The
   * ordinary `dependencies` array is ignored for date purposes when this
   * is set (it still participates in whatever else reads it, e.g. the
   * FS-cascade auto-status logic upstream of this function). See
   * `Task.fixed_lag_business_days_after`.
   */
  fixed_lag_business_days_after?: { task_id: TaskId; business_days: number } | null;
  /**
   * The task's currently stored `target_date`. Only consulted for a ROOT
   * task (no in-scope dependencies or fixed-lag) when `respectCurrentRootDates`
   * is on: once a root task has a date — whether set by an earlier
   * auto-computation or a direct manual edit — that date is the anchor
   * for its own successors going forward, not `projectStart`. This is
   * what makes "I moved task 1 out a week" cascade through its
   * dependents instead of task 1 snapping back to the original
   * project-start-derived date on the next recompute. Ignored for
   * non-root tasks, which are always re-derived from their predecessors.
   */
  current_target_date?: IsoDate | null;
}

export interface ScheduleOptions {
  /**
   * When true, a root task with a non-null `current_target_date` keeps it
   * instead of being (re)derived from `projectStart`. Used for reschedules
   * triggered by a task-level edit (estimate/dependency/target_date),
   * where only the edited task's own change — and its downstream effects
   * — should move. When false (the default), every root task is derived
   * fresh from `projectStart` — used when the project's start date
   * itself just changed, which is meant to shift the whole schedule.
   */
  respectCurrentRootDates?: boolean;
}

interface Resolved {
  due: IsoDate | null;
  duration: number | null;
}

/**
 * This task's earliest allowed start per a single dependency edge, given
 * the (already-resolved) predecessor's finish date and duration.
 */
function candidateStart(
  type: TaskDependency["type"],
  predecessorDue: IsoDate,
  predecessorDuration: number,
  myDuration: number,
): IsoDate {
  const predecessorStart = subtractBusinessDays(
    predecessorDue,
    predecessorDuration - 1,
  );
  switch (type) {
    case "FS":
      return addBusinessDays(predecessorDue, 1);
    case "SS":
      return predecessorStart;
    case "FF":
      return subtractBusinessDays(predecessorDue, myDuration - 1);
    case "SF":
      return subtractBusinessDays(predecessorStart, myDuration - 1);
  }
}

export function scheduleTaskDates(
  projectStart: IsoDate | null,
  tasks: SchedulableTask[],
  options: ScheduleOptions = {},
): Map<TaskId, IsoDate | null> {
  const { respectCurrentRootDates = false } = options;
  const byId = new Map(tasks.map((t) => [t.task_id, t] as const));

  // In-scope dependency edges only (predecessor must be in this task set).
  const inScopeDeps = new Map<TaskId, TaskDependency[]>();
  const hasSuccessor = new Set<TaskId>();
  for (const t of tasks) {
    const deps = t.dependencies.filter((d) => byId.has(d.predecessor_task_id));
    inScopeDeps.set(t.task_id, deps);
    for (const d of deps) hasSuccessor.add(d.predecessor_task_id);
  }

  // The in-scope fixed-lag target, if any — resolved once per task since
  // it's used both for ordering (below) and for date computation.
  const fixedLagTarget = (t: SchedulableTask): TaskId | null => {
    const lag = t.fixed_lag_business_days_after;
    return lag && byId.has(lag.task_id) ? lag.task_id : null;
  };

  const isIsolated = (t: SchedulableTask) =>
    t.dependencies.length === 0 &&
    !t.fixed_lag_business_days_after &&
    !t.friday_anchor &&
    !hasSuccessor.has(t.task_id);

  // Kahn's algorithm. Ordering predecessors are the in-scope dependency
  // edges PLUS a fixed-lag target, if any — a fixed-lag task must be
  // processed after the task it's offset from, same as an ordinary FS
  // dependency, even though its date math (below) ignores `dependencies`
  // entirely in favor of the lag.
  const inDegree = new Map<TaskId, number>();
  const successorsOf = new Map<TaskId, TaskId[]>();
  for (const t of tasks) {
    const lagTarget = fixedLagTarget(t);
    const count = inScopeDeps.get(t.task_id)!.length + (lagTarget ? 1 : 0);
    inDegree.set(t.task_id, count);
    if (lagTarget) {
      const arr = successorsOf.get(lagTarget) ?? [];
      arr.push(t.task_id);
      successorsOf.set(lagTarget, arr);
    }
  }
  for (const [id, deps] of inScopeDeps) {
    for (const d of deps) {
      const arr = successorsOf.get(d.predecessor_task_id) ?? [];
      arr.push(id);
      successorsOf.set(d.predecessor_task_id, arr);
    }
  }

  const queue: TaskId[] = [];
  for (const [id, deg] of inDegree) if (deg === 0) queue.push(id);

  const resolved = new Map<TaskId, Resolved>();
  const processed = new Set<TaskId>();

  while (queue.length > 0) {
    const id = queue.shift()!;
    processed.add(id);
    const task = byId.get(id)!;

    const duration =
      task.estimate_hours != null ? durationBusinessDays(task.estimate_hours) : null;
    const deps = inScopeDeps.get(id)!;
    const lag = task.fixed_lag_business_days_after;
    const lagTarget = fixedLagTarget(task);

    let due: IsoDate | null = null;
    if (duration != null) {
      if (lag) {
        // Fixed-lag override: ignore `dependencies` for date purposes.
        const target = lagTarget ? resolved.get(lagTarget) : null;
        if (target?.due != null) {
          due = addBusinessDays(target.due, lag.business_days);
        }
      } else if (deps.length === 0) {
        if (respectCurrentRootDates && task.current_target_date) {
          due = task.current_target_date;
        } else if (projectStart) {
          due = addBusinessDays(projectStart, duration - 1);
        }
      } else {
        const candidates: IsoDate[] = [];
        let blocked = false;
        for (const d of deps) {
          const pred = resolved.get(d.predecessor_task_id);
          if (!pred || pred.due == null || pred.duration == null) {
            blocked = true;
            break;
          }
          candidates.push(
            candidateStart(d.type, pred.due, pred.duration, duration),
          );
        }
        if (!blocked && candidates.length > 0) {
          const start = candidates.reduce((a, b) => (a > b ? a : b));
          due = addBusinessDays(start, duration - 1);
        }
      }
    }

    if (due != null && task.friday_anchor && !isFriday(due)) {
      due = nextFriday(due);
    }

    resolved.set(id, { due, duration });

    for (const successorId of successorsOf.get(id) ?? []) {
      const next = (inDegree.get(successorId) ?? 0) - 1;
      inDegree.set(successorId, next);
      if (next === 0) queue.push(successorId);
    }
  }

  // Anything never dequeued is part of a cycle — leave unresolved.
  for (const t of tasks) {
    if (!processed.has(t.task_id)) resolved.set(t.task_id, { due: null, duration: null });
  }

  const result = new Map<TaskId, IsoDate | null>();
  for (const t of tasks) {
    if (isIsolated(t)) continue;
    result.set(t.task_id, resolved.get(t.task_id)?.due ?? null);
  }
  return result;
}
