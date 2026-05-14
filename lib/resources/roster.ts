/**
 * Resource insights analytics — workload + performance scoring,
 * roster construction, and gap detection.
 *
 * Used by:
 *   - /insights/resources                  (Overview tab + roster table)
 *   - /insights/resources/[user_id]        (per-resource detail page)
 *
 * All math is pure: pass in projects, tasks, users, and settings;
 * get back per-resource records. No I/O. The page-level loaders do
 * the I/O once and pass the result.
 *
 * Why a separate module from `lib/roadmap/capacity.ts`:
 *   - capacity.ts is the swim-lane Gantt math (date projection,
 *     fractional positioning, overlap detection)
 *   - this module is the *roster* math (workload, performance,
 *     bottleneck identification, scoping)
 *   They share data sources but answer different questions.
 */

import { isOpenStatus } from "@/lib/tasks/display";
import type {
  ComplexityScore,
  Priority,
  Project,
  ProjectStatus,
  PublicUser,
  ResourceSettings,
  Task,
  TaskStatus,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// Constants — kept tight; everything tunable lives in ResourceSettings
// ---------------------------------------------------------------------------

/** Active project statuses — same as `lib/roadmap/capacity.ts`. */
const ACTIVE_PROJECT_STATUSES: ReadonlySet<ProjectStatus> = new Set([
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
]);

/** Closed task statuses — used to filter performance population. */
const CLOSED_TASK_STATUSES: ReadonlySet<TaskStatus> = new Set([
  "Complete",
  "Canceled",
]);

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

export type WorkloadBucket = "Light" | "Balanced" | "Heavy" | "Overloaded";
export type PerformanceBucket = "Green" | "Yellow" | "Red" | "Insufficient";

/**
 * One row on the Overview tab, one detail page header. Every field
 * is precomputed so the UI is a pure render.
 */
export interface ResourceRosterRow {
  /**
   * The display name. For users, we resolve to `user.name`. For
   * free-text strings still in `additional_resources`, we use the
   * trimmed string verbatim. The UI flags free-text-only rows so
   * admins know which assignments to migrate.
   */
  resource: string;
  /** UserId when the resource matches a known user; null otherwise. */
  user_id: string | null;
  /**
   * True if this resource was found only as a free-text name in
   * `additional_resources` and never matched a user. Drives the
   * "migrate to a real user" warning surface.
   */
  free_text_only: boolean;

  // Capacity signals
  active_projects: Project[];
  open_tasks: Task[];
  past_due_tasks: Task[];
  blocked_tasks: Task[];
  /**
   * Tasks where this resource is the upstream `blocker_task_id` for
   * a different person's task — i.e. this person is the bottleneck.
   * Computed from the structured blocker classification added in the
   * tasks sweep.
   */
  bottleneck_tasks: Task[];

  // Workload — the composite score and its bucket
  workload_score: number;
  workload_bucket: WorkloadBucket;
  workload_breakdown: WorkloadBreakdown;

  // Performance — completed-task analytics over the configured window
  completed_tasks_in_window: number;
  on_time_rate: number | null;
  blocked_day_rate: number | null;
  performance_score: number | null;
  performance_bucket: PerformanceBucket;

  // Recency — drives the "last activity" column and detail-page hero
  last_activity_at: string | null;
}

/**
 * Per-factor contribution to the workload score. Surfaced in the
 * UI on hover so the score isn't a black box. Sum of all entries
 * equals `workload_score`.
 */
export interface WorkloadBreakdown {
  project_assignments: number;
  open_tasks: number;
  past_due_tasks: number;
  bottleneck_tasks: number;
}

// ---------------------------------------------------------------------------
// Resource resolution — strings → users (best-effort, deterministic)
// ---------------------------------------------------------------------------

/**
 * Index `users` by every key we might encounter on a project:
 * `user_id`, `name`, and `email`. Lookups are case-insensitive on
 * name and email; user IDs stay verbatim.
 *
 * Returns a function that resolves any string assignment to a user
 * (or null) so the same lookup can be reused across the roster
 * build without rebuilding the index per call.
 */
export function buildUserResolver(
  users: readonly PublicUser[],
): (raw: string) => PublicUser | null {
  const byId = new Map<string, PublicUser>();
  const byNameLower = new Map<string, PublicUser>();
  const byEmailLower = new Map<string, PublicUser>();
  for (const u of users) {
    byId.set(u.user_id, u);
    if (u.name) byNameLower.set(u.name.trim().toLowerCase(), u);
    if (u.email) byEmailLower.set(u.email.trim().toLowerCase(), u);
  }
  return (raw: string): PublicUser | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;
    const direct = byId.get(trimmed);
    if (direct) return direct;
    const lower = trimmed.toLowerCase();
    return byNameLower.get(lower) ?? byEmailLower.get(lower) ?? null;
  };
}

