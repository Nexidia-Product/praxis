/**
 * Mint a fresh password-recovery URL for an existing Supabase Auth
 * user. The script constructs the URL itself (using the
 * `hashed_token` from the admin API response) rather than handing
 * over Supabase's default `action_link` — that one goes through
 * /auth/v1/verify and delivers the session in a URL fragment, which
 * is stripped before reaching the Next.js server.
 *
 *   npm run admin:recovery-link -- --email you@example.com
 *
 * Use this when:
 *   - the email template in the Supabase dashboard hasn't been
 *     updated to the SSR-friendly TokenHash format yet, and
 *   - you need to get into your account out-of-band (e.g. the very
 *     first sign-in after switching the project to Supabase Auth).
 *
 * After the email templates are updated, the regular "Forgot
 * password?" link from /login will produce the same URL via email.
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

const email = (getArg("--email") || "").trim().toLowerCase();
if (!email) {
  bail("Missing required --email <address>. Example: --email you@example.com");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  bail(`--email value ${JSON.stringify(email)} is not a valid email.`);
}

async function main(): Promise<void> {
  const client = createClient(url!, serviceKey!, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  console.log(`Generating a password-recovery link for ${email}…`);
  console.log(`Site URL: ${siteUrl}`);

  const { data, error } = await client.auth.admin.generateLink({
    type: "recovery",
    email,
  });
  if (error || !data?.properties?.hashed_token) {
    bail(
      `Could not generate recovery link: ${error?.message ?? "no hashed_token returned"}`,
    );
  }

  const recoveryUrl =
    `${siteUrl}/api/auth/callback` +
    `?token_hash=${data.properties.hashed_token}` +
    `&type=recovery` +
    `&next=${encodeURIComponent("/reset-password")}`;

  console.log("");
  console.log("=".repeat(80));
  console.log("Open this URL in your browser to set a password:");
  console.log("=".repeat(80));
  console.log(recoveryUrl);
  console.log("");
  console.log("The link is single-use and expires per your Supabase Auth settings.");
}

main().catch((err) => {
  console.error("✗ Unexpected error:", err);
  process.exit(1);
});
