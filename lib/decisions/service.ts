/**
 * Decision Log service layer (Section 5.11).
 *
 * Mirrors `lib/projects/service.ts` and `lib/tasks/service.ts`: API routes
 * never touch `DecisionRepository` directly — they go through here so all
 * payload validation lives in one place and we can hang AI / integration
 * hooks off the create path later (e.g. summarizing a long rationale, or
 * mirroring the entry into a Jira comment).
 *
 * The decision log is **append-only**. There is no `update`. If a
 * correction is needed, add a new entry that supersedes the original — that
 * preserves the integrity of the historical record.
 */

import {
  DecisionRepository,
  ProjectRepository,
  type DecisionLogEntry,
  type DecisionType,
  type ProjectId,
  type UserId,
} from "@/lib/db";
import { audit } from "@/lib/audit/service";

// ---------------------------------------------------------------------------
// Constants — kept in sync with the enum aliases in lib/db/types.ts.
// ---------------------------------------------------------------------------

const DECISION_TYPES: DecisionType[] = [
  "Scope Change",
  "Priority Change",
  "Timeline Change",
  "Resource Change",
  "Technical Decision",
  "Other",
];

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
// Payload
// ---------------------------------------------------------------------------

export interface DecisionCreatePayload {
  decision_summary?: unknown;
  rationale?: unknown;
  decision_type?: unknown;
  /** Optional; defaults to today (UTC) if missing or empty. */
  entry_date?: unknown;
}

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value.trim();
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(`${field} must be one of: ${allowed.join(", ")}.`);
  }
  return value as T;
}

function asNullableDate(value: unknown, field: string, fallback: string): string {
  if (value === null || value === undefined || value === "") return fallback;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be an ISO date string.`);
  }
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    throw new ValidationError(`${field} must be in YYYY-MM-DD format.`);
  }
  return trimmed.slice(0, 10);
}

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

// ---------------------------------------------------------------------------
// Public service surface
// ---------------------------------------------------------------------------

export async function listDecisionsForProject(
  projectId: ProjectId,
): Promise<DecisionLogEntry[]> {
  const project = await ProjectRepository.getById(projectId);
  if (!project) throw new NotFoundError(`Project ${projectId} not found.`);
  return DecisionRepository.getByProjectId(projectId);
}

export async function createDecision(
  projectId: ProjectId,
  payload: DecisionCreatePayload,
  ctx: { userId: UserId; userName?: string | null },
): Promise<DecisionLogEntry> {
  const project = await ProjectRepository.getById(projectId);
  if (!project) throw new NotFoundError(`Project ${projectId} not found.`);

  const decision_summary = asString(payload.decision_summary, "decision_summary");
  if (!decision_summary) {
    throw new ValidationError("decision_summary is required.");
  }
  // Soft length cap so a wayward paste doesn't blow out the table layout.
  // Anything longer belongs in `rationale`.
  if (decision_summary.length > 200) {
    throw new ValidationError(
      "decision_summary must be 200 characters or fewer.",
    );
  }
  const rationale = asString(payload.rationale, "rationale");
  if (!rationale) throw new ValidationError("rationale is required.");

  const decision_type = asEnum(
    payload.decision_type,
    DECISION_TYPES,
    "decision_type",
  );

  const entry_date = asNullableDate(
    payload.entry_date,
    "entry_date",
    todayIso(),
  );

  const entry = await DecisionRepository.create({
    project_id: projectId,
    entry_date,
    decision_summary,
    rationale,
    made_by: ctx.userId,
    decision_type,
  });

  await audit({
    actorId: ctx.userId,
    actorName: ctx.userName,
    entityType: "Decision",
    entityId: entry.entry_id,
    entityLabel: `${project.name}: ${decision_summary}`,
    action: "create",
    summary: `${decision_type} on ${project.project_id} — ${decision_summary}`,
  });

  return entry;
}
