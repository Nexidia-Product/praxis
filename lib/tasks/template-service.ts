/**
 * Task-template service layer (Section 4.3, Section 5.19).
 *
 * Templates are admin-only — the `admin.templates.manage` permission gates every API route
 * that calls into here. The service still validates inbound payloads so
 * a malformed body produces a clear 400 rather than a corrupted record.
 *
 * The editor sends the full template on save (PUT semantics, not PATCH),
 * so `updateTemplate` accepts the same shape as `createTemplate` and
 * replaces the record wholesale — minus `template_id` and `created_by`,
 * which are immutable.
 */

import {
  TemplateRepository,
  type DrivenProjectDateField,
  type Priority,
  type TaskDependencyType,
  type TaskTemplate,
  type TaskTemplateItem,
  type TemplateDependency,
  type TemplateId,
  type UserId,
} from "@/lib/db";
import { stagesForTrack } from "@/lib/projects/display";
import { getEnumOptions } from "@/lib/projects/enum-options";

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];
const TASK_DEPENDENCY_TYPES: TaskDependencyType[] = ["FS", "SS", "FF", "SF"];
const DRIVEN_PROJECT_DATE_FIELDS: DrivenProjectDateField[] = [
  "target_date",
  "target_executable_deployment_date",
];

/** Cap on estimate_hours — matches the runtime task validator. 999h ≈ 6 months. */
const ESTIMATE_HOURS_MAX = 999;

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

export interface TemplatePayload {
  template_name?: unknown;
  /** Multi-select — replaces the original `project_types`. Must be non-empty. */
  tracks?: unknown;
  tasks?: unknown;
}

interface ValidatedTemplate {
  template_name: string;
  tracks: string[];
  tasks: TaskTemplateItem[];
}

function validate(
  payload: TemplatePayload,
  validTrackIds: readonly string[],
): ValidatedTemplate {
  if (typeof payload.template_name !== "string") {
    throw new ValidationError("template_name must be a string.");
  }
  const template_name = payload.template_name.trim();
  if (!template_name) {
    throw new ValidationError("template_name is required.");
  }

  if (!Array.isArray(payload.tracks) || payload.tracks.length === 0) {
    throw new ValidationError(
      "tracks must be a non-empty array of track ids.",
    );
  }
  const tracks: string[] = [];
  const seenTracks = new Set<string>();
  for (let i = 0; i < payload.tracks.length; i++) {
    const v = payload.tracks[i];
    if (typeof v !== "string") {
      throw new ValidationError(`tracks[${i}] must be a string.`);
    }
    if (!validTrackIds.includes(v)) {
      throw new ValidationError(
        `tracks[${i}] must be one of: ${validTrackIds.join(", ")}.`,
      );
    }
    if (seenTracks.has(v)) continue;
    seenTracks.add(v);
    tracks.push(v);
  }

  // Every task's `stage` is validated against the union of stages
  // across this template's own tracks — the only validation boundary
  // available at authoring time (the destination project isn't known
  // until instantiation).
  const validStages = new Set(tracks.flatMap((t) => stagesForTrack(t)));

  if (!Array.isArray(payload.tasks)) {
    throw new ValidationError("tasks must be an array.");
  }
  if (payload.tasks.length === 0) {
    throw new ValidationError("Template must have at least one task.");
  }

  // First pass: shape and basic-field validation. local_ids are
  // collected as we go so the dependency pass can verify references
  // resolve inside this template.
  const tasks: TaskTemplateItem[] = [];
  const localIds = new Set<string>();
  const rawDependencyLists: unknown[] = [];
  const rawFixedLags: unknown[] = [];

  for (let i = 0; i < payload.tasks.length; i++) {
    const raw = payload.tasks[i];
    if (typeof raw !== "object" || raw === null) {
      throw new ValidationError(`tasks[${i}] must be an object.`);
    }
    const item = raw as Record<string, unknown>;
    if (typeof item.name !== "string" || !item.name.trim()) {
      throw new ValidationError(`tasks[${i}].name is required.`);
    }
    const description =
      typeof item.description === "string" ? item.description : "";
    if (
      typeof item.default_priority !== "string" ||
      !(PRIORITIES as readonly string[]).includes(item.default_priority)
    ) {
      throw new ValidationError(
        `tasks[${i}].default_priority must be one of: ${PRIORITIES.join(", ")}.`,
      );
    }
    if (typeof item.stage !== "string" || !validStages.has(item.stage)) {
      throw new ValidationError(
        `tasks[${i}].stage must be one of: ${Array.from(validStages).join(", ")} (the union of stages across this template's tracks).`,
      );
    }
    const default_responsible =
      typeof item.default_responsible === "string" &&
      item.default_responsible.trim()
        ? item.default_responsible.trim()
        : null;

    // Backfill local_id for rows saved before this field existed.
    // We use crypto.randomUUID() (Node 19+, available in every runtime
    // we target) rather than a counter so two concurrent re-saves of
    // the same legacy template can't collide.
    const local_id =
      typeof item.local_id === "string" && item.local_id.trim()
        ? item.local_id.trim()
        : crypto.randomUUID();
    if (localIds.has(local_id)) {
      throw new ValidationError(
        `tasks[${i}].local_id "${local_id}" is duplicated within the template.`,
      );
    }
    localIds.add(local_id);

    const estimate_hours = parseEstimateHours(item.estimate_hours, i);
    const complexity_estimate_hours = parseComplexityOverrides(
      item.complexity_estimate_hours,
      i,
    );
    const friday_anchor =
      item.friday_anchor === undefined ? false : asBoolean(item.friday_anchor, i);
    const drives_project_date = parseDrivesProjectDate(item.drives_project_date, i);

    rawDependencyLists.push(item.dependencies);
    rawFixedLags.push(item.fixed_lag_business_days_after);

    tasks.push({
      local_id,
      name: item.name.trim(),
      description,
      default_priority: item.default_priority as Priority,
      stage: item.stage,
      default_responsible,
      estimate_hours,
      complexity_estimate_hours,
      friday_anchor,
      drives_project_date,
      // Filled in by the second pass once every local_id is known.
      fixed_lag_business_days_after: null,
      dependencies: [],
    });
  }

  // Second pass: dependencies and fixed-lag references. We needed every
  // local_id collected first so a reference can point at any other row
  // regardless of order in the array.
  for (let i = 0; i < tasks.length; i++) {
    tasks[i].dependencies = parseDependencies(
      rawDependencyLists[i],
      tasks[i].local_id,
      localIds,
      i,
    );
    tasks[i].fixed_lag_business_days_after = parseFixedLag(
      rawFixedLags[i],
      tasks[i].local_id,
      localIds,
      i,
    );
  }

  // Cycle detection across the full dependency graph. Mirrors the
  // runtime task-cycle check at lib/tasks/service.ts — DFS from each
  // node, refuse if we can reach the start again.
  detectCycles(tasks);

  return { template_name, tracks, tasks };
}

