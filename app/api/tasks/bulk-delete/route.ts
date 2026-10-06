/**
 * POST /api/tasks/bulk-delete
 *
 * Body: `{ "task_ids": ["26-0001", ...] }` (max 500).
 *
 * Permanently deletes many tasks in one call. Gated by
 * `tasks.bulk_delete` (Admin-only by default), deliberately separate from
 * `tasks.delete`, which governs deleting a single task. Tasks outside the
 * caller's visible programs are treated as not found. Responds with
 * `{ deleted: string[], notFound: string[] }`.
 */

import { NextResponse } from "next/server";

import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { ProjectRepository } from "@/lib/db";
import { getAllowedPrograms } from "@/lib/projects/visibility";
import { ValidationError, bulkDeleteTasks } from "@/lib/tasks/service";

export const dynamic = "force-dynamic";

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("tasks.bulk_delete");

  let body: { task_ids?: unknown };
  try {
    body = (await request.json()) as { task_ids?: unknown };
  } catch {
    return NextResponse.json({ error: "Invalid JSON body." }, { status: 400 });
  }

  const allowed = await getAllowedPrograms(session);
  const programByProject = new Map<string, string>();
  if (allowed !== "all") {
    for (const p of await ProjectRepository.getAll()) {
      programByProject.set(p.project_id, p.program);
    }
  }

  try {
    const result = await bulkDeleteTasks(
      body.task_ids,
      (task) =>
        allowed === "all" ||
        allowed.includes(programByProject.get(task.project_id) ?? ""),
      { userId: session.user.user_id, userName: session.user.name ?? null },
    );
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
