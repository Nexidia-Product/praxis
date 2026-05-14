/**
 * Admin → Audit Log page (Step 13 / Section 5.19).
 *
 * Surfaces recent create / update / delete activity across the
 * application so an operator can answer "who changed X, and when?"
 * without scraping logs. Read-only; the underlying record is
 * append-only.
 *
 * Page-level access is gated by `admin.audit_log.view`. The data
 * itself is fetched client-side (the table has filter chips that
 * round-trip through the API), so this server component just
 * resolves the session and renders the shell.
 */

import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import { UserRepository } from "@/lib/db";
import { AuditLogTable } from "@/components/admin/audit-log-table";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function AuditLogPage() {
  const session = await requirePagePermission("admin.audit_log.view");
  const { permissions } = await getCurrentUserPermissions();

  // Pre-load the user roster so the "actor" filter dropdown shows
  // names instead of opaque user IDs. Cheap — users.json is small —
  // and avoids a second client fetch for what is effectively static
  // data on this page.
  const allUsers = await UserRepository.getAll();
  const actors = allUsers
    .map((u) => ({ user_id: u.user_id, name: u.name }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-audit-log"
      breadcrumbs={[{ label: "Admin" }, { label: "Audit log" }]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="Audit log"
        subtitle="Recent create, update, and delete activity across projects, tasks, ideas, decisions, and user management. Append-only — entries cannot be edited."
      />
      <AuditLogTable actors={actors} />
    </PolarisShell>
  );
}
