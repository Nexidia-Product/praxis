/**
 * Branded 404 (Step 13).
 *
 * Replaces Next.js's default text-only 404 with a styled page that
 * matches the rest of the application chrome. We do NOT mount the
 * authenticated `PolarisShell` here because the route is reachable
 * from anywhere — including paths that the user can't authenticate
 * to — and a server-side `auth()` call inside not-found can fail
 * during a 404 evaluation. Rendering a small standalone shell keeps
 * this page resilient regardless of session state.
 */

import Link from "next/link";

export default function NotFound() {
  return (
    <main
      style={{
        maxWidth: 560,
        margin: "0 auto",
        padding: "80px 24px 32px",
        fontFamily: "'Open Sans', system-ui, -apple-system, sans-serif",
        color: "var(--t1)",
      }}
    >
      <p className="page-eyebrow">404</p>
      <h1 className="page-title" style={{ marginTop: 6 }}>
        We couldn&rsquo;t find that page.
      </h1>
      <p
        className="page-subtitle"
        style={{ marginTop: 8, lineHeight: 1.55 }}
      >
        The URL you followed may be out of date, or the project / task
        you&rsquo;re looking for has been removed. Try heading back to
        Home and finding it from the navigation or the search bar.
      </p>

      <div style={{ marginTop: 24, display: "flex", gap: 8 }}>
        <Link href="/" className="pol-btn pol-btn-primary">
          Back to home
        </Link>
        <Link href="/projects" className="pol-btn pol-btn-secondary">
          Open Projects
        </Link>
      </div>
    </main>
  );
}
