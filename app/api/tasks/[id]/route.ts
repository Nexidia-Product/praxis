/**
 * Single-task API.
 *
 *   GET    /api/tasks/[id]   Fetch one task. Any authenticated user.
 *   PATCH  /api/tasks/[id]   Apply a partial update (also used by inline
 *                            status edits and quick-complete buttons).
 *                            Admin / Project Lead / Team Member.
 *   DELETE /api/tasks/[id]   Remove a task. Admin / Project Lead only —
 *                            Team Members can change status to Canceled
 *                            but can't permanently destroy records.
 *
 * The Tasks page's inline status select and the My Tasks "✓ complete"
 * button both PATCH `{ status: "..." }` through this endpoint, which is
 * why the validator in `lib/tasks/service.ts` accepts a sparse body.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { TaskRepository } from "@/lib/db";
import {
  NotFoundError,
  ValidationError,
  deleteTask,
  updateTask,
  type TaskUpdatePayload,
} from "@/lib/tasks/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, ctx: RouteContext) => {
  await requireSession();
  const { id } = await ctx.params;
  const task = await TaskRepository.getById(id);
  if (!task) {
    return NextResponse.json({ error: "Task not found." }, { status: 404 });
  }
  return NextResponse.json({ task });
});

export const PATCH = withAuth(async (request: Request, ctx: RouteContext) => {
  const session = await requirePermission("tasks.edit");
  const { id } = await ctx.params;

  let body: TaskUpdatePayload;
  try {
    body = (await request.json()) as TaskUpdatePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const task = await updateTask(id, body, {
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

export const DELETE = withAuth(async (_request: Request, ctx: RouteContext) => {
  const session = await requirePermission("tasks.delete");
  const { id } = await ctx.params;

  try {
    await deleteTask(id, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ deleted: true });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});
