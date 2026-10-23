/**
 * POST /api/projects/[id]/outcomes/[outcomeId]/build
 *
 * Create the project that delivers one of a project's outcomes, fill it in
 * from the source project and the outcome, and link the outcome to it. See
 * `lib/projects/outcome-build.ts`.
 *
 * Admin role only. This is a hard role check rather than a permission, so
 * the role/permission matrix can't hand it out.
 */

import { NextResponse } from "next/server";

import {
  ForbiddenError,
  requireSession,
  withAuth,
} from "@/lib/auth/permissions";
import { buildOutcomeProject } from "@/lib/projects/outcome-build-service";
import { ValidationError } from "@/lib/projects/service";

interface RouteContext {
  params: Promise<{ id: string; outcomeId: string }>;
}

export const POST = withAuth(async (_request: Request, ctx: RouteContext) => {
  const session = await requireSession();
  if (session.user.role !== "Admin") {
    throw new ForbiddenError("Only Admins can build an outcome.");
  }
  const { id, outcomeId } = await ctx.params;

  try {
    const result = await buildOutcomeProject(id, outcomeId, {
      userId: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
