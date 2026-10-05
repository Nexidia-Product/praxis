/**
 * /api/use-cases/[id]
 *
 *   GET    → fetch one use case.
 *   PUT    → update name / description / objectives / projects.
 *   DELETE → remove the use case (projects are unaffected).
 *
 * All gated by `usecases.manage` (Admin-only by default).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { UseCaseRepository } from "@/lib/db";
import {
  NotFoundError,
  ValidationError,
  deleteUseCase,
  updateUseCase,
} from "@/lib/use-cases/service";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const GET = withAuth(async (_request: Request, context: RouteContext) => {
  await requirePermission("usecases.manage");
  const { id } = await context.params;
  const useCase = await UseCaseRepository.getById(id);
  if (!useCase) {
    return NextResponse.json({ error: "Use case not found." }, { status: 404 });
  }
  return NextResponse.json({ useCase });
});

export const PUT = withAuth(async (request: Request, context: RouteContext) => {
  const session = await requirePermission("usecases.manage");
  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const useCase = await updateUseCase(
      id,
      (body ?? {}) as Parameters<typeof updateUseCase>[1],
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ useCase });
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
  const session = await requirePermission("usecases.manage");
  const { id } = await context.params;

  try {
    await deleteUseCase(id, {
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
