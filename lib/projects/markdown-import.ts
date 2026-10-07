/**
 * Markdown → Project import (the inverse of `buildProjectMarkdown` in
 * `./markdown.ts`, for the use-case scoping skill's round trip).
 *
 * Pure and client-safe — no I/O, no `node:*` imports. The import dialog
 * calls `parseProjectMarkdown` then `planImport` to build a preview, and
 * sends `plan.payload` through the existing `PATCH /api/projects/[id]`
 * (so permissions, validation and history all stay in `updateProject`).
 *
 * Scope is deliberately narrow — only the five fields the skill owns:
 *   - Description, Definition of Done, Supports, Benefits: fully REPLACED.
 *   - Outcomes: existing outcomes are always preserved untouched; only
 *     outcomes in the file that aren't already present are appended. A
 *     slightly reworded outcome therefore comes in as a new one (resolved
 *     manually, by design).
 *
 * Everything else in the file (Overview, milestones, Dependencies) is
 * ignored. A section missing from the file leaves its field untouched; a
 * section present but empty clears it (surfaced as a warning).
 */

import type { Project, ProjectOutcome } from "@/lib/db";

/** Section headings recognised as boundaries — must match the exporter. */
const KNOWN_HEADINGS = new Set([
  "Overview",
  "Auto-calculated milestones",
  "Description",
  "Definition of Done",
  "Supports",
  "Benefits",
  "Dependencies",
  "Outcomes",
]);

/** Placeholders the exporter writes for an empty section. */
const EMPTY_PLACEHOLDERS = new Set(["_None recorded._", "_No outcomes recorded._"]);

export const REPLACED_FIELDS = [
  { key: "description", heading: "Description", label: "Description" },
  { key: "definition_of_done", heading: "Definition of Done", label: "Definition of Done" },
  { key: "supports", heading: "Supports", label: "Supports" },
  { key: "benefits", heading: "Benefits", label: "Benefits" },
] as const;

export type ReplacedFieldKey = (typeof REPLACED_FIELDS)[number]["key"];

export interface OutcomeVocabulary {
  products: string[];
  types: string[];
}

export interface ParsedOutcome {
  text: string;
  product: string | null;
  type: string | null;
}

export interface ParsedProjectMd {
  /** From the `# Name (YYYY-NNN)` title line; null if not found. */
  projectId: string | null;
  /** Per field: `null` = section absent (leave alone), `""` = present but empty (clear). */
  fields: Record<ReplacedFieldKey, string | null>;
  /** `null` = no Outcomes section. */
  outcomes: ParsedOutcome[] | null;
  warnings: string[];
}

function normalizeSection(body: string): string {
  const trimmed = body.trim();
  return EMPTY_PLACEHOLDERS.has(trimmed) ? "" : trimmed;
}

/** Case/whitespace/trailing-period-insensitive key for outcome de-duplication. */
export function outcomeKey(text: string): string {
  return text.trim().replace(/\s+/g, " ").replace(/[.\s]+$/, "").toLowerCase();
}

function matchVocab(token: string, list: string[]): string | null {
  const t = token.trim().toLowerCase();
  return list.find((v) => v.toLowerCase() === t) ?? null;
}

/**
 * Parse one outcome bullet body (`text` or `text (product, type)`).
 *
 * A trailing parenthetical is treated as tags only if at least one of its
 * comma-separated tokens is a known product/type — otherwise it's part of
 * the text (e.g. "reduce AHT (average handle time)"). Tokens that don't
 * match the vocabulary are dropped with a warning, since the PATCH
 * validator would otherwise reject the whole import.
 */
function parseOutcome(raw: string, vocab: OutcomeVocabulary, warnings: string[]): ParsedOutcome {
  const m = /^(.*\S)\s+\(([^()]*)\)\s*$/.exec(raw);
  if (!m) return { text: raw, product: null, type: null };

  const tokens = m[2].split(",").map((t) => t.trim()).filter(Boolean);
  let product: string | null = null;
  let type: string | null = null;
  const unknown: string[] = [];
  for (const token of tokens) {
    const asProduct = matchVocab(token, vocab.products);
    const asType = matchVocab(token, vocab.types);
    if (asProduct && !product) product = asProduct;
    else if (asType && !type) type = asType;
    else unknown.push(token);
  }

  if (!product && !type) return { text: raw, product: null, type: null };

  for (const token of unknown) {
    warnings.push(
      `Outcome "${m[1]}": tag "${token}" isn't in the Outcomes vocabulary and was dropped (add it under Admin → Configuration → Outcomes to keep it).`,
    );
  }
  return { text: m[1].trim(), product, type };
}

function parseOutcomes(body: string, vocab: OutcomeVocabulary, warnings: string[]): ParsedOutcome[] {
  const bullets: string[] = [];
  for (const rawLine of body.split("\n")) {
    if (!rawLine.trim()) continue;
    const bullet = /^[-*]\s+(.*)$/.exec(rawLine);
    if (bullet) {
      bullets.push(bullet[1].trim());
    } else if (/^\s+\S/.test(rawLine) && bullets.length > 0) {
      bullets[bullets.length - 1] += ` ${rawLine.trim()}`;
    } else {
      warnings.push(`Ignored a line in Outcomes that isn't a bullet: "${rawLine.trim()}"`);
    }
  }
  return bullets
    .filter((b) => b.length > 0 && !EMPTY_PLACEHOLDERS.has(b))
    .map((b) => parseOutcome(b, vocab, warnings));
}

