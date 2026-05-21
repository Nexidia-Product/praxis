/**
 * Project service layer.
 *
 * Section 8 of the design document calls out that all project create/update
 * flows must go through a service layer rather than touching the repository
 * directly from API routes, so the future GitHub Projects / Jira sync can
 * be inserted in one place. We're establishing that boundary now even though
 * the AI and integration calls themselves come in later steps.
 *
 * Two responsibilities live here today:
 *
 *   1. Validate the inbound payload against the schema in Section 4.1 —
 *      the API route only checks "is the body JSON"; we enforce the
 *      enum values, required fields, and custom-field shape.
 *   2. Optionally fire the AI complexity estimation hook (Section 5.16)
 *      once Step 6 wires it up. Today this is a no-op pass-through with
 *      a clearly marked extension point.
 *
 * The repository functions stay the source of truth for storage; this
 * file does NOT reach into JSON files or duplicate any of the persistence
 * logic. It just orchestrates.
 */

import {
  ProjectRepository,
  SettingsRepository,
  UserRepository,
  type CreateProjectInput,
  type CustomFieldDefinition,
  type DocumentLink,
  type ExternalDependency,
  type Priority,
  type Project,
  type ProjectDependency,
  type ProjectId,
  type ProjectPhase,
  type ProjectStatus,
  type ProjectType,
  type StatusHistoryEntry,
  type UpdateProjectInput,
  type UserId,
} from "@/lib/db";
import {
  DependencyValidationError,
  findCycle,
  reconcileDependsOn,
  validateDependencies,
} from "@/lib/projects/dependencies";
import {
  PROJECT_TYPES,
} from "@/lib/projects/display";
import {
  LinkValidationError,
  validateDocumentLinks,
} from "@/lib/projects/links";
import {
  ExternalDependencyValidationError,
  validateExternalDependencies,
} from "@/lib/projects/external-dependencies";
import { invalidateVelocityCache } from "@/lib/velocity/cache";
import { audit, summarizeChanges } from "@/lib/audit/service";
import { todayIso } from "@/lib/db/store";

// ---------------------------------------------------------------------------
// Constants — Status / Priority / Phase remain local because the service
// still gates payloads against the system-defined values (extensions are
// validated separately via the enum_extensions check). Project type now
// reads from the canonical list in lib/projects/display.ts so additions
// like the "Admin" type don't need to be repeated here.
// ---------------------------------------------------------------------------

const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

const PROJECT_STATUSES: ProjectStatus[] = [
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
  "Completed",
  "Canceled",
];

const PROJECT_PHASES: ProjectPhase[] = [
  "Qualification",
  "Prioritization",
  "Planning",
  "Data Modeling",
  "Application Development",
  "Customer Validation",
  "Deployment Readiness",
  "Handover",
  "Closeout",
];

/** Status values that count as "open" in the default Projects-page view. */
export const OPEN_PROJECT_STATUSES: ProjectStatus[] = [
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Inbound shape for project creation. All fields are optional/loose at the
 * type level; `validateCreate` narrows to a `CreateProjectInput` and throws
 * if the payload doesn't conform.
 */
export interface ProjectCreatePayload {
  name?: unknown;
  description?: unknown;
  application_product?: unknown;
  project_type?: unknown;
  priority?: unknown;
  status?: unknown;
  phase?: unknown;
  primary_stakeholders?: unknown;
  project_lead?: unknown;
  additional_resources?: unknown;
  /**
   * Optional per-resource allocation percentages. Keys are the same
   * names / user_ids used in `additional_resources` (or the project
   * lead). Values are 0-100. Missing keys fall back to the org-wide
   * default at read time.
   */
  resource_allocations?: unknown;
  target_date?: unknown;
  roadmap_bucket?: unknown;
  roadmap_timeline_start?: unknown;
  custom_fields?: unknown;
  /**
   * Optional: a `TaskTemplate.template_id` to auto-apply on creation.
   * Stripped from the persisted record — the template's tasks are
   * instantiated as separate Task records (Section 5.19).
   */
  template_id?: unknown;
  /**
   * Step 6 (Section 5.10): two equivalent shapes are accepted.
   * - `dependencies`: full ProjectDependency[] (type + required_phase per row)
   * - `depends_on`:   string[] of upstream IDs; types default to "Blocks Start"
   * If both are present, `dependencies` wins.
   */
  dependencies?: unknown;
  depends_on?: unknown;
  /** Step 6 (Section 5.14): array of {label, url, link_type}. */
  document_links?: unknown;
  /**
   * External dependencies — things outside Praxis we're waiting on
   * (Jira tickets on other teams, vendor work, etc.). Array of
   * `ExternalDependency`-shaped objects; new entries omit the id and
   * created-at fields and the validator stamps them in.
   */
  external_dependencies?: unknown;
}

export interface ProjectUpdatePayload extends ProjectCreatePayload {
  ai_complexity_score?: unknown;
  ai_time_estimate?: unknown;
  /**
   * Optional free-text note attached to a status change. Only
   * persisted when the patch actually flips `status`; if the caller
   * passes `status_summary` without changing `status`, it's silently
   * dropped (no orphan entries in the history). Trimmed; empty /
   * whitespace-only values become `null`.
   */
  status_summary?: unknown;
}

function asString(value: unknown, field: string, opts: { trim?: boolean } = {}): string {
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string.`);
  }
  return opts.trim === false ? value : value.trim();
}

function asOptionalString(value: unknown, field: string): string {
  if (value === undefined || value === null) return "";
  return asString(value, field);
}

function asNullableDate(value: unknown, field: string): string | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be an ISO date string or null.`);
  }
  // Accept either YYYY-MM-DD or full ISO; we normalize to date-only here so
  // the JSON file stays consistent with how the seed data is shaped.
  const trimmed = value.trim();
  if (!/^\d{4}-\d{2}-\d{2}/.test(trimmed)) {
    throw new ValidationError(`${field} must be in YYYY-MM-DD format.`);
  }
  return trimmed.slice(0, 10);
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

