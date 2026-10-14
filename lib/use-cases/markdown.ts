/**
 * Markdown export of the Use Cases page.
 *
 * Pure builder (no I/O) so it can be smoke-tested and reused: takes the use
 * cases plus the projects / NiCE products they reference and renders one
 * section per use case — description, objectives, aligned products,
 * outcomes, and a table of member projects.
 */

import type { NiceProduct, Project, UseCase } from "@/lib/db";

/** Collapse whitespace so a value can't break out of a table cell. */
function cell(value: string | null | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").replace(/\|/g, "\|").trim() || "—";
}

export function buildUseCasesMarkdown(
  useCases: UseCase[],
  projects: Project[],
  niceProducts: NiceProduct[],
  generatedOn: string,
): string {
  const projectsById = new Map(projects.map((p) => [p.project_id, p]));
  const productNames = new Map(niceProducts.map((p) => [p.product_id, p.name]));
  const sorted = [...useCases].sort((a, b) =>
    a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
  );

  const out: string[] = [
    "# Use Cases",
    "",
    `Exported ${generatedOn} · ${sorted.length} use case${sorted.length === 1 ? "" : "s"}`,
    "",
  ];

  for (const uc of sorted) {
    out.push(`## ${uc.name}`, "");
    if (uc.description.trim()) out.push(uc.description.trim(), "");

    out.push(`- **Primary objective:** ${uc.primary_objective || "—"}`);
    out.push(
      `- **Secondary objectives:** ${uc.secondary_objectives.join(", ") || "—"}`,
    );
    out.push(
      `- **NiCE products:** ${
        uc.nice_product_ids
          .map((id) => productNames.get(id) ?? id)
          .join(", ") || "—"
      }`,
    );
    out.push("");

    out.push("### Outcomes", "");
    if (uc.outcomes.length === 0) out.push("_None defined._");
    else for (const o of uc.outcomes) out.push(`- ${o.text}`);
    out.push("");

    out.push(`### Projects (${uc.member_project_ids.length})`, "");
    if (uc.member_project_ids.length === 0) {
      out.push("_No projects assigned._", "");
      continue;
    }
    out.push(
      "| ID | Project | Status | Stage | Lead |",
      "| --- | --- | --- | --- | --- |",
    );
    for (const id of uc.member_project_ids) {
      const p = projectsById.get(id);
      out.push(
        p
          ? `| ${p.project_id} | ${cell(p.name)} | ${cell(p.status)} | ${cell(p.stage)} | ${cell(p.project_lead)} |`
          : `| ${id} | _(project not found)_ | — | — | — |`,
      );
    }
    out.push("");
  }

  return out.join("\n");
}
