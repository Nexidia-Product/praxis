/**
 * Role / permission catalog.
 *
 * This module defines what a permission *is* — its key, label, description,
 * and category — and the default mapping of permissions to roles. It does
 * NOT decide who currently has what; that lives in
 * `settings.json -> role_permissions` and is read at request time via
 * `lib/auth/permissions.ts`.
 *
 * Why split it this way:
 *
 *   - The catalog (this file) is code. Changing the set of permissions —
 *     adding a new one, removing one, renaming — is a code change because
 *     it implies new gates have been wired into routes and components.
 *
 *   - The mapping (settings.json) is data. An Admin can toggle "can Project
 *     Leads convert ideas?" in the Admin Console without a code change.
 *
 * Hard rule: Admin always has every permission. The matrix UI hides the
 * Admin column for that reason — there's no scenario where it's useful for
 * an Admin to lose a permission, and the toggles would only invite the
 * lock-yourself-out class of bug.
 */

import type { UserRole } from "@/lib/db";

// ---------------------------------------------------------------------------
// Permission keys
// ---------------------------------------------------------------------------

/**
 * Every gate in the application maps to one of these keys. Add a new key
 * here when you wire a new gate; remove one only when every call site has
 * been removed first.
 *
 * Naming: `<resource>.<verb>`. Verbs to prefer: `view`, `create`, `edit`,
 * `delete`, `manage` (= edit + delete + everything). One word for the
 * resource so the catalog stays scannable.
 */
export type PermissionKey =
  // Projects
  | "projects.view"
  | "projects.create"
  | "projects.edit"
  | "projects.delete"
  // Tasks
  | "tasks.view"
  | "tasks.create"
  | "tasks.edit"
  | "tasks.delete"
  // Ideas (public submissions / review queue)
  | "ideas.review"
  | "ideas.convert"
  // Roadmap
  | "roadmap.view"
  | "roadmap.export"
  // Velocity dashboard
  | "velocity.view"
  // Resources insights
  | "resources.view"
  | "resources.view_all"
  // Admin console — each admin section is gated separately so the
  // permission can be granted to non-Admin roles selectively (e.g. let
  // Project Leads manage templates without giving them user management).
  | "admin.console"
  | "admin.users.manage"
  | "admin.roles.manage"
  | "admin.custom_fields.manage"
  | "admin.templates.manage"
  | "admin.health_thresholds.manage"
  | "admin.resource_thresholds.manage"
  | "admin.project_values.manage"
  | "admin.portfolio_quadrants.manage"
  | "admin.notifications.run_sweep"
  | "admin.audit_log.view";

// ---------------------------------------------------------------------------
// Catalog entries — the read-only metadata for each permission
// ---------------------------------------------------------------------------

export interface PermissionDefinition {
  key: PermissionKey;
  label: string;
  description: string;
  category: PermissionCategory;
}

export type PermissionCategory =
  | "Projects"
  | "Tasks"
  | "Ideas"
  | "Roadmap"
  | "Insights"
  | "Administration";

export const PERMISSION_CATALOG: ReadonlyArray<PermissionDefinition> = [
  // Projects
  {
    key: "projects.view",
    label: "View projects",
    description: "See the project list, project detail pages, and quick views.",
    category: "Projects",
  },
  {
    key: "projects.create",
    label: "Create projects",
    description: "Add new projects to the repository.",
    category: "Projects",
  },
  {
    key: "projects.edit",
    label: "Edit projects",
    description: "Update fields on existing projects.",
    category: "Projects",
  },
  {
    key: "projects.delete",
    label: "Delete projects",
    description: "Permanently remove projects. (Cancellation is a status, not a delete.)",
    category: "Projects",
  },

  // Tasks
  {
    key: "tasks.view",
    label: "View tasks",
    description: "See the tasks page and task detail panels across all projects.",
    category: "Tasks",
  },
  {
    key: "tasks.create",
    label: "Create tasks",
    description: "Add new tasks under a project.",
    category: "Tasks",
  },
  {
    key: "tasks.edit",
    label: "Edit tasks",
    description: "Update task status, assignees, due dates, and other fields.",
    category: "Tasks",
  },
  {
    key: "tasks.delete",
    label: "Delete tasks",
    description: "Permanently remove tasks.",
    category: "Tasks",
  },

  // Ideas
  {
    key: "ideas.review",
    label: "Review submitted ideas",
    description: "Open the Ideas queue and approve, reject, or comment on submissions.",
    category: "Ideas",
  },
  {
    key: "ideas.convert",
    label: "Convert ideas to projects",
    description: "Promote an approved idea into a new project record.",
    category: "Ideas",
  },

  // Roadmap
  {
    key: "roadmap.view",
    label: "View the roadmap",
    description: "Open the Timeline, Kanban, Bubble Chart, and Now/Next/Later views.",
    category: "Roadmap",
  },
  {
    key: "roadmap.export",
    label: "Export roadmap to PPTX",
    description: "Generate the customer-facing PowerPoint deck from any roadmap view.",
    category: "Roadmap",
  },

  // Insights
  {
    key: "velocity.view",
    label: "View velocity dashboard",
    description: "Open the velocity & throughput dashboard and its charts.",
    category: "Insights",
  },
  {
    key: "resources.view",
    label: "View Resources insights",
    description:
      "Open the Insights → Resources page. Default scope is your team (people on projects you lead) — see resources.view_all for the full roster.",
    category: "Insights",
  },
  {
    key: "resources.view_all",
    label: "View all resources",
    description:
      "Lift the default 'my team' scope on the Resources page so the user can see every resource in the org.",
    category: "Insights",
  },

  // Administration
  {
    key: "admin.console",
    label: "Access the Admin section",
    description: "Reveals the Admin group in the left navigation. Required for any admin page.",
    category: "Administration",
  },
  {
    key: "admin.users.manage",
    label: "Manage users",
    description: "Invite users, change roles, deactivate accounts, trigger password resets.",
    category: "Administration",
  },
  {
    key: "admin.roles.manage",
    label: "Manage roles & permissions",
    description: "Edit which permissions each role has. (Admin permissions are always on.)",
    category: "Administration",
  },
  {
    key: "admin.custom_fields.manage",
    label: "Manage custom fields",
    description: "Add, edit, and remove custom fields on the project schema.",
    category: "Administration",
  },
  {
    key: "admin.templates.manage",
    label: "Manage task templates",
    description: "Create and maintain the task templates that prefill new projects.",
    category: "Administration",
  },
  {
    key: "admin.health_thresholds.manage",
    label: "Manage health score thresholds",
    description: "Tune the Red / Yellow / Green scoring thresholds.",
    category: "Administration",
  },
  {
    key: "admin.resource_thresholds.manage",
    label: "Manage resource thresholds",
    description:
      "Tune the workload bucket thresholds, weights, and performance score weights for the Resources page.",
    category: "Administration",
  },
  {
    key: "admin.project_values.manage",
    label: "Manage project values",
    description:
      "Add, rename, and archive Status / Phase / Priority / Application values.",
    category: "Administration",
  },
  {
    key: "admin.portfolio_quadrants.manage",
    label: "Manage portfolio quadrants",
    description:
      "Rename the four strategic-position labels (Quick Win / Major Bet / Fill-In / Deprioritize) shown in the Projects table, Kanban cards, and bubble chart.",
    category: "Administration",
  },
  {
    key: "admin.notifications.run_sweep",
    label: "Run notifications sweep",
    description:
      "Trigger the daily notification sweep on demand — fires Task Due Soon, Task Overdue, digest, and purge phases. Useful for testing notification rules and as a manual fallback in deployments where the scheduled job isn't running.",
    category: "Administration",
  },
  {
    key: "admin.audit_log.view",
    label: "View audit log",
    description:
      "Open the Admin → Audit Log page that shows recent create/update/delete activity across projects, tasks, ideas, decisions, and user management.",
    category: "Administration",
  },
] as const;

