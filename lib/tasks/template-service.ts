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
  type Priority,
  type ProjectType,
  type TaskDependencyType,
  type TaskTemplate,
  type TaskTemplateItem,
  type TemplateDependency,
  type TemplateId,
  type UserId,
} from "@/lib/db";
import { PROJECT_TYPES } from "@/lib/projects/display";

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];
const TASK_DEPENDENCY_TYPES: TaskDependencyType[] = ["FS", "SS", "FF", "SF"];

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
  /**
   * Multi-type form (preferred). Replaces the original
   * `project_type` (single) — see migration 0008. Kept the legacy
   * field as optional so a payload from a stale client still
   * round-trips as a single-element array.
   */
  project_types?: unknown;
  /** Legacy single-value form. Coerced to [project_type] when present. */
  project_type?: unknown;
  tasks?: unknown;
}

interface ValidatedTemplate {
  template_name: string;
  project_types: ProjectType[];
  tasks: TaskTemplateItem[];
}

function validate(payload: TemplatePayload): ValidatedTemplate {
  if (typeof payload.template_name !== "string") {
    throw new ValidationError("template_name must be a string.");
  }
  const template_name = payload.template_name.trim();
  if (!template_name) {
    throw new ValidationError("template_name is required.");
  }

  // Accept either `project_types` (multi) or the legacy `project_type`
  // (single). The legacy field is silently lifted into a one-element
  // array so old clients/scripts keep working.
  let rawTypes: unknown = payload.project_types;
  if (rawTypes === undefined && typeof payload.project_type === "string") {
    rawTypes = [payload.project_type];
  }
  if (!Array.isArray(rawTypes) || rawTypes.length === 0) {
    throw new ValidationError(
      "project_types must be a non-empty array of project type strings.",
    );
  }
  const project_types: ProjectType[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawTypes.length; i++) {
    const v = rawTypes[i];
    if (typeof v !== "string") {
      throw new ValidationError(`project_types[${i}] must be a string.`);
    }
    if (!(PROJECT_TYPES as readonly string[]).includes(v)) {
      throw new ValidationError(
        `project_types[${i}] must be one of: ${PROJECT_TYPES.join(", ")}.`,
      );
    }
    if (seen.has(v)) continue;
    seen.add(v);
    project_types.push(v as ProjectType);
  }

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

    rawDependencyLists.push(item.dependencies);

    tasks.push({
      local_id,
      name: item.name.trim(),
      description,
      default_priority: item.default_priority as Priority,
      estimate_hours,
      // Filled in by the second pass once every local_id is known.
      dependencies: [],
    });
  }

  // Second pass: dependencies. We needed every local_id collected
  // first so a predecessor reference can point at any other row
  // regardless of order in the array.
  for (let i = 0; i < tasks.length; i++) {
    tasks[i].dependencies = parseDependencies(
      rawDependencyLists[i],
      tasks[i].local_id,
      localIds,
      i,
    );
  }

  // Cycle detection across the full dependency graph. Mirrors the
  // runtime task-cycle check at lib/tasks/service.ts — DFS from each
  // node, refuse if we can reach the start again.
  detectCycles(tasks);

  return { template_name, project_types, tasks };
}

/**
 * Coerce + validate an `estimate_hours` value. Accepts:
 *   - undefined / null / "" → null (no estimate)
 *   - number (must be finite, >= 0, <= 999)
 *   - numeric string (parsed; same bounds)
 *
 * Mirrors `asOptionalNonNegativeNumber` in `lib/tasks/service.ts`. Duplicated
 * here so this validator stays self-contained.
 */
function parseEstimateHours(value: unknown, taskIndex: number): number | null {
  if (value === undefined || value === null || value === "") return null;
  let n: number;
  if (typeof value === "number") {
    n = value;
  } else if (typeof value === "string") {
    n = Number(value);
  } else {
    throw new ValidationError(
      `tasks[${taskIndex}].estimate_hours must be a number or null.`,
    );
  }
  if (!Number.isFinite(n) || n < 0 || n > ESTIMATE_HOURS_MAX) {
    throw new ValidationError(
      `tasks[${taskIndex}].estimate_hours must be between 0 and ${ESTIMATE_HOURS_MAX}.`,
    );
  }
  return n;
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
    adjacency.set(
      t.local_id,
      t.dependencies.map((d) => d.predecessor_local_id),
    );
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
  const v = validate(payload);
  return TemplateRepository.create({
    template_name: v.template_name,
    project_types: v.project_types,
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
  const v = validate(payload);
  // Preserve `created_by` — original author is part of the audit trail and
  // is not a field the editor surfaces.
  return TemplateRepository.update(id, {
    template_name: v.template_name,
    project_types: v.project_types,
    tasks: v.tasks,
  });
}

export async function deleteTemplate(id: TemplateId): Promise<void> {
  const existing = await TemplateRepository.getById(id);
  if (!existing) throw new NotFoundError(`Template ${id} not found.`);
  return TemplateRepository.delete(id);
}
