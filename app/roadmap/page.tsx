/**
 * Roadmap page (Sections 5.4–5.8).
 *
 * Server component: loads the project list and the app settings (which
 * carry the saved Kanban configurations and the custom field schema)
 * once on render, then hands them to the client `<RoadmapWorkspace>`.
 *
 * Access: any authenticated user (Viewer included). The workspace gates
 * write affordances by role; the page does not 403 since reading is
 * always allowed.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { isAiEnabled } from "@/lib/ai/feature-flag";
import {
  ProjectRepository,
  SettingsRepository,
  TemplateRepository,
  UserRepository,
} from "@/lib/db";
import { isAdminProject } from "@/lib/projects/display";
import { mergeEnumOptions } from "@/lib/projects/enum-options";
import { RoadmapWorkspace } from "@/components/roadmap/workspace";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function RoadmapPage() {
  const session = await requirePermission("roadmap.view");
  const { permissions } = await getCurrentUserPermissions();
  const [allProjects, settings, templates, users] = await Promise.all([
    ProjectRepository.getAll(),
    SettingsRepository.get(),
    TemplateRepository.getAll(),
    UserRepository.getAll(),
  ]);

  // Active-user names for the project form's Project lead dropdown
  // (reachable from the roadmap quick view's Edit button). Same
  // shape and treatment as on /projects.
  const activeUserNames = users
    .filter((u) => u.active)
    .map((u) => u.name.trim())
    .filter((n) => n.length > 0)
    .sort();

  // Merged option lists (built-ins + admin extensions, archived
  // values excluded). Threaded into the workspace so the edit modal
  // — now reachable from the roadmap quick view — sees the same
  // dropdown options as the Projects page form.
  const enumOptions = {
    status: mergeEnumOptions("status", settings.enum_extensions.status),
    phase: mergeEnumOptions("phase", settings.enum_extensions.phase),
    priority: mergeEnumOptions("priority", settings.enum_extensions.priority),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
    ),
  };

  // Admin-typed / Admin-product projects track internal team cadence
  // (operational work, governance, tooling) that affects delivery but
  // isn't itself a portfolio project. Filter them out at the source so
  // every roadmap view (timeline, kanban, bubble, now/next/later) and
  // every export honors the exclusion without each view re-implementing
  // the rule.
  const projects = allProjects.filter((p) => !isAdminProject(p));

  projects.sort((a, b) => {
    if (a.date_added !== b.date_added) {
      return a.date_added < b.date_added ? 1 : -1;
    }
    return a.project_id < b.project_id ? 1 : -1;
  });

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="roadmap"
      breadcrumbs={[{ label: "Roadmap" }]}
    >
      <PolarisPageHeader
        eyebrow="Workspace"
        title="Roadmap"
        subtitle="Four lenses on the same portfolio: timeline, board, scatter, and horizons."
      />
      <RoadmapWorkspace
        initialProjects={projects}
        initialKanbanConfigs={settings.kanban_configs}
        customFields={settings.custom_field_definitions}
        currentUserRole={session.user.role}
        permissions={permissions}
        quadrantLabels={settings.portfolio_quadrants}
        enumOptions={enumOptions}
        templates={templates}
        aiEnabled={isAiEnabled()}
        activeUserNames={activeUserNames}
      />
    </PolarisShell>
  );
}
