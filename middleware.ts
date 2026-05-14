/**
 * Route protection middleware (Section 6, Section 9 Step 2).
 *
 * Runs in the Edge runtime. Two responsibilities:
 *
 *   1. Refresh the Supabase Auth session cookie on every request.
 *      Supabase access tokens are short-lived (1h by default) and
 *      need a refresh-token round-trip to stay valid; running that
 *      from middleware means every request — including server
 *      components — sees a fresh access token without each call site
 *      having to deal with it.
 *
 *   2. Allow-list the public routes and bounce everything else to
 *      `/login` (HTML) or 401 (API) when there's no signed-in user.
 *
 * Allow-list:
 *
 *   - `/login`                              the sign-in page
 *   - `/forgot-password`                    request a password reset
 *   - `/reset-password` (+ subpaths)        consume a Supabase recovery link
 *   - `/invite/<token>`                     invite-acceptance landing
 *   - `/submit`                             public idea-submission portal
 *   - `/api/public/*`                       explicitly public APIs
 *   - `/api/auth/callback`                  Supabase Auth OAuth/recovery callback
 *
 * Static assets and Next.js internals are excluded at the `matcher`
 * level so this function isn't invoked for them.
 *
 * Role / permission enforcement is NOT done here — middleware only
 * verifies "signed in or not". The fine-grained "can this user manage
 * users / edit projects / etc." check runs in each API route via
 * `requirePermission()` from `lib/auth/permissions`.
 */

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

const PUBLIC_PATH_PREFIXES = [
  "/login",
  "/forgot-password",
  "/reset-password",
  "/invite/",
  "/submit",
  "/api/public/",
  "/api/auth/callback",
] as const;

/**
 * Routes that enforce their own auth (typically Bearer-token-based for
 * cron / webhook callers) and therefore bypass the middleware's
 * session-cookie gate. The route handler itself still authenticates —
 * adding a path here doesn't make it anonymous, it just delegates the
 * decision to the handler.
 */
const SELF_AUTH_PATHS = [
  // Vercel Cron hits this with `Authorization: Bearer <CRON_SECRET>` —
  // no session cookie. The route accepts either the Bearer token or
  // an admin session, but middleware would otherwise reject it on
  // the basis of no cookie.
  "/api/admin/notifications/sweep",
] as const;

function isPublicPath(pathname: string): boolean {
  if (pathname === "/submit") return true;
  if (pathname === "/login") return true;
  if (pathname === "/forgot-password") return true;
  if (pathname === "/reset-password") return true;
  if ((SELF_AUTH_PATHS as readonly string[]).includes(pathname)) return true;
  return PUBLIC_PATH_PREFIXES.some(
    (prefix) =>
      pathname === prefix.replace(/\/$/, "") || pathname.startsWith(prefix),
  );
}

export async function middleware(request: NextRequest) {
  // Start with a pass-through response. The Supabase cookie helper
  // may rebuild this if it needs to set refreshed cookies — that's
  // the only reason `response` is `let` rather than `const`.
  let response = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  // If the project isn't configured (e.g. local dev before env vars
  // are set), fall back to the legacy behavior of letting everything
  // through. This keeps `npm run dev` from crashing on a missing
  // config; the user will hit a clearer error from the auth pages
  // themselves when they try to sign in.
  if (!url || !anonKey) {
    return response;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        // Two-step cookie write: update the *request* (so subsequent
        // reads in this middleware see the new values), then build a
        // fresh response and mirror the cookies onto it (so the
        // browser receives them). This dance is the Supabase
        // recommended pattern for Next.js middleware.
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options as CookieOptions);
        }
      },
    },
  });

  // Refresh the session. We call `getUser()` rather than `getSession()`
  // because it triggers a JWT-signature validation against Supabase
  // (which the local-only session decode doesn't). The cost is one
  // request to Supabase per page navigation — acceptable for our
  // scale and worth it for the security guarantee.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  const pathname = request.nextUrl.pathname;
  if (isPublicPath(pathname)) {
    return response;
  }

  if (user) {
    return response;
  }

  // Unauthenticated. Branch on caller type.
  if (pathname.startsWith("/api/")) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const loginUrl = new URL("/login", request.nextUrl);
  loginUrl.searchParams.set(
    "callbackUrl",
    request.nextUrl.pathname + request.nextUrl.search,
  );
  return NextResponse.redirect(loginUrl);
}

/**
 * Matcher excludes Next.js internals and common static assets so the
 * middleware never runs for them. The exclusion list is the same as
 * the NextAuth-era middleware so behavior carries over.
 */
export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:png|jpg|jpeg|gif|svg|ico|webp|css|js|map)$).*)",
  ],
};
