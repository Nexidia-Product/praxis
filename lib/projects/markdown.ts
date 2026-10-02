/**
 * Project → Markdown export (Section 5.1's quick view "Export to Markdown"
 * action).
 *
 * Pure-ish function (one dependency on "today," for the Kickoff clamp
 * described below), no I/O — the quick view calls this, wraps the result
 * in a Blob, and triggers a client-side download, the same pattern
 * `buildMarkdown` + `downloadMarkdown` use in
 * `components/insights/key-findings-view.tsx`.
 *
 * Format follows the template at
 * "2026-024-Mistreatment-Identification_proposed-template.md" (external
 * to this repo). Per that conversation:
 *   - Field labels are kept exactly as the template spells them, since
 *     downstream tooling is expected to look fields up by label.
 *   - Every Overview field shows the project's REAL current value —
 *     Type, Complexity, and Visualization Type are exported as-is even
 *     though the template's own "allowed values" notes describe a
 *     different taxonomy than what's actually in this app today.
 *   - "Project Owner" is `project_lead` under that label (no separate
 *     field exists).
 *   - "Stage" is the real, currently-stored `project.stage` — NOT an
 *     auto-computed "earliest stage with an open task" value. (A future
 *     change will make the stored value itself update automatically;
 *     until then, this export just reads whatever is on the record.)
 *   - The "Auto-calculated milestones" formulas below are a full
 *     replacement scheme, scoped ONLY to this export — they do not
 *     replace `computeProjectMilestones` in `lib/projects/milestones.ts`,
 *     which still drives the project quick view.
 *   - The template's "Tasks" and "Change Log" sections are intentionally
 *     omitted — both would have been placeholders (no real task-per-
 *     project numbering or change tracking exists yet), and product
 *     direction was to drop them rather than ship a static placeholder.
 */

import { addBusinessDays, subtractBusinessDays } from "./milestones";
import type { Project, ProjectId } from "@/lib/db";

/**
 * Current UTC date as `YYYY-MM-DD`. Inlined rather than imported from
 * `lib/db/store.ts`'s `todayIso` — that module pulls in `node:crypto`
 * (for ID generation elsewhere in it), which breaks the client bundle
 * for this file's only caller, the quick view's "Export to Markdown"
 * button. This file must stay client-safe.
 */
function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

function line(label: string, value: string | null | undefined): string {
  return `- **${label}:** ${value && value.trim() ? value : "—"}`;
}

// ---------------------------------------------------------------------------
// Export-only milestone formulas
// ---------------------------------------------------------------------------
//
// Derived entirely from the template conversation's worked example (dates
// reverse-engineered to exact business-day offsets) — see the PR/commit
// this file shipped in for the arithmetic. Every offset here is business
// days (Mon–Fri, no holiday calendar), matching `subtractBusinessDays`'s
// existing convention. Unlike `computeProjectMilestones`, everything is
// derived from `target_date` (Target Application Deployment Date) alone —
// `target_executable_deployment_date` is shown in Overview but isn't an
// input to any of these.

/**
 * "About N weeks kickoff to handoff" per the template's three analysis
 * tiers, converted to business days (1 week = 5 business days). Tier 3's
 * "5-6 weeks" is approximated at its midpoint. `ai_complexity_score`
 * values outside this map (e.g. "Very High", or unset) have no defined
 * duration — Kickoff/Approach Review are omitted for them.
 */
const TIER_DURATION_BUSINESS_DAYS: Record<string, number> = {
  Low: 15, // Tier 1, ~3 weeks
  Medium: 20, // Tier 2, ~4 weeks
  High: 28, // Tier 3, ~5.5 weeks (midpoint of "5-6 weeks")
};

/**
 * "Expected-output CSV to Dashboard Developer" lead time before the
 * Application Deployment date, by Visualization Type (shown in the
 * output under the stage name "Initiate Visualization"). "Data Only" has
 * no such handoff; "New Page" and any value outside this map (e.g. "New
 * Cognigy Build," which doesn't map onto the template's V0–V3 scheme at
 * all) are treated the same as "not yet defined" — omitted.
 */
const VISUALIZATION_CSV_LEAD_BUSINESS_DAYS: Record<string, number> = {
  "Function Update": 8, // ~1.5 weeks
  "New Visualization": 15, // 3 weeks
};

