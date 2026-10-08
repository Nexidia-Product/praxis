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
import { randomUUID } from "node:crypto";
import {
  normalizeUseCaseOutcomes,
  reconcileOutcomeLinks,
} from "@/lib/use-cases/outcomes";

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
  /**
   * Outcomes the use case is meant to achieve: `[{ id?, text }]`. Existing
   * ids are kept (project picks reference them); new entries get an id.
   * Omit to leave the stored outcomes untouched.
   */
  outcomes?: unknown;
  /**
   * When true, projects in `member_project_ids` that currently belong to
   * a different use case are moved here (removed from the old one)
   * instead of being rejected. Used to correct a wrong assignment.
   */
  move_projects?: unknown;
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
  const move = payload.move_projects === true;
  const members = await validateMembers(payload.member_project_ids, null, move);
  const outcomes = validateOutcomes(payload.outcomes);

  const created = await UseCaseRepository.create({
    name,
    description,
    primary_objective: primary,
    secondary_objectives: secondary,
    member_project_ids: members,
    outcomes,
    created_by: actor.userId,
  });

  if (move) await detachFromOthers(members, created, actor);
  await syncMemberObjectives(created, actor);
  // Projects moved in from another use case drop that use case's outcome picks.
  await reconcileProjectOutcomeLinks(actor);

  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings", // no UseCase audit entity type; same as groups
    entityId: created.use_case_id,
    entityLabel: `Use case: ${created.name}`,
    action: "create",
    summary: `Created use case "${created.name}" (primary: ${primary}, ${secondary.length} secondary, ${members.length} project(s), ${outcomes.length} outcome(s)).`,
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
      payload.move_projects === true,
    );
  }
  if (payload.outcomes !== undefined) {
    patch.outcomes = validateOutcomes(payload.outcomes);
  }
  if (Object.keys(patch).length === 0) return before;

  const after = await UseCaseRepository.update(id, patch);
  // Write the destination first, then strip the old owners: a failure in
  // between leaves a project temporarily in two use cases (fixed by
  // retrying the save) rather than in none.
  if (payload.move_projects === true && patch.member_project_ids) {
    await detachFromOthers(after.member_project_ids, after, actor);
  }
  // Objectives (or membership) may have changed: bring every member in line.
  await syncMemberObjectives(after, actor);
  // Outcomes removed, or projects moved/removed: drop picks that no longer apply.
  await reconcileProjectOutcomeLinks(actor);
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
  // Its former members are in no use case now, so their outcome picks go.
  await reconcileProjectOutcomeLinks(actor);
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

function validateOutcomes(raw: unknown) {
  const result = normalizeUseCaseOutcomes(raw, randomUUID);
  if (!result.ok) throw new ValidationError(result.error);
  return result.value;
}

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
  allowMove = false,
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
  if (taken.length > 0 && !allowMove) {
    throw new ValidationError(
      `A project can belong to only one use case. Already assigned: ${taken
        .map((id) => `${id} (${owners.get(id)})`)
        .join(", ")}.`,
    );
  }
  return ids;
}

/**
 * Projects inherit their objectives from their use case: copy the use
 * case's primary/secondary objectives onto every member whose stored
 * values differ. Removing a project from a use case leaves its last
 * objectives in place (nothing reverts), and `lib/projects/service.ts`
 * blocks edits that diverge while it is a member.
 */
export async function syncMemberObjectives(
  useCase: UseCase,
  actor: ActorCtx,
): Promise<void> {
  if (!useCase.primary_objective) return;
  const primary = useCase.primary_objective;
  const secondary = useCase.secondary_objectives;

  for (const pid of useCase.member_project_ids) {
    const project = await ProjectRepository.getById(pid);
    if (!project) continue;
    const sameSecondary =
      project.secondary_objectives.length === secondary.length &&
      secondary.every((o) => project.secondary_objectives.includes(o));
    if (project.primary_objective === primary && sameSecondary) continue;

    await ProjectRepository.update(pid, {
      primary_objective: primary,
      secondary_objectives: [...secondary],
    });
    await audit({
      actorId: actor.userId,
      actorName: actor.userName,
      entityType: "Project",
      entityId: pid,
      entityLabel: project.name,
      action: "update",
      summary: `Objectives inherited from use case "${useCase.name}": primary ${project.primary_objective ?? "none"} → ${primary}; secondary [${project.secondary_objectives.join(", ")}] → [${secondary.join(", ")}]`,
    });
  }
}

/**
 * Drop project outcome picks that no longer point at an outcome of the
 * use case the project belongs to (an outcome was removed, or the project
 * left / moved between use cases). Cheap to run on every use case change:
 * it only writes projects whose picks actually change.
 */
export async function reconcileProjectOutcomeLinks(actor: ActorCtx): Promise<void> {
  const [projects, useCases] = await Promise.all([
    ProjectRepository.getAll(),
    UseCaseRepository.getAll(),
  ]);
  const byId = new Map(projects.map((p) => [p.project_id, p]));
  for (const change of reconcileOutcomeLinks(projects, useCases)) {
    const project = byId.get(change.project_id);
    await ProjectRepository.update(change.project_id, {
      use_case_outcome_ids: change.use_case_outcome_ids,
    });
    await audit({
      actorId: actor.userId,
      actorName: actor.userName,
      entityType: "Project",
      entityId: change.project_id,
      entityLabel: project?.name ?? change.project_id,
      action: "update",
      summary: `Use case outcomes supported: ${project?.use_case_outcome_ids?.length ?? 0} → ${change.use_case_outcome_ids.length} (outcomes removed from the use case, or the project left it).`,
    });
  }
}

/**
 * Remove `ids` from every use case other than `dest`, auditing each
 * source use case that lost projects.
 */
async function detachFromOthers(
  ids: ProjectId[],
  dest: UseCase,
  actor: ActorCtx,
): Promise<void> {
  const moving = new Set(ids);
  for (const uc of await UseCaseRepository.getAll()) {
    if (uc.use_case_id === dest.use_case_id) continue;
    const lost = uc.member_project_ids.filter((pid) => moving.has(pid));
    if (lost.length === 0) continue;
    await UseCaseRepository.update(uc.use_case_id, {
      member_project_ids: uc.member_project_ids.filter(
        (pid) => !moving.has(pid),
      ),
    });
    await audit({
      actorId: actor.userId,
      actorName: actor.userName,
      entityType: "Settings",
      entityId: uc.use_case_id,
      entityLabel: `Use case: ${uc.name}`,
      action: "update",
      summary: `projects moved to "${dest.name}": ${lost.join(", ")}`,
    });
  }
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
  const beforeOutcomes = before.outcomes ?? [];
  const afterOutcomes = after.outcomes ?? [];
  const outAdded = afterOutcomes.filter((o) => !beforeOutcomes.some((b) => b.id === o.id));
  const outRemoved = beforeOutcomes.filter((o) => !afterOutcomes.some((a) => a.id === o.id));
  const outRenamed = afterOutcomes.filter((o) =>
    beforeOutcomes.some((b) => b.id === o.id && b.text !== o.text),
  );
  if (outAdded.length > 0) {
    parts.push(`outcomes added: ${outAdded.map((o) => `"${o.text}"`).join(", ")}`);
  }
  if (outRemoved.length > 0) {
    parts.push(`outcomes removed: ${outRemoved.map((o) => `"${o.text}"`).join(", ")}`);
  }
  if (outRenamed.length > 0) parts.push(`${outRenamed.length} outcome(s) renamed`);
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
