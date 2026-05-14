/**
 * Authorization helpers for server components and API routes.
 *
 * Stage 2: identity is owned by Supabase Auth (`auth.users`). The
 * application's role + profile fields still live in `public.users`
 * (joined by user_id = auth.users.id), so the flow is:
 *
 *   1. `getRequestClient()` reads the Supabase Auth cookie and tells
 *      us who's calling.
 *   2. We look up the matching `public.users` row by id to fetch
 *      `name`, `role`, and `active`.
 *   3. Build a `Session` shape that mirrors what the rest of the app
 *      already expects (carried over from the NextAuth-era shape so
 *      no callers had to change).
 *
 * Three flavors of guard:
 *
 *   - `requireSession()`     Throws `UnauthorizedError` if no session.
 *   - `requireRole(...)`     Throws `UnauthorizedError` / `ForbiddenError`.
 *   - `requirePermission(p)` Same, but checks the live role-permission
 *                            map from `settings.role_permissions`.
 *
 * API routes wrap their handler in `withAuth()` to translate those
 * errors into 401 / 403 JSON responses automatically.
 *
 * Role hierarchy (Section 4.7), from most to least privileged:
 *
 *   Admin ⊇ Project Lead ⊇ Team Member ⊇ Viewer
 *
 * Prefer `requirePermission` for new gates — it lets an Admin reshape
 * who can do what without a code change. Use `requireRole` when the
 * gate is structural (e.g. an admin-only API route whose entire
 * purpose is to administer the permission system itself).
 *
 * Deactivated accounts are treated as unauthenticated — the
 * `public.users.active = false` check short-circuits the session
 * resolver to `null`.
 */

import { NextResponse } from "next/server";
import { redirect } from "next/navigation";

import { SettingsRepository, type UserRole, type UserId } from "@/lib/db";
import {
  type PermissionKey,
  normalizeRolePermissions,
} from "@/lib/auth/role-permissions";
import { getRequestClient } from "@/lib/supabase/request";
import { getServiceRoleClient } from "@/lib/supabase/server";

/**
 * Resolved session shape. Matches the fields downstream pages were
 * already reading off the NextAuth `Session` type, so call sites
 * needed no edits when we swapped auth providers.
 */
export interface Session {
  user: {
    user_id: UserId;
    name: string;
    email: string;
    role: UserRole;
  };
}

