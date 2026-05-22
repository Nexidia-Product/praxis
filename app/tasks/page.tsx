/**
 * Tasks page (Section 5.2).
 *
 * Server-loads all tasks and projects, then hands them to the client
 * table. Subsequent edits and creates flow through `/api/tasks/*` and
 * update the client state in place.
 *
 * Optional `?project=YYYY-NNN` query param pre-filters to one project.
 * The project quick-view's "View tasks" link uses this so the user lands
 * on a focused list without having to apply the filter manually.
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
import { TasksTable } from "@/components/tasks/tasks-table";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

interface TasksPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function TasksPage({ searchParams }: TasksPageProps) {
  const session = await requirePermission("tasks.view");
  const { permissions } = await getCurrentUserPermissions();
  const params = await searchParams;
  const projectFilter =
    typeof params.project === "string" ? params.project : null;

  const [tasks, projects, templates, users] = await Promise.all([
    TaskRepository.getAll(),
    ProjectRepository.getAll(),
    TemplateRepository.getAll(),
    UserRepository.getAll(),
  ]);

  // Active-user names for the task form's Responsible dropdown.
  // The filter bar's Responsible list stays task-derived; only the
  // form needs the full roster so a brand-new user can be assigned
  // without first appearing in some task.
  const activeUserNames = users
    .filter((u) => u.active)
    .map((u) => u.name.trim())
    .filter((n) => n.length > 0)
    .sort();

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="tasks"
      breadcrumbs={[{ label: "Tasks" }]}
    >
      <PolarisPageHeader
        eyebrow="Workspace"
        title="Tasks"
        subtitle="All tasks across the project portfolio. Color-coded by urgency."
      />
      <TasksTable
        initialTasks={tasks}
        projects={projects}
        templates={templates}
        currentUserRole={session.user.role}
        permissions={permissions}
        defaultProjectId={projectFilter ?? undefined}
        activeUserNames={activeUserNames}
      />
    </PolarisShell>
  );
}
