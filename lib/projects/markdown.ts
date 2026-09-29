/**
 * Project → Markdown export (Section 5.1's quick view "Export to Markdown"
 * action).
 *
 * Pure function, no I/O — the quick view calls this, wraps the result in a
 * Blob, and triggers a client-side download, the same pattern
 * `buildMarkdown` + `downloadMarkdown` use in
 * `components/insights/key-findings-view.tsx`. Kept separate from that
 * component (and from `lib/projects/milestones.ts`) so it can be unit
 * tested and reused without pulling in React.
 *
 * Milestones are recomputed here rather than accepted as a parameter —
 * same "never stored, always derived" rule as everywhere else they're
 * used (see `lib/projects/milestones.ts`).
 */

import { computeProjectMilestones, MILESTONE_LABELS } from "./milestones";
import type { Project, ProjectId } from "@/lib/db";

function line(label: string, value: string | null | undefined): string {
  return `- **${label}:** ${value && value.trim() ? value : "—"}`;
}

export function buildProjectMarkdown(
  project: Project,
  allProjects: Project[] = [],
): string {
  const milestones = computeProjectMilestones(
    project.target_date,
    project.target_executable_deployment_date,
  );
  const projectsById = new Map<ProjectId, Project>(
    allProjects.map((p) => [p.project_id, p]),
  );

  const lines: string[] = [
    `# ${project.name} (${project.project_id})`,
    "",
    "## Overview",
    "",
    line("Application/Product", project.application_product),
    line("Track", project.track),
    line("Type", project.project_type),
    line("Priority", project.priority),
    line("Complexity", project.ai_complexity_score),
    line("Target Application Deployment Date", project.target_date),
    line(
      "Target Executable Deployment Date",
      project.target_executable_deployment_date,
    ),
    "",
    "## Auto-calculated milestones",
    "",
    ...(Object.keys(MILESTONE_LABELS) as (keyof typeof MILESTONE_LABELS)[]).map(
      (key) => line(MILESTONE_LABELS[key], milestones[key]),
    ),
    "",
    "## Description",
    "",
    project.description.trim() || "_None recorded._",
    "",
    "## Definition of Done",
    "",
    project.definition_of_done.trim() || "_None recorded._",
    "",
    "## Dependencies",
    "",
  ];

  if (project.dependencies.length === 0) {
    lines.push("_No internal dependencies recorded._");
  } else {
    for (const dep of project.dependencies) {
      const upstream = projectsById.get(dep.upstream_id);
      const upstreamLabel = upstream
        ? `${upstream.name} (${upstream.project_id})`
        : dep.upstream_id;
      const detail =
        dep.type === "Blocks Phase" && dep.required_phase
          ? `${dep.type} — ${dep.required_phase}`
          : dep.type;
      lines.push(`- ${upstreamLabel} — ${detail}`);
    }
  }

  if (project.external_dependencies.length > 0) {
    lines.push("", "### External dependencies", "");
    for (const dep of project.external_dependencies) {
      const parts: string[] = [dep.status];
      if (dep.owner) parts.push(`Owner: ${dep.owner}`);
      if (dep.target_date) parts.push(`Expected ${dep.target_date}`);
      lines.push(`- **${dep.label}** — ${parts.join(" · ")}`);
      if (dep.description.trim()) lines.push(`  ${dep.description.trim()}`);
    }
  }

  lines.push("", "## Outcomes", "");
  if (!project.outcomes || project.outcomes.length === 0) {
    lines.push("_No outcomes recorded._");
  } else {
    for (const outcome of project.outcomes) {
      const tags = [outcome.product, outcome.type].filter(Boolean);
      lines.push(
        `- ${outcome.text}${tags.length ? ` (${tags.join(", ")})` : ""}`,
      );
    }
  }

  return lines.join("\n");
}
