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
import {
  ProjectRepository,
  TaskRepository,
  TemplateRepository,
  UserRepository,
} from "@/lib/db";
import { isAssignedToUser } from "@/lib/tasks/display";
import { getMyTasksOrder } from "@/lib/tasks/my-tasks-order";
import {
  getAllowedPrograms,
  filterProjectsByProgram,
  filterTasksByVisibleProjects,
} from "@/lib/projects/visibility";
import { MyTasksView } from "@/components/tasks/my-tasks-view";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function MyTasksPage() {
  const session = await requirePermission("tasks.view");
  const { permissions } = await getCurrentUserPermissions();
  const userId = session.user.user_id;
  const userName = session.user.name ?? "";

  const [allTasksRaw, allProjects, templates, users, savedOrder] = await Promise.all([
    TaskRepository.getAll(),
    ProjectRepository.getAll(),
    TemplateRepository.getAll(),
    UserRepository.getAll(),
    // Per-user checklist ordering. Defaults to [] if unset or the
    // ui_preferences column hasn't been migrated yet.
    getMyTasksOrder(userId).catch(() => [] as string[]),
  ]);

  const allowedPrograms = await getAllowedPrograms(session);
  const projects = filterProjectsByProgram(allProjects, allowedPrograms);
  const visibleProjectIds = new Set(projects.map((p) => p.project_id));
  const allTasks = filterTasksByVisibleProjects(allTasksRaw, visibleProjectIds);

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
      <MyTasksView
        initialTasks={myTasks}
        projects={projects}
        templates={templates}
        currentUserRole={session.user.role}
        currentUserId={userId}
        permissions={permissions}
        defaultResponsible={userName || undefined}
        activeUserNames={activeUserNames}
        mentionableUsers={mentionableUsers}
        savedOrder={savedOrder}
      />
    </PolarisShell>
  );
}
