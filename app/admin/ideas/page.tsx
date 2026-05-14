/**
 * Ideas review queue (Section 5.18).
 *
 * Server component: loads the full idea list once and hands it to the
 * client component for filtering and inline interactions. Subsequent
 * state (after status changes, conversions) is managed locally in the
 * client.
 *
 * Gated by the `ideas.review` permission — granted by default to Admin
 * and Project Lead, but reassignable via the Roles & permissions
 * matrix. Anyone without the permission gets a 403 from the
 * server-component error boundary.
 */

import Link from "next/link";

import { auth } from "@/auth";
import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import { listIdeas } from "@/lib/ideas/service";
import { IdeasReviewTable } from "@/components/ideas/review-table";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function AdminIdeasPage() {
  await requirePagePermission("ideas.review");
  const session = await auth();
  if (!session?.user) return null;
  const { permissions } = await getCurrentUserPermissions();

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
        title="Ideas review"
        subtitle="Submitted ideas from the public portal. Review, approve, reject, or convert to a project."
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

      <IdeasReviewTable initialIdeas={ideas} />
    </PolarisShell>
  );
}
