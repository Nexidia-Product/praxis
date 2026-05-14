/**
 * Ideas service layer (Section 5.17, 5.18).
 *
 * Mirrors the structure of `lib/projects/service.ts` and
 * `lib/decisions/service.ts`: API routes never reach into `IdeaRepository`
 * directly. Validation, status-transition rules, the notification hook,
 * and idea→project conversion all live here.
 *
 * Status flow:
 *
 *     New ──► Under Review ──► Approved ──► Converted
 *                          └─► Rejected
 *
 * Conversions are one-way: once an idea is `Converted`, it has a
 * `converted_to_project_id` and cannot be edited further. The repository
 * stores the link in both directions (idea has `converted_to_project_id`,
 * project has `created_by` set to the converting admin).
 *
 * The AI Overlap Check (Section 5.18) is wired through `aiOverlapAnalysis`
 * — today it returns a stub explanation since Step 10 is deferred. When
 * Step 10 lands, only that one function changes. Everything else — the
 * route, the cache field on the record, the UI banner — stays the same.
 */

import {
  IdeaRepository,
  ProjectRepository,
  type IdeaId,
  type IdeaStatus,
  type IdeaUrgency,
  type Priority,
  type Project,
  type ProjectId,
  type ProjectIdea,
  type ProjectPhase,
  type ProjectStatus,
  type ProjectType,
  type UserId,
} from "@/lib/db";
import {
  createProject,
  ValidationError as ProjectValidationError,
  type ProjectCreatePayload,
} from "@/lib/projects/service";
import { notifyIdeaStatusChanged } from "@/lib/notifications/service";
import { audit } from "@/lib/audit/service";

// ---------------------------------------------------------------------------
// Constants — kept in sync with the enum aliases in lib/db/types.ts.
// ---------------------------------------------------------------------------

const URGENCIES: IdeaUrgency[] = ["Low", "Medium", "High", "Critical"];

const IDEA_STATUSES: IdeaStatus[] = [
  "New",
  "Under Review",
  "Approved",
  "Rejected",
  "Converted",
];

/** Status transitions allowed from each starting status. */
const STATUS_TRANSITIONS: Record<IdeaStatus, IdeaStatus[]> = {
  New: ["Under Review", "Approved", "Rejected", "Converted"],
  "Under Review": ["Approved", "Rejected", "Converted", "New"],
  Approved: ["Converted", "Rejected", "Under Review"],
  Rejected: ["Under Review"],
  // Converted is terminal — once an idea has spawned a project we don't let
  // it be edited or have its status flipped, since that would orphan the
  // link in `converted_to_project_id`.
  Converted: [],
};

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

export class ConflictError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ConflictError";
  }
}

// ---------------------------------------------------------------------------
// Field validators (style-matched to projects/service.ts so error messages
// read consistently across the app).
// ---------------------------------------------------------------------------

function asString(value: unknown, field: string): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }
  return value.trim();
}

function asOptionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  return asString(value, field);
}

function asEnum<T extends string>(
  value: unknown,
  allowed: readonly T[],
  field: string,
): T {
  if (typeof value !== "string" || !(allowed as readonly string[]).includes(value)) {
    throw new ValidationError(
      `${field} must be one of: ${allowed.join(", ")}.`,
    );
  }
  return value as T;
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

/**
 * Cheap email-shape check — we don't try to be RFC-strict, just block the
 * obvious typo cases ("foo", "foo@") so a bad address doesn't get baked
 * onto the record permanently.
 */
function asNullableEmail(value: unknown, field: string): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
    throw new ValidationError(`${field} does not look like a valid email.`);
  }
  return trimmed;
}

// ---------------------------------------------------------------------------
// Public submission (Section 5.17)
// ---------------------------------------------------------------------------

export interface IdeaSubmitPayload {
  submitter_name?: unknown;
  submitter_email?: unknown;
  idea_name?: unknown;
  description?: unknown;
  urgency?: unknown;
  requested_target_date?: unknown;
  key_stakeholders?: unknown;
}

/** Soft caps on free-text fields so the public form can't accept a 5MB blob. */
const MAX_NAME = 200;
const MAX_DESCRIPTION = 5000;
const MAX_STAKEHOLDERS = 500;

