/**
 * PUT /api/admin/ai-config
 *
 * Body: { estimate_model_id, prioritize_model_id, overlap_model_id,
 *         document_model_id? }
 *
 * Writes the per-feature model selection to settings.ai_config.
 * Validation here is intentionally light — the dropdown on the
 * admin page is populated from the live model list and the form
 * itself round-trips the previously-saved value, so we just
 * sanity-check shape (non-empty strings) and store.
 *
 * The parsed fields are MERGED onto the current ai_config rather than
 * replacing it, so a field the form doesn't send (e.g. an older client
 * that predates document_model_id) keeps its stored value instead of
 * being wiped.
 *
 * The model IDs themselves are NOT verified against Bedrock here;
 * a typo'd ID will simply fail at invocation time with a clear
 * Bedrock error, and the admin can fix it and re-save.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { SettingsRepository, type AiConfig } from "@/lib/db";
import { audit } from "@/lib/audit/service";

const REQUIRED_FIELDS = [
  "estimate_model_id",
  "prioritize_model_id",
  "overlap_model_id",
] as const;

const OPTIONAL_FIELDS = ["document_model_id"] as const;

function validate(body: unknown): Partial<AiConfig> {
  if (!body || typeof body !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const o = body as Record<string, unknown>;
  const out: Partial<AiConfig> = {};
  for (const f of REQUIRED_FIELDS) {
    const v = o[f];
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`${f} must be a non-empty string.`);
    }
    out[f] = v.trim();
  }
  for (const f of OPTIONAL_FIELDS) {
    const v = o[f];
    if (typeof v === "string" && v.trim() !== "") {
      out[f] = v.trim();
    }
  }
  return out;
}

export const PUT = withAuth(async (request: Request) => {
  const session = await requirePermission("admin.ai.manage");

  let parsed: Partial<AiConfig>;
  try {
    parsed = validate(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request body." },
      { status: 400 },
    );
  }

  const before = (await SettingsRepository.get()).ai_config;
  const after: AiConfig = { ...before, ...parsed };
  await SettingsRepository.update({ ai_config: after });

  await audit({
    actorId: session.user.user_id,
    actorName: session.user.name,
    entityType: "Settings",
    entityId: "ai_config",
    entityLabel: "AI model selection",
    action: "update",
    summary: summarizeAiConfigChange(before, after),
  });

  return NextResponse.json({ ok: true, ai_config: after });
});

function summarizeAiConfigChange(before: AiConfig, after: AiConfig): string {
  const fields: Array<keyof AiConfig> = [
    ...REQUIRED_FIELDS,
    ...OPTIONAL_FIELDS,
  ];
  const changed = fields.filter((f) => before[f] !== after[f]);
  if (changed.length === 0) return "AI model selection saved (no changes).";
  return changed
    .map((f) => `${labelFor(f)}: ${before[f]} → ${after[f]}`)
    .join("; ");
}

function labelFor(field: keyof AiConfig): string {
  switch (field) {
    case "estimate_model_id":
      return "Estimate";
    case "prioritize_model_id":
      return "Prioritize";
    case "overlap_model_id":
      return "Overlap";
    case "document_model_id":
      return "Document";
  }
}
