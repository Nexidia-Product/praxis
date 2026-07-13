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

import {
  DecisionRepository,
  IdeaRepository,
  SettingsRepository,
  TaskRepository,
} from "@/lib/db";
import type {
  DecisionLogEntry,
  DocumentInputKind,
  DocumentInputSpec,
  DocumentOutlineSection,
  DocumentSkill,
  GeneratedSection,
  GenerationUsage,
  KeyFindingEntry,
  Project,
  ProjectIdea,
  Task,
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
  if (transform === "list") {
    return Array.isArray(value)
      ? value.filter(Boolean).join(", ")
      : String(value ?? "").trim();
  }
  return String(value ?? "").trim();
}

// ---- Grounding context -----------------------------------------------------

/**
 * The data available to resolve a skill's inputs. `project` is always
 * present; tasks / decisions / idea are loaded lazily, only when the
 * skill declares an input `kind` that needs them.
 */
interface DocumentContext {
  project: Project;
  tasks?: Task[];
  decisions?: DecisionLogEntry[];
  idea?: ProjectIdea | null;
}

async function buildContext(
  skill: DocumentSkill,
  project: Project,
): Promise<DocumentContext> {
  const kinds = new Set(
    Object.values(skill.inputs).map((s) => s.kind ?? "scalar"),
  );
  const ctx: DocumentContext = { project };
  if (kinds.has("tasks") || kinds.has("task_findings")) {
    ctx.tasks = await TaskRepository.getByProjectId(project.project_id);
  }
  if (kinds.has("decisions")) {
    ctx.decisions = await DecisionRepository.getByProjectId(project.project_id);
  }
  if (kinds.has("originating_idea")) {
    // No dedicated by-converted-project query yet; scan (low volume).
    const ideas = await IdeaRepository.getAll();
    ctx.idea =
      ideas.find((i) => i.converted_to_project_id === project.project_id) ??
      null;
  }
  return ctx;
}

/** The most recent key finding on a task, or null. */
function latestFinding(entries: KeyFindingEntry[]): KeyFindingEntry | null {
  if (!entries?.length) return null;
  return entries.reduce((a, b) => (a.created_at >= b.created_at ? a : b));
}

/**
 * Format a non-scalar input kind into a text block. Returns "" when the
 * project has no such data, so the input is dropped from the prompt and
 * its section is instructed to write "To be determined".
 */
function formatKind(kind: DocumentInputKind, ctx: DocumentContext): string {
  switch (kind) {
    case "outcomes":
      return (ctx.project.outcomes ?? [])
        .map((o) => {
          const tags = [o.product, o.type].filter(Boolean).join(" · ");
          return `- ${o.text}${tags ? ` (${tags})` : ""}`;
        })
        .join("\n");
    case "tasks":
      return (ctx.tasks ?? [])
        .map(
          (t) =>
            `- [${t.status}] ${t.task_name}${
              t.detailed_description ? `: ${t.detailed_description}` : ""
            }`,
        )
        .join("\n");
    case "task_findings":
      return (ctx.tasks ?? [])
        .map((t) => ({ t, f: latestFinding(t.key_findings) }))
        .filter((x): x is { t: Task; f: KeyFindingEntry } => x.f !== null)
        .map((x) => `### ${x.t.task_id} — ${x.t.task_name}\n${x.f.html}`)
        .join("\n\n");
    case "decisions":
      return (ctx.decisions ?? [])
        .map(
          (d) =>
            `- (${d.decision_type}) ${d.decision_summary}${
              d.rationale ? ` — Rationale: ${d.rationale}` : ""
            }`,
        )
        .join("\n");
    case "originating_idea": {
      const i = ctx.idea;
      if (!i) return "";
      return [
        `Original idea: ${i.idea_name}`,
        `Problem / description: ${i.description}`,
        `Urgency: ${i.urgency}`,
        i.key_stakeholders ? `Key stakeholders: ${i.key_stakeholders}` : "",
        i.ai_overlap_analysis
          ? `Related work / overlap: ${i.ai_overlap_analysis}`
          : "",
      ]
        .filter(Boolean)
        .join("\n");
    }
    default:
      return "";
  }
}

/**
 * Resolve each declared input to a string. Scalars read a project field
 * (via `source`) and apply their transform; the richer kinds format
 * structured grounding data. Throws on a missing required scalar so
 * generation fails loudly rather than emitting a blank dateline.
 */
export function resolveInputs(
  skill: DocumentSkill,
  ctx: DocumentContext,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const [name, spec] of Object.entries(skill.inputs)) {
    const kind = spec.kind ?? "scalar";
    if (kind === "scalar") {
      const raw = getPath({ project: ctx.project }, spec.source ?? "");
      if ((raw === undefined || raw === null || raw === "") && spec.required) {
        throw new Error(
          `Required input "${name}" (${spec.source}) is missing. ` +
            "Set it on the project before generating this document.",
        );
      }
      values[name] = applyTransform(raw, spec.transform);
    } else {
      values[name] = formatKind(kind, ctx);
    }
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
    .filter(([name]) => values[name]?.trim().length > 0)
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
    "Output the section body only. Do NOT repeat the section heading (it is " +
      "added separately) and do not include the document title or any other " +
      "section.",
  );
  return lines.join("\n\n");
}

/**
 * Drop a leading heading the model echoes despite instructions (e.g. it
 * emits "## Frequently Asked Questions" when the generator already adds
 * that heading). Only removes the first line if it matches the section
 * heading once markdown/bold/colon decoration is stripped.
 */
function stripLeadingHeading(markdown: string, heading: string): string {
  const lines = markdown.split("\n");
  let i = 0;
  while (i < lines.length && lines[i].trim() === "") i++;
  if (i < lines.length) {
    const norm = lines[i]
      .replace(/^#{1,6}\s*/, "")
      .replace(/\*\*/g, "")
      .replace(/:\s*$/, "")
      .trim()
      .toLowerCase();
    if (norm === heading.trim().toLowerCase()) {
      lines.splice(0, i + 1);
      while (lines.length && lines[0].trim() === "") lines.shift();
      return lines.join("\n").trim();
    }
  }
  return markdown.trim();
}

// ---- Orchestration ---------------------------------------------------------

export async function generateDocument(
  skill: DocumentSkill,
  project: unknown,
): Promise<GeneratedDraft> {
  const ctx = await buildContext(skill, project as Project);
  const values = resolveInputs(skill, ctx);

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
      // Kept tight on purpose: a PRFAQ must fit 2-3 pages. The section
      // length caps in the skill guidance do the fine control; this is
      // the backstop that stops any one section from sprawling.
      maxTokens: 550,
      temperature: 0.3,
    });

    const markdown = stripLeadingHeading(res.text.trim(), section.heading);
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
