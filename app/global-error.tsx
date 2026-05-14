"use client";

/**
 * Last-resort error boundary (Step 13).
 *
 * Catches errors thrown in `app/layout.tsx` itself — anything below
 * is handled by `app/error.tsx`. Because this boundary replaces the
 * root layout, it must render its own `<html>` and `<body>`.
 * Stylesheets imported by the application layout aren't available
 * here, so the fallback uses inline styles only.
 */

import { useEffect } from "react";

interface GlobalErrorProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function GlobalError({ error, reset }: GlobalErrorProps) {
  useEffect(() => {
    console.error("[global-error.tsx]", error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          fontFamily: "system-ui, -apple-system, sans-serif",
          background: "#f4f8fa",
          color: "#2e2e2e",
          margin: 0,
          minHeight: "100vh",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <main
          style={{
            maxWidth: 480,
            padding: "32px 24px",
            background: "#ffffff",
            border: "1px solid #e2e6e9",
            borderRadius: 3,
            textAlign: "center",
          }}
        >
          <p
            style={{
              fontSize: 10,
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 1,
              color: "#859ead",
              margin: 0,
            }}
          >
            Application error
          </p>
          <h1
            style={{
              fontSize: 22,
              fontWeight: 700,
              color: "#2e2e2e",
              margin: "8px 0 0",
            }}
          >
            The application failed to start.
          </h1>
          <p
            style={{
              marginTop: 12,
              fontSize: 13,
              lineHeight: 1.5,
              color: "#526b7a",
            }}
          >
            Something went wrong before any of your data could load.
            Try refreshing — the issue is usually transient.
          </p>
          {error.digest ? (
            <p
              style={{
                marginTop: 12,
                fontSize: 11,
                color: "#859ead",
              }}
            >
              Reference:&nbsp;
              <code
                style={{
                  fontFamily: "ui-monospace, SFMono-Regular, monospace",
                  background: "#f4f8fa",
                  padding: "1px 4px",
                  borderRadius: 2,
                }}
              >
                {error.digest}
              </code>
            </p>
          ) : null}
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 20,
              height: 28,
              padding: "0 16px",
              border: "1px solid #007bbd",
              background: "#007bbd",
              color: "#ffffff",
              fontWeight: 600,
              fontSize: 12,
              cursor: "pointer",
              borderRadius: 3,
            }}
          >
            Reload
          </button>
        </main>
      </body>
    </html>
  );
}
