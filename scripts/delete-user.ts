/**
 * Testing utility: delete a user from both Supabase Auth and the
 * application profile table. Useful for re-running the invite /
 * sign-in flow against the same email address.
 *
 *   npm run admin:delete-user -- --email someone@example.com
 *
 * What it does:
 *   1. Looks up the user in auth.users by email.
 *   2. Deletes from auth.users via the admin API (Supabase Auth
 *      handles session invalidation).
 *   3. Deletes the matching row from public.users.
 *   4. Reports what it removed.
 *
 * Loose references on other records (`created_by`, `responsible`,
 * `actor_id`, etc.) are NOT touched — they're already designed to
 * tolerate a missing target (rendering as "Unknown user" / the bare
 * UUID). Cleaning them up would be ahistorical anyway: the audit
 * log is supposed to remember that this user did something even
 * after they're gone.
 *
 * Idempotent: if either store is already missing the user, the
 * script reports that and moves on. Safe to re-run.
 *
 * NOT exposed in the app UI. Use `/admin/users` → Deactivate for the
 * production-correct removal path; deletion is destructive and is
 * intentionally a developer-only operation.
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

function bail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) bail("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local.");
if (!serviceKey) bail("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local.");

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const email = (getArg("--email") || "").trim().toLowerCase();
if (!email) {
  bail(
    "Missing required --email <address>. Example: --email someone@example.com",
  );
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  bail(`--email value ${JSON.stringify(email)} is not a valid email.`);
}

async function main(): Promise<void> {
  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Deleting user: ${email}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // 1. auth.users
  // ---------------------------------------------------------------------------

  const { data: page, error: listErr } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) bail(`Could not list auth users: ${listErr.message}`);

  const authUser = page.users.find(
    (u) => (u.email ?? "").toLowerCase() === email,
  );

  if (!authUser) {
    console.log("  - auth.users: no row to delete.");
  } else {
    const { error: delAuthErr } = await client.auth.admin.deleteUser(
      authUser.id,
    );
    if (delAuthErr) {
      bail(`auth.users delete failed: ${delAuthErr.message}`);
    }
    console.log(`  ✓ auth.users: deleted user_id ${authUser.id}.`);
  }

  // ---------------------------------------------------------------------------
  // 2. public.users
  // ---------------------------------------------------------------------------

  const { data: deletedProfiles, error: delProfileErr } = await client
    .from("users")
    .delete()
    .eq("email", email)
    .select("user_id");
  if (delProfileErr) {
    bail(`public.users delete failed: ${delProfileErr.message}`);
  }
  if (!deletedProfiles || deletedProfiles.length === 0) {
    console.log("  - public.users: no row to delete.");
  } else {
    console.log(
      `  ✓ public.users: deleted ${deletedProfiles.length} row(s) (user_id ${deletedProfiles.map((r) => r.user_id).join(", ")}).`,
    );
  }

  console.log("");
  console.log("Done. You can now invite or re-create this email cleanly.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
