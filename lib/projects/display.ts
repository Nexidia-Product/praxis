/**
 * Display metadata for project enums.
 *
 * The same lists of enum values appear in three places: the table filter
 * dropdowns, the new/edit project form, and the badge styling on rows
 * and cards. Centralizing them here means renaming an enum value or
 * tweaking a badge color is a one-file change.
 *
 * Color choices follow the design language already in use elsewhere in
 * the app (`components/users-admin-panel.tsx`): emerald for healthy /
 * positive, amber for in-progress / warning, red for blocked / failed,
 * gray for neutral / not-yet-started, slate / sky for informational.
 *
 * Tailwind class strings are kept inline (not interpolated) so the
 * compiler can see them and not purge the styles in production.
 */

import type {
  HealthScore,
  Priority,
  ProjectStatus,
  ProjectType,
  VisualizationType,
} from "@/lib/db";

// ---------------------------------------------------------------------------
// Status (Section 4.1, Appendix C)
// ---------------------------------------------------------------------------

export const PROJECT_STATUSES: ProjectStatus[] = [
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
  "Completed",
  "Canceled",
];

export const STATUS_BADGE: Record<ProjectStatus, string> = {
  "Not Started": "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
  "In Planning": "bg-sky-50 text-sky-800 ring-1 ring-inset ring-sky-200",
  "In Progress": "bg-emerald-50 text-emerald-800 ring-1 ring-inset ring-emerald-200",
  Blocked: "bg-red-50 text-red-800 ring-1 ring-inset ring-red-200",
  "On Hold": "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  Delayed: "bg-orange-50 text-orange-900 ring-1 ring-inset ring-orange-200",
  Completed: "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-300",
  Canceled: "bg-gray-100 text-gray-500 ring-1 ring-inset ring-gray-200 line-through",
};

/**
 * Neutral fallback class for badges when the stored value isn't one of
 * the built-in literals. Triggered for admin-added status / priority
 * values (Section 5.19): they get a clean, content-agnostic style
 * rather than the no-class "broken badge" look that a missing record
 * lookup would produce.
 *
 * Two helpers (`statusBadgeClass`, `priorityBadgeClass`) wrap the
 * lookup so call sites don't repeat the fallback logic. They accept
 * `string` rather than the narrow enum type so admin values pass
 * through without a cast.
 */
const FALLBACK_BADGE =
  "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200";

export function statusBadgeClass(value: string | null | undefined): string {
  if (!value) return FALLBACK_BADGE;
  return (STATUS_BADGE as Record<string, string>)[value] ?? FALLBACK_BADGE;
}

// ---------------------------------------------------------------------------
// Priority
// ---------------------------------------------------------------------------

export const PRIORITIES: Priority[] = ["Critical", "High", "Medium", "Low"];

export const PRIORITY_BADGE: Record<Priority, string> = {
  Critical: "bg-red-100 text-red-900 ring-1 ring-inset ring-red-200",
  High: "bg-orange-100 text-orange-900 ring-1 ring-inset ring-orange-200",
  Medium: "bg-amber-50 text-amber-900 ring-1 ring-inset ring-amber-200",
  Low: "bg-gray-100 text-gray-700 ring-1 ring-inset ring-gray-200",
};

export function priorityBadgeClass(value: string | null | undefined): string {
  if (!value) return FALLBACK_BADGE;
  return (PRIORITY_BADGE as Record<string, string>)[value] ?? FALLBACK_BADGE;
}

// ---------------------------------------------------------------------------
// Type
// ---------------------------------------------------------------------------

export const PROJECT_TYPES: ProjectType[] = [
  "New Capability",
  "New Feature",
  "Enhancement",
  "Validation",
  "Admin",
];

/**
 * Project types treated as portfolio work — i.e. types that should
 * appear on the Roadmap and Velocity dashboard. "Admin" is excluded
 * here: Admin-typed projects track internal team work (operational
 * cadence, governance, tooling) that affects delivery but isn't itself
 * a delivery project, so it doesn't belong on the portfolio roadmap or
 * in throughput / cycle-time charts. Use this list for any view that
 * scopes itself to portfolio work.
 *
 * The full `PROJECT_TYPES` list is still used in project / task /
 * idea forms and the Projects page table so Admin projects remain
 * authorable, browsable, and filterable in their proper home.
 */
