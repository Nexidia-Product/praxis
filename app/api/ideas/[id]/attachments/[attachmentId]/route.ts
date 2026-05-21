/**
 * GET /api/ideas/[id]/attachments/[attachmentId]
 *
 * Mints a short-lived Supabase signed URL for one attachment and
 * redirects to it. Requires `ideas.review` — anonymous submitters
 * never get a path to anyone else's files.
 *
 * Implemented as a 302 redirect rather than returning the URL as
 * JSON so the browser's native download flow (Content-Disposition:
 * attachment, prompt for save location) just works without
 * client-side glue.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { IdeaRepository } from "@/lib/db";
import { getDownloadUrl } from "@/lib/ideas/attachments-server";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string; attachmentId: string }>;
}

export const GET = withAuth(async (
  _request: Request,
  context: RouteContext,
) => {
  await requirePermission("ideas.review");
  const { id, attachmentId } = await context.params;

  const idea = await IdeaRepository.getById(id);
  if (!idea) {
    return NextResponse.json({ error: "Idea not found." }, { status: 404 });
  }

  const attachment = (idea.attachments ?? []).find(
    (a) => a.id === attachmentId,
  );
  if (!attachment) {
    return NextResponse.json(
      { error: "Attachment not found." },
      { status: 404 },
    );
  }

  try {
    const url = await getDownloadUrl(attachment.storage_path, {
      // 5 minutes — long enough for the redirect + the download to
      // start; short enough that a leaked URL stops being useful
      // almost immediately.
      expiresInSeconds: 300,
      downloadFilename: attachment.filename,
    });
    return NextResponse.redirect(url, { status: 302 });
  } catch (err) {
    console.error("[attachments] signed URL failed:", err);
    return NextResponse.json(
      { error: "Could not generate download link." },
      { status: 502 },
    );
  }
});
