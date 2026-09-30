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
 *   - The "Tasks" and "Change Log" sections are placeholders, not derived
 *     from real data (see the section builders below for what "static"
 *     and "placeholder" mean for each).
 */

import { subtractBusinessDays } from "./milestones";
import { todayIso } from "@/lib/db/store";
import type { Project, ProjectId } from "@/lib/db";

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

function addBusinessDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() + 1);
    const dow = d.getUTCDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
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

// ---------------------------------------------------------------------------
// Tasks — placeholder section
// ---------------------------------------------------------------------------
//
// Per the template conversation: static, not derived from this project's
// real tasks. This is the template's own worked example verbatim (project
// IDs, task IDs, assignees and all) — a placeholder for the shape a real
// task table should take once project-scoped task numbering exists, not a
// per-project rendering. Every export currently shows the same block.
const STATIC_TASKS_TABLE = `| ID | Stage | Task | Assignee | Due | Status |
|---|---|---|---|---|---|
| 2026-024-T01 | Qualification | Existing Praxis tasks | Manager | Before kickoff | Complete |
| 2026-024-T02 | Prioritization | Set priority, owner, release date, tier and visualization type | Manager | Before kickoff | Complete |
| 2026-024-T03 | Kickoff | Export project, run kickoff, write brief | Project Owner | 2026-09-29 | Not started |
| 2026-024-T04 | Kickoff | Update scope, definition of done and sizing in Praxis | Project Owner | 2026-09-29 | Not started |
| 2026-024-T05 | Analysis and EDA | EDA notes and data coverage | Project Owner | 2026-10-05 | Not started |
| 2026-024-T06 | Analysis and EDA | Draft expected-output CSV, reconciled against a run | Project Owner | 2026-10-05 | Not started |
| 2026-024-T07 | Approach Review | Review packet | Project Owner | 2026-10-06 | Not started |
| 2026-024-T08 | Approach Review | Hold review and record outcome | Approach Reviewer | 2026-10-06 | Not started |
| 2026-024-T09 | Initial Revisions | Revisions and delta note (or not needed) | Project Owner | 2026-10-08 | Not started |
| 2026-024-T10 | Initial Revisions | Async re-check (or not needed) | Approach Reviewer | 2026-10-08 | Not started |
| 2026-024-T11 | Initiate Visualization | Send expected-output CSV and data dictionary | Project Owner | 2026-10-16 | Not started |
| 2026-024-T12 | Initiate Visualization | Walkthrough done, files confirmed enough to start | Dashboard Developer | 2026-10-16 | Not started |
| 2026-024-T13 | Deck Review | Storyline, deck, deck check, email | Project Owner | 2026-10-14 | Not started |
| 2026-024-T14 | Deck Review | Deck feedback | Approach Reviewer | 2026-10-15 | Not started |
| 2026-024-T15 | Manager Review | Review deck, meet if needed | Manager Reviewer | 2026-10-19 | Not started |
| 2026-024-T16 | Signoff | Ship decision, on by default or opt-in | Signoff Approver | 2026-10-21 | Not started |
| 2026-024-T17 | Handoff | Handoff package passes contract checks | Project Owner | 2026-10-23 | Not started |
| 2026-024-T18 | Handoff | Package accepted | Approach Reviewer | 2026-10-23 | Not started |
| 2026-024-T19 | Integration | Integrated, output matches expected CSV | Approach Reviewer | 2026-10-30 | Not started |
| 2026-024-T20 | Integration | Version, changelog, build, deploy | Approach Reviewer | 2026-10-30 | Not started |
| 2026-024-T21 | Final Visualization | Real files in, visualization finished | Dashboard Developer | 2026-11-03 | Not started |
| 2026-024-T22 | Final Visualization | Caveats walkthrough | Project Owner | 2026-11-03 | Not started |
| 2026-024-T23 | Release | Application deployed | Dashboard Developer | 2026-11-06 | Not started |
| 2026-024-T24 | Release | Spot-check and exe version recorded | Approach Reviewer | 2026-11-06 | Not started |
| 2026-024-T25 | Productization | Product write-up and walkthrough | Project Owner | Set by manager | Not started |
| 2026-024-T26 | Productization | Ownership accepted | Product Owner | Set by manager | Not started |`;

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

  // Placeholder sections — see the module doc comment and the constants
  // above for what "static"/"placeholder" mean here.
  lines.push("", "## Tasks", "", STATIC_TASKS_TABLE);
  lines.push(
    "",
    "## Change Log",
    "",
    "_Placeholder — change history (target dates, complexity, visualization type) is not yet tracked._",
  );

  return lines.join("\n");
}
