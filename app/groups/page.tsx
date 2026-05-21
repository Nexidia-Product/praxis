/**
 * /groups — named clusters of related projects.
 *
 * Server component: loads every group, every project (for the
 * expand-row member detail), and resolves user IDs to display names
 * for the project_lead column. The client workspace handles
 * create/edit/delete via the /api/project-groups routes.
 *
 * Read access via projects.view; write affordances are gated
 * client-side by `projects.edit` (the API enforces the same gate
 * server-side regardless).
 */

import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import {
  ProjectGroupRepository,
  ProjectRepository,
  UserRepository,
} from "@/lib/db";
import { GroupsWorkspace } from "@/components/groups/workspace";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function GroupsPage() {
  const session = await requirePagePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();

  const [groups, projects, users] = await Promise.all([
    ProjectGroupRepository.getAll(),
    ProjectRepository.getAll(),
    UserRepository.getAll(),
  ]);

  // Pre-resolve user IDs to display names so the client component
  // doesn't have to ship the whole users table to the browser just
  // to render a "Project lead" column. Names are stable enough that
  // a snapshot per page load is fine.
  const userNamesById: Record<string, string> = {};
  for (const u of users) {
    userNamesById[u.user_id] = u.name;
  }

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="groups"
      breadcrumbs={[{ label: "Workspace" }, { label: "Groups" }]}
    >
      <PolarisPageHeader
        eyebrow="Workspace"
        title="Project groups"
        subtitle="Named clusters of related projects — projects that share an analysis, dataset, or domain context and benefit from being considered together. Independent of finish-to-start dependencies."
      />
      <GroupsWorkspace
        initialGroups={groups}
        projects={projects}
        userNamesById={userNamesById}
        canEdit={permissions["projects.edit"] === true}
      />
    </PolarisShell>
  );
}
