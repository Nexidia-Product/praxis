/**
 * POST /api/tasks/[id]/move
 *
 * Body: { project_id: string }
 *
 * Reparent a task to a different project. Gated by `tasks.move` — a
 * permission held by Admin and Project Lead only, deliberately distinct
 * from `tasks.edit` (which Team Members also have) so routine task
 * editing doesn't imply the ability to reparent.
 *
 * The heavy lifting (destination validation, health recalc on both
 * projects, audit) lives in `moveTask` in the service layer.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { NotFoundError, ValidationError, moveTask } from "@/lib/tasks/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (request: Request, ctx: RouteContext) => {
  const session = await requirePermission("tasks.move");
  const { id } = await ctx.params;

  let body: { project_id?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const projectId =
    typeof body.project_id === "string" ? body.project_id.trim() : "";
  if (!projectId) {
    return NextResponse.json(
      { error: "project_id is required." },
      { status: 400 },
    );
  }

  try {
    const task = await moveTask(id, projectId, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ task });
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
