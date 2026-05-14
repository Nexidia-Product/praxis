/**
 * Notification daily sweep (Section 5.12, Section 9 Step 7).
 *
 * Four things happen on each run:
 *
 *   1. **Due-soon scan** — every Open/In Progress task whose
 *      `target_date` is within `lead_days` (default 3) gets a
 *      `TaskDueSoon` notification to its assignees, if one wasn't
 *      already written today.
 *   2. **Overdue scan** — every Open/In Progress task whose
 *      `target_date` has passed gets a `TaskOverdue`, same
 *      idempotency rule.
 *   3. **Digest dispatch** — for every user with
 *      `digest_mode === true` and unread `EmailAndInApp`
 *      notifications since 24h ago, fire one digest email.
 *   4. **Purge** — delete read notifications older than 90 days
 *      (Appendix A).
 *
 * Bulk health-score recalc used to live here too. It's been removed
 * to keep the sweep under Vercel Hobby's 10s function timeout — the
 * per-write hooks in `lib/projects/service.ts` and
 * `lib/tasks/service.ts` already call `recalculateAndPersist` after
 * every change, so badges stay current during normal use. If you
 * need a bulk catch-up after a manual data import or a long quiet
 * period, run `recalculateAllHealthScores()` once from a script.
 *
 * Stage 3 history: this module used to also run an in-process
 * `node-cron` job that called `runDailySweep` daily at 07:00 UTC.
 * The Vercel deployment story doesn't support long-lived processes,
 * so the schedule moved to a Vercel Cron entry in `vercel.json`
 * that POSTs to `/api/admin/notifications/sweep` (the same route the
 * admin UI uses). The function below is now the only entry point.
 *
 * Idempotency:
 *
 *   The "fired one already today" check uses the in-app feed itself
 *   — we look for an existing notification for the same (type,
 *   entity_id) created on or after midnight UTC. Means the sweep can
 *   run multiple times without duplicating, so a Vercel-cron-and-
 *   admin-button double-fire on the same day is safe.
 *
 * Time semantics:
 *
 *   "Today" means UTC. `target_date` is stored as `YYYY-MM-DD` (ISO
 *   calendar date, no offset), so we compare those strings directly.
 *   This avoids per-user-timezone rules that would make the schedule
 *   intractable; the off-by-up-to-24h is acceptable in exchange for
 *   predictability.
 */

import {
  NotificationRepository,
  ProjectRepository,
  TaskRepository,
  UserRepository,
  type Notification,
  type NotificationType,
  type Project,
  type Task,
} from "@/lib/db";
import {
  notifyTaskDueSoon,
  notifyTaskOverdue,
} from "@/lib/notifications/service";
import { dispatchDigestEmail } from "@/lib/notifications/email";

// ---------------------------------------------------------------------------
// Tunables
// ---------------------------------------------------------------------------

/** Lead time for `TaskDueSoon` (Section 5.12: default 3 days). */
const DUE_SOON_LEAD_DAYS = 3;

/** Retention window for read in-app notifications (Appendix A). */
const PURGE_READ_OLDER_THAN_DAYS = 90;

/** Statuses that count as "still being worked on" for the due-soon sweep. */
const ACTIVE_TASK_STATUSES = ["Not Started", "In Progress", "Blocked"] as const;

// ---------------------------------------------------------------------------
// Day arithmetic
// ---------------------------------------------------------------------------

function todayUtcDateOnly(): string {
  return new Date().toISOString().slice(0, 10);
}

