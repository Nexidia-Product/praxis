/**
 * Templates collection API (Section 5.19).
 *
 *   GET  /api/templates                List all templates. Any user — the
 *                                      project form needs them at create
 *                                      time to offer template selection.
 *        ?track=<track_id>             Filter to templates for one track.
 *   POST /api/templates                Create a template. Admin only.
 *
 * Editing existing templates is handled via PUT on `/api/templates/[id]`
 * because the editor sends the full record on save (not a sparse PATCH).
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { TemplateRepository } from "@/lib/db";
import {
  ValidationError,
  createTemplate,
  type TemplatePayload,
} from "@/lib/tasks/template-service";

export const GET = withAuth(async (request: Request) => {
  await requireSession();
  const url = new URL(request.url);
  const track = url.searchParams.get("track");

  let templates = await TemplateRepository.getAll();
  if (track) {
    templates = templates.filter((t) => t.tracks.includes(track));
  }

  // Stable sort: first listed track, then template_name. The
  // single-project-type era sort used the only value a template
  // carried; the multi-value version sorts by the leftmost entry
  // which is stable enough for the editor's table and the dropdown
  // order.
  templates.sort((a, b) => {
    const aTrack = a.tracks[0] ?? "";
    const bTrack = b.tracks[0] ?? "";
    if (aTrack !== bTrack) return aTrack < bTrack ? -1 : 1;
    return a.template_name < b.template_name ? -1 : 1;
  });

  return NextResponse.json({ templates });
});

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("admin.templates.manage");

  let body: TemplatePayload;
  try {
    body = (await request.json()) as TemplatePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const template = await createTemplate(body, {
      createdBy: session.user.user_id,
    });
    return NextResponse.json({ template }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