// ---------------------------------------------------------------------------
// Roster builder
// ---------------------------------------------------------------------------

/**
 * Build the per-resource roster: one row per distinct resource
 * mentioned across the project + task graphs.
 *
 * A resource is collected from:
 *   - project.project_lead
 *   - project.additional_resources[*]
 *   - task.responsible
 *   - task.additional_assignees[*]
 *
 * These are de-duplicated by display key (user_id when resolved,
 * trimmed lowercase name otherwise) so a person referenced as
 * "Jane Doe" in one project and as their UserId in another collapses
 * to a single row.
 */
export function buildResourceRoster(
  projects: readonly Project[],
  tasks: readonly Task[],
  users: readonly PublicUser[],
  settings: ResourceSettings,
  options: { now?: Date } = {},
): ResourceRosterRow[] {
  const now = options.now ?? new Date();
  const today = isoDate(now);
  const resolveUser = buildUserResolver(users);

  // Aggregate state per dedup-key. We accumulate the source records
  // first, then run the scoring pass once each key is final — this
  // keeps the scoring math readable and avoids re-computing
  // sub-totals as we walk inputs.
  interface Acc {
    display_name: string;
    user: PublicUser | null;
    seen_as_user: boolean;
    seen_as_free_text: boolean;
    active_projects: Set<Project>;
    open_tasks: Set<Task>;
    last_activity_at: string | null;
  }
  const accs = new Map<string, Acc>();

  function dedupKey(user: PublicUser | null, raw: string): string {
    if (user) return `user:${user.user_id}`;
    return `name:${raw.trim().toLowerCase()}`;
  }
  function ensureAcc(raw: string): Acc {
    const user = resolveUser(raw);
    const key = dedupKey(user, raw);
    let acc = accs.get(key);
    if (!acc) {
      acc = {
        display_name: user ? user.name : raw.trim(),
        user,
        seen_as_user: !!user,
        seen_as_free_text: !user,
        active_projects: new Set(),
        open_tasks: new Set(),
        last_activity_at: null,
      };
      accs.set(key, acc);
    } else {
      // A later mention as a user upgrades a prior free-text-only acc.
      if (user && !acc.user) {
        acc.user = user;
        acc.display_name = user.name;
      }
      if (user) acc.seen_as_user = true;
      else acc.seen_as_free_text = true;
    }
    return acc;
  }
  function noteActivity(acc: Acc, ts: string | null): void {
    if (!ts) return;
    if (!acc.last_activity_at || ts > acc.last_activity_at) {
      acc.last_activity_at = ts;
    }
  }

  // ---- Walk projects ----
  for (const p of projects) {
    if (!ACTIVE_PROJECT_STATUSES.has(p.status)) continue;
    if (p.project_lead) {
      const acc = ensureAcc(p.project_lead);
      acc.active_projects.add(p);
      noteActivity(acc, p.updated_at);
    }
    for (const r of p.additional_resources) {
      if (!r) continue;
      const acc = ensureAcc(r);
      acc.active_projects.add(p);
      noteActivity(acc, p.updated_at);
    }
  }

  // ---- Walk tasks ----
  // A closed task still counts toward "last activity" — recently
  // closing things is an activity signal — but doesn't count toward
  // open_tasks. We process every task; the open/closed split happens
  // when we read the set into the score.
  for (const t of tasks) {
    if (t.responsible) {
      const acc = ensureAcc(t.responsible);
      if (isOpenStatus(t.status)) acc.open_tasks.add(t);
      noteActivity(acc, t.updated_at);
    }
    for (const a of t.additional_assignees) {
      if (!a) continue;
      const acc = ensureAcc(a);
      if (isOpenStatus(t.status)) acc.open_tasks.add(t);
      noteActivity(acc, t.updated_at);
    }
  }

  // ---- Score each acc ----
  const rows: ResourceRosterRow[] = [];
  for (const acc of accs.values()) {
    const open_tasks = Array.from(acc.open_tasks);
    const past_due_tasks = open_tasks.filter(
      (t) => t.target_date != null && t.target_date < today,
    );
    const blocked_tasks = open_tasks.filter(
      (t) => t.blocked || t.status === "Blocked",
    );

    // Bottleneck: tasks elsewhere in the system that have us as
    // their structured blocker_task_id. We loop tasks once per acc;
    // total work is O(rows × tasks) which is fine for the data
    // sizes the design assumes (hundreds, not thousands).
    const bottleneck_tasks = identifyBottleneckTasks(acc, tasks);

    const workload = computeWorkload(
      acc,
      Array.from(acc.active_projects),
      open_tasks,
      past_due_tasks,
      bottleneck_tasks,
      settings,
    );

    const performance = computePerformance(
      acc,
      tasks,
      settings,
      now,
    );

    rows.push({
      resource: acc.display_name,
      user_id: acc.user?.user_id ?? null,
      free_text_only: acc.seen_as_free_text && !acc.seen_as_user,
      active_projects: Array.from(acc.active_projects).sort((a, b) =>
        a.project_id < b.project_id ? -1 : 1,
      ),
      open_tasks: open_tasks.sort((a, b) =>
        a.task_id < b.task_id ? -1 : 1,
      ),
      past_due_tasks,
      blocked_tasks,
      bottleneck_tasks,
      workload_score: workload.score,
      workload_bucket: workload.bucket,
      workload_breakdown: workload.breakdown,
      completed_tasks_in_window: performance.completed_count,
      on_time_rate: performance.on_time_rate,
      blocked_day_rate: performance.blocked_day_rate,
      performance_score: performance.score,
      performance_bucket: performance.bucket,
      last_activity_at: acc.last_activity_at,
    });
  }

  // Default sort: workload descending — overloaded resources surface
  // at the top, matching the "find problems first" goal of the page.
  rows.sort((a, b) => b.workload_score - a.workload_score);
  return rows;
}

