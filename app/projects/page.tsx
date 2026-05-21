/**
 * Projects page (Section 5.1).
 *
 * Server component: loads the project list, current set of custom field
 * definitions, and available task templates on render and passes them to
 * the client component. Subsequent edits, creates, and deletes are
 * handled client-side via the `/api/projects/*` routes.
 *
 * Rendered inside the Polaris shell. The bespoke top-of-page header
 * block from earlier steps was removed when the shell took over breadcrumb
 * and navigation responsibilities.
 *
 * Access: any authenticated user (Viewer role can read). Edit controls
 * inside the table are gated by the user's role; the page itself does
 * not 403 for a non-Admin since reading is allowed.
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
  TemplateRepository,
  UserRepository,
} from "@/lib/db";
import { mergeEnumOptions } from "@/lib/projects/enum-options";
import { ProjectsTable } from "@/components/projects/projects-table";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const [projects, settings, templates, groups, users] = await Promise.all([
    ProjectRepository.getAll(),
    SettingsRepository.get(),
    TemplateRepository.getAll(),
    ProjectGroupRepository.getAll(),
    UserRepository.getAll(),
  ]);

  // Active-user names for the project form's Project lead dropdown.
  // The filter bar's lead list stays project-derived (filtering by a
  // lead with no projects yields nothing useful), but the form needs
  // the full roster so a brand-new user can be assigned without
  // appearing in any project first.
  const activeUserNames = users
    .filter((u) => u.active)
    .map((u) => u.name.trim())
    .filter((n) => n.length > 0)
    .sort();

  // Merge built-in enum values with admin-added extensions (Section 5.19).
  // We exclude archived values from the dropdown lists used in the table
  // and form, since archive is the soft-delete affordance — but we keep
  // archived values flowing through the badge renderer so projects whose
  // value has since been archived still display correctly. The badge
  // renderer hits a separate code path that reads the full list including
  // archived (see `lib/projects/display.ts` lookups).
  const enumOptions = {
    status: mergeEnumOptions("status", settings.enum_extensions.status),
    phase: mergeEnumOptions("phase", settings.enum_extensions.phase),
    priority: mergeEnumOptions("priority", settings.enum_extensions.priority),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
    ),
  };

  // Initial sort: by project_id ascending — oldest projects on top,
  // newest at the bottom. project_id is YYYY-NNN, so string compare
  // gives the right ordering both across years and within a year.
  // The client can re-sort via column headers; this is just the
  // default landing order.
  projects.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="projects"
      breadcrumbs={[{ label: "Projects" }]}
    >
      <PolarisPageHeader
        eyebrow="Workspace"
        title="Projects"
        subtitle="Track and manage every active and planned innovation project."
      />
      <ProjectsTable
        initialProjects={projects}
        customFields={settings.custom_field_definitions}
        currentUserRole={session.user.role}
        permissions={permissions}
        templates={templates}
        enumOptions={enumOptions}
        quadrantLabels={settings.portfolio_quadrants}
        aiEnabled={isAiEnabled()}
        groups={groups}
        activeUserNames={activeUserNames}
      />
    </PolarisShell>
  );
}
