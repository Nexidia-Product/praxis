/**
 * Audit log repository — append-only against the `audit_log` table.
 *
 * Backs the Admin → Audit Log page (Step 13 of the design document,
 * Section 5.19). `record()` is the only mutating call exposed; the
 * page reads newest-first via `getRecent`.
 */

import type { AuditEntryId, AuditLogEntry } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "audit_log" as const;

export type CreateAuditEntryInput = Omit<
  AuditLogEntry,
  "entry_id" | "occurred_at"
>;

export interface RecentAuditQuery {
  limit?: number;
  /** Filter by exactly one entity type. Omit for all. */
  entity_type?: AuditLogEntry["entity_type"];
  /** Filter by action verb. Omit for all. */
  action?: AuditLogEntry["action"];
  /**
   * Filter by actor user ID. Use `null` to find system-driven entries
   * (cron sweeps, public submissions). Omit to skip the filter
   * entirely.
   */
  actor_id?: AuditLogEntry["actor_id"];
  /**
   * Free-text search applied to entity_label and summary only.
   * Lowercased substring match — same convention as the global search.
   */
  q?: string;
}

export const AuditLogRepository = {
  async getAll(): Promise<AuditLogEntry[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("occurred_at", { ascending: false });
    if (error) throw new Error(`audit_log.getAll failed: ${error.message}`);
    return (data ?? []) as AuditLogEntry[];
  },

  /**
   * Newest-first slice with optional filters. The audit log is the
   * primary read path, so we default to a sensible cap (200) — the
   * admin page paginates above that.
   */
  async getRecent(query: RecentAuditQuery = {}): Promise<AuditLogEntry[]> {
    const limit = Math.max(1, Math.min(query.limit ?? 200, 1000));

    let q = getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("occurred_at", { ascending: false })
      .limit(limit);

    if (query.entity_type) q = q.eq("entity_type", query.entity_type);
    if (query.action) q = q.eq("action", query.action);
    if (query.actor_id !== undefined) {
      // `null` matches NULL rows; otherwise exact match. PostgREST's
      // `.is()` is the right operator for NULL.
      q =
        query.actor_id === null
          ? q.is("actor_id", null)
          : q.eq("actor_id", query.actor_id);
    }
    if (query.q && query.q.trim()) {
      // Substring match across entity_label OR summary. PostgREST `or`
      // expects a comma-separated filter list. We escape commas in the
      // search term so they don't terminate the filter expression.
      const needle = query.q.trim().replace(/[%,]/g, " ");
      q = q.or(
        `entity_label.ilike.%${needle}%,summary.ilike.%${needle}%`,
      );
    }

    const { data, error } = await q;
    if (error) throw new Error(`audit_log.getRecent failed: ${error.message}`);
    return (data ?? []) as AuditLogEntry[];
  },

  async getById(id: AuditEntryId): Promise<AuditLogEntry | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("entry_id", id)
      .maybeSingle();
    if (error) throw new Error(`audit_log.getById failed: ${error.message}`);
    return (data as AuditLogEntry | null) ?? null;
  },

  async record(input: CreateAuditEntryInput): Promise<AuditLogEntry> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        actor_id: input.actor_id,
        actor_name: input.actor_name,
        entity_type: input.entity_type,
        entity_id: input.entity_id,
        entity_label: input.entity_label,
        action: input.action,
        summary: input.summary,
      })
      .select()
      .single();
    if (error) throw new Error(`audit_log.record failed: ${error.message}`);
    return data as AuditLogEntry;
  },
};
