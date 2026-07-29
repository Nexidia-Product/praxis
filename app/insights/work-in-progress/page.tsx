/**
 * Work in Progress dashboard (Insights).
 *
 * Server component. Loads the full project + task lists (plus the
 * supporting settings, templates, groups and user roster the reused
 * project/task edit modals need) and hands them to the client
 * `WorkInProgressView`.
 *
 * The view itself narrows to projects whose status is "In Planning" or
 * "In Progress" and, for each, lists the open (non-terminal) tasks. It's
 * kept as live client state so an inline status edit re-filters the board
 * and a completed task drops off its project's open list immediately.
 *
 * Authorization: viewing needs `projects.view` (broadly granted, same as
 * the Key Capabilities dashboard). Per-project and per-task edit
 * affordances inside the view are gated by the granular
 * `projects.edit` / `tasks.edit` / `tasks.delete` / `tasks.move`
 * permissions, and the underlying API routes enforce them.
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

export default async function WorkInProgressPage() {
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

  // Active-user names for the project-lead / task-responsible dropdowns
  // inside the reused edit modals. Mirrors the Projects and Tasks pages so
  // a brand-new user can be assigned without first appearing in the data.
  const activeUserNames = users
    .filter((u) => u.active)
    .map((u) => u.name.trim())
    .filter((n) => n.length > 0)
    .sort();

  // Merged enum options (built-ins + admin extensions, archived excluded).
  // Same shape the Projects page passes so admin-added status / phase /
  // priority / application values appear in the edit modals.
  const enumOptions = {
    status: mergeEnumOptions("status", settings.enum_extensions.status),
    phase: mergeEnumOptions("phase", settings.enum_extensions.phase),
    priority: mergeEnumOptions("priority", settings.enum_extensions.priority),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
    ),
  };

  // Stable base order: project_id ascending (YYYY-NNN). The client sorts
  // the visible WIP cards itself, but a deterministic seed keeps the
  // modal pickers tidy.
  projects.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="work-in-progress"
      breadcrumbs={[{ label: "Insights" }, { label: "Work in progress" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Work in progress"
        subtitle="Projects currently in planning or in progress, with their latest status and open tasks."
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
      />
    </PolarisShell>
  );
}
