/**
 * My Tasks page (Section 5.3).
 *
 * Same table component as `/tasks`, but the dataset is filtered
 * server-side to tasks where the current user is responsible OR is in
 * the additional assignees list.
 *
 * The legacy seed data stores `responsible` as free-form names like
 * "Josh" (not user IDs), so we match against BOTH the session's
 * `user_id` AND the user's `name`. New tasks created through the UI
 * store the user_id, so the name fallback gracefully ages out as legacy
 * records get edited.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { ProjectRepository, TaskRepository } from "@/lib/db";
import { isAssignedToUser } from "@/lib/tasks/display";
import { TasksTable } from "@/components/tasks/tasks-table";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const session = await requirePermission("tasks.view");
  const { permissions } = await getCurrentUserPermissions();
  const userId = session.user.user_id;
  const userName = session.user.name ?? "";

  const [allTasks, projects] = await Promise.all([
    TaskRepository.getAll(),
    ProjectRepository.getAll(),
  ]);

  // Same helper the home KPI uses (HOME-02) so the count and the list
  // can never disagree.
  const myTasks = allTasks.filter((t) =>
    isAssignedToUser(t, userId, userName),
  );

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="my-tasks"
      breadcrumbs={[{ label: "My tasks" }]}
    >
      <PolarisPageHeader
        eyebrow="Workspace"
        title="My tasks"
        subtitle="Tasks assigned to you across every project."
      />
      <TasksTable
        initialTasks={myTasks}
        projects={projects}
        currentUserRole={session.user.role}
        permissions={permissions}
        scopeToUser
        defaultResponsible={userName || undefined}
      />
    </PolarisShell>
  );
}