// ---------------------------------------------------------------------------
// Bottleneck identification
// ---------------------------------------------------------------------------

/**
 * Resolve a resource's allocation percent on a specific project.
 * Reads `resource_allocations[key]` for the project, where `key` is
 * any of: the resolved user_id, the user's name, or the original
 * raw string the assignment used. Falls back to
 * `default_allocation_percent` when no entry matches.
 *
 * Returns 0-100 (percent), not a fraction; callers divide by 100
 * when multiplying by a weight.
 */
function lookupAllocationPercent(
  project: Project,
  acc: { user: PublicUser | null; display_name: string },
  defaultPct: number,
): number {
  const map = project.resource_allocations ?? {};
  // Try user_id first, then name, then display_name. The first hit
  // wins. We don't lowercase the keys — the editor stores them as
  // entered, and we look up using the same forms. If users want
  // case-insensitive matching they can normalize on entry.
  if (acc.user) {
    if (acc.user.user_id in map) return map[acc.user.user_id];
    if (acc.user.name && acc.user.name in map) return map[acc.user.name];
  }
  if (acc.display_name in map) return map[acc.display_name];
  return defaultPct;
}

/**
 * A task `t` makes its `responsible` person a bottleneck for *other*
 * people if some other open task `o` is structurally blocked on
 * `t.task_id` AND `o.responsible !== t.responsible`. The case where
 * the same person is blocking themselves is a self-dependency, not a
 * bottleneck — they can resolve it by working their queue.
 */
