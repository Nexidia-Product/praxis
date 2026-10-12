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
import { formatQuarter } from "@/lib/key-capabilities";
import {
  buildExecutiveView,
  quarterOfDate,
  scopeOptions,
  upcomingReleases,
} from "@/lib/executive/portfolio";
import { NiceProductRepository } from "@/lib/db";
import { loadExecutiveData } from "@/lib/executive/load";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";
import { ExecutiveView } from "@/components/insights/executive-view";

export const dynamic = "force-dynamic";

interface PageProps {
  searchParams: Promise<{ scope?: string; products?: string }>;
}

export default async function ExecutivePage({ searchParams }: PageProps) {
  const session = await requirePermission("projects.view");
  const { permissions } = await getCurrentUserPermissions();
  const { scope: requestedScope, products } = await searchParams;
  const productFilter = (products ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const [{ today, entries, noPillarCount }, niceProducts] = await Promise.all([
    loadExecutiveData(session, productFilter),
    NiceProductRepository.getAll(),
  ]);

  const options = scopeOptions(entries, today, formatQuarter);
  const scope =
    requestedScope && options.some((o) => o.value === requestedScope)
      ? requestedScope
      : quarterOfDate(today);

  const view = buildExecutiveView({ entries, scope, today });
  const upcoming = upcomingReleases(entries, today);

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
        niceProducts={niceProducts}
        productFilter={productFilter}
        canExport={permissions["roadmap.export"] === true}
      />
    </PolarisShell>
  );
}
