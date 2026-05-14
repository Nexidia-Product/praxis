/**
 * Project decision log API (Section 5.11).
 *
 *   GET  /api/projects/[id]/decisions   List decisions for the project,
 *                                        newest-first. Any authenticated user.
 *   POST /api/projects/[id]/decisions   Add a new entry. Admin / Project Lead.
 *
 * Decisions are append-only (Section 4.4) — there is no PATCH or DELETE on
 * single entries. If a correction is needed, add a new entry that
 * supersedes the original. This is the entire entry-level surface area.
 *
 * The decision log is scoped per-project: every entry references its
 * `project_id`, and this route is the only place that hangs the decision
 * service off the URL path so the parent's existence is verified before
 * the service is called. Globally listing every decision in the system
 * doesn't have a use case yet — when one shows up, add a sibling collection
 * route at `/api/decisions`.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import {
  NotFoundError,
  ValidationError,
  createDecision,
  listDecisionsForProject,
  type DecisionCreatePayload,
} from "@/lib/decisions/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, ctx: RouteContext) => {
  await requireSession();
  const { id } = await ctx.params;
  try {
    const decisions = await listDecisionsForProject(id);
    return NextResponse.json({ decisions });
  } catch (err) {
    if (err instanceof NotFoundError) {
      return NextResponse.json({ error: err.message }, { status: 404 });
    }
    throw err;
  }
});

export const POST = withAuth(async (request: Request, ctx: RouteContext) => {
  const session = await requirePermission("projects.edit");
  const { id } = await ctx.params;

  let body: DecisionCreatePayload;
  try {
    body = (await request.json()) as DecisionCreatePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const decision = await createDecision(id, body, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ decision }, { status: 201 });
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
