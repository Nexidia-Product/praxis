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
import { NiceProductRepository } from "@/lib/db";
import { loadCoverageGraph } from "@/lib/coverage/load";
import { resolveCoverageSelection } from "@/lib/coverage/select";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { ProgramCoverageFilter } from "@/components/insights/program-coverage-filter";
import { ProgramCoverageView } from "@/components/insights/program-coverage-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ pillar?: string; useCase?: string; products?: string }>;
}

export default async function ProgramCoveragePage({ searchParams }: PageProps) {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const { pillar, useCase, products } = await searchParams;
  const productFilter = (products ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [graph, niceProducts] = await Promise.all([
    loadCoverageGraph(session, productFilter),
    NiceProductRepository.getAll(),
  ]);
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
      <div className="mb-4">
        <ProgramCoverageFilter
          niceProducts={niceProducts}
          products={productFilter}
          pillar={pillar}
          useCase={useCase}
        />
      </div>
      <ProgramCoverageView
        graph={graph}
        selection={selection}
        products={productFilter}
      />
    </PolarisShell>
  );
}
