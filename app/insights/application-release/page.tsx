/**
 * Application Release view (Insights).
 *
 * Server component. A "release" is the set of projects sharing a Target
 * Application Deployment Date (`target_date`). The viewer picks any
 * scheduled release date (every other Friday, plus any off-cycle date a
 * project already uses) via `?date=YYYY-MM-DD`; the page assembles each
 * project's progress, stage, objective/use case, blockers and schedule
 * risk and hands the lot to the client view.
 *
 * Authorization: `projects.view`, scoped to the viewer's allowed
 * programs — same as Key Capabilities.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import {
  ProjectRepository,
  TaskRepository,
  UseCaseRepository,
  UserRepository,
} from "@/lib/db";
import { todayIso } from "@/lib/db/store";
import { isAdminProject } from "@/lib/projects/display";
import {
  getAllowedPrograms,
  filterProjectsByProgram,
} from "@/lib/projects/visibility";
import {
  buildReleaseDates,
  defaultReleaseDate,
} from "@/lib/releases/calendar";
import { buildReleaseReport } from "@/lib/releases/report";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { ApplicationReleaseView } from "@/components/insights/application-release-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ date?: string }>;
}

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export default async function ApplicationReleasePage({
  searchParams,
}: PageProps) {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const { date: requestedDate } = await searchParams;

  const [allProjects, allTasks, useCases, users] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    UseCaseRepository.getAll(),
    UserRepository.getAll(),
  ]);

  const allowedPrograms = await getAllowedPrograms(session);
  // Admin/governance projects aren't release deliverables.
  const projects = filterProjectsByProgram(allProjects, allowedPrograms).filter(
    (p) => !isAdminProject(p),
  );

  const today = todayIso();
  const options = buildReleaseDates(
    projects
      .filter((p) => p.status !== "Canceled")
      .map((p) => p.target_date)
      .filter((d): d is string => Boolean(d)),
    today,
  );

  const selected =
    requestedDate &&
    ISO_DATE.test(requestedDate) &&
    options.some((o) => o.date === requestedDate)
      ? requestedDate
      : defaultReleaseDate(options, today);

  const userNamesById: Record<string, string> = {};
  for (const u of users) userNamesById[u.user_id] = u.name;

  const report = selected
    ? buildReleaseReport({
        date: selected,
        today,
        projects,
        allProjects,
        allTasks,
        useCases,
        userNamesById,
      })
    : null;

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="application-release"
      breadcrumbs={[{ label: "Insights" }, { label: "Application release" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Application release"
        subtitle="Everything aligned to a Target Application Deployment Date: progress, stage, objective and use case, what's blocking, and what's at risk of missing the date."
      />
      <ApplicationReleaseView
        options={options}
        selectedDate={selected}
        today={today}
        report={report}
      />
    </PolarisShell>
  );
}
