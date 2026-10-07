/**
 * Executive view (Insights).
 *
 * Server component. A read-only, presentation-friendly rollup of the
 * Innovation portfolio by pillar (objective) for a chosen quarter, meant
 * to be screen-shared in QBRs and updates by someone with Praxis access.
 * `?scope=YYYY-Qn` picks the quarter (by Target Application Deployment
 * Date), `?scope=unscheduled` the projects with no date. Defaults to the
 * current quarter.
 *
 * Scope: Innovation program, the five core pillars only (Complaints and
 * Other are excluded); see lib/executive/portfolio.ts.
 *
 * Authorization: `projects.view`, scoped to the viewer's programs.
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
import { formatQuarter } from "@/lib/key-capabilities";
import {
  getAllowedPrograms,
  filterProjectsByProgram,
} from "@/lib/projects/visibility";
import {
  buildExecutiveView,
  countNoPillar,
  isExecEligible,
  quarterOfDate,
  scopeOptions,
} from "@/lib/executive/portfolio";
import {
  buildReleaseDates,
  defaultReleaseDate,
} from "@/lib/releases/calendar";
import { buildProjectEntries } from "@/lib/releases/report";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import {
  ExecutiveView,
  type UpcomingRelease,
} from "@/components/insights/executive-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ scope?: string }>;
}

export default async function ExecutivePage({ searchParams }: PageProps) {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const { scope: requestedScope } = await searchParams;

  const [allProjects, allTasks, useCases, users] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    UseCaseRepository.getAll(),
    UserRepository.getAll(),
  ]);

  const allowedPrograms = await getAllowedPrograms(session);
  const visible = filterProjectsByProgram(allProjects, allowedPrograms);

  const userNamesById: Record<string, string> = {};
  for (const u of users) userNamesById[u.user_id] = u.name;

  const today = todayIso();
  const eligible = visible.filter(isExecEligible);
  const entries = buildProjectEntries({
    today,
    projects: eligible,
    allProjects,
    allTasks,
    useCases,
    userNamesById,
  });

  const options = scopeOptions(entries, today, formatQuarter);
  const scope =
    requestedScope && options.some((o) => o.value === requestedScope)
      ? requestedScope
      : quarterOfDate(today);

  const view = buildExecutiveView({ entries, scope, today });
  const noPillarCount = countNoPillar(visible.filter((p) => p.status !== "Canceled"));

  // Next three scheduled releases with how many in-scope-program projects
  // (any quarter) ride each one, and how many of those are at risk.
  const releaseDates = buildReleaseDates(
    entries.map((e) => e.project.target_date).filter((d): d is string => !!d),
    today,
  )
    .filter((o) => o.date >= today)
    .slice(0, 3);
  const upcoming: UpcomingRelease[] = releaseDates.map((o) => {
    const rides = entries.filter((e) => e.project.target_date === o.date);
    return {
      date: o.date,
      projects: rides.length,
      atRisk: rides.filter((e) => e.atRisk || e.missedDelivery).length,
      isNext: o.date === defaultReleaseDate(releaseDates, today),
    };
  });

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="executive"
      breadcrumbs={[{ label: "Insights" }, { label: "Executive view" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Executive view"
        subtitle="Innovation work by pillar for the selected quarter — stage, status, risk, blockers, and documented benefits."
      />
      <ExecutiveView
        view={view}
        options={options}
        today={today}
        upcoming={upcoming}
        noPillarCount={noPillarCount}
      />
    </PolarisShell>
  );
}
