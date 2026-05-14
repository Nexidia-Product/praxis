/**
 * Apply a task template to an existing project (Section 5.19).
 *
 *   POST /api/projects/[id]/apply-template
 *   Body: { template_id: string }
 *
 * Distinct from the create-project flow's optional template_id —
 * that path runs `instantiateTemplate` once on creation. This endpoint
 * lets an Admin or Project Lead seed an additional batch of tasks
 * onto a project that already exists, e.g. after the project type
 * was changed or a new template became relevant.
 *
 * Each call appends a fresh batch of tasks; nothing is reconciled
 * against the existing roster. Running the same template twice
 * doubles up — by design, since the user might intentionally want a
 * second pass for a phase repeat.
 *
 * Permission: gated by `tasks.create`. The underlying writer is
 * `instantiateTemplate`, which calls `TaskRepository.create` per
 * template item — same surface as a manual "+ New task" click — so
 * the same gate makes sense.
 *
 * Pinned to the Node runtime — `lib/tasks/service.ts` reaches the JSON
 * store, which uses `node:fs` (Edge-runtime hazard).
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import {
  NotFoundError,
  ValidationError,
  instantiateTemplate,
} from "@/lib/tasks/service";

export const runtime = "nodejs";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (request: Request, context: unknown) => {
  await requirePermission("tasks.create");
  const { params } = context as RouteContext;
  const { id: projectId } = await params;

  let body: { template_id?: unknown };
  try {
    body = (await request.json()) as { template_id?: unknown };
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (typeof body.template_id !== "string" || !body.template_id) {
    return NextResponse.json(
      { error: "template_id is required." },
      { status: 400 },
    );
  }

  try {
    const created = await instantiateTemplate(body.template_id, projectId);
    return NextResponse.json({ tasks: created, count: created.length });
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
