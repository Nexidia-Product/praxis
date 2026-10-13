/**
 * Server body shared by the Work in progress and Post-deployment pages.
 *
 * Loads the full project + task lists (plus the supporting settings,
 * templates, groups and user roster the reused project/task edit modals
 * need) and hands them to the client `WorkInProgressView`, which narrows
 * them by `mode`:
 *
 *   - "wip": projects "In Planning" or "In Progress", with deployed
 *     projects (stage at or past Productization) hidden unless opted in;
 *   - "post-deployment": deployed projects whose status is still open.
 *
 * Authorization: viewing needs `projects.view`. Edit affordances inside the
 * view are gated by the granular permissions, and the API routes enforce them.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { isAiEnabled } from "@/lib/ai/feature-flag";
import {
  NiceProductRepository,
  ProjectGroupRepository,
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  TemplateRepository,
  UseCaseRepository,
  UserRepository,
} from "@/lib/db";
import { mergeEnumOptions } from "@/lib/projects/enum-options";
import {
  getAllowedPrograms,
  filterProjectsByProgram,
  filterTasksByVisibleProjects,
  getDefaultProgram,
} from "@/lib/projects/visibility";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import {
  WorkInProgressView,
  type WipMode,
} from "@/components/insights/work-in-progress-view";

export async function WipPage({ mode }: { mode: WipMode }) {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();

  const [allProjects, allTasks, settings, templates, groups, useCases, users, niceProducts] =
    await Promise.all([
      ProjectRepository.getAll(),
      TaskRepository.getAll(),
      SettingsRepository.get(),
      TemplateRepository.getAll(),
      ProjectGroupRepository.getAll(),
      UseCaseRepository.getAll(),
      UserRepository.getAll(),
      NiceProductRepository.getAll(),
    ]);

  const allowedPrograms = await getAllowedPrograms(session);
  const projects = filterProjectsByProgram(allProjects, allowedPrograms);
  const visibleProjectIds = new Set(projects.map((p) => p.project_id));
  const tasks = filterTasksByVisibleProjects(allTasks, visibleProjectIds);
  const currentUser = users.find((u) => u.user_id === session.user.user_id);
  const defaultProgram = getDefaultProgram(
    { primary_program: currentUser?.primary_program ?? null },
    allowedPrograms,
  );

  // Active-user names for the project-lead / task-responsible dropdowns
  // inside the reused edit modals. Mirrors the Projects and Tasks pages so
  // a brand-new user can be assigned without first appearing in the data.
  const activeUserNames = users
    .filter((u) => u.active)
    .map((u) => u.name.trim())
    .filter((n) => n.length > 0)
    .sort();

  // @Mention picker roster — same active-user set as activeUserNames,
  // paired with user_id so the picker can insert a name the backend can
  // re-resolve to a real recipient. Mirrors the Projects/Tasks pages.
  const mentionableUsers = users
    .filter((u) => u.active && u.name.trim().length > 0)
    .map((u) => ({ user_id: u.user_id, name: u.name.trim() }))
    .sort((a, b) => a.name.localeCompare(b.name));

  // Merged enum options (built-ins + admin extensions, archived excluded).
  // Same shape the Projects page passes so admin-added status /
  // priority / application values appear in the edit modals.
  const enumOptions = {
    status: mergeEnumOptions("status", settings.enum_extensions.status),
    priority: mergeEnumOptions("priority", settings.enum_extensions.priority),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
    ),
    program: mergeEnumOptions("program", settings.enum_extensions.program).filter(
      (o) => allowedPrograms === "all" || allowedPrograms.includes(o.id),
    ),
    track: mergeEnumOptions("track", settings.enum_extensions.track),
  };

  // Stable base order: project_id ascending (YYYY-NNN). The client sorts
  // the visible WIP cards itself, but a deterministic seed keeps the
  // modal pickers tidy.
  projects.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));

  const copy =
    mode === "post-deployment"
      ? {
          navKey: "post-deployment" as const,
          crumb: "Post-deployment",
          title: "Post-deployment",
          subtitle:
            "Projects that have reached Productization but are still open, with their latest status and the post-deployment work still to do.",
        }
      : {
          navKey: "work-in-progress" as const,
          crumb: "Work in progress",
          title: "Work in progress",
          subtitle:
            "Projects currently in planning or in progress, with their latest status and open tasks. Deployed projects are hidden by default; see Post-deployment.",
        };

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey={copy.navKey}
      breadcrumbs={[{ label: "Insights" }, { label: copy.crumb }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title={copy.title}
        subtitle={copy.subtitle}
      />
      <WorkInProgressView
        mode={mode}
        initialProjects={projects}
        initialTasks={tasks}
        customFields={settings.custom_field_definitions}
        enumOptions={enumOptions}
        templates={templates}
        groups={groups}
        useCases={useCases}
        niceProducts={niceProducts}
        outcomeProducts={settings.outcome_products}
        outcomeTypes={settings.outcome_types}
        quadrantLabels={settings.portfolio_quadrants}
        aiEnabled={isAiEnabled()}
        activeUserNames={activeUserNames}
        mentionableUsers={mentionableUsers}
        currentUserRole={session.user.role}
        currentUserId={session.user.user_id}
        permissions={permissions}
        defaultProgram={defaultProgram}
      />
    </PolarisShell>
  );
}
