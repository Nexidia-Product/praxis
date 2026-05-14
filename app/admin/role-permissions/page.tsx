/**
 * Legacy `/admin/role-permissions` URL — redirects to
 * `/admin/resources?tab=roles`. Roles & permissions is now a tab on
 * the consolidated Resource Management page; this redirect preserves
 * any external bookmarks pointing at the old path.
 */

import { redirect } from "next/navigation";

export default function LegacyRolePermissionsPage(): never {
  redirect("/admin/resources?tab=roles");
}
