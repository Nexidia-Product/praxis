/**
 * Single-template API.
 *
 *   GET    /api/templates/[id]   Fetch one template. Any authenticated user.
 *   PUT    /api/templates/[id]   Replace the entire template. Admin only.
 *                                We use PUT not PATCH because the editor's
 *                                "save" sends the full record — partial
 *                                updates would force the editor to track
 *                                a per-field dirty bitmap for no benefit.
 *   DELETE /api/templates/[id]   Remove a template. Admin only.
 *
 * Deleting a template does NOT cascade to tasks that were instantiated
 * from it — those tasks live on their own and only carry the `template_id`
 * for audit purposes.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { TemplateRepository } from "@/lib/db";
import {
  NotFoundError,
  ValidationError,
  deleteTemplate,
  updateTemplate,
  type TemplatePayload,
} from "@/lib/tasks/template-service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, ctx: RouteContext) => {
  await requireSession();
  const { id } = await ctx.params;
  const template = await TemplateRepository.getById(id);
  if (!template) {
    return NextResponse.json(
      { error: "Template not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ template });
});

export const PUT = withAuth(async (request: Request, ctx: RouteContext) => {
  await requirePermission("admin.templates.manage");
  const { id } = await ctx.params;

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
    const template = await updateTemplate(id, body);
    return NextResponse.json({ template });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});

export const DELETE = withAuth(async (_request: Request, ctx: RouteContext) => {
  await requirePermission("admin.templates.manage");
  const { id } = await ctx.params;

  try {
    await deleteTemplate(id);
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});
