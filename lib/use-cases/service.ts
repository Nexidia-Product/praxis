/**
 * Use case service.
 *
 * API routes never call UseCaseRepository directly: validation, audit
 * emission, and the project-delete pruning hook live here. Access control
 * (`usecases.manage`, Admin-only by default) is enforced at the route
 * layer; this module trusts its callers and enforces data-shape rules.
 */

import {
  ProjectRepository,
  UseCaseRepository,
  type ProjectId,
  type UseCase,
  type UseCaseId,
  type UserId,
} from "@/lib/db";
import { audit } from "@/lib/audit/service";
import { OBJECTIVES, SECONDARY_OBJECTIVE_OPTIONS } from "@/lib/projects/display";

const MAX_NAME_LEN = 200;
const MAX_DESCRIPTION_LEN = 4000;
const MAX_MEMBERS = 500;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UseCaseValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "UseCaseNotFoundError";
  }
}

export interface UseCasePayload {
  name?: unknown;
  description?: unknown;
  primary_objective?: unknown;
  secondary_objectives?: unknown;
  member_project_ids?: unknown;
}

interface ActorCtx {
  userId: UserId;
  userName: string | null;
}

export async function createUseCase(
  payload: UseCasePayload,
  actor: ActorCtx,
): Promise<UseCase> {
  const name = validateName(payload.name);
  const description = validateDescription(payload.description);
  const primary = validatePrimary(payload.primary_objective, true);
  const secondary = validateSecondary(payload.secondary_objectives, primary);
  const members = await validateMembers(payload.member_project_ids, null);

  const created = await UseCaseRepository.create({
    name,
    description,
    primary_objective: primary,
    secondary_objectives: secondary,
    member_project_ids: members,
    created_by: actor.userId,
  });

  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings", // no UseCase audit entity type; same as groups
    entityId: created.use_case_id,
    entityLabel: `Use case: ${created.name}`,
    action: "create",
    summary: `Created use case "${created.name}" (primary: ${primary}, ${secondary.length} secondary, ${members.length} project(s)).`,
  });
  return created;
}

export async function updateUseCase(
  id: UseCaseId,
  payload: UseCasePayload,
  actor: ActorCtx,
): Promise<UseCase> {
  const before = await UseCaseRepository.getById(id);
  if (!before) throw new NotFoundError(`Use case ${id} not found.`);

  const patch: Record<string, unknown> = {};
  if (payload.name !== undefined) patch.name = validateName(payload.name);
  if (payload.description !== undefined) {
    patch.description = validateDescription(payload.description);
  }
  // Primary/secondary are validated together against the resulting
  // values, so changing the primary to something already in the stored
  // secondaries (or vice versa) is caught.
  if (
    payload.primary_objective !== undefined ||
    payload.secondary_objectives !== undefined
  ) {
    const primary =
      payload.primary_objective !== undefined
        ? validatePrimary(payload.primary_objective, true)
        : before.primary_objective;
    const secondary = validateSecondary(
      payload.secondary_objectives !== undefined
        ? payload.secondary_objectives
        : before.secondary_objectives,
      primary,
    );
    patch.primary_objective = primary;
    patch.secondary_objectives = secondary;
  }
  if (payload.member_project_ids !== undefined) {
    patch.member_project_ids = await validateMembers(
      payload.member_project_ids,
      id,
    );
  }
  if (Object.keys(patch).length === 0) return before;

  const after = await UseCaseRepository.update(id, patch);
  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings",
    entityId: after.use_case_id,
    entityLabel: `Use case: ${after.name}`,
    action: "update",
    summary: summarizeChange(before, after),
  });
  return after;
}

export async function deleteUseCase(
  id: UseCaseId,
  actor: ActorCtx,
): Promise<void> {
  const existing = await UseCaseRepository.getById(id);
  if (!existing) throw new NotFoundError(`Use case ${id} not found.`);
  await UseCaseRepository.delete(id);
  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings",
    entityId: id,
    entityLabel: `Use case: ${existing.name}`,
    action: "delete",
    summary: `Deleted use case "${existing.name}" (${existing.member_project_ids.length} project(s)).`,
  });
}

