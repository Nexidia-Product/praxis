/**
 * Single-idea API.
 *
 *   GET    /api/ideas/[id]    Read an idea record.
 *   PATCH  /api/ideas/[id]    Update status / admin_comments.
 *
 * Both Admin and Project Lead may review and update ideas (Section 4.7).
 *
 * Conversion (status → Converted) is intentionally NOT handled here;
 * that's a compound operation that goes through
 * `POST /api/ideas/[id]/convert` so the project payload can come along
 * in the body.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  ConflictError,
  NotFoundError,
  ValidationError,
  getIdea,
  updateIdea,
} from "@/lib/ideas/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, context: RouteContext) => {
  await requirePermission("ideas.review");
  const { id } = await context.params;
  try {
    const idea = await getIdea(id);
    return NextResponse.json({ idea });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});

export const PATCH = withAuth(async (request: Request, context: RouteContext) => {
  const session = await requirePermission("ideas.review");
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
    const idea = await updateIdea(id, body, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ idea });
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
