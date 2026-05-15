/**
 * Shared TypeScript interfaces for every entity persisted by the IIM
 * application. These types are the single source of truth used by:
 *
 *   - the data access layer in `lib/db/*` (repository function signatures);
 *   - API routes that accept or return entity payloads;
 *   - React components that render entity data.
 *
 * Field definitions follow the data model in Section 4 of the design
 * document. ID formats and enum values are reproduced verbatim from the
 * doc so the JSON store can be inspected and hand-edited without a schema
 * mismatch.
 *
 * When the storage backend is swapped from JSON files to a database
 * (Phase 2, Section 10), these interfaces become the input to the schema
 * generator (Prisma, Drizzle, etc.) and remain the contract that every
 * caller of `lib/db/*` depends on.
 */

// ---------------------------------------------------------------------------
// Branded ID aliases
// ---------------------------------------------------------------------------
//
// IDs are plain strings at runtime, but the format depends on the entity:
//
//   ProjectId     `YYYY-NNN`     e.g. `2026-001`
//   TaskId        `YY-NNNN`      e.g. `26-0001`
//   UserId        UUID
//   IdeaId        UUID
//   TemplateId    UUID
//   NotificationId, DecisionEntryId  UUID
//
// We alias them as plain `string` here rather than branded types so JSON
// round-trips work without runtime tagging. The format is enforced by the
// repository's `create` function, not by the type system.

export type ProjectId = string;
export type TaskId = string;
export type UserId = string;
export type IdeaId = string;
export type TemplateId = string;
export type NotificationId = string;
export type DecisionEntryId = string;
export type AuditEntryId = string;

/** ISO 8601 timestamp string (e.g. `2026-04-23T14:30:00Z`). */
export type IsoTimestamp = string;

/** ISO 8601 date string (calendar date, no time component). */
export type IsoDate = string;

// ---------------------------------------------------------------------------
// Enums (Section 4 + Appendix C)
// ---------------------------------------------------------------------------

/**
 * Project Type (Section 4.1).
 *
 * The values listed below are the system-defined defaults — every IIM
 * deployment ships with these. An Admin can add additional values from
 * Admin Console → Project values, which are stored separately in
 * `settings.enum_extensions` and merged into dropdowns at render time.
 *
 * Type-level note: we declare this as `"<literal>" | (string & {})` so
 * TypeScript still surfaces the built-in values in autocomplete and
 * narrowing, but the type also accepts arbitrary strings — the admin
 * extensions. The `(string & {})` indirection is the standard trick to
 * avoid the compiler collapsing the union back into bare `string`.
 *
 * Code that branches on a specific built-in literal (e.g. health.ts
 * comparing status to "Blocked") continues to work unchanged because
 * those literals are still members of the union. New code that needs
 * to enumerate the runtime list should call `getEnumOptions(...)` from
 * `lib/projects/enum-options.ts` instead of iterating the constant
 * arrays in `lib/projects/display.ts`.
 */
export type ProjectType =
  | "New Application"
  | "New Feature"
  | "New Prototype"
  | "Enhancement"
  | "Admin"
  | (string & {});

export type Priority =
  | "Critical"
  | "High"
  | "Medium"
  | "Low"
  | (string & {});

export type ProjectStatus =
  | "Not Started"
  | "In Planning"
  | "In Progress"
  | "Blocked"
  | "On Hold"
  | "Delayed"
  | "Completed"
  | "Canceled"
  | (string & {});

export type ProjectPhase =
  | "Qualification"
  | "Prioritization"
  | "Planning"
  | "Data Modeling"
  | "Application Development"
  | "Customer Validation"
  | "Deployment Readiness"
  | "Handover"
  | "Closeout"
  | (string & {});

export type TaskStatus =
  | "Not Started"
  | "In Progress"
  | "Blocked"
  | "Delayed"
  | "On Hold"
  | "Complete"
  | "Canceled";

export type ComplexityScore = "Low" | "Medium" | "High" | "Very High";

export type HealthScore = "Red" | "Yellow" | "Green";

export type DocumentLinkType =
  | "GitHub Repo"
  | "GitHub PR"
  | "Confluence"
  | "Network Drive"
  | "SharePoint"
  | "Figma"
  | "Miro"
  | "Jira Issue"
  | "External"
  | "Other";

