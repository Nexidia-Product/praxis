/**
 * Legacy `/admin/users` URL — kept as a redirect to the new tabbed
 * `/admin/resources` page (Users tab). User management was consolidated
 * into a single Resource Management page alongside Roles & permissions
 * and Resource thresholds.
 *
 * The redirect runs server-side and lands on the destination page,
 * which does its own permission gating. A user without
 * `admin.users.manage` will land there and the workspace will hide the
 * Users tab — same end state as a 403 against the legacy page would
 * have produced.
 */

import { redirect } from "next/navigation";

export default function LegacyUsersPage(): never {
  redirect("/admin/resources?tab=users");
}
