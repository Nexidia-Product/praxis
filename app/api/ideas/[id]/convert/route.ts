/**
 * Convert idea → project.
 *
 *   POST /api/ideas/[id]/convert
 *   Body: ProjectCreatePayload (same shape as POST /api/projects)
 *
 * The admin's conversion form sends the payload it wants to create the
 * project with (typically pre-filled from `buildConversionPreview` and
 * adjusted by the admin). The service layer:
 *
 *   1. Verifies the idea exists and isn't already converted.
 *   2. Runs the project payload through the project service so all
 *      validation, notifications, and health-recalc fire identically to
 *      a normal project creation.
 *   3. Marks the idea Converted with a back-link to the new project.
 *
 * Returns both the new project and the updated idea so the client can
 * navigate to the project detail view without an extra fetch.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  convertIdeaToProject,
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
    const result = await convertIdeaToProject(id, body, {
      createdBy: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json(
      { project: result.project, idea: result.idea },
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
