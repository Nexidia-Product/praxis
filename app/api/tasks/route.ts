/**
 * Tasks collection API (Section 5.2, 5.3).
 *
 *   GET  /api/tasks                  List all tasks. Any authenticated user.
 *        ?project_id=YYYY-NNN        Filter to one project's tasks.
 *        ?responsible=<id-or-name>   Filter to tasks assigned to one user.
 *   POST /api/tasks                  Create a task. Admin / Project Lead /
 *                                    Team Member.
 *
 * Filters are applied server-side here for two reasons:
 *
 *   1. The Tasks page passes `?project_id=` from the project quick-view
 *      "View tasks" link; a fresh page load shouldn't ship every task.
 *   2. The legacy seed data has free-form names in `responsible` (e.g.
 *      "Josh"), so the My Tasks page sends both the user_id AND the name
 *      and we OR them together. Doing that match here avoids leaking the
 *      legacy comparison logic into every client.
 */

import { NextResponse } from "next/server";

import { requirePermission, requireSession, withAuth } from "@/lib/auth/permissions";
import { TaskRepository } from "@/lib/db";
import {
  ValidationError,
  createTask,
  type TaskCreatePayload,
} from "@/lib/tasks/service";

export const GET = withAuth(async (request: Request) => {
  await requireSession();
  const url = new URL(request.url);
  const projectId = url.searchParams.get("project_id");
  const responsibleParams = url.searchParams.getAll("responsible");

  let tasks = await TaskRepository.getAll();

  if (projectId) {
    tasks = tasks.filter((t) => t.project_id === projectId);
  }
  if (responsibleParams.length > 0) {
    const set = new Set(responsibleParams);
    tasks = tasks.filter(
      (t) =>
        set.has(t.responsible) ||
        t.additional_assignees.some((a) => set.has(a)),
    );
  }

  // Newest first by created_at; falls back to task_id desc for ties.
  tasks.sort((a, b) => {
    if (a.created_at !== b.created_at) {
      return a.created_at < b.created_at ? 1 : -1;
    }
    return a.task_id < b.task_id ? 1 : -1;
  });

  return NextResponse.json({ tasks });
});

export const POST = withAuth(async (request: Request) => {
  // Section 4.7: Team Members can create tasks (vs. projects, which are
  // restricted to Admin / Project Lead).
  const session = await requirePermission("tasks.create");

  let body: TaskCreatePayload;
  try {
    body = (await request.json()) as TaskCreatePayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  try {
    const task = await createTask(body, {
      createdBy: session.user.user_id,
      userName: session.user.name ?? null,
    });
    return NextResponse.json({ task }, { status: 201 });
  } catch (err) {
    if (err instanceof ValidationError) {
      return NextResponse.json({ error: err.message }, { status: 400 });
    }
    throw err;
  }
});
