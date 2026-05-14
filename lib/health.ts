/**
 * Project Health Score (Section 5.13, Section 9 Step 8).
 *
 * The health score is a Red / Yellow / Green badge that turns "In Progress"
 * into something more truthful — a project can be In Progress and *not*
 * actually on track. The score is auto-calculated from the project's task
 * roster, target date, recent activity, and upstream dependency health.
 * It is **derived** state — never typed in by a user — and lives on the
 * project record so the projects table doesn't recompute it on every render.
 *
 * Three public surfaces:
 *
 *   1. `calculateHealthScore(projectId)` — the pure scoring function.
 *      Returns the score plus the contributing factors so the UI (and the
 *      smoke test) can show *why* a project is Red, not just *that* it is.
 *      No side effects.
 *
 *   2. `recalculateAndPersist(projectId)` — runs the calculator, writes
 *      the new score to the project record, appends a snapshot to
 *      `health_score_history` (capped at 30 entries per Section 4.1),
 *      and fires a `HealthScoreChanged` notification on degradation.
 *      This is what every service-layer hook calls.
 *
 *   3. `recalculateAllHealthScores()` — sweeps every project. Wired into
 *      the daily scheduler via `registerHealthRecalcHook`; also exposed
 *      so an Admin can trigger a sweep from a script.
 *
 * Scoring rules (Section 5.13, with thresholds read from `settings.json`):
 *
 *   Red    if any of:
 *          - blocked-or-overdue task percentage >= `red_blocked_or_overdue_pct`
 *          - target_date has passed and project is not Completed
 *          - project status is Blocked
 *          - any upstream dependency rolls up to Red (i.e. is `blocked`)
 *
 *   Yellow if any of (and not Red):
 *          - blocked-or-overdue task percentage >= `yellow_blocked_or_overdue_pct`
 *          - project's target_date is within `yellow_target_date_proximity_days`
 *            AND open-task percentage >= `yellow_open_tasks_pct`
 *          - >= `yellow_due_soon_tasks_pct` of tasks have their own
 *            target_date within `yellow_target_date_proximity_days`
 *          - last task activity was >= `yellow_inactivity_days` ago
 *          - any upstream dependency rolls up to Yellow (i.e. `at-risk`)
 *
 *   Green  otherwise.
 *
 * **Completed and Canceled projects are scored Green.** A finished project
 * doesn't have a meaningful health signal — surfacing Red on a closed
 * project would be alert fatigue, not insight. The badge still renders so
 * the UI layout stays consistent across all rows.
 *
 * History capping (Section 4.1, Section 5.13):
 *   `health_score_history` is a rolling 30-entry array. We append at most
 *   one snapshot per day per project. If today's date already has an
 *   entry, that entry's score is overwritten — multiple recalculations
 *   on the same day collapse into the most recent one rather than
 *   spamming the sparkline.
 *
 * Why a separate file from `lib/projects/service.ts`:
 *
 *   - The project service writes projects; the health module *reads*
 *     them and writes a derived field back. Splitting the concerns
 *     keeps the project service from having to know about task
 *     statistics, which it otherwise wouldn't.
 *   - The notification scheduler imports this module via the
 *     `registerHealthRecalcHook` indirection — keeping it free of
 *     React or Next.js imports means the daily-sweep import graph
 *     stays small.
 *   - Future analytics (Step 9 velocity dashboard) will reuse the
 *     scoring breakdown for trend reporting.
 */

import {
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  type HealthScore,
  type HealthScoreSnapshot,
  type HealthScoreThresholds,
  type Project,
  type ProjectId,
  type Task,
} from "@/lib/db";
import { rollupDependencyHealth } from "@/lib/projects/dependencies";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * The set of contributing factors the calculator considered. Surfaced so
 * the UI (and the smoke test) can show *why* a score came out the way it
 * did. Every flag is independent — multiple can be true on the same project.
 *
 * The flags here are the *raw measurements*, not threshold-derived states.
 * They're combined with the configured thresholds inside `score(...)` to
 * produce the actual Red / Yellow / Green result.
 */
