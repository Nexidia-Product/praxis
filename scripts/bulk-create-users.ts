/**
 * Bulk-create the initial roster of users without going through
 * Supabase's invite email (which is rate-limited to 2/hour on free
 * tier — useless for an onboarding batch).
 *
 *   npm run admin:bulk-create                          # dry run
 *   npm run admin:bulk-create -- --confirm             # actually create
 *   npm run admin:bulk-create -- --file path/users.json
 *   npm run admin:bulk-create -- --file path/users.json --confirm
 *
 * Input shape (data/initial-users.json by default):
 *
 *   [
 *     { "email": "alice@company.com", "name": "Alice Wong",  "role": "Admin" },
 *     { "email": "bob@company.com",   "name": "Bob Smith",   "role": "Project Lead" },
 *     ...
 *   ]
 *
 * Allowed roles: "Admin" | "Project Lead" | "Team Member" | "Viewer".
 *
 * What each create does:
 *
 *   1. `auth.users` row via `admin.createUser` (long random
 *      password, email pre-confirmed, no email sent).
 *   2. `public.users` row with matching user_id, role, name,
 *      default notification preferences from settings.
 *   3. `generateLink({ type: 'recovery' })` to mint a single-use
 *      URL the user clicks to set their own password. The URL
 *      lands on /api/auth/callback?token_hash=... — the SSR-
 *      friendly format that bypasses Supabase's implicit-flow
 *      verify endpoint.
 *
 * No invite email is sent. You share the URLs out-of-band (Slack,
 * 1Password vault, paper, etc.). Each URL expires per your
 * Supabase recovery-link TTL (default 1 hour) so generate-then-
 * share-promptly is the pattern.
 *
 * Idempotency: re-running with --confirm skips users whose email
 * is already in auth.users. Safe to re-run after fixing typos.
 */

import { readFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { createClient } from "@supabase/supabase-js";

import { SettingsRepository } from "../lib/db/settings";
import type { UserRole } from "../lib/db/types";

// ---------------------------------------------------------------------------
// Paths + env
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, "..");
const DATA_DIR = process.env.IIM_DATA_DIR ?? path.join(REPO_ROOT, "data");
const DEFAULT_FILE = path.join(DATA_DIR, "initial-users.json");

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

// ---------------------------------------------------------------------------
// Args
// ---------------------------------------------------------------------------