/**
 * Validate and create an idea from a public submission. No authentication
 * is required — this is the entry point invoked by `/api/public/ideas`.
 */
export async function submitIdea(
  payload: IdeaSubmitPayload,
): Promise<ProjectIdea> {
  const submitter_name = asString(payload.submitter_name, "submitter_name");
  if (!submitter_name) {
    throw new ValidationError("Your name is required.");
  }
  if (submitter_name.length > MAX_NAME) {
    throw new ValidationError(
      `Your name must be ${MAX_NAME} characters or fewer.`,
    );
  }

  const submitter_email = asNullableEmail(
    payload.submitter_email,
    "submitter_email",
  );

  const idea_name = asString(payload.idea_name, "idea_name");
  if (!idea_name) {
    throw new ValidationError("A short title for the idea is required.");
  }
  if (idea_name.length > MAX_NAME) {
    throw new ValidationError(
      `The idea title must be ${MAX_NAME} characters or fewer.`,
    );
  }

  const description = asString(payload.description, "description");
  if (!description) {
    throw new ValidationError("A description is required.");
  }
  if (description.length > MAX_DESCRIPTION) {
    throw new ValidationError(
      `The description must be ${MAX_DESCRIPTION} characters or fewer.`,
    );
  }

  const urgency = asEnum(payload.urgency, URGENCIES, "urgency");
  const requested_target_date = asNullableDate(
    payload.requested_target_date,
    "requested_target_date",
  );

  const key_stakeholders = asOptionalString(
    payload.key_stakeholders,
    "key_stakeholders",
  );
  if (key_stakeholders.length > MAX_STAKEHOLDERS) {
    throw new ValidationError(
      `Stakeholder list must be ${MAX_STAKEHOLDERS} characters or fewer.`,
    );
  }

  const idea = await IdeaRepository.create({
    submitter_name,
    submitter_email,
    idea_name,
    description,
    urgency,
    requested_target_date,
    key_stakeholders,
    status: "New",
  });

  // Public submissions have no logged-in actor — record `null` so the
  // audit page renders "(public submission)" instead of attributing
  // the row to a system user.
  await audit({
    actorId: null,
    entityType: "Idea",
    entityId: idea.idea_id,
    entityLabel: idea.idea_name,
    action: "create",
    summary: `Idea submitted by ${idea.submitter_name} (${idea.urgency} urgency).`,
  });

  return idea;
}

// ---------------------------------------------------------------------------
// Admin review (Section 5.18)
// ---------------------------------------------------------------------------

export interface IdeaUpdatePayload {
  status?: unknown;
  admin_comments?: unknown;
  ai_overlap_analysis?: unknown;
}

/**
 * Apply an admin-side edit. Status transitions are validated against
 * `STATUS_TRANSITIONS`. If the status changes and the submitter provided
 * an email, the notification helper is called as a side-effect — failure
 * to email does NOT roll back the update (we treat the email as best-effort,
 * matching how the project / task notifiers behave in `lib/notifications`).
 *
 * Conversion (`status === "Converted"`) is NOT performed here. That's a
 * compound operation — create a project, then mark the idea — and lives in
 * `convertIdeaToProject` so the caller has to opt in explicitly.
 */