/** Called from `lib/projects/service.deleteProject`. */
export async function pruneProjectFromUseCases(
  projectId: ProjectId,
): Promise<void> {
  await UseCaseRepository.pruneProjectFromAll(projectId);
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function validateName(raw: unknown): string {
  if (typeof raw !== "string") throw new ValidationError("name must be a string.");
  const trimmed = raw.trim();
  if (trimmed === "") throw new ValidationError("name is required.");
  if (trimmed.length > MAX_NAME_LEN) {
    throw new ValidationError(`name must be ${MAX_NAME_LEN} characters or fewer.`);
  }
  return trimmed;
}

function validateDescription(raw: unknown): string {
  if (raw === undefined || raw === null) return "";
  if (typeof raw !== "string") {
    throw new ValidationError("description must be a string.");
  }
  const trimmed = raw.trim();
  if (trimmed.length > MAX_DESCRIPTION_LEN) {
    throw new ValidationError(
      `description must be ${MAX_DESCRIPTION_LEN} characters or fewer.`,
    );
  }
  return trimmed;
}

function validatePrimary(raw: unknown, required: boolean): string | null {
  if (raw === undefined || raw === null || raw === "") {
    if (required) throw new ValidationError("primary_objective is required.");
    return null;
  }
  if (typeof raw !== "string" || !OBJECTIVES.includes(raw)) {
    throw new ValidationError(
      `Unknown primary_objective ${JSON.stringify(raw)}. Allowed: ${OBJECTIVES.join(", ")}.`,
    );
  }
  return raw;
}

function validateSecondary(raw: unknown, primary: string | null): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError("secondary_objectives must be an array.");
  }
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string" || !SECONDARY_OBJECTIVE_OPTIONS.includes(v)) {
      throw new ValidationError(
        `Invalid secondary objective ${JSON.stringify(v)}. Allowed: ${SECONDARY_OBJECTIVE_OPTIONS.join(", ")}.`,
      );
    }
    if (v === primary) {
      throw new ValidationError(
        "secondary_objectives must not repeat the primary objective.",
      );
    }
    if (!out.includes(v)) out.push(v);
  }
  return out;
}

/**
 * `selfId` is the use case being updated (null on create). A project may
 * belong to only one use case, so any ID already held by a *different*
 * use case is rejected.
 */
async function validateMembers(
  raw: unknown,
  selfId: UseCaseId | null,
): Promise<ProjectId[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError("member_project_ids must be an array.");
  }
  if (raw.length > MAX_MEMBERS) {
    throw new ValidationError(
      `A use case can contain at most ${MAX_MEMBERS} projects.`,
    );
  }
  const ids: ProjectId[] = [];
  for (const v of raw) {
    if (typeof v !== "string") {
      throw new ValidationError(
        "member_project_ids entries must be strings (project IDs).",
      );
    }
    const trimmed = v.trim();
    if (trimmed !== "" && !ids.includes(trimmed)) ids.push(trimmed);
  }
  if (ids.length === 0) return [];

  const all = await ProjectRepository.getAll();
  const known = new Set(all.map((p) => p.project_id));
  const missing = ids.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new ValidationError(`Unknown project ID(s): ${missing.join(", ")}.`);
  }

  const owners = new Map<string, string>();
  for (const uc of await UseCaseRepository.getAll()) {
    if (uc.use_case_id === selfId) continue;
    for (const pid of uc.member_project_ids) owners.set(pid, uc.name);
  }
  const taken = ids.filter((id) => owners.has(id));
  if (taken.length > 0) {
    throw new ValidationError(
      `A project can belong to only one use case. Already assigned: ${taken
        .map((id) => `${id} (${owners.get(id)})`)
        .join(", ")}.`,
    );
  }
  return ids;
}

function summarizeChange(before: UseCase, after: UseCase): string {
  const parts: string[] = [];
  if (before.name !== after.name) {
    parts.push(`name: "${before.name}" → "${after.name}"`);
  }
  if (before.description !== after.description) parts.push("description updated");
  if (before.primary_objective !== after.primary_objective) {
    parts.push(
      `primary objective: ${before.primary_objective ?? "none"} → ${after.primary_objective ?? "none"}`,
    );
  }
  const secAdded = after.secondary_objectives.filter(
    (o) => !before.secondary_objectives.includes(o),
  );
  const secRemoved = before.secondary_objectives.filter(
    (o) => !after.secondary_objectives.includes(o),
  );
  if (secAdded.length > 0) {
    parts.push(`secondary objectives added: ${secAdded.join(", ")}`);
  }
  if (secRemoved.length > 0) {
    parts.push(`secondary objectives removed: ${secRemoved.join(", ")}`);
  }
  const added = after.member_project_ids.filter(
    (id) => !before.member_project_ids.includes(id),
  );
  const removed = before.member_project_ids.filter(
    (id) => !after.member_project_ids.includes(id),
  );
  if (added.length > 0) parts.push(`projects added: ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`projects removed: ${removed.join(", ")}`);
  return parts.length > 0
    ? parts.join("; ")
    : `Use case "${after.name}" saved (no changes).`;
}
