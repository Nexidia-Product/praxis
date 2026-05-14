/**
 * Notifications collection API (Section 5.12).
 *
 *   GET   /api/notifications              List the current user's notifications.
 *                                          Sorted newest-first.
 *                                          ?unread=1 — return only unread.
 *                                          ?limit=N — cap (default 50, max 200).
 *   PATCH /api/notifications              Bulk operation. Currently supports
 *                                          one operation:
 *                                          { mark_all_read: true } → returns
 *                                          { marked: <count> }
 *
 * Single-record mark-read lives at `/api/notifications/[id]/read`.
 *
 * The bell-icon UI calls GET on every drawer open. Because reads are
 * cheap (single JSON file load) we don't try to maintain a server-side
 * unread cache — the cost of getting it wrong outweighs the cost of the
 * extra read at the volumes the doc anticipates.
 */

import { NextResponse } from "next/server";

import { requireSession, withAuth } from "@/lib/auth/permissions";
import {
  listForUser,
  listUnreadForUser,
  markAllReadForUser,
} from "@/lib/notifications/service";

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;

export const GET = withAuth(async (request: Request) => {
  const session = await requireSession();
  const url = new URL(request.url);
  const unreadOnly =
    url.searchParams.get("unread") === "1" ||
    url.searchParams.get("unread") === "true";
  const limitRaw = Number.parseInt(url.searchParams.get("limit") ?? "", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(1, limitRaw), MAX_LIMIT)
    : DEFAULT_LIMIT;

  const all = unreadOnly
    ? await listUnreadForUser(session.user.user_id)
    : await listForUser(session.user.user_id);

  // The repository's `getByUserId` already sorts newest-first; we just
  // truncate. We also count total unread regardless of `limit` so the
  // bell badge stays accurate even when the drawer truncates.
  const unread_count = unreadOnly
    ? all.length
    : all.filter((n) => !n.read).length;

  return NextResponse.json({
    notifications: all.slice(0, limit),
    unread_count,
    total: all.length,
  });
});

interface BulkPatchPayload {
  mark_all_read?: unknown;
}

export const PATCH = withAuth(async (request: Request) => {
  const session = await requireSession();
  let body: BulkPatchPayload;
  try {
    body = (await request.json()) as BulkPatchPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }
  if (body.mark_all_read === true) {
    const marked = await markAllReadForUser(session.user.user_id);
    return NextResponse.json({ marked });
  }
  return NextResponse.json(
    { error: "Unsupported bulk operation." },
    { status: 400 },
  );
});
