/**
 * Notifications sweep — single entry point for the daily run.
 *
 *   POST /api/admin/notifications/sweep
 *
 * Two ways to invoke it:
 *
 *   1. **Vercel Cron** — sends `Authorization: Bearer <CRON_SECRET>`
 *      every day. The secret matches the `CRON_SECRET` env var on
 *      the project. Cron-style calls don't carry a session cookie,
 *      so the Bearer header is the only auth path that works for
 *      them.
 *
 *   2. **Admin "Run sweep now" button** — uses the user's session
 *      cookie. Gated by `admin.notifications.run_sweep` so only
 *      Admins can fire it.
 *
 * The two paths are short-circuit: if the Bearer header is present
 * AND matches the secret, the call is accepted regardless of
 * session state. Otherwise we fall back to the session-based
 * permission check. That means accidentally running with a bad
 * secret won't lock an admin out of the UI fallback — they'll just
 * see the normal 401/403 if they're not signed in.
 *
 * Idempotent: the sweep de-duplicates against notifications written
 * earlier today, so running twice (cron + button) is safe.
 *
 * Pinned to the Node runtime — the sweep transitively touches the
 * notification email module which uses `node:crypto` etc.
 */

import { NextResponse } from "next/server";

import {
  ForbiddenError,
  requirePermission,
  UnauthorizedError,
} from "@/lib/auth/permissions";
import { runDailySweep } from "@/lib/notifications/sweep";

export const runtime = "nodejs";

/**
 * Vercel Hobby caps function invocations at 10s; Pro at 60s. We
 * set 10 explicitly so the limit is documented and so the function
 * fails fast rather than letting a stuck call burn the budget. The
 * sweep itself typically completes in well under 5s now that the
 * bulk health-score recalc has been moved off the cron path (per-
 * write hooks keep individual badges current; see lib/notifications/
 * sweep.ts for the rationale).
 */
export const maxDuration = 10;

export async function POST(request: Request): Promise<Response> {
  // ---------------------------------------------------------------------------
  // Path 1: cron — Bearer token in the Authorization header
  // ---------------------------------------------------------------------------

  const cronSecret = process.env.CRON_SECRET?.trim();
  const authHeader = request.headers.get("authorization") ?? "";

  if (cronSecret && authHeader === `Bearer ${cronSecret}`) {
    const result = await runDailySweep();
    return NextResponse.json(result);
  }

  // If a Bearer header was supplied but the secret didn't match,
  // reject hard. Don't silently fall through to the session check —
  // that masks misconfigured CRON_SECRET as "everything works
  // because I happen to be signed in", which is exactly the bug an
  // operator wants to surface during setup.
  if (authHeader.startsWith("Bearer ") && cronSecret !== undefined) {
    return NextResponse.json(
      { error: "Invalid cron secret." },
      { status: 401 },
    );
  }

  // ---------------------------------------------------------------------------
  // Path 2: admin UI — session cookie + permission check
  // ---------------------------------------------------------------------------

  try {
    await requirePermission("admin.notifications.run_sweep");
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return NextResponse.json({ error: err.message }, { status: 401 });
    }
    if (err instanceof ForbiddenError) {
      return NextResponse.json({ error: err.message }, { status: 403 });
    }
    throw err;
  }

  const result = await runDailySweep();
  return NextResponse.json(result);
}
