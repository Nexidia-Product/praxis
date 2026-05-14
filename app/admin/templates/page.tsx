/**
 * Admin → Task Templates page (Section 5.19).
 *
 * Server-renders the current list of templates. Admin-only.
 *
 * Templates are pre-built lists of tasks that can be auto-applied when
 * creating a project of the matching type. Edits are managed entirely
 * client-side via `/api/templates/*`.
 */

import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import { TemplateRepository } from "@/lib/db";
import { TemplatesAdmin } from "@/components/admin/templates-admin";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

// Session-bound page — must not be statically pre-rendered at build
// time, where Supabase env vars may not be available.
export const dynamic = "force-dynamic";

export default async function TemplatesAdminPage() {
  const session = await requirePagePermission("admin.templates.manage");
  const { permissions } = await getCurrentUserPermissions();
  const templates = await TemplateRepository.getAll();
  templates.sort((a, b) => a.template_name.localeCompare(b.template_name));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-templates"
      breadcrumbs={[
        { label: "Admin" },
        { label: "Templates" },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="Task templates"
        subtitle="Pre-built task lists offered when creating a project of the matching type."
      />
      <TemplatesAdmin initialTemplates={templates} />
    </PolarisShell>
  );
}
