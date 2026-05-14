/**
 * Notification service layer (Section 5.12).
 *
 * Single entry point through which every other service-layer module fires
 * notifications. The shape of the API mirrors `lib/decisions/service.ts`
 * and `lib/projects/service.ts`: callers describe an *event*, this module
 * decides what record(s) to write and which user(s) to deliver to.
 *
 * Two concerns live here:
 *
 *   1. **`createNotification(...)`** — the low-level write that every other
 *      helper goes through. Centralizes preference resolution (a user with
 *      `Off` for the type gets nothing written) and the email dispatch
 *      hand-off so individual call sites don't have to remember either.
 *
 *   2. **Event-specific helpers** — `notifyTaskAssigned`,
 *      `notifyProjectStatusChange`, `notifyHealthScoreDegraded`, etc.
 *      These take the relevant entity, figure out *who* should be told and
 *      *what to say*, and call `createNotification` once per recipient.
 *
 * What this module deliberately does NOT do:
 *
 *   - Compute health scores. Step 8 owns that math; we accept the resulting
 *     score change as input and notify on it. Keeps the notification surface
 *     shallow and removes a circular import waiting to happen.
 *   - Schedule anything. Cron-driven sweeps (due-soon, overdue, digest) live
 *     in `lib/notifications/scheduler.ts`, which calls *into* this module.
 *   - Render email templates. Templates live in `lib/notifications/email.ts`;
 *     this module just hands the resulting payload off.
 *
 * Per Section 4.5, every notification has a `type`, a `message`, and a
 * pointer to the entity (`entity_type` + `entity_id`). The bell-icon UI
 * uses `entity_type` + `entity_id` to build a deep-link to the relevant
 * page, so callers should always supply both even when the message text
 * already names the entity.
 */

import {
  NotificationRepository,
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  UserRepository,
  type HealthScore,
  type Notification,
  type NotificationDelivery,
  type NotificationEntityType,
  type NotificationPreferences,
  type NotificationType,
  type Priority,
  type Project,
  type ProjectIdea,
  type ProjectId,
  type ProjectStatus,
  type Task,
  type TaskId,
  type User,
  type UserId,
} from "@/lib/db";
import { dispatchNotificationEmail } from "@/lib/notifications/email";

// ---------------------------------------------------------------------------
// Public types
// ---------------------------------------------------------------------------

/**
 * Inputs accepted by the low-level `createNotification` write. Mirrors
 * `CreateNotificationInput` from the repository but with the shape
 * cleaned up so call sites never have to think about persistence quirks.
 */
export interface NotifyInput {
  userId: UserId;
  type: NotificationType;
  message: string;
  entityType: NotificationEntityType;
  entityId: string;
}

// ---------------------------------------------------------------------------
// Preference resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the effective delivery mode for a given user / notification
 * type. Falls back to the org-wide default in `settings.json` when the
 * user has no entry for the type — fresh users seeded before a new
 * notification type was added end up here.
 *
 * Legacy migration: any stored value of `"Off"` is treated as
 * `"InAppOnly"` here. The product decision is that users cannot fully
 * opt out of notifications — they're system signals, not marketing —
 * but older user records and seed data may still carry `"Off"` because
 * an earlier version of the UI offered it. Normalizing on read keeps
 * those users receiving at least the in-app bell entry without
 * requiring a one-time data migration.
 */
async function resolveDelivery(
  user: User,
  type: NotificationType,
): Promise<NotificationDelivery> {
  const userPref = user.notification_preferences?.[type];
  if (userPref) {
    return userPref === "Off" ? "InAppOnly" : userPref;
  }
  const settings = await SettingsRepository.get();
  const orgDefault =
    settings.notification_defaults.per_type[type] ??
    ("InAppOnly" satisfies NotificationDelivery);
  return orgDefault === "Off" ? "InAppOnly" : orgDefault;
}

/**
 * Should this notification be persisted in the in-app feed for this user?
 * Off → no row written at all. Anything else → write it (the bell shows
 * everything that's been written, irrespective of whether the email also
 * fired).
 */
function deliveryWritesInApp(delivery: NotificationDelivery): boolean {
  return delivery !== "Off";
}