export type DependencyType = "Blocks Start" | "Blocks Phase";

export type DecisionType =
  | "Scope Change"
  | "Priority Change"
  | "Timeline Change"
  | "Resource Change"
  | "Technical Decision"
  | "Other";

export type NotificationType =
  | "TaskAssigned"
  | "TaskDueSoon"
  | "TaskOverdue"
  | "ProjectBlocked"
  | "DependencyBlocked"
  | "HealthScoreChanged"
  | "IdeaStatusChanged";

export type NotificationEntityType = "Project" | "Task" | "Idea";

export type NotificationDelivery = "InAppOnly" | "EmailAndInApp" | "Off";

export type IdeaUrgency = "Low" | "Medium" | "High" | "Critical";

export type IdeaStatus =
  | "New"
  | "Under Review"
  | "Approved"
  | "Rejected"
  | "Converted";

export type UserRole = "Admin" | "Project Lead" | "Team Member" | "Viewer";

// ---------------------------------------------------------------------------
// Shared embedded shapes
// ---------------------------------------------------------------------------

/**
 * A labeled link to an external resource (repository, doc, design file, etc).
 * Stored as an array on Project and Task records (Section 5.14).
 */
export interface DocumentLink {
  label: string;
  url: string;
  link_type: DocumentLinkType;
  added_by: UserId;
  added_at: IsoTimestamp;
}

/**
 * Detailed dependency record stored on the dependent project. Section 4.1
 * places this on the Project itself rather than in a separate join table,
 * which keeps the JSON store at the seven files defined in Section 3.3.
 */
export interface ProjectDependency {
  upstream_id: ProjectId;
  type: DependencyType;
  /** Required only when `type` is `"Blocks Phase"`; null otherwise. */
  required_phase: ProjectPhase | null;
}

/**
 * External dependency on something we don't own — a Jira ticket in
 * another team's project, a vendor commitment, a SaaS feature
 * request. Distinct from `ProjectDependency` (which is
 * project→project inside Praxis) because there's no internal record
 * to point at and the resolution criterion isn't "reaches a phase"
 * — it's "the external team marks it done."
 *
 * Stored as an array on the Project record. Each entry carries the
 * minimum the team needs to remember the dependency exists and
 * follow up on it. The whole shape is loosely structured (free-text
 * fields) because external systems vary wildly.
 */
export type ExternalDependencyStatus = "Open" | "In Progress" | "Resolved";

export interface ExternalDependency {
  external_dependency_id: string;
  /** Short title — e.g. "Search API v2 wildcards". */
  label: string;
  /** Optional long-form context. */
  description: string;
  /** Who's responsible upstream — team name, vendor, person, etc. */
  owner: string;
  /** Optional link to a tracking item (Jira, GitHub issue, vendor portal). */
  url: string | null;
  status: ExternalDependencyStatus;
  /** Expected resolution date if upstream gave one; null otherwise. */
  target_date: IsoDate | null;
  created_at: IsoTimestamp;
  /** UserId who added the dependency. `null` for legacy / system seeds. */
  created_by: UserId | null;
  /** Set when status transitions to Resolved; null while still Open / In Progress. */
  resolved_at: IsoTimestamp | null;
}

/**
 * One snapshot of a project's health score. Stored as a rolling array on
 * the Project record (Section 5.13). Capped to roughly 30 entries by the
 * repository write path.
 */
export interface HealthScoreSnapshot {
  date: IsoDate;
  score: HealthScore;
}

/**
 * A single entry in a project's status history (panel "Status" tab,
 * shown newest-first). Recorded each time the project's `status`
 * changes — service layer in `lib/projects/service.ts` appends an
 * entry inside `updateProject` when the incoming patch flips the
 * field.
 *
 * `changed_by` is the canonical UserId; `changed_by_name` carries the
 * display name at the time of the change so the panel can render
 * "by Jane Doe" without joining against `users.json`. If the user
 * record is later renamed or removed, the historical entry still
 * shows the name they had when they made the change. `null` for
 * system-driven updates (cron, migrations).
 *
 * `previous_status` is denormalized for clarity in the UI ("Open →
 * In Progress") and to make the history readable even if intermediate
 * entries are ever pruned.
 *
 * `summary` is an optional free-text note the user can attach when
 * making the change (e.g. "Stalled waiting on legal review"). It's
 * archived alongside the status so the history shows *why* alongside
 * *what*. Always trimmed; empty/whitespace-only values are stored as
 * `null`.
 */
