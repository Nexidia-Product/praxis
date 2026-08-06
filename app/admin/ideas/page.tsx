/**
 * Ideas review queue (Section 5.18).
 *
 * Server component: loads the full idea list once and hands it to the
 * client component for filtering and inline interactions. Subsequent
 * state (after status changes, conversions) is managed locally in the
 * client.
 *
 * Gated by `ideas.view` OR `ideas.review`. `ideas.review` (Admin,
 * Project Lead by default) grants the reviewer action controls;
 * `ideas.view` (also Viewer by default) grants read-only access so a
 * read-only role can see the queue without acting on it. Both are
 * reassignable via the Roles & permissions matrix. Anyone with neither
 * is redirected to /403.
 */

import Link from "next/link";

import { auth } from "@/auth";
import {
  getCurrentUserPermissions,
  requireAnyPagePermission,
} from "@/lib/auth/permissions";
import { listIdeas } from "@/lib/ideas/service";
import { IdeasReviewTable } from "@/components/ideas/review-table";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function AdminIdeasPage() {
  await requireAnyPagePermission(["ideas.view", "ideas.review"]);
  const session = await auth();
  if (!session?.user) return null;
  const { permissions } = await getCurrentUserPermissions();
  const canReview = permissions["ideas.review"] === true;

  const ideas = await listIdeas();

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="ideas"
      breadcrumbs={[
        { label: "Insights" },
        { label: "Ideas" },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title={canReview ? "Ideas review" : "Ideas"}
        subtitle={
          canReview
            ? "Submitted ideas from the public portal. Review, approve, reject, or convert to a project."
            : "Submitted ideas from the public portal, shown read-only."
        }
      />

      <div
        className="pol-notice pol-notice-info"
        style={{ marginBottom: 12 }}
      >
        <span aria-hidden="true">ℹ</span>
        <span>
          Public submission portal:{" "}
          <Link
            href="/submit"
            className="mono"
            style={{
              padding: "1px 6px",
              borderRadius: 2,
              background: "rgba(255,255,255,.5)",
              color: "var(--brand-dark)",
              textDecoration: "none",
            }}
          >
            /submit
          </Link>{" "}
          — share the link with stakeholders so they can submit ideas without
          an account.
        </span>
      </div>

      <IdeasReviewTable initialIdeas={ideas} canReview={canReview} />
    </PolarisShell>
  );
}
