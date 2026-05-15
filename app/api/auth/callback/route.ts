/**
 * Supabase Auth callback endpoint.
 *
 * Handles three link shapes Supabase Auth produces:
 *
 *   1. **OTP / email verification on GET** — recovery, invite, signup
 *      confirm, magic link, email change. The link carries
 *      `?token_hash=...&type=<recovery|invite|...>` and lands here
 *      via the browser address bar. To survive link-prefetchers
 *      (Microsoft Defender Safe Links, Slack URL unfurling, etc. —
 *      all of which GET the URL once before the real user clicks),
 *      the GET handler does NOT immediately verify the token. It
 *      returns a tiny HTML interstitial that auto-submits to itself
 *      via POST. Prefetchers don't follow POSTs, so the token stays
 *      alive until the real user lands and the browser runs JS.
 *
 *   2. **OTP / email verification on POST** — the actual
 *      verification, triggered by the interstitial's form. Reads
 *      `token_hash` and `type` from form fields, calls
 *      `auth.verifyOtp`, sets the session cookie, redirects to
 *      `next` (or `/`).
 *
 *   3. **OAuth / PKCE code exchange on GET** — the link carries
 *      `?code=...`. OAuth providers' redirects ARE the user's
 *      explicit action (the user clicked Sign-in-with-Google on
 *      our site, completed the consent screen, and the provider
 *      redirected here), so a prefetch concern doesn't apply.
 *      Process inline on GET.
 *
 * On failure: redirect to `/login?error=auth_callback_failed`.
 *
 * Allow-listed in middleware — the endpoint must be reachable
 * without a session.
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

// ---------------------------------------------------------------------------
// GET: OAuth code exchange OR (for OTP) render the interstitial
// ---------------------------------------------------------------------------

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

  // OAuth code exchange — process on GET as before; the provider's
  // redirect was the user's explicit action.
  if (code) {
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
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (error) {
      console.warn(`[auth/callback GET] exchangeCodeForSession failed: ${error.message}`);
      return loginRedirect(url.origin, "auth_callback_failed");
    }
    return response;
  }

  // OTP flow — render interstitial. The form POSTs to this same
  // endpoint with the params as form fields; the POST handler does
  // the verifyOtp.
  if (tokenHash && type) {
    if (!(VALID_OTP_TYPES as readonly string[]).includes(type)) {
      return loginRedirect(url.origin, "auth_callback_failed");
    }
    return new NextResponse(renderInterstitial(tokenHash, type, nextPath), {
      headers: {
        "Content-Type": "text/html; charset=utf-8",
        // Tell intermediate caches and prefetchers not to store this
        // page; each visit should be a fresh render. Defense-in-
        // depth on top of the form-POST design.
        "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
      },
    });
  }

  return loginRedirect(url.origin, "missing_code");
}

// ---------------------------------------------------------------------------
// POST: actual OTP verification
// ---------------------------------------------------------------------------

export async function POST(request: NextRequest) {
  const url = new URL(request.url);

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!supabaseUrl || !anonKey) {
    return loginRedirect(url.origin, "supabase_not_configured");
  }

  const formData = await request.formData().catch(() => null);
  if (!formData) {
    return loginRedirect(url.origin, "auth_callback_failed");
  }
  const tokenHash = formData.get("token_hash");
  const type = formData.get("type");
  const nextPath = (formData.get("next") as string | null) || "/";

  if (typeof tokenHash !== "string" || typeof type !== "string") {
    return loginRedirect(url.origin, "missing_code");
  }
  if (!(VALID_OTP_TYPES as readonly string[]).includes(type)) {
    return loginRedirect(url.origin, "auth_callback_failed");
  }

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

  const { error } = await supabase.auth.verifyOtp({
    type: type as EmailOtpType,
    token_hash: tokenHash,
  });
  if (error) {
    console.warn(`[auth/callback POST] verifyOtp failed: ${error.message}`);
    return loginRedirect(url.origin, "auth_callback_failed");
  }
  return response;
}

// ---------------------------------------------------------------------------
// Interstitial HTML
// ---------------------------------------------------------------------------

/**
 * Minimal HTML page that auto-submits a form back to this endpoint
 * via POST. The body of the form carries the token_hash + type +
 * next so the POST handler can run verifyOtp.
 *
 * JS-disabled fallback: the page also shows a manual "Continue"
 * button so users without JavaScript can complete the flow.
 *
 * Visible flash: most users see the page for ~50ms before the JS
 * submits the form. Plenty of users won't see it at all. The page
 * still looks like a normal Praxis screen so the brief flash isn't
 * jarring.
 */
function renderInterstitial(
  tokenHash: string,
  type: string,
  next: string,
): string {
  const esc = (s: string) =>
    s.replace(/[&<>"']/g, (c) => {
      switch (c) {
        case "&":
          return "&amp;";
        case "<":
          return "&lt;";
        case ">":
          return "&gt;";
        case '"':
          return "&quot;";
        case "'":
          return "&#39;";
        default:
          return c;
      }
    });

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width,initial-scale=1" />
    <meta name="robots" content="noindex, nofollow" />
    <title>Continuing to Praxis…</title>
    <style>
      html, body {
        margin: 0;
        padding: 0;
        background: #f4f8fa;
        color: #2e2e2e;
        font-family: 'Open Sans', system-ui, -apple-system, sans-serif;
      }
      .wrap {
        min-height: 100vh;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
      }
      .card {
        max-width: 420px;
        width: 100%;
        background: #ffffff;
        border: 1px solid #e2e6e9;
        border-radius: 3px;
        padding: 32px 28px;
        text-align: center;
      }
      .eyebrow {
        font-size: 10px;
        font-weight: 700;
        letter-spacing: 0.08em;
        text-transform: uppercase;
        color: #859ead;
        margin: 0 0 8px;
      }
      h1 {
        font-size: 22px;
        font-weight: 700;
        color: #2e2e2e;
        margin: 0 0 14px;
      }
      p {
        font-size: 13px;
        line-height: 1.55;
        color: #526b7a;
        margin: 0 0 18px;
      }
      button {
        height: 32px;
        padding: 0 18px;
        background: #007bbd;
        color: #ffffff;
        border: 1px solid #007bbd;
        border-radius: 3px;
        font-size: 12px;
        font-weight: 600;
        cursor: pointer;
        font-family: inherit;
      }
      button:hover {
        background: #006da8;
      }
    </style>
  </head>
  <body>
    <div class="wrap">
      <div class="card">
        <p class="eyebrow">Praxis</p>
        <h1>Almost there…</h1>
        <p>One moment while we verify your sign-in link.</p>
        <form id="continue" method="POST" action="/api/auth/callback">
          <input type="hidden" name="token_hash" value="${esc(tokenHash)}" />
          <input type="hidden" name="type" value="${esc(type)}" />
          <input type="hidden" name="next" value="${esc(next)}" />
          <button type="submit">Continue</button>
        </form>
      </div>
    </div>
    <script>
      // Auto-submit so the user doesn't have to click. Link
      // prefetchers (Outlook Safe Links, Slackbot, etc.) don't run
      // JavaScript, so they never reach this line — the token they
      // saw on GET is left untouched.
      document.getElementById('continue').submit();
    </script>
  </body>
</html>`;
}