/**
 * Coerce + validate a required `estimate_hours` value. Accepts a number or
 * numeric string, >= 0, <= 999. Unlike the runtime `Task` field, a template
 * task's estimate has no legacy-data exception — it drives the
 * instantiated task's due-date calculation (`lib/tasks/schedule.ts`), so
 * it can't be left blank.
 *
 * Bounds mirror `asOptionalNonNegativeNumber` in `lib/tasks/service.ts`.
 * Duplicated here so this validator stays self-contained.
 */
function parseEstimateHours(value: unknown, taskIndex: number): number {
  if (value === undefined || value === null || value === "") {
    throw new ValidationError(`tasks[${taskIndex}].estimate_hours is required.`);
  }
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value);
  } else {
    throw new ValidationError(
      `tasks[${taskIndex}].estimate_hours must be a number.`,
    );
  }
  if (!Number.isFinite(n) || n < 0 || n > ESTIMATE_HOURS_MAX) {
    throw new ValidationError(
      `tasks[${taskIndex}].estimate_hours must be between 0 and ${ESTIMATE_HOURS_MAX}.`,
    );
  }
  return n;
}

const COMPLEXITY_TIERS = ["Low", "High"] as const;

/**
 * Coerce + validate the optional per-complexity-tier override map. Absent/
 * null → `null` (no overrides, the common case). Only `Low`/`High` keys are
 * recognized — `estimate_hours` itself already represents the Medium
 * value, so there's no separate "Medium override" to store.
 */