function addDays(dateOnly: string, days: number): string {
  // dateOnly is "YYYY-MM-DD"; treat as UTC midnight to avoid TZ surprises.
  const d = new Date(`${dateOnly}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function startOfTodayUtcIso(): string {
  return `${todayUtcDateOnly()}T00:00:00.000Z`;
}

function isoDaysAgo(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

// ---------------------------------------------------------------------------
// Idempotency check
// ---------------------------------------------------------------------------

/**
 * Set of `entity_id` values that already received a notification of
 * the given type today. The sweep skips entities in this set so
 * re-runs (cron + admin button on the same day) don't duplicate.
 */
async function alreadyFiredToday(
  type: NotificationType,
): Promise<Set<string>> {
  const cutoff = startOfTodayUtcIso();
  const all = await NotificationRepository.getAll();
  const out = new Set<string>();
  for (const n of all) {
    if (n.type !== type) continue;
    if (n.created_at < cutoff) continue;
    out.add(n.entity_id);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Result shape
// ---------------------------------------------------------------------------

export interface SweepResult {
  due_soon_notified: number;
  overdue_notified: number;
  digests_sent: number;
  purged_old: number;
  health_recalc_attempted: number;
  duration_ms: number;
}

// ---------------------------------------------------------------------------
// Phase: due-soon
// ---------------------------------------------------------------------------

async function sweepDueSoon(
  tasks: Task[],
  today: string,
  projectsById: Map<string, Project>,
): Promise<number> {
  const horizon = addDays(today, DUE_SOON_LEAD_DAYS);
  const alreadyFired = await alreadyFiredToday("TaskDueSoon");
  let written = 0;

  for (const task of tasks) {
    if (!task.target_date) continue;
    if (!ACTIVE_TASK_STATUSES.includes(task.status as typeof ACTIVE_TASK_STATUSES[number])) {
      continue;
    }
    // In window iff today <= target_date <= today + lead_days. Tasks
    // already past due get the overdue treatment instead.
    if (task.target_date < today) continue;
    if (task.target_date > horizon) continue;
    if (alreadyFired.has(task.task_id)) continue;

    const project = projectsById.get(task.project_id) ?? null;
    const fired = await notifyTaskDueSoon(task, project);
    written += fired.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Phase: overdue
// ---------------------------------------------------------------------------

async function sweepOverdue(
  tasks: Task[],
  today: string,
  projectsById: Map<string, Project>,
): Promise<number> {
  const alreadyFired = await alreadyFiredToday("TaskOverdue");
  let written = 0;

  for (const task of tasks) {
    if (!task.target_date) continue;
    if (!ACTIVE_TASK_STATUSES.includes(task.status as typeof ACTIVE_TASK_STATUSES[number])) {
      continue;
    }
    if (task.target_date >= today) continue;
    if (alreadyFired.has(task.task_id)) continue;

    const project = projectsById.get(task.project_id) ?? null;
    const fired = await notifyTaskOverdue(task, project);
    written += fired.length;
  }
  return written;
}

// ---------------------------------------------------------------------------
// Phase: digest dispatch
// ---------------------------------------------------------------------------

/**
 * For every user with `digest_mode = true`, gather their unread
 * notifications written since 24h ago and send a single email.
 * 24h matches the cron cadence — no per-user "last digest" tracking
 * needed.
 */
async function sweepDigests(): Promise<number> {
  const users = await UserRepository.getAll();
  const cutoff = isoDaysAgo(1);
  let sent = 0;

  for (const user of users) {
    if (!user.active) continue;
    if (!user.digest_mode) continue;
    if (!user.email) continue;

    const all = await NotificationRepository.getByUserId(user.user_id);
    const recent = all.filter(
      (n) =>
        n.created_at >= cutoff &&
        shouldIncludeInDigest(n, user.notification_preferences),
    );
    if (recent.length === 0) continue;

    const result = await dispatchDigestEmail({
      to: user.email,
      recipientName: user.name,
      notifications: recent,
    });
    if (result.delivered) sent++;
  }
  return sent;
}

function shouldIncludeInDigest(
  n: Notification,
  prefs: Record<NotificationType, "InAppOnly" | "EmailAndInApp" | "Off">,
): boolean {
  return prefs?.[n.type] === "EmailAndInApp";
}

// ---------------------------------------------------------------------------
// Phase: purge
// ---------------------------------------------------------------------------

async function purgeOldRead(): Promise<number> {
  const cutoff = isoDaysAgo(PURGE_READ_OLDER_THAN_DAYS);
  return NotificationRepository.deleteReadOlderThan(cutoff);
}

// ---------------------------------------------------------------------------
// Top-level
// ---------------------------------------------------------------------------

/**
 * Run the full daily sweep once. Single entry point — called by the
 * sweep API route (which is what the Vercel Cron job and the admin
 * "Run sweep now" button both hit).
 *
 * Errors in any one phase are logged and the sweep continues — a
 * broken digest mailer must not stop the overdue scan from running.
 */
export async function runDailySweep(): Promise<SweepResult> {
  const startedAt = Date.now();
  const today = todayUtcDateOnly();

  const [tasks, projects] = await Promise.all([
    TaskRepository.getAll(),
    ProjectRepository.getAll(),
  ]);
  const projectsById = new Map<string, Project>(
    projects.map((p) => [p.project_id, p]),
  );

  let due_soon_notified = 0;
  let overdue_notified = 0;
  let digests_sent = 0;
  let purged_old = 0;

  try {
    due_soon_notified = await sweepDueSoon(tasks, today, projectsById);
  } catch (err) {
    console.warn("[sweep] due-soon phase failed:", err);
  }

  try {
    overdue_notified = await sweepOverdue(tasks, today, projectsById);
  } catch (err) {
    console.warn("[sweep] overdue phase failed:", err);
  }

  try {
    digests_sent = await sweepDigests();
  } catch (err) {
    console.warn("[sweep] digest phase failed:", err);
  }

  try {
    purged_old = await purgeOldRead();
  } catch (err) {
    console.warn("[sweep] purge phase failed:", err);
  }

  const duration_ms = Date.now() - startedAt;
  console.info(
    `[sweep] complete in ${duration_ms}ms — ` +
      `due_soon=${due_soon_notified} overdue=${overdue_notified} ` +
      `digests=${digests_sent} purged=${purged_old}`,
  );
  return {
    due_soon_notified,
    overdue_notified,
    digests_sent,
    purged_old,
    // Field retained for API-shape stability but always zero now —
    // the bulk recalc was removed for Hobby-tier timeout reasons.
    // Per-write hooks keep individual project badges current.
    health_recalc_attempted: 0,
    duration_ms,
  };
}
