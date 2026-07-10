/**
 * Project finding-summary repository — the single persisted summary per
 * project (Insights → Key findings). One row per project, keyed by
 * project_id; `upsert` overwrites on regenerate.
 */

import type { ProjectFindingSummary, ProjectId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "project_finding_summaries" as const;

export type UpsertProjectFindingSummaryInput = Omit<
  ProjectFindingSummary,
  "created_at" | "updated_at"
>;

export const ProjectFindingSummaryRepository = {
  async getByProject(
    projectId: ProjectId,
  ): Promise<ProjectFindingSummary | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .maybeSingle();
    if (error)
      throw new Error(
        `project_finding_summaries.getByProject failed: ${error.message}`,
      );
    return (data as ProjectFindingSummary | null) ?? null;
  },

  /** Insert or replace the summary for a project. */
  async upsert(
    input: UpsertProjectFindingSummaryInput,
  ): Promise<ProjectFindingSummary> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .upsert(
        { ...input, updated_at: new Date().toISOString() },
        { onConflict: "project_id" },
      )
      .select()
      .single();
    if (error)
      throw new Error(
        `project_finding_summaries.upsert failed: ${error.message}`,
      );
    return data as ProjectFindingSummary;
  },

  async deleteByProject(projectId: ProjectId): Promise<void> {
    const { error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("project_id", projectId);
    if (error)
      throw new Error(
        `project_finding_summaries.deleteByProject failed: ${error.message}`,
      );
  },
};
