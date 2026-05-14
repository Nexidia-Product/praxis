"use client";

/**
 * Forgot-password request form.
 *
 * Calls `supabase.auth.resetPasswordForEmail(email, { redirectTo })`
 * directly from the browser. Supabase sends the email (using its
 * configured email template — see the dashboard) and bounces the
 * user back to `/api/auth/callback?next=/reset-password` when they
 * click the link.
 *
 * Anti-enumeration is built into Supabase's response: it returns
 * success for both registered and unregistered emails. We never have
 * to compute that decision client-side.
 */

import { useState } from "react";
import Link from "next/link";

import { getBrowserClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const supabase = getBrowserClient();
    const redirectTo = `${window.location.origin}/api/auth/callback?next=/reset-password`;
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      email.trim(),
      { redirectTo },
    );

    setSubmitting(false);

    if (resetError) {
      // Rate-limit and validation errors are the most common; surface
      // them verbatim. Supabase's wording is reasonable for end users.
      setError(resetError.message);
      return;
    }

    setDone(true);
  }

  if (done) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
        <div role="status" className="pol-notice pol-notice-ok">
          <span aria-hidden="true">✓</span>
          <span>
            If an account with that email exists, we&apos;ve sent a
            password reset link.
          </span>
        </div>
        <p
          className="form-help"
          style={{ fontSize: 12, lineHeight: 1.55, color: "var(--t2)" }}
        >
          Check your inbox (and your spam folder, just in case). The link
          expires in 1 hour. If you don&apos;t receive it, ask an
          administrator to reset your password directly.
        </p>
        <div style={{ marginTop: 6 }}>
          <Link
            href="/login"
            style={{
              color: "var(--brand)",
              fontSize: 12,
              fontWeight: 600,
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            Back to sign in
          </Link>
        </div>
      </div>
    );
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      noValidate
    >
      <div className="form-field">
        <label htmlFor="email" className="form-label">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          disabled={submitting}
          className="pol-input"
        />
      </div>

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !email}
        className="pol-btn pol-btn-primary"
        style={{ height: 32, width: "100%" }}
      >
        {submitting ? "Sending…" : "Send reset link"}
      </button>

      <div style={{ textAlign: "center", marginTop: 4 }}>
        <Link
          href="/login"
          style={{
            color: "var(--brand)",
            fontSize: 12,
            fontWeight: 600,
            textDecoration: "underline",
            textUnderlineOffset: 2,
          }}
        >
          Back to sign in
        </Link>
      </div>
    </form>
  );
}