export const PORTFOLIO_PROJECT_TYPES: ProjectType[] = PROJECT_TYPES.filter(
  (t) => t !== "Admin",
);

// ---------------------------------------------------------------------------
// Visualization type
// ---------------------------------------------------------------------------

export const VISUALIZATION_TYPES: VisualizationType[] = [
  "Data Only",
  "Function Update",
  "New Visualization",
  "New Page",
  "New Cognigy Build",
];

// ---------------------------------------------------------------------------
// Organizational Objective
// ---------------------------------------------------------------------------

/**
 * Fixed list of organizational objectives every project ties back to —
 * one primary, optionally several secondary (`Project.primary_objective`
 * / `secondary_objectives`). Deliberately NOT admin-extensible like
 * Track/Program: this is a stable, product-level taxonomy rather than a
 * per-deployment customization point. If that ever needs to change, the
 * `mergeEnumOptions` mechanism in `lib/projects/enum-options.ts` is
 * there to fold this in the same way without disrupting callers.
 */
export const OBJECTIVES: string[] = [
  "Cost-to-Serve",
  "Revenue",
  "Compliance",
  "Customer Experience",
  "Agent Experience",
  "Complaints",
  "Other",
];

/**
 * "Complaints" and "Other" are catch-all classifications — they only
 * make sense as a project's one PRIMARY objective, never stacked on top
 * of a more specific primary as a secondary one. Every other objective
 * is eligible as a secondary. Used for both the secondary-objectives
 * select's option list and its server-side validation
 * (`lib/projects/service.ts`).
 */
export const SECONDARY_OBJECTIVE_OPTIONS: string[] = OBJECTIVES.filter(
  (o) => o !== "Complaints" && o !== "Other",
);

/**
 * Application/Product values that ship as built-in defaults. Admin-added
 * extensions in `settings.enum_extensions.application_product` are merged
 * on top via `mergeEnumOptions(...)` (see `lib/projects/enum-options.ts`).
 *
 * "Admin" is the only built-in here — it's the partner to the "Admin"
 * project type and gives operational / governance work a stable home in
 * the Application/Product dropdown without an Admin first having to
 * curate the value into Settings on a fresh install.
 */
export const SYSTEM_APPLICATION_PRODUCTS: string[] = ["Admin"];

/**
 * The Application/Product label used by Admin-classified work. Matches
 * the literal in `SYSTEM_APPLICATION_PRODUCTS` and is exported as a
 * named constant so the roadmap / velocity exclusion filters reference
 * it without a magic string.
 */
export const ADMIN_APPLICATION_PRODUCT = "Admin";

/**
 * The Project Type literal used to mark internal / operational work.
 * Same rationale as `ADMIN_APPLICATION_PRODUCT`.
 */
export const ADMIN_PROJECT_TYPE: ProjectType = "Admin";

/**
 * True when a project counts as internal Admin work — either because
 * its `project_type` is "Admin" or its `application_product` is "Admin".
 * The Roadmap and Velocity pages exclude these so portfolio metrics
 * aren't diluted by team-cadence work that isn't tied to a delivery
 * project (Section 5.4-5.8, 5.15 read together with the Admin-type
 * carve-out).
 *
 * Either field qualifying is intentional: a team may classify the same
 * piece of work via type or via product depending on how it slots into
 * their workflow, and the goal of the exclusion is to drop the work
 * either way rather than leak through one path.
 */
export function isAdminProject(p: {
  project_type: string;
  application_product: string;
}): boolean {
  return (
    p.project_type === ADMIN_PROJECT_TYPE ||
    p.application_product === ADMIN_APPLICATION_PRODUCT
  );
}

// ---------------------------------------------------------------------------
// Program
// ---------------------------------------------------------------------------

