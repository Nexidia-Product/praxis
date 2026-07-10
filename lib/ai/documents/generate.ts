/**
 * Document generation orchestrator (PRFAQ, and future doc types).
 *
 * A "document skill" (lib/db, `document_skills`) is an authored bundle —
 * instructions, an optional shared product profile, a gold-standard
 * example, a section outline, and an input spec that binds Praxis
 * project fields into the prompt. This module resolves a skill's inputs
 * from a project and generates the draft section-by-section through the
 * shared Converse helper.
 *
 * Section-by-section (rather than one large call) buys two things:
 *   - long docs never hit the per-call maxTokens ceiling;
 *   - the outline guarantees coverage — the model can't quietly drop
 *     "Privacy, Ethics & Governance".
 * The first section (the Press Release, for a PRFAQ) is generated first
 * and fed to every later section as an anchor, so the FAQ and Roadmap
 * stay consistent with the headline claims.
 */

import { SettingsRepository } from "@/lib/db";
import type {
  DocumentInputSpec,
  DocumentOutlineSection,
  DocumentSkill,
  GeneratedSection,
  GenerationUsage,
} from "@/lib/db";
import { runConverse } from "../converse";

export interface GeneratedDraft {
  title: string;
  sections: GeneratedSection[];
  /** The stitched full draft in Markdown. */
  markdown: string;
  usage: GenerationUsage;
  model_id: string;
}

// ---- Input resolution ------------------------------------------------------

function getPath(obj: unknown, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, key) => {
    if (acc && typeof acc === "object") {
      return (acc as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/** `2026-05-15` -> `"Q2 2026"`. UTC so the quarter never drifts by timezone. */
export function toQuarter(value: string | Date): string {
  const d = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(d.getTime())) {
    throw new Error(`Invalid date for to_quarter transform: ${String(value)}`);
  }
  const quarter = Math.floor(d.getUTCMonth() / 3) + 1;
  return `Q${quarter} ${d.getUTCFullYear()}`;
}

function applyTransform(
  value: unknown,
  transform: DocumentInputSpec["transform"],
): string {
  if (transform === "to_quarter") return toQuarter(value as string);
  return String(value ?? "").trim();
}

/**
 * Pull each declared input off the generation context and apply its
 * transform. Throws on a missing required field so generation fails
 * loudly rather than emitting a document with a blank dateline.
 */
export function resolveInputs(
  skill: DocumentSkill,
  context: Record<string, unknown>,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, spec] of Object.entries(skill.inputs)) {
    const raw = getPath(context, spec.source);
    if ((raw === undefined || raw === null || raw === "") && spec.required) {
      throw new Error(
        `Required input "${name}" (${spec.source}) is missing. ` +
          "Set it on the project before generating this document.",
      );
    }
    values[name] = applyTransform(raw, spec.transform);
  }
  return values;
}

// ---- Prompt assembly -------------------------------------------------------

function fill(pattern: string, values: Record<string, string>): string {
  return pattern.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? `{${key}}`);
}

function buildSystem(skill: DocumentSkill): string {
  const parts = [skill.instructions];
  if (skill.product_profile) {
    parts.push(`# Product context\n${skill.product_profile}`);
  }
  if (skill.example) {
    parts.push(
      "# Example (structure reference only)\n" +
        "Match the STRUCTURE, tone, and depth of the example below. Do NOT " +
        "reuse its subject matter, metrics, or specifics — those come only " +
        `from the input.\n\n${skill.example}`,
    );
  }
  return parts.join("\n\n");
}

function inputBlock(
  skill: DocumentSkill,
  values: Record<string, string>,
): string {
  return Object.entries(skill.inputs)
    .map(([name, spec]) => `${spec.label}:\n${values[name]}`)
    .join("\n\n");
}

function sectionInstruction(
  section: DocumentOutlineSection,
  values: Record<string, string>,
): string {
  const lines: string[] = [`Write ONLY the "${section.heading}" section.`];
  if (section.guidance) lines.push(fill(section.guidance, values));
  if (section.questions?.length) {
    lines.push(
      "Answer each of these as its own sub-heading, in order:\n" +
        section.questions
          .map((q, i) => `${i + 1}. ${fill(q, values)}`)
          .join("\n"),
    );
  }
  if (section.format === "bullets") {
    lines.push("Format the body as bullet points.");
  }
  lines.push(
    "Output the section body only — no document title, no other sections.",
  );
  return lines.join("\n\n");
}

// ---- Orchestration ---------------------------------------------------------

export async function generateDocument(
  skill: DocumentSkill,
  project: unknown,
): Promise<GeneratedDraft> {
  const values = resolveInputs(skill, { project });

  const settings = await SettingsRepository.get();
  const modelId = skill.model_id ?? settings.ai_config.document_model_id;

  const system = buildSystem(skill);
  const context = inputBlock(skill, values);

  const sections: GeneratedSection[] = [];
  const usage: GenerationUsage = { input_tokens: 0, output_tokens: 0 };
  let anchor = ""; // first section, reused to keep later ones consistent

  for (const section of skill.outline) {
    const user = [
      `# Innovation input\n${context}`,
      anchor
        ? `# Section already written (stay consistent with it)\n${anchor}`
        : "",
      `# Task\n${sectionInstruction(section, values)}`,
    ]
      .filter(Boolean)
      .join("\n\n");

    const res = await runConverse({
      modelId,
      system,
      user,
      maxTokens: 1200,
      temperature: 0.3,
    });

    const markdown = res.text.trim();
    sections.push({ heading: section.heading, style: section.style, markdown });
    if (!anchor) anchor = markdown;
    usage.input_tokens += res.usage.inputTokens ?? 0;
    usage.output_tokens += res.usage.outputTokens ?? 0;
  }

  const title = fill(skill.title_pattern ?? "{feature_name}", values);
  const markdown = stitch(title, sections);
  return { title, sections, markdown, usage, model_id: modelId };
}

function stitch(title: string, sections: GeneratedSection[]): string {
  const body = sections
    .map((s) => {
      const level = s.style === "Heading2" ? "###" : "##";
      return `${level} ${s.heading}\n\n${s.markdown}`;
    })
    .join("\n\n");
  return `# ${title}\n\n${body}\n`;
}