function identifyBottleneckTasks(
  acc: { active_projects: Set<Project>; open_tasks: Set<Task> } & {
    user: PublicUser | null;
    display_name: string;
  },
  allTasks: readonly Task[],
): Task[] {
  // The acc's tasks (both open and closed) — anything `responsible`
  // for that this person owns. We need closed too, because a task
  // marked Complete by its responsible might still be referenced as
  // a blocker by a stale open task elsewhere; that's a data-quality
  // signal worth surfacing.
  const ownedTaskIds = new Set<string>();
  for (const t of allTasks) {
    if (matchesAcc(t.responsible, acc)) ownedTaskIds.add(t.task_id);
  }
  if (ownedTaskIds.size === 0) return [];

  // Walk every other task. If it's open and blocked on one of our
  // tasks, that "our task" is a bottleneck.
  const out = new Set<string>();
  const ownedById = new Map<string, Task>();
  for (const t of allTasks) {
    if (ownedTaskIds.has(t.task_id)) ownedById.set(t.task_id, t);
  }
  for (const o of allTasks) {
    if (!isOpenStatus(o.status)) continue;
    if (!o.blocked) continue;
    if (o.blocker_type !== "task") continue;
    if (!o.blocker_task_id) continue;
    if (!ownedTaskIds.has(o.blocker_task_id)) continue;
    // Skip self-blocks — the resource can resolve those by working
    // their own queue.
    if (matchesAcc(o.responsible, acc)) continue;
    out.add(o.blocker_task_id);
  }
  return Array.from(out)
    .map((id) => ownedById.get(id))
    .filter((t): t is Task => t !== undefined);
}

/** True if `raw` (a project_lead / responsible / etc. string) refers
 * to this acc — by user_id or by name. */
function matchesAcc(
  raw: string,
  acc: { user: PublicUser | null; display_name: string },
): boolean {
  if (!raw) return false;
  const trimmed = raw.trim();
  if (acc.user && trimmed === acc.user.user_id) return true;
  if (acc.user && trimmed.toLowerCase() === acc.user.name.toLowerCase()) {
    return true;
  }
  if (
    acc.user &&
    acc.user.email &&
    trimmed.toLowerCase() === acc.user.email.toLowerCase()
  ) {
    return true;
  }
  return trimmed.toLowerCase() === acc.display_name.toLowerCase();
}

// ---------------------------------------------------------------------------
// Workload score
// ---------------------------------------------------------------------------

interface WorkloadResult {
  score: number;
  bucket: WorkloadBucket;
  breakdown: WorkloadBreakdown;
}

/**
 * Compute the workload composite + bucket. Formula:
 *
 *   score = projects_contribution
 *         + tasks_contribution
 *         + past_due_contribution
 *         + bottleneck_contribution
 *
 * Each contribution applies the configured weights from
 * ResourceSettings. Allocation percent comes from each project's
 * `resource_allocations` map, falling back to
 * `default_allocation_percent` when no per-assignment value is set.
 */
function computeWorkload(
  acc: { user: PublicUser | null; display_name: string },
  active_projects: Project[],
  open_tasks: Task[],
  past_due_tasks: Task[],
  bottleneck_tasks: Task[],
  settings: ResourceSettings,
): WorkloadResult {
  const w = settings.workload_weights;
  const defaultPct = settings.default_allocation_percent;

  // Project contribution: per active project, multiply by complexity
  // weight and the resource's per-project allocation. The allocation
  // is read from each project's `resource_allocations` map; missing
  // entries fall back to the org-wide default — so a team that
  // hasn't yet set per-assignment values still gets sensible (and
  // consistent) numbers.
  let projects_contribution = 0;
  for (const p of active_projects) {
    const complexity = complexityWeight(p.ai_complexity_score, w);
    const allocation = lookupAllocationPercent(p, acc, defaultPct) / 100;
    projects_contribution += w.project_assignment * complexity * allocation;
  }

  // Task contribution: per open task, multiply by its priority weight.
  let tasks_contribution = 0;
  for (const t of open_tasks) {
    tasks_contribution += w.open_task * priorityWeight(t.priority, w);
  }

  // Past-due contribution: a flat per-task adder on top of the
  // open-task base. Past-due is bad regardless of priority but a
  // critical past-due is worse than a low past-due, so still scale
  // by priority weight.
  let past_due_contribution = 0;
  for (const t of past_due_tasks) {
    past_due_contribution += w.past_due_task * priorityWeight(t.priority, w);
  }

  // Bottleneck contribution: per task this person is blocking
  // someone else on. No priority scaling — being a bottleneck is
  // structural, not prioritary.
  const bottleneck_contribution = w.bottleneck_task * bottleneck_tasks.length;

  const score =
    projects_contribution +
    tasks_contribution +
    past_due_contribution +
    bottleneck_contribution;

  const bucket = scoreToBucket(score, settings.workload_buckets);

  return {
    score: round2(score),
    bucket,
    breakdown: {
      project_assignments: round2(projects_contribution),
      open_tasks: round2(tasks_contribution),
      past_due_tasks: round2(past_due_contribution),
      bottleneck_tasks: round2(bottleneck_contribution),
    },
  };
}

