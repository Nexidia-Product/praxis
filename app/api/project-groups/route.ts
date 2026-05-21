/**
 * /api/project-groups
 *
 *   GET  → list every group (read access via projects.view).
 *   POST → create a new group (write access via projects.edit).
 *
 * Validation lives in lib/project-groups/service.ts; this route is
 * a thin wrapper that translates HTTP into service calls and maps
 * known service errors to status codes.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { ProjectGroupRepository } from "@/lib/db";
import {
  ValidationError,
  createGroup,
} from "@/lib/project-groups/service";

export const dynamic = "force-dynamic";

export const GET = withAuth(async () => {
  await requirePermission("projects.view");
  const groups = await ProjectGroupRepository.getAll();
  return NextResponse.json({ groups });
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
    const group = await createGroup(body as Parameters<typeof createGroup>[0], {
      userId: session.user.user_id,
      userName: session.user.name,
    });
    return NextResponse.json({ group }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
