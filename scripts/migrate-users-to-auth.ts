/**
 * One-time migration: create Supabase Auth (`auth.users`) entries for
 * every row in `public.users`.
 *
 *   npm run migrate:auth-users               # dry run
 *   npm run migrate:auth-users -- --confirm  # actually create
 *
 * Why this step exists:
 *
 *   Stage 1 moved every row of `users.json` into the `public.users`
 *   Postgres table, still managed by NextAuth (with bcrypt password
 *   hashes inline). Stage 2 hands identity off to Supabase Auth, which
 *   owns `auth.users`. To preserve every existing reference
 *   (`created_by`, `responsible`, `actor_id`, etc.) we create the
 *   `auth.users` rows with the EXACT SAME UUID as the existing
 *   `public.users.user_id`. After this script runs, the two tables are
 *   linked by id and the rest of the Stage 2 plumbing can swap over.
 *
 *   The existing bcrypt password hashes are NOT portable to Supabase
 *   Auth (different hashing scheme), so every user must reset their
 *   password before they can sign in via the new flow. The script
 *   creates accounts with a long random password and prints a
 *   one-click recovery link for each — that's the simplest "you set
 *   your own password" UX.
 *
 *   Email is marked as confirmed (`email_confirm: true`) since these
 *   are pre-existing accounts whose addresses have already been
 *   considered verified by the previous regime.
 *
 * Idempotency: re-running with --confirm skips users whose email is
 * already present in `auth.users`. No new account is created and no
 * recovery link is generated. Safe to re-run.
 */

import { randomBytes } from "node:crypto";

import { createClient } from "@supabase/supabase-js";

import type { User } from "../lib/db/types";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const siteUrl =
  process.env.NEXT_PUBLIC_SITE_URL?.replace(/\/$/, "") ||
  process.env.NEXTAUTH_URL?.replace(/\/$/, "") ||
  "http://localhost:3000";

function bail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

if (!url) bail("NEXT_PUBLIC_SUPABASE_URL is not set in .env.local.");
if (!serviceKey) bail("SUPABASE_SERVICE_ROLE_KEY is not set in .env.local.");

const confirm = process.argv.includes("--confirm");

