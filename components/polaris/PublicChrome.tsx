/**
 * Public-page chrome.
 *
 * Used by `/login`, `/submit`, and `/invite/[token]` — pages that the
 * authenticated shell does not wrap. Ties the public pages visually to
 * the rest of the application without dragging the full nav rail along
 * for the ride. Provides the same 40px branded header bar from the
 * shell, then a centered content column over the same paper-tone page
 * background.
 *
 * `width` controls the centered column ("narrow" for forms, "default"
 * for everything else). The shell never uses this — it has its own
 * header.
 */

import Link from "next/link";

interface PublicChromeProps {
  width?: "narrow" | "default";
  children: React.ReactNode;
}

export function PublicChrome({ width = "default", children }: PublicChromeProps) {
  const maxW = width === "narrow" ? 560 : 720;
  return (
    <div
      style={{
        minHeight: "100vh",
        display: "flex",
        flexDirection: "column",
        background: "var(--bg)",
      }}
    >
      <header
        style={{
          height: "var(--header-h)",
          background: "var(--header)",
          display: "flex",
          alignItems: "center",
          padding: "0 16px",
          flexShrink: 0,
        }}
      >
        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            color: "#fff",
            fontSize: 13,
            fontWeight: 700,
            letterSpacing: 0.5,
            textDecoration: "none",
          }}
        >
          <span
            style={{
              background: "rgba(255,255,255,.15)",
              border: "1px solid rgba(255,255,255,.25)",
              borderRadius: 2,
              padding: "1px 6px",
              fontSize: 10,
              fontWeight: 700,
              letterSpacing: 1,
            }}
          >
            PRAXIS
          </span>
          <span>Praxis</span>
        </Link>
      </header>

      <main
        style={{
          flex: 1,
          display: "flex",
          alignItems: "flex-start",
          justifyContent: "center",
          padding: "48px 16px",
        }}
      >
        <div style={{ width: "100%", maxWidth: maxW }}>{children}</div>
      </main>

      <footer
        style={{
          padding: "16px",
          textAlign: "center",
          fontSize: 11,
          color: "var(--tm)",
          borderTop: "1px solid var(--border)",
          background: "var(--card)",
        }}
      >
        Praxis
      </footer>
    </div>
  );
}
