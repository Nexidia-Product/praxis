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
  ProjectPhase,
  ProjectStatus,
  ProjectType,
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
  "New Application",
  "New Feature",
  "New Prototype",
  "Enhancement",
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
// Phase (Appendix C)
// ---------------------------------------------------------------------------

export const PROJECT_PHASES: ProjectPhase[] = [
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