export interface StatusHistoryEntry {
  changed_at: IsoTimestamp;
  status: ProjectStatus;
  previous_status: ProjectStatus | null;
  changed_by: UserId | null;
  changed_by_name: string | null;
  summary: string | null;
}

/**
 * A user-defined custom field added through the Admin Console (Section 5.19).
 * Custom field *definitions* live in `AppSettings.custom_field_definitions`;
 * the *values* are stored on each project keyed by the definition's `key`.
 */
export type CustomFieldType = "text" | "number" | "date" | "boolean" | "select";

export interface CustomFieldDefinition {
  key: string;
  label: string;
  type: CustomFieldType;
  /** Populated only when `type === "select"`. */
  options?: string[];
  required?: boolean;
}

/** Per-user notification preferences (Section 5.12). */
export type NotificationPreferences = Record<
  NotificationType,
  NotificationDelivery
>;

// ---------------------------------------------------------------------------
// Project (Section 4.1)
// ---------------------------------------------------------------------------

export interface Project {
  /** `YYYY-NNN` — auto-incremented within the year of creation. */
  project_id: ProjectId;
  name: string;
  /** Full description; consumed by the AI complexity scorer (Section 5.16). */
  description: string;
  /** e.g. `"Automated Insights"`, `"Complaints"`. Free-form. */
  application_product: string;
  project_type: ProjectType;
  date_added: IsoDate;
  priority: Priority;
  status: ProjectStatus;
  phase: ProjectPhase;
  primary_stakeholders: string[];
  project_lead: UserId;
  /** Mix of UserIds and free-form names is permitted (Section 4.1). */
  additional_resources: string[];
  /**
   * Per-resource allocation as a percent of their time committed to
   * this project (0-100). Keyed by the same strings used in
   * `additional_resources`, plus the project_lead. Missing entries
   * fall back to `AppSettings.resource_settings.default_allocation_percent`
   * — so a project that's never had allocations set still produces
   * sensible workload numbers.
   *
   * Stored as a flat map (not paired with the names array) so adding
   * or removing a resource doesn't have to keep two arrays in sync.
   * The Resources page reads it through a helper that defaults
   * silently; the project form exposes it via a small inline editor.
   */
  resource_allocations: Record<string, number>;
  target_date: IsoDate | null;

  // ---- AI fields (Section 5.16) ----
  ai_complexity_score: ComplexityScore | null;
  /** Free-form, e.g. `"4-6 weeks"`. */
  ai_time_estimate: string | null;

  // ---- Roadmap fields (Section 5.4 / 5.5 / 5.7) ----
  /** Free-form bucket for Kanban grouping, e.g. `"Now"`, `"Sprint 12"`. */
  roadmap_bucket: string | null;
  /**
   * Planned (or actual) start date for the project. Surfaced in the UI
   * as "Start date" — `roadmap_timeline_start` is the original storage
   * name from when this field only fed the Timeline view. It is now
   * a first-class planning input:
   *
   *   - The Now/Next/Later view uses it as the primary signal for
   *     bucket placement (start ≤ ~14d → Now; ≤ ~90d → Next; else
   *     Later). Without it, the view falls back to status + target
   *     date heuristics.
   *   - The Timeline (Gantt) view uses it for the bar's left edge.
   *   - The Capacity view uses it to tile resource assignments.
   *   - The Velocity dashboard uses it (when present) to compute
   *     cycle time, distinct from the lead-time metric (which uses
   *     `date_added`).
   *
   * Optional. The system auto-sets this to today when a project
   * transitions out of "Not Started" into an active status (In
   * Progress / Blocked / Delayed) AND the field is currently null —
   * intentionally not overwriting any value the user already set.
   */
  roadmap_timeline_start: IsoDate | null;

  // ---- Future integration (Section 8) ----
  github_issue_id: string | null;
  jira_issue_id: string | null;

  // ---- Health score (Section 5.13) ----
  health_score: HealthScore | null;
  /** Rolling 30-day history for the sparkline. */
  health_score_history: HealthScoreSnapshot[];