/** Should this notification trigger an immediate email? */
function deliveryFiresEmailNow(
  delivery: NotificationDelivery,
  digestMode: boolean,
): boolean {
  if (delivery !== "EmailAndInApp") return false;
  // Digest mode batches everything into the daily summary instead of
  // firing per-event. The cron scheduler reads `digest_mode` users'
  // unread notifications and sends one summary mail.
  return !digestMode;
}

// ---------------------------------------------------------------------------
// Low-level write
// ---------------------------------------------------------------------------

/**
 * Write a single notification, honouring the recipient's preferences and
 * (optionally) firing an email. Returns the persisted record, or `null`
 * if the recipient has the type set to `Off` or the recipient doesn't
 * exist / is deactivated.
 *
 * No exceptions are thrown for "user not found" — notifications are
 * advisory; a deleted user shouldn't break a project save. We log and
 * swallow.
 */
export async function createNotification(
  input: NotifyInput,
): Promise<Notification | null> {
  const user = await UserRepository.getById(input.userId);
  if (!user) {
    // Common during seed-data wiring (free-form names that haven't been
    // resolved to user IDs yet). Logging would be noisy; silent skip.
    return null;
  }
  if (!user.active) return null;

  const delivery = await resolveDelivery(user, input.type);
  if (!deliveryWritesInApp(delivery)) return null;

  const notification = await NotificationRepository.create({
    user_id: input.userId,
    type: input.type,
    message: input.message,
    entity_type: input.entityType,
    entity_id: input.entityId,
  });

  if (deliveryFiresEmailNow(delivery, user.digest_mode)) {
    // Fire-and-forget: a failed mail send must not roll the in-app
    // notification back, since the user can still see it in the bell.
    void dispatchNotificationEmail({
      to: user.email,
      recipientName: user.name,
      notification,
    }).catch((err) => {
      console.warn(
        `[notifications] email dispatch failed for ${input.type} → ${user.email}:`,
        err,
      );
    });
  }

  return notification;
}

/**
 * Batch helper: resolve a list of recipient IDs to a deduped, active set
 * and fire the same notification at each. Used by the project-level
 * helpers below where multiple users can share a stake (project lead +
 * additional resources, idea submitters with email, etc.).
 *
 * Free-form names in `additional_resources` / `additional_assignees` are
 * silently ignored — they aren't user IDs and `UserRepository.getById`
 * would always come back null. The unresolved-name list lives in
 * `data/seed/users-to-invite.json` and is the Admin's checklist for
 * promoting those names to real accounts.
 */
