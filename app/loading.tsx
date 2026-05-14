/**
 * Application-level loading skeleton (Step 13).
 *
 * Next.js renders this whenever a server component above it is
 * suspended — typically the first paint of a route while data fetches
 * resolve. The shell already has its own per-page loading patterns
 * (table skeletons, in-flight states), so this is intentionally
 * minimal: a centered status string that matches the rest of the
 * design tokens.
 */

export default function Loading() {
  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: "fixed",
        inset: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg)",
        color: "var(--tm)",
        fontSize: 13,
        fontWeight: 600,
        letterSpacing: 0.2,
      }}
    >
      <span aria-hidden="true">Loading…</span>
      <span className="sr-only">Loading the page, please wait.</span>
    </div>
  );
}
