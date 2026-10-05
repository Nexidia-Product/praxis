/**
 * Release caveat service — validation + audit around
 * ReleaseCaveatRepository. Routes enforce `projects.edit`; this module
 * enforces data-shape rules. Audit entries are filed under the Project
 * entity so they appear on the project's own trail.
 */

import {
  ProjectRepository,
  ReleaseCaveatRepository,
  type ReleaseCaveat,
  type ReleaseCaveatId,
  type UserId,
} from "@/lib/db";
import { audit } from "@/lib/audit/service";

const MAX_CAVEAT_LEN = 2000;
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCaveatValidationError";
  }
}

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ReleaseCaveatNotFoundError";
  }
}

interface ActorCtx {
  userId: UserId;
  userName: string | null;
}

function validateText(raw: unknown): string {
  if (typeof raw !== "string") {
    throw new ValidationError("caveat must be a string.");
  }
  const trimmed = raw.trim();
  if (trimmed === "") throw new ValidationError("caveat is required.");
  if (trimmed.length > MAX_CAVEAT_LEN) {
    throw new ValidationError(
      `caveat must be ${MAX_CAVEAT_LEN} characters or fewer.`,
    );
  }
  return trimmed;
}

export async function createReleaseCaveat(
  payload: { release_date?: unknown; project_id?: unknown; caveat?: unknown },
  actor: ActorCtx,
): Promise<ReleaseCaveat> {
  const caveat = validateText(payload.caveat);
  if (
    typeof payload.release_date !== "string" ||
    !ISO_DATE.test(payload.release_date)
  ) {
    throw new ValidationError("release_date must be YYYY-MM-DD.");
  }
  if (typeof payload.project_id !== "string" || payload.project_id === "") {
    throw new ValidationError("project_id is required.");
  }
  const project = await ProjectRepository.getById(payload.project_id);
  if (!project) {
    throw new ValidationError(`Unknown project ID: ${payload.project_id}.`);
  }

  const created = await ReleaseCaveatRepository.create({
    release_date: payload.release_date,
    project_id: project.project_id,
    caveat,
    created_by: actor.userId,
    created_by_name: actor.userName ?? "",
  });

  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Project",
    entityId: project.project_id,
    entityLabel: project.name,
    action: "update",
    summary: `Added caveat for the ${created.release_date} release: ${caveat}`,
  });
  return created;
}

export async function updateReleaseCaveat(
  id: ReleaseCaveatId,
  payload: { caveat?: unknown },
  actor: ActorCtx,
): Promise<ReleaseCaveat> {
  const before = await ReleaseCaveatRepository.getById(id);
  if (!before) throw new NotFoundError(`Caveat ${id} not found.`);
  const caveat = validateText(payload.caveat);
  if (caveat === before.caveat) return before;

  const after = await ReleaseCaveatRepository.update(id, caveat);
  const project = await ProjectRepository.getById(after.project_id);
  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Project",
    entityId: after.project_id,
    entityLabel: project?.name ?? after.project_id,
    action: "update",
    summary: `Edited caveat for the ${after.release_date} release: "${before.caveat}" → "${caveat}"`,
  });
  return after;
}

export async function deleteReleaseCaveat(
  id: ReleaseCaveatId,
  actor: ActorCtx,
): Promise<void> {
  const existing = await ReleaseCaveatRepository.getById(id);
  if (!existing) throw new NotFoundError(`Caveat ${id} not found.`);
  await ReleaseCaveatRepository.delete(id);
  const project = await ProjectRepository.getById(existing.project_id);
  await audit({
    actorId: actor.userId,
    actorName: actor.userName,
    entityType: "Project",
    entityId: existing.project_id,
    entityLabel: project?.name ?? existing.project_id,
    action: "update",
    summary: `Removed caveat for the ${existing.release_date} release: ${existing.caveat}`,
  });
}
