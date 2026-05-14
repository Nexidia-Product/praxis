"use client";

/**
 * Credentials sign-in form. Client-side because the inline error and
 * loading states need `useState`, and Supabase's
 * `signInWithPassword` lives in the browser client.
 *
 * On success, we do a hard navigation to the callback URL — the same
 * reason as the NextAuth-era form: the React Server Component cache
 * for the destination route may have been populated under a
 * different user's permissions, and a hard reload is the only way to
 * guarantee the new user's session is the one that hydrates the
 * page.
 */

import { useState } from "react";
import Link from "next/link";

import { getBrowserClient } from "@/lib/supabase/client";

const GENERIC_ERROR =
  "Sign-in failed. Check your email and password and try again.";

interface LoginFormProps {
  callbackUrl: string;
  /** Error code from `?error=` on the URL (callback / middleware redirect). */
  initialError: string | null;
}

export function LoginForm({ callbackUrl, initialError }: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(
    initialError ? mapInitialError(initialError) : null,
  );

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    setSubmitting(true);
    setError(null);

    const supabase = getBrowserClient();
    const { error: signInError } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });

    if (signInError) {
      // Supabase's error messages are reasonable for users — but we
      // map the most common one ("Invalid login credentials") to our
      // canonical generic message so we don't leak whether the email
      // exists. Other surface errors (rate limits, server) pass
      // through verbatim so the user has a clue what's wrong.
      const msg =
        signInError.message === "Invalid login credentials"
          ? GENERIC_ERROR
          : `Sign-in failed: ${signInError.message}`;
      setError(msg);
      setSubmitting(false);
      return;
    }

    // Hard navigation — discards the prior user's RSC / router cache
    // and forces a fresh server render under the new session cookie.
    window.location.assign(callbackUrl);
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

      <div className="form-field">
        <label htmlFor="password" className="form-label">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="pol-input"
        />
        <div style={{ marginTop: 2, textAlign: "right" }}>
          <Link
            href="/forgot-password"
            style={{
              color: "var(--brand)",
              fontSize: 11,
              fontWeight: 600,
              textDecoration: "underline",
              textUnderlineOffset: 2,
            }}
          >
            Forgot password?
          </Link>
        </div>
      </div>

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={submitting || !email || !password}
        className="pol-btn pol-btn-primary"
        style={{ height: 32, width: "100%" }}
      >
        {submitting ? "Signing in…" : "Sign in"}
      </button>
    </form>
  );
}

/**
 * Translate the `?error=...` codes set by the middleware and auth
 * callback into a human-friendly inline message.
 */
function mapInitialError(code: string): string {
  switch (code) {
    case "auth_callback_failed":
      return "That sign-in link is invalid or has expired. Please try again.";
    case "missing_code":
      return "Incomplete sign-in link. Please use the link from your email.";
    case "supabase_not_configured":
      return "Authentication is not configured. Contact your administrator.";
    default:
      return GENERIC_ERROR;
  }
}
