/**
 * Browser-side Supabase client (anon key, cookie-aware).
 *
 * Used by client components for sign-in / sign-out / password
 * recovery and any direct-to-Supabase calls under the user's own
 * permissions (RLS applies).
 *
 * IMPORTANT: this is the cookie-aware browser client from
 * `@supabase/ssr`, not the plain `createClient` from
 * `@supabase/supabase-js`. The plain client persists sessions in
 * localStorage, which is invisible to the server. The SSR-aware
 * client uses cookies, so the session established by our
 * `/api/auth/callback` route (via `verifyOtp`) is the same session
 * the browser sees when it calls `updateUser`, `signOut`, etc.
 *
 * Distinct from:
 *
 *   - `lib/supabase/server.ts`   service-role client; bypasses RLS;
 *                                used by repositories.
 *   - `lib/supabase/request.ts`  cookie-aware *server* client; reads
 *                                the current request's session for
 *                                `requireSession()` and friends.
 *
 * Memoized at module scope: one client per browser tab. The cached
 * client owns its cookie reader/writer, so creating a fresh one per
 * call would not just be wasteful — it would lose any in-progress
 * session refresh.
 */

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getBrowserClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase browser client requires NEXT_PUBLIC_SUPABASE_URL and " +
        "NEXT_PUBLIC_SUPABASE_ANON_KEY to be set. See .env.example.",
    );
  }

  cached = createBrowserClient(url, key);
  return cached;
}
