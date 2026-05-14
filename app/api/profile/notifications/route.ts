/**
 * Per-user notification preferences API (Section 5.12).
 *
 *   GET /api/profile/notifications   Return the current user's per-type
 *                                     preferences and digest_mode flag.
 *   PUT /api/profile/notifications   Replace the preferences and/or
 *                                     digest flag.
 *
 * Preference shape: an object keyed by `NotificationType` with values
 * `"InAppOnly" | "EmailAndInApp"`. Plus a top-level `digest_mode`
 * boolean. Both are optional in the PUT body — a sparse update is
 * allowed and only the keys present are touched.
 *
 * "Off" is a legacy value that may exist in older user records but is
 * no longer settable. The dispatch layer auto-migrates `Off → InAppOnly`
 * on read so users always receive at least the in-app bell entry — a
 * deliberate product decision: notifications are signals the system
 * needs the user to see, not opt-in marketing.
 */

import { NextResponse } from "next/server";

import { requireSession, withAuth } from "@/lib/auth/permissions";
import { UserRepository } from "@/lib/db";
import type {
  NotificationDelivery,
  NotificationPreferences,
  NotificationType,
} from "@/lib/db";
import { updatePreferences } from "@/lib/notifications/service";

const NOTIFICATION_TYPES: NotificationType[] = [
  "TaskAssigned",
  "TaskDueSoon",
  "TaskOverdue",
  "ProjectBlocked",
  "DependencyBlocked",
  "HealthScoreChanged",
  "IdeaStatusChanged",
];

// "Off" is intentionally absent — see the file header. Any record that
// still carries it from a prior version is migrated on read by
// `resolveDelivery` in lib/notifications/service.ts.
const DELIVERY_VALUES: NotificationDelivery[] = [
  "InAppOnly",
  "EmailAndInApp",
];

export const GET = withAuth(async () => {
  const session = await requireSession();
  const user = await UserRepository.getById(session.user.user_id);
  if (!user) {
    return NextResponse.json(
      { error: "User not found." },
      { status: 404 },
    );
  }
  return NextResponse.json({
    preferences: user.notification_preferences,
    digest_mode: user.digest_mode,
    types: NOTIFICATION_TYPES,
    delivery_options: DELIVERY_VALUES,
  });
});

interface PutPayload {
  preferences?: unknown;
  digest_mode?: unknown;
}

export const PUT = withAuth(async (request: Request) => {
  const session = await requireSession();
  let body: PutPayload;
  try {
    body = (await request.json()) as PutPayload;
  } catch {
    return NextResponse.json(
      { error: "Request body must be JSON." },
      { status: 400 },
    );
  }

  const patch: Partial<NotificationPreferences> = {};
  if (body.preferences !== undefined) {
    if (typeof body.preferences !== "object" || body.preferences === null || Array.isArray(body.preferences)) {
      return NextResponse.json(
        { error: "preferences must be an object." },
        { status: 400 },
      );
    }
    for (const [key, value] of Object.entries(body.preferences as Record<string, unknown>)) {
      if (!NOTIFICATION_TYPES.includes(key as NotificationType)) {
        return NextResponse.json(
          { error: `Unknown notification type: ${key}.` },
          { status: 400 },
        );
      }
      if (
        typeof value !== "string" ||
        !DELIVERY_VALUES.includes(value as NotificationDelivery)
      ) {
        return NextResponse.json(
          {
            error: `Invalid delivery for ${key}: must be one of ${DELIVERY_VALUES.join(", ")}.`,
          },
          { status: 400 },
        );
      }
      patch[key as NotificationType] = value as NotificationDelivery;
    }
  }

  let digestMode: boolean | undefined;
  if (body.digest_mode !== undefined) {
    if (typeof body.digest_mode !== "boolean") {
      return NextResponse.json(
        { error: "digest_mode must be a boolean." },
        { status: 400 },
      );
    }
    digestMode = body.digest_mode;
  }

  const result = await updatePreferences(
    session.user.user_id,
    patch,
    digestMode,
  );
  return NextResponse.json(result);
});
