/**
 * POST /api/ai/documents/[id]/approve
 *
 * Marks this generated document as the accepted version (status
 * "approved") and deletes every other document for the same project, so
 * only the approved one remains. Permission: projects.edit.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { GeneratedDocumentRepository } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const POST = withAuth(async (_request: Request, ctx: RouteContext) => {
  await requirePermission("projects.edit");
  const { id } = await ctx.params;

  const existing = await GeneratedDocumentRepository.getById(id);
  if (!existing) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const document = await GeneratedDocumentRepository.update(id, {
    status: "approved",
  });
  // Collapse to just the approved version — remove the other drafts.
  await GeneratedDocumentRepository.deleteByProjectExcept(
    existing.project_id,
    id,
  );
  return NextResponse.json({ document });
});
