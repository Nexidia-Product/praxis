/**
 * Shape User records for transport over the admin API.
 *
 * `PublicUser` (from `lib/db/types`) strips secrets, but the admin
 * UI also wants a `pending_invite` flag so it can distinguish
 * "invited but never signed in" from "active and using the app". In
 * the Supabase Auth world that signal lives at
 * `auth.users.last_sign_in_at`, which we resolve through the admin
 * API in `toAdminUser`.
 *
 * `pending_password_reset` is retained for compatibility with the
 * existing admin UI but is now always `false` — Supabase Auth owns
 * recovery tokens and doesn't surface a queryable "user has a live
 * recovery link" state. The admin "Issue reset link" action shows
 * the resulting URL inline at the moment of issuance instead.
 */

import type { PublicUser, User, UserId } from "@/lib/db";

export interface AdminUser extends PublicUser {
  /** True iff the user has never signed in (still inside the invite window). */
  pending_invite: boolean;
  /**
   * Retained for UI compatibility. Always false in the Supabase Auth
   * regime — see file docstring.
   */
  pending_password_reset: boolean;
}

/**
 * Decorate a User with admin-UI flags. As of Stage 4 the `User`
 * shape no longer carries any secret columns (Supabase Auth owns
 * identity), so this function is now a thin field-adder. The
 * destructuring strip-secrets dance from earlier versions is gone.
 *
 * Pass the user's `last_sign_in_at` from auth.users (or `null` for
 * users who have never signed in / aren't found in auth.users).
 */
export function toAdminUser(
  user: User,
  lastSignInAt: string | null = null,
): AdminUser {
  return {
    ...user,
    pending_invite: lastSignInAt === null,
    pending_password_reset: false,
  };
}

/**
 * Build a `user_id → last_sign_in_at` index from a Supabase
 * `auth.admin.listUsers` response. Used by the admin-users list to
 * decorate every public.users row with its sign-in state.
 *
 * The Supabase admin API caps a single call at 1000 users; for
 * larger orgs the caller would need to paginate. We accept the array
 * pre-aggregated so the route can choose its own pagination strategy
 * without leaking the SDK shape into this helper.
 */
export function buildLastSignInIndex(
  authUsers: Array<{ id: string; last_sign_in_at?: string | null }>,
): Map<UserId, string | null> {
  const map = new Map<UserId, string | null>();
  for (const u of authUsers) {
    map.set(u.id, u.last_sign_in_at ?? null);
  }
  return map;
}