/**
 * Program values that ship as built-in defaults. Admin-added extensions in
 * `settings.enum_extensions.program` are merged on top via
 * `mergeEnumOptions(...)`, same mechanism as `application_product`.
 *
 * "Innovation" is the default program for existing/new projects — it's the
 * baseline portfolio work. "Complaints" and "UI Maintenance" are separate
 * workstreams with their own Roadmap/Velocity/Work in Progress scoping.
 */
export const SYSTEM_PROGRAMS: string[] = [
  "Innovation",
  "Complaints",
  "UI Maintenance",
];

/**
 * Track ships with seven built-in values (Tracks A-G) — the identified
 * delivery tracks. `settings.enum_extensions.track` are
 * merged on top via `mergeEnumOptions(...)`, same mechanism as `program`.
 * The id and label are the same string (no separate short code), matching
 * how the values are referred to elsewhere.
 */
export const SYSTEM_TRACKS: string[] = [
  "Track A - Dashboard/visualization",
  "Track B - Cognigy bot inputs",
  "Track C - WFM/mid-shift reskilling",
  "Track D - UI/Application",
  "Track E - TopicAI",
  "Track F - Complaints",
  "Track G - Other",
  "Track H - Services Validation",
  "Track I - Coaching Plan",
];

// ---------------------------------------------------------------------------
// Stage (formerly "Phase"; track-scoped)
// ---------------------------------------------------------------------------

/**
 * Anchor stages every track's list is built around: it starts with
 * Qualification and Prioritization and delivers at Productization
 * (`STAGE_LAST`, kept under that name for existing callers). A track may
 * also define stages after Productization (`TRACK_POST_STAGES`), so
 * Productization is the delivery point, not necessarily the final entry.
 */
export const STAGE_FIRST = "Qualification";
export const STAGE_SECOND = "Prioritization";
export const STAGE_LAST = "Productization";

/**
 * Track-specific stages between Prioritization and Productization.
 * Tracks A and B have full lists; Track C (and any future track not
 * listed here) has none yet — `stagesForTrack` falls back to just the
 * anchors for them.
 */
const TRACK_MIDDLE_STAGES: Record<string, string[]> = {
  "Track A - Dashboard/visualization": [
    "Kickoff",
    "Analysis and EDA",
    "Approach Review",
    "Initial Revisions",
    "Initiate Visualization",
    "Deck Review",
    "Manager Review",
    "Signoff",
    "Handoff",
    "Integration",
    "Visualization Build",
    "Final Visualization",
    "Release",
  ],
  "Track B - Cognigy bot inputs": [
    "Development",
    "Testing",
    "Signoff",
    "Integration",
    "Release",
  ],
  "Track I - Coaching Plan": [
    "Data development",
    "Signoff",
    "Handoff",
    "Integration",
    "Visualization Update",
    "Release",
  ],
};

/**
 * Track-specific stages AFTER Productization (e.g. validation and
 * adoption). Productization is the point the functionality ships, so a
 * project in one of these stages has already been delivered; the stages
 * track what happens next. Only Track B defines them so far. Every
 * "has it shipped?" check goes through `hasReachedProductization`, which
 * compares positions in the track's list rather than assuming
 * Productization is last, so adding stages here is safe.
 */
const TRACK_POST_STAGES: Record<string, string[]> = {
  "Track B - Cognigy bot inputs": [
    "Services Validation",
    "Services Signoff",
    "Adoption",
  ],
};

/**
 * Names of the tracks that have stages defined in code (middle or post).
 * Stage lists are matched to a track by its exact name, so every name here
 * must be one of `SYSTEM_TRACKS` — a typo would silently leave a track with
 * only the anchors (and nothing to see on Configuration → Stage). The
 * smoke test checks it.
 */
export function tracksWithStageDefinitions(): string[] {
  return [
    ...new Set([...Object.keys(TRACK_MIDDLE_STAGES), ...Object.keys(TRACK_POST_STAGES)]),
  ];
}

