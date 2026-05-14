/**
 * Role & permissions admin API.
 *
 *   GET  /api/admin/role-permissions
 *     Returns the full catalog (grouped by category) and the current
 *     role -> permissions map (with Admin always rendered as the full
 *     set, regardless of stored value).
 *
 *   PUT  /api/admin/role-permissions
 *     Replaces the role -> permissions map. The Admin entry is forced
 *     to the full catalog server-side; the request body's Admin entry
 *     (if any) is ignored.
 *
 * Both endpoints require the `admin.roles.manage` permission. By
 * default that's only granted to Admin, but the system is intentionally
 * configurable: an organization could grant "edit roles" to a trusted
 * non-Admin role if they really wanted to.
 *
 * Safety: a Project Lead with `admin.roles.manage` could in principle
 * use this endpoint to remove that permission from their own role and
 * lock themselves out. The Admin role's permission is never editable,
 * so an Admin always retains the ability to undo such a change.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  ALL_PERMISSION_KEYS,
  DEFAULT_ROLE_PERMISSIONS,
  PERMISSION_CATALOG,
  getCatalogByCategory,
  normalizeRolePermissions,
  type PermissionKey,
} from "@/lib/auth/role-permissions";
import { SettingsRepository, type RolePermissionsMap, type UserRole } from "@/lib/db";

const EDITABLE_ROLES: UserRole[] = ["Project Lead", "Team Member", "Viewer"];

export const GET = withAuth(async () => {
  await requirePermission("admin.roles.manage");
  const settings = await SettingsRepository.get();
  const normalized = normalizeRolePermissions(settings.role_permissions);

  return NextResponse.json({
    catalog: PERMISSION_CATALOG,
    catalog_by_category: getCatalogByCategory(),
    all_permission_keys: ALL_PERMISSION_KEYS,
    role_permissions: normalized,
    defaults: DEFAULT_ROLE_PERMISSIONS,
    editable_roles: EDITABLE_ROLES,
  });
});

interface PutBody {
  role_permissions?: unknown;
}

export const PUT = withAuth(async (request: Request) => {
  await requirePermission("admin.roles.manage");

  let body: PutBody;
  try {
    body = (await request.json()) as PutBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (!body.role_permissions || typeof body.role_permissions !== "object") {
    return NextResponse.json(
      { error: "`role_permissions` is required and must be an object." },
      { status: 400 },
    );
  }

  // Normalize against the catalog. This drops any unknown keys, supplies
  // defaults for any missing roles, and forces Admin to the full set.
  const normalized = normalizeRolePermissions(body.role_permissions);

  // Persist. SettingsRepository.update merges, so other settings keys
  // (health thresholds, branding, etc.) are untouched.
  await SettingsRepository.update({
    role_permissions: normalized as unknown as RolePermissionsMap,
  });

  // Build the response shape so the UI can update without a re-fetch.
  // Echo the same shape as GET for symmetry.
  return NextResponse.json({
    catalog: PERMISSION_CATALOG,
    catalog_by_category: getCatalogByCategory(),
    all_permission_keys: ALL_PERMISSION_KEYS as readonly PermissionKey[],
    role_permissions: normalized,
    defaults: DEFAULT_ROLE_PERMISSIONS,
    editable_roles: EDITABLE_ROLES,
  });
});
