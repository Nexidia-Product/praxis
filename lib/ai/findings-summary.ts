/**
 * Cross-task key-findings summary (Insights → Key findings).
 *
 * Synthesizes the most recent key finding from each of a project's tasks
 * into one overall summary, and persists it (one row per project) so it
 * stays on screen until regenerated. The most-recent-per-task set is the
 * same one the review table shows, so the summary and the table stay in
 * agreement.
 *
 * Findings are already-sanitized HTML; Claude reads HTML (tables
 * included), so they're passed through as-is rather than lossily
 * flattened to text. The summary itself is requested as GitHub-Flavored
 * Markdown, which is what the UI renders and the export writes out.
 */

import {
  ProjectFindingSummaryRepository,
  ProjectRepository,
  SettingsRepository,
  TaskRepository,
  type KeyFindingEntry,
  type ProjectFindingSummary,
  type Task,
  type UserId,
} from "@/lib/db";
import { runConverse } from "./converse";

export class NotFoundError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NotFoundError";
  }
}

export class NoFindingsError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "NoFindingsError";
  }
}

const SYSTEM_PROMPT = `You synthesize the key findings recorded across the tasks of a single project into one clear overall summary for a reader who won't read every task.

Write GitHub-Flavored Markdown. Structure it as:
- a short overall assessment (2-4 sentences);
- "## Key themes" — the patterns that recur across tasks, as bullets;
- "## Notable risks & decisions" — anything flagged as a risk, blocker, or decision, as bullets;
- "## By task" — one short bullet per task that has a material finding, prefixed with its task ID.

Be faithful: summarize only what the findings say. Do not invent metrics, causes, or recommendations that aren't supported by the findings. If the findings are thin, say so briefly rather than padding.`;

function latestFinding(entries: KeyFindingEntry[]): KeyFindingEntry | null {
  if (!entries || entries.length === 0) return null;
  return entries.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

function buildUserPrompt(
  projectName: string,
  rows: Array<{ task: Task; finding: KeyFindingEntry }>,
): string {
  const blocks = rows
    .map(
      ({ task, finding }) =>
        `--- Task ${task.task_id}: ${task.task_name} (status: ${task.status}) ---\n${finding.html}`,
    )
    .join("\n\n");
  return `Project: ${projectName}

Below is the most recent key finding for each task that has one. Summarize the findings across all of them.

${blocks}`;
}

/**
 * Generate and persist the summary for a project. Throws NotFoundError
 * if the project doesn't exist, NoFindingsError if no task has a key
 * finding to summarize.
 */
export async function generateProjectFindingSummary(
  projectId: string,
  ctx: { userId: UserId; userName?: string | null },
): Promise<ProjectFindingSummary> {
  const project = await ProjectRepository.getById(projectId);
  if (!project) throw new NotFoundError(`Project ${projectId} not found.`);

  const tasks = await TaskRepository.getByProjectId(projectId);
  const rows = tasks
    .map((task) => {
      const finding = latestFinding(task.key_findings);
      return finding ? { task, finding } : null;
    })
    .filter((r): r is { task: Task; finding: KeyFindingEntry } => r !== null)
    // Stable task-ID order so the "By task" section reads predictably.
    .sort((a, b) => (a.task.task_id < b.task.task_id ? -1 : 1));

  if (rows.length === 0) {
    throw new NoFindingsError(
      "This project has no task key findings to summarize.",
    );
  }

  const settings = await SettingsRepository.get();
  const modelId = settings.ai_config.document_model_id;

  const result = await runConverse({
    modelId,
    system: SYSTEM_PROMPT,
    user: buildUserPrompt(project.name, rows),
    maxTokens: 2000,
    temperature: 0.3,
  });

  return ProjectFindingSummaryRepository.upsert({
    project_id: projectId,
    summary_md: result.text.trim(),
    model_id: result.modelId,
    source_task_count: tasks.length,
    source_finding_count: rows.length,
    generated_by: ctx.userId === "system" ? null : ctx.userId,
    generated_by_name: ctx.userName ?? null,
  });
}