function getArg(flag: string): string | undefined {
  const idx = process.argv.indexOf(flag);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

const filePath = getArg("--file") || DEFAULT_FILE;
const confirm = process.argv.includes("--confirm");

// ---------------------------------------------------------------------------
// Input shape + validation
// ---------------------------------------------------------------------------

interface InputUser {
  email: string;
  name: string;
  role: UserRole;
}

const VALID_ROLES: UserRole[] = [
  "Admin",
  "Project Lead",
  "Team Member",
  "Viewer",
];

function loadUsers(): InputUser[] {
  let raw: string;
  try {
    raw = readFileSync(filePath, "utf8");
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      bail(
        `File not found: ${filePath}\n` +
          "Create it with an array of {email, name, role} objects (see script comment).",
      );
    }
    throw err;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    bail(`${filePath} is not valid JSON.`);
  }
  if (!Array.isArray(parsed)) {
    bail(`${filePath} must be a JSON array of {email, name, role} objects.`);
  }

  const seenEmails = new Set<string>();
  const cleaned: InputUser[] = [];
  for (let i = 0; i < parsed.length; i++) {
    const entry = parsed[i];
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      bail(`Row ${i + 1}: not an object.`);
    }
    const e = entry as Record<string, unknown>;
    const email = typeof e.email === "string" ? e.email.trim().toLowerCase() : "";
    const name = typeof e.name === "string" ? e.name.trim() : "";
    const role = typeof e.role === "string" ? e.role.trim() : "";
    if (!email || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
      bail(`Row ${i + 1}: invalid or missing email ${JSON.stringify(e.email)}.`);
    }
    if (!name) bail(`Row ${i + 1}: missing name.`);
    if (!(VALID_ROLES as string[]).includes(role)) {
      bail(
        `Row ${i + 1}: invalid role ${JSON.stringify(role)}. ` +
          `Allowed: ${VALID_ROLES.join(", ")}.`,
      );
    }
    if (seenEmails.has(email)) {
      bail(`Row ${i + 1}: duplicate email ${email}.`);
    }
    seenEmails.add(email);
    cleaned.push({ email, name, role: role as UserRole });
  }

  return cleaned;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main(): Promise<void> {
  const users = loadUsers();
  console.log(`Source file:        ${filePath}`);
  console.log(`Destination:        ${url}`);
  console.log(`Site URL for links: ${siteUrl}`);
  console.log(`Users in file:      ${users.length}`);
  console.log(`Mode:               ${confirm ? "WRITE (--confirm)" : "dry run"}`);
  console.log("");

  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  // Index existing auth.users by email so we can skip duplicates
  // cleanly. One paginated read covers the foreseeable team size.
  const knownEmails = new Set<string>();
  let page = 1;
  const MAX_PAGES = 20;
  while (page <= MAX_PAGES) {
    const { data, error } = await client.auth.admin.listUsers({
      page,
      perPage: 100,
    });
    if (error) bail(`Could not list auth users: ${error.message}`);
    for (const u of data.users) {
      if (u.email) knownEmails.add(u.email.toLowerCase());
    }
    if (data.users.length < 100) break;
    page++;
  }

  type Plan = InputUser & { skip: boolean };
  const plans: Plan[] = users.map((u) => ({
    ...u,
    skip: knownEmails.has(u.email),
  }));

  for (const p of plans) {
    console.log(
      `  ${p.skip ? "SKIP" : "WILL CREATE"}  ${p.email}  (${p.role}, ${p.name})${
        p.skip ? "  — already in auth.users" : ""
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
    console.log("Dry run complete. Re-run with --confirm to apply.");
    return;
  }
  if (willCreate.length === 0) {
    console.log("Nothing to do.");
    return;
  }

  console.log("");
  console.log("Creating users…");
  console.log("");

  // Pull default notification prefs once so every profile gets the
  // same starting configuration as a UI-created user.
  const settings = await SettingsRepository.get();
  const defaultPrefs = settings.notification_defaults.per_type;
  const defaultDigest = settings.notification_defaults.digest_mode;

  const recoveryLinks: { email: string; name: string; role: string; link: string }[] = [];

  for (const p of willCreate) {
    // 1. auth.users
    const tempPassword = randomBytes(24).toString("base64url");
    const { data: created, error: createErr } = await client.auth.admin.createUser({
      email: p.email,
      password: tempPassword,
      email_confirm: true,
      user_metadata: { name: p.name, role: p.role },
    });
    if (createErr || !created.user) {
      console.error(
        `  ✗ ${p.email}: createUser failed (${createErr?.message ?? "no user returned"}).`,
      );
      continue;
    }
    const userId = created.user.id;

    // 2. public.users with matching user_id
    const { error: profileErr } = await client.from("users").insert({
      user_id: userId,
      email: p.email,
      name: p.name,
      role: p.role,
      active: true,
      notification_preferences: defaultPrefs,
      digest_mode: defaultDigest,
    });
    if (profileErr) {
      // auth.users row already exists. Roll back so a retry isn't
      // blocked by the dangling auth account.
      await client.auth.admin.deleteUser(userId).catch(() => undefined);
      console.error(
        `  ✗ ${p.email}: public.users insert failed (${profileErr.message}). auth.users rolled back.`,
      );
      continue;
    }

    // 3. recovery link
    const { data: linkData, error: linkErr } = await client.auth.admin.generateLink({
      type: "recovery",
      email: p.email,
    });
    if (linkErr || !linkData?.properties?.hashed_token) {
      console.warn(
        `  ⚠ ${p.email}: created, but recovery link failed (${linkErr?.message ?? "no hashed_token"}). Run admin:recovery-link later.`,
      );
      continue;
    }
    const recoveryUrl =
      `${siteUrl}/api/auth/callback` +
      `?token_hash=${linkData.properties.hashed_token}` +
      `&type=recovery` +
      `&next=${encodeURIComponent("/reset-password")}`;
    recoveryLinks.push({
      email: p.email,
      name: p.name,
      role: p.role,
      link: recoveryUrl,
    });
    console.log(`  ✓ ${p.email}: created.`);
  }

  // -------------------------------------------------------------------------
  // Emit the URL list at the bottom so it's easy to find in scrollback.
  // -------------------------------------------------------------------------

  if (recoveryLinks.length > 0) {
    console.log("");
    console.log("=".repeat(80));
    console.log("Password recovery links — SHARE EACH ONE WITH ITS USER");
    console.log("=".repeat(80));
    console.log(
      "Each user clicks their link to set a password, then can sign in.",
    );
    console.log("Links expire per your Supabase Auth settings (default 1 hour),");
    console.log("so plan to share them promptly. Re-mint expired links with");
    console.log("`npm run admin:recovery-link -- --email <email>`.");
    console.log("");
    for (const { email, name, role, link } of recoveryLinks) {
      console.log(`${name} <${email}> — ${role}`);
      console.log(`  ${link}`);
      console.log("");
    }
  }

  console.log(`Done. ${recoveryLinks.length} user(s) created.`);
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
