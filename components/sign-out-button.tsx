"use client";

/**
 * Sign-out button. Client component so it can call
 * `supabase.auth.signOut()` on the browser client (which clears the
 * session cookies) and then hard-navigate to `/login`.
 *
 * Default styling matches the Polaris header bar — light-on-dark, no
 * heavy outline. A `className` override is kept for any caller that
 * needs to render the button outside the header.
 */

import { getBrowserClient } from "@/lib/supabase/client";

interface SignOutButtonProps {
  className?: string;
  variant?: "header" | "default";
}

export function SignOutButton({ className, variant = "header" }: SignOutButtonProps) {
  const handleClick = async () => {
    // Hard navigation after sign-out (AUTH-01). A soft redirect would
    // leave the RSC cache for `/login` populated with whatever the
    // page rendered for the about-to-be-signed-out user. Doing a hard
    // `location.assign` tears down every client-side cache so the
    // next user signing in sees their own role and not the previous
    // user's.
    const supabase = getBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  };

  if (className) {
    return (
      <button type="button" onClick={handleClick} className={className}>
        Sign out
      </button>
    );
  }

  if (variant === "header") {
    return (
      <button
        type="button"
        onClick={handleClick}
        style={{
          background: "rgba(255,255,255,.12)",
          border: "1px solid rgba(255,255,255,.25)",
          borderRadius: "var(--pol-radius)",
          color: "#fff",
          fontSize: 12,
          fontWeight: 600,
          padding: "4px 10px",
          height: 26,
          cursor: "pointer",
          fontFamily: "inherit",
        }}
        onMouseEnter={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,.22)";
        }}
        onMouseLeave={(e) => {
          e.currentTarget.style.background = "rgba(255,255,255,.12)";
        }}
      >
        Sign out
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      className="pol-btn pol-btn-secondary"
    >
      Sign out
    </button>
  );
}
