/**
 * Use case repository — CRUD against the `use_cases` table.
 *
 * Membership lives on each use case row as `member_project_ids`
 * (GIN-indexed text[]), same shape as project groups. Cascade on
 * project delete is handled in `lib/projects/service.ts`.
 */

import type { ProjectId, UseCase, UseCaseId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "use_cases" as const;

export type CreateUseCaseInput = Omit<
  UseCase,
  "use_case_id" | "created_at" | "updated_at"
>;

export type UpdateUseCaseInput = Partial<
  Omit<UseCase, "use_case_id" | "created_at" | "updated_at" | "created_by">
>;

export const UseCaseRepository = {
  async getAll(): Promise<UseCase[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(`use_cases.getAll failed: ${error.message}`);
    return (data ?? []) as UseCase[];
  },

  async getById(id: UseCaseId): Promise<UseCase | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("use_case_id", id)
      .maybeSingle();
    if (error) throw new Error(`use_cases.getById failed: ${error.message}`);
    return (data as UseCase | null) ?? null;
  },

  /** Every use case that includes the given project (GIN `@>` lookup). */
  async getForProject(projectId: ProjectId): Promise<UseCase[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .contains("member_project_ids", [projectId])
      .order("name", { ascending: true });
    if (error) {
      throw new Error(`use_cases.getForProject failed: ${error.message}`);
    }
    return (data ?? []) as UseCase[];
  },

  async create(input: CreateUseCaseInput): Promise<UseCase> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        name: input.name,
        description: input.description,
        caveats: input.caveats,
        primary_objective: input.primary_objective,
        secondary_objectives: input.secondary_objectives,
        member_project_ids: input.member_project_ids,
        created_by: input.created_by ?? "",
      })
      .select()
      .single();
    if (error) throw new Error(`use_cases.create failed: ${error.message}`);
    return data as UseCase;
  },

  async update(id: UseCaseId, patch: UpdateUseCaseInput): Promise<UseCase> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update(patch)
      .eq("use_case_id", id)
      .select()
      .single();
    if (error) throw new Error(`use_cases.update failed: ${error.message}`);
    if (!data) throw new Error(`Use case ${id} not found`);
    return data as UseCase;
  },

  async delete(id: UseCaseId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("use_case_id", id)
      .select("use_case_id");
    if (error) throw new Error(`use_cases.delete failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Use case ${id} not found`);
    }
  },

  /** Remove a project ID from every use case's member list. */
  async pruneProjectFromAll(projectId: ProjectId): Promise<void> {
    const affected = await this.getForProject(projectId);
    for (const uc of affected) {
      await this.update(uc.use_case_id, {
        member_project_ids: uc.member_project_ids.filter(
          (id) => id !== projectId,
        ),
      });
    }
  },
};