function asStringArray(value: unknown, field: string): string[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    throw new ValidationError(`${field} must be an array of strings.`);
  }
  return value.map((v, i) => {
    if (typeof v !== "string") {
      throw new ValidationError(`${field}[${i}] must be a string.`);
    }
    return v.trim();
  });
}

/**
 * Validate the values supplied for admin-defined custom fields against the
 * registered definitions. Unknown keys are dropped silently — a definition
 * could have been removed since the project was last edited, and we don't
 * want stale form data to make a save fail.
 */
function validateCustomFields(
  raw: unknown,
  definitions: CustomFieldDefinition[],
): Record<string, string | number | boolean | null> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("custom_fields must be an object.");
  }
  const out: Record<string, string | number | boolean | null> = {};
  const defByKey = new Map(definitions.map((d) => [d.key, d]));
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    const def = defByKey.get(key);
    if (!def) continue; // drop unknown keys
    if (value === null || value === "") {
      if (def.required) {
        throw new ValidationError(
          `Custom field "${def.label}" is required.`,
        );
      }
      out[key] = null;
      continue;
    }
    switch (def.type) {
      case "text":
        if (typeof value !== "string") {
          throw new ValidationError(`Custom field "${def.label}" must be text.`);
        }
        out[key] = value;
        break;
      case "number": {
        const n = typeof value === "number" ? value : Number(value);
        if (!Number.isFinite(n)) {
          throw new ValidationError(
            `Custom field "${def.label}" must be a number.`,
          );
        }
        out[key] = n;
        break;
      }
      case "boolean":
        out[key] = Boolean(value);
        break;
      case "date":
        out[key] = asNullableDate(value, `custom_fields.${key}`);
        break;
      case "select":
        if (
          typeof value !== "string" ||
          !(def.options ?? []).includes(value)
        ) {
          throw new ValidationError(
            `Custom field "${def.label}" must be one of: ${(def.options ?? []).join(", ")}.`,
          );
        }
        out[key] = value;
        break;
    }
  }
  // Required fields that weren't supplied at all.
  for (const def of definitions) {
    if (def.required && !(def.key in out)) {
      throw new ValidationError(`Custom field "${def.label}" is required.`);
    }
  }
  return out;
}

/**
 * Validate `resource_allocations` — a `Record<string, number>` map
 * keyed by resource identifier (UserId or free-text name) with
 * 0-100 percentages as values.
 *
 * Empty / missing input becomes `{}`. Bad shapes (array, non-object)
 * throw. Bad values (non-numeric, out of range) throw with the
 * offending key in the message so the client form can highlight it.
 *
 * We don't enforce that keys must appear in `additional_resources`
 * — the lead is also a valid key, and the form may stage edits in
 * different order. The roster reads through `lookupAllocationPercent`
 * which only consults entries that match a known resource anyway,
 * so stale keys are harmless.
 */
function validateResourceAllocations(
  raw: unknown,
): Record<string, number> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    throw new ValidationError("resource_allocations must be an object.");
  }
  const out: Record<string, number> = {};
  for (const [key, value] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof key !== "string" || key.length === 0) continue;
    const trimmed = key.trim();
    if (!trimmed) continue;
    if (value === null || value === undefined || value === "") {
      // Treat clear-to-empty as "delete this key" — let the default
      // apply at read time. Skipping the assignment achieves that.
      continue;
    }
    const n = typeof value === "number" ? value : Number(value);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      throw new ValidationError(
        `resource_allocations["${trimmed}"] must be a number between 0 and 100.`,
      );
    }
    out[trimmed] = n;
  }
  return out;
}