export interface HealthFactors {
  /** Total non-Canceled tasks on the project. */
  total_tasks: number;
  /** Tasks that are blocked OR have a past target_date and aren't Complete. */
  blocked_or_overdue_tasks: number;
  /** Open / In Progress / Blocked tasks (i.e. not Complete or Canceled). */
  open_tasks: number;
  /** Days remaining until target_date (negative = overdue, null = no date). */
  days_to_target: number | null;
  /** Days since the most recent task `updated_at` (null = no tasks). */
  days_since_last_activity: number | null;
  /**
   * Days-to-target for each *open* task that has a target_date set.
   * Negative entries mean past-due (already counted via
   * `blocked_or_overdue_tasks`); zero or positive means upcoming. The
   * Yellow "due-soon tasks" trigger (HLTH-02) consults this list and
   * counts entries falling within
   * `yellow_target_date_proximity_days`. Stored as an array (rather than
   * a precomputed count) so the threshold window can change without
   * having to re-extract factors.
   */
  open_task_days_to_target: number[];
  /** Did the project's own status flag it Blocked? */
  status_blocked: boolean;
  /** Has the target date passed without the project being Completed? */
  target_date_passed: boolean;
  /** Worst upstream dependency health (null = no dependencies). */
  upstream_health: "clear" | "at-risk" | "blocked" | null;
  /** Project's status — surfaced for the early-out on Completed/Canceled. */
  project_status: Project["status"];
}

export interface HealthResult {
  score: HealthScore;
  factors: HealthFactors;
  /** Human-readable phrases explaining *why* the score came out as it did. */
  reasons: string[];
}

// ---------------------------------------------------------------------------
// Date arithmetic (UTC, matches the rest of the app)
// ---------------------------------------------------------------------------

function todayUtcDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

/**
 * Days from `from` to `to`. Both must be `YYYY-MM-DD`. Negative when
 * `to` is before `from`. Returns null if either argument is null/empty.
 */
