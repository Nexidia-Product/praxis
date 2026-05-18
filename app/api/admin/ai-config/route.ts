/**
 * PUT /api/admin/ai-config
 *
 * Body: { estimate_model_id, prioritize_model_id, overlap_model_id }
 *
 * Writes the per-feature model selection to settings.ai_config.
 * Validation here is intentionally light — the dropdown on the
 * admin page is populated from the live model list and the form
 * itself round-trips the previously-saved value, so we just
 * sanity-check shape (three non-empty strings) and store.
 *
 * The model IDs themselves are NOT verified against Bedrock here;
 * a typo'd ID will simply fail at invocation time with a clear
 * Bedrock error, and the admin can fix it and re-save.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { SettingsRepository, type AiConfig } from "@/lib/db";
import { audit } from "@/lib/audit/service";

function validate(body: unknown): AiConfig {
  if (!body || typeof body !== "object") {
    throw new Error("Body must be a JSON object.");
  }
  const o = body as Record<string, unknown>;
  const fields = [
    "estimate_model_id",
    "prioritize_model_id",
    "overlap_model_id",
  ] as const;
  const out: Record<string, string> = {};
  for (const f of fields) {
    const v = o[f];
    if (typeof v !== "string" || v.trim() === "") {
      throw new Error(`${f} must be a non-empty string.`);
    }
    out[f] = v.trim();
  }
  return out as unknown as AiConfig;
}

export const PUT = withAuth(async (request: Request) => {
  const session = await requirePermission("admin.ai.manage");

  let parsed: AiConfig;
  try {
    parsed = validate(await request.json());
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Invalid request body." },
      { status: 400 },
    );
  }

  const before = (await SettingsRepository.get()).ai_config;
  await SettingsRepository.update({ ai_config: parsed });

  await audit({
    actorId: session.user.user_id,
    actorName: session.user.name,
    entityType: "Settings",
    entityId: "ai_config",
    entityLabel: "AI model selection",
    action: "update",
    summary: summarizeAiConfigChange(before, parsed),
  });

  return NextResponse.json({ ok: true, ai_config: parsed });
});

function summarizeAiConfigChange(before: AiConfig, after: AiConfig): string {
  const fields: Array<keyof AiConfig> = [
    "estimate_model_id",
    "prioritize_model_id",
    "overlap_model_id",
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
  }
}
