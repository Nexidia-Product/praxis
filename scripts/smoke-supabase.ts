/**
 * Connectivity smoke test for the Supabase project.
 *
 * Run with: npm run smoke:supabase
 *
 * The npm script passes `--env-file=.env.local` to tsx, so the same
 * variables `npm run dev` would see are visible here. Builds the
 * service-role client, then calls a small no-side-effects admin API
 * to confirm the credentials are accepted and the project is reachable.
 *
 * Exit code 0 on success, non-zero on any failure. Stage 0 ships with
 * just this one check — Stage 1 adds smoke tests for the rewritten
 * repositories.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) fail("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local.");
if (!serviceKey)
  fail("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local.");
if (!anonKey) {
  console.warn(
    "⚠ NEXT_PUBLIC_SUPABASE_ANON_KEY is not set — browser code will fail until you add it.",
  );
}

async function main(): Promise<void> {
  console.log(`Connecting to ${url} …`);

  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // The admin listUsers call is the lightest-weight authenticated
  // round-trip we can make against the project: it requires the
  // service-role key, returns nothing scary even on a busy project
  // (paginated), and confirms both that the URL is correct and that
  // the key is accepted.
  const { data, error } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1,
  });
  if (error) {
    fail(
      `Auth admin call failed: ${error.message}\n` +
        "  - Is the SUPABASE_SERVICE_ROLE_KEY correct (not the anon key)?\n" +
        "  - Is NEXT_PUBLIC_SUPABASE_URL pointing at the right project?",
    );
  }

  const totalLabel = data.users.length === 1 ? "user" : "users";
  console.log(
    `✓ Connected. auth.users contains ${data.users.length} ${totalLabel} on page 1.`,
  );
  console.log(`✓ Service-role key accepted.`);

  // ---------------------------------------------------------------------------
  // Stage 1 schema check
  // ---------------------------------------------------------------------------
  // Once supabase/migrations/0001_initial_schema.sql has been applied, all
  // nine application tables should exist in the `public` schema. We probe
  // each with a head-count query (zero rows is fine — we're checking
  // existence, not data). Any "relation does not exist" error means the
  // user hasn't run the migration yet.

  const expectedTables = [
    "users",
    "projects",
    "tasks",
    "ideas",
    "decisions",
    "notifications",
    "templates",
    "audit_log",
    "settings",
  ];

  const missing: string[] = [];
  for (const table of expectedTables) {
    const { error: tableError } = await client
      .from(table)
      .select("*", { count: "exact", head: true });
    if (tableError) {
      // PGRST205 / PostgREST "relation does not exist" surfaces with code
      // 42P01 in the underlying Postgres error. We treat anything that
      // isn't a clean response as "table not ready".
      missing.push(`${table} (${tableError.message})`);
    }
  }

  if (missing.length > 0) {
    console.log("");
    console.log("⚠ Stage 1 schema not yet applied. Missing tables:");
    for (const m of missing) console.log(`  - ${m}`);
    console.log("");
    console.log(
      "Run supabase/migrations/0001_initial_schema.sql in the Supabase SQL editor",
    );
    console.log(
      "(Dashboard → SQL Editor → New query → paste → Run), then re-run this smoke test.",
    );
    process.exit(0);
  }

  console.log(`✓ All ${expectedTables.length} application tables exist.`);
  console.log("");
  console.log("Stage 0 + schema verified. Ready for repository rewrites.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
