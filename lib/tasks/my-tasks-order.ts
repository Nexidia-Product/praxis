/**
 * Per-user manual ordering for the My Tasks "Checklist" view.
 *
 * Stored in `users.ui_preferences.my_tasks_order` (jsonb) — see
 * `UserUIPreferences` in lib/db/types.ts. This module is the single place
 * that reads/writes that slice, mirroring the notification-preferences
 * service so the persistence pattern stays consistent.
 *
 * The order is just an array of task IDs. We don't validate the IDs
 * against live tasks here: the client sends the order of the tasks it
 * currently shows (already pruned to the user's open tasks), and the My
 * Tasks page reconciles on read (unknown IDs ignored, missing tasks
 * appended). Keeping this layer dumb avoids a tasks round-trip on every
 * save.
 */

import { UserRepository } from "@/lib/db";
import type { TaskId, UserId, UserUIPreferences } from "@/lib/db";

export async function getMyTasksOrder(userId: UserId): Promise<TaskId[]> {
  const user = await UserRepository.getById(userId);
  if (!user) throw new Error("User not found");
  return user.ui_preferences?.my_tasks_order ?? [];
}

export async function setMyTasksOrder(
  userId: UserId,
  order: TaskId[],
): Promise<TaskId[]> {
  const user = await UserRepository.getById(userId);
  if (!user) throw new Error("User not found");

  const next: UserUIPreferences = {
    ...(user.ui_preferences ?? {}),
    my_tasks_order: order,
  };
  const updated = await UserRepository.update(userId, {
    ui_preferences: next,
  });
  return updated.ui_preferences?.my_tasks_order ?? order;
}
