/**
 * Priority recommendation across all open projects (§5.18.2).
 *
 * Input: the full open-project list with the fields the model needs
 * to reason about ordering (name, priority, status, phase, target
 * date, complexity, dependency graph, who's leading). The full
 * Project type is intentionally NOT sent — large payloads burn
 * tokens and the model doesn't need health snapshots, audit
 * history, or document links to decide what to do next.
 *
 * Output: a ranked list. Each entry includes the project_id (so the
 * UI can render the existing project record), a recommended_rank
 * (1 = top of the list, ascending), and a short rationale. The
 * model is told to consider: urgency / target date proximity,
 * dependencies (blocked projects get pushed down), strategic value,
 * and team capacity. Outputs are not auto-applied — they show up as
 * a side-by-side review panel for an admin to act on.
 *
 * The model's output is cached only in-flight (no settings field
 * yet). If we want to persist the most recent run, we'd add a
 * top-level `latest_priority_review` field on settings; deferred
 * until we see if the team uses the feature.
 */

import { ProjectRepository, SettingsRepository } from "@/lib/db";
import type { Project, ProjectId, ProjectStatus } from "@/lib/db";
import { runJsonConverse } from "./converse";

const OPEN_STATUSES: ProjectStatus[] = [
  "Not Started",
  "In Planning",
  "In Progress",
  "Blocked",
  "On Hold",
  "Delayed",
];

export interface RankedProject {
  project_id: ProjectId;
  recommended_rank: number;
  rationale: string;
}

export interface PrioritizeResult {
  ranked: RankedProject[];
  /** Free-form summary the model emits about the cohort as a whole. */
  cohort_notes: string;
  modelId: string;
}

const SYSTEM_PROMPT = `You are advising a small product team on which open projects to prioritize next. Consider:

- Target date proximity and risk of missing it.
- Dependencies: a project blocked by another should drop in rank unless its upstream is itself top-of-list.
- Strategic value: weight Critical and High priority projects higher when other factors are equal.
- Complexity: a Very High complexity project competing with a Low one for the same team capacity should usually wait — call this out if you push it down.

Be candid. If something is blocked, say so. Do not pad rationales.`;

const SCHEMA_HINT = `{
  "ranked": [
    { "project_id": string, "recommended_rank": number, "rationale": string }
  ],
  "cohort_notes": string
}`;

export async function recommendPriorities(): Promise<PrioritizeResult> {
  const settings = await SettingsRepository.get();
  const modelId = settings.ai_config.prioritize_model_id;

  const projects = await ProjectRepository.getAll();
  const open = projects.filter((p) => OPEN_STATUSES.includes(p.status));

  if (open.length === 0) {
    return { ranked: [], cohort_notes: "No open projects.", modelId };
  }

  const user = `Open projects (${open.length} total):

${open.map(projectToBlock).join("\n---\n")}

Return a ranked list of every project_id above, plus a brief cohort_notes.`;

  const { value } = await runJsonConverse<Omit<PrioritizeResult, "modelId">>({
    modelId,
    system: SYSTEM_PROMPT,
    user,
    schemaHint: SCHEMA_HINT,
    // 60 tokens per ranked entry leaves headroom for cohort_notes and
    // gives the model room to write a real sentence per project.
    maxTokens: Math.min(8000, 200 + open.length * 80),
    temperature: 0.3,
  });

  return {
    ranked: normalizeRanked(value.ranked, open),
    cohort_notes: String(value.cohort_notes ?? "").trim(),
    modelId,
  };
}

function projectToBlock(p: Project): string {
  const lines = [
    `project_id: ${p.project_id}`,
    `name: ${p.name}`,
    `priority: ${p.priority}`,
    `status: ${p.status}`,
    `phase: ${p.phase}`,
    `application_product: ${p.application_product || "—"}`,
    `project_lead: ${p.project_lead || "—"}`,
    `target_date: ${p.target_date ?? "—"}`,
    `start_date: ${p.roadmap_timeline_start ?? "—"}`,
    `complexity: ${p.ai_complexity_score ?? "—"}`,
    `time_estimate: ${p.ai_time_estimate ?? "—"}`,
    `depends_on: ${p.depends_on.length > 0 ? p.depends_on.join(", ") : "—"}`,
    `external_dependencies: ${
      p.external_dependencies.length > 0
        ? p.external_dependencies
            .map((d) => `${d.label} (${d.status}${d.target_date ? ` by ${d.target_date}` : ""})`)
            .join("; ")
        : "—"
    }`,
    `description: ${truncate(p.description, 600)}`,
  ];
  return lines.join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function normalizeRanked(
  ranked: RankedProject[] | undefined,
  open: Project[],
): RankedProject[] {
  if (!Array.isArray(ranked)) return [];
  const knownIds = new Set(open.map((p) => p.project_id));
  return ranked
    .filter((r) => r && typeof r.project_id === "string" && knownIds.has(r.project_id))
    .map((r, i) => ({
      project_id: r.project_id,
      recommended_rank:
        typeof r.recommended_rank === "number" && r.recommended_rank > 0
          ? r.recommended_rank
          : i + 1,
      rationale: String(r.rationale ?? "").trim(),
    }))
    .sort((a, b) => a.recommended_rank - b.recommended_rank);
}
