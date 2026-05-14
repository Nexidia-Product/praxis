/**
 * Forgot-password request page (`/forgot-password`).
 *
 * Mirrors the `/login` page chrome — public chrome wrapper, narrow
 * column, single-card form. The form posts to
 * `/api/public/password-reset/request` and shows a generic confirmation
 * regardless of whether the email matched a real account, to prevent
 * account enumeration.
 *
 * If the user is already signed in and lands here (e.g. they followed
 * a stale link), bounce them home — they can change their password
 * from their profile, no email loop required.
 */

import { redirect } from "next/navigation";

import { auth } from "@/auth";
import { ForgotPasswordForm } from "@/components/forgot-password-form";
import { PublicChrome } from "@/components/polaris/PublicChrome";

export default async function ForgotPasswordPage() {
  const session = await auth();
  if (session?.user) {
    redirect("/");
  }

  return (
    <PublicChrome width="narrow">
      <div style={{ marginBottom: 20 }}>
        <p className="page-eyebrow">Account recovery</p>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          Forgot your password?
        </h1>
        <p
          className="page-subtitle"
          style={{ marginTop: 8, lineHeight: 1.55 }}
        >
          Enter the email address you use for Praxis and we&apos;ll send you
          a link to set a new password.
        </p>
      </div>

      <div className="pol-card pol-card-pad">
        <ForgotPasswordForm />
      </div>
    </PublicChrome>
  );
}
