/**
 * Idea overlap analysis (§5.18.3).
 *
 * Input: one submitted idea + the corpus of existing projects and
 * pending ideas. The model reads the idea description and looks for
 * meaningful overlap with anything already in flight or queued —
 * not surface keyword overlap, but the kind of "didn't we already
 * approve something like this?" check a Project Lead would do
 * manually.
 *
 * Output: a short analysis string surfaced inline on the Idea
 * Review page, plus an `overlaps_with` array of project IDs / idea
 * IDs the model called out. The string is what gets cached on
 * idea.ai_overlap_analysis; the structured matches are returned
 * to the caller in case we want to render them as clickable chips
 * in the UI later.
 *
 * Cached on the idea record (idea.ai_overlap_analysis) so reopening
 * the idea detail page doesn't re-run; an admin "Re-check" button
 * forces a fresh call.
 */

import {
  IdeaRepository,
  ProjectRepository,
  SettingsRepository,
} from "@/lib/db";
import type { Project, ProjectIdea } from "@/lib/db";
import { runJsonConverse } from "./converse";

export interface OverlapResult {
  summary: string;
  overlaps_with: Array<{
    type: "Project" | "Idea";
    id: string;
    label: string;
    reason: string;
  }>;
  modelId: string;
}

const SYSTEM_PROMPT = `You help a small product team decide whether a newly-submitted idea is redundant with work the team already has on its plate. You compare one idea against the existing project repository and pending idea queue.

Be calibrated. Flag genuine overlap (same goal, same audience, same problem space) — not surface keyword matches. If nothing meaningfully overlaps, say so clearly so the reviewer can promote the idea without hedging.`;

const SCHEMA_HINT = `{
  "summary": string,
  "overlaps_with": [
    { "type": "Project" | "Idea", "id": string, "label": string, "reason": string }
  ]
}`;

export async function analyzeOverlap(ideaId: string): Promise<OverlapResult> {
  const settings = await SettingsRepository.get();
  const modelId = settings.ai_config.overlap_model_id;

  const idea = await IdeaRepository.getById(ideaId);
  if (!idea) {
    throw new Error(`Idea not found: ${ideaId}`);
  }

  const [allProjects, allIdeas] = await Promise.all([
    ProjectRepository.getAll(),
    IdeaRepository.getAll(),
  ]);
  // Exclude the idea under review from the corpus.
  const otherIdeas = allIdeas.filter(
    (i) => i.idea_id !== idea.idea_id && i.status !== "Rejected",
  );

  const user = `New idea:
name: ${idea.idea_name}
submitter: ${idea.submitter_name}
urgency: ${idea.urgency}
description: ${idea.description.trim()}

Existing projects (${allProjects.length}):
${allProjects.map(projectBlock).join("\n---\n")}

Pending / approved ideas (${otherIdeas.length}):
${otherIdeas.map(ideaBlock).join("\n---\n")}

Analyze whether the new idea meaningfully overlaps with anything above. List each genuine overlap with its id and a one-sentence reason. If there is no meaningful overlap, return an empty overlaps_with array and a summary that says so.`;

  const { value } = await runJsonConverse<Omit<OverlapResult, "modelId">>({
    modelId,
    system: SYSTEM_PROMPT,
    user,
    schemaHint: SCHEMA_HINT,
    maxTokens: 1500,
    temperature: 0.2,
  });

  return {
    summary: String(value.summary ?? "").trim(),
    overlaps_with: normalizeOverlaps(value.overlaps_with),
    modelId,
  };
}

function projectBlock(p: Project): string {
  return [
    `id: ${p.project_id}`,
    `name: ${p.name}`,
    `status: ${p.status}`,
    `application_product: ${p.application_product || "—"}`,
    `description: ${truncate(p.description, 400)}`,
  ].join("\n");
}

function ideaBlock(i: ProjectIdea): string {
  return [
    `id: ${i.idea_id}`,
    `name: ${i.idea_name}`,
    `status: ${i.status}`,
    `description: ${truncate(i.description, 400)}`,
  ].join("\n");
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max - 1) + "…";
}

function normalizeOverlaps(
  raw: OverlapResult["overlaps_with"] | undefined,
): OverlapResult["overlaps_with"] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(
      (r): r is OverlapResult["overlaps_with"][number] =>
        r != null &&
        typeof r === "object" &&
        (r.type === "Project" || r.type === "Idea") &&
        typeof r.id === "string",
    )
    .map((r) => ({
      type: r.type,
      id: r.id,
      label: String(r.label ?? "").trim() || r.id,
      reason: String(r.reason ?? "").trim(),
    }));
}
