/**
 * POST /api/tasks/[id]/key-findings
 *
 * Body: { html: string }   // pasted rich content, sanitized server-side
 * Returns: { task }        // the updated task, including the new finding
 *
 * Appends a key finding to the task. Separate from PATCH /api/tasks/[id]
 * because a finding is a discrete append with rich content, not a field
 * edit. Permission: tasks.edit — same as editing the task.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  NotFoundError,
  ValidationError,
  addKeyFinding,
} from "@/lib/tasks/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (request: Request, ctx: RouteContext) => {
  const session = await requirePermission("tasks.edit");
  const { id } = await ctx.params;

  let body: { html?: unknown };
  try {
    body = (await request.json()) as typeof body;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const task = await addKeyFinding(id, body.html, {
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