export async function updateIdea(
  ideaId: IdeaId,
  payload: IdeaUpdatePayload,
  ctx: { userId: UserId; userName?: string | null } = { userId: "system" },
): Promise<ProjectIdea> {
  const existing = await IdeaRepository.getById(ideaId);
  if (!existing) throw new NotFoundError(`Idea ${ideaId} not found.`);

  if (existing.status === "Converted") {
    throw new ConflictError(
      "This idea has already been converted to a project and can no longer be edited.",
    );
  }

  const patch: { status?: IdeaStatus; admin_comments?: string; ai_overlap_analysis?: string | null } = {};

  if (payload.status !== undefined) {
    const nextStatus = asEnum(payload.status, IDEA_STATUSES, "status");
    if (nextStatus === "Converted") {
      // Converting goes through `convertIdeaToProject`; that path does the
      // project creation atomically with the idea status change.
      throw new ValidationError(
        'Use the "Convert to project" action to set status to Converted.',
      );
    }
    if (
      nextStatus !== existing.status &&
      !STATUS_TRANSITIONS[existing.status].includes(nextStatus)
    ) {
      throw new ConflictError(
        `Cannot transition idea status from "${existing.status}" to "${nextStatus}".`,
      );
    }
    patch.status = nextStatus;
  }

  if (payload.admin_comments !== undefined) {
    const comments = asOptionalString(
      payload.admin_comments,
      "admin_comments",
    );
    if (comments.length > MAX_DESCRIPTION) {
      throw new ValidationError(
        `Admin comments must be ${MAX_DESCRIPTION} characters or fewer.`,
      );
    }
    patch.admin_comments = comments;
  }

  if (payload.ai_overlap_analysis !== undefined) {
    if (
      payload.ai_overlap_analysis !== null &&
      typeof payload.ai_overlap_analysis !== "string"
    ) {
      throw new ValidationError(
        "ai_overlap_analysis must be a string or null.",
      );
    }
    patch.ai_overlap_analysis = payload.ai_overlap_analysis;
  }

  const updated = await IdeaRepository.update(ideaId, patch);

  // Fire-and-forget email notification on status change. We swallow errors
  // so a Resend outage doesn't 500 the admin's UI; the helper itself has
  // its own try/catch around the network call.
  if (patch.status && patch.status !== existing.status) {
    notifyIdeaStatusChanged({
      idea: updated,
      priorStatus: existing.status,
    }).catch((err) => {
      console.warn(
        `[ideas] notifyIdeaStatusChanged failed for ${ideaId}:`,
        err,
      );
    });

    await audit({
      actorId: ctx.userId,
      actorName: ctx.userName,
      entityType: "Idea",
      entityId: ideaId,
      entityLabel: updated.idea_name,
      action: "status_change",
      summary: `Idea status: ${existing.status} → ${updated.status}`,
    });
  } else if (patch.admin_comments !== undefined && patch.admin_comments !== existing.admin_comments) {
    await audit({
      actorId: ctx.userId,
      actorName: ctx.userName,
      entityType: "Idea",
      entityId: ideaId,
      entityLabel: updated.idea_name,
      action: "update",
      summary: `Updated admin comments.`,
    });
  }

  return updated;
}

// ---------------------------------------------------------------------------
// Convert idea → project
// ---------------------------------------------------------------------------

/**
 * Defaults applied to fields the project schema requires but the idea
 * doesn't carry. Picked to match the typical "fresh idea" shape — Not
 * Started, Qualification phase, Medium priority, New Feature type — so
 * the admin can save immediately, or override the defaults in the form
 * before saving.
 *
 * The values map to the same constants as `ProjectFormModal.emptyState`,
 * so the conversion preview feels identical to creating a project from
 * scratch.
 */
const PROJECT_DEFAULTS = {
  status: "Not Started" as ProjectStatus,
  phase: "Qualification" as ProjectPhase,
  priority: "Medium" as Priority,
  project_type: "New Feature" as ProjectType,
  application_product: "",
};

/**
 * Map idea urgency to a sensible project priority default. Admins can
 * still override in the form, but this gets the priority closer to the
 * submitter's signal than always defaulting to "Medium" would.
 */
function urgencyToPriority(urgency: IdeaUrgency): Priority {
  switch (urgency) {
    case "Critical":
      return "Critical";
    case "High":
      return "High";
    case "Medium":
      return "Medium";
    case "Low":
      return "Low";
  }
}

/** A pre-filled project payload that the admin sees in the conversion form. */
export interface IdeaConversionPreview {
  name: string;
  description: string;
  application_product: string;
  project_type: ProjectType;
  priority: Priority;
  status: ProjectStatus;
  phase: ProjectPhase;
  primary_stakeholders: string[];
  target_date: string | null;
  /** The original idea, kept for the UI to show as context. */
  idea: ProjectIdea;
}

/**
 * Build the pre-filled project payload from an idea, without persisting
 * anything. The admin form takes this as initial state, lets the user
 * adjust, and then `convertIdeaToProject` is called on submit.
 */
