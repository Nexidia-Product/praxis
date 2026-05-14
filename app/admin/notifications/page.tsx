/**
 * Admin → Notifications page (Section 5.12).
 *
 * Surfaces the manual "run sweep now" action so Admins can test the
 * notification system without waiting for the scheduled job. Currently
 * the only control on the page; Future work (per the design doc):
 * org-wide notification defaults, digest-mode toggle, scheduler status.
 */

import {
  getCurrentUserPermissions,
  requirePagePermission,
} from "@/lib/auth/permissions";
import { NotificationsAdmin } from "@/components/admin/notifications-admin";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export default async function NotificationsAdminPage() {
  const session = await requirePagePermission("admin.notifications.run_sweep");
  const { permissions } = await getCurrentUserPermissions();

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="admin-notifications"
      breadcrumbs={[{ label: "Admin" }, { label: "Notifications" }]}
    >
      <PolarisPageHeader
        eyebrow="Administration"
        title="Notifications"
        subtitle="Trigger the daily notification sweep on demand. Use this to validate notification rules without waiting for the scheduled run."
      />
      <NotificationsAdmin />
    </PolarisShell>
  );
}
