"use client";

/**
 * Admin → Resource Management workspace.
 *
 * Three tabs grouped because they all describe **the people side** of
 * the app: who has accounts, what each role can do, and how their
 * workload is bucketed.
 *
 *   - Users — invite, deactivate, change roles, reset passwords.
 *   - Roles & permissions — the role-by-permission matrix.
 *   - Resource thresholds — workload-bucket and performance score
 *     thresholds for the Insights → Resources page.
 *
 * Tab visibility is gated by per-tab admin permissions. A user with
 * only `admin.users.manage` (e.g.) sees only the Users tab and lands
 * on it by default; if they hit `/admin/resources?tab=roles` directly
 * the workspace coerces them back to the first tab they're allowed.
 *
 * Tab state lives in the URL (`?tab=...`) so deep links round-trip.
 *
 * The page itself loads the data each tab needs once on render and
 * passes it in. That keeps "data loading" entirely server-side and
 * matches the existing per-page pattern — no client fetches from
 * the workspace.
 */

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { UsersAdminPanel } from "@/components/users-admin-panel";
import { RolePermissionsEditor } from "@/components/admin/role-permissions-editor";
import { ResourceThresholdsAdmin } from "@/components/admin/resource-thresholds-admin";

import type { AdminUser } from "@/lib/auth/admin-user-view";
import type {
  PermissionDefinition,
  PermissionKey,
  PermissionCategory,
} from "@/lib/auth/role-permissions";
import type { ResourceSettings, UserRole } from "@/lib/db";

export type ResourceManagementTab =
  | "users"
  | "roles"
  | "thresholds";

export const RESOURCE_MANAGEMENT_TABS: ReadonlyArray<{
  id: ResourceManagementTab;
  label: string;
  permission: string;
}> = [
  { id: "users", label: "Users", permission: "admin.users.manage" },
  { id: "roles", label: "Roles & permissions", permission: "admin.roles.manage" },
  {
    id: "thresholds",
    label: "Resource thresholds",
    permission: "admin.resource_thresholds.manage",
  },
];

interface ResourceManagementWorkspaceProps {
  initialTab: ResourceManagementTab;
  /** Live permissions map for the current user (Shell hands the same shape down). */
  permissions: Record<string, boolean>;

  // Users tab data
  initialUsers: AdminUser[];
  currentUserId: string;

  // Roles & permissions tab data
  catalog: ReadonlyArray<PermissionDefinition>;
  catalogByCategory: Array<{
    category: PermissionCategory;
    permissions: PermissionDefinition[];
  }>;
  allKeys: PermissionKey[];
  editableRoles: UserRole[];
  initialMatrix: Record<UserRole, PermissionKey[]>;
  defaultMatrix: Record<UserRole, PermissionKey[]>;

  // Resource thresholds tab data
  initialResourceSettings: ResourceSettings;
  defaultResourceSettings: ResourceSettings;
}

export function ResourceManagementWorkspace({
  initialTab,
  permissions,
  initialUsers,
  currentUserId,
  catalog,
  catalogByCategory,
  allKeys,
  editableRoles,
  initialMatrix,
  defaultMatrix,
  initialResourceSettings,
  defaultResourceSettings,
}: ResourceManagementWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Tabs the current user has permission to see, in declared order.
  // Admins fall through every check above this component, so this
  // filter only matters for non-Admin grants.
  const visibleTabs = useMemo(
    () =>
      RESOURCE_MANAGEMENT_TABS.filter((t) => permissions[t.permission] === true),
    [permissions],
  );

  // If the URL pointed at a tab the user can't see, slide them to the
  // first one they can. We don't 403 — they got here legitimately
  // (the page-level gate said they can see at least one tab); it
  // would be confusing to throw because of a query-string typo.
  const activeTab: ResourceManagementTab =
    visibleTabs.find((t) => t.id === initialTab)?.id ??
    visibleTabs[0]?.id ??
    "users";

  function setTab(next: ResourceManagementTab): void {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`/admin/resources?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <TabStrip current={activeTab} tabs={visibleTabs} onChange={setTab} />

      {activeTab === "users" ? (
        <UsersAdminPanel
          initialUsers={initialUsers}
          currentUserId={currentUserId}
        />
      ) : null}

      {activeTab === "roles" ? (
        <RolePermissionsEditor
          catalog={catalog}
          catalogByCategory={catalogByCategory}
          allKeys={allKeys}
          editableRoles={editableRoles}
          initialMatrix={initialMatrix}
          defaults={defaultMatrix}
        />
      ) : null}

      {activeTab === "thresholds" ? (
        <ResourceThresholdsAdmin
          initialSettings={initialResourceSettings}
          defaults={defaultResourceSettings}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Tab strip — same visual pattern as the Resources page (Insights →
// Resources) so the two grouped pages feel consistent.
// ---------------------------------------------------------------------------

function TabStrip({
  current,
  tabs,
  onChange,
}: {
  current: ResourceManagementTab;
  tabs: ReadonlyArray<{ id: ResourceManagementTab; label: string }>;
  onChange: (next: ResourceManagementTab) => void;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Resource management"
      className="flex border-b border-gray-200"
    >
      {tabs.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={
              active
                ? "-mb-px border-b-2 border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900"
            }
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
