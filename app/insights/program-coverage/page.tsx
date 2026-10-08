/**
 * Program Coverage (Insights).
 *
 * Server component. A deliberately light, as-of-now view of how the
 * program is being executed: pillar → use case → the projects that support
 * it → their outcomes and whether each is delivered, in progress or not
 * started. The drill-down is URL-driven (`?pillar=…&useCase=…`) so it can
 * be screen-shared, linked and navigated with the browser's back button.
 *
 * Scope matches the Executive view (Innovation, five core pillars); see
 * lib/coverage/graph.ts.
 *
 * Authorization: `projects.view`, scoped to the viewer's programs.
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { loadCoverageGraph } from "@/lib/coverage/load";
import { resolveCoverageSelection } from "@/lib/coverage/select";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { ProgramCoverageView } from "@/components/insights/program-coverage-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ pillar?: string; useCase?: string }>;
}

export default async function ProgramCoveragePage({ searchParams }: PageProps) {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const { pillar, useCase } = await searchParams;

  const graph = await loadCoverageGraph(session);
  const selection = resolveCoverageSelection(graph, pillar, useCase);

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="program-coverage"
      breadcrumbs={[{ label: "Insights" }, { label: "Program coverage" }]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Program coverage"
        subtitle="How the program is being executed: what is delivered, what is in progress, and what is still outstanding — by pillar, use case and outcome."
      />
      <ProgramCoverageView graph={graph} selection={selection} />
    </PolarisShell>
  );
}
