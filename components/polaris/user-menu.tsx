"use client";

/**
 * Header user menu — avatar + name as a dropdown trigger.
 *
 * Replaces the previous inline avatar/name/role/sign-out cluster in the
 * header with a single click-to-open menu. The menu contains:
 *   - Notification preferences  → `/profile/notifications`
 *   - Sign out
 *
 * Why a dropdown rather than top-level header links? Personal items
 * (preferences, account, sign-out) are universally clustered behind a
 * user avatar in modern apps; users look there before they look in the
 * left rail. The sign-out button used to live next to the avatar
 * already; this just tucks it into the same affordance and adds the
 * preferences entry next to it — which solves NOTIF-08 / NOTIF-09's
 * discoverability gap (the page existed but was reachable only via a
 * tiny "Settings" link inside the notification bell).
 *
 * Accessibility notes:
 *   - Trigger has aria-haspopup="menu" and aria-expanded toggling.
 *   - Menu items are <a> + <button> with role="menuitem".
 *   - Escape closes; click-outside closes.
 *   - The trigger is the only focusable element when closed; the menu
 *     items become focusable when open.
 */

import { useEffect, useRef, useState } from "react";
import Link from "next/link";

import { getBrowserClient } from "@/lib/supabase/client";

interface UserMenuProps {
  user: {
    name?: string | null;
    email?: string | null;
    role: "Admin" | "Project Lead" | "Team Member" | "Viewer";
  };
}

export function UserMenu({ user }: UserMenuProps) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);

  // Close on click-outside. We listen on mousedown rather than click so
  // a click on a menu item doesn't first close the menu and lose its
  // own click target.
  useEffect(() => {
    if (!open) return;
    function handler(e: MouseEvent) {
      if (!containerRef.current) return;
      if (!containerRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) return;
    function handler(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [open]);

  const initials =
    (user.name ?? user.email ?? "?")
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("") || "·";

  async function handleSignOut() {
    setOpen(false);
    // AUTH-01: hard navigation after sign-out so the next user can't
    // see a cached copy of the previous user's RSC. The Supabase
    // browser client clears the session cookies on signOut.
    const supabase = getBrowserClient();
    await supabase.auth.signOut();
    window.location.assign("/login");
  }

  return (
    <div ref={containerRef} style={{ position: "relative" }}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Open user menu"
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          padding: "2px 8px 2px 2px",
          height: 30,
          borderRadius: "var(--pol-radius)",
          background: open ? "rgba(255,255,255,.18)" : "transparent",
          border: `1px solid ${open ? "rgba(255,255,255,.3)" : "transparent"}`,
          color: "rgba(255,255,255,.95)",
          fontSize: 12,
          cursor: "pointer",
          fontFamily: "inherit",
          transition: "background 0.12s ease, border-color 0.12s ease",
        }}
        onMouseEnter={(e) => {
          if (!open) e.currentTarget.style.background = "rgba(255,255,255,.10)";
        }}
        onMouseLeave={(e) => {
          if (!open) e.currentTarget.style.background = "transparent";
        }}
      >
        <div
          aria-hidden="true"
          style={{
            width: 26,
            height: 26,
            borderRadius: "50%",
            background: "rgba(255,255,255,.25)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontSize: 11,
            fontWeight: 700,
            color: "#fff",
          }}
        >
          {initials}
        </div>
        <span style={{ fontWeight: 500 }}>
          {user.name ?? user.email ?? "User"}
        </span>
        <span
          style={{
            fontSize: 10,
            color: "rgba(255,255,255,.7)",
            marginLeft: 2,
            padding: "1px 5px",
            borderRadius: 2,
            background: "rgba(255,255,255,.1)",
            fontWeight: 600,
            letterSpacing: 0.4,
            textTransform: "uppercase",
          }}
        >
          {user.role}
        </span>
        <svg
          aria-hidden="true"
          width="10"
          height="10"
          viewBox="0 0 10 10"
          style={{
            marginLeft: 2,
            opacity: 0.85,
            transform: open ? "rotate(180deg)" : "none",
            transition: "transform 0.15s ease",
          }}
        >
          <path d="M2 4 L5 7 L8 4" stroke="currentColor" strokeWidth="1.4" fill="none" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {open ? (
        <div
          role="menu"
          style={{
            position: "absolute",
            top: "calc(100% + 4px)",
            right: 0,
            minWidth: 240,
            background: "var(--card)",
            border: "1px solid var(--border)",
            borderRadius: "var(--pol-radius)",
            boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
            zIndex: 200,
            padding: "4px 0",
            color: "var(--t1)",
          }}
        >
          {/* User identity row — non-interactive header inside the menu
              that confirms whose account is signed in. Helpful when
              switching between accounts. */}
          <div
            style={{
              padding: "8px 12px",
              borderBottom: "1px solid var(--border)",
              fontSize: 11,
              color: "var(--tm)",
            }}
          >
            <div style={{ fontWeight: 600, color: "var(--t1)", fontSize: 12 }}>
              {user.name ?? "Unnamed user"}
            </div>
            <div style={{ marginTop: 1 }}>{user.email ?? "—"}</div>
          </div>

          <Link
            href="/profile/notifications"
            role="menuitem"
            onClick={() => setOpen(false)}
            style={{
              display: "block",
              padding: "8px 12px",
              fontSize: 13,
              color: "var(--t1)",
              textDecoration: "none",
              cursor: "pointer",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Notification preferences
          </Link>

          <div
            style={{
              borderTop: "1px solid var(--border)",
              margin: "4px 0",
            }}
          />

          <button
            type="button"
            role="menuitem"
            onClick={handleSignOut}
            style={{
              display: "block",
              width: "100%",
              textAlign: "left",
              padding: "8px 12px",
              fontSize: 13,
              color: "var(--t1)",
              background: "transparent",
              border: "none",
              cursor: "pointer",
              fontFamily: "inherit",
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.background = "var(--hover)";
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.background = "transparent";
            }}
          >
            Sign out
          </button>
        </div>
      ) : null}
    </div>
  );
}
