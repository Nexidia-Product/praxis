/**
 * Change an admin account's email in both Supabase Auth and the
 * application profile row.
 *
 *   npm run admin:update-email -- --to new@you.com
 *   npm run admin:update-email -- --to new@you.com --from admin@example.com
 *
 * Default `--from` is `admin@example.com` — the seed default. Pass
 * `--from` explicitly if you've already changed it.
 *
 * What this does:
 *   1. Looks up the user in Supabase Auth by the `--from` email.
 *   2. Updates `auth.users.email` via the admin API. Marks the new
 *      address as already-confirmed so no verification email is sent
 *      to the OLD address (the whole point of this script is that
 *      the old address is fake).
 *   3. Mirrors the change into `public.users.email`.
 *   4. Generates a fresh password-recovery link targeted at the NEW
 *      email and prints it. Use that link to set a real password.
 *
 * Idempotent: re-running with the same `--to` after the change is
 * benign (lookup will fail on `--from`; pass `--from <new>` if you
 * need to bounce again).
 */

import { createClient } from "@supabase/supabase-js";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  "http://localhost:3000";

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

const fromEmail = (getArg("--from") || "admin@example.com").trim().toLowerCase();
const toEmail = (getArg("--to") || "").trim().toLowerCase();

if (!toEmail) {
  bail("Missing required --to <email>. Example: --to you@example.com");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(toEmail)) {
  bail(`--to value ${JSON.stringify(toEmail)} is not a valid email.`);
}
if (fromEmail === toEmail) {
  bail("--from and --to are the same. Nothing to do.");
}

async function main(): Promise<void> {
  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Looking up auth.users by email: ${fromEmail}`);

  // Find the auth user with the old email. listUsers + filter is
  // the simplest path; the project has one admin so this is fine.
  const { data: page, error: listErr } = await client.auth.admin.listUsers({
    page: 1,
    perPage: 1000,
  });
  if (listErr) bail(`Could not list auth users: ${listErr.message}`);
  const target = page.users.find(
    (u) => (u.email ?? "").toLowerCase() === fromEmail,
  );
  if (!target) {
    bail(`No auth.users row found with email ${fromEmail}.`);
  }

  // Make sure we're not about to collide with another existing
  // account at the new address.
  const collision = page.users.find(
    (u) => (u.email ?? "").toLowerCase() === toEmail,
  );
  if (collision && collision.id !== target.id) {
    bail(
      `Another account already uses ${toEmail} (id ${collision.id}). Resolve that first.`,
    );
  }

  console.log(`Found auth.users.id = ${target.id}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // 1. Update auth.users
  // ---------------------------------------------------------------------------

  console.log(`Updating auth.users → ${toEmail} (marking as confirmed)…`);
  const { error: authUpdErr } = await client.auth.admin.updateUserById(target.id, {
    email: toEmail,
    email_confirm: true,
  });
  if (authUpdErr) {
    bail(`auth.users update failed: ${authUpdErr.message}`);
  }
  console.log("  ✓ auth.users updated.");

  // ---------------------------------------------------------------------------
  // 2. Mirror into public.users
  // ---------------------------------------------------------------------------

  console.log(`Updating public.users.email for user_id ${target.id}…`);
  const { error: profileErr } = await client
    .from("users")
    .update({ email: toEmail })
    .eq("user_id", target.id);
  if (profileErr) {
    // Supabase Auth has already moved — log and continue. Manual
    // SQL can clean up if necessary.
    console.warn(
      `  ⚠ public.users update failed: ${profileErr.message}. ` +
        `Auth has already changed; run UPDATE public.users SET email = '${toEmail}' WHERE user_id = '${target.id}' manually to align.`,
    );
  } else {
    console.log("  ✓ public.users updated.");
  }

  // ---------------------------------------------------------------------------
  // 3. Fresh recovery link
  // ---------------------------------------------------------------------------

  console.log("");
  console.log(`Generating a password recovery link for ${toEmail}…`);
  const { data: link, error: linkErr } = await client.auth.admin.generateLink({
    type: "recovery",
    email: toEmail,
  });
  if (linkErr || !link?.properties?.hashed_token) {
    console.warn(
      `  ⚠ Could not generate recovery link: ${linkErr?.message ?? "no hashed_token returned"}.`,
    );
    console.warn(
      "    You can still trigger a reset from the login page → Forgot password?",
    );
    return;
  }

  // Construct a URL that lands DIRECTLY on our callback with the
  // token_hash + type as query params. Supabase's default
  // `action_link` goes through `/auth/v1/verify`, which redirects
  // with the session in a URL fragment — and fragments are stripped
  // before the request reaches our server. Building the URL
  // ourselves with the hashed_token keeps everything in the query
  // string so the server-side callback can verify the OTP.
  const recoveryUrl =
    `${siteUrl}/api/auth/callback` +
    `?token_hash=${link.properties.hashed_token}` +
    `&type=recovery` +
    `&next=${encodeURIComponent("/reset-password")}`;

  console.log("");
  console.log("=".repeat(80));
  console.log("Open this URL in your browser to set the new password:");
  console.log("=".repeat(80));
  console.log(recoveryUrl);
  console.log("");
  console.log("After setting the password you can sign in normally with the new email.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
