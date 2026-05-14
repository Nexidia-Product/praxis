/**
 * Public idea submission portal (Section 5.17).
 *
 * Public route — no authentication required. Allow-listed in
 * `middleware.ts` via an exact match on `/submit`. Wrapped in
 * `PublicChrome` (slim brand bar + centered column) rather than the
 * full authenticated shell so it stays the kind of single-purpose
 * landing page a stakeholder can complete in 90 seconds without
 * navigation distractions.
 *
 * Server component renders the static layout; the form itself is a
 * client component because it owns the success/error state and the
 * post-submit confirmation view.
 */

import Link from "next/link";

import { IdeaSubmitForm } from "@/components/ideas/submit-form";
import { PublicChrome } from "@/components/polaris/PublicChrome";

export const dynamic = "force-dynamic";

export default function SubmitPage() {
  return (
    <PublicChrome width="narrow">
      <div style={{ marginBottom: 20 }}>
        <p className="page-eyebrow">Innovation portal</p>
        <h1 className="page-title" style={{ marginTop: 6 }}>
          Submit an idea
        </h1>
        <p className="page-subtitle" style={{ marginTop: 8, lineHeight: 1.55 }}>
          Tell us about an opportunity, problem worth solving, or improvement
          to an existing application. Anyone can submit &mdash; the team will
          review and respond. You don&rsquo;t need an account.
        </p>
      </div>

      <div className="pol-card pol-card-pad">
        <IdeaSubmitForm />
      </div>

      <p
        style={{
          marginTop: 16,
          paddingTop: 12,
          borderTop: "1px solid var(--border)",
          fontSize: 11,
          color: "var(--tm)",
        }}
      >
        Have an account?{" "}
        <Link
          href="/login"
          style={{
            color: "var(--brand)",
            textDecoration: "none",
            fontWeight: 600,
          }}
        >
          Sign in
        </Link>{" "}
        to manage projects and review submitted ideas.
      </p>
    </PublicChrome>
  );
}