async function main(): Promise<void> {
  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // ---------------------------------------------------------------------------
  // Load existing public.users rows
  // ---------------------------------------------------------------------------

  const { data: existing, error: usersErr } = await client
    .from("users")
    .select("user_id, email, name, role, active")
    .order("created_at", { ascending: true });
  if (usersErr) bail(`Failed to read public.users: ${usersErr.message}`);
  const users = (existing ?? []) as Pick<
    User,
    "user_id" | "email" | "name" | "role" | "active"
  >[];

  console.log(`Found ${users.length} row(s) in public.users.`);
  console.log(`Site URL for recovery links: ${siteUrl}`);
  console.log(`Mode: ${confirm ? "WRITE (--confirm)" : "dry run"}`);
  console.log("");

  // ---------------------------------------------------------------------------
  // List existing auth.users so we can skip dup work
  // ---------------------------------------------------------------------------

  const authEmails = new Set<string>();
  const authIds = new Set<string>();
  // Paginate just in case — listUsers returns at most 1000 by default.
  let page = 1;
  // Cap iteration so a misconfigured project can't spin forever.
  const MAX_PAGES = 50;
  while (page <= MAX_PAGES) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) bail(`Failed to list auth.users: ${error.message}`);
    for (const u of data.users) {
      if (u.email) authEmails.add(u.email.toLowerCase());
      authIds.add(u.id);
    }
    if (data.users.length < 100) break;
    page++;
  }
  console.log(`auth.users currently contains ${authEmails.size} account(s).`);
  console.log("");

  // ---------------------------------------------------------------------------
  // Per-user planning
  // ---------------------------------------------------------------------------

  type Plan = {
    user_id: string;
    email: string;
    name: string;
    role: string;
    active: boolean;
    skip: boolean;
    skipReason?: string;
  };

  const plans: Plan[] = users.map((u) => {
    const email = u.email.trim().toLowerCase();
    const skipByEmail = authEmails.has(email);
    const skipById = authIds.has(u.user_id);
    return {
      user_id: u.user_id,
      email,
      name: u.name,
      role: u.role,
      active: u.active,
      skip: skipByEmail || skipById,
      skipReason: skipByEmail
        ? "email already present in auth.users"
        : skipById
          ? "uuid already present in auth.users"
          : undefined,
    };
  });

  for (const p of plans) {
    console.log(
      `  ${p.skip ? "SKIP" : "WILL CREATE"}  ${p.email}  (${p.role}, ${p.active ? "active" : "inactive"})${
        p.skip ? `  — ${p.skipReason}` : ""
      }`,
    );
  }

  const willCreate = plans.filter((p) => !p.skip);
  console.log("");
  console.log(
    `Summary: ${willCreate.length} to create, ${plans.length - willCreate.length} to skip.`,
  );

  if (!confirm) {
    console.log("");
    console.log("Dry run complete. Re-run with --confirm to actually create.");
    return;
  }

  if (willCreate.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  // ---------------------------------------------------------------------------
  // Write phase: create each auth.users row with the existing UUID
  // ---------------------------------------------------------------------------

  console.log("");
  console.log("Creating auth.users entries…");
  console.log("");

  const recoveryLinks: { email: string; link: string }[] = [];

  for (const p of willCreate) {
    // Long random password — the user resets via the recovery link
    // below, so this value never needs to be communicated.
    const tempPassword = randomBytes(24).toString("base64url");

    const { error: createErr } = await client.auth.admin.createUser({
      id: p.user_id,
      email: p.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: {
        name: p.name,
        role: p.role,
      },
      // Inactive users in the legacy table become Supabase-banned so
      // they can't sign in until reactivated. Reactivation goes
      // through the admin UI (Stage 2 Phase D).
      ban_duration: p.active ? "none" : "876000h", // ~100 years
    });
    if (createErr) {
      console.error(`  ✗ ${p.email}: ${createErr.message}`);
      continue;
    }

    // Generate a recovery link so the user can set their own
    // password. We construct the URL ourselves using `hashed_token`
    // so it lands directly on `/api/auth/callback` with query
    // params — Supabase's default `action_link` redirects through
    // /auth/v1/verify which delivers the session in a URL fragment,
    // and fragments are stripped before reaching the server.
    const { data: linkData, error: linkErr } = await client.auth.admin.generateLink({
      type: "recovery",
      email: p.email,
    });
    if (linkErr) {
      console.warn(
        `  ⚠ ${p.email}: created, but recovery link failed: ${linkErr.message}`,
      );
      continue;
    }
    const hashedToken = linkData.properties?.hashed_token;
    if (hashedToken) {
      const recoveryUrl =
        `${siteUrl}/api/auth/callback` +
        `?token_hash=${hashedToken}` +
        `&type=recovery` +
        `&next=${encodeURIComponent("/reset-password")}`;
      recoveryLinks.push({ email: p.email, link: recoveryUrl });
      console.log(`  ✓ ${p.email}: created.`);
    } else {
      console.warn(`  ⚠ ${p.email}: created, but no hashed_token returned.`);
    }
  }

  // -------------------------------------------------------------------------
  // Print recovery URLs at the end so they're easy to find in scrollback.
  // -------------------------------------------------------------------------

  if (recoveryLinks.length > 0) {
    console.log("");
    console.log("=".repeat(80));
    console.log("Password recovery links — SHARE THESE WITH THE USERS");
    console.log("=".repeat(80));
    console.log(
      "Each user clicks their link, sets a new password, then can sign in.",
    );
    console.log("Links expire per your Supabase Auth settings (default: 1 hour).");
    console.log("");
    for (const { email, link } of recoveryLinks) {
      console.log(email);
      console.log(`  ${link}`);
      console.log("");
    }
  }

  console.log("Migration complete.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
