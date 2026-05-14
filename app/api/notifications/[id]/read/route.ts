/**
 * Mark one notification as read (Section 5.12).
 *
 *   POST /api/notifications/[id]/read
 *
 * The bell drawer calls this when a notification is clicked. Returns
 * the updated record so the client can replace it in place without a
 * second fetch.
 *
 * Cross-user safety: the service layer's `markRead` confirms the
 * notification belongs to the current user before it patches. A 404 is
 * returned when the ID isn't visible to the caller, regardless of
 * whether the row simply doesn't exist or belongs to someone else —
 * the two are indistinguishable to the caller, which is the right
 * privacy posture.
 */

import { NextResponse } from "next/server";

import { requireSession, withAuth } from "@/lib/auth/permissions";
import { markRead } from "@/lib/notifications/service";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(async (_request: Request, ctx: RouteContext) => {
  const session = await requireSession();
  const { id } = await ctx.params;
  const updated = await markRead(session.user.user_id, id);
  if (!updated) {
    return NextResponse.json(
      { error: "Notification not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({ notification: updated });
});
