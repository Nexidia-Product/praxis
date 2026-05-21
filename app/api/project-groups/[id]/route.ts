/**
 * /api/project-groups/[id]
 *
 *   GET    → fetch one group.
 *   PUT    → update name / description / members (projects.edit).
 *   DELETE → remove the group (projects.edit).
 *
 * The deletion does NOT cascade onto project records — membership is
 * stored on the group, so removing the group is the only cleanup
 * needed. (The reverse — deleting a project — is handled by
 * lib/projects/service.deleteProject calling pruneProjectFromGroups.)
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { ProjectGroupRepository } from "@/lib/db";
import {
  NotFoundError,
  ValidationError,
  deleteGroup,
  updateGroup,
} from "@/lib/project-groups/service";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, context: RouteContext) => {
  await requirePermission("projects.view");
  const { id } = await context.params;
  const group = await ProjectGroupRepository.getById(id);
  if (!group) {
    return NextResponse.json({ error: "Group not found." }, { status: 404 });
  }
  return NextResponse.json({ group });
});

export const PUT = withAuth(async (request: Request, context: RouteContext) => {
  const session = await requirePermission("projects.edit");
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const group = await updateGroup(
      id,
      body as Parameters<typeof updateGroup>[1],
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ group });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});

export const DELETE = withAuth(async (
  _request: Request,
  context: RouteContext,
) => {
  const session = await requirePermission("projects.edit");
  const { id } = await context.params;

  try {
    await deleteGroup(id, {
      userId: session.user.user_id,
      userName: session.user.name,
    });
    return NextResponse.json({ ok: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});
