/**
 * Project key-findings summary API.
 *
 *   GET  /api/insights/findings-summary?projectId=YYYY-NNN
 *        Returns the stored summary for a project (or null). Read-only,
 *        gated by projects.view; NOT gated by AI_ENABLED so a previously
 *        generated summary stays viewable even when AI is off.
 *
 *   POST /api/insights/findings-summary   { projectId }
 *        (Re)generates and persists the summary. Gated by projects.view
 *        (same as the Insights page) and AI_ENABLED.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { ProjectFindingSummaryRepository } from "@/lib/db";
import { AiDisabledError, isAiEnabled } from "@/lib/ai/feature-flag";
import {
  NoFindingsError,
  NotFoundError,
  generateProjectFindingSummary,
} from "@/lib/ai/findings-summary";

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const GET = withAuth(async (request: Request) => {
  await requirePermission("projects.view");

  const url = new URL(request.url);
  const projectId = url.searchParams.get("projectId")?.trim() ?? "";
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId query parameter is required." },
      { status: 400 },
    );
  }

  const summary =
    await ProjectFindingSummaryRepository.getByProject(projectId);
  return NextResponse.json({ summary });
});

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("projects.view");

  if (!isAiEnabled()) {
    return NextResponse.json(
      { error: new AiDisabledError().message },
      { status: 503 },
    );
  }

  let body: { projectId?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  const projectId =
    typeof body.projectId === "string" ? body.projectId.trim() : "";
  if (!projectId) {
    return NextResponse.json(
      { error: "projectId is required." },
      { status: 400 },
    );
  }

  try {
    const summary = await generateProjectFindingSummary(projectId, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ summary });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof NoFindingsError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    console.error("[insights/findings-summary] failed:", err);
    return NextResponse.json(
      {
        error:
          err instanceof Error
            ? err.message
            : "Summary generation failed. Check server logs.",
      },
      { status: 502 },
    );
  }
});
