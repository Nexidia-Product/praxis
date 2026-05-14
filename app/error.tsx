"use client";

/**
 * Application-level error boundary (Step 13).
 *
 * Catches unhandled exceptions thrown by any server or client component
 * underneath the root layout (everything except `app/layout.tsx`
 * itself; root-layout failures hit `global-error.tsx`).
 *
 * Renders a calm, branded fallback rather than Next.js's default
 * developer overlay so end users see a recognizable page when
 * something genuinely breaks. The `reset` callback retries the route
 * — useful for transient failures (file-system blip, network).
 *
 * `digest` is the Next.js error fingerprint; we surface it so an
 * operator can correlate user reports with server logs without the
 * user having to copy a stack trace.
 */

import Link from "next/link";
import { useEffect } from "react";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  useEffect(() => {
    // Surface to the server console so operators can match the
    // user-visible digest to a stack trace.
    console.error("[error.tsx]", error);
  }, [error]);

  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "64px 24px 32px",
        fontFamily: "'Open Sans', system-ui, -apple-system, sans-serif",
        color: "var(--t1)",
      }}
    >
      <p className="page-eyebrow">Something went wrong</p>
      <h1 className="page-title" style={{ marginTop: 6 }}>
        We hit an unexpected error.
      </h1>
      <p
        className="page-subtitle"
        style={{ marginTop: 8, lineHeight: 1.55 }}
      >
        The page couldn&rsquo;t finish loading. You can retry — the
        problem is often transient — or head back home.
      </p>

      <div
        className="pol-notice pol-notice-err"
        role="alert"
        style={{ marginTop: 20 }}
      >
        <div>
          <strong>Error:</strong> {error.message || "Unknown error."}
          {error.digest ? (
            <div style={{ marginTop: 4, fontSize: 11, color: "var(--t2)" }}>
              Reference: <span className="mono">{error.digest}</span>
            </div>
          ) : null}
        </div>
      </div>

      <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
        <button
          type="button"
          onClick={() => reset()}
          className="pol-btn pol-btn-primary"
        >
          Try again
        </button>
        <Link href="/" className="pol-btn pol-btn-secondary">
          Back to home
        </Link>
      </div>
    </main>
  );
}
