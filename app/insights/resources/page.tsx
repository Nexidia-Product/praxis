/**
 * Insights → Resources page.
 *
 * Single shell with four tabs: Overview, Capacity, Performance, and
 * Detail. The Capacity tab is the only home for the swim-lane Gantt;
 * a similar view used to sit on the Roadmap page but has been removed
 * in favor of this single canonical home (which adds task density,
 * roster scoping, and per-resource detail).
 *
 * Server component: roster construction is pure data + read, so
 * doing it on the server avoids shipping the whole project + task +
 * user graph to the client. The client only renders.
 *
 * Permission gate: `resources.view` opens the page; the "Everyone"
 * scope toggle is gated by `resources.view_all` inside the client
 * component.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import {
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  UserRepository,
} from "@/lib/db";
import {
  applyScope,
  buildPerformanceSeries,
  buildResourceRoster,
  type ResourceScope,
} from "@/lib/resources/roster";
import { ResourcesWorkspace } from "@/components/resources/workspace";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

interface ResourcesPageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ResourcesPage({
  searchParams,
}: ResourcesPageProps) {
  const session = await requirePermission("resources.view");
  const { permissions } = await getCurrentUserPermissions();
  const params = await searchParams;

  // Tab selection comes from the query string so a Capacity link
  // shared in chat lands on the Capacity tab, not Overview. Default
  // is Overview.
  const tab =
    typeof params.tab === "string" &&
    ["overview", "capacity", "performance"].includes(params.tab)
      ? (params.tab as "overview" | "capacity" | "performance")
      : "overview";

  // Scope: respects the user's permission. Default is "my_team" per
  // the design call; only users with `resources.view_all` can flip
  // to "everyone". A non-permitted user passing scope=everyone via
  // URL gets coerced back to my_team, so URL bookmarking can't
  // bypass the permission.
  const requestedScope =
    typeof params.scope === "string" && params.scope === "everyone"
      ? "everyone"
      : "my_team";
  const scope: ResourceScope =
    requestedScope === "everyone" && permissions["resources.view_all"]
      ? "everyone"
      : "my_team";

  const [projects, tasks, publicUsers, settings] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    UserRepository.getAllPublic(),
    SettingsRepository.get(),
  ]);

  // Build the full roster, then narrow by scope. We deliberately
  // build the full roster every request rather than caching: the
  // computation is small (hundreds of resources × tasks at most)
  // and caching introduces invalidation complexity that isn't yet
  // worth it. If the data grows, the place to add caching is the
  // velocity-cache module — same pattern, same TTL.
  const fullRoster = buildResourceRoster(
    projects,
    tasks,
    publicUsers,
    settings.resource_settings,
  );
  const roster = applyScope(
    fullRoster,
    scope,
    {
      user_id: session.user.user_id,
      // Session may carry a null/undefined name; fall back to "" so
      // the lower-case match never throws. The user_id match is the
      // primary key anyway.
      name: session.user.name ?? "",
    },
    projects,
  );

  // Performance series for the Performance tab. Built once on the
  // server (a few hundred tasks × scoped roster size is cheap)
  // rather than re-fetching per tab switch — same model as the
  // roster itself.
  const perfSeries = buildPerformanceSeries(
    roster,
    tasks,
    settings.resource_settings,
  );

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="resources"
      breadcrumbs={[{ label: "Insights" }, { label: "Resources" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Resources"
        subtitle="Capacity, performance, and gaps across the team. Workload buckets and performance scores tunable from Admin → Resource management → Resource thresholds."
      />
      <ResourcesWorkspace
        initialTab={tab}
        scope={scope}
        canViewAll={permissions["resources.view_all"] === true}
        roster={roster}
        rosterTotal={fullRoster.length}
        thresholds={settings.resource_settings.workload_buckets}
        perfSeries={perfSeries}
        perfThresholds={settings.resource_settings.performance_thresholds}
        perfWindowDays={settings.resource_settings.performance_window_days}
      />
    </PolarisShell>
  );
}
