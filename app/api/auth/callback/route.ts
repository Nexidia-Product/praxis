/**
 * Supabase Auth callback endpoint.
 *
 * Handles the two link shapes Supabase Auth produces:
 *
 *   1. **OTP / email verification** (recovery, invite, signup confirm,
 *      magic link, email change). The link carries
 *      `?token_hash=...&type=<recovery|invite|...>` and is verified
 *      server-side via `auth.verifyOtp`. This is the default for
 *      email-template-driven flows once the template is updated to
 *      use `{{ .TokenHash }}` (see SUPABASE_EMAIL_TEMPLATES.md).
 *
 *   2. **OAuth / PKCE code exchange.** The link carries `?code=...`
 *      and is exchanged via `auth.exchangeCodeForSession`. Used by
 *      OAuth providers (not enabled today) and by the PKCE flow when
 *      a client-side `signIn` triggers it.
 *
 * On success: redirects to the `next` query param (or `/`).
 * On failure: redirects to `/login?error=auth_callback_failed`.
 *
 * The endpoint must be reachable without a session (the user does
 * not yet have one when they click the link) — it's allow-listed in
 * the middleware.
 */

import type { EmailOtpType } from "@supabase/supabase-js";
import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export const dynamic = "force-dynamic";

const VALID_OTP_TYPES: ReadonlyArray<EmailOtpType> = [
  "signup",
  "invite",
  "magiclink",
  "recovery",
  "email_change",
  "email",
];

function loginRedirect(origin: string, errorCode: string): NextResponse {
  const url = new URL("/login", origin);
  url.searchParams.set("error", errorCode);
  return NextResponse.redirect(url);
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const tokenHash = url.searchParams.get("token_hash");
  const type = url.searchParams.get("type");
  const nextPath = url.searchParams.get("next") || "/";

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return loginRedirect(url.origin, "supabase_not_configured");
  }

  // Build the success redirect response up front so the cookie helper
  // can write the new auth cookies onto it. Errors below will discard
  // this and return a fresh login redirect instead.
  let response = NextResponse.redirect(new URL(nextPath, url.origin));
  const supabase = createServerClient(supabaseUrl, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options as CookieOptions);
        }
      },
    },
  });

  // ---------------------------------------------------------------------------
  // OTP / email-verification flow
  // ---------------------------------------------------------------------------

  if (tokenHash && type) {
    if (!(VALID_OTP_TYPES as readonly string[]).includes(type)) {
      return loginRedirect(url.origin, "auth_callback_failed");
    }
    const { error } = await supabase.auth.verifyOtp({
      type: type as EmailOtpType,
      token_hash: tokenHash,
    });
    if (error) {
      console.warn(`[auth/callback] verifyOtp failed: ${error.message}`);
      return loginRedirect(url.origin, "auth_callback_failed");
    }
    return response;
  }

  // ---------------------------------------------------------------------------
  // OAuth / PKCE code exchange flow
  // ---------------------------------------------------------------------------

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn(`[auth/callback] exchangeCodeForSession failed: ${error.message}`);
      return loginRedirect(url.origin, "auth_callback_failed");
    }
    return response;
  }

  // Neither parameter present — the link is malformed.
  return loginRedirect(url.origin, "missing_code");
}
