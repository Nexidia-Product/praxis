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
 *     project-start relationship to an unconnected, purely-manual task.
 *   - A task with no `estimate_hours`, or whose required start can't be
 *     resolved (no project start date, or an unresolved/cyclic upstream
 *     predecessor), maps to `null`. Callers must never write `null` over
 *     an existing `target_date` — the absence of a computed value means
 *     "can't say," not "clear it."
 */

import { addBusinessDays, subtractBusinessDays } from "@/lib/projects/milestones";
import type { IsoDate, TaskDependency, TaskId } from "@/lib/db";

export const HOURS_PER_BUSINESS_DAY = 8;

/** At least 1 business day, even for a sub-day estimate. */
export function durationBusinessDays(hours: number): number {
  return Math.max(1, Math.ceil(hours / HOURS_PER_BUSINESS_DAY));
}

export interface SchedulableTask {
  task_id: TaskId;
  estimate_hours: number | null;
  dependencies: TaskDependency[];
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
): Map<TaskId, IsoDate | null> {
  const byId = new Map(tasks.map((t) => [t.task_id, t] as const));

  // In-scope dependency edges only (predecessor must be in this task set).
  const inScopeDeps = new Map<TaskId, TaskDependency[]>();
  const hasSuccessor = new Set<TaskId>();
  for (const t of tasks) {
    const deps = t.dependencies.filter((d) => byId.has(d.predecessor_task_id));
    inScopeDeps.set(t.task_id, deps);
    for (const d of deps) hasSuccessor.add(d.predecessor_task_id);
  }

  const isIsolated = (t: SchedulableTask) =>
    t.dependencies.length === 0 && !hasSuccessor.has(t.task_id);

  // Kahn's algorithm, ordered by in-scope predecessor count.
  const inDegree = new Map<TaskId, number>();
  const successorsOf = new Map<TaskId, TaskId[]>();
  for (const t of tasks) {
    inDegree.set(t.task_id, inScopeDeps.get(t.task_id)!.length);
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

    let due: IsoDate | null = null;
    if (duration != null) {
      if (deps.length === 0) {
        if (projectStart) due = addBusinessDays(projectStart, duration - 1);
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
