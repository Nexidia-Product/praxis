/**
 * Merge idea → task on an existing project.
 *
 *   POST /api/ideas/[id]/merge
 *   Body: TaskCreatePayload (same shape as POST /api/tasks)
 *
 * Additional disposition alongside `POST /api/ideas/[id]/convert` — instead
 * of creating a new project, this creates a task carrying the idea's
 * content on a project that already exists. The service layer:
 *
 *   1. Verifies the idea exists and isn't already converted.
 *   2. Runs the task payload through the task service so all validation,
 *      notifications, and health-recalc fire identically to a normal task
 *      creation.
 *   3. Marks the idea Converted with a back-link to the existing project.
 *
 * Returns both the new task and the updated idea so the client can
 * navigate to the project without an extra fetch.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  mergeIdeaIntoProject,
} from "@/lib/ideas/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (request: Request, context: RouteContext) => {
  const session = await requirePermission("ideas.convert");
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return NextResponse.json(
      { error: "Request body must be a JSON object." },
      { status: 400 },
    );
  }

  try {
    const result = await mergeIdeaIntoProject(id, body, {
      createdBy: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json(
      { task: result.task, idea: result.idea },
      { status: 201 },
    );
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    if (err instanceof ConflictError) {
      return NextResponse.json({ error: err.message }, { status: 409 });
    }
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});
