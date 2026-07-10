/**
 * Key findings review (Insights).
 *
 * Server component. Loads the project list for the searchable picker and
 * hands it to the client `KeyFindingsView`, which fetches a project's
 * tasks on demand (GET /api/tasks?project_id=) and surfaces the most
 * recent key finding for each task.
 *
 * Authorization: viewing needs `projects.view` (broadly granted, same as
 * the Work in Progress and Key Capabilities dashboards).
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { isAiEnabled } from "@/lib/ai/feature-flag";
import { ProjectRepository } from "@/lib/db";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { KeyFindingsView } from "@/components/insights/key-findings-view";

export const dynamic = "force-dynamic";

export default async function KeyFindingsPage() {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();

  const projects = await ProjectRepository.getAll();
  // Stable seed order (YYYY-NNN); the picker re-sorts by name itself.
  projects.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="key-findings"
      breadcrumbs={[{ label: "Insights" }, { label: "Key findings" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Key findings"
        subtitle="Review the latest key finding recorded on each task in a project."
      />
      <KeyFindingsView projects={projects} aiEnabled={isAiEnabled()} />
    </PolarisShell>
  );
}