function parseComplexityOverrides(
  value: unknown,
  taskIndex: number,
): Partial<Record<"Low" | "High", number>> | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "object" || Array.isArray(value)) {
    throw new ValidationError(
      `tasks[${taskIndex}].complexity_estimate_hours must be an object.`,
    );
  }
  const raw = value as Record<string, unknown>;
  const out: Partial<Record<"Low" | "High", number>> = {};
  for (const key of Object.keys(raw)) {
    if (!(COMPLEXITY_TIERS as readonly string[]).includes(key)) {
      throw new ValidationError(
        `tasks[${taskIndex}].complexity_estimate_hours key "${key}" must be one of: ${COMPLEXITY_TIERS.join(", ")}.`,
      );
    }
    const raw_v = raw[key];
    if (raw_v === undefined || raw_v === null || raw_v === "") continue;
    let n: number;
    if (typeof raw_v === "number") {
      n = raw_v;
    } else if (typeof raw_v === "string") {
      n = Number(raw_v);
    } else {
      throw new ValidationError(
        `tasks[${taskIndex}].complexity_estimate_hours.${key} must be a number.`,
      );
    }
    if (!Number.isFinite(n) || n < 0 || n > ESTIMATE_HOURS_MAX) {
      throw new ValidationError(
        `tasks[${taskIndex}].complexity_estimate_hours.${key} must be between 0 and ${ESTIMATE_HOURS_MAX}.`,
      );
    }
    out[key as "Low" | "High"] = n;
  }
  return Object.keys(out).length > 0 ? out : null;
}

/**
 * Validate a single task's `dependencies` array. Verifies that:
 *   - it's an array (or absent)
 *   - each entry has a string `predecessor_local_id` and a recognized type
 *   - the predecessor exists in this template
 *   - the predecessor isn't the task itself
 *   - duplicates of (predecessor_local_id, type) collapse to one entry
 */
