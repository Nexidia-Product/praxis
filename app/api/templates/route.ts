/**
 * Templates collection API (Section 5.19).
 *
 *   GET  /api/templates                List all templates. Any user — the
 *                                      project form needs them at create
 *                                      time to offer template selection.
 *        ?project_type=<type>          Filter to templates for one type.
 *   POST /api/templates                Create a template. Admin only.
 *
 * Editing existing templates is handled via PUT on `/api/templates/[id]`
 * because the editor sends the full record on save (not a sparse PATCH).
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { TemplateRepository, type ProjectType } from "@/lib/db";
import { PROJECT_TYPES } from "@/lib/projects/display";
import {
  ValidationError,
  createTemplate,
  type TemplatePayload,
} from "@/lib/tasks/template-service";

export const GET = withAuth(async (request: Request) => {
  await requireSession();
  const url = new URL(request.url);
  const projectType = url.searchParams.get("project_type");

  let templates = await TemplateRepository.getAll();
  if (projectType) {
    if (!(PROJECT_TYPES as readonly string[]).includes(projectType)) {
      return NextResponse.json(
        { error: `Invalid project_type: ${projectType}` },
        { status: 400 },
      );
    }
    templates = templates.filter((t) => t.project_type === projectType);
  }

  // Stable sort: project_type, then template_name.
  templates.sort((a, b) => {
    if (a.project_type !== b.project_type) {
      return a.project_type < b.project_type ? -1 : 1;
    }
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
