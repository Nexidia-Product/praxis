/**
 * Request-scoped Supabase client.
 *
 * Used inside server components, API routes, and server actions to
 * access Supabase Auth as the *current user* — reads/writes session
 * cookies through Next.js's `cookies()` helper.
 *
 * Distinct from:
 *
 *   - `lib/supabase/server.ts`  → service-role client; bypasses RLS;
 *                                  used for repository CRUD where the
 *                                  app acts on its own behalf.
 *   - `lib/supabase/client.ts`  → browser anon-key client; used by
 *                                  client components for sign-in /
 *                                  sign-out / password recovery.
 *
 * This module is the *third* flavor: anon key + cookie context.
 * `auth.getUser()` here verifies the session JWT and refreshes the
 * cookie if needed — that's how `requireSession()` knows who's
 * logged in.
 *
 * Implementation notes:
 *
 *   - In Next.js 15 `cookies()` returns a Promise, hence the
 *     `await`. The caller must therefore be async (which every server
 *     component / route already is).
 *   - Writing cookies from a server component is illegal in Next.js;
 *     the `setAll` callback swallows the resulting error. The
 *     middleware refreshes the cookie on the next request, so the
 *     swallowed write is harmless.
 *   - We do NOT memoize the client — each request gets a fresh
 *     instance bound to the request's cookie store. Cross-request
 *     caching here would leak sessions between users.
 */

import { cookies } from "next/headers";

import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

export async function getRequestClient(): Promise<SupabaseClient> {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error(
      "Request-scoped Supabase client requires NEXT_PUBLIC_SUPABASE_URL " +
        "and NEXT_PUBLIC_SUPABASE_ANON_KEY. See .env.example.",
    );
  }

  const cookieStore = await cookies();

  return createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options as CookieOptions);
          }
        } catch {
          // Server Components can't write cookies. Middleware will
          // refresh the session on the next request, so this is fine.
        }
      },
    },
  });
}
