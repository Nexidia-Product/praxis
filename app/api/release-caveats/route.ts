/**
 * /api/release-caveats
 *
 *   GET  ?date=YYYY-MM-DD → caveats for one release (projects.view).
 *   POST                  → add a caveat to a project for a release
 *                           (projects.edit).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { ReleaseCaveatRepository } from "@/lib/db";
import {
  ValidationError,
  createReleaseCaveat,
} from "@/lib/releases/caveats-service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (request: Request) => {
  await requirePermission("projects.view");
  const date = new URL(request.url).searchParams.get("date") ?? "";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return NextResponse.json(
      { error: "date must be YYYY-MM-DD." },
      { status: 400 },
    );
  }
  const caveats = await ReleaseCaveatRepository.getForRelease(date);
  return NextResponse.json({ caveats });
});

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("projects.edit");

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  try {
    const caveat = await createReleaseCaveat(
      (body ?? {}) as Parameters<typeof createReleaseCaveat>[0],
      { userId: session.user.user_id, userName: session.user.name },
    );
    return NextResponse.json({ caveat }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