function daysBetween(from: string, to: string | null): number | null {
  if (!to) return null;
  const a = Date.parse(`${from}T00:00:00Z`);
  const b = Date.parse(`${to.slice(0, 10)}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.round((b - a) / 86_400_000);
}

/**
 * Days from an ISO timestamp (e.g. `task.updated_at`) up until `today`.
 * Always >= 0 — we floor at zero for stamps that are slightly in the
 * future due to clock skew between writers.
 */
function daysSinceTimestamp(iso: string, today: string): number {
  const a = Date.parse(`${today}T00:00:00Z`);
  const b = Date.parse(iso);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  const days = Math.floor((a - b) / 86_400_000);
  return Math.max(0, days);
}

// ---------------------------------------------------------------------------
// Factor extraction (pure)
// ---------------------------------------------------------------------------

/**
 * The set of task statuses we count toward "open" — anything that isn't
 * Complete or Canceled is, in some sense, still pending. Blocked counts as
 * open: a blocked task is still a task to be done, just one that can't
 * advance right now.
 */
function isTaskOpen(task: Task): boolean {
  return task.status !== "Complete" && task.status !== "Canceled";
}

/**
 * "Blocked or overdue" — the headline metric that drives both Yellow and
 * Red thresholds. Canceled tasks are excluded entirely (they don't count
 * either way); Complete tasks are excluded from the numerator (they're
 * done, regardless of whether their target date passed) but counted in
 * the denominator since they were real work.
 */
function isTaskBlockedOrOverdue(task: Task, today: string): boolean {
  if (task.status === "Canceled") return false;
  if (task.status === "Complete") return false;
  if (task.blocked) return true;
  if (task.status === "Blocked") return true;
  if (task.target_date && task.target_date < today) return true;
  return false;
}

/**
 * Compute the raw factors for a project. Pure — given the same inputs,
 * always produces the same output. Used by `calculateHealthScore` and
 * exposed for the smoke test.
 */
export function extractFactors(
  project: Project,
  tasks: Task[],
  upstreamHealth: HealthFactors["upstream_health"],
  today: string = todayUtcDateOnly(),
): HealthFactors {
  // Filter out Canceled tasks from the universe entirely — they shouldn't
  // pull a project's denominator down or up. A project with 5 tasks where
  // 4 were canceled and 1 is blocked should NOT read as 100% blocked; the
  // canceled tasks are background, not signal.
  const liveTasks = tasks.filter((t) => t.status !== "Canceled");
  const total_tasks = liveTasks.length;
  const open_tasks = liveTasks.filter(isTaskOpen).length;
  const blocked_or_overdue_tasks = liveTasks.filter((t) =>
    isTaskBlockedOrOverdue(t, today),
  ).length;

  // Most-recent task activity timestamp across the project. Used as the
  // "is anyone working on this" signal. Falls back to null if the project
  // has no tasks at all — that's a different kind of "no activity" and is
  // intentionally reported separately so the scorer can decide what to do.
  let lastActivityIso: string | null = null;
  for (const t of tasks) {
    if (lastActivityIso === null || t.updated_at > lastActivityIso) {
      lastActivityIso = t.updated_at;
    }
  }
  const days_since_last_activity =
    lastActivityIso === null ? null : daysSinceTimestamp(lastActivityIso, today);

  // Days-to-target for each open task with a target_date set. The Yellow
  // "due-soon tasks" trigger (HLTH-02) reads this list and counts how
  // many fall within the configured proximity window.
  const open_task_days_to_target: number[] = [];
  for (const t of liveTasks) {
    if (!isTaskOpen(t)) continue;
    if (!t.target_date) continue;
    const days = daysBetween(today, t.target_date);
    if (days !== null) open_task_days_to_target.push(days);
  }

  const days_to_target = daysBetween(today, project.target_date);
  const target_date_passed =
    days_to_target !== null &&
    days_to_target < 0 &&
    project.status !== "Completed" &&
    project.status !== "Canceled";

  return {
    total_tasks,
    blocked_or_overdue_tasks,
    open_tasks,
    days_to_target,
    days_since_last_activity,
    open_task_days_to_target,
    status_blocked: project.status === "Blocked",
    target_date_passed,
    upstream_health: upstreamHealth,
    project_status: project.status,
  };
}

// ---------------------------------------------------------------------------
// Threshold application (pure)
// ---------------------------------------------------------------------------

/**
 * Apply the configured thresholds to a `HealthFactors` set. Pure — the
 * caller passes in both the factors and the thresholds, this function
 * picks Red / Yellow / Green and explains why.
 *
 * Order of evaluation mirrors the design doc (Section 5.13): all Red
 * conditions are checked first; if none fire, all Yellow conditions are
 * checked; otherwise Green. We stop at the first matching reason in each
 * tier because once a project is Red there's no value in cataloguing
 * additional Red reasons — the operator has the worst case already.
 */
export function score(
  factors: HealthFactors,
  thresholds: HealthScoreThresholds,
): HealthResult {
  // Closed projects don't have a meaningful health — render Green with
  // a stable "completed" reason. Sparkline still works because the prior
  // history is preserved on the project record; it just stops moving.
  if (
    factors.project_status === "Completed" ||
    factors.project_status === "Canceled"
  ) {
    return {
      score: "Green",
      factors,
      reasons: [
        factors.project_status === "Completed"
          ? "Project is Completed."
          : "Project is Canceled.",
      ],
    };
  }

  const blockedPct =
    factors.total_tasks === 0
      ? 0
      : (factors.blocked_or_overdue_tasks / factors.total_tasks) * 100;
  const openPct =
    factors.total_tasks === 0
      ? 0
      : (factors.open_tasks / factors.total_tasks) * 100;

  // -----------------------------------------------------------------------
  // Red checks — any one trips the score.
  // -----------------------------------------------------------------------
  const redReasons: string[] = [];

  if (factors.status_blocked) {
    redReasons.push("Project status is Blocked.");
  }
  if (factors.target_date_passed) {
    redReasons.push(
      `Target date passed ${Math.abs(factors.days_to_target ?? 0)} day(s) ago without completion.`,
    );
  }
  if (
    factors.total_tasks > 0 &&
    blockedPct >= thresholds.red_blocked_or_overdue_pct
  ) {
    redReasons.push(
      `${Math.round(blockedPct)}% of tasks are blocked or overdue (≥ ${thresholds.red_blocked_or_overdue_pct}%).`,
    );
  }
  if (factors.upstream_health === "blocked") {
    redReasons.push("An upstream dependency is blocked.");
  }
  if (redReasons.length > 0) {
    return { score: "Red", factors, reasons: redReasons };
  }

  // -----------------------------------------------------------------------
  // Yellow checks — any one trips the score (after Red is ruled out).
  // -----------------------------------------------------------------------
  const yellowReasons: string[] = [];

  if (
    factors.total_tasks > 0 &&
    blockedPct >= thresholds.yellow_blocked_or_overdue_pct
  ) {
    yellowReasons.push(
      `${Math.round(blockedPct)}% of tasks are blocked or overdue (≥ ${thresholds.yellow_blocked_or_overdue_pct}%).`,
    );
  }
  if (
    factors.days_to_target !== null &&
    factors.days_to_target >= 0 &&
    factors.days_to_target <= thresholds.yellow_target_date_proximity_days &&
    openPct >= thresholds.yellow_open_tasks_pct
  ) {
    yellowReasons.push(
      `Target date is ${factors.days_to_target} day(s) away with ${Math.round(openPct)}% of tasks still open.`,
    );
  }
  // Yellow trigger for open *tasks* with nearby target_dates (HLTH-02).
  // Distinct from the project-target check above: a project with no
  // target date can still go Yellow if a meaningful share of its open
  // tasks are due within the proximity window. Counts only tasks whose
  // own target_date is on/after today AND within the window — past-due
  // tasks are already pulled in by the blocked-or-overdue check.
  if (factors.total_tasks > 0) {
    const dueSoon = factors.open_task_days_to_target.filter(
      (d) => d >= 0 && d <= thresholds.yellow_target_date_proximity_days,
    ).length;
    const dueSoonPct = (dueSoon / factors.total_tasks) * 100;
    if (
      dueSoon > 0 &&
      dueSoonPct >= thresholds.yellow_due_soon_tasks_pct
    ) {
      yellowReasons.push(
        `${Math.round(dueSoonPct)}% of tasks are due within ${thresholds.yellow_target_date_proximity_days} day(s) (≥ ${thresholds.yellow_due_soon_tasks_pct}%).`,
      );
    }
  }
  // Inactivity check: only counts as a Yellow trigger when the project has
  // tasks at all. A brand-new project with no tasks yet shouldn't read
  // Yellow just because nothing has been touched — there's nothing to touch.
  if (
    factors.days_since_last_activity !== null &&
    factors.days_since_last_activity >= thresholds.yellow_inactivity_days
  ) {
    yellowReasons.push(
      `No task activity in ${factors.days_since_last_activity} day(s).`,
    );
  }
  if (factors.upstream_health === "at-risk") {
    yellowReasons.push("An upstream dependency is at risk.");
  }
  if (yellowReasons.length > 0) {
    return { score: "Yellow", factors, reasons: yellowReasons };
  }

  return {
    score: "Green",
    factors,
    reasons: ["On track."],
  };
}

// ---------------------------------------------------------------------------
// Public scoring API
// ---------------------------------------------------------------------------

/**
 * Compute the health score for one project from the live JSON store.
 * Reads tasks for the project and any upstream dependencies; does NOT
 * write anywhere. Returns null if the project doesn't exist.
 *
 * Pure with respect to the data it reads — passing the same project
 * record + task list + thresholds always produces the same output.
 */
export async function calculateHealthScore(
  projectId: ProjectId,
): Promise<HealthResult | null> {
  const [project, allProjects, tasks, settings] = await Promise.all([
    ProjectRepository.getById(projectId),
    ProjectRepository.getAll(),
    TaskRepository.getByProjectId(projectId),
    SettingsRepository.get(),
  ]);
  if (!project) return null;

  const byId = new Map(allProjects.map((p) => [p.project_id, p]));
  // The dependency rollup helper assumes `project.dependencies` is an
  // array. Hand-edited JSON files or records imported before Step 6
  // landed may not have the field at all — defaulting to an empty array
  // keeps the calculator working for those records without forcing a
  // migration. The same applies to `depends_on` (read by
  // `recalculateDownstreams`).
  const safeProject: Project = {
    ...project,
    dependencies: project.dependencies ?? [],
    depends_on: project.depends_on ?? [],
    health_score_history: project.health_score_history ?? [],
  };
  const upstreamHealth = rollupDependencyHealth(safeProject, byId);

  const factors = extractFactors(safeProject, tasks, upstreamHealth);
  return score(factors, settings.health_score_thresholds);
}

// ---------------------------------------------------------------------------
// History capping
// ---------------------------------------------------------------------------

/** Maximum entries kept in `health_score_history` (Section 4.1). */
export const HEALTH_HISTORY_MAX_ENTRIES = 30;

/**
 * Append today's score to the history array, collapsing same-day entries
 * and trimming to the rolling 30-entry cap. Pure — no I/O. Returns a new
 * array; the input is not mutated.
 *
 * Same-day collapse policy: if the most recent entry is already from
 * today, replace it. This means a recalc burst (e.g. 5 task updates in
 * a row) leaves one entry per day rather than five — the sparkline shows
 * one data point per calendar day, which is what a 30-day trend wants.
 */
export function appendHistory(
  existing: HealthScoreSnapshot[],
  newScore: HealthScore,
  today: string = todayUtcDateOnly(),
): HealthScoreSnapshot[] {
  const result = [...existing];
  const last = result[result.length - 1];
  if (last && last.date === today) {
    result[result.length - 1] = { date: today, score: newScore };
  } else {
    result.push({ date: today, score: newScore });
  }
  // Trim the front so the array stays bounded. Slice rather than splice
  // so the input array isn't mutated.
  if (result.length > HEALTH_HISTORY_MAX_ENTRIES) {
    return result.slice(result.length - HEALTH_HISTORY_MAX_ENTRIES);
  }
  return result;
}

// ---------------------------------------------------------------------------
// Persist (the workhorse called from service hooks)
// ---------------------------------------------------------------------------

export interface RecalculateResult {
  project_id: ProjectId;
  prior_score: HealthScore | null;
  new_score: HealthScore;
  changed: boolean;
  reasons: string[];
}

/**
 * Recalculate one project's health score, persist it, append a history
 * snapshot, and fire the `HealthScoreChanged` notification when the score
 * has degraded. Returns the change summary.
 *
 * Idempotent at the data level: if the score is unchanged, the project's
 * `health_score` field is still rewritten (no-op patch) but the history
 * entry collapses on same-day, so we don't grow the array. Choosing to
 * call `update` regardless rather than skipping makes the persisted
 * record's `updated_at` move on every recalc, which is convenient when
 * debugging "did the daily sweep actually run".
 *
 * Errors in the notification dispatch are caught here so a missing user
 * or an offline mailer can't roll back the health-score write — this
 * function is invoked from service hooks that themselves can't tolerate
 * notification failures.
 */
export async function recalculateAndPersist(
  projectId: ProjectId,
): Promise<RecalculateResult | null> {
  const result = await calculateHealthScore(projectId);
  if (!result) return null;

  const project = await ProjectRepository.getById(projectId);
  if (!project) return null;

  const prior = project.health_score;
  const next = result.score;
  const today = todayUtcDateOnly();

  const newHistory = appendHistory(
    project.health_score_history ?? [],
    next,
    today,
  );

  await ProjectRepository.update(projectId, {
    health_score: next,
    health_score_history: newHistory,
  });

  // Notification on degradation only (Section 5.12: "Health Score Degraded").
  // We re-read the project after the write so the notification message
  // includes the up-to-date project name even if it changed in the same
  // call site. Failure path follows the existing service-hook contract:
  // log and swallow.
  try {
    if (prior !== next) {
      const updated = await ProjectRepository.getById(projectId);
      if (updated) {
        const { notifyHealthScoreDegraded } = await import(
          "@/lib/notifications/service"
        );
        await notifyHealthScoreDegraded({
          project: updated,
          priorScore: prior,
          newScore: next,
        });
      }
    }
  } catch (err) {
    console.warn(
      `[health] post-recalc notification failed for ${projectId}:`,
      err,
    );
  }

  return {
    project_id: projectId,
    prior_score: prior,
    new_score: next,
    changed: prior !== next,
    reasons: result.reasons,
  };
}

/**
 * Recalculate health scores for every project. Used by the daily sweep and
 * exposed for ad-hoc admin invocation. Returns the count of projects whose
 * score actually changed (the daily-sweep summary uses this count as the
 * `health_recalc_attempted` field).
 *
 * Sequential awaits — NOT Promise.all — because each `recalculateAndPersist`
 * does a read-modify-write on `projects.json`, and parallel writes would
 * collide on the file mutex chain. At team scale (low hundreds of projects)
 * the wall-clock cost is acceptable; at thousands, the database swap
 * (Phase 2) is the right answer rather than parallelizing here.
 *
 * Returns the *number of projects whose score changed*, not the number
 * recalculated, since the latter is just `projects.length`.
 */
export async function recalculateAllHealthScores(): Promise<number> {
  const projects = await ProjectRepository.getAll();
  let changed = 0;
  for (const p of projects) {
    try {
      const result = await recalculateAndPersist(p.project_id);
      if (result?.changed) changed++;
    } catch (err) {
      // One project's failure must not abort the sweep — the rest of the
      // portfolio still needs to be recalculated.
      console.warn(
        `[health] recalc failed for ${p.project_id}:`,
        err,
      );
    }
  }
  return changed;
}

// ---------------------------------------------------------------------------
// Cascade — when an upstream's score changes, downstreams may need a recalc
// ---------------------------------------------------------------------------

/**
 * Recalculate every project that depends on the given upstream. Used by
 * the project service when an upstream project's status changes — a
 * downstream's health depends on `rollupDependencyHealth`, which depends
 * on the upstream's status, so a status flip on the upstream silently
 * propagates to downstream health unless we explicitly recompute.
 *
 * The upstream itself is NOT recalculated here — the caller should do that
 * separately if the upstream's status was the field that changed. Keeping
 * those two concerns split avoids re-entrancy: a downstream recalc that
 * happened to recurse into its upstream would create a loop.
 */
export async function recalculateDownstreams(
  upstreamId: ProjectId,
): Promise<number> {
  const all = await ProjectRepository.getAll();
  const downstreams = all.filter((p) => p.depends_on.includes(upstreamId));
  let touched = 0;
  for (const d of downstreams) {
    try {
      await recalculateAndPersist(d.project_id);
      touched++;
    } catch (err) {
      console.warn(
        `[health] downstream recalc failed for ${d.project_id}:`,
        err,
      );
    }
  }
  return touched;
}
