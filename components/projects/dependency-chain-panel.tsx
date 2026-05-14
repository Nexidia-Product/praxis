"use client";

/**
 * Dependency chain panel (Section 5.10).
 *
 * Read-only display of a project's upstream dependencies, plus a warning
 * banner when one or more upstreams are Blocked / Delayed / On Hold.
 * Mounts inside the quick view's "Dependencies" tab.
 *
 * Walks two layers deep:
 *   - direct dependencies are shown as colored chips (green / amber / red
 *     ring keyed off `dependencyHealth`)
 *   - the full transitive upstream chain is collapsible underneath, capped
 *     at 2 levels in the design doc to keep the UI navigable
 *
 * Editing happens in the project form modal — there's intentionally no
 * inline edit affordance here, matching the rest of the quick view.
 */

import { useMemo, useState } from "react";

import { statusBadgeClass } from "@/lib/projects/display";
import {
  dependencyHealth,
  rollupDependencyHealth,
  upstreamChain,
  type DependencyHealth,
} from "@/lib/projects/dependencies";
import type { Project, ProjectDependency } from "@/lib/db";

interface DependencyChainPanelProps {
  project: Project;
  /** Full project list, for resolving upstream names + statuses. */
  allProjects: Project[];
}

const HEALTH_RING: Record<DependencyHealth, string> = {
  clear: "ring-emerald-300 bg-emerald-50",
  "at-risk": "ring-amber-300 bg-amber-50",
  blocked: "ring-red-300 bg-red-50",
};

const HEALTH_DOT: Record<DependencyHealth, string> = {
  clear: "bg-emerald-500",
  "at-risk": "bg-amber-500",
  blocked: "bg-red-500",
};

const HEALTH_LABEL: Record<DependencyHealth, string> = {
  clear: "Clear",
  "at-risk": "At risk",
  blocked: "Blocked",
};

export function DependencyChainPanel({
  project,
  allProjects,
}: DependencyChainPanelProps) {
  const projectsById = useMemo(
    () => new Map(allProjects.map((p) => [p.project_id, p])),
    [allProjects],
  );

  const [showChain, setShowChain] = useState(false);

  const rollup = rollupDependencyHealth(project, projectsById);
  const transitive = useMemo(
    () => upstreamChain(project, projectsById),
    [project, projectsById],
  );
  // Strip direct deps from the transitive list; the second-level reveal
  // shows only what's *beyond* direct dependencies.
  const directIds = new Set(project.depends_on);
  const indirect = transitive.filter((id) => !directIds.has(id));

  if (project.dependencies.length === 0) {
    return (
      <div className="space-y-3">
        <p className="text-xs italic text-gray-500">
          No upstream dependencies. Add them in the edit form to see status
          rolled up here.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {rollup && rollup !== "clear" ? (
        <div
          role="alert"
          className={`flex items-start gap-2 rounded-md border px-3 py-2 text-xs ${
            rollup === "blocked"
              ? "border-red-300 bg-red-50 text-red-900"
              : "border-amber-300 bg-amber-50 text-amber-900"
          }`}
        >
          <span aria-hidden className="mt-0.5">
            {rollup === "blocked" ? "🛑" : "⚠️"}
          </span>
          <div>
            <p className="font-medium">
              {rollup === "blocked"
                ? "Upstream dependency is blocked."
                : "Upstream dependency is at risk."}
            </p>
            <p className="mt-0.5 text-[11px]">
              Review the upstream projects below before continuing
              downstream work.
            </p>
          </div>
        </div>
      ) : null}

      <div>
        <h4 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
          Direct dependencies ({project.dependencies.length})
        </h4>
        <ul className="mt-2 space-y-1.5">
          {project.dependencies.map((dep) => {
            const upstream = projectsById.get(dep.upstream_id);
            const health = dependencyHealth(dep, upstream);
            return (
              <li
                key={dep.upstream_id}
                className={`flex items-start gap-2 rounded-md border px-2 py-1.5 ring-1 ring-inset ${HEALTH_RING[health]}`}
              >
                <span
                  className={`mt-1 inline-block h-1.5 w-1.5 flex-shrink-0 rounded-full ${HEALTH_DOT[health]}`}
                  title={HEALTH_LABEL[health]}
                />
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="font-mono text-[10px] text-gray-500">
                      {dep.upstream_id}
                    </span>
                    <span className="truncate text-xs font-medium text-gray-900">
                      {upstream?.name ?? "(missing)"}
                    </span>
                    {upstream ? (
                      <span
                        className={`inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(upstream.status)}`}
                      >
                        {upstream.status}
                      </span>
                    ) : null}
                  </div>
                  <p className="mt-0.5 text-[11px] text-gray-600">
                    {describeDependency(dep)}
                  </p>
                </div>
              </li>
            );
          })}
        </ul>
      </div>

      {indirect.length > 0 ? (
        <div>
          <button
            type="button"
            onClick={() => setShowChain((s) => !s)}
            className="text-xs font-medium text-gray-700 underline-offset-2 hover:underline"
          >
            {showChain ? "Hide" : "Show"} indirect upstream chain (
            {indirect.length})
          </button>
          {showChain ? (
            <ul className="mt-2 space-y-1">
              {indirect.map((id) => {
                const upstream = projectsById.get(id);
                return (
                  <li
                    key={id}
                    className="flex items-center gap-2 rounded-md border border-gray-200 bg-white px-2 py-1 text-xs"
                  >
                    <span className="font-mono text-[10px] text-gray-500">
                      {id}
                    </span>
                    <span className="truncate text-gray-900">
                      {upstream?.name ?? "(missing)"}
                    </span>
                    {upstream ? (
                      <span
                        className={`ml-auto inline-flex rounded-md px-1.5 py-0.5 text-[10px] font-medium ${statusBadgeClass(upstream.status)}`}
                      >
                        {upstream.status}
                      </span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function describeDependency(dep: ProjectDependency): string {
  if (dep.type === "Blocks Start") {
    return "Blocks start — upstream must complete before this can begin.";
  }
  return `Blocks phase — upstream must reach "${dep.required_phase ?? "?"}".`;
}
