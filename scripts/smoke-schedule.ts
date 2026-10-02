/**
 * Functional smoke test for the estimate-driven task scheduler
 * (`lib/tasks/schedule.ts`). Pure function, no Supabase/DB dependency —
 * unlike the other smoke scripts, this one needs no environment setup
 * and always runs.
 *
 * Run with:
 *   npx tsx scripts/smoke-schedule.ts
 */

import { scheduleTaskDates, durationBusinessDays } from "../lib/tasks/schedule";
import type { TaskDependency, TaskId } from "../lib/db";

let passed = 0;
function check(label: string, cond: unknown): void {
  if (!cond) {
    console.error(`FAIL: ${label}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`  ok  ${label}`);
}

function dep(predecessor_task_id: TaskId, type: TaskDependency["type"]): TaskDependency {
  return { predecessor_task_id, type };
}

console.log("durationBusinessDays");
{
  check("0 hours -> at least 1 day", durationBusinessDays(0) === 1);
  check("1 hour -> 1 day", durationBusinessDays(1) === 1);
  check("8 hours -> 1 day", durationBusinessDays(8) === 1);
  check("9 hours -> 2 days (rounds up)", durationBusinessDays(9) === 2);
  check("16 hours -> 2 days", durationBusinessDays(16) === 2);
}

console.log("\nscheduleTaskDates");
{
  // Simple FS chain: A (1 day) -> B (2 days) -> C (1 day), start Mon 2026-03-02.
  const chain = scheduleTaskDates("2026-03-02", [
    { task_id: "A", estimate_hours: 8, dependencies: [] },
    { task_id: "B", estimate_hours: 16, dependencies: [dep("A", "FS")] },
    { task_id: "C", estimate_hours: 8, dependencies: [dep("B", "FS")] },
  ]);
  check("FS chain: A due = start (1-day task)", chain.get("A") === "2026-03-02");
  // B starts the business day after A finishes (Tue 03-03), 2-day duration -> due Wed 03-04.
  check("FS chain: B due = A+1 then +2d duration", chain.get("B") === "2026-03-04");
  // C starts the business day after B finishes (Thu 03-05), 1-day duration -> due Thu 03-05.
  check("FS chain: C due = B+1", chain.get("C") === "2026-03-05");

  // SS pairing: same-day tasks share a start when both have 1-day duration.
  const ss = scheduleTaskDates("2026-03-02", [
    { task_id: "A", estimate_hours: 8, dependencies: [] },
    { task_id: "B", estimate_hours: 8, dependencies: [dep("A", "SS")] },
  ]);
  check("SS same-day pairing", ss.get("A") === ss.get("B"));

  // Multi-predecessor: successor's start is the LATEST (most-binding) candidate.
  const multi = scheduleTaskDates("2026-03-02", [
    { task_id: "A", estimate_hours: 8, dependencies: [] }, // due 03-02 (Mon)
    { task_id: "B", estimate_hours: 40, dependencies: [] }, // 5 days, due 03-06 (Fri)
    {
      task_id: "C",
      estimate_hours: 8,
      dependencies: [dep("A", "FS"), dep("B", "FS")],
    },
  ]);
  // C must wait for the later of the two FS predecessors (B, due Fri 03-06) -> starts Mon 03-09.
  check("multi-predecessor: takes the later (most-binding) start", multi.get("C") === "2026-03-09");

  // Cyclic tasks are excluded (left unresolved), not infinite-looped.
  const cyclic = scheduleTaskDates("2026-03-02", [
    { task_id: "A", estimate_hours: 8, dependencies: [dep("B", "FS")] },
    { task_id: "B", estimate_hours: 8, dependencies: [dep("A", "FS")] },
  ]);
  check("cyclic pair: A unresolved", cyclic.get("A") == null);
  check("cyclic pair: B unresolved", cyclic.get("B") == null);

  // Isolated task (no predecessors, no successors) is excluded from the
  // result map entirely, even with a project start date available.
  const isolated = scheduleTaskDates("2026-03-02", [
    { task_id: "A", estimate_hours: 8, dependencies: [] },
  ]);
  check("isolated root task excluded from result", !isolated.has("A"));

  // No project start date -> a chain with no resolvable anchor stays null,
  // but a root WITH a successor is still present in the map (just null).
  const noStart = scheduleTaskDates(null, [
    { task_id: "A", estimate_hours: 8, dependencies: [] },
    { task_id: "B", estimate_hours: 8, dependencies: [dep("A", "FS")] },
  ]);
  check("no project start: root-with-successor present but null", noStart.has("A") && noStart.get("A") == null);
  check("no project start: downstream also null", noStart.get("B") == null);

  // A missing estimate makes a task (and anything chained after it)
  // unresolvable, even with a start date.
  const noEstimate = scheduleTaskDates("2026-03-02", [
    { task_id: "A", estimate_hours: null, dependencies: [] },
    { task_id: "B", estimate_hours: 8, dependencies: [dep("A", "FS")] },
  ]);
  check("missing estimate: task itself unresolved", noEstimate.get("A") == null);
  check("missing estimate: downstream also unresolved", noEstimate.get("B") == null);

  // Cross-project predecessor (not in the provided set) is non-constraining
  // — the successor behaves as if it had no dependency on that edge.
  const crossProject = scheduleTaskDates("2026-03-02", [
    {
      task_id: "A",
      estimate_hours: 8,
      dependencies: [dep("not-in-set" as TaskId, "FS")],
    },
  ]);
  check("out-of-scope predecessor is non-constraining", crossProject.get("A") === "2026-03-02");
}

console.log(`\n${passed} checks passed.`);
