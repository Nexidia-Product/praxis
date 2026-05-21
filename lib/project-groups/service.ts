/**
 * Project group service.
 *
 * The same pattern as `lib/projects/service.ts` and friends: API
 * routes never call ProjectGroupRepository directly. Validation,
 * audit emission, and the membership-pruning hook for the project
 * delete cascade all live here.
 *
 * Permissions: anyone with `projects.edit` can create, update, or
 * delete a group (per the §5.21 decision). The route layer enforces
 * the permission gate; this module trusts its callers and focuses
 * on the data-shape rules.
 */

import {
  ProjectGroupRepository,
  ProjectRepository,
  type ProjectGroup,
  type ProjectGroupId,
  type ProjectId,
  type UserId,
} from "@/lib/db";
import { audit } from "@/lib/audit/service";

const MAX_NAME_LEN = 200;
const MAX_DESCRIPTION_LEN = 2000;
const MAX_MEMBERS = 50;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectGroupValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ProjectGroupNotFoundError";
  }
}

export interface CreateGroupPayload {
  name: unknown;
  description?: unknown;
  member_project_ids?: unknown;
}

export interface UpdateGroupPayload {
  name?: unknown;
  description?: unknown;
  member_project_ids?: unknown;
}

interface ActorCtx {
  userId: UserId;
  userName: string | null;
}

// ---------------------------------------------------------------------------
// CRUD
// ---------------------------------------------------------------------------

export async function createGroup(
  payload: CreateGroupPayload,
  actor: ActorCtx,
): Promise<ProjectGroup> {
  const name = validateName(payload.name);
  const description = validateDescription(payload.description);
  const members = await validateMembers(payload.member_project_ids);

  const created = await ProjectGroupRepository.create({
    name,
    description,
    member_project_ids: members,
    created_by: actor.userId,
  });

  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings", // see note in lib/audit/service.ts — no
    // ProjectGroup entityType exists; rolling under Settings keeps
    // the existing filter chips working until we extend the enum.
    entityId: created.group_id,
    entityLabel: `Group: ${created.name}`,
    action: "create",
    summary: `Created group "${created.name}" with ${members.length} member(s).`,
  });

  return created;
}

export async function updateGroup(
  id: ProjectGroupId,
  payload: UpdateGroupPayload,
  actor: ActorCtx,
): Promise<ProjectGroup> {
  const before = await ProjectGroupRepository.getById(id);
  if (!before) throw new NotFoundError(`Group ${id} not found.`);

  const patch: Record<string, unknown> = {};
  if (payload.name !== undefined) {
    patch.name = validateName(payload.name);
  }
  if (payload.description !== undefined) {
    patch.description = validateDescription(payload.description);
  }
  if (payload.member_project_ids !== undefined) {
    patch.member_project_ids = await validateMembers(payload.member_project_ids);
  }

  if (Object.keys(patch).length === 0) return before;

  const after = await ProjectGroupRepository.update(id, patch);

  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings",
    entityId: after.group_id,
    entityLabel: `Group: ${after.name}`,
    action: "update",
    summary: summarizeChange(before, after),
  });

  return after;
}

export async function deleteGroup(
  id: ProjectGroupId,
  actor: ActorCtx,
): Promise<void> {
  const existing = await ProjectGroupRepository.getById(id);
  if (!existing) throw new NotFoundError(`Group ${id} not found.`);

  await ProjectGroupRepository.delete(id);

  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Settings",
    entityId: id,
    entityLabel: `Group: ${existing.name}`,
    action: "delete",
    summary: `Deleted group "${existing.name}" (${existing.member_project_ids.length} member(s)).`,
  });
}

/**
 * Called from `lib/projects/service.deleteProject` so a project ID
 * doesn't linger in any group's member list after the project itself
 * is gone. Mirrors the same-named cleanup of `depends_on` in the
 * project repository.
 */
export async function pruneProjectFromGroups(
  projectId: ProjectId,
): Promise<void> {
  await ProjectGroupRepository.pruneProjectFromAll(projectId);
}

// ---------------------------------------------------------------------------
// Validators
// ---------------------------------------------------------------------------

function validateName(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("name must be a string.");
  }
  const trimmed = raw.trim();
  if (trimmed === "") throw new ValidationError("name is required.");
  if (trimmed.length > MAX_NAME_LEN) {
    throw new ValidationError(
      `name must be ${MAX_NAME_LEN} characters or fewer.`,
    );
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

async function validateMembers(raw: unknown): Promise<ProjectId[]> {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    throw new ValidationError("member_project_ids must be an array.");
  }
  if (raw.length > MAX_MEMBERS) {
    throw new ValidationError(
      `A group can contain at most ${MAX_MEMBERS} projects.`,
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
    if (trimmed === "") continue;
    ids.push(trimmed);
  }

  // De-dup while preserving order so the UI can rely on stable order.
  const seen = new Set<string>();
  const deduped = ids.filter((id) => {
    if (seen.has(id)) return false;
    seen.add(id);
    return true;
  });

  if (deduped.length === 0) return [];

  // Verify every referenced project still exists. Hand-edited payloads
  // and stale UI state can both produce dangling IDs; we'd rather
  // reject the write than silently store a reference that will never
  // resolve.
  const all = await ProjectRepository.getAll();
  const known = new Set(all.map((p) => p.project_id));
  const missing = deduped.filter((id) => !known.has(id));
  if (missing.length > 0) {
    throw new ValidationError(
      `Unknown project ID(s): ${missing.join(", ")}.`,
    );
  }
  return deduped;
}

function summarizeChange(before: ProjectGroup, after: ProjectGroup): string {
  const parts: string[] = [];
  if (before.name !== after.name) {
    parts.push(`name: "${before.name}" → "${after.name}"`);
  }
  if (before.description !== after.description) {
    parts.push("description updated");
  }
  const beforeMembers = new Set(before.member_project_ids);
  const afterMembers = new Set(after.member_project_ids);
  const added = after.member_project_ids.filter((id) => !beforeMembers.has(id));
  const removed = before.member_project_ids.filter(
    (id) => !afterMembers.has(id),
  );
  if (added.length > 0) parts.push(`added: ${added.join(", ")}`);
  if (removed.length > 0) parts.push(`removed: ${removed.join(", ")}`);
  return parts.length > 0
    ? parts.join("; ")
    : `Group "${after.name}" saved (no changes).`;
}
