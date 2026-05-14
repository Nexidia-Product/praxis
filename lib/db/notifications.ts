/**
 * Notification repository — CRUD against the `notifications` table.
 *
 * Section 4.5 fields, Section 5.12 triggers. Notifications are written
 * by the service-layer helper (`lib/notifications.ts`) on relevant
 * events: task assignment, task due-soon, project blocked, etc.
 *
 * Reads default to newest-first because the bell drawer and the in-app
 * list always want recency. The 90-day purge job (`deleteReadOlderThan`)
 * is called from the daily scheduler sweep.
 */

import type { Notification, NotificationId, UserId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "notifications" as const;

export type CreateNotificationInput = Omit<
  Notification,
  "notification_id" | "read" | "created_at"
> &
  Partial<Pick<Notification, "read">>;

export type UpdateNotificationInput = Partial<
  Omit<Notification, "notification_id" | "created_at">
>;

export const NotificationRepository = {
  async getAll(): Promise<Notification[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) throw new Error(`notifications.getAll failed: ${error.message}`);
    return (data ?? []) as Notification[];
  },

  async getById(id: NotificationId): Promise<Notification | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("notification_id", id)
      .maybeSingle();
    if (error) throw new Error(`notifications.getById failed: ${error.message}`);
    return (data as Notification | null) ?? null;
  },

  /** All notifications for one user, newest first. */
  async getByUserId(userId: UserId): Promise<Notification[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .order("created_at", { ascending: false });
    if (error)
      throw new Error(`notifications.getByUserId failed: ${error.message}`);
    return (data ?? []) as Notification[];
  },

  async getUnreadByUserId(userId: UserId): Promise<Notification[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("user_id", userId)
      .eq("read", false)
      .order("created_at", { ascending: false });
    if (error)
      throw new Error(`notifications.getUnreadByUserId failed: ${error.message}`);
    return (data ?? []) as Notification[];
  },

  async create(input: CreateNotificationInput): Promise<Notification> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        user_id: input.user_id,
        type: input.type,
        message: input.message,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        read: input.read ?? false,
      })
      .select()
      .single();
    if (error) throw new Error(`notifications.create failed: ${error.message}`);
    return data as Notification;
  },

  async update(
    id: NotificationId,
    patch: UpdateNotificationInput,
  ): Promise<Notification> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update(patch)
      .eq("notification_id", id)
      .select()
      .single();
    if (error) throw new Error(`notifications.update failed: ${error.message}`);
    if (!data) throw new Error(`Notification ${id} not found`);
    return data as Notification;
  },

  /** Convenience for the bell-icon click handler. */
  async markRead(id: NotificationId): Promise<Notification> {
    return this.update(id, { read: true });
  },

  async delete(id: NotificationId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("notification_id", id)
      .select("notification_id");
    if (error) throw new Error(`notifications.delete failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Notification ${id} not found`);
    }
  },

  /**
   * Bulk delete used by the daily purge job to remove read notifications
   * older than the cutoff (Appendix A: 90 days). Returns the count
   * deleted.
   */
  async deleteReadOlderThan(cutoff: string): Promise<number> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("read", true)
      .lt("created_at", cutoff)
      .select("notification_id");
    if (error)
      throw new Error(`notifications.deleteReadOlderThan failed: ${error.message}`);
    return data?.length ?? 0;
  },
};
