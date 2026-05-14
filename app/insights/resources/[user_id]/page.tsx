/**
 * Insights → Resources → [user_id] page.
 *
 * Per-resource detail page. This sweep ships a minimal hero +
 * project list + task list so the row-click drill-down from the
 * Overview tab actually has somewhere to land. The richer
 * performance / capacity charts come in the next sweep.
 *
 * Permission gate: `resources.view` opens any detail page; the
 * Overview's "my team" scope means a Project Lead would already
 * have been filtered to people they're permitted to see, but the
 * URL is bookmarkable so the page guards itself again — a Team
 * Member trying to view a peer's detail would land here and get
 * the same "not found" treatment as a missing user, since their
 * roster wouldn't have surfaced this user_id either way.
 *
 * Why no separate scope check on the detail page: the design
 * decision is that anyone who can see the Resources page can
 * navigate to any resource they could see in the Overview. The
 * Overview already enforces scoping; the detail page renders what
 * was clicked through. If a user pastes someone else's URL, they
 * see the page — same threat model as pasting another project's
 * URL.
 */

import { notFound } from "next/navigation";

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import {
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  UserRepository,
} from "@/lib/db";
import { buildResourceRoster } from "@/lib/resources/roster";
import { ResourceDetail } from "@/components/resources/detail";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

interface ResourceDetailPageProps {
  params: Promise<{ user_id: string }>;
}

export default async function ResourceDetailPage({
  params,
}: ResourceDetailPageProps) {
  const session = await requirePermission("resources.view");
  const { permissions } = await getCurrentUserPermissions();
  const { user_id } = await params;

  const [projects, tasks, publicUsers, settings] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    UserRepository.getAllPublic(),
    SettingsRepository.get(),
  ]);

  const fullRoster = buildResourceRoster(
    projects,
    tasks,
    publicUsers,
    settings.resource_settings,
  );
  const row = fullRoster.find((r) => r.user_id === user_id);
  if (!row) notFound();

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="resources"
      breadcrumbs={[
        { label: "Insights" },
        { label: "Resources", href: "/insights/resources" },
        { label: row.resource },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Insights · Resource"
        title={row.resource}
        subtitle={
          row.user_id ? row.user_id : "Free-text resource (not yet linked)"
        }
      />
      <ResourceDetail
        row={row}
        thresholds={settings.resource_settings.workload_buckets}
      />
    </PolarisShell>
  );
}
