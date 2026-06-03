/**
 * Per-user My Tasks checklist ordering API.
 *
 *   GET /api/profile/my-tasks-order   Return the current user's saved
 *                                     task-ID order (array).
 *   PUT /api/profile/my-tasks-order   Replace it. Body: { order: string[] }.
 *
 * Scoped to the calling user via the session — there's no path param and
 * no way to write another user's order. Mirrors the per-user notification
 * preferences route.
 */

import { NextResponse } from "next/server";

import { requireSession, withAuth } from "@/lib/auth/permissions";
import { getMyTasksOrder, setMyTasksOrder } from "@/lib/tasks/my-tasks-order";

export const GET = withAuth(async () => {
  const session = await requireSession();
  const order = await getMyTasksOrder(session.user.user_id);
  return NextResponse.json({ order });
});

interface PutPayload {
  order?: unknown;
}

export const PUT = withAuth(async (request: Request) => {
  const session = await requireSession();
  let body: PutPayload;
  try {
    body = (await request.json()) as PutPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  if (
    !Array.isArray(body.order) ||
    !body.order.every((id) => typeof id === "string")
  ) {
    return NextResponse.json(
      { error: "order must be an array of task IDs." },
      { status: 400 },
    );
  }

  const order = await setMyTasksOrder(
    session.user.user_id,
    body.order as string[],
  );
  return NextResponse.json({ order });
});