function parseDependencies(
  raw: unknown,
  selfLocalId: string,
  knownLocalIds: Set<string>,
  taskIndex: number,
): TemplateDependency[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError(
      `tasks[${taskIndex}].dependencies must be an array.`,
    );
  }
  const seen = new Set<string>();
  const out: TemplateDependency[] = [];
  for (let j = 0; j < raw.length; j++) {
    const entry = raw[j];
    if (typeof entry !== "object" || entry === null) {
      throw new ValidationError(
        `tasks[${taskIndex}].dependencies[${j}] must be an object.`,
      );
    }
    const e = entry as Record<string, unknown>;
    if (
      typeof e.predecessor_local_id !== "string" ||
      !e.predecessor_local_id.trim()
    ) {
      throw new ValidationError(
        `tasks[${taskIndex}].dependencies[${j}].predecessor_local_id is required.`,
      );
    }
    const predecessor_local_id = e.predecessor_local_id.trim();
    if (predecessor_local_id === selfLocalId) {
      throw new ValidationError(
        `tasks[${taskIndex}] cannot depend on itself.`,
      );
    }
    if (!knownLocalIds.has(predecessor_local_id)) {
      throw new ValidationError(
        `tasks[${taskIndex}].dependencies[${j}] references unknown predecessor_local_id "${predecessor_local_id}".`,
      );
    }
    if (
      typeof e.type !== "string" ||
      !(TASK_DEPENDENCY_TYPES as readonly string[]).includes(e.type)
    ) {
      throw new ValidationError(
        `tasks[${taskIndex}].dependencies[${j}].type must be one of: ${TASK_DEPENDENCY_TYPES.join(", ")}.`,
      );
    }
    const key = `${predecessor_local_id}|${e.type}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({
      predecessor_local_id,
      type: e.type as TaskDependencyType,
    });
  }
  return out;
}

function asBoolean(value: unknown, taskIndex: number): boolean {
  if (typeof value === "boolean") return value;
  throw new ValidationError(`tasks[${taskIndex}].friday_anchor must be a boolean.`);
}

function parseDrivesProjectDate(
  value: unknown,
  taskIndex: number,
): DrivenProjectDateField | null {
  if (value === undefined || value === null || value === "") return null;
  if (
    typeof value !== "string" ||
    !(DRIVEN_PROJECT_DATE_FIELDS as readonly string[]).includes(value)
  ) {
    throw new ValidationError(
      `tasks[${taskIndex}].drives_project_date must be one of: ${DRIVEN_PROJECT_DATE_FIELDS.join(", ")}, or null.`,
    );
  }
  return value as DrivenProjectDateField;
}

/**
 * Validate the optional fixed-lag override. Same existence/self-reference
 * rules as a dependency's predecessor, plus a positive business-day count.
 */
function parseFixedLag(
  raw: unknown,
  selfLocalId: string,
  knownLocalIds: Set<string>,
  taskIndex: number,
): { predecessor_local_id: string; business_days: number } | null {
  if (raw === undefined || raw === null) return null;
  if (typeof raw !== "object") {
    throw new ValidationError(
      `tasks[${taskIndex}].fixed_lag_business_days_after must be an object or null.`,
    );
  }
  const e = raw as Record<string, unknown>;
  if (
    typeof e.predecessor_local_id !== "string" ||
    !e.predecessor_local_id.trim()
  ) {
    throw new ValidationError(
      `tasks[${taskIndex}].fixed_lag_business_days_after.predecessor_local_id is required.`,
    );
  }
  const predecessor_local_id = e.predecessor_local_id.trim();
  if (predecessor_local_id === selfLocalId) {
    throw new ValidationError(
      `tasks[${taskIndex}] cannot be fixed-lag relative to itself.`,
    );
  }
  if (!knownLocalIds.has(predecessor_local_id)) {
    throw new ValidationError(
      `tasks[${taskIndex}].fixed_lag_business_days_after references unknown predecessor_local_id "${predecessor_local_id}".`,
    );
  }
  const n = typeof e.business_days === "number" ? e.business_days : Number(e.business_days);
  if (!Number.isFinite(n) || n <= 0 || n > 999) {
    throw new ValidationError(
      `tasks[${taskIndex}].fixed_lag_business_days_after.business_days must be a positive number (<= 999).`,
    );
  }
  return { predecessor_local_id, business_days: n };
}

/**
 * DFS over the template's dependency graph. Each task points at its
 * predecessors, so a cycle means "this task is, transitively, its own
 * predecessor." We refuse to save in that case — at instantiation time the
 * cycle would produce a dead-locked set of tasks where nothing can ever
 * leave "Awaiting Dependency."
 */
function detectCycles(tasks: TaskTemplateItem[]): void {
  const adjacency = new Map<string, string[]>();
  for (const t of tasks) {
    const edges = t.dependencies.map((d) => d.predecessor_local_id);
    if (t.fixed_lag_business_days_after) {
      edges.push(t.fixed_lag_business_days_after.predecessor_local_id);
    }
    adjacency.set(t.local_id, edges);
  }
  const onPath = new Set<string>();
  const done = new Set<string>();
  const stack: string[] = [];

  function dfs(node: string): string[] | null {
    if (onPath.has(node)) {
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (done.has(node)) return null;
    onPath.add(node);
    stack.push(node);
    for (const next of adjacency.get(node) ?? []) {
      const cycle = dfs(next);
      if (cycle) return cycle;
    }
    onPath.delete(node);
    done.add(node);
    stack.pop();
    return null;
  }

  for (const t of tasks) {
    const cycle = dfs(t.local_id);
    if (cycle) {
      // Map local_ids back to task names so the error message is
      // useful in the editor — local_ids are opaque to humans.
      const nameByLocalId = new Map(tasks.map((x) => [x.local_id, x.name]));
      const path = cycle
        .map((id) => nameByLocalId.get(id) ?? id)
        .join(" → ");
      throw new ValidationError(
        `Template has a dependency cycle: ${path}`,
      );
    }
  }
}

export async function createTemplate(
  payload: TemplatePayload,
  ctx: { createdBy: UserId },
): Promise<TaskTemplate> {
  const validTrackIds = (await getEnumOptions("track")).map((o) => o.id);
  const v = validate(payload, validTrackIds);
  return TemplateRepository.create({
    template_name: v.template_name,
    tracks: v.tracks,
    tasks: v.tasks,
    created_by: ctx.createdBy,
  });
}

export async function updateTemplate(
  id: TemplateId,
  payload: TemplatePayload,
): Promise<TaskTemplate> {
  const existing = await TemplateRepository.getById(id);
  if (!existing) throw new NotFoundError(`Template ${id} not found.`);
  const validTrackIds = (await getEnumOptions("track")).map((o) => o.id);
  const v = validate(payload, validTrackIds);
  // Preserve `created_by` — original author is part of the audit trail and
  // is not a field the editor surfaces.
  return TemplateRepository.update(id, {
    template_name: v.template_name,
    tracks: v.tracks,
    tasks: v.tasks,
  });
}

export async function deleteTemplate(id: TemplateId): Promise<void> {
  const existing = await TemplateRepository.getById(id);
  if (!existing) throw new NotFoundError(`Template ${id} not found.`);
  return TemplateRepository.delete(id);
}
