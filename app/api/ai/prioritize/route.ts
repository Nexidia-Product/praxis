/**
 * POST /api/ai/prioritize
 *
 * No body — the route pulls the current open-project list itself
 * and asks the model to rank it.
 *
 * Returns: { ranked: RankedProject[], cohort_notes, modelId }
 *
 * Local-only — gated by AI_ENABLED. The "AI Priority Review"
 * button on the Projects page opens a drawer with the response;
 * no field on any project record is auto-updated.
 *
 * Permission: projects.edit — only people who could act on the
 * ranking should be able to ask for it.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { AiDisabledError, isAiEnabled } from "@/lib/ai/feature-flag";
import { recommendPriorities } from "@/lib/ai/prioritize";

export const POST = withAuth(async () => {
  await requirePermission("projects.edit");

  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: new AiDisabledError().message },
      { status: 503 },
    );
  }

  try {
    const result = await recommendPriorities();
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai/prioritize] failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "AI prioritize failed. Check server logs.",
      },
      { status: 502 },
    );
  }
});
