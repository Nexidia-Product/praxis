/**
 * Complaints Work in Progress dashboard (Insights).
 *
 * Identical to the standard Work in Progress dashboard except it's
 * hard-scoped to projects whose `application_product` is "Complaints"
 * (see `isComplaintsProject` in `lib/projects/display.ts`). The standard
 * Work in Progress dashboard hides these by default and only surfaces
 * them via its "Include Complaints projects" toggle — this page is
 * their dedicated home.
 *
 * See `app/insights/work-in-progress/page.tsx` for the shared data
 * loading / authorization rationale; this page mirrors it exactly aside
 * from the `scope="complaints"` prop passed to the shared view.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { isAiEnabled } from "@/lib/ai/feature-flag";
import {
  ProjectGroupRepository,
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  TemplateRepository,
  UserRepository,
} from "@/lib/db";
import { mergeEnumOptions } from "@/lib/projects/enum-options";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { WorkInProgressView } from "@/components/insights/work-in-progress-view";

export const dynamic = "force-dynamic";

export default async function ComplaintsWorkInProgressPage() {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();

  const [projects, tasks, settings, templates, groups, users] =
    await Promise.all([
      ProjectRepository.getAll(),
      TaskRepository.getAll(),
      SettingsRepository.get(),
      TemplateRepository.getAll(),
      ProjectGroupRepository.getAll(),
      UserRepository.getAll(),
    ]);

  const activeUserNames = users
    .filter((u) => u.active)
    .map((u) => u.name.trim())
    .filter((n) => n.length > 0)
    .sort();

  const enumOptions = {
    status: mergeEnumOptions("status", settings.enum_extensions.status),
    phase: mergeEnumOptions("phase", settings.enum_extensions.phase),
    priority: mergeEnumOptions("priority", settings.enum_extensions.priority),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
    ),
  };

  projects.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="complaints-work-in-progress"
      breadcrumbs={[
        { label: "Insights" },
        { label: "Complaints work in progress" },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Complaints work in progress"
        subtitle="Complaints projects currently in planning or in progress, with their latest status and open tasks."
      />
      <WorkInProgressView
        initialProjects={projects}
        initialTasks={tasks}
        customFields={settings.custom_field_definitions}
        enumOptions={enumOptions}
        templates={templates}
        groups={groups}
        quadrantLabels={settings.portfolio_quadrants}
        aiEnabled={isAiEnabled()}
        activeUserNames={activeUserNames}
        currentUserRole={session.user.role}
        currentUserId={session.user.user_id}
        permissions={permissions}
        scope="complaints"
      />
    </PolarisShell>
  );
}