export async function buildConversionPreview(
  ideaId: IdeaId,
): Promise<IdeaConversionPreview> {
  const idea = await IdeaRepository.getById(ideaId);
  if (!idea) throw new NotFoundError(`Idea ${ideaId} not found.`);
  if (idea.status === "Converted") {
    throw new ConflictError(
      "This idea has already been converted to a project.",
    );
  }
  // Stakeholders come in as a free-form string on the idea; the project
  // schema wants an array. Split on the same delimiters the project form
  // uses so a "Foo, Bar" string round-trips cleanly.
  const stakeholders = idea.key_stakeholders
    .split(/[,\n]/)
    .map((s) => s.trim())
    .filter(Boolean);

  return {
    name: idea.idea_name,
    description: idea.description,
    application_product: PROJECT_DEFAULTS.application_product,
    project_type: PROJECT_DEFAULTS.project_type,
    priority: urgencyToPriority(idea.urgency),
    status: PROJECT_DEFAULTS.status,
    phase: PROJECT_DEFAULTS.phase,
    primary_stakeholders: stakeholders,
    target_date: idea.requested_target_date,
    idea,
  };
}

/**
 * Two-step conversion: create the project (via the project service so
 * notifications, health-score recalc, and any future GitHub/Jira sync
 * fire normally), then mark the idea as `Converted` with a back-link to
 * the new project ID.
 *
 * We do NOT roll back the project if the idea write fails — the project
 * is the higher-value record. A dangling "approved but unmarked" idea is
 * recoverable: an admin can re-open the idea and see the project in the
 * projects list, then mark the idea Converted manually if needed.
 *
 * The `projectPayload` is whatever the admin's conversion form posted —
 * it's run through `createProject` for validation, so it has identical
 * semantics to creating a project from scratch through the normal form.
 */