export function parseProjectMarkdown(md: string, vocab: OutcomeVocabulary): ParsedProjectMd {
  const lines = md.replace(/^﻿/, "").replace(/\r\n?/g, "\n").split("\n");
  const warnings: string[] = [];

  let projectId: string | null = null;
  const titleLine = lines.find((l) => /^#\s+\S/.test(l));
  if (titleLine) {
    const m = /\(([^()]+)\)\s*$/.exec(titleLine);
    if (m) projectId = m[1].trim();
  }

  // Split into sections. Only known headings are boundaries, so a `## `
  // line inside free-text content doesn't truncate it.
  const sections = new Map<string, string[]>();
  let current: string | null = null;
  for (const l of lines) {
    const h = /^##\s+(.+?)\s*$/.exec(l);
    if (h && KNOWN_HEADINGS.has(h[1])) {
      current = h[1];
      if (sections.has(current)) {
        warnings.push(`Duplicate "${current}" section; using the first.`);
        current = null; // swallow the duplicate's content
      } else {
        sections.set(current, []);
      }
      continue;
    }
    if (current) sections.get(current)!.push(l);
  }

  const fields = {} as Record<ReplacedFieldKey, string | null>;
  for (const f of REPLACED_FIELDS) {
    const body = sections.get(f.heading);
    fields[f.key] = body === undefined ? null : normalizeSection(body.join("\n"));
  }

  const outcomesBody = sections.get("Outcomes");
  const outcomes =
    outcomesBody === undefined
      ? null
      : normalizeSection(outcomesBody.join("\n")) === ""
        ? []
        : parseOutcomes(outcomesBody.join("\n"), vocab, warnings);

  return { projectId, fields, outcomes, warnings };
}

// ---------------------------------------------------------------------------
// Merge plan
// ---------------------------------------------------------------------------

export interface FieldChange {
  key: ReplacedFieldKey;
  label: string;
  before: string;
  /** `null` when the section wasn't in the file. */
  after: string | null;
  /** True when the file would change the stored value. */
  changed: boolean;
  /** True when applying would blank a field that currently has content. */
  clears: boolean;
}

export interface ImportPlan {
  /** Blocking problems (wrong/missing project ID). Empty = safe to apply. */
  errors: string[];
  warnings: string[];
  fields: FieldChange[];
  outcomes: {
    /** Existing outcomes — always kept as-is. */
    kept: ProjectOutcome[];
    /** New outcomes from the file (no id yet; the server stamps one). */
    added: ParsedOutcome[];
    /** File outcomes already present (matched by text), shown for transparency. */
    duplicates: string[];
  };
  /** True if applying would change anything. */
  hasChanges: boolean;
}

export function planImport(project: Project, parsed: ParsedProjectMd): ImportPlan {
  const errors: string[] = [];
  if (!parsed.projectId) {
    errors.push("No project ID found in the title line (expected \"# Name (YYYY-NNN)\").");
  } else if (parsed.projectId !== project.project_id) {
    errors.push(
      `This file is for project ${parsed.projectId}, but you're importing into ${project.project_id}.`,
    );
  }

  const warnings = [...parsed.warnings];

  const fields: FieldChange[] = REPLACED_FIELDS.map((f) => {
    const before = (project[f.key] ?? "").trim();
    const after = parsed.fields[f.key];
    const changed = after !== null && after.trim() !== before;
    const clears = changed && after!.trim() === "" && before !== "";
    if (clears) {
      warnings.push(`"${f.label}" is empty in the file and will be cleared.`);
    }
    return { key: f.key, label: f.label, before, after, changed, clears };
  });

  const existing = project.outcomes ?? [];
  const seen = new Set(existing.map((o) => outcomeKey(o.text)));
  const added: ParsedOutcome[] = [];
  const duplicates: string[] = [];
  for (const o of parsed.outcomes ?? []) {
    const key = outcomeKey(o.text);
    if (!key) continue;
    if (seen.has(key)) {
      duplicates.push(o.text);
    } else {
      seen.add(key);
      added.push(o);
    }
  }

  return {
    errors,
    warnings,
    fields,
    outcomes: { kept: existing, added, duplicates },
    hasChanges: fields.some((f) => f.changed) || added.length > 0,
  };
}

/**
 * Build the PATCH body from a plan. `acceptedFields` lets the dialog skip
 * individual fields; outcomes are included whenever there's something to add.
 * Existing outcomes are resent with their ids so `shapeOutcomes` preserves
 * them; new ones omit `id` and get one stamped server-side.
 */
export function buildImportPayload(
  plan: ImportPlan,
  acceptedFields: ReadonlySet<ReplacedFieldKey>,
  includeOutcomes: boolean,
): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  for (const f of plan.fields) {
    if (f.changed && f.after !== null && acceptedFields.has(f.key)) {
      payload[f.key] = f.after;
    }
  }
  if (includeOutcomes && plan.outcomes.added.length > 0) {
    payload.outcomes = [
      ...plan.outcomes.kept.map((o) => ({
        id: o.id,
        text: o.text,
        product: o.product,
        type: o.type,
      })),
      ...plan.outcomes.added.map((o) => ({
        text: o.text,
        product: o.product,
        type: o.type,
      })),
    ];
  }
  return payload;
}