export class UnauthorizedError extends Error {
  constructor(message = "Unauthorized") {
    super(message);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends Error {
  constructor(message = "Forbidden") {
    super(message);
    this.name = "ForbiddenError";
  }
}

// ---------------------------------------------------------------------------
// Session resolution
// ---------------------------------------------------------------------------

/**
 * Resolve the current request's Supabase Auth session into our
 * application-shaped `Session`. Returns `null` for:
 *
 *   - no signed-in user;
 *   - signed-in user whose `public.users` row is missing or marked
 *     `active = false` (deactivated accounts can't act).
 *
 * Cached per-request via React's request memoization is NOT applied
 * here — each call hits Supabase. If this becomes a hot path, wrap
 * with `unstable_cache` or React's `cache()` keyed by the auth
 * cookie's `sb-access-token`.
 */
export async function getSession(): Promise<Session | null> {
  const supabase = await getRequestClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) return null;

  // Look up the application profile using the service-role client.
  // The session client's anon key + RLS would block the read; this
  // is application-internal data the service-role bypass is for.
  const service = getServiceRoleClient();
  const { data: profile, error: profileErr } = await service
    .from("users")
    .select("user_id, email, name, role, active")
    .eq("user_id", data.user.id)
    .maybeSingle();
  if (profileErr || !profile) return null;
  if (!profile.active) return null;

  return {
    user: {
      user_id: profile.user_id as UserId,
      email: profile.email as string,
      name: profile.name as string,
      role: profile.role as UserRole,
    },
  };
}

/** Resolve the current session or throw `UnauthorizedError`. */
export async function requireSession(): Promise<Session> {
  const session = await getSession();
  if (!session) throw new UnauthorizedError();
  return session;
}

/**
 * Resolve the current session and verify the user's role is in the
 * `allowed` set. Throws `UnauthorizedError` if not signed in or
 * `ForbiddenError` if signed in but not authorized.
 */
export async function requireRole(...allowed: UserRole[]): Promise<Session> {
  const session = await requireSession();
  if (!allowed.includes(session.user.role)) {
    throw new ForbiddenError(`Requires role: ${allowed.join(" or ")}`);
  }
  return session;
}

// ---------------------------------------------------------------------------
// Permission resolution
// ---------------------------------------------------------------------------

/**
 * Look up the live permission set for a given role. Reads
 * `settings.role_permissions` and normalizes against the catalog so
 * an out-of-date or hand-edited file can't crash the request. Admin
 * always resolves to the full catalog regardless of what's stored.
 */
export async function getPermissionsForRole(
  role: UserRole,
): Promise<Set<PermissionKey>> {
  const settings = await SettingsRepository.get();
  const normalized = normalizeRolePermissions(settings.role_permissions);
  return new Set(normalized[role]);
}

/**
 * Boolean test: does the current user have the named permission?
 * Returns false for unauthenticated callers rather than throwing —
 * useful in components that hide UI when a permission is missing.
 */
export async function hasPermission(
  permission: PermissionKey,
): Promise<boolean> {
  const session = await getSession();
  if (!session) return false;
  if (session.user.role === "Admin") return true;
  const grants = await getPermissionsForRole(session.user.role);
  return grants.has(permission);
}

/**
 * Resolve the current session and verify the user's role grants the
 * named permission. Throws `UnauthorizedError` if not signed in or
 * `ForbiddenError` if signed in but the permission is missing.
 */
export async function requirePermission(
  permission: PermissionKey,
): Promise<Session> {
  const session = await requireSession();
  if (session.user.role === "Admin") return session;
  const grants = await getPermissionsForRole(session.user.role);
  if (!grants.has(permission)) {
    throw new ForbiddenError(`Missing permission: ${permission}`);
  }
  return session;
}

/**
 * Page-friendly wrapper around `requirePermission` (ADM-15).
 *
 * Server-rendered pages that throw `ForbiddenError` would surface
 * Next.js's default error overlay, which looks broken to a non-
 * developer. This variant catches the throw and redirects to `/403`
 * (a styled in-shell page that explains what happened).
 */
export async function requirePagePermission(
  permission: PermissionKey,
): Promise<Session> {
  try {
    return await requirePermission(permission);
  } catch (err) {
    if (err instanceof ForbiddenError) redirect("/403");
    throw err;
  }
}

/**
 * Like `requirePagePermission` but accepts a list and lets the
 * request through if the user has ANY of them. Used by grouped admin
 * pages (Resource Management, Configuration) whose tabs are each
 * gated by different per-tab permissions.
 */
export async function requireAnyPagePermission(
  permissions: readonly PermissionKey[],
): Promise<Session> {
  if (permissions.length === 0) redirect("/403");
  const session = await requireSession();
  if (session.user.role === "Admin") return session;
  const grants = await getPermissionsForRole(session.user.role);
  for (const p of permissions) {
    if (grants.has(p)) return session;
  }
  redirect("/403");
}

/**
 * Bulk variant of `hasPermission` — resolves a `{key: boolean}` map
 * for the current user. Use this in server components rendering a
 * page that does many UI gates (the Shell, the Admin Console index,
 * etc.) to avoid one settings read per check.
 */
export async function getCurrentUserPermissions(): Promise<{
  role: UserRole | null;
  permissions: Record<string, boolean>;
}> {
  const session = await getSession();
  if (!session) return { role: null, permissions: {} };

  const { ALL_PERMISSION_KEYS } = await import("@/lib/auth/role-permissions");

  if (session.user.role === "Admin") {
    const all: Record<string, boolean> = {};
    for (const k of ALL_PERMISSION_KEYS) all[k] = true;
    return { role: "Admin", permissions: all };
  }

  const grants = await getPermissionsForRole(session.user.role);
  const perms: Record<string, boolean> = {};
  for (const k of ALL_PERMISSION_KEYS) perms[k] = grants.has(k);
  return { role: session.user.role, permissions: perms };
}

// ---------------------------------------------------------------------------
// API route wrapper
// ---------------------------------------------------------------------------

/**
 * Wrap an API route handler so `UnauthorizedError` and `ForbiddenError`
 * become 401 / 403 JSON responses. Any other error rethrows so
 * Next.js surfaces it normally (and so unrelated bugs don't
 * accidentally look like access-control errors to the client).
 */
export function withAuth<Args extends unknown[]>(
  handler: (...args: Args) => Promise<Response>,
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    try {
      return await handler(...args);
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return NextResponse.json({ error: err.message }, { status: 401 });
      }
      if (err instanceof ForbiddenError) {
        return NextResponse.json({ error: err.message }, { status: 403 });
      }
      throw err;
    }
  };
}