export async function convertIdeaToProject(
  ideaId: IdeaId,
  projectPayload: ProjectCreatePayload,
  ctx: { createdBy: UserId; userName?: string | null },
): Promise<{ project: Project; idea: ProjectIdea }> {
  const idea = await IdeaRepository.getById(ideaId);
  if (!idea) throw new NotFoundError(`Idea ${ideaId} not found.`);
  if (idea.status === "Converted") {
    throw new ConflictError(
      "This idea has already been converted to a project.",
    );
  }

  // Translate the project service's ValidationError into ours so the API
  // route only needs to handle one error type.
  let project: Project;
  try {
    project = await createProject(projectPayload, {
      createdBy: ctx.createdBy,
      userName: ctx.userName,
    });
  } catch (err) {
    if (err instanceof ProjectValidationError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }

  let updatedIdea: ProjectIdea;
  try {
    updatedIdea = await IdeaRepository.update(ideaId, {
      status: "Converted",
      converted_to_project_id: project.project_id,
    });
  } catch (err) {
    console.error(
      `[ideas] idea ${ideaId} update failed AFTER project ${project.project_id} was created. The project exists; the idea is orphaned and must be repaired manually:`,
      err,
    );
    throw err;
  }

  // Fire submitter notification (best-effort).
  notifyIdeaStatusChanged({
    idea: updatedIdea,
    priorStatus: idea.status,
  }).catch((err) => {
    console.warn(
      `[ideas] notifyIdeaStatusChanged failed for ${ideaId} after conversion:`,
      err,
    );
  });

  await audit({
    actorId: ctx.createdBy,
    actorName: ctx.userName,
    entityType: "Idea",
    entityId: ideaId,
    entityLabel: updatedIdea.idea_name,
    action: "convert",
    summary: `Converted idea to project ${project.project_id}.`,
  });

  return { project, idea: updatedIdea };
}

// ---------------------------------------------------------------------------
// AI Overlap Check (Section 5.18) — graceful Step-10 stub
// ---------------------------------------------------------------------------

/**
 * Step 10 (which builds the AI integration routes) was skipped, so this
 * function is the "graceful pre-AI" implementation. Rather than 500-ing
 * with "endpoint not found" when the admin clicks the button, we return
 * a deterministic non-AI overlap pass — substring matches between the
 * idea's description and existing project descriptions/names — and label
 * the result as "AI not yet enabled".
 *
 * When Step 10 is built, this function is replaced with a call to
 * `/api/ai/overlap`. The shape it returns (`{ analysis, source }`) stays
 * the same so the UI doesn't change.
 */
export interface OverlapAnalysisResult {
  analysis: string;
  /** "ai" once Step 10 is wired; "heuristic" until then. */
  source: "ai" | "heuristic";
}

export async function aiOverlapAnalysis(
  ideaId: IdeaId,
): Promise<OverlapAnalysisResult> {
  const idea = await IdeaRepository.getById(ideaId);
  if (!idea) throw new NotFoundError(`Idea ${ideaId} not found.`);

  const projects = await ProjectRepository.getAll();

  // Tokenize the idea description into roughly-meaningful words. Lowercased,
  // de-punctuated, with a small stop-word filter so common English doesn't
  // dominate the match score. Not a real NLP pipeline — just enough to be
  // useful before the real Claude call replaces it.
  const STOP = new Set([
    "the", "a", "an", "and", "or", "but", "for", "with", "to", "of", "in",
    "on", "at", "by", "is", "are", "be", "we", "our", "this", "that", "it",
    "as", "from", "i", "you", "they", "them", "us", "have", "has", "had",
    "will", "would", "should", "can", "could", "do", "does", "did", "not",
  ]);
  const tokenize = (s: string): Set<string> => {
    const tokens = s
      .toLowerCase()
      .replace(/[^a-z0-9\s]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length >= 4 && !STOP.has(t));
    return new Set(tokens);
  };

  const ideaTokens = tokenize(`${idea.idea_name} ${idea.description}`);
  if (ideaTokens.size === 0) {
    return {
      analysis:
        "AI overlap analysis is not yet enabled (Step 10 is pending). " +
        "No keyword overlap could be computed because the idea text is too short.",
      source: "heuristic",
    };
  }

  const matches: { project_id: ProjectId; name: string; overlap: number; shared: string[] }[] = [];
  for (const p of projects) {
    const projTokens = tokenize(`${p.name} ${p.description}`);
    const shared: string[] = [];
    for (const t of ideaTokens) {
      if (projTokens.has(t)) shared.push(t);
    }
    if (shared.length === 0) continue;
    const overlap = shared.length / Math.max(ideaTokens.size, 1);
    matches.push({
      project_id: p.project_id,
      name: p.name,
      overlap,
      shared: shared.slice(0, 6),
    });
  }
  matches.sort((a, b) => b.overlap - a.overlap);
  const top = matches.slice(0, 3);

  const header =
    "AI overlap analysis is not yet enabled (Step 10 is pending). " +
    "Showing a keyword-based overlap heuristic instead.\n";

  if (top.length === 0) {
    const analysis =
      header +
      "\nNo keyword overlap detected with existing projects. " +
      "Re-run after the AI integration is wired in for a semantic check.";
    await IdeaRepository.update(ideaId, { ai_overlap_analysis: analysis });
    return { analysis, source: "heuristic" };
  }

  const lines = top.map((m, i) => {
    const pct = Math.round(m.overlap * 100);
    return `${i + 1}. ${m.project_id} — ${m.name} (${pct}% keyword overlap; shared terms: ${m.shared.join(", ")})`;
  });

  const analysis = `${header}\nClosest existing projects by keyword overlap:\n\n${lines.join("\n")}\n\nReview these manually before approving.`;

  await IdeaRepository.update(ideaId, { ai_overlap_analysis: analysis });
  return { analysis, source: "heuristic" };
}

// ---------------------------------------------------------------------------
// Read helpers
// ---------------------------------------------------------------------------

export async function listIdeas(opts?: {
  status?: IdeaStatus;
}): Promise<ProjectIdea[]> {
  const all = await IdeaRepository.getAll();
  const filtered = opts?.status
    ? all.filter((i) => i.status === opts.status)
    : all;
  // Newest first; secondary sort on ID for stable ordering when timestamps
  // collide (which happens during seeding and in fast tests).
  filtered.sort((a, b) => {
    if (a.submitted_at !== b.submitted_at) {
      return a.submitted_at < b.submitted_at ? 1 : -1;
    }
    return a.idea_id < b.idea_id ? 1 : -1;
  });
  return filtered;
}

export async function getIdea(ideaId: IdeaId): Promise<ProjectIdea> {
  const idea = await IdeaRepository.getById(ideaId);
  if (!idea) throw new NotFoundError(`Idea ${ideaId} not found.`);
  return idea;
}