interface ExportMilestones {
  kickoff: string | null;
  approach_review: string | null;
  initiate_visualization: string | null;
  signoff: string | null;
  final_logic_process_handoff: string | null;
  executable_deployed: string | null;
  final_input_files_handoff: string | null;
  application_deployment: string | null;
}

function computeExportMilestones(project: Project): ExportMilestones {
  const targetDate = project.target_date;
  if (!targetDate) {
    return {
      kickoff: null,
      approach_review: null,
      initiate_visualization: null,
      signoff: null,
      final_logic_process_handoff: null,
      executable_deployed: null,
      final_input_files_handoff: null,
      application_deployment: null,
    };
  }

  const finalLogicProcessHandoff = subtractBusinessDays(targetDate, 10);
  const executableDeployed = subtractBusinessDays(targetDate, 5);
  const finalInputFilesHandoff = subtractBusinessDays(targetDate, 3);
  const signoff = subtractBusinessDays(finalLogicProcessHandoff, 2);

  const tierDays = project.ai_complexity_score
    ? TIER_DURATION_BUSINESS_DAYS[project.ai_complexity_score]
    : undefined;
  let kickoff: string | null = null;
  let approachReview: string | null = null;
  if (tierDays !== undefined) {
    const rawKickoff = subtractBusinessDays(finalLogicProcessHandoff, tierDays);
    // A computed kickoff in the past reads as "should have started
    // already," not as a real date to show — clamp to today. Approach
    // Review is computed from the *unclamped* kickoff, matching the
    // template's own worked example (its displayed Kickoff and Approach
    // Review dates are only mutually consistent that way).
    kickoff = rawKickoff < todayIso() ? todayIso() : rawKickoff;
    approachReview = addBusinessDays(rawKickoff, Math.round(tierDays / 3));
  }

  const csvLeadDays = VISUALIZATION_CSV_LEAD_BUSINESS_DAYS[project.visualization_type];
  const initiateVisualization =
    csvLeadDays !== undefined ? subtractBusinessDays(targetDate, csvLeadDays) : null;

  return {
    kickoff,
    approach_review: approachReview,
    initiate_visualization: initiateVisualization,
    signoff,
    final_logic_process_handoff: finalLogicProcessHandoff,
    executable_deployed: executableDeployed,
    final_input_files_handoff: finalInputFilesHandoff,
    application_deployment: targetDate,
  };
}

const MILESTONE_LABELS: Record<keyof ExportMilestones, string> = {
  kickoff: "Kickoff",
  approach_review: "Approach Review",
  initiate_visualization: "Initiate Visualization",
  signoff: "Signoff",
  final_logic_process_handoff: "Final Logic/Process Handoff",
  executable_deployed: "Executable Deployed",
  final_input_files_handoff: "Final Handoff of Input Files",
  application_deployment: "Application Deployment",
};

export function buildProjectMarkdown(
  project: Project,
  allProjects: Project[] = [],
): string {
  const milestones = computeExportMilestones(project);
  const projectsById = new Map<ProjectId, Project>(
    allProjects.map((p) => [p.project_id, p]),
  );

  const lines: string[] = [
    `# ${project.name} (${project.project_id})`,
    "",
    "## Overview",
    "",
    line("Application/Product", project.application_product),
    line("Type", project.project_type),
    line("Track", project.track),
    line("Priority", project.priority),
    line("Complexity (Analysis Tier)", project.ai_complexity_score),
    line("Visualization Type", project.visualization_type),
    line("Stage", project.stage),
    line("Project Owner", project.project_lead),
    line("Target Application Deployment Date", project.target_date),
    line(
      "Target Executable Deployment Date",
      project.target_executable_deployment_date,
    ),
    line("Last Updated", project.updated_at?.slice(0, 10)),
    "",
    "## Auto-calculated milestones",
    "",
    ...(Object.keys(MILESTONE_LABELS) as (keyof ExportMilestones)[]).map((key) =>
      line(MILESTONE_LABELS[key], milestones[key]),
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
        dep.type === "Blocks Stage" && dep.required_stage
          ? `${dep.type} — ${dep.required_stage}`
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
