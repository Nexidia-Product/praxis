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

import type { TaskTemplateItem } from "@/lib/db";
import type { EnumOption } from "@/lib/projects/enum-options";

export interface MarkdownableTemplate {
  template_name: string;
  tracks: string[];
  tasks: TaskTemplateItem[];
}

function line(label: string, value: string | null | undefined): string {
  return `- **${label}:** ${value && value.trim() ? value : "—"}`;
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
      line(
        "Estimate (hours)",
        task.estimate_hours != null ? String(task.estimate_hours) : null,
      ),
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
