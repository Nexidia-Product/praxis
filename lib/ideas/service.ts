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
 * The AI Overlap Check (Section 5.18) is wired through `aiOverlapAnalysis`.
 * When AI is enabled it calls Bedrock via `lib/ai/overlap.ts`; when AI is
 * disabled (the default — see lib/ai/feature-flag.ts) it falls back to a
 * keyword-overlap heuristic so the route still returns something useful.
 * The shape it returns (`{ analysis, source }`) is identical in both
 * cases so the route and the UI banner don't change.
 */

import {
  IdeaRepository,
  ProjectRepository,
  type IdeaAttachment,
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
  validateAttachments,
  AttachmentValidationError,
  type IncomingAttachment,
} from "./attachments";
import {
  deleteAttachments,
  uploadAttachment,
} from "./attachments-server";
import {
  createProject,
  ValidationError as ProjectValidationError,
  type ProjectCreatePayload,
} from "@/lib/projects/service";
import { notifyIdeaStatusChanged } from "@/lib/notifications/service";
import { sendIdeaEditLink } from "@/lib/notifications/email";
import { audit } from "@/lib/audit/service";
import { isAiEnabled } from "@/lib/ai/feature-flag";
import { createHash, randomBytes } from "node:crypto";

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

// ---------------------------------------------------------------------------
// Edit-token helpers (account-less "edit your idea" links)
// ---------------------------------------------------------------------------

/** A fresh, URL-safe capability token. 256 bits — unguessable. */
function newEditToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Hash a token for storage / lookup. Only the hash is ever persisted, so a
 * DB leak can't be replayed as an edit link. SHA-256 (not bcrypt) is the
 * right tool here: the input is already high-entropy, so there's nothing to
 * brute-force and we want fast, deterministic lookups.
 */
function hashEditToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

/** Absolute URL for the submitter's edit page. */
function buildEditUrl(token: string): string {
  const base = (process.env.NEXT_PUBLIC_SITE_URL ?? "").replace(/\/+$/, "");
  return `${base}/submit/edit/${token}`;
}

/**
 * Validate and create an idea from a public submission. No authentication
 * is required — this is the entry point invoked by `/api/public/ideas`.
 */
