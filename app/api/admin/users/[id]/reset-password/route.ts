/**
 * Admin-triggered password reset.
 *
 *   POST /api/admin/users/[id]/reset-password
 *
 * Uses `supabase.auth.admin.generateLink({ type: 'recovery', ... })`
 * to mint a single-use recovery URL for the target user. The link is
 * returned in the response so the admin can share it out-of-band
 * (Slack, in person) when email isn't a viable channel.
 *
 * Supabase will also send the recovery email through its standard
 * template — there's no way to suppress that today, so the user may
 * receive an email plus the admin-shared link. That's acceptable:
 * both link to the same recovery flow.
 *
 * Self-reset is allowed.
 */

import { NextResponse } from "next/server";

import { buildLastSignInIndex, toAdminUser } from "@/lib/auth/admin-user-view";
import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { UserRepository } from "@/lib/db";
import { audit } from "@/lib/audit/service";
import { getServiceRoleClient } from "@/lib/supabase/server";

interface RouteContext {
  params: Promise<{ id: string }>;
}

export const POST = withAuth(
  async (request: Request, context: RouteContext) => {
    const session = await requirePermission("admin.users.manage");
    const { id } = await context.params;

    const target = await UserRepository.getById(id);
    if (!target) {
      return NextResponse.json({ error: "User not found." }, { status: 404 });
    }
    if (!target.active) {
      return NextResponse.json(
        {
          error:
            "Cannot reset a deactivated user's password. Reactivate the account first.",
        },
        { status: 400 },
      );
    }

    const supabase = getServiceRoleClient();
    const origin = new URL(request.url).origin;

    const { data: linkData, error: linkErr } =
      await supabase.auth.admin.generateLink({
        type: "recovery",
        email: target.email,
      });
    if (linkErr || !linkData?.properties?.hashed_token) {
      return NextResponse.json(
        {
          error: `Could not generate recovery link: ${
            linkErr?.message ?? "no hashed_token returned"
          }`,
        },
        { status: 500 },
      );
    }

    // Construct a URL that lands directly on the callback with the
    // token_hash in the query string (the default `action_link` puts
    // it in a URL fragment, which never reaches our server).
    const resetUrl =
      `${origin}/api/auth/callback` +
      `?token_hash=${linkData.properties.hashed_token}` +
      `&type=recovery` +
      `&next=${encodeURIComponent("/reset-password")}`;

    await audit({
      actorId: session.user.user_id,
      actorName: session.user.name ?? null,
      entityType: "User",
      entityId: id,
      entityLabel: target.name,
      action: "password_reset",
      summary: `Issued password reset link for ${target.email}.`,
    });

    // Re-fetch sign-in state for the returned AdminUser shape.
    const { data: authView } = await supabase.auth.admin.getUserById(id);
    const lastSignInById = buildLastSignInIndex(
      authView?.user
        ? [
            {
              id: authView.user.id,
              last_sign_in_at: authView.user.last_sign_in_at ?? null,
            },
          ]
        : [],
    );

    return NextResponse.json({
      user: toAdminUser(target, lastSignInById.get(id) ?? null),
      reset_url: resetUrl,
      // Kept for UI compatibility — the link expiry is governed by
      // Supabase Auth settings (default: 1 hour). Returning a
      // best-effort timestamp here matches the previous contract.
      reset_expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      email_delivered: true,
    });
  },
);
