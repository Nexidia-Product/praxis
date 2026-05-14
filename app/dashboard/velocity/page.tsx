/**
 * Velocity & Throughput Dashboard page (Section 5.15).
 *
 * Server component. Resolves the session, then hands user identity and
 * role to the client `VelocityDashboard` which owns filters, fetching,
 * and chart rendering.
 *
 * Authorization: gated by the `velocity.view` permission (granted by
 * default to every authenticated role; tightenable via the matrix).
 * The "individual contributor" view is gated separately at the API
 * route — non-Admins can only request their own user_id (Section 5.15).
 */

import {
  getCurrentUserPermissions,
  requirePermission,
} from "@/lib/auth/permissions";
import { VelocityDashboard } from "@/components/velocity/dashboard";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

export default async function VelocityPage() {
  const session = await requirePermission("velocity.view");
  const { permissions } = await getCurrentUserPermissions();

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="velocity"
      breadcrumbs={[
        { label: "Insights" },
        { label: "Velocity" },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Insights"
        title="Velocity & throughput"
        subtitle="Historical performance: how often projects complete, how long they take, where they get stuck, and how the team's throughput is trending."
      />
      <VelocityDashboard
        currentUserId={session.user.user_id}
        currentUserRole={session.user.role}
      />
    </PolarisShell>
  );
}