  /**
   * Append-only log of every `status` change, newest-first by service
   * convention. Surfaced on the project panel's "Status" tab. Each
   * entry records who made the change, when, and what the prior value
   * was — gives the team a paper trail for "why did this go from In
   * Progress back to Blocked?" without needing to scrape decisions.
   */
  status_history: StatusHistoryEntry[];

  // ---- Dependencies (Section 5.10) ----
  /** Denormalized convenience: upstream IDs only. Mirror of `dependencies`. */
  depends_on: ProjectId[];
  /** Source of truth for dependency type and required phase. */
  dependencies: ProjectDependency[];
  /**
   * Things we're waiting on that live outside Praxis — Jira tickets
   * on other teams, vendor deliveries, SaaS feature requests, etc.
   * Distinct from `dependencies` (which references other Praxis
   * projects) because there's no internal record to link to.
   */
  external_dependencies: ExternalDependency[];

  // ---- Other ----
  document_links: DocumentLink[];
  /** Admin-defined custom field values, keyed by `CustomFieldDefinition.key`. */
  custom_fields: Record<string, string | number | boolean | null>;
  created_by: UserId;
  updated_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Task (Section 4.2)
// ---------------------------------------------------------------------------

export interface Task {
  /** `YY-NNNN` — auto-incremented. */
  task_id: TaskId;
  project_id: ProjectId;
  task_name: string;
  detailed_description: string;
  status: TaskStatus;
  priority: Priority;
  responsible: UserId;
  /** Mix of UserIds and free-form names is permitted (Section 4.2). */
  additional_assignees: string[];
  target_date: IsoDate | null;
  blocked: boolean;
  blocker_issue_task: string;
  /**
   * What kind of thing is blocking this task. `null` when the task
   * isn't blocked or when the user hasn't classified the blocker
   * (older records, free-text-only entries). Drives the form-modal
   * picker: "task" → show a Task picker, "project" → show a Project
   * picker, "other" → free-text only.
   */
  blocker_type: "task" | "project" | "other" | null;
  /** Set when `blocker_type === "task"`. */
  blocker_task_id: TaskId | null;
  /** Set when `blocker_type === "project"`. */
  blocker_project_id: ProjectId | null;
  comments: string;
  /**
   * Append-only log of comment edits — recorded each time the
   * `comments` field changes, for the same audit-trail reason as
   * project status history. Newest is appended last; the UI reverses
   * for display. Each entry stores the full comment text at that
   * point so consumers can see what was said when, even if comments
   * are later cleared.
   */
  comment_history: TaskCommentEntry[];
  document_links: DocumentLink[];
  /**
   * Optional time estimate in hours. Decimal allowed (0.5 = 30 minutes,
   * 1.25 = 75 minutes). Null when unset. Surfaced in the Tasks table,
   * task form, and quick view; deliberately NOT factored into the
   * Velocity dashboard at this point — task-level estimates aren't yet
   * a system of record we'd want roll-up reporting against.
   *
   * The field is named `estimate_hours` rather than just `hours` so a
   * future `actual_hours` (recorded after the task completes, for
   * estimation-accuracy tracking) has an obvious place to live.
   */
  estimate_hours: number | null;
  /** Set when the task was instantiated from a TaskTemplate. */
  template_id: TemplateId | null;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * One snapshot in a task's comment history. `text` is the full
 * comment value at the time of the change (not a delta), so any
 * single entry can be read in isolation. `previous_text` is
 * denormalized for the UI to show "before / after"; `null` for the
 * first entry on a task.
 */
export interface TaskCommentEntry {
  changed_at: IsoTimestamp;
  text: string;
  previous_text: string | null;
  changed_by: UserId | null;
  changed_by_name: string | null;
}

// ---------------------------------------------------------------------------
// Task templates (Section 4.3)
// ---------------------------------------------------------------------------

/** One task definition inside a template. The doc does not specify a stable
 * ID for these, so we omit it; tasks created from templates get fresh IDs. */
export interface TaskTemplateItem {
  name: string;
  description: string;
  default_priority: Priority;
}

export interface TaskTemplate {
  template_id: TemplateId;
  template_name: string;
  /** The project type this template is offered for during project creation. */
  project_type: ProjectType;
  /** Ordered list of task definitions. Order is preserved on instantiation. */
  tasks: TaskTemplateItem[];
  created_by: UserId;
}

// ---------------------------------------------------------------------------
// Decision log (Section 4.4)
// ---------------------------------------------------------------------------

/**
 * One immutable entry in a project's Decision & Change Log (Section 5.11).
 * Stored in `decisions.json`, scoped to its parent project by `project_id`.
 * Append-only: never updated after creation.
 */
export interface DecisionLogEntry {
  entry_id: DecisionEntryId;
  project_id: ProjectId;
  entry_date: IsoDate;
  decision_summary: string;
  rationale: string;
  made_by: UserId;
  decision_type: DecisionType;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Audit log (Step 13 — Section 5.19 "Audit Log")
// ---------------------------------------------------------------------------

/**
 * Categories of entities the audit log tracks. Kept narrower than the
 * notification entity types because the audit log also covers admin-only
 * resources (users, settings) that never surface in notifications.
 */
export type AuditEntityType =
  | "Project"
  | "Task"
  | "Idea"
  | "User"
  | "Decision"
  | "Template"
  | "Settings";

/**
 * What happened to the entity. Verbs are kept generic — the granular
 * "what changed" detail goes in `summary`. The action codes feed the
 * filter chips on the audit-log page, so adding a new one means a new
 * chip appears automatically.
 */
export type AuditAction =
  | "create"
  | "update"
  | "delete"
  | "status_change"
  | "convert"
  | "invite"
  | "deactivate"
  | "activate"
  | "role_change"
  | "password_reset";

/**
 * One row in the audit log. Append-only — entries are never updated or
 * deleted by application code. (A retention policy could prune the file
 * later, mirroring the notifications 90-day purge in Appendix A, but the
 * Step 13 brief doesn't require one.)
 *
 * `actor_id` may be `null` for system-driven changes (cron sweep, seed
 * scripts, migrations). `actor_name` is denormalized for the same reason
 * `StatusHistoryEntry.changed_by_name` is — the page shows "Jane Doe"
 * without joining against `users.json`, and stays readable even if the
 * user is later renamed or deactivated.
 *
 * `summary` is a short, human-readable description of what changed
 * (e.g. `"Status: In Progress → Blocked"`, `"Created project Foo"`).
 * It's the cell shown in the table; longer detail (full diff) isn't
 * captured at this layer — we don't want the audit file to balloon.
 */
export interface AuditLogEntry {
  entry_id: AuditEntryId;
  occurred_at: IsoTimestamp;
  actor_id: UserId | null;
  actor_name: string | null;
  entity_type: AuditEntityType;
  entity_id: string;
  /** Human-readable label for the entity (project name, task name, etc.). */
  entity_label: string;
  action: AuditAction;
  summary: string;
}

// ---------------------------------------------------------------------------
// Notifications (Section 4.5)
// ---------------------------------------------------------------------------

export interface Notification {
  notification_id: NotificationId;
  user_id: UserId;
  type: NotificationType;
  message: string;
  entity_type: NotificationEntityType;
  /** ProjectId, TaskId, or IdeaId depending on `entity_type`. */
  entity_id: string;
  read: boolean;
  created_at: IsoTimestamp;
}

// ---------------------------------------------------------------------------
// Project ideas (Section 4.6)
// ---------------------------------------------------------------------------

export interface ProjectIdea {
  idea_id: IdeaId;
  submitter_name: string;
  submitter_email: string | null;
  idea_name: string;
  description: string;
  urgency: IdeaUrgency;
  requested_target_date: IsoDate | null;
  key_stakeholders: string;
  submitted_at: IsoTimestamp;
  status: IdeaStatus;
  admin_comments: string;
  /** Set when the idea was promoted to a project; null otherwise. */
  converted_to_project_id: ProjectId | null;
  /** Cached Claude analysis from the most recent overlap check. */
  ai_overlap_analysis: string | null;
}

// ---------------------------------------------------------------------------
// Users (Section 4.7 + Section 6)
// ---------------------------------------------------------------------------

/**
 * Application profile for a signed-in user.
 *
 * Identity (email/password/invite tokens) is owned by Supabase Auth
 * (`auth.users`); this table holds the app-specific fields the rest
 * of the system reads through the session resolver. `user_id` matches
 * `auth.users.id`.
 *
 * The previous regime stored a bcrypt `password_hash`, `invite_token`,
 * and `password_reset_token` here. Those columns were dropped in
 * migration 0002 when identity moved to Supabase Auth — the
 * recovery / invite flows now go through
 * `supabase.auth.admin.generateLink` and Supabase's own email layer.
 */
export interface User {
  user_id: UserId;
  email: string;
  name: string;
  role: UserRole;
  active: boolean;
  notification_preferences: NotificationPreferences;
  /** Opt-in for the daily digest email instead of per-event delivery. */
  digest_mode: boolean;
  created_at: IsoTimestamp;
  updated_at: IsoTimestamp;
}

/**
 * Public-facing user shape. Historically this stripped secret fields
 * (`password_hash`, invite/reset tokens). Those fields no longer
 * exist on `User`, so the public shape is now identical — kept as a
 * type alias so call sites that use it stay clear about intent.
 */
export type PublicUser = User;

// ---------------------------------------------------------------------------
// App settings (single object in settings.json)
// ---------------------------------------------------------------------------

/** Health score thresholds, configurable in the Admin Console (Section 5.13). */
export interface HealthScoreThresholds {
  /** Percent of tasks blocked-or-overdue at or above which score is Yellow. */
  yellow_blocked_or_overdue_pct: number;
  /** Percent at or above which score is Red. */
  red_blocked_or_overdue_pct: number;
  /** Days of inactivity that trigger Yellow. */
  yellow_inactivity_days: number;
  /** Days remaining to target_date at or below which Yellow is considered. */
  yellow_target_date_proximity_days: number;
  /** Open-task percentage paired with target proximity to qualify for Yellow. */
  yellow_open_tasks_pct: number;
  /**
   * Percent of *open* tasks whose own target_date falls within
   * `yellow_target_date_proximity_days` at or above which the project
   * scores Yellow (HLTH-02). Distinct from `yellow_open_tasks_pct`,
   * which is paired with the *project's* target_date — this trigger
   * fires when individual tasks have nearby deadlines, even when the
   * project itself has none. Default 30% mirrors §5.13's narrative.
   */
  yellow_due_soon_tasks_pct: number;
}

/** Branding applied to PPTX exports (Section 5.9). */
export interface BrandingConfig {
  logo_url: string | null;
  primary_color: string;
  secondary_color: string;
  font: string;
}

/** Org-wide notification defaults, applied to new users (Section 5.12). */
export interface NotificationDefaults {
  per_type: NotificationPreferences;
  digest_mode: boolean;
}

/**
 * One saved Kanban board configuration (Section 5.5).
 *
 * Users can save the current set of column-defining and swimlane fields under
 * a name and recall it later. The set of supported `column_field` /
 * `swimlane_field` values is enumerated in `lib/roadmap/kanban-fields.ts`;
 * we keep the storage shape loose (string keys) so the settings file stays
 * forward-compatible if the field list grows.
 *
 * `column_order` is optional and only meaningful for `column_field`
 * "roadmap_bucket": it locks the left-to-right order of user-defined buckets,
 * since those don't have a natural enum ordering. For all other column
 * fields the order is derived from the enum definition.
 */
export interface SavedKanbanConfig {
  config_id: string;
  name: string;
  /** The Project field that defines columns. */
  column_field: string;
  /** Optional second-axis grouping; null means single-axis Kanban. */
  swimlane_field: string | null;
  /** Per-column WIP cap, keyed by column value. Empty when unused. */
  wip_limits: Record<string, number>;
  /**
   * Manual order for `roadmap_bucket` columns. Empty when not in use or
   * when `column_field` is a fixed-enum field.
   */
  column_order: string[];
  created_by: UserId;
  created_at: IsoTimestamp;
}

/**
 * Stored mapping of role -> permission keys (Section 4.7).
 *
 * Defined here as a string-keyed map rather than importing the typed
 * `PermissionKey` from `lib/auth/role-permissions` to avoid a circular
 * dependency between `lib/db` and `lib/auth`. The auth layer normalizes
 * this object on read against its catalog and replaces any unknown keys
 * with the documented defaults — so a hand-edited settings.json can't
 * crash the app.
 *
 * Admin's entry is informational; the runtime always treats Admin as
 * having every permission, regardless of what's stored.
 */
export type RolePermissionsMap = Record<UserRole, string[]>;

/**
 * The four project-record enums an Admin can extend at runtime. Each
 * has a code-defined set of "system" values (locked, semantically
 * load-bearing) plus an admin-curated list of additional values.
 *
 * Stored under `settings.enum_extensions[<key>]`. The dropdowns merge
 * the system list with the active (non-archived) extensions so admins
 * can grow each dimension without a code change.
 *
 *   - status:               extra workflow states beyond the eight built-ins
 *   - phase:                extra lifecycle phases beyond the nine built-ins
 *   - priority:             extra priority bands beyond Critical/High/Medium/Low
 *   - application_product:  Application/Product values (no built-ins; the
 *                           system ships with an empty list and admins
 *                           own every entry)
 */
export type ExtensibleEnumKey =
  | "status"
  | "phase"
  | "priority"
  | "application_product";

/**
 * One admin-added value for an extensible enum.
 *
 * `id` is immutable; it's the string actually stored on Project records
 * and tested by code paths that branch on a specific value. `label` is
 * editable and is what users see in dropdowns and badges. We keep them
 * separate so an Admin can rename ("Triage" → "Initial Review") without
 * orphaning every project that's already on that value.
 *
 * `archived` hides a value from new dropdowns while preserving display
 * for projects that still reference it. Use archive instead of delete
 * for any value that has been used in production data; deletion is only
 * safe for never-used values.
 */
export interface EnumExtension {
  id: string;
  label: string;
  archived: boolean;
  /**
   * Optional metadata. Different enums use different fields; the renderer
   * picks what's relevant. Unused fields are simply absent.
   */
  description?: string;
  /** For status: whether this status counts as "open" in the default Projects filter. */
  is_open?: boolean;
  /** For status: whether reaching this status closes the project (Completed/Canceled-like). */
  is_terminal?: boolean;
  /**
   * For priority: rank (lower = more urgent). Used to sort by priority and
   * to place admin-added priorities into the existing Critical(0)/High(1)/
   * Medium(2)/Low(3) ordering.
   */
  rank?: number;
  /** For phase: order in the lifecycle (0 = earliest). */
  order?: number;
  created_by: UserId | null;
  created_at: IsoTimestamp;
}

/** Per-enum container. Built-in values are NOT stored here. */
export type EnumExtensionsMap = Record<ExtensibleEnumKey, EnumExtension[]>;

export interface AppSettings {
  health_score_thresholds: HealthScoreThresholds;
  branding: BrandingConfig;
  notification_defaults: NotificationDefaults;
  /** Admin-defined custom field schema applied to all projects. */
  custom_field_definitions: CustomFieldDefinition[];
  /** Named, reusable Kanban board configurations (Section 5.5). */
  kanban_configs: SavedKanbanConfig[];
  /**
   * Per-role permission grants. Edited from Admin Console → Roles &
   * permissions. Seeded from `DEFAULT_ROLE_PERMISSIONS` on first run.
   */
  role_permissions: RolePermissionsMap;
  /**
   * Admin-added values for the four extensible project enums (status,
   * phase, priority, application_product). Edited from Admin Console
   * → Project values. Empty arrays for all four keys on first run.
   */
  enum_extensions: EnumExtensionsMap;
  /**
   * Workload-bucket and performance-score thresholds for the
   * Insights → Resources page. Edited from Admin Console →
   * Resource thresholds. Mirrors `health_score_thresholds` shape so
   * the matrix editor can reuse the same form pattern.
   */
  resource_settings: ResourceSettings;
  /**
   * User-facing labels for the four strategic-position buckets used by
   * the Projects table column, the Kanban card badge, and the bubble
   * chart's quadrants. Each project maps to one of these four buckets
   * by `priority × ai_complexity_score`. Keys are stable internal
   * identifiers; values are the strings shown to users. Editable from
   * Admin Console → Portfolio quadrants.
   */
  portfolio_quadrants: PortfolioQuadrantLabels;
}

/**
 * The four strategic-position bucket labels. Keys are fixed; values
 * are admin-customizable. The bucket assignment is determined by
 * priority and complexity, NOT by the label string — admins can
 * rename "Quick Win" to "Easy Wins" without changing which projects
 * land in that bucket.
 *
 * Bucket definitions (priority × ai_complexity_score):
 *   quick_win    — High/Critical priority, Low/Medium complexity
 *   major_bet    — High/Critical priority, High/Very High complexity
 *   fill_in      — Low/Medium priority, Low/Medium complexity
 *   deprioritize — Low/Medium priority, High/Very High complexity
 *
 * Projects without a complexity score (AI hasn't run) are bucketed
 * as "unknown" and rendered with a "—" label in the UI; they're
 * not assigned to one of the four labeled buckets.
 */
export interface PortfolioQuadrantLabels {
  quick_win: string;
  major_bet: string;
  fill_in: string;
  deprioritize: string;
}

// ---------------------------------------------------------------------------
// Resource insights settings
// ---------------------------------------------------------------------------

/**
 * Tunable inputs for the workload + performance scores used on the
 * Insights → Resources page. Editable from Admin Console →
 * Resource thresholds.
 *
 * The workload score is a weighted sum of contributing factors; the
 * thresholds slice it into four buckets (light / balanced / heavy /
 * overloaded). The performance score is a simpler 0-1 composite of
 * on-time rate and blocked-day rate, sliced into Red / Yellow /
 * Green.
 *
 * No factor is hardcoded — every weight and every threshold sits
 * here so admins can tune for the team's reality (no resource is
 * 100% dedicated; weights and thresholds need flexibility).
 */
export interface ResourceSettings {
  /**
   * Default `allocation_percent` to apply to a project assignment
   * when one isn't explicitly set. 50% reflects the user's stated
   * reality that no resource is fully dedicated. Set to 100 for
   * teams where projects monopolize a person's time.
   */
  default_allocation_percent: number;
  /**
   * Workload score weights — multiplied against each contributing
   * count and summed to produce the per-resource workload score.
   * Tweak to change which factor matters most.
   */
  workload_weights: {
    /** Per active-project assignment, scaled by allocation_percent / 100. */
    project_assignment: number;
    /** Per open task. Multiplied by the task's priority weight below. */
    open_task: number;
    /** Per past-due task. Adds on top of the open_task contribution. */
    past_due_task: number;
    /** Per task where this resource is the bottleneck for someone else. */
    bottleneck_task: number;
    /** Project complexity multipliers (per active project). */
    complexity_low: number;
    complexity_medium: number;
    complexity_high: number;
    complexity_very_high: number;
    /** Task priority multipliers. */
    priority_critical: number;
    priority_high: number;
    priority_medium: number;
    priority_low: number;
  };
  /**
   * Bucket thresholds. A resource's workload score is sliced as:
   *   < light_max          → Light
   *   < balanced_max       → Balanced
   *   < heavy_max          → Heavy
   *   ≥ heavy_max          → Overloaded
   */
  workload_buckets: {
    light_max: number;
    balanced_max: number;
    heavy_max: number;
  };
  /**
   * Performance score thresholds. Score is a 0-1 composite:
   *   on_time_rate × performance_weights.on_time
   * + (1 - blocked_rate) × performance_weights.blocked_inverse
   *
   * Score ≥ green_min → Green, ≥ yellow_min → Yellow, else Red.
   */
  performance_weights: {
    on_time: number;
    blocked_inverse: number;
  };
  performance_thresholds: {
    green_min: number;
    yellow_min: number;
  };
  /**
   * Performance window in days. Tasks completed in this many days
   * back are the population for the on-time / blocked-rate math.
   * Default 90 — long enough for statistical signal, short enough
   * to reflect *current* performance.
   */
  performance_window_days: number;
}

/** Default ResourceSettings — used to seed settings.json and as a
 * fallback when the stored object is missing fields (e.g. older
 * settings from before this feature shipped). */
export const DEFAULT_RESOURCE_SETTINGS: ResourceSettings = {
  default_allocation_percent: 50,
  workload_weights: {
    project_assignment: 25,
    open_task: 1,
    past_due_task: 5,
    bottleneck_task: 8,
    complexity_low: 0.75,
    complexity_medium: 1,
    complexity_high: 1.5,
    complexity_very_high: 2,
    priority_critical: 4,
    priority_high: 2,
    priority_medium: 1,
    priority_low: 0.5,
  },
  workload_buckets: {
    light_max: 25,
    balanced_max: 60,
    heavy_max: 90,
  },
  performance_weights: {
    on_time: 0.6,
    blocked_inverse: 0.4,
  },
  performance_thresholds: {
    green_min: 0.75,
    yellow_min: 0.5,
  },
  performance_window_days: 90,
};
