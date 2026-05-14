/**
 * Single-project API.
 *
 *   GET    /api/projects/[id]   Fetch one project.
 *   PATCH  /api/projects/[id]   Apply a partial update (also used for
 *                                inline status edits from the table).
 *   DELETE /api/projects/[id]   Remove a project. Admin only.
 *
 * GET is open to any authenticated user (Viewers can view); PATCH is
 * restricted to Admin and Project Lead per Section 4.7. DELETE is
 * Admin-only — destructive enough that we don't grant it to leads.
 *
 * The PATCH route deliberately accepts the same loose payload as POST
 * /api/projects so the "inline status update" UI in the table can send
 * `{ status: "Blocked" }` and have it round-trip through the same
 * service-layer validator.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { ProjectRepository } from "@/lib/db";
import {
  ValidationError,
  deleteProject,
  updateProject,
  type ProjectUpdatePayload,
} from "@/lib/projects/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, ctx: RouteContext) => {
  await requireSession();
  const { id } = await ctx.params;
  const project = await ProjectRepository.getById(id);
  if (!project) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }
  return NextResponse.json({ project });
});

export const PATCH = withAuth(async (request: Request, ctx: RouteContext) => {
  const session = await requirePermission("projects.edit");
  const { id } = await ctx.params;

  let body: ProjectUpdatePayload;
  try {
    body = (await request.json()) as ProjectUpdatePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  // Confirm the project exists before validating, so a 404 isn't masked
  // by a 400 from the validator.
  const existing = await ProjectRepository.getById(id);
  if (!existing) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  try {
    const project = await updateProject(id, body, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ project });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});

export const DELETE = withAuth(async (_request: Request, ctx: RouteContext) => {
  const session = await requirePermission("projects.delete");
  const { id } = await ctx.params;

  const existing = await ProjectRepository.getById(id);
  if (!existing) {
    return NextResponse.json({ error: "Project not found." }, { status: 404 });
  }

  await deleteProject(id, {
    userId: session.user.user_id,
    userName: session.user.name ?? null,
  });
  return NextResponse.json({ deleted: true });
});
