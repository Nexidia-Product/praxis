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

import { buildLastSignInIndex, toAdminUser } from "@/lib/auth/admin-user-view";
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
import { getServiceRoleClient } from "@/lib/supabase/server";
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

  // Load every tab's data on the server in parallel. The third call
  // (auth.admin.listUsers) is what feeds `pending_invite` — it
  // returns each user's `last_sign_in_at`, which is null for users
  // who have never signed in (= still pending an invite) and an
  // ISO timestamp once they have. The page goes through three round
  // trips to the database/auth service on render; small datasets so
  // it's fine.
  const supabase = getServiceRoleClient();
  const [allUsers, settings, authPage] = await Promise.all([
    UserRepository.getAll(),
    SettingsRepository.get(),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);

  const lastSignInById = buildLastSignInIndex(
    (authPage.data?.users ?? []).map((u) => ({
      id: u.id,
      last_sign_in_at: u.last_sign_in_at ?? null,
    })),
  );

  allUsers.sort((a, b) => a.name.localeCompare(b.name));
  const users = allUsers.map((u) =>
    toAdminUser(u, lastSignInById.get(u.user_id) ?? null),
  );

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