function complexityWeight(
  c: ComplexityScore | null,
  w: ResourceSettings["workload_weights"],
): number {
  switch (c) {
    case "Low":
      return w.complexity_low;
    case "Medium":
      return w.complexity_medium;
    case "High":
      return w.complexity_high;
    case "Very High":
      return w.complexity_very_high;
    default:
      // No estimate yet — assume Medium. Better than 0, which would
      // make uncategorized projects free; better than max, which
      // would alarm prematurely.
      return w.complexity_medium;
  }
}

function priorityWeight(
  p: Priority,
  w: ResourceSettings["workload_weights"],
): number {
  switch (p) {
    case "Critical":
      return w.priority_critical;
    case "High":
      return w.priority_high;
    case "Medium":
      return w.priority_medium;
    case "Low":
      return w.priority_low;
    default:
      // Admin-extended priority value — treat as Medium. Same
      // rationale as the complexity default.
      return w.priority_medium;
  }
}

function scoreToBucket(
  score: number,
  buckets: ResourceSettings["workload_buckets"],
): WorkloadBucket {
  if (score < buckets.light_max) return "Light";
  if (score < buckets.balanced_max) return "Balanced";
  if (score < buckets.heavy_max) return "Heavy";
  return "Overloaded";
}

// ---------------------------------------------------------------------------
// Performance score
// ---------------------------------------------------------------------------

interface PerformanceResult {
  completed_count: number;
  on_time_rate: number | null;
  blocked_day_rate: number | null;
  score: number | null;
  bucket: PerformanceBucket;
}

/**
 * Compute the performance composite + bucket from tasks completed
 * within the configured window. Returns nulls when there's
 * insufficient signal (no completed tasks in the window) — the UI
 * shows an "Insufficient" badge rather than a misleading 0.
 *
 * `blocked_day_rate` is the fraction of the window during which the
 * resource had at least one blocked open task. We use a simple
 * count-based proxy: blocked_tasks_in_window / completed_in_window.
 * Approximate but cheap and intuitive — perfect-score requires no
 * blockers AND finishing on time.
 */
