/**
 * /api/use-cases
 *
 *   GET  → list every use case (usecases.manage).
 *   POST → create a use case (usecases.manage).
 *
 * `usecases.manage` is Admin-only by default. A read-only view for
 * everyone is planned separately.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { UseCaseRepository } from "@/lib/db";
import { ValidationError, createUseCase } from "@/lib/use-cases/service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  await requirePermission("usecases.manage");
  const useCases = await UseCaseRepository.getAll();
  return NextResponse.json({ useCases });
});

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("usecases.manage");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const useCase = await createUseCase(
      (body ?? {}) as Parameters<typeof createUseCase>[0],
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ useCase }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
