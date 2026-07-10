/**
 * GET /api/ai/documents?projectId=...
 *
 * Lists the documents generated for a project, newest first.
 *
 * Read-only, so it is gated by projects.view rather than projects.edit
 * — and deliberately NOT by AI_ENABLED: these are stored rows and stay
 * viewable even when AI generation is turned off in the environment.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { GeneratedDocumentRepository } from "@/lib/db";

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

  const documents =
    await GeneratedDocumentRepository.listByProject(projectId);
  return NextResponse.json({ documents });
});
