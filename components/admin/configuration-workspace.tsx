"use client";

/**
 * Admin → Configuration workspace.
 *
 * Four tabs grouped because they all describe **how the app's data
 * model is shaped** — what fields exist, what values those fields
 * can take, what the bubble chart's quadrant labels read, and the
 * thresholds that drive project health scoring.
 *
 *   - Custom fields — admin-defined fields rendered on every project.
 *   - Project values — Status / Phase / Priority / Application enum
 *     extensions.
 *   - Portfolio quadrants — the four bubble-chart quadrant labels.
 *   - Health thresholds — Red / Yellow / Green scoring rules.
 *
 * Tab visibility is gated by per-tab admin permissions. Mirrors the
 * Resource Management workspace pattern.
 */

import { useMemo } from "react";
import { useRouter, useSearchParams } from "next/navigation";

import { CustomFieldsAdmin } from "@/components/admin/custom-fields-admin";
import { ProjectValuesEditor } from "@/components/admin/project-values-editor";
import { PortfolioQuadrantsAdmin } from "@/components/admin/portfolio-quadrants-admin";
import { HealthThresholdsAdmin } from "@/components/admin/health-thresholds-admin";

import type {
  CustomFieldDefinition,
  EnumExtensionsMap,
  ExtensibleEnumKey,
  HealthScoreThresholds,
  PortfolioQuadrantLabels,
} from "@/lib/db";
import type { EnumOption } from "@/lib/projects/enum-options";

export type ConfigurationTab =
  | "custom-fields"
  | "project-values"
  | "portfolio-quadrants"
  | "health-thresholds";

export const CONFIGURATION_TABS: ReadonlyArray<{
  id: ConfigurationTab;
  label: string;
  permission: string;
}> = [
  {
    id: "custom-fields",
    label: "Custom fields",
    permission: "admin.custom_fields.manage",
  },
  {
    id: "project-values",
    label: "Project values",
    permission: "admin.project_values.manage",
  },
  {
    id: "portfolio-quadrants",
    label: "Portfolio quadrants",
    permission: "admin.portfolio_quadrants.manage",
  },
  {
    id: "health-thresholds",
    label: "Health thresholds",
    permission: "admin.health_thresholds.manage",
  },
];

interface ConfigurationWorkspaceProps {
  initialTab: ConfigurationTab;
  permissions: Record<string, boolean>;

  // Custom fields tab
  initialCustomFields: CustomFieldDefinition[];

  // Project values tab
  projectValuesOptions: Record<ExtensibleEnumKey, EnumOption[]>;
  projectValuesExtensions: EnumExtensionsMap;

  // Portfolio quadrants tab
  initialQuadrantLabels: PortfolioQuadrantLabels;
  defaultQuadrantLabels: PortfolioQuadrantLabels;

  // Health thresholds tab
  initialHealthThresholds: HealthScoreThresholds;
  defaultHealthThresholds: HealthScoreThresholds;
}

export function ConfigurationWorkspace({
  initialTab,
  permissions,
  initialCustomFields,
  projectValuesOptions,
  projectValuesExtensions,
  initialQuadrantLabels,
  defaultQuadrantLabels,
  initialHealthThresholds,
  defaultHealthThresholds,
}: ConfigurationWorkspaceProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  const visibleTabs = useMemo(
    () => CONFIGURATION_TABS.filter((t) => permissions[t.permission] === true),
    [permissions],
  );

  const activeTab: ConfigurationTab =
    visibleTabs.find((t) => t.id === initialTab)?.id ??
    visibleTabs[0]?.id ??
    "custom-fields";

  function setTab(next: ConfigurationTab): void {
    const params = new URLSearchParams(searchParams?.toString() ?? "");
    params.set("tab", next);
    router.replace(`/admin/configuration?${params.toString()}`);
  }

  return (
    <div className="space-y-3">
      <TabStrip current={activeTab} tabs={visibleTabs} onChange={setTab} />

      {activeTab === "custom-fields" ? (
        <CustomFieldsAdmin initialDefinitions={initialCustomFields} />
      ) : null}

      {activeTab === "project-values" ? (
        <ProjectValuesEditor
          initialOptions={projectValuesOptions}
          initialExtensions={projectValuesExtensions}
        />
      ) : null}

      {activeTab === "portfolio-quadrants" ? (
        <PortfolioQuadrantsAdmin
          initialLabels={initialQuadrantLabels}
          defaults={defaultQuadrantLabels}
        />
      ) : null}

      {activeTab === "health-thresholds" ? (
        <HealthThresholdsAdmin
          initialThresholds={initialHealthThresholds}
          defaults={defaultHealthThresholds}
        />
      ) : null}
    </div>
  );
}

function TabStrip({
  current,
  tabs,
  onChange,
}: {
  current: ConfigurationTab;
  tabs: ReadonlyArray<{ id: ConfigurationTab; label: string }>;
  onChange: (next: ConfigurationTab) => void;
}) {
  return (
    <nav
      role="tablist"
      aria-label="Configuration"
      className="flex border-b border-gray-200"
    >
      {tabs.map((t) => {
        const active = current === t.id;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={
              active
                ? "-mb-px border-b-2 border-gray-900 px-4 py-2 text-sm font-semibold text-gray-900"
                : "-mb-px border-b-2 border-transparent px-4 py-2 text-sm font-medium text-gray-500 hover:text-gray-900"
            }
          >
            {t.label}
          </button>
        );
      })}
    </nav>
  );
}
