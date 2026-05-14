/**
 * Admin user management API.
 *
 *   GET  /api/admin/users   List all users.
 *   POST /api/admin/users   Invite a new user. Supabase Auth sends
 *                           the invite email; we mirror the user into
 *                           `public.users` so the rest of the app
 *                           (audit log, project_lead, etc.) can refer
 *                           to them by ID.
 *
 * Both endpoints require `admin.users.manage`. Response shapes are
 * the AdminUser projection, identical to the pre-Stage-2 contract.
 *
 * Identity is owned by Supabase Auth (`auth.users`). The
 * `public.users` row holds the application-level profile: role,
 * name, notification preferences, active flag. The two are linked by
 * `user_id = auth.users.id`.
 */

import { NextResponse } from "next/server";

import { buildLastSignInIndex, toAdminUser } from "@/lib/auth/admin-user-view";
import { requirePermission, withAuth } from "@/lib/auth/permissions";
import { SettingsRepository, UserRepository, type UserRole } from "@/lib/db";
import { audit } from "@/lib/audit/service";
import { getServiceRoleClient } from "@/lib/supabase/server";

const VALID_ROLES: UserRole[] = [
  "Admin",
  "Project Lead",
  "Team Member",
  "Viewer",
];

export const GET = withAuth(async () => {
  await requirePermission("admin.users.manage");

  // Pull both sources of truth: the application profile rows and the
  // Supabase Auth user list (for `last_sign_in_at`). For organizations
  // beyond 1000 users we'd page through `listUsers`; this is fine for
  // the current scale.
  const supabase = getServiceRoleClient();
  const [profiles, { data: authPage, error: authErr }] = await Promise.all([
    UserRepository.getAll(),
    supabase.auth.admin.listUsers({ page: 1, perPage: 1000 }),
  ]);
  if (authErr) {
    return NextResponse.json(
      { error: `Could not load Supabase Auth user list: ${authErr.message}` },
      { status: 500 },
    );
  }

  const lastSignInById = buildLastSignInIndex(
    authPage.users.map((u) => ({
      id: u.id,
      last_sign_in_at: u.last_sign_in_at ?? null,
    })),
  );

  profiles.sort((a, b) => a.name.localeCompare(b.name));
  const users = profiles.map((p) =>
    toAdminUser(p, lastSignInById.get(p.user_id) ?? null),
  );
  return NextResponse.json({ users });
});

interface InviteBody {
  email?: unknown;
  name?: unknown;
  role?: unknown;
}

export const POST = withAuth(async (request: Request) => {
  const session = await requirePermission("admin.users.manage");

  let body: InviteBody;
  try {
    body = (await request.json()) as InviteBody;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const email =
    typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
  const name = typeof body.name === "string" ? body.name.trim() : "";
  const role = typeof body.role === "string" ? body.role : "";

  if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json(
      { error: "Valid email is required." },
      { status: 400 },
    );
  }
  if (!name) {
    return NextResponse.json({ error: "Name is required." }, { status: 400 });
  }
  if (!VALID_ROLES.includes(role as UserRole)) {
    return NextResponse.json({ error: "Invalid role." }, { status: 400 });
  }

  // Reject duplicate email up-front so we don't half-create a user.
  const existing = await UserRepository.getByEmail(email);
  if (existing) {
    return NextResponse.json(
      { error: "A user with that email already exists." },
      { status: 409 },
    );
  }

  const supabase = getServiceRoleClient();
  const origin = new URL(request.url).origin;

  // Supabase sends the invite email via its own templates (configured
  // in the dashboard). The `redirectTo` lands the user on the
  // password-set page after the magic link is verified by
  // /api/auth/callback.
  const { data: invited, error: inviteErr } =
    await supabase.auth.admin.inviteUserByEmail(email, {
      redirectTo: `${origin}/api/auth/callback?next=/reset-password`,
      data: { name, role },
    });
  if (inviteErr || !invited?.user) {
    return NextResponse.json(
      {
        error: `Could not issue invite: ${
          inviteErr?.message ?? "no user returned"
        }`,
      },
      { status: 500 },
    );
  }

  // Mirror the new user into public.users so the rest of the app can
  // refer to them by ID. We pass the auth user's id explicitly so the
  // profile primary key matches `auth.users.id` from the start —
  // that's the linkage the session resolver depends on.
  const settings = await SettingsRepository.get();
  const profile = await UserRepository.create({
    user_id: invited.user.id,
    email,
    name,
    role: role as UserRole,
    active: true,
    notification_preferences: settings.notification_defaults.per_type,
    digest_mode: settings.notification_defaults.digest_mode,
  });

  await audit({
    actorId: session.user.user_id,
    actorName: session.user.name ?? null,
    entityType: "User",
    entityId: profile.user_id,
    entityLabel: profile.name,
    action: "invite",
    summary: `Invited ${profile.email} as ${profile.role}.`,
  });

  // Generate a fallback URL the admin can copy-and-share if the
  // Supabase invite email doesn't land. `generateLink` on an
  // existing user with `type: 'recovery'` produces a fresh
  // hashed_token without sending another email — the resulting URL
  // takes the recipient through the same callback → /reset-password
  // flow as the invite email link.
  let inviteUrl: string | null = null;
  const { data: linkData, error: linkErr } =
    await supabase.auth.admin.generateLink({
      type: "recovery",
      email,
    });
  if (linkErr) {
    console.warn(
      `[admin/users] Could not mint fallback link for ${email}: ${linkErr.message}`,
    );
  } else if (linkData?.properties?.hashed_token) {
    inviteUrl =
      `${origin}/api/auth/callback` +
      `?token_hash=${linkData.properties.hashed_token}` +
      `&type=recovery` +
      `&next=${encodeURIComponent("/reset-password")}`;
  }

  return NextResponse.json(
    {
      user: toAdminUser(profile, null),
      // `invite_url` is the manual-share fallback link. The Supabase
      // invite email is sent separately (via inviteUserByEmail
      // above) using whatever template is configured in the
      // dashboard. If email delivery is shaky, the admin shares the
      // URL out-of-band.
      invite_url: inviteUrl,
      invite_expires_at: null,
      email_delivered: true,
      email_failure_reason: null,
    },
    { status: 201 },
  );
});
