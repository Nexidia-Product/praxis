/**
 * Admin → Configuration page.
 *
 * Server component that consolidates four previously separate admin
 * pages — Custom Fields, Project Values, Portfolio Quadrants, Health
 * Thresholds — under a single tabbed workspace. The grouping is
 * intentional: every tab here describes how the data model is shaped
 * — what fields exist, what values those fields can take, what the
 * bubble chart's quadrant labels read, and the thresholds that drive
 * project health scoring.
 *
 * Page-level access is granted to anyone with at least one of the
 * four per-tab permissions. The workspace then hides the tabs the
 * current user can't access.
 *
 * Tab selection is read from `?tab=...` so deep links round-trip
 * cleanly (the legacy URLs all redirect here with the correct tab).
 */

import {
  getCurrentUserPermissions,
  requireAnyPagePermission,
} from "@/lib/auth/permissions";
import { SettingsRepository } from "@/lib/db";
import { mergeEnumOptions } from "@/lib/projects/enum-options";
import {
  ConfigurationWorkspace,
  type ConfigurationTab,
} from "@/components/admin/configuration-workspace";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

const VALID_TABS: ReadonlyArray<ConfigurationTab> = [
  "custom-fields",
  "project-values",
  "portfolio-quadrants",
  "health-thresholds",
];

interface PageProps {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}

export default async function ConfigurationPage({ searchParams }: PageProps) {
  const session = await requireAnyPagePermission([
    "admin.custom_fields.manage",
    "admin.project_values.manage",
    "admin.portfolio_quadrants.manage",
    "admin.health_thresholds.manage",
  ]);
  const { permissions } = await getCurrentUserPermissions();
  const params = await searchParams;

  const requestedTab =
    typeof params.tab === "string" &&
    (VALID_TABS as readonly string[]).includes(params.tab)
      ? (params.tab as ConfigurationTab)
      : "custom-fields";

  const settings = await SettingsRepository.get();
  const defaults = SettingsRepository.defaults();

  // Pre-merge each enum option list (with archived) for the Project
  // Values tab — same shape as the prior `/admin/project-values` page.
  const projectValuesOptions = {
    status: mergeEnumOptions("status", settings.enum_extensions.status, true),
    phase: mergeEnumOptions("phase", settings.enum_extensions.phase, true),
    priority: mergeEnumOptions(
      "priority",
      settings.enum_extensions.priority,
      true,
    ),
    application_product: mergeEnumOptions(
      "application_product",
      settings.enum_extensions.application_product,
      true,
    ),
  };

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-configuration"
      breadcrumbs={[{ label: "Admin" }, { label: "Configuration" }]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="Configuration"
        subtitle="Custom fields, project values, portfolio quadrants, and health thresholds. Each tab is gated by its own permission."
      />
      <ConfigurationWorkspace
        initialTab={requestedTab}
        permissions={permissions}
        initialCustomFields={settings.custom_field_definitions}
        projectValuesOptions={projectValuesOptions}
        projectValuesExtensions={settings.enum_extensions}
        initialQuadrantLabels={settings.portfolio_quadrants}
        defaultQuadrantLabels={defaults.portfolio_quadrants}
        initialHealthThresholds={settings.health_score_thresholds}
        defaultHealthThresholds={defaults.health_score_thresholds}
      />
    </PolarisShell>
  );
}
