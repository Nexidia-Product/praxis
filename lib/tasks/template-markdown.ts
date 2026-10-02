/**
 * Task template → Markdown export (Section 5.19's Task Templates editor
 * "Download Markdown" action).
 *
 * Pure function, no I/O — the templates admin screen calls this, wraps
 * the result in a Blob, and triggers a client-side download, the same
 * pattern `buildProjectMarkdown` (`lib/projects/markdown.ts`) uses for
 * the project quick view's export.
 *
 * Accepts the editor's draft shape rather than a saved `TaskTemplate` so
 * an admin can preview the Markdown for an unsaved draft too — only the
 * fields actually rendered are required.
 */

import type { Priority, TemplateDependency } from "@/lib/db";
import type { EnumOption } from "@/lib/projects/enum-options";

/**
 * Mirrors the fields of `TaskTemplateItem` this export actually renders.
 * Declared locally (not imported) so an unsaved editor draft — whose
 * `estimate_hours` is nullable while the admin is still typing, unlike
 * the saved record's required field — can be passed straight through.
 */
export interface MarkdownableTemplateTask {
  local_id: string;
  name: string;
  description: string;
  default_priority: Priority;
  stage: string;
  default_responsible: string | null;
  estimate_hours: number | null;
  complexity_estimate_hours?: Partial<Record<"Low" | "High", number>> | null;
  dependencies: TemplateDependency[];
}

export interface MarkdownableTemplate {
  template_name: string;
  tracks: string[];
  tasks: MarkdownableTemplateTask[];
}

function line(label: string, value: string | null | undefined): string {
  return `- **${label}:** ${value && value.trim() ? value : "—"}`;
}

/**
 * "72 (Low: 32, High: 152)" when per-complexity overrides are set —
 * `estimate_hours` is always the Medium-complexity value (see
 * `TaskTemplateItem.complexity_estimate_hours`).
 */
function formatEstimate(task: MarkdownableTemplateTask): string | null {
  if (task.estimate_hours == null) return null;
  const overrides = task.complexity_estimate_hours;
  const parts: string[] = [];
  if (overrides?.Low != null) parts.push(`Low: ${overrides.Low}`);
  if (overrides?.High != null) parts.push(`High: ${overrides.High}`);
  const suffix = parts.length > 0 ? ` (${parts.join(", ")})` : "";
  return `${task.estimate_hours}${suffix}`;
}

export function buildTemplateMarkdown(
  template: MarkdownableTemplate,
  trackOptions: EnumOption[],
): string {
  const trackLabel = (id: string) =>
    trackOptions.find((t) => t.id === id)?.label ?? id;
  const taskByLocalId = new Map(
    template.tasks.map((t) => [t.local_id, t] as const),
  );

  const lines: string[] = [
    `# ${template.template_name.trim() || "Untitled template"}`,
    "",
    "## Overview",
    "",
    line("Tracks", template.tracks.map(trackLabel).join(", ")),
    line("Task count", String(template.tasks.length)),
    "",
    "## Tasks",
  ];

  template.tasks.forEach((task, i) => {
    lines.push(
      "",
      `### ${i + 1}. ${task.name.trim() || "(untitled task)"}`,
      "",
      line("Stage", task.stage),
      line("Default priority", task.default_priority),
      line(
        "Default responsible",
        task.default_responsible?.trim()
          ? task.default_responsible
          : "— (defaults to project lead) —",
      ),
      line("Estimate (hours)", formatEstimate(task)),
      "",
      task.description.trim() || "_No description._",
    );

    if (task.dependencies.length > 0) {
      lines.push("", "**Dependencies:**", "");
      for (const dep of task.dependencies) {
        const predecessor = taskByLocalId.get(dep.predecessor_local_id);
        const predecessorLabel =
          predecessor?.name.trim() || "(unknown task)";
        lines.push(`- ${dep.type} — ${predecessorLabel}`);
      }
    }
  });

  return lines.join("\n");
}
