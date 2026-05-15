/**
 * Task service layer.
 *
 * Mirrors `lib/projects/service.ts`: every API route goes through here,
 * never directly to the repository. Two responsibilities:
 *
 *   1. Validate inbound payloads (Section 4.2 schema).
 *   2. Instantiate task templates when a project is created with a
 *      `template_id` (Section 5.19, Section 9 Step 4).
 *
 * Why template instantiation lives here rather than in the project service:
 *   - It writes to `tasks.json`, not `projects.json` — its repository.
 *   - The project service can call into it once the project exists; that
 *     keeps the project service from knowing the task schema.
 *
 * No reparenting: tasks cannot have their `project_id` changed after
 * creation. Section 4.2 lists `project_id` as the parent reference and
 * the design treats tasks as cohabitants of their project. If a task
 * really belongs elsewhere, delete it and recreate.
 */

import {
  ProjectRepository,
  TaskRepository,
  TemplateRepository,
  UserRepository,
  type CreateTaskInput,
  type Priority,
  type ProjectId,
  type Task,
  type TaskCommentEntry,
  type TaskId,
  type TaskStatus,
  type TemplateId,
  type UpdateTaskInput,
  type UserId,
} from "@/lib/db";
import {
  LinkValidationError,
  validateDocumentLinks,
} from "@/lib/projects/links";
import { invalidateVelocityCache } from "@/lib/velocity/cache";
import { audit, summarizeChanges } from "@/lib/audit/service";

// ---------------------------------------------------------------------------
// Constants — kept in sync with type aliases in `lib/db/types.ts`.
// ---------------------------------------------------------------------------

const TASK_STATUSES: TaskStatus[] = [
  "Not Started",
  "In Progress",
  "Blocked",
  "Delayed",
  "On Hold",
  "Complete",
  "Canceled",
];

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

// ---------------------------------------------------------------------------
// Payload shapes
// ---------------------------------------------------------------------------

export interface TaskCreatePayload {
  project_id?: unknown;
  task_name?: unknown;
  detailed_description?: unknown;
  status?: unknown;
  priority?: unknown;
  responsible?: unknown;
  additional_assignees?: unknown;
  target_date?: unknown;
  blocked?: unknown;
  blocker_issue_task?: unknown;
  /**
   * New (Section 4.2 follow-up): structured blocker classification.
   * "task" | "project" | "other" | null. When "task" or "project",
   * `blocker_task_id` / `blocker_project_id` should also be supplied.
   */
  blocker_type?: unknown;
  blocker_task_id?: unknown;
  blocker_project_id?: unknown;
  comments?: unknown;
  /** Step 6 (Section 5.14): array of {label, url, link_type}. */
  document_links?: unknown;
  /** Optional time estimate in hours (decimal allowed; ≥0, ≤999, or null). */
  estimate_hours?: unknown;
}

/** PATCH payload — `project_id` is intentionally omitted (no reparenting). */
export interface TaskUpdatePayload {
  task_name?: unknown;
  detailed_description?: unknown;
  status?: unknown;
  priority?: unknown;
  responsible?: unknown;
  additional_assignees?: unknown;
  target_date?: unknown;
  blocked?: unknown;
  blocker_issue_task?: unknown;
  blocker_type?: unknown;
  blocker_task_id?: unknown;
  blocker_project_id?: unknown;
  comments?: unknown;
  /** Step 6 (Section 5.14): array of {label, url, link_type}. */
  document_links?: unknown;
  /** Optional time estimate in hours (decimal allowed; ≥0, ≤999, or null). */
  estimate_hours?: unknown;
}

// ---------------------------------------------------------------------------
// Coercion helpers (same shape as project service for consistency)
// ---------------------------------------------------------------------------

function asString(
  value: unknown,
  field: string,
  opts: { trim?: boolean } = {},
): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }
  return opts.trim === false ? value : value.trim();
}

function asOptionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  return asString(value, field);
}

function asNullableDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be an ISO date string or null.`);
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    throw new ValidationError(`${field} must be in YYYY-MM-DD format.`);
  }
  return trimmed.slice(0, 10);
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (
    typeof value !== "string" ||
    !(allowed as readonly string[]).includes(value)
  ) {
    throw new ValidationError(
      `${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
}

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings.`);
  }
  return value.map((v, i) => {
    if (typeof v !== "string") {
      throw new ValidationError(`${field}[${i}] must be a string.`);
    }
    return v.trim();
  });
}

function asBoolean(value: unknown, field: string): boolean {
  if (typeof value === "boolean") return value;
  if (value === "true") return true;
  if (value === "false") return false;
  throw new ValidationError(`${field} must be a boolean.`);
}

/**
 * Coerce a value to an optional non-negative number with an upper
 * bound. Accepts:
 *   - `undefined` / `null` / "" → null (treated as "not set")
 *   - numbers in [0, max] → returned as-is
 *   - numeric strings (e.g. form input) → parsed and validated
 *
 * Used for `estimate_hours` (max 999h ≈ 6 months — high enough for
 * any real task, low enough to catch typos like "3000"). The same
 * helper can be reused for any future hour/percent/count fields.
 */
function asOptionalNonNegativeNumber(
  value: unknown,
  field: string,
  max: number,
): number | null {
  if (value === undefined || value === null || value === "") return null;
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value);
  } else {
    throw new ValidationError(`${field} must be a number.`);
  }
  if (!Number.isFinite(n)) {
    throw new ValidationError(`${field} must be a finite number.`);
  }
  if (n < 0) {
    throw new ValidationError(`${field} cannot be negative.`);
  }
  if (n > max) {
    throw new ValidationError(`${field} cannot exceed ${max}.`);
  }
  return n;
}

/**
 * Validate the structured blocker classification trio:
 * `blocker_type` is one of `"task" | "project" | "other" | null`,
 * and the matching ID field is required when type is "task" or
 * "project". For "other" / `null` we clear the IDs so we don't carry
 * stale references.
 *
 * Returns the canonical shape; throws `ValidationError` on bad
 * input. Existing values are passed in so a partial PATCH (e.g. just
 * `blocker_task_id`) can resolve to a coherent triple.
 */
function shapeBlockerClassification(
  payload: {
    blocker_type?: unknown;
    blocker_task_id?: unknown;
    blocker_project_id?: unknown;
  },
  existing: {
    blocker_type: Task["blocker_type"];
    blocker_task_id: Task["blocker_task_id"];
    blocker_project_id: Task["blocker_project_id"];
  },
): {
  blocker_type: Task["blocker_type"];
  blocker_task_id: Task["blocker_task_id"];
  blocker_project_id: Task["blocker_project_id"];
} {
  // Resolve each field — fall back to existing when omitted.
  const rawType =
    payload.blocker_type === undefined
      ? existing.blocker_type
      : payload.blocker_type;
  const rawTaskId =
    payload.blocker_task_id === undefined
      ? existing.blocker_task_id
      : payload.blocker_task_id;
  const rawProjectId =
    payload.blocker_project_id === undefined
      ? existing.blocker_project_id
      : payload.blocker_project_id;

  let blocker_type: Task["blocker_type"];
  if (rawType === null || rawType === "") {
    blocker_type = null;
  } else if (
    rawType === "task" ||
    rawType === "project" ||
    rawType === "other"
  ) {
    blocker_type = rawType;
  } else {
    throw new ValidationError(
      "blocker_type must be one of: task, project, other, null.",
    );
  }

  // Coerce each ID independently. A null / empty string clears it.
  const cleanTaskId =
    typeof rawTaskId === "string" && rawTaskId.trim().length > 0
      ? rawTaskId.trim()
      : null;
  const cleanProjectId =
    typeof rawProjectId === "string" && rawProjectId.trim().length > 0
      ? rawProjectId.trim()
      : null;

  // Apply policy by type: keep the relevant ID, clear the other two.
  if (blocker_type === "task") {
    if (!cleanTaskId) {
      throw new ValidationError(
        "blocker_task_id is required when blocker_type is 'task'.",
      );
    }
    return {
      blocker_type,
      blocker_task_id: cleanTaskId,
      blocker_project_id: null,
    };
  }
  if (blocker_type === "project") {
    if (!cleanProjectId) {
      throw new ValidationError(
        "blocker_project_id is required when blocker_type is 'project'.",
      );
    }
    return {
      blocker_type,
      blocker_task_id: null,
      blocker_project_id: cleanProjectId,
    };
  }
  // "other" or null: structured IDs are not meaningful; clear them.
  return {
    blocker_type,
    blocker_task_id: null,
    blocker_project_id: null,
  };
}

// ---------------------------------------------------------------------------
// Validate-and-shape helpers
// ---------------------------------------------------------------------------

/**
 * Shared helper — translate `LinkValidationError` into the task service's
 * own `ValidationError` so callers see one error class.
 */
function shapeDocumentLinks(
  raw: unknown,
  existing: Task["document_links"],
  ctx: { userId: UserId; now: string },
): Task["document_links"] {
  try {
    return validateDocumentLinks(raw, existing, ctx);
  } catch (err) {
    if (err instanceof LinkValidationError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}

function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Look up a user's display name for comment-history attribution.
 * Mirrors the project service helper: returns `null` for "system"
 * actors and any lookup miss / exception so the entry stays valid
 * even if the user record was deleted.
 */
async function resolveUserDisplayName(
  userId: UserId,
): Promise<string | null> {
  if (!userId || userId === "system") return null;
  try {
    const user = await UserRepository.getById(userId);
    return user?.name ?? null;
  } catch {
    return null;
  }
}

async function shapeCreate(
  payload: TaskCreatePayload,
  ctx: { userId: UserId },
): Promise<CreateTaskInput> {
  const project_id = asString(payload.project_id, "project_id");
  if (!project_id) throw new ValidationError("project_id is required.");

  // Confirm parent project exists. Without this, a typo would create an
  // orphaned task that never appears in any project view.
  const parent = await ProjectRepository.getById(project_id);
  if (!parent) {
    throw new ValidationError(`Project ${project_id} does not exist.`);
  }

  const task_name = asString(payload.task_name, "task_name");
  if (!task_name) throw new ValidationError("task_name is required.");

  const detailed_description = asOptionalString(
    payload.detailed_description,
    "detailed_description",
  );
  const status = asEnum(payload.status, TASK_STATUSES, "status");
  const priority = asEnum(payload.priority, PRIORITIES, "priority");
  const responsible = asOptionalString(payload.responsible, "responsible");
  const additional_assignees = asStringArray(
    payload.additional_assignees,
    "additional_assignees",
  );
  const target_date = asNullableDate(payload.target_date, "target_date");

  // Section 5.2: blocked-with-empty-blocker-text is a degenerate state. We
  // don't error — the UI will hint — but we DO mirror task.status === "Blocked"
  // into the boolean for consistency, since both are exposed in the schema.
  const explicitBlocked =
    payload.blocked === undefined
      ? status === "Blocked"
      : asBoolean(payload.blocked, "blocked");
  const blocked = explicitBlocked || status === "Blocked";

  const blocker_issue_task = asOptionalString(
    payload.blocker_issue_task,
    "blocker_issue_task",
  );

  // Structured blocker classification. On create there's no existing
  // record, so pass null defaults — `shapeBlockerClassification`
  // resolves omitted fields to the existing values when present.
  const blockerShape = shapeBlockerClassification(payload, {
    blocker_type: null,
    blocker_task_id: null,
    blocker_project_id: null,
  });

  // If the user picked task/project as the blocker type, verify the
  // referenced record actually exists. Catches typos and stale IDs
  // from copy-paste before they end up in the data store. We don't
  // verify "other" / null since there's nothing to reference.
  if (blockerShape.blocker_type === "task" && blockerShape.blocker_task_id) {
    const exists = await TaskRepository.getById(blockerShape.blocker_task_id);
    if (!exists) {
      throw new ValidationError(
        `Blocker task ${blockerShape.blocker_task_id} not found.`,
      );
    }
  }
  if (
    blockerShape.blocker_type === "project" &&
    blockerShape.blocker_project_id
  ) {
    const exists = await ProjectRepository.getById(
      blockerShape.blocker_project_id,
    );
    if (!exists) {
      throw new ValidationError(
        `Blocker project ${blockerShape.blocker_project_id} not found.`,
      );
    }
  }

  const comments = asOptionalString(payload.comments, "comments");

  const estimate_hours = asOptionalNonNegativeNumber(
    payload.estimate_hours,
    "estimate_hours",
    999,
  );

  const document_links = shapeDocumentLinks(
    payload.document_links,
    [],
    { userId: ctx.userId, now: nowIsoTimestamp() },
  );

  return {
    project_id,
    task_name,
    detailed_description,
    status,
    priority,
    responsible,
    additional_assignees,
    target_date,
    blocked,
    blocker_issue_task,
    blocker_type: blockerShape.blocker_type,
    blocker_task_id: blockerShape.blocker_task_id,
    blocker_project_id: blockerShape.blocker_project_id,
    comments,
    document_links,
    estimate_hours,
    template_id: null,
  };
}

async function shapeUpdate(
  existing: Task,
  payload: TaskUpdatePayload,
  ctx: { userId: UserId },
): Promise<UpdateTaskInput> {
  const patch: UpdateTaskInput = {};

  if (payload.task_name !== undefined) {
    const v = asString(payload.task_name, "task_name");
    if (!v) throw new ValidationError("task_name cannot be empty.");
    patch.task_name = v;
  }
  if (payload.detailed_description !== undefined) {
    patch.detailed_description = asOptionalString(
      payload.detailed_description,
      "detailed_description",
    );
  }
  if (payload.status !== undefined) {
    patch.status = asEnum(payload.status, TASK_STATUSES, "status");
  }
  if (payload.priority !== undefined) {
    patch.priority = asEnum(payload.priority, PRIORITIES, "priority");
  }
  if (payload.responsible !== undefined) {
    patch.responsible = asOptionalString(payload.responsible, "responsible");
  }
  if (payload.additional_assignees !== undefined) {
    patch.additional_assignees = asStringArray(
      payload.additional_assignees,
      "additional_assignees",
    );
  }
  if (payload.target_date !== undefined) {
    patch.target_date = asNullableDate(payload.target_date, "target_date");
  }
  if (payload.blocked !== undefined) {
    patch.blocked = asBoolean(payload.blocked, "blocked");
  }
  if (payload.blocker_issue_task !== undefined) {
    patch.blocker_issue_task = asOptionalString(
      payload.blocker_issue_task,
      "blocker_issue_task",
    );
  }

  // Structured blocker fields — only run validation when at least one
  // field is touched, since the helper resolves omitted fields to the
  // existing values. This avoids running existence checks on every
  // patch (e.g. a comment edit shouldn't re-verify the blocker).
  if (
    payload.blocker_type !== undefined ||
    payload.blocker_task_id !== undefined ||
    payload.blocker_project_id !== undefined
  ) {
    const shape = shapeBlockerClassification(payload, {
      blocker_type: existing.blocker_type,
      blocker_task_id: existing.blocker_task_id,
      blocker_project_id: existing.blocker_project_id,
    });
    if (shape.blocker_type === "task" && shape.blocker_task_id) {
      // Don't allow a task to block itself — confusing and creates a
      // self-referential UI loop.
      if (shape.blocker_task_id === existing.task_id) {
        throw new ValidationError("A task cannot block itself.");
      }
      const exists = await TaskRepository.getById(shape.blocker_task_id);
      if (!exists) {
        throw new ValidationError(
          `Blocker task ${shape.blocker_task_id} not found.`,
        );
      }
    }
    if (shape.blocker_type === "project" && shape.blocker_project_id) {
      const exists = await ProjectRepository.getById(shape.blocker_project_id);
      if (!exists) {
        throw new ValidationError(
          `Blocker project ${shape.blocker_project_id} not found.`,
        );
      }
    }
    patch.blocker_type = shape.blocker_type;
    patch.blocker_task_id = shape.blocker_task_id;
    patch.blocker_project_id = shape.blocker_project_id;
  }

  if (payload.comments !== undefined) {
    patch.comments = asOptionalString(payload.comments, "comments");
  }
  if (payload.document_links !== undefined) {
    patch.document_links = shapeDocumentLinks(
      payload.document_links,
      existing.document_links,
      { userId: ctx.userId, now: nowIsoTimestamp() },
    );
  }
  if (payload.estimate_hours !== undefined) {
    patch.estimate_hours = asOptionalNonNegativeNumber(
      payload.estimate_hours,
      "estimate_hours",
      999,
    );
  }

  // Cross-field consistency: setting status to Blocked also flips the
  // boolean (and vice-versa) so the two never drift. The boolean is the
  // primary signal for the urgency classifier; the status is the primary
  // signal for filters and reports. Keeping them in sync keeps both right.
  const nextStatus = patch.status ?? existing.status;
  const nextBlocked = patch.blocked ?? existing.blocked;
  if (nextStatus === "Blocked" && !nextBlocked) {
    patch.blocked = true;
  }
  if (patch.blocked === true && nextStatus !== "Blocked") {
    // Flipping the boolean true does NOT auto-change the status — the user
    // might mark a task blocked while it's still "In Progress" pending a
    // dependency. We respect that distinction.
  }

  return patch;
}

// ---------------------------------------------------------------------------
// Public service surface
// ---------------------------------------------------------------------------

export async function createTask(
  payload: TaskCreatePayload,
  ctx: { createdBy: UserId; userName?: string | null },
): Promise<Task> {
  invalidateVelocityCache(); // Step 9 (Section 5.15): bust velocity cache.
  const input = await shapeCreate(payload, { userId: ctx.createdBy });
  // ctx.createdBy is also used as the `added_by` for any document_links
  // included on creation. Tasks themselves don't store a creator field
  // (Section 4.2); the link audit trail is the only place it's stamped.
  const task = await TaskRepository.create(input);

  // Step 7 (Section 5.12): notify the assignee. Self-assignment doesn't
  // notify — `notifyTaskAssigned` checks for that. Failures are swallowed
  // so a missing user or an offline mailer can't roll the task back.
  await fireTaskAssignedHook(task).catch((err) => {
    console.warn(
      `[notifications] createTask post-hook failed for ${task.task_id}:`,
      err,
    );
  });

  // Step 8 (Section 5.13): adding a task changes the project's task
  // roster, which is a primary input to the health score. Recalc the
  // parent project. Same fire-and-forget shape as the notification hook.
  await fireHealthRecalc(task.project_id).catch((err) => {
    console.warn(
      `[health] createTask post-hook failed for project ${task.project_id}:`,
      err,
    );
  });

  await audit({
    actorId: ctx.createdBy,
    actorName: ctx.userName,
    entityType: "Task",
    entityId: task.task_id,
    entityLabel: task.task_name,
    action: "create",
    summary: `Created task on project ${task.project_id} (${task.priority} priority, status ${task.status}).`,
  });

  return task;
}

export async function updateTask(
  id: TaskId,
  payload: TaskUpdatePayload,
  ctx: { userId: UserId; userName?: string | null } = { userId: "system" },
): Promise<Task> {
  invalidateVelocityCache(); // Step 9 (Section 5.15): bust velocity cache.
  const existing = await TaskRepository.getById(id);
  if (!existing) throw new NotFoundError(`Task ${id} not found.`);
  const patch = await shapeUpdate(existing, payload, ctx);

  // Comment history (Section 5.2 follow-up): each `comments` change
  // appends a snapshot to `comment_history` so the panel's Comments
  // tab can show "what was said when, by whom". Mirrors the project
  // status_history pattern. Skipped when the comment text didn't
  // actually change (e.g. a status-only patch); also skipped when
  // the new value equals the old value after trim, since a no-op
  // save shouldn't pollute the audit trail.
  if (
    patch.comments !== undefined &&
    patch.comments !== existing.comments
  ) {
    const entry: TaskCommentEntry = {
      changed_at: nowIsoTimestamp(),
      text: patch.comments,
      previous_text: existing.comments || null,
      changed_by: ctx.userId === "system" ? null : ctx.userId,
      changed_by_name: await resolveUserDisplayName(ctx.userId),
    };
    patch.comment_history = [...existing.comment_history, entry];
  }

  const updated = await TaskRepository.update(id, patch);

  // Step 7 (Section 5.12): if the primary assignee changed, fire a
  // TaskAssigned notification to the new owner. Reassignments to
  // additional_assignees are deliberately quieter — additional_assignees
  // are a roster, not a primary owner change.
  if (
    patch.responsible !== undefined &&
    patch.responsible !== existing.responsible
  ) {
    await fireTaskAssignedHook(updated).catch((err) => {
      console.warn(
        `[notifications] updateTask post-hook failed for ${id}:`,
        err,
      );
    });
  }

  // Step 8 (Section 5.13): every update to a task can shift the project's
  // health — status flips Blocked / Complete, target_date changes,
  // blocked-flag toggles all feed the calculator. We always recalc, even
  // for narrow patches like a comment change, because filtering would
  // miss edge cases (e.g. a stale `updated_at` field still moves the
  // last-activity inactivity check). Recalc is cheap; selectivity bugs
  // are not.
  await fireHealthRecalc(updated.project_id).catch((err) => {
    console.warn(
      `[health] updateTask post-hook failed for project ${updated.project_id}:`,
      err,
    );
  });

  // Audit. Distinguish a status-only change so the audit page can
  // chip-filter on transitions; everything else lands as a generic
  // `update` summarizing the diff.
  const statusFlipped =
    patch.status !== undefined && patch.status !== existing.status;
  const isStatusOnly =
    statusFlipped &&
    Object.keys(patch).every(
      (k) => k === "status" || k === "blocked" || k === "comment_history",
    );
  if (isStatusOnly) {
    await audit({
      actorId: ctx.userId,
      actorName: ctx.userName,
      entityType: "Task",
      entityId: id,
      entityLabel: updated.task_name,
      action: "status_change",
      summary: `Status: ${existing.status} → ${updated.status}`,
    });
  } else if (Object.keys(patch).length > 0) {
    await audit({
      actorId: ctx.userId,
      actorName: ctx.userName,
      entityType: "Task",
      entityId: id,
      entityLabel: updated.task_name,
      action: "update",
      summary: summarizeChanges(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
        {
          fields: [
            "task_name",
            "status",
            "priority",
            "responsible",
            "target_date",
            "blocked",
            "comments",
          ],
        },
      ),
    });
  }

  // If this update flipped the task INTO Complete, clear the block
  // on every downstream task whose `blocker_task_id` pointed at us.
  // The cascade only handles task→task blocks — project- and
  // free-text-blocker references are left alone since we can't
  // reason about when those are "resolved."
  const completedNow =
    patch.status === "Complete" && existing.status !== "Complete";
  if (completedNow) {
    await unblockDependentTasks(id, ctx).catch((err) => {
      console.warn(
        `[tasks] auto-unblock cascade failed for ${id}:`,
        err,
      );
    });
  }

  return updated;
}

/**
 * When a task transitions into `Complete`, walk every task whose
 * `blocker_task_id` references the just-completed task and clear
 * the block. Side effects per unblocked task:
 *
 *   - `blocked = false`
 *   - `blocker_type`, `blocker_task_id`, `blocker_issue_task`
 *     cleared (no longer relevant — the block is resolved)
 *   - If the downstream task was sitting at `status = "Blocked"`,
 *     bump it back to `"Not Started"` so the assignee notices it's
 *     actionable again. Other statuses are left alone (someone may
 *     have been working on the task despite the blocked flag).
 *   - Audit log entry attributing the change to the user who
 *     completed the blocker.
 *   - Health-score recalc on the downstream task's parent project
 *     (blocked-count is an input to the score).
 *
 * Failures on individual downstream tasks are logged and skipped;
 * one stuck row mustn't prevent the rest from being unblocked.
 */
async function unblockDependentTasks(
  completedTaskId: TaskId,
  ctx: { userId: UserId; userName?: string | null },
): Promise<void> {
  // PostgREST `.eq()` filter is the cheap way to find dependents.
  // We pull the full row because we need the existing status and
  // task_name for the patch + audit.
  const { getServiceRoleClient } = await import("@/lib/supabase/server");
  const { data, error } = await getServiceRoleClient()
    .from("tasks")
    .select("*")
    .eq("blocker_type", "task")
    .eq("blocker_task_id", completedTaskId);
  if (error) {
    console.warn(
      `[tasks] unblockDependentTasks lookup failed: ${error.message}`,
    );
    return;
  }
  const downstreams = (data ?? []) as Task[];
  if (downstreams.length === 0) return;

  for (const t of downstreams) {
    const patch: UpdateTaskInput = {
      blocked: false,
      blocker_type: null,
      blocker_task_id: null,
      blocker_issue_task: "",
    };
    if (t.status === "Blocked") {
      patch.status = "Not Started";
    }
    try {
      await TaskRepository.update(t.task_id, patch);
      await audit({
        actorId: ctx.userId,
        actorName: ctx.userName,
        entityType: "Task",
        entityId: t.task_id,
        entityLabel: t.task_name,
        action: "update",
        summary: `Auto-unblocked: blocking task ${completedTaskId} is now Complete.`,
      });
      await fireHealthRecalc(t.project_id);
    } catch (err) {
      console.warn(
        `[tasks] auto-unblock of ${t.task_id} (blocked by ${completedTaskId}) failed:`,
        err,
      );
    }
  }
}

export async function deleteTask(
  id: TaskId,
  ctx: { userId: UserId; userName?: string | null } = { userId: "system" },
): Promise<void> {
  invalidateVelocityCache(); // Step 9 (Section 5.15): bust velocity cache.
  const existing = await TaskRepository.getById(id);
  if (!existing) throw new NotFoundError(`Task ${id} not found.`);
  await TaskRepository.delete(id);
  // Step 8: removing a task changes the project's denominator for the
  // blocked-or-overdue percentage. Recalc the parent.
  await fireHealthRecalc(existing.project_id).catch((err) => {
    console.warn(
      `[health] deleteTask post-hook failed for project ${existing.project_id}:`,
      err,
    );
  });
  await audit({
    actorId: ctx.userId,
    actorName: ctx.userName,
    entityType: "Task",
    entityId: id,
    entityLabel: existing.task_name,
    action: "delete",
    summary: `Deleted task "${existing.task_name}" from project ${existing.project_id}.`,
  });
}

// ---------------------------------------------------------------------------
// Template instantiation (Section 5.19, Section 9 Step 4)
// ---------------------------------------------------------------------------

/**
 * Create a fresh task per item in the named template, attached to the
 * given project. Sequential awaits — NOT Promise.all — because the JSON
 * repo allocates IDs by reading max+1, and parallel writes would collide
 * on identical IDs. (When swapped to a database with auto-increment IDs,
 * this can become Promise.all without semantic change.)
 *
 * Defaults applied:
 *   - status     `"Not Started"`
 *   - responsible      project's `project_lead`, falling back to "" if unset
 *   - target_date      null
 *   - blocked          false
 *   - template_id      the template ID, so deletions and reporting can
 *                      tie tasks back to their origin
 */
export async function instantiateTemplate(
  templateId: TemplateId,
  projectId: ProjectId,
): Promise<Task[]> {
  const template = await TemplateRepository.getById(templateId);
  if (!template) {
    throw new NotFoundError(`Template ${templateId} not found.`);
  }
  const project = await ProjectRepository.getById(projectId);
  if (!project) {
    throw new NotFoundError(`Project ${projectId} not found.`);
  }

  const created: Task[] = [];
  for (const item of template.tasks) {
    const task = await TaskRepository.create({
      project_id: projectId,
      task_name: item.name,
      detailed_description: item.description,
      status: "Not Started",
      priority: item.default_priority,
      responsible: project.project_lead || "",
      additional_assignees: [],
      target_date: null,
      blocked: false,
      blocker_issue_task: "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
      document_links: [],
      template_id: templateId,
    });
    created.push(task);

    // Step 7 (Section 5.12): notify the project lead per template task.
    // The lead is the default `responsible` here, so they get N
    // TaskAssigned messages — one per template task. That looks
    // chatty but it's accurate; the user can mark them all read in
    // one click via the bell drawer.
    await fireTaskAssignedHook(task).catch((err) => {
      console.warn(
        `[notifications] instantiateTemplate post-hook failed for ${task.task_id}:`,
        err,
      );
    });
  }

  // Step 8 (Section 5.13): one recalc at the end, not per-task. Each task
  // creation already triggers a recalc inside `createTask`, but we use
  // `TaskRepository.create` directly here (not `createTask`) to skip
  // those per-task hooks — running N recalcs in a row would write to
  // projects.json N times for a single conceptual operation. The final
  // recalc here picks up the full new task roster in one shot.
  if (created.length > 0) {
    await fireHealthRecalc(projectId).catch((err) => {
      console.warn(
        `[health] instantiateTemplate post-hook failed for project ${projectId}:`,
        err,
      );
    });
  }
  return created;
}

// ---------------------------------------------------------------------------
// Step 7 — notification hook (Section 5.12)
// ---------------------------------------------------------------------------

/**
 * Lookup the parent project (best-effort) and dispatch a `TaskAssigned`
 * notification to the task's primary assignee. Dynamic import keeps the
 * notification module out of the import graph for the type-only build
 * paths and breaks a potential cycle (the notification service imports
 * `lib/db` repositories which the task service also uses).
 */
async function fireTaskAssignedHook(task: Task): Promise<void> {
  const { notifyTaskAssigned } = await import(
    "@/lib/notifications/service"
  );
  // The project lookup is cheap (single in-memory file read) and the
  // helper falls back to the project_id if the project record is missing,
  // so we always pass `null` when the lookup fails rather than skipping.
  let project: Awaited<ReturnType<typeof ProjectRepository.getById>> = null;
  try {
    project = await ProjectRepository.getById(task.project_id);
  } catch {
    project = null;
  }
  await notifyTaskAssigned(task, project);
}

// ---------------------------------------------------------------------------
// Step 8 — health-score recalc hook (Section 5.13)
// ---------------------------------------------------------------------------

/**
 * Recompute the parent project's health score after a task write.
 * Tasks are the primary input to the score (blocked-or-overdue counts,
 * last-activity tracking, open-task percentage), so every task create /
 * update / delete needs to run this hook to keep the project's badge
 * truthful.
 *
 * Dynamic import for the same reasons as `fireTaskAssignedHook`:
 *   - keeps the health module out of the import graph for type-only
 *     build paths;
 *   - breaks a potential cycle (health imports `lib/db`, which the
 *     task service also uses).
 *
 * Failures are caught at the call site so a recalc bug can never roll
 * back the underlying task save.
 */
async function fireHealthRecalc(projectId: ProjectId): Promise<void> {
  const { recalculateAndPersist } = await import("@/lib/health");
  await recalculateAndPersist(projectId);
}