function computePerformance(
  acc: { user: PublicUser | null; display_name: string },
  allTasks: readonly Task[],
  settings: ResourceSettings,
  now: Date,
): PerformanceResult {
  const windowStart = isoDate(addDays(now, -settings.performance_window_days));
  const windowStartLower = windowStart.toLowerCase();

  // Population: tasks the acc owns that completed within the window.
  // We use `updated_at` as the completion timestamp — close enough
  // for completed tasks since the only update *after* completion is
  // a comment edit, and those are rare.
  let completed_count = 0;
  let on_time_count = 0;
  let blocked_count = 0;
  let with_target_date = 0;

  for (const t of allTasks) {
    if (!matchesAcc(t.responsible, acc)) continue;
    const isClosed = CLOSED_TASK_STATUSES.has(t.status);
    if (!isClosed) continue;
    if (t.status === "Canceled") continue; // Canceled isn't a completion signal
    const closedDate = (t.updated_at ?? "").slice(0, 10);
    if (closedDate < windowStartLower) continue;
    completed_count++;
    if (t.target_date) {
      with_target_date++;
      if (closedDate <= t.target_date) on_time_count++;
    }
    // `blocked` here means the task ever had `blocked === true` at
    // the moment of completion — closed tasks shouldn't be blocked
    // unless they were Canceled (already filtered out), but stale
    // data can leave the flag set. Either way, "completed despite
    // having been blocked" is the signal we want.
    if (t.blocked) blocked_count++;
  }

  if (completed_count === 0) {
    return {
      completed_count: 0,
      on_time_rate: null,
      blocked_day_rate: null,
      score: null,
      bucket: "Insufficient",
    };
  }

  const on_time_rate =
    with_target_date > 0 ? on_time_count / with_target_date : null;
  const blocked_day_rate = blocked_count / completed_count;

  // Composite: weighted on_time minus weighted blocked. Bounded 0-1.
  const w = settings.performance_weights;
  const totalWeight = w.on_time + w.blocked_inverse;
  if (totalWeight <= 0) {
    return {
      completed_count,
      on_time_rate,
      blocked_day_rate,
      score: null,
      bucket: "Insufficient",
    };
  }
  const onTimeContribution = (on_time_rate ?? 0) * w.on_time;
  const blockedInverseContribution =
    (1 - blocked_day_rate) * w.blocked_inverse;
  const score = (onTimeContribution + blockedInverseContribution) / totalWeight;

  const bucket =
    score >= settings.performance_thresholds.green_min
      ? "Green"
      : score >= settings.performance_thresholds.yellow_min
        ? "Yellow"
        : "Red";

  return {
    completed_count,
    on_time_rate,
    blocked_day_rate,
    score: round2(score),
    bucket,
  };
}

// ---------------------------------------------------------------------------
// Scoping — "people I lead" vs everyone
// ---------------------------------------------------------------------------

export type ResourceScope = "my_team" | "everyone";

/**
 * Filter a roster by the requested scope.
 *
 * `my_team` keeps only resources who appear on a project where the
 * current user is the lead. The current user themself is always
 * included (so a lead can see their own load alongside their team).
 *
 * `everyone` returns the roster unchanged — gated by
 * `resources.view_all` at the page level.
 */
export function applyScope(
  roster: ResourceRosterRow[],
  scope: ResourceScope,
  currentUser: { user_id: string; name: string },
  projects: readonly Project[],
): ResourceRosterRow[] {
  if (scope === "everyone") return roster;

  // Build the set of resources who appear on any project I lead.
  const myProjectIds = new Set<string>();
  for (const p of projects) {
    if (
      p.project_lead === currentUser.user_id ||
      p.project_lead.toLowerCase() === currentUser.name.toLowerCase()
    ) {
      myProjectIds.add(p.project_id);
    }
  }
  if (myProjectIds.size === 0) {
    // No projects led — keep just the current user themself so the
    // page isn't empty. They still see their own workload.
    return roster.filter(
      (r) =>
        r.user_id === currentUser.user_id ||
        r.resource.toLowerCase() === currentUser.name.toLowerCase(),
    );
  }

  return roster.filter((r) => {
    if (
      r.user_id === currentUser.user_id ||
      r.resource.toLowerCase() === currentUser.name.toLowerCase()
    ) {
      return true;
    }
    return r.active_projects.some((p) => myProjectIds.has(p.project_id));
  });
}

// ---------------------------------------------------------------------------
// Performance series — per-resource time series for the Performance tab
// ---------------------------------------------------------------------------

/**
 * One resource's performance numbers expressed as small time-series
 * arrays plus a few aggregated stats. Built on demand by the
 * Performance tab; the Overview's roster already carries the
 * snapshot version of the same data.
 */
