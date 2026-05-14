/**
 * Set-a-new-password page.
 *
 * Lands the user here after Supabase Auth has accepted their
 * recovery / invite link and the `/api/auth/callback` route has
 * exchanged the code for a session. By the time the user sees this
 * page they're already signed in — under a short-lived recovery
 * session — so the form just calls `supabase.auth.updateUser` to set
 * the password.
 *
 * Two distinct flows arrive here:
 *
 *   - Recovery: existing user clicked "Forgot password?", got an
 *     email, clicked the link. Page renders "Reset your password".
 *
 *   - Invite acceptance: admin invited a new user, Supabase sent the
 *     invite email, user clicked the link. Page renders "Set your
 *     password". We distinguish by `last_sign_in_at` — null means
 *     first-time invite.
 *
 * If no session exists (someone navigated here directly), bounce to
 * `/forgot-password` so they can request a fresh recovery link.
 */

import Link from "next/link";
import { redirect } from "next/navigation";

import { getRequestClient } from "@/lib/supabase/request";
import { ResetPasswordForm } from "@/components/reset-password-form";
import { PublicChrome } from "@/components/polaris/PublicChrome";

export const dynamic = "force-dynamic";

export default async function ResetPasswordPage() {
  const supabase = await getRequestClient();
  const { data, error } = await supabase.auth.getUser();
  if (error || !data.user) {
    redirect("/forgot-password");
  }

  const isInvite = !data.user.last_sign_in_at;
  const eyebrow = isInvite ? "Welcome to Praxis" : "Account recovery";
  const title = isInvite ? "Set your password" : "Reset your password";
  const subtitle = isInvite
    ? `Hi ${data.user.user_metadata?.name ?? data.user.email}. Choose a password to finish setting up your account.`
    : "Choose a new password below. The form shows the password rules.";

  return (
    <PublicChrome width="narrow">
      <div style={{ marginBottom: 20 }}>
        <p className="page-eyebrow">{eyebrow}</p>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          {title}
        </h1>
        <p
          className="page-subtitle"
          style={{ marginTop: 8, lineHeight: 1.55 }}
        >
          {subtitle}
        </p>
      </div>

      <div className="pol-card pol-card-pad">
        <ResetPasswordForm email={data.user.email ?? ""} isInvite={isInvite} />
      </div>

      <p
        style={{
          marginTop: 14,
          fontSize: 12,
          color: "var(--tm)",
          textAlign: "center",
        }}
      >
        <Link
          href="/login"
          style={{
            color: "var(--brand)",
            fontWeight: 600,
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          Back to sign in
        </Link>
      </p>
    </PublicChrome>
  );
}
