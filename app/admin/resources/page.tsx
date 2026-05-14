/**
 * Admin → Resource Management page.
 *
 * Server component that consolidates three previously separate admin
 * pages — Users, Roles & Permissions, Resource Thresholds — under a
 * single tabbed workspace. The grouping is intentional: every tab
 * here describes the people side of the application (who has
 * accounts, what each role is allowed to do, how their workload is
 * bucketed).
 *
 * Page-level access is granted to anyone with at least one of the
 * three per-tab permissions. The workspace then hides the tabs the
 * current user can't access. A user with `admin.users.manage` and
 * nothing else lands on the Users tab and never sees the others.
 *
 * Tab selection is read from `?tab=...` so deep links round-trip
 * cleanly (the legacy URLs `/admin/users`, `/admin/role-permissions`,
 * `/admin/resource-thresholds` all redirect here with the correct tab).
 *
 * Data loading is server-side, identical to the previous per-page
 * loads. Each underlying admin component (UsersAdminPanel,
 * RolePermissionsEditor, ResourceThresholdsAdmin) is reused as-is.
 */

import { toAdminUser } from "@/lib/auth/admin-user-view";
import {
  getCurrentUserPermissions,
  requireAnyPagePermission,
} from "@/lib/auth/permissions";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  getCatalogByCategory,
  normalizeRolePermissions,
} from "@/lib/auth/role-permissions";
import { SettingsRepository, UserRepository, type UserRole } from "@/lib/db";
import {
  ResourceManagementWorkspace,
  type ResourceManagementTab,
} from "@/components/admin/resource-management-workspace";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

const VALID_TABS: ReadonlyArray<ResourceManagementTab> = [
  "users",
  "roles",
  "thresholds",
];

const EDITABLE_ROLES: UserRole[] = ["Project Lead", "Team Member", "Viewer"];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResourceManagementPage({
  searchParams,
}: PageProps) {
  const session = await requireAnyPagePermission([
    "admin.users.manage",
    "admin.roles.manage",
    "admin.resource_thresholds.manage",
  ]);
  const { permissions } = await getCurrentUserPermissions();
  const params = await searchParams;

  // Initial tab from URL (?tab=...). The workspace coerces invalid /
  // not-permitted values to the first tab the user can see.
  const requestedTab =
    typeof params.tab === "string" &&
    (VALID_TABS as readonly string[]).includes(params.tab)
      ? (params.tab as ResourceManagementTab)
      : "users";

  // Load every tab's data on the server in parallel. Same model as the
  // per-page loads we used to do — no client-side fetches added.
  const [allUsers, settings] = await Promise.all([
    UserRepository.getAll(),
    SettingsRepository.get(),
  ]);

  // Users tab data. `toAdminUser` decorates with `pending_invite`
  // derived from auth.users.last_sign_in_at; the live value comes
  // through the admin GET /api/admin/users response, so for SSR we
  // pass `null` (= "no recent sign-in") and let the table refresh
  // pick up the real state once mounted.
  allUsers.sort((a, b) => a.name.localeCompare(b.name));
  const users = allUsers.map((u) => toAdminUser(u, null));

  // Roles & permissions tab data
  const matrix = normalizeRolePermissions(settings.role_permissions);

  // Resource thresholds tab data
  const defaultResourceSettings =
    SettingsRepository.defaults().resource_settings;

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-resources"
      breadcrumbs={[{ label: "Admin" }, { label: "Resource management" }]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="Resource management"
        subtitle="Users, role permissions, and resource thresholds in one place. Each tab is gated by its own permission."
      />
      <ResourceManagementWorkspace
        initialTab={requestedTab}
        permissions={permissions}
        initialUsers={users}
        currentUserId={session.user.user_id}
        catalog={PERMISSION_CATALOG}
        catalogByCategory={getCatalogByCategory()}
        allKeys={[...ALL_PERMISSION_KEYS]}
        editableRoles={EDITABLE_ROLES}
        initialMatrix={matrix}
        defaultMatrix={DEFAULT_ROLE_PERMISSIONS}
        initialResourceSettings={settings.resource_settings}
        defaultResourceSettings={defaultResourceSettings}
      />
    </PolarisShell>
  );
}
