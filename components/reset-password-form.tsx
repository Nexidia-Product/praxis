"use client";

/**
 * Set-new-password form.
 *
 * The page that hosts this form has already established a recovery /
 * invite session via Supabase's `/api/auth/callback` exchange, so
 * `updateUser({ password })` just works — no token round-trip from
 * us. After success we sign the user out and bounce to `/login`
 * with a confirmation flag, mirroring the previous flow's "use your
 * fresh password once, on the canonical sign-in path" behavior. The
 * canonical-login round-trip catches typo-class problems immediately.
 */

import { useState } from "react";

import {
  MIN_PASSWORD_LENGTH,
  validatePasswordPolicy,
} from "@/lib/auth/password-policy";
import { getBrowserClient } from "@/lib/supabase/client";

interface ResetPasswordFormProps {
  email: string;
  /** True if this is the user's first sign-in (invite acceptance). */
  isInvite: boolean;
}

export function ResetPasswordForm({ email, isInvite }: ResetPasswordFormProps) {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const mismatch = confirm.length > 0 && password !== confirm;
  const policyError =
    password.length > 0 ? validatePasswordPolicy(password) : null;

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (submitting) return;
    if (password !== confirm) {
      setError("Passwords do not match.");
      return;
    }
    const policyMsg = validatePasswordPolicy(password);
    if (policyMsg) {
      setError(policyMsg);
      return;
    }

    setSubmitting(true);
    setError(null);

    const supabase = getBrowserClient();
    const { error: updateErr } = await supabase.auth.updateUser({ password });
    if (updateErr) {
      setError(updateErr.message);
      setSubmitting(false);
      return;
    }

    // Sign out the recovery session before bouncing to /login — we
    // want the user to exercise their new password through the
    // canonical sign-in flow, not be silently auto-authenticated.
    await supabase.auth.signOut();
    window.location.assign(isInvite ? "/login?invited=1" : "/login?reset=1");
  }

  return (
    <form
      onSubmit={handleSubmit}
      style={{ display: "flex", flexDirection: "column", gap: 14 }}
      noValidate
    >
      <div className="form-field">
        <label className="form-label">Email</label>
        <div
          style={{
            border: "1px solid var(--border)",
            background: "var(--bg)",
            borderRadius: "var(--pol-radius)",
            padding: "6px 8px",
            fontSize: 12,
            color: "var(--t2)",
          }}
        >
          {email}
        </div>
      </div>

      <div className="form-field">
        <label htmlFor="password" className="form-label">
          {isInvite ? "Password" : "New password"}
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          disabled={submitting}
          className="pol-input"
          aria-describedby="password-rules"
        />
        <p
          id="password-rules"
          className="form-help"
          style={policyError ? { color: "var(--err)" } : undefined}
        >
          {policyError ??
            `At least ${MIN_PASSWORD_LENGTH} characters with 3 of: lowercase, uppercase, digit, special character.`}
        </p>
      </div>

      <div className="form-field">
        <label htmlFor="confirm" className="form-label">
          Confirm password
        </label>
        <input
          id="confirm"
          name="confirm"
          type="password"
          autoComplete="new-password"
          required
          minLength={MIN_PASSWORD_LENGTH}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          disabled={submitting}
          className="pol-input"
        />
        {mismatch ? (
          <p className="form-help" style={{ color: "var(--err)" }}>
            Passwords don&apos;t match.
          </p>
        ) : null}
      </div>

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={
          submitting ||
          mismatch ||
          policyError !== null ||
          !password ||
          !confirm
        }
        className="pol-btn pol-btn-primary"
        style={{ height: 32, width: "100%" }}
      >
        {submitting
          ? "Saving…"
          : isInvite
            ? "Set password and continue"
            : "Update password"}
      </button>
    </form>
  );
}
