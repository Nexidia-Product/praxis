/**
 * /api/release-caveats/[id]
 *
 *   PUT    → edit a caveat's text (projects.edit).
 *   DELETE → remove a caveat (projects.edit).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  NotFoundError,
  ValidationError,
  deleteReleaseCaveat,
  updateReleaseCaveat,
} from "@/lib/releases/caveats-service";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

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
    const caveat = await updateReleaseCaveat(
      id,
      (body ?? {}) as { caveat?: unknown },
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ caveat });
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

export const DELETE = withAuth(async (_request: Request, context: RouteContext) => {
  const session = await requirePermission("projects.edit");
  const { id } = await context.params;

  try {
    await deleteReleaseCaveat(id, {
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
