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
  type TaskTemplate,
  type TaskTemplateItem,
  type TemplateId,
  type UserId,
} from "@/lib/db";
import { PROJECT_TYPES } from "@/lib/projects/display";

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

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

  const tasks: TaskTemplateItem[] = payload.tasks.map((raw, i) => {
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
    return {
      name: item.name.trim(),
      description,
      default_priority: item.default_priority as Priority,
    };
  });

  return { template_name, project_types, tasks };
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
