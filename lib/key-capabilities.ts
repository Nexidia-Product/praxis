/**
 * Key Capabilities dashboard helpers — per-project task rollups and the
 * quarter math the dashboard groups by. Kept framework-free (no React,
 * no DB) so both the server page and any test can call them.
 */

import type { StatusHistoryEntry, Task, TaskStatus } from "@/lib/db";

/** Task statuses that take a task out of the "open work" denominator. */
const TERMINAL_TASK_STATUSES: TaskStatus[] = ["Complete", "Canceled"];

export interface ProjectTaskStats {
  /**
   * Completion denominator: every task on the project EXCEPT those in
   * the "Canceled" status. Canceled work is dropped from the project's
   * scope, so counting it would deflate the percent-complete reading.
   */
  total: number;
  /** Tasks in the "Complete" status. */
  completed: number;
  /** Non-terminal tasks (still real work). */
  open: number;
  /** Non-terminal tasks whose target date is before today. */
  pastDue: number;
  /** Non-terminal tasks flagged blocked or in the Blocked status. */
  blocked: number;
  /** completed / total, 0–100, rounded. 0 when the project has no tasks. */
  pctComplete: number;
}

/**
 * Roll a project's tasks into the headline numbers the dashboard card
 * shows. `todayIso` is the YYYY-MM-DD the caller treats as "today" (the
 * page passes the app's UTC today so past-due is computed consistently).
 */
export function computeProjectTaskStats(
  tasks: Task[],
  todayIso: string,
): ProjectTaskStats {
  let completed = 0;
  let canceled = 0;
  let open = 0;
  let pastDue = 0;
  let blocked = 0;

  for (const t of tasks) {
    const terminal = TERMINAL_TASK_STATUSES.includes(t.status);
    if (t.status === "Complete") completed += 1;
    if (t.status === "Canceled") canceled += 1;
    if (!terminal) {
      open += 1;
      if (t.blocked || t.status === "Blocked") blocked += 1;
      if (t.target_date && t.target_date < todayIso) pastDue += 1;
    }
  }

  // Exclude Canceled tasks from the denominator — they're out of scope,
  // not outstanding work, so they shouldn't drag the percentage down.
  const total = tasks.length - canceled;
  const pctComplete = total === 0 ? 0 : Math.round((completed / total) * 100);
  return { total, completed, open, pastDue, blocked, pctComplete };
}

/**
 * The most recent free-text status note for a project, or "" when no
 * status-history entry carries one. History is stored oldest-first
 * (entries are appended), so we scan from the newest end and return the
 * first entry with a non-empty `summary`.
 */
export function latestStatusSummary(history: StatusHistoryEntry[]): string {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const note = history[i].summary?.trim();
    if (note) return note;
  }
  return "";
}

// ---------------------------------------------------------------------------
// Quarter helpers — quarters are strings like "2026-Q3". Fixed-width year
// and a single-digit quarter mean plain string compare sorts correctly.
// ---------------------------------------------------------------------------

const QUARTER_RE = /^(\d{4})-Q([1-4])$/;

/** The calendar quarter a date falls in, e.g. "2026-Q3" (UTC). */
export function quarterOf(date: Date): string {
  const y = date.getUTCFullYear();
  const q = Math.floor(date.getUTCMonth() / 3) + 1;
  return `${y}-Q${q}`;
}

/** A run of `count` consecutive quarters starting at `start` (inclusive). */
export function nextQuarters(start: string, count: number): string[] {
  const m = QUARTER_RE.exec(start);
  if (!m) return [];
  let year = Number(m[1]);
  let q = Number(m[2]);
  const out: string[] = [];
  for (let i = 0; i < count; i += 1) {
    out.push(`${year}-Q${q}`);
    q += 1;
    if (q > 4) {
      q = 1;
      year += 1;
    }
  }
  return out;
}

/** "2026-Q3" → "Q3 2026" for display. Falls back to the raw value. */
export function formatQuarter(quarter: string): string {
  const m = QUARTER_RE.exec(quarter);
  if (!m) return quarter;
  return `Q${m[2]} ${m[1]}`;
}

export function isValidQuarter(quarter: string): boolean {
  return QUARTER_RE.test(quarter);
}
