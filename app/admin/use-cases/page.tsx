/**
 * Admin → Use cases.
 *
 * Define top-level use cases (name, description, primary/secondary objectives) and
 * individually assign projects to them. Gated by `usecases.manage`
 * (Admin-only by default). Separate from /groups (ProjectGroup).
 */

import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import { ProjectRepository, UseCaseRepository } from "@/lib/db";
import { OBJECTIVES, SECONDARY_OBJECTIVE_OPTIONS } from "@/lib/projects/display";
import { UseCasesAdmin } from "@/components/admin/use-cases-admin";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function UseCasesAdminPage() {
  const session = await requirePagePermission("usecases.manage");
  const { permissions } = await getCurrentUserPermissions();

  const [useCases, projects] = await Promise.all([
    UseCaseRepository.getAll(),
    ProjectRepository.getAll(),
  ]);

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-use-cases"
      breadcrumbs={[{ label: "Admin" }, { label: "Use cases" }]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="Use cases"
        subtitle="Top-level use cases tied to organizational objectives. Add projects individually; a project belongs to at most one use case, and its quick view shows it."
      />
      <UseCasesAdmin
        initialUseCases={useCases}
        projects={projects}
        primaryOptions={OBJECTIVES}
        secondaryOptions={SECONDARY_OBJECTIVE_OPTIONS}
      />
    </PolarisShell>
  );
}