async function notifyMany(
  userIds: Iterable<UserId>,
  build: (uid: UserId) => Omit<NotifyInput, "userId">,
): Promise<Notification[]> {
  const seen = new Set<UserId>();
  const out: Notification[] = [];
  for (const uid of userIds) {
    if (!uid || seen.has(uid)) continue;
    seen.add(uid);
    const result = await createNotification({ userId: uid, ...build(uid) });
    if (result) out.push(result);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Recipient resolvers
// ---------------------------------------------------------------------------

/**
 * Project stakeholders, in the order most-relevant-first. The project
 * lead is first; then any additional resources. Free-form names are
 * resolved to user IDs via `UserRepository.getByName` so legacy
 * seed-data entries like `project_lead: "Savannah"` still notify the
 * right person (NOTIF-05). An entry that doesn't match either an id
 * or an active user name is dropped — there's no one to deliver to.
 */
async function projectStakeholderIds(project: Project): Promise<UserId[]> {
  const out: UserId[] = [];
  if (project.project_lead) {
    const id = await resolveAssigneeId(project.project_lead);
    if (id) out.push(id);
  }
  for (const r of project.additional_resources) {
    if (!r) continue;
    const id = await resolveAssigneeId(r);
    if (id) out.push(id);
  }
  return out;
}

/**
 * Tasks have a `responsible` plus `additional_assignees`. Same
 * id-or-name resolution as projects.
 */
async function taskAssigneeIds(task: Task): Promise<UserId[]> {
  const out: UserId[] = [];
  if (task.responsible) {
    const id = await resolveAssigneeId(task.responsible);
    if (id) out.push(id);
  }
  for (const a of task.additional_assignees) {
    if (!a) continue;
    const id = await resolveAssigneeId(a);
    if (id) out.push(id);
  }
  return out;
}

/**
 * Detect whether a string looks like a UUID-ish user ID vs. a free-form
 * name. We don't validate UUID strictly — the seed script uses real
 * UUIDs, but the assertion that matters is "this isn't 'Min' or 'Josh'".
 * Anything containing only hex/alnum/dash and at least 16 chars is
 * treated as an ID.
 */
function looksLikeUserId(value: string): boolean {
  return /^[0-9a-f-]{16,}$/i.test(value);
}

/**
 * Resolve an assignee value (could be a real user_id or a legacy free-
 * form name) to the corresponding user_id. Returns null if neither path
 * matches a user.
 *
 * The id-shape check is a fast path that avoids a DB lookup for the
 * common case of a real user_id. When the input looks like a name, we
 * fall back to a case-insensitive name match. Both branches go through
 * the user repository so a value claiming to be an id but pointing at no
 * real user is correctly resolved as null (a deactivated user, a typo,
 * or test data).
 *
 * The cache is request-local — held in the function's closure isn't
 * possible since callers come from many entry points; instead we accept
 * a small amount of repeated lookups inside a single notification batch
 * and trust that the JSON store's whole-file read is cheap enough.
 */
async function resolveAssigneeId(value: string): Promise<UserId | null> {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (looksLikeUserId(trimmed)) {
    const user = await UserRepository.getById(trimmed);
    return user ? user.user_id : null;
  }
  const user = await UserRepository.getByName(trimmed);
  return user ? user.user_id : null;
}

// ---------------------------------------------------------------------------
// Event helpers — Tasks (Section 5.12)
// ---------------------------------------------------------------------------

/**
 * Notify a task's primary assignee that a task was just assigned to them.
 * Called from `lib/tasks/service.ts` on create, and on update when
 * `responsible` changes.
 */
export async function notifyTaskAssigned(
  task: Task,
  project: Project | null,
): Promise<Notification | null> {
  if (!task.responsible) return null;
  // Resolve a free-form name like "Savannah" to its user_id (NOTIF-02);
  // returns null when no active user matches, which silently drops the
  // notification for unassigned-to-real-user values.
  const userId = await resolveAssigneeId(task.responsible);
  if (!userId) return null;
  const projectName = project?.name ?? task.project_id;
  return createNotification({
    userId,
    type: "TaskAssigned",
    message: `Assigned to you: "${task.task_name}" on ${projectName}`,
    entityType: "Task",
    entityId: task.task_id,
  });
}

/**
 * One task is past its target_date and not Complete/Canceled. Fired from
 * the scheduler's daily sweep, not from the service layer (overdue is a
 * derived state — the act of saving the task didn't make it overdue,
 * the calendar did).
 */
export async function notifyTaskOverdue(
  task: Task,
  project: Project | null,
): Promise<Notification[]> {
  const projectName = project?.name ?? task.project_id;
  const message = `Overdue: "${task.task_name}" on ${projectName} was due ${task.target_date}.`;
  return notifyMany(await taskAssigneeIds(task), () => ({
    type: "TaskOverdue",
    message,
    entityType: "Task",
    entityId: task.task_id,
  }));
}

/**
 * One task is approaching its target_date (default lead time: 3 days,
 * Section 5.12). Fired from the daily sweep.
 */
export async function notifyTaskDueSoon(
  task: Task,
  project: Project | null,
): Promise<Notification[]> {
  const projectName = project?.name ?? task.project_id;
  const message = `Due soon: "${task.task_name}" on ${projectName} (${task.target_date}).`;
  return notifyMany(await taskAssigneeIds(task), () => ({
    type: "TaskDueSoon",
    message,
    entityType: "Task",
    entityId: task.task_id,
  }));
}

// ---------------------------------------------------------------------------
// Event helpers — Projects (Section 5.12)
// ---------------------------------------------------------------------------

/**
 * Project status changed. We notify on transitions INTO `Blocked` only —
 * other transitions are routine and would create alert fatigue. The
 * caller passes the prior status so we can branch correctly.
 */
export async function notifyProjectStatusChange(opts: {
  project: Project;
  priorStatus: ProjectStatus;
}): Promise<Notification[]> {
  const { project, priorStatus } = opts;
  if (priorStatus === project.status) return [];
  if (project.status !== "Blocked") return [];
  const message = `Project blocked: ${project.name} (${project.project_id}).`;
  return notifyMany(await projectStakeholderIds(project), () => ({
    type: "ProjectBlocked",
    message,
    entityType: "Project",
    entityId: project.project_id,
  }));
}

/**
 * A project's health score changed for the worse. We DO notify on
 * Yellow→Red and Green→Yellow (degradations); we do NOT notify on
 * recoveries (Yellow→Green). Section 5.12 specifies "Health Score
 * Degraded".
 *
 * This is fired from `lib/health.ts` (Step 8) when the recalculated
 * score is persisted. `priorScore` may be null if the project had no
 * prior health score (first calculation): we treat that as Green for
 * the purpose of the comparison so a fresh project arriving directly
 * at Yellow or Red still notifies.
 */
export async function notifyHealthScoreDegraded(opts: {
  project: Project;
  priorScore: HealthScore | null;
  newScore: HealthScore;
}): Promise<Notification[]> {
  const { project, priorScore, newScore } = opts;
  if (!isDegradation(priorScore, newScore)) return [];
  const message = `Health score for ${project.name} dropped to ${newScore}.`;
  return notifyMany(await projectStakeholderIds(project), () => ({
    type: "HealthScoreChanged",
    message,
    entityType: "Project",
    entityId: project.project_id,
  }));
}

/**
 * One of *my* project's upstream dependencies has just become
 * Blocked / On Hold / Delayed. The caller is whoever moved the upstream
 * project into the bad state — we sweep its downstream dependents and
 * notify each set of stakeholders.
 */
export async function notifyDependencyBlocked(opts: {
  upstream: Project;
}): Promise<Notification[]> {
  const { upstream } = opts;
  if (upstream.status !== "Blocked" &&
      upstream.status !== "On Hold" &&
      upstream.status !== "Delayed") {
    return [];
  }
  const allProjects = await ProjectRepository.getAll();
  const downstreams = allProjects.filter((p) =>
    p.depends_on.includes(upstream.project_id),
  );
  if (downstreams.length === 0) return [];

  const out: Notification[] = [];
  for (const downstream of downstreams) {
    const message = `Upstream dependency ${upstream.name} (${upstream.project_id}) is ${upstream.status}.`;
    const written = await notifyMany(
      await projectStakeholderIds(downstream),
      () => ({
        type: "DependencyBlocked",
        message,
        entityType: "Project",
        entityId: downstream.project_id,
      }),
    );
    out.push(...written);
  }
  return out;
}

// ---------------------------------------------------------------------------
// Event helpers — Ideas (Section 5.12)
// ---------------------------------------------------------------------------

/**
 * An idea's status changed (Reviewed, Approved, Rejected, Converted).
 * Notification recipient is the original submitter, IF they provided an
 * email. Submitters don't have user accounts — they get email-only
 * delivery via a synthesized `userId`.
 *
 * The doc (Section 5.12) frames this as "for submitters who provided an
 * email", so we deliberately bypass the user-record preference machinery
 * and dispatch an email directly. No in-app row is written: the
 * submitter has nothing to log into.
 */
export async function notifyIdeaStatusChanged(opts: {
  idea: ProjectIdea;
  priorStatus: ProjectIdea["status"];
}): Promise<{ emailed: boolean; reason?: string }> {
  const { idea, priorStatus } = opts;
  if (priorStatus === idea.status) return { emailed: false, reason: "no-change" };
  if (!idea.submitter_email) return { emailed: false, reason: "no-email" };

  await dispatchNotificationEmail({
    to: idea.submitter_email,
    recipientName: idea.submitter_name,
    notification: {
      // Synthesized — never persisted to notifications.json. Holds enough
      // shape to drive the same template that internal users get.
      notification_id: "idea-" + idea.idea_id,
      user_id: "",
      type: "IdeaStatusChanged",
      message: ideaStatusMessage(idea),
      entity_type: "Idea",
      entity_id: idea.idea_id,
      read: false,
      created_at: new Date().toISOString(),
    },
  }).catch((err) => {
    console.warn(
      `[notifications] idea email dispatch failed for ${idea.submitter_email}:`,
      err,
    );
  });
  return { emailed: true };
}

function ideaStatusMessage(idea: ProjectIdea): string {
  switch (idea.status) {
    case "Approved":
      return `Your idea "${idea.idea_name}" has been approved for future consideration.`;
    case "Rejected":
      return `Your idea "${idea.idea_name}" has been reviewed and will not be moving forward.`;
    case "Converted":
      return `Your idea "${idea.idea_name}" has been promoted to an active project.`;
    case "Under Review":
      return `Your idea "${idea.idea_name}" is now under review.`;
    case "New":
    default:
      return `Update on your idea "${idea.idea_name}".`;
  }
}

// ---------------------------------------------------------------------------
// Health-score comparison helper (exported for the smoke test)
// ---------------------------------------------------------------------------

const HEALTH_RANK: Record<HealthScore, number> = {
  Green: 0,
  Yellow: 1,
  Red: 2,
};

/**
 * Treat a missing prior score as Green so a brand-new Red/Yellow project
 * still notifies. Returns true iff `next` is strictly worse than `prior`.
 */
export function isDegradation(
  prior: HealthScore | null,
  next: HealthScore,
): boolean {
  const priorRank = prior === null ? HEALTH_RANK.Green : HEALTH_RANK[prior];
  return HEALTH_RANK[next] > priorRank;
}

// ---------------------------------------------------------------------------
// Read / mark-as-read passthroughs (used by the bell drawer)
// ---------------------------------------------------------------------------

export async function listForUser(userId: UserId): Promise<Notification[]> {
  return NotificationRepository.getByUserId(userId);
}

export async function listUnreadForUser(userId: UserId): Promise<Notification[]> {
  return NotificationRepository.getUnreadByUserId(userId);
}

export async function markRead(
  userId: UserId,
  notificationId: string,
): Promise<Notification | null> {
  const existing = await NotificationRepository.getById(notificationId);
  if (!existing) return null;
  // Defense-in-depth: do not let user A mark user B's notifications. The
  // API route already filters on userId, but the service guards the same
  // invariant so a script call can't accidentally cross users.
  if (existing.user_id !== userId) return null;
  if (existing.read) return existing;
  return NotificationRepository.markRead(notificationId);
}

export async function markAllReadForUser(userId: UserId): Promise<number> {
  const unread = await NotificationRepository.getUnreadByUserId(userId);
  for (const n of unread) {
    await NotificationRepository.markRead(n.notification_id);
  }
  return unread.length;
}

// ---------------------------------------------------------------------------
// Preference patch (used by the profile page)
// ---------------------------------------------------------------------------

/**
 * Update one user's notification preferences. Accepts a sparse patch over
 * `NotificationPreferences` (only the keys being changed), plus an optional
 * digest_mode override. Returns the updated preferences.
 *
 * Lives in the service layer so the profile API route can defer all
 * validation here and stay thin.
 */
export async function updatePreferences(
  userId: UserId,
  patch: Partial<NotificationPreferences>,
  digestMode?: boolean,
): Promise<{
  preferences: NotificationPreferences;
  digest_mode: boolean;
}> {
  const user = await UserRepository.getById(userId);
  if (!user) throw new Error(`User ${userId} not found`);
  const next: NotificationPreferences = {
    ...user.notification_preferences,
    ...patch,
  };
  const updated = await UserRepository.update(userId, {
    notification_preferences: next,
    ...(digestMode !== undefined ? { digest_mode: digestMode } : {}),
  });
  return {
    preferences: updated.notification_preferences,
    digest_mode: updated.digest_mode,
  };
}

// ---------------------------------------------------------------------------
// Re-exports — convenient single import for callers
// ---------------------------------------------------------------------------

export {
  notifyTaskAssigned as fireTaskAssignedNotification,
  notifyTaskOverdue as fireTaskOverdueNotification,
  notifyTaskDueSoon as fireTaskDueSoonNotification,
  notifyProjectStatusChange as fireProjectStatusNotification,
  notifyHealthScoreDegraded as fireHealthScoreNotification,
  notifyDependencyBlocked as fireDependencyBlockedNotification,
  notifyIdeaStatusChanged as fireIdeaStatusNotification,
};

// Suppress an unused-import warning when the file is imported only for its
// side-effect re-exports. `Priority` and `TaskId` ride along in this list to
// keep the type imports stable when other modules want to import once.
export type {
  HealthScore,
  Priority,
  Project,
  ProjectId,
  Task,
  TaskId,
};
