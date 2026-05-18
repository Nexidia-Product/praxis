/**
 * POST /api/ai/estimate
 *
 * Body: { description: string, projectType: string }
 * Returns: { complexity, time_estimate, rationale }
 *
 * Local-only — gated by AI_ENABLED. Vercel cannot run the SSO
 * refresh dance that Bedrock authentication currently requires.
 *
 * Permission: projects.create OR projects.edit — anyone who can
 * make a project can ask the model to estimate one for them.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { AiDisabledError, isAiEnabled } from "@/lib/ai/feature-flag";
import { estimateComplexity } from "@/lib/ai/estimate";

export const POST = withAuth(async (request: Request) => {
  await requirePermission("projects.create");

  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: new AiDisabledError().message },
      { status: 503 },
    );
  }

  let body: { description?: unknown; projectType?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const description =
    typeof body.description === "string" ? body.description.trim() : "";
  const projectType =
    typeof body.projectType === "string" ? body.projectType.trim() : "";
  if (description.length < 20) {
    return NextResponse.json(
      {
        error:
          "Description must be at least 20 characters before requesting an estimate.",
      },
      { status: 400 },
    );
  }
  if (projectType.length === 0) {
    return NextResponse.json(
      { error: "projectType is required." },
      { status: 400 },
    );
  }

  try {
    const result = await estimateComplexity({ description, projectType });
    return NextResponse.json(result);
  } catch (err) {
    console.error("[ai/estimate] failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "AI estimate failed. Check server logs.",
      },
      { status: 502 },
    );
  }
});