async function validateAndShape(
  payload: ProjectCreatePayload,
  ctx: { createdBy: UserId },
): Promise<CreateProjectInput> {
  const settings = await SettingsRepository.get();
  const name = asString(payload.name, "name");
  if (!name) throw new ValidationError("name is required.");
  const description = asOptionalString(payload.description, "description");
  const application_product = asString(
    payload.application_product,
    "application_product",
  );
  if (!application_product) {
    throw new ValidationError("application_product is required.");
  }
  const project_type = asEnum(payload.project_type, PROJECT_TYPES, "project_type");
  const priority = asEnum(payload.priority, PRIORITIES, "priority");
  const status = asEnum(payload.status, PROJECT_STATUSES, "status");
  const phase = asEnum(payload.phase, PROJECT_PHASES, "phase");
  const primary_stakeholders = asStringArray(
    payload.primary_stakeholders,
    "primary_stakeholders",
  );
  const project_lead = asOptionalString(payload.project_lead, "project_lead");
  const additional_resources = asStringArray(
    payload.additional_resources,
    "additional_resources",
  );
  const target_date = asNullableDate(payload.target_date, "target_date");
  const roadmap_bucket =
    payload.roadmap_bucket === undefined || payload.roadmap_bucket === null
      ? null
      : asString(payload.roadmap_bucket, "roadmap_bucket") || null;
  const roadmap_timeline_start = asNullableDate(
    payload.roadmap_timeline_start,
    "roadmap_timeline_start",
  );
  // Same start ≤ target check as updateProject. Validating in both
  // places keeps the invariant honest at every entry point — a user
  // who creates a project via API call (skipping the form's HTML5
  // min/max guard) still gets a clear error rather than a corrupt
  // record.
  if (
    roadmap_timeline_start &&
    target_date &&
    roadmap_timeline_start > target_date
  ) {
    throw new ValidationError(
      `Start date (${roadmap_timeline_start}) cannot be after target date (${target_date}).`,
    );
  }
  const custom_fields = validateCustomFields(
    payload.custom_fields,
    settings.custom_field_definitions,
  );
  const resource_allocations = validateResourceAllocations(
    payload.resource_allocations,
  );

  // --- Dependencies (Section 5.10). At create time `selfId` is null —
  // the project doesn't exist yet, so a self-loop check would have nothing
  // to compare against. We still validate that every upstream ID exists
  // and detect cycles introduced by the new node before write.
  const allProjects = await ProjectRepository.getAll();
  const { dependencies, depends_on } = resolveDependencyShape(
    payload,
    [],
    null,
    allProjects,
  );
  if (depends_on.length > 0) {
    // For a brand-new project, the only cycle that could matter is one
    // formed via the proposed upstreams. `findCycle` synthesizes the new
    // node into the graph so this check is meaningful even pre-creation.
    const cycle = findCycle("__new__", depends_on, allProjects);
    if (cycle) {
      throw new ValidationError(
        `Circular dependency detected: ${cycle.join(" → ")}.`,
      );
    }
  }

  // --- Document links (Section 5.14).
  const document_links = safeValidateLinks(
    payload.document_links,
    [],
    { userId: ctx.createdBy, now: nowIsoTimestamp() },
  );

  // --- External dependencies (Section 5.10 follow-up).
  const external_dependencies = safeValidateExternal(
    payload.external_dependencies,
    [],
    { userId: ctx.createdBy, now: nowIsoTimestamp() },
  );

  return {
    name,
    description,
    application_product,
    project_type,
    priority,
    status,
    phase,
    primary_stakeholders,
    project_lead,
    additional_resources,
    resource_allocations,
    target_date,
    ai_complexity_score: null,
    ai_time_estimate: null,
    roadmap_bucket,
    roadmap_timeline_start,
    github_issue_id: null,
    jira_issue_id: null,
    depends_on,
    dependencies,
    external_dependencies,
    document_links,
    custom_fields,
    created_by: ctx.createdBy,
  };
}

// ---------------------------------------------------------------------------
// Helpers shared by create + update for dependencies and document links.
// ---------------------------------------------------------------------------

/** Current time as an ISO timestamp string — matches `lib/db/store.ts`. */
function nowIsoTimestamp(): string {
  return new Date().toISOString();
}

/**
 * Look up a user's display name for status-history attribution. Cached
 * is fine, but for now we just hit the repo — `users.json` is small
 * and updates are rare. Returns `null` for system actors and for any
 * lookup miss so the history entry remains valid even if the user
 * record was deleted.
 */
