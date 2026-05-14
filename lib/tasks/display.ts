/**
 * Display metadata for task enums (Section 4.2, 5.2, 5.3).
 *
 * Mirrors `lib/projects/display.ts`: centralizes enum lists + Tailwind badge
 * classes so the table, filter bar, and form share one source of truth.
 *
 * `taskUrgency` classifies a task into a row-color bucket per Section 5.2:
 *
 *   blocked     — task.blocked === true OR status === "Blocked"
 *   past-due    — target_date < today AND status is open
 *   due-soon    — target_date within 7 days AND status is open
 *   on-track    — open task with target_date further out (or none)
 *   none        — closed (Complete or Canceled)
 *
 * Closed tasks intentionally get no urgency styling — they're done; coloring
 * them red because their target date passed would be misleading noise.
 */

import type { Priority, Task, TaskStatus } from "@/lib/db";

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

export const TASK_STATUSES: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Delayed",
  "On Hold",
  "Complete",
  "Canceled",
];

/** Statuses that count as "open" in the default Tasks-page view. */
export const OPEN_TASK_STATUSES: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Blocked",
];

export function isOpenStatus(s: TaskStatus): boolean {
  return s === "Not Started" || s === "In Progress" || s === "Blocked";
}

/**
 * Statuses that count as "closed" — work is done or won't be done.
 * Distinct from `isOpenStatus`: a task with status "On Hold" or
 * "Delayed" is neither in the default open-tasks filter (it's not
 * actively being worked) nor closed (work is still expected). This
 * helper draws the closed/not-closed line cleanly so KPIs and dashboards
 * can count "anything still on the table" without inheriting the more
 * restrictive open-tasks-page semantics.
 */
export function isClosedStatus(s: TaskStatus): boolean {
  return s === "Complete" || s === "Canceled";
}

/** Inverse of `isClosedStatus` — work that's still on the table. */
export function isActiveStatus(s: TaskStatus): boolean {
  return !isClosedStatus(s);
}

/**
 * Whether `task` is assigned to the user identified by `userId` and
 * `userName`. The legacy spreadsheet seed stores `responsible` as a
 * free-form name like `"Savannah"`; new tasks created through the UI
 * store the user_id. We have to match both so KPIs and the My Tasks
 * page agree on what counts as "mine" (HOME-02). Same logic applies
 * to `additional_assignees`. As legacy tasks are edited and re-saved
 * with a real user_id, the name fallback gracefully ages out.
 */
export function isAssignedToUser(
  task: Task,
  userId: string,
  userName: string,
): boolean {
  if (task.responsible === userId) return true;
  if (userName && task.responsible === userName) return true;
  if (task.additional_assignees.includes(userId)) return true;
  if (userName && task.additional_assignees.includes(userName)) return true;
  return false;
}

export const TASK_STATUS_BADGE: Record<TaskStatus, string> = {
  // Match the project-page palette (Section 5.1) for visual consistency
  // — gray for "Not Started", emerald for "In Progress", red for
  // "Blocked", saturated emerald for "Complete", strikethrough gray
  // for "Canceled". "Delayed" uses orange (late but still active);
  // "On Hold" uses amber/yellow (paused but still active). Keeps users
  // from having to learn two color systems.
  "Not Started":
    "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
  "In Progress":
    "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  Blocked: "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200",
  Delayed:
    "bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-200",
  "On Hold":
    "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  Complete:
    "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-300",
  Canceled:
    "bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200 line-through",
};

// ---------------------------------------------------------------------------
// Priority — same enum as projects, re-exported so task code doesn't need
// to import from two places.
// ---------------------------------------------------------------------------

export const TASK_PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

export const TASK_PRIORITY_BADGE: Record<Priority, string> = {
  Critical: "bg-red-100 text-red-900 ring-1 ring-inset ring-red-200",
  High: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200",
  Medium: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  Low: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
};

// ---------------------------------------------------------------------------
// Urgency — Section 5.2 row coloring
// ---------------------------------------------------------------------------

export type TaskUrgency =
  | "blocked"
  | "past-due"
  | "due-soon"
  | "on-track"
  | "none";

/** Today as `YYYY-MM-DD` in the user's local time zone. */
export function todayLocal(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Classify a task into a row-color bucket. `today` is taken as a parameter
 * (rather than hardcoded to `todayLocal()`) so tables can compute it once
 * per render and pass it to every row, and so unit tests can pin a date.
 */
export function taskUrgency(task: Task, today: string): TaskUrgency {
  if (!isOpenStatus(task.status)) return "none";
  if (task.blocked || task.status === "Blocked") return "blocked";
  if (!task.target_date) return "on-track";
  if (task.target_date < today) return "past-due";

  // Compare calendar dates as strings — sufficient since both are YYYY-MM-DD
  // and we only need to know "within 7 days" precision.
  const t = Date.parse(`${today}T00:00:00`);
  const d = Date.parse(`${task.target_date}T00:00:00`);
  if (Number.isFinite(t) && Number.isFinite(d)) {
    const days = Math.round((d - t) / (1000 * 60 * 60 * 24));
    if (days <= 7) return "due-soon";
  }
  return "on-track";
}

/**
 * Tailwind background classes per urgency. Inline strings, not interpolated,
 * so the JIT compiler can see them and not purge the rules in production.
 *
 * "on-track" gets a faint emerald wash so the at-a-glance row scan reads
 * "this is the healthy default state" — without that tint, on-track and
 * "none" (closed tasks) look identical (TASK-02). The wash is intentionally
 * lighter than the alert states so the page doesn't read as a wall of color.
 */
export const URGENCY_ROW_CLASS: Record<TaskUrgency, string> = {
  blocked: "bg-red-50 hover:bg-red-100",
  "past-due": "bg-orange-50 hover:bg-orange-100",
  "due-soon": "bg-amber-50 hover:bg-amber-100",
  "on-track": "bg-emerald-50 hover:bg-emerald-100",
  none: "bg-white hover:bg-gray-50",
};

/**
 * Left-edge accent stripe color, applied as a `border-l-4` on the first
 * cell of each row to make the urgency state scannable from the page edge
 * without flooding the row with color.
 */
export const URGENCY_ACCENT_CLASS: Record<TaskUrgency, string> = {
  blocked: "border-l-4 border-red-500",
  "past-due": "border-l-4 border-orange-500",
  "due-soon": "border-l-4 border-amber-400",
  "on-track": "border-l-4 border-emerald-400",
  none: "border-l-4 border-gray-200",
};

export const URGENCY_LABEL: Record<TaskUrgency, string> = {
  blocked: "Blocked",
  "past-due": "Past due",
  "due-soon": "Due this week",
  "on-track": "On track",
  none: "—",
};

/** Sort weight for ordering rows by urgency (lower number first). */
export const URGENCY_SORT_RANK: Record<TaskUrgency, number> = {
  blocked: 0,
  "past-due": 1,
  "due-soon": 2,
  "on-track": 3,
  none: 4,
};
