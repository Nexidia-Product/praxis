/**
 * PATCH /api/ai/documents/[id]
 *
 * Body: { markdown: string }
 * Updates a generated document's markdown so users can make minor edits
 * to a draft. Permission: projects.edit. Not gated by AI_ENABLED — this
 * is a plain edit of a stored row, no model call.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { GeneratedDocumentRepository } from "@/lib/db";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const dynamic = "force-dynamic";
export const revalidate = 0;

export const PATCH = withAuth(async (request: Request, ctx: RouteContext) => {
  await requirePermission("projects.edit");
  const { id } = await ctx.params;

  let body: { markdown?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }
  if (typeof body.markdown !== "string" || body.markdown.trim() === "") {
    return NextResponse.json(
      { error: "markdown must be a non-empty string." },
      { status: 400 },
    );
  }

  const existing = await GeneratedDocumentRepository.getById(id);
  if (!existing) {
    return NextResponse.json({ error: "Document not found." }, { status: 404 });
  }

  const document = await GeneratedDocumentRepository.update(id, {
    markdown: body.markdown,
  });
  return NextResponse.json({ document });
});
