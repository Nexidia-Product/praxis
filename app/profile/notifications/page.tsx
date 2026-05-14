/**
 * Profile → Notifications preferences page (Section 5.12).
 *
 * Server component: loads the current user's preferences and
 * digest_mode once, then hands off to the client form component for
 * editing. Any authenticated user can edit their own preferences.
 */

import {
  getCurrentUserPermissions,
  requireSession,
} from "@/lib/auth/permissions";
import { UserRepository } from "@/lib/db";
import type { NotificationDelivery, NotificationType } from "@/lib/db";
import { NotificationPreferencesForm } from "@/components/notifications/preferences-form";
import { PolarisShell, PolarisPageHeader } from "@/components/polaris/Shell";

export const dynamic = "force-dynamic";

const NOTIFICATION_TYPES: NotificationType[] = [
  "TaskAssigned",
  "TaskDueSoon",
  "TaskOverdue",
  "ProjectBlocked",
  "DependencyBlocked",
  "HealthScoreChanged",
  "IdeaStatusChanged",
];

// "Off" is no longer offered — see /api/profile/notifications header.
// Notifications are system signals; users can route email vs. in-app
// but cannot fully suppress them.
const DELIVERY_OPTIONS: NotificationDelivery[] = [
  "InAppOnly",
  "EmailAndInApp",
];

export default async function ProfileNotificationsPage() {
  const session = await requireSession();
  const { permissions } = await getCurrentUserPermissions();
  const user = await UserRepository.getById(session.user.user_id);
  if (!user) {
    return (
      <PolarisShell
        user={{ ...session.user, permissions }}
        navKey="profile-notifications"
        breadcrumbs={[
          { label: "Profile" },
          { label: "Notifications" },
        ]}
      >
        <div className="pol-notice pol-notice-err">
          Your account record could not be loaded. Try signing out and back in.
        </div>
      </PolarisShell>
    );
  }

  return (
    <PolarisShell
      user={{ ...session.user, permissions }}
      navKey="profile-notifications"
      breadcrumbs={[
        { label: "Profile" },
        { label: "Notifications" },
      ]}
    >
      <PolarisPageHeader
        eyebrow="Profile"
        title="Notification preferences"
        subtitle="Choose what comes to your inbox vs. just the in-app bell."
      />
      <NotificationPreferencesForm
        initialPreferences={user.notification_preferences}
        initialDigestMode={user.digest_mode}
        types={NOTIFICATION_TYPES}
        deliveryOptions={DELIVERY_OPTIONS}
      />
    </PolarisShell>
  );
}