// Convenience: extract just the keys for iteration.
export const ALL_PERMISSION_KEYS: ReadonlyArray<PermissionKey> =
  PERMISSION_CATALOG.map((p) => p.key);

// ---------------------------------------------------------------------------
// Default mapping (role -> permissions)
// ---------------------------------------------------------------------------

/**
 * Default permission grants per role. Used:
 *
 *   - To seed `settings.role_permissions` on first run.
 *   - As the "reset to defaults" target in the Admin Console matrix.
 *   - As a safety net if `settings.role_permissions` is missing or
 *     malformed for a particular role (we fall back to the default).
 *
 * Note that Admin's entry is informational — the runtime always treats
 * Admin as having every permission, regardless of what's stored.
 */
export const DEFAULT_ROLE_PERMISSIONS: Record<UserRole, PermissionKey[]> = {
  Admin: [...ALL_PERMISSION_KEYS],

  "Project Lead": [
    "projects.view",
    "projects.create",
    "projects.edit",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "tasks.delete",
    "ideas.review",
    "ideas.convert",
    "roadmap.view",
    "roadmap.export",
    "velocity.view",
    "resources.view",
    "resources.view_all",
  ],

  "Team Member": [
    "projects.view",
    "tasks.view",
    "tasks.create",
    "tasks.edit",
    "roadmap.view",
    "velocity.view",
  ],

  Viewer: [
    "projects.view",
    "tasks.view",
    "roadmap.view",
    "velocity.view",
  ],
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Build a stable category-grouped view of the catalog. The Admin Console
 * matrix renders rows in this order; keeping it in one place stops the
 * UI and the catalog from drifting apart.
 */
export function getCatalogByCategory(): Array<{
  category: PermissionCategory;
  permissions: PermissionDefinition[];
}> {
  const order: PermissionCategory[] = [
    "Projects",
    "Tasks",
    "Ideas",
    "Roadmap",
    "Insights",
    "Administration",
  ];
  return order.map((category) => ({
    category,
    permissions: PERMISSION_CATALOG.filter((p) => p.category === category),
  }));
}

/**
 * Validate that a given record is a complete, well-formed permissions
 * map. Used when reading from settings.json — any malformed entry is
 * replaced with the default for that role rather than throwing, so a
 * hand-edited settings file can't brick the app.
 */
export function normalizeRolePermissions(
  raw: unknown,
): Record<UserRole, PermissionKey[]> {
  const out: Record<UserRole, PermissionKey[]> = {
    Admin: [...ALL_PERMISSION_KEYS],
    "Project Lead": [...DEFAULT_ROLE_PERMISSIONS["Project Lead"]],
    "Team Member": [...DEFAULT_ROLE_PERMISSIONS["Team Member"]],
    Viewer: [...DEFAULT_ROLE_PERMISSIONS["Viewer"]],
  };

  if (!raw || typeof raw !== "object") return out;
  const r = raw as Record<string, unknown>;
  const known: ReadonlySet<string> = new Set(ALL_PERMISSION_KEYS);

  for (const role of ["Project Lead", "Team Member", "Viewer"] as const) {
    const candidate = r[role];
    if (Array.isArray(candidate)) {
      const filtered = candidate.filter(
        (k): k is PermissionKey => typeof k === "string" && known.has(k),
      );
      // De-duplicate while preserving order.
      out[role] = Array.from(new Set(filtered));
    }
    // Else: keep the default seeded above.
  }

  // Admin is always full; no override.
  out.Admin = [...ALL_PERMISSION_KEYS];

  return out;
}
