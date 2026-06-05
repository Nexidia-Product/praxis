/**
 * Key Capabilities dashboard (Insights).
 *
 * Server component. Loads the flagged "key capability" projects, rolls up
 * each one's task stats, works out which quarters to show, and hands the
 * lot to the client `KeyCapabilitiesView`.
 *
 * Authorization: viewing needs `projects.view` (broadly granted).
 * Designating projects and assigning quarters is gated separately by
 * `key_capabilities.manage` (Admin) — the client only renders those
 * controls when `canManage` is true, and the API route enforces it.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { ProjectRepository, TaskRepository } from "@/lib/db";
import { todayIso } from "@/lib/db/store";
import {
  computeProjectTaskStats,
  nextQuarters,
  quarterOf,
} from "@/lib/key-capabilities";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import {
  KeyCapabilitiesView,
  type KeyCapabilityCard,
} from "@/components/dashboard/key-capabilities-view";

export const dynamic = "force-dynamic";

/** How many quarters forward from today the dashboard shows by default. */
const QUARTER_WINDOW = 4; // current + next 3

export default async function KeyCapabilitiesPage() {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const canManage = permissions["key_capabilities.manage"] === true;

  const [projects, tasks] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
  ]);

  const today = todayIso();
  const todayDate = new Date(`${today}T00:00:00Z`);
  const currentQuarter = quarterOf(todayDate);

  // Bucket tasks by project once, then roll up per key capability.
  const tasksByProject = new Map<string, typeof tasks>();
  for (const t of tasks) {
    const arr = tasksByProject.get(t.project_id);
    if (arr) arr.push(t);
    else tasksByProject.set(t.project_id, [t]);
  }

  const keyCaps = projects.filter((p) => p.is_key_capability);
  const cards: KeyCapabilityCard[] = keyCaps
    .map((project) => ({
      project,
      stats: computeProjectTaskStats(
        tasksByProject.get(project.project_id) ?? [],
        today,
      ),
    }))
    .sort((a, b) => a.project.name.localeCompare(b.project.name));

  // Quarters to show: a rolling window from today, unioned with any
  // quarter that already has an assignment (so a commitment made for a
  // past or far-future quarter never disappears from view).
  const windowQuarters = nextQuarters(currentQuarter, QUARTER_WINDOW);
  const assignedQuarters = keyCaps
    .map((p) => p.key_capability_quarter)
    .filter((q): q is string => Boolean(q));
  const quarters = Array.from(
    new Set([...windowQuarters, ...assignedQuarters]),
  ).sort();

  // Slim list for the "designate a project" picker: every project not
  // already flagged, sorted by name.
  const unflaggedProjects = projects
    .filter((p) => !p.is_key_capability)
    .map((p) => ({
      project_id: p.project_id,
      name: p.name,
      application_product: p.application_product,
    }))
    .sort((a, b) => a.name.localeCompare(b.name));

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="key-capabilities"
      breadcrumbs={[{ label: "Insights" }, { label: "Key capabilities" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Key capabilities"
        subtitle="The strategic projects we're committing to, grouped by the quarter they're slotted for — at most two per quarter."
      />
      <KeyCapabilitiesView
        cards={cards}
        quarters={quarters}
        currentQuarter={currentQuarter}
        unflaggedProjects={unflaggedProjects}
        canManage={canManage}
      />
    </PolarisShell>
  );
}