async function resolveUserDisplayName(
  userId: UserId,
): Promise<string | null> {
  if (!userId || userId === "system") return null;
  try {
    const user = await UserRepository.getById(userId);
    return user?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve whichever of `dependencies` / `depends_on` the caller sent into
 * the canonical {dependencies, depends_on} pair. Both shapes are wrapped in
 * one helper so the logic for picking-the-richer-shape lives in one place.
 *
 * - If `dependencies` is present: it's the source of truth. We validate it
 *   in full and project `depends_on` from the resulting list.
 * - Else if `depends_on` is present: we reconcile against the existing
 *   dependency entries to preserve their types where the upstream ID is
 *   unchanged, and default new entries to "Blocks Start".
 * - Else: nothing changed, return the existing values unchanged.
 *
 * Throws `ValidationError` (translated from the typed errors in the
 * dependency module) so the caller can surface a single error class.
 */
function resolveDependencyShape(
  payload: ProjectCreatePayload | ProjectUpdatePayload,
  existing: ProjectDependency[],
  selfId: ProjectId | null,
  allProjects: Pick<Project, "project_id">[],
): { dependencies: ProjectDependency[]; depends_on: ProjectId[] } {
  try {
    if (payload.dependencies !== undefined) {
      return validateDependencies(payload.dependencies, selfId, allProjects);
    }
    if (payload.depends_on !== undefined) {
      return reconcileDependsOn(
        payload.depends_on,
        existing,
        selfId,
        allProjects,
      );
    }
    return {
      dependencies: existing,
      depends_on: existing.map((d) => d.upstream_id),
    };
  } catch (err) {
    if (err instanceof DependencyValidationError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}

/**
 * Wrap the link validator to translate its error type into `ValidationError`,
 * matching the rest of the service's error contract.
 */
function safeValidateLinks(
  raw: unknown,
  existing: DocumentLink[],
  ctx: { userId: UserId; now: string },
): DocumentLink[] {
  try {
    return validateDocumentLinks(raw, existing, ctx);
  } catch (err) {
    if (err instanceof LinkValidationError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}

/**
 * Same wrap pattern for the external-dependencies validator. The
 * inner validator accepts a nullable user_id (for system / seed
 * paths); the project service always has a concrete user, so we
 * narrow on the way in.
 */
function safeValidateExternal(
  raw: unknown,
  existing: ExternalDependency[],
  ctx: { userId: UserId | null; now: string },
): ExternalDependency[] {
  try {
    return validateExternalDependencies(raw, existing, ctx);
  } catch (err) {
    if (err instanceof ExternalDependencyValidationError) {
      throw new ValidationError(err.message);
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// AI hook
// ---------------------------------------------------------------------------

/**
 * Hook for the AI Complexity Estimation feature (Section 5.16, Step 6).
 *
 * Today this is a no-op — Step 10 will replace the body with a call to the
 * Anthropic API. The hook is invoked from `createProject` and `updateProject`
 * so the wiring is in place; if it returns null, the project keeps whatever
 * AI fields were already on the record.
 *
 * Kept here (rather than inline in the API route) so the same hook fires
 * for any caller of the service — including the future webhook receivers
 * for GitHub / Jira (Section 11).
 */
export interface AiEstimateResult {
  ai_complexity_score: Project["ai_complexity_score"];
  ai_time_estimate: Project["ai_time_estimate"];
}

export async function estimateComplexity(
  _project: Pick<Project, "name" | "description" | "project_type">,
): Promise<AiEstimateResult | null> {
  // Step 10 will call /api/ai/estimate from here. For now we return null so
  // existing AI fields on the record are preserved unchanged.
  return null;
}

// ---------------------------------------------------------------------------
// Public service surface
// ---------------------------------------------------------------------------

export async function createProject(
  payload: ProjectCreatePayload,
  ctx: { createdBy: UserId; userName?: string | null },
): Promise<Project> {
  // Step 9 (Section 5.15): velocity dashboard caches the metric set under
  // a 1-hour TTL. Any write to the project repo can change the numbers
  // (a new In-Progress project, a Completed update, etc.), so blow the
  // cache so the next dashboard request recomputes. Cheap when the cache
  // is empty; harmless when no one is looking at the dashboard.
  invalidateVelocityCache();
  const input = await validateAndShape(payload, ctx);
  const created = await ProjectRepository.create(input);

  // If the caller supplied a template_id, instantiate it. Failure here
  // does NOT roll back the project — a project missing its starter tasks
  // is a recoverable annoyance; orphaning a project record because one
  // task write failed is worse. The error is logged for debugging.
  if (typeof payload.template_id === "string" && payload.template_id) {
    try {
      // Dynamic import avoids a circular dependency: tasks/service imports
      // ProjectRepository (to verify parent exists), and the project
      // service is what kicks template instantiation off.
      const { instantiateTemplate } = await import("@/lib/tasks/service");
      await instantiateTemplate(payload.template_id, created.project_id);
    } catch (err) {
      console.warn(
        `Template ${payload.template_id} instantiation failed for ${created.project_id}:`,
        err,
      );
    }
  }

  // Step 7 (Section 5.12): if the project starts life Blocked, notify the
  // stakeholders. Treating the prior status as anything-other-than-Blocked
  // gets the right behavior from the helper.
  await fireProjectNotifications(created, "Not Started").catch((err) => {
    console.warn(
      `[notifications] createProject post-hooks failed for ${created.project_id}:`,
      err,
    );
  });

  // Step 8 (Section 5.13): seed the health score immediately on creation.
  // Without this, a new project displays "—" until the first task is
  // added or the daily sweep runs. A fresh project with no tasks evaluates
  // to Green per the scorer (no blocked tasks, no overdue, no inactivity
  // since there's no activity to be late on), so the badge is honest.
  await fireProjectHealthRecalc(created.project_id).catch((err) => {
    console.warn(
      `[health] createProject post-hook failed for ${created.project_id}:`,
      err,
    );
  });

  const ai = await estimateComplexity({
    name: created.name,
    description: created.description,
    project_type: created.project_type,
  });
  let final = created;
  if (ai) {
    final = await ProjectRepository.update(created.project_id, {
      ai_complexity_score: ai.ai_complexity_score,
      ai_time_estimate: ai.ai_time_estimate,
    });
  }

  await audit({
    actorId: ctx.createdBy,
    actorName: ctx.userName,
    entityType: "Project",
    entityId: final.project_id,
    entityLabel: final.name,
    action: "create",
    summary: `Created project (${final.project_type}, ${final.priority} priority, status ${final.status}).`,
  });

  return final;
}

/**
 * Apply a partial patch to a project. The payload is treated as a sparse
 * update — fields that are absent stay as they are. Status-only updates
 * (the inline status edit on the Projects page) flow through here too,
 * which is why the validator is permissive about missing fields.
 */
export async function updateProject(
  id: ProjectId,
  payload: ProjectUpdatePayload,
  ctx: { userId: UserId; userName?: string | null } = { userId: "system" },
): Promise<Project> {
  invalidateVelocityCache(); // Step 9 (Section 5.15) — see createProject.
  const settings = await SettingsRepository.get();
  const patch: UpdateProjectInput = {};

  if (payload.name !== undefined) {
    const name = asString(payload.name, "name");
    if (!name) throw new ValidationError("name cannot be empty.");
    patch.name = name;
  }
  if (payload.description !== undefined) {
    patch.description = asOptionalString(payload.description, "description");
  }
  if (payload.application_product !== undefined) {
    const ap = asString(payload.application_product, "application_product");
    if (!ap) throw new ValidationError("application_product cannot be empty.");
    patch.application_product = ap;
  }
  if (payload.project_type !== undefined) {
    patch.project_type = asEnum(payload.project_type, PROJECT_TYPES, "project_type");
  }
  if (payload.priority !== undefined) {
    patch.priority = asEnum(payload.priority, PRIORITIES, "priority");
  }
  if (payload.status !== undefined) {
    patch.status = asEnum(payload.status, PROJECT_STATUSES, "status");
  }
  if (payload.phase !== undefined) {
    patch.phase = asEnum(payload.phase, PROJECT_PHASES, "phase");
  }
  if (payload.primary_stakeholders !== undefined) {
    patch.primary_stakeholders = asStringArray(
      payload.primary_stakeholders,
      "primary_stakeholders",
    );
  }
  if (payload.project_lead !== undefined) {
    patch.project_lead = asOptionalString(payload.project_lead, "project_lead");
  }
  if (payload.additional_resources !== undefined) {
    patch.additional_resources = asStringArray(
      payload.additional_resources,
      "additional_resources",
    );
  }
  if (payload.resource_allocations !== undefined) {
    patch.resource_allocations = validateResourceAllocations(
      payload.resource_allocations,
    );
  }
  if (payload.target_date !== undefined) {
    patch.target_date = asNullableDate(payload.target_date, "target_date");
  }
  if (payload.roadmap_bucket !== undefined) {
    patch.roadmap_bucket =
      payload.roadmap_bucket === null
        ? null
        : asString(payload.roadmap_bucket, "roadmap_bucket") || null;
  }
  if (payload.roadmap_timeline_start !== undefined) {
    patch.roadmap_timeline_start = asNullableDate(
      payload.roadmap_timeline_start,
      "roadmap_timeline_start",
    );
  }
  if (payload.custom_fields !== undefined) {
    patch.custom_fields = validateCustomFields(
      payload.custom_fields,
      settings.custom_field_definitions,
    );
  }
  if (payload.ai_complexity_score === null) {
    patch.ai_complexity_score = null;
  }
  if (payload.ai_time_estimate === null) {
    patch.ai_time_estimate = null;
  }

  // --- Step 6: dependencies and document links. -----------------------
  // We only need to read the current record / project graph if any of
  // these inputs was supplied; otherwise skip the work to keep the
  // hot path (inline status edit) cheap.
  const dependencyTouched =
    payload.dependencies !== undefined || payload.depends_on !== undefined;
  const linksTouched = payload.document_links !== undefined;
  const externalTouched = payload.external_dependencies !== undefined;

  // Always load the prior record so the post-write notification hook can
  // see the true pre-state. The repositories re-read the JSON file each
  // call, so reading after `ProjectRepository.update` would return the
  // *new* status — making the prior-vs-current comparison vacuously
  // equal and squelching the notification. The cost is one extra file
  // read per update; the file is small and JSON parsing is fast.
  const existing = await ProjectRepository.getById(id);
  if (!existing) throw new ValidationError(`Project ${id} not found.`);

  if (dependencyTouched || linksTouched || externalTouched) {
    if (dependencyTouched) {
      const allProjects = await ProjectRepository.getAll();
      const { dependencies, depends_on } = resolveDependencyShape(
        payload,
        existing.dependencies,
        id,
        allProjects,
      );
      // Cycle check uses the current graph plus the proposed upstream set
      // for `id`. `findCycle` substitutes our proposed list for the project's
      // existing one when computing adjacency, so the check captures cycles
      // introduced by *this* edit specifically.
      const cycle = findCycle(id, depends_on, allProjects);
      if (cycle) {
        throw new ValidationError(
          `Circular dependency detected: ${cycle.join(" → ")}.`,
        );
      }
      patch.dependencies = dependencies;
      patch.depends_on = depends_on;
    }

    if (linksTouched) {
      patch.document_links = safeValidateLinks(
        payload.document_links,
        existing.document_links,
        { userId: ctx.userId, now: nowIsoTimestamp() },
      );
    }

    if (externalTouched) {
      patch.external_dependencies = safeValidateExternal(
        payload.external_dependencies,
        existing.external_dependencies,
        { userId: ctx.userId, now: nowIsoTimestamp() },
      );
    }
  }

  // Status history: any status change appends an entry so the panel's
  // Status tab can show "who flipped this from In Progress to Blocked,
  // and when". The append happens here (service layer, where we know
  // the prior value and the actor) rather than the repository, which
  // is intentionally policy-free. We append to whatever history is
  // already on the record so the entries accumulate; the repository
  // backfills `status_history: []` for older records on read so this
  // spread is safe regardless of source vintage.
  //
  // We also accept *summary-only* updates: the user can leave the
  // status unchanged but attach a free-text note (e.g. "still on
  // track, just slipped a few days for testing"). In that case the
  // entry records `previous_status === status` so the UI can render
  // it as a note-without-status-change cleanly.
  const rawSummary =
    typeof payload.status_summary === "string"
      ? payload.status_summary.trim()
      : "";
  const hasStatusChange =
    patch.status !== undefined && patch.status !== existing.status;
  const hasSummaryOnly = rawSummary.length > 0 && !hasStatusChange;

  if (hasStatusChange || hasSummaryOnly) {
    // The status field on the entry is whichever the project will
    // have after this write — for a status flip that's `patch.status`,
    // for a summary-only update it's `existing.status` (unchanged).
    const newStatus = hasStatusChange
      ? (patch.status as ProjectStatus)
      : existing.status;
    const entry: StatusHistoryEntry = {
      changed_at: nowIsoTimestamp(),
      status: newStatus,
      // For summary-only updates, previous_status === status. The UI
      // detects that and labels the entry "Note added" rather than
      // "X → Y", so the audit trail stays readable.
      previous_status: existing.status,
      changed_by: ctx.userId === "system" ? null : ctx.userId,
      changed_by_name: await resolveUserDisplayName(ctx.userId),
      summary: rawSummary.length > 0 ? rawSummary : null,
    };
    patch.status_history = [...existing.status_history, entry];
  }

  // Auto-set the planned start date when a project transitions from
  // "Not Started" into an active status. The start signal is implicit
  // when work begins ("the project started today") so tracking it
  // manually is friction; we only fire when:
  //
  //   - status is changing this update (not a summary-only edit), AND
  //   - prior status was "Not Started" (only this transition; later
  //     re-entries to active states don't reset history), AND
  //   - new status is one of In Progress / Blocked / Delayed (work
  //     genuinely begun — In Planning is pre-work, Completed/Canceled/
  //     On Hold/Delayed back to Not Started don't fit), AND
  //   - the field isn't already set (user override wins), AND
  //   - the user isn't setting it explicitly in this same patch.
  //
  // In Planning is intentionally excluded: planning is pre-work; the
  // start date should mark the moment work actually begins.
  const ACTIVE_STATUSES_FOR_AUTO_START: ProjectStatus[] = [
    "In Progress",
    "Blocked",
    "Delayed",
  ];
  if (
    hasStatusChange &&
    existing.status === "Not Started" &&
    ACTIVE_STATUSES_FOR_AUTO_START.includes(patch.status as ProjectStatus) &&
    existing.roadmap_timeline_start === null &&
    payload.roadmap_timeline_start === undefined
  ) {
    patch.roadmap_timeline_start = todayIso();
  }

  // Validate that start ≤ target when both are set. Use the merged
  // post-write values rather than only the patch — if the user is
  // setting only one of the two, we must compare against the existing
  // value of the other.
  const finalStart =
    patch.roadmap_timeline_start !== undefined
      ? patch.roadmap_timeline_start
      : existing.roadmap_timeline_start;
  const finalTarget =
    patch.target_date !== undefined ? patch.target_date : existing.target_date;
  if (finalStart && finalTarget && finalStart > finalTarget) {
    throw new ValidationError(
      `Start date (${finalStart}) cannot be after target date (${finalTarget}).`,
    );
  }

  const updated = await ProjectRepository.update(id, patch);

  // Step 7 (Section 5.12): fire status-change and dependency notifications
  // based on the transition this update produced. The hook is responsible
  // for filtering out no-op transitions (status stayed the same).
  await fireProjectNotifications(updated, existing.status).catch((err) => {
    console.warn(
      `[notifications] updateProject post-hooks failed for ${id}:`,
      err,
    );
  });

  // Step 8 (Section 5.13): recalc this project's health and, if its
  // status flipped, the health of every downstream project that depends
  // on it. The downstream cascade is what keeps the dependency-rollup
  // input to the scorer in sync — without it, moving an upstream to
  // Blocked would notify dependents (Step 7) but their health badges
  // would lag behind until the next daily sweep.
  await fireProjectHealthRecalc(id).catch((err) => {
    console.warn(
      `[health] updateProject post-hook failed for ${id}:`,
      err,
    );
  });
  if (existing.status !== updated.status) {
    await fireDownstreamHealthRecalc(id).catch((err) => {
      console.warn(
        `[health] updateProject downstream cascade failed for ${id}:`,
        err,
      );
    });
  }

  // If the AI-relevant fields changed, re-estimate. (Description is the main
  // driver per Section 5.16; project_type and name also matter.)
  const aiRelevantChanged =
    "name" in patch || "description" in patch || "project_type" in patch;
  if (aiRelevantChanged) {
    const ai = await estimateComplexity({
      name: updated.name,
      description: updated.description,
      project_type: updated.project_type,
    });
    if (ai) {
      await ProjectRepository.update(id, {
        ai_complexity_score: ai.ai_complexity_score,
        ai_time_estimate: ai.ai_time_estimate,
      });
    }
  }

  // PROJ-05: re-fetch from the repository so the response carries any
  // mutations applied by post-hooks above. The local `updated` was
  // captured BEFORE `fireProjectHealthRecalc` wrote a new health score,
  // so returning it directly leaves the caller (and its optimistic UI)
  // showing a stale health badge until the next page load.
  const fresh = await ProjectRepository.getById(id);

  // Audit log: emit one of two flavors. A status-only change gets a
  // dedicated `status_change` action so the audit page can chip-filter
  // on transitions without scanning summary text. Anything else
  // (including mixed status + other fields) lands as a generic
  // `update` with a one-line diff.
  const isStatusOnly =
    hasStatusChange &&
    Object.keys(patch).every((k) => k === "status" || k === "status_history");
  if (isStatusOnly) {
    await audit({
      actorId: ctx.userId,
      actorName: ctx.userName,
      entityType: "Project",
      entityId: id,
      entityLabel: updated.name,
      action: "status_change",
      summary: `Status: ${existing.status} → ${updated.status}${
        rawSummary.length > 0 ? ` — ${rawSummary}` : ""
      }`,
    });
  } else if (Object.keys(patch).length > 0) {
    await audit({
      actorId: ctx.userId,
      actorName: ctx.userName,
      entityType: "Project",
      entityId: id,
      entityLabel: updated.name,
      action: "update",
      summary: summarizeChanges(
        existing as unknown as Record<string, unknown>,
        updated as unknown as Record<string, unknown>,
        {
          fields: [
            "name",
            "status",
            "phase",
            "priority",
            "project_type",
            "application_product",
            "project_lead",
            "target_date",
            "roadmap_timeline_start",
            "roadmap_bucket",
            "ai_complexity_score",
            "external_dependencies",
          ],
        },
      ),
    });
  }

  return fresh ?? updated;
}

export async function deleteProject(
  id: ProjectId,
  ctx: { userId: UserId; userName?: string | null } = { userId: "system" },
): Promise<void> {
  invalidateVelocityCache(); // Step 9 (Section 5.15) — see createProject.
  // Step 8: capture the set of downstreams *before* the delete, since
  // `ProjectRepository.delete` prunes them out of the project graph as
  // part of its cleanup. After the delete we recalc each former
  // downstream so the dependency-rollup input refreshes — a project
  // whose only blocking upstream just disappeared should likely move
  // back toward Green.
  const all = await ProjectRepository.getAll();
  const target = all.find((p) => p.project_id === id);
  const formerDownstreams = all
    .filter((p) => p.depends_on.includes(id))
    .map((p) => p.project_id);

  await ProjectRepository.delete(id);

  // Project groups (§5.x) store their membership as a text[] on each
  // group row, so the FK cascade from public.tasks → public.projects
  // can't reach them. Prune the deleted project's ID from every group
  // it belonged to before this point, mirroring the
  // `depends_on` cleanup that ProjectRepository.delete already does
  // for the dependency graph. Imported lazily because lib/projects
  // is also imported by the group service path; doing it inside the
  // function keeps the module graph acyclic.
  try {
    const { pruneProjectFromGroups } = await import(
      "@/lib/project-groups/service"
    );
    await pruneProjectFromGroups(id);
  } catch (err) {
    // Best-effort: a failure here leaves a dangling ID in a group's
    // member list, which the UI tolerates (it filters unresolved IDs
    // out at render time). Log and continue rather than failing the
    // whole delete, which is harder to recover from.
    console.warn(
      `[project-groups] pruneProjectFromGroups failed for ${id}:`,
      err,
    );
  }

  for (const downId of formerDownstreams) {
    try {
      await fireProjectHealthRecalc(downId);
    } catch (err) {
      console.warn(
        `[health] deleteProject downstream recalc failed for ${downId}:`,
        err,
      );
    }
  }

  await audit({
    actorId: ctx.userId,
    actorName: ctx.userName,
    entityType: "Project",
    entityId: id,
    entityLabel: target?.name ?? id,
    action: "delete",
    summary: target
      ? `Deleted project "${target.name}" (was ${target.status}).`
      : `Deleted project ${id}.`,
  });
}

// ---------------------------------------------------------------------------
// Step 7 — notification hooks (Section 5.12)
// ---------------------------------------------------------------------------

/**
 * Compute and dispatch every notification implied by a project transition.
 * Runs after the write so the persisted state matches what gets messaged.
 *
 * Notifications fired:
 *
 *   - `ProjectBlocked` when the status changed *into* `Blocked` from
 *     anything else (including from `Blocked → Blocked` no-ops, which we
 *     filter inside `notifyProjectStatusChange`).
 *   - `DependencyBlocked` to the stakeholders of every project whose
 *     `depends_on` array contains this project, when the status moved into
 *     a problematic state (`Blocked` / `On Hold` / `Delayed`). We *do not*
 *     fire on `Completed` even though that's also a "transition out of
 *     active" — completion is always a clear, never a problem.
 *
 * Failures are caught at the call site (`createProject`/`updateProject`)
 * so a missing user or an offline mailer can't roll back the project save.
 */
async function fireProjectNotifications(
  project: Project,
  priorStatus: ProjectStatus,
): Promise<void> {
  // Use dynamic import to avoid pulling notification machinery into the
  // build graph for environments that don't run the server (lint runs,
  // pure type-checking) and to break a potential import cycle since
  // `lib/notifications/service.ts` already imports `lib/db`.
  const {
    notifyProjectStatusChange,
    notifyDependencyBlocked,
  } = await import("@/lib/notifications/service");

  await notifyProjectStatusChange({ project, priorStatus });

  // Only notify downstream dependents on a fresh transition into an
  // unhealthy state. Without this guard, every save of an already-
  // Blocked project would re-fire the dependency notification.
  const newlyUnhealthy =
    (project.status === "Blocked" ||
      project.status === "On Hold" ||
      project.status === "Delayed") &&
    priorStatus !== project.status;
  if (newlyUnhealthy) {
    await notifyDependencyBlocked({ upstream: project });
  }
}

// ---------------------------------------------------------------------------
// Step 8 — health-score recalc hooks (Section 5.13)
// ---------------------------------------------------------------------------

/**
 * Recompute one project's health score and persist it. Mirrors the
 * dynamic-import shape the notification hooks use, for the same reasons:
 * keep the health module out of the type-only build paths and avoid a
 * potential import cycle through `lib/db`.
 */
async function fireProjectHealthRecalc(projectId: ProjectId): Promise<void> {
  const { recalculateAndPersist } = await import("@/lib/health");
  await recalculateAndPersist(projectId);
}

/**
 * Recompute every downstream's health score after this project's status
 * changed. The downstream's health depends on the upstream-health rollup
 * (Section 5.10), which depends on the upstream's status. A status flip
 * therefore needs to fan out to dependent projects so their badges
 * refresh in the same write — without this, downstreams would lag until
 * the next daily sweep recalculated them.
 */
async function fireDownstreamHealthRecalc(
  upstreamId: ProjectId,
): Promise<void> {
  const { recalculateDownstreams } = await import("@/lib/health");
  await recalculateDownstreams(upstreamId);
}