export async function submitIdea(
  payload: IdeaSubmitPayload,
  attachments?: IncomingAttachment[],
): Promise<ProjectIdea & { edit_token: string | null }> {
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

  // Attachments are validated against the MIME allowlist and size
  // caps BEFORE we touch storage or the database. If any file fails,
  // the whole submission is rejected — partial accepts would either
  // confuse the submitter or invite an attacker to use rejection
  // messages as a probe. AttachmentValidationError is re-raised as
  // ValidationError so the public route's existing error mapping
  // surfaces it as a 400 with the original message.
  let validatedFiles: ReturnType<typeof validateAttachments> = [];
  if (attachments && attachments.length > 0) {
    try {
      validatedFiles = validateAttachments(attachments);
    } catch (err) {
      if (err instanceof AttachmentValidationError) {
        throw new ValidationError(err.message);
      }
      throw err;
    }
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

  // Upload each file to Supabase Storage. We do this AFTER the idea
  // row is created so we have a stable idea_id to use as the
  // storage path prefix. If any file fails to upload, clean up
  // every file that did make it and delete the idea row — this
  // submission is fully rolled back.
  let savedAttachments: IdeaAttachment[] = [];
  if (validatedFiles.length > 0) {
    const uploadedPaths: string[] = [];
    try {
      for (const v of validatedFiles) {
        const rec = await uploadAttachment(idea.idea_id, v);
        uploadedPaths.push(rec.storage_path);
        savedAttachments.push(rec);
      }
      await IdeaRepository.update(idea.idea_id, {
        attachments: savedAttachments,
      });
    } catch (err) {
      // Roll back: remove uploaded files, delete idea record.
      await deleteAttachments(uploadedPaths);
      try {
        await IdeaRepository.delete(idea.idea_id);
      } catch {
        // best-effort
      }
      const msg =
        err instanceof Error ? err.message : "Attachment upload failed.";
      throw new ValidationError(msg);
    }
  }

  const ideaWithAttachments =
    savedAttachments.length > 0
      ? { ...idea, attachments: savedAttachments }
      : idea;

  // Mint a capability token so the submitter can edit their idea (until it's
  // converted) without an account. Best-effort: minting requires the
  // `edit_token_hash` column (migration 0013). If it isn't present yet we
  // log and continue — the submission still succeeds, just without an edit
  // link. Only the hash is stored; the raw token is returned to the caller
  // once (shown on the confirmation screen and emailed).
  let editToken: string | null = null;
  try {
    const token = newEditToken();
    await IdeaRepository.setEditTokenHash(idea.idea_id, hashEditToken(token));
    editToken = token;
  } catch (err) {
    console.warn(
      `[ideas] edit-token setup skipped for ${idea.idea_id} (is migration 0013 applied?):`,
      err,
    );
  }

  // Public submissions have no logged-in actor — record `null` so the
  // audit page renders "(public submission)" instead of attributing
  // the row to a system user.
  await audit({
    actorId: null,
    entityType: "Idea",
    entityId: idea.idea_id,
    entityLabel: idea.idea_name,
    action: "create",
    summary: `Idea submitted by ${idea.submitter_name} (${idea.urgency} urgency)${
      savedAttachments.length > 0
        ? ` with ${savedAttachments.length} attachment(s)`
        : ""
    }.`,
  });

  // Email the edit link when we have both a token and an address. Fire-and-
  // forget — a mailer outage must not fail the submission.
  if (editToken && ideaWithAttachments.submitter_email) {
    sendIdeaEditLink({
      to: ideaWithAttachments.submitter_email,
      ideaName: ideaWithAttachments.idea_name,
      editUrl: buildEditUrl(editToken),
    }).catch((err) => {
      console.warn(
        `[ideas] edit-link email failed for ${idea.idea_id}:`,
        err,
      );
    });
  }

  return { ...ideaWithAttachments, edit_token: editToken };
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

  // A reviewer touching the idea means they're now looking at its current
  // content, so clear the "edited since review" flag. Separate + best-effort
  // so a pre-migration DB (missing column) never fails the reviewer's edit;
  // mirror the cleared value onto the returned record so the UI updates.
  if (updated.edited_since_review) {
    try {
      await IdeaRepository.update(ideaId, { edited_since_review: false });
      updated.edited_since_review = false;
    } catch (err) {
      console.warn(
        `[ideas] clearing edited_since_review failed for ${ideaId}:`,
        err,
      );
    }
  }

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
// Public, account-less edit (via capability token)
// ---------------------------------------------------------------------------

/** Fields a submitter may change through their edit link. */
export interface IdeaEditPayload {
  idea_name?: unknown;
  description?: unknown;
  urgency?: unknown;
  requested_target_date?: unknown;
  key_stakeholders?: unknown;
}

/**
 * Resolve an idea from its raw edit token (hashing before lookup). Returns
 * null for an unknown / stale token. Used by the public edit page to decide
 * whether to render the form, a "converted, read-only" notice, or an
 * "invalid link" message.
 */
export async function getIdeaByEditToken(
  token: string,
): Promise<ProjectIdea | null> {
  const t = typeof token === "string" ? token.trim() : "";
  if (!t) return null;
  try {
    return await IdeaRepository.getByEditTokenHash(hashEditToken(t));
  } catch (err) {
    // The most likely failure is the `edit_token_hash` column not existing
    // yet (migration 0013 not applied). Degrade to "no match" so the public
    // page shows a clean "invalid link" state instead of a 500.
    console.warn("[ideas] getIdeaByEditToken lookup failed:", err);
    return null;
  }
}

/**
 * Apply a submitter's edit, authorized solely by the capability token.
 *
 * Guardrails:
 *   - Unknown / stale token → NotFoundError (surfaced as 404).
 *   - Already converted → ConflictError (surfaced as 409). This is the core
 *     rule: once an idea has spawned a project it's frozen.
 *   - Only the submitter-owned content fields can change — never status,
 *     admin_comments, the conversion link, or the token itself.
 *
 * When the idea has already moved past "New" (a reviewer engaged with it),
 * the edit sets `edited_since_review` so the admin surfaces flag that the
 * content changed after review.
 */
export async function updateIdeaByToken(
  token: string,
  payload: IdeaEditPayload,
): Promise<ProjectIdea> {
  const existing = await getIdeaByEditToken(token);
  if (!existing) {
    throw new NotFoundError("This edit link is invalid or has expired.");
  }
  if (existing.status === "Converted" || existing.converted_to_project_id) {
    throw new ConflictError(
      "This idea has been converted to a project and can no longer be edited.",
    );
  }

  const patch: {
    idea_name?: string;
    description?: string;
    urgency?: IdeaUrgency;
    requested_target_date?: string | null;
    key_stakeholders?: string;
    edited_since_review?: boolean;
  } = {};

  if (payload.idea_name !== undefined) {
    const idea_name = asString(payload.idea_name, "idea_name");
    if (!idea_name) {
      throw new ValidationError("A short title for the idea is required.");
    }
    if (idea_name.length > MAX_NAME) {
      throw new ValidationError(
        `The idea title must be ${MAX_NAME} characters or fewer.`,
      );
    }
    patch.idea_name = idea_name;
  }

  if (payload.description !== undefined) {
    const description = asString(payload.description, "description");
    if (!description) {
      throw new ValidationError("A description is required.");
    }
    if (description.length > MAX_DESCRIPTION) {
      throw new ValidationError(
        `The description must be ${MAX_DESCRIPTION} characters or fewer.`,
      );
    }
    patch.description = description;
  }

  if (payload.urgency !== undefined) {
    patch.urgency = asEnum(payload.urgency, URGENCIES, "urgency");
  }

  if (payload.requested_target_date !== undefined) {
    patch.requested_target_date = asNullableDate(
      payload.requested_target_date,
      "requested_target_date",
    );
  }

  if (payload.key_stakeholders !== undefined) {
    const key_stakeholders = asOptionalString(
      payload.key_stakeholders,
      "key_stakeholders",
    );
    if (key_stakeholders.length > MAX_STAKEHOLDERS) {
      throw new ValidationError(
        `Stakeholder list must be ${MAX_STAKEHOLDERS} characters or fewer.`,
      );
    }
    patch.key_stakeholders = key_stakeholders;
  }

  if (Object.keys(patch).length === 0) {
    // Nothing actually changed — return the current record unchanged
    // rather than writing a no-op row and firing a spurious flag/audit.
    return existing;
  }

  // Flag for reviewers only once an admin has engaged (status left "New").
  if (existing.status !== "New") {
    patch.edited_since_review = true;
  }

  const updated = await IdeaRepository.update(existing.idea_id, patch);

  await audit({
    actorId: null,
    entityType: "Idea",
    entityId: existing.idea_id,
    entityLabel: updated.idea_name,
    action: "update",
    summary: "Submitter edited their idea via the public edit link.",
  });

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

  // When AI is on we hand off to Bedrock. We import inside the function
  // so AI-disabled environments don't pay for evaluating the AWS SDK at
  // module load time. The heuristic below stays intact for fallback.
  if (isAiEnabled()) {
    const { analyzeOverlap } = await import("@/lib/ai/overlap");
    try {
      const result = await analyzeOverlap(ideaId);
      const header = result.overlaps_with.length === 0
        ? "AI overlap check: no meaningful overlap detected.\n"
        : `AI overlap check found ${result.overlaps_with.length} potential overlap${result.overlaps_with.length === 1 ? "" : "s"}.\n`;
      const matchLines = result.overlaps_with.map(
        (m) => `- ${m.type} ${m.id} (${m.label}): ${m.reason}`,
      );
      const analysis = [
        header,
        result.summary,
        matchLines.length > 0 ? "\nMatches:\n" + matchLines.join("\n") : "",
      ]
        .filter(Boolean)
        .join("\n")
        .trim();
      await IdeaRepository.update(ideaId, { ai_overlap_analysis: analysis });
      return { analysis, source: "ai" };
    } catch (err) {
      // If Bedrock fails (throttle, transient network, etc.) fall through
      // to the heuristic so the reviewer still gets *something*. Log the
      // model error to the console so it's visible during local dev.
      console.error(
        `[ai/overlap] Bedrock call failed for idea ${ideaId}; falling back to heuristic.`,
        err,
      );
    }
  }

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
