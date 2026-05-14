import type { Metadata } from "next";

import "./globals.css";

/**
 * Root layout.
 *
 * Open Sans is the canonical NICE NIA / QC typeface (per
 * `NIA_Polaris_Vibe_Coding_Master_4.md` §4 + §8). It is loaded via a
 * runtime <link> tag rather than `next/font/google` so the build does
 * not block on a Google Fonts fetch — `next/font` resolves the font
 * subset at build time, which fails in any environment that can't
 * reach `fonts.googleapis.com` (sandboxed CI, private networks, etc.).
 *
 * The runtime link strategy means the browser fetches the font on the
 * first page load. That's fine for an internal enterprise tool where
 * the user is already across the public internet to reach the app,
 * and it keeps the build fully offline-capable.
 *
 * `font-display: swap` is requested so the page renders immediately
 * with the system fallback while the web font streams in.
 */
export const metadata: Metadata = {
  title: "Praxis",
  description:
    "Track, manage, and prioritize innovation projects and tasks for your team.",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin=""
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=Open+Sans:wght@400;500;600;700&display=swap"
        />
      </head>
      <body
        className="min-h-screen antialiased"
        style={{
          fontFamily: "'Open Sans', system-ui, -apple-system, sans-serif",
          background: "var(--bg)",
          color: "var(--t1)",
        }}
      >
        {children}
      </body>
    </html>
  );
}