/**
 * Full ordered stage list for a track: anchors + its middle stages,
 * Productization, then any post-Productization stages.
 */
export function stagesForTrack(track: string): string[] {
  return [
    STAGE_FIRST,
    STAGE_SECOND,
    ...(TRACK_MIDDLE_STAGES[track] ?? []),
    STAGE_LAST,
    ...(TRACK_POST_STAGES[track] ?? []),
  ];
}

/**
 * True when `stage` is Productization or any stage after it in the
 * track's list — i.e. the project has shipped. Use this, not
 * `stage === STAGE_LAST`, for every delivered / released / missed-delivery
 * decision. A stage not in the track's list (e.g. a retired legacy value)
 * is treated as not reached, matching the old strict-equality behavior.
 */
export function hasReachedProductization(track: string, stage: string): boolean {
  return reachedProductizationIn(stagesForTrack(track), stage);
}

/** Position check behind `hasReachedProductization`, on an explicit stage list. */
export function reachedProductizationIn(stages: string[], stage: string): boolean {
  const idx = stages.indexOf(stage);
  return idx !== -1 && idx >= stages.indexOf(STAGE_LAST);
}

/**
 * The stage a project should sit at when it is closed out (status
 * Completed/Canceled): Productization, unless it is already past it, in
 * which case it stays where it is — closing out must never move a project
 * backwards out of a validation/adoption stage.
 */
export function closedOutStage(track: string, currentStage: string): string {
  return hasReachedProductization(track, currentStage) ? currentStage : STAGE_LAST;
}

/**
 * Whether a stage transition should auto-populate the project's Start
 * date (`roadmap_timeline_start`) with today's date — true for
 * Prioritization → Kickoff specifically (today only reachable on Track
 * A, since no other track has "Kickoff" in its stage list, but this is
 * deliberately keyed on the stage names rather than the track so a
 * future track reusing them gets the same behavior for free).
 *
 * Pure and dependency-free on purpose: both `lib/projects/service.ts`
 * (a human manually changing stage) and `lib/tasks/service.ts` (the
 * task-completion auto-advance) need this same decision, and those two
 * modules already have a one-way import relationship
 * (`projects/service.ts` imports `rescheduleProjectTasks` from
 * `tasks/service.ts`) — putting the rule here, rather than in either
 * service module, avoids turning that into a circular import.
 */
export function stageTransitionSetsStartDate(
  fromStage: string,
  toStage: string,
): boolean {
  return fromStage === STAGE_SECOND && toStage === "Kickoff";
}

// ---------------------------------------------------------------------------
// Health score (Section 5.13). Step 8 will populate values; today they
// render as "—" when null. Badge styling is defined here so Step 8 just
// flips the data on without touching presentation.
// ---------------------------------------------------------------------------

export const HEALTH_BADGE: Record<HealthScore, string> = {
  Green: "bg-emerald-100 text-emerald-900 ring-1 ring-inset ring-emerald-300",
  Yellow: "bg-amber-100 text-amber-900 ring-1 ring-inset ring-amber-300",
  Red: "bg-red-100 text-red-900 ring-1 ring-inset ring-red-300",
};

export const HEALTH_DOT: Record<HealthScore, string> = {
  Green: "bg-emerald-500",
  Yellow: "bg-amber-500",
  Red: "bg-red-500",
};

/**
 * Plain-English description of each health score. Surfaced as a `title`
 * attribute on the health badge (PROJ-09) so a hovering user gets a
 * native tooltip explaining what the color means without us computing a
 * per-project breakdown on render. The text mirrors Section 5.13 of the
 * design doc.
 */
export const HEALTH_TOOLTIP: Record<HealthScore, string> = {
  Green:
    "Healthy — few blocked or overdue tasks, target date isn't imminent, and there's been recent task activity.",
  Yellow:
    "At risk — moderate blocked / overdue ratio, or target date is within two weeks with significant work remaining, or no task activity in 14+ days.",
  Red: "Critical — many blocked / overdue tasks, target date has passed, status is Blocked, or an upstream dependency is Red.",
};