export interface ResourcePerformanceSeries {
  resource: string;
  user_id: string | null;
  /** Tasks completed per ISO week (`YYYY-Www`), oldest first. */
  throughput: { week: string; count: number }[];
  /**
   * Per-task cycle times (created → completed, in days) for tasks
   * closed inside the configured window. Used for distribution
   * histograms.
   */
  cycle_times_days: number[];
  /** Median cycle time across the window, or null if no completions. */
  median_cycle_time_days: number | null;
  /** Same on-time + blocked rates the roster carries. */
  on_time_rate: number | null;
  blocked_day_rate: number | null;
  /** Total completed in window — surfaced on the Performance card. */
  completed_in_window: number;
}

/**
 * Build per-resource performance series for the Performance tab.
 * Pure: takes a roster (already computed once on page load) and the
 * tasks list + settings, produces one series per row.
 *
 * Why we still need `tasks` here even though the roster has
 * `open_tasks`: completed-task data isn't on the roster row (the
 * roster carries snapshot stats for the Overview but not the raw
 * task list). Walking tasks once per row is O(rows × tasks) which
 * is fine at the data sizes the design assumes.
 */
export function buildPerformanceSeries(
  roster: readonly ResourceRosterRow[],
  tasks: readonly Task[],
  settings: ResourceSettings,
  options: { now?: Date } = {},
): ResourcePerformanceSeries[] {
  const now = options.now ?? new Date();
  const windowStart = isoDate(addDays(now, -settings.performance_window_days));

  const out: ResourcePerformanceSeries[] = [];
  for (const r of roster) {
    // Build a matchesAcc shim from the roster row so we can reuse
    // the same matching logic as `computePerformance`.
    const acc = {
      user: r.user_id ? { user_id: r.user_id, name: r.resource } : null,
      display_name: r.resource,
    } as { user: PublicUser | null; display_name: string };

    const cycle_times_days: number[] = [];
    const throughputByWeek = new Map<string, number>();
    let completed = 0;

    for (const t of tasks) {
      if (!matchesAcc(t.responsible, acc)) continue;
      if (t.status !== "Complete") continue;
      const closed = (t.updated_at ?? "").slice(0, 10);
      if (closed < windowStart) continue;
      completed++;
      const week = isoWeek(new Date(`${closed}T00:00:00Z`));
      throughputByWeek.set(week, (throughputByWeek.get(week) ?? 0) + 1);
      const created = (t.created_at ?? "").slice(0, 10);
      if (created) {
        const days =
          (new Date(`${closed}T00:00:00Z`).getTime() -
            new Date(`${created}T00:00:00Z`).getTime()) /
          (1000 * 60 * 60 * 24);
        if (Number.isFinite(days) && days >= 0) {
          cycle_times_days.push(Math.round(days));
        }
      }
    }

    const throughput = Array.from(throughputByWeek.entries())
      .sort(([a], [b]) => (a < b ? -1 : 1))
      .map(([week, count]) => ({ week, count }));

    const median_cycle_time_days =
      cycle_times_days.length > 0
        ? median(cycle_times_days)
        : null;

    out.push({
      resource: r.resource,
      user_id: r.user_id,
      throughput,
      cycle_times_days,
      median_cycle_time_days,
      on_time_rate: r.on_time_rate,
      blocked_day_rate: r.blocked_day_rate,
      completed_in_window: completed,
    });
  }
  // Default sort by completed_in_window desc — the most-active
  // resources surface first on the tab.
  out.sort((a, b) => b.completed_in_window - a.completed_in_window);
  return out;
}

/** ISO 8601 week format `YYYY-Www`. */
function isoWeek(d: Date): string {
  const date = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dayNum = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - dayNum);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const weekNum = Math.ceil(
    ((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7,
  );
  return `${date.getUTCFullYear()}-W${String(weekNum).padStart(2, "0")}`;
}

function median(nums: number[]): number {
  const sorted = [...nums].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return Math.round((sorted[mid - 1] + sorted[mid]) / 2);
  }
  return sorted[mid];
}

// ---------------------------------------------------------------------------
// Date helpers
// ---------------------------------------------------------------------------

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function addDays(d: Date, days: number): Date {
  const out = new Date(d.getTime());
  out.setUTCDate(out.getUTCDate() + days);
  return out;
}
function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
