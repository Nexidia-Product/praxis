/**
 * Decision Log repository — CRUD against the `decisions` table.
 *
 * Section 4.4 fields, Section 5.11 behavior. Each entry is a record of a
 * significant project-level decision (scope change, priority change, etc).
 * Entries are append-only: once created they MUST NOT be edited, since the
 * log's value is its integrity as a historical record.
 *
 * Accordingly, this repository deliberately does not expose `update`. A
 * `delete` is provided for admin cleanup of mistakenly-added entries (and
 * for tests), but its use should be rare.
 */

import type { DecisionEntryId, DecisionLogEntry, ProjectId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "decisions" as const;

export type CreateDecisionInput = Omit<
  DecisionLogEntry,
  "entry_id" | "created_at"
>;

export const DecisionRepository = {
  async getAll(): Promise<DecisionLogEntry[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*");
    if (error) throw new Error(`decisions.getAll failed: ${error.message}`);
    return (data ?? []) as DecisionLogEntry[];
  },

  async getById(id: DecisionEntryId): Promise<DecisionLogEntry | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("entry_id", id)
      .maybeSingle();
    if (error) throw new Error(`decisions.getById failed: ${error.message}`);
    return (data as DecisionLogEntry | null) ?? null;
  },

  /** All entries for one project, newest first (display order in the UI). */
  async getByProjectId(projectId: ProjectId): Promise<DecisionLogEntry[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("entry_date", { ascending: false });
    if (error)
      throw new Error(`decisions.getByProjectId failed: ${error.message}`);
    return (data ?? []) as DecisionLogEntry[];
  },

  async create(input: CreateDecisionInput): Promise<DecisionLogEntry> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        project_id: input.project_id,
        entry_date: input.entry_date,
        decision_summary: input.decision_summary,
        rationale: input.rationale,
        made_by: input.made_by,
        decision_type: input.decision_type,
      })
      .select()
      .single();
    if (error) throw new Error(`decisions.create failed: ${error.message}`);
    return data as DecisionLogEntry;
  },

  /**
   * Decision log entries are intentionally append-only. There is no
   * `update` method. If a correction is needed, add a new entry that
   * supersedes the original.
   */

  /** Reserved for admin cleanup of mistakenly-added entries. Use sparingly. */
  async delete(id: DecisionEntryId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("entry_id", id)
      .select("entry_id");
    if (error) throw new Error(`decisions.delete failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Decision entry ${id} not found`);
    }
  },
};
