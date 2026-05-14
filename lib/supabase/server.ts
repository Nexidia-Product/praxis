/**
 * Server-side Supabase client (service-role).
 *
 * Imported by API routes, server components, and migration scripts —
 * anywhere we need full read/write access to the database that bypasses
 * Row-Level Security. The service-role key is server-only; it must
 * never reach the browser.
 *
 * The client is memoized per process so we don't reconnect on every
 * request. `auth.autoRefreshToken` and `auth.persistSession` are
 * disabled because the service-role client doesn't represent a user
 * session — it's the application acting on its own behalf.
 *
 * Stage 0 (this file) only stands up the client. Stage 1 will rewrite
 * each `lib/db/*.ts` repository to use it. Stage 2 will add a
 * companion that resolves the *current request's* session from
 * cookies — that one is the authenticated read path. Both layer
 * cleanly: service-role for app-internal work, session-scoped for
 * "who's calling".
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

let cached: SupabaseClient | null = null;

export function getServiceRoleClient(): SupabaseClient {
  if (cached) return cached;

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    throw new Error(
      "Supabase server client requires NEXT_PUBLIC_SUPABASE_URL and " +
        "SUPABASE_SERVICE_ROLE_KEY to be set. See .env.example.",
    );
  }

  cached = createClient(url, key, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
    },
  });
  return cached;
}
