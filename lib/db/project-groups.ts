/**
 * Project group repository — CRUD against the `project_groups` table.
 *
 * Groups are symmetric, named clusters of related projects. The
 * source of truth for membership is `member_project_ids` on each
 * group row; the per-project "what groups am I in?" lookup uses a
 * GIN-indexed array containment query (`@>`) so it stays cheap as
 * the group count grows.
 *
 * Cascade behavior on project delete is implemented at the service
 * layer in `lib/projects/service.ts` — the repository layer can't
 * see across entity boundaries, and a Postgres FK constraint can't
 * reach into a text[] column.
 */

import type {
  ProjectGroup,
  ProjectGroupId,
  ProjectId,
} from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "project_groups" as const;

export type CreateProjectGroupInput = Omit<
  ProjectGroup,
  "group_id" | "created_at" | "updated_at"
>;

export type UpdateProjectGroupInput = Partial<
  Omit<ProjectGroup, "group_id" | "created_at" | "updated_at" | "created_by">
>;

export const ProjectGroupRepository = {
  async getAll(): Promise<ProjectGroup[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("created_at", { ascending: false });
    if (error) {
      throw new Error(`project_groups.getAll failed: ${error.message}`);
    }
    return (data ?? []) as ProjectGroup[];
  },

  async getById(id: ProjectGroupId): Promise<ProjectGroup | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("group_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`project_groups.getById failed: ${error.message}`);
    }
    return (data as ProjectGroup | null) ?? null;
  },

  /**
   * Every group that includes the given project in its member list.
   * Uses PostgREST's array-contains operator (`cs.{value}`) which
   * maps to Postgres's `@>` operator and exploits the GIN index.
   */
  async getForProject(projectId: ProjectId): Promise<ProjectGroup[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .contains("member_project_ids", [projectId])
      .order("name", { ascending: true });
    if (error) {
      throw new Error(
        `project_groups.getForProject failed: ${error.message}`,
      );
    }
    return (data ?? []) as ProjectGroup[];
  },

  async create(input: CreateProjectGroupInput): Promise<ProjectGroup> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        name: input.name,
        description: input.description,
        member_project_ids: input.member_project_ids,
        created_by: input.created_by ?? "",
      })
      .select()
      .single();
    if (error) {
      throw new Error(`project_groups.create failed: ${error.message}`);
    }
    return data as ProjectGroup;
  },

  async update(
    id: ProjectGroupId,
    patch: UpdateProjectGroupInput,
  ): Promise<ProjectGroup> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update(patch)
      .eq("group_id", id)
      .select()
      .single();
    if (error) {
      throw new Error(`project_groups.update failed: ${error.message}`);
    }
    if (!data) throw new Error(`Project group ${id} not found`);
    return data as ProjectGroup;
  },

  async delete(id: ProjectGroupId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("group_id", id)
      .select("group_id");
    if (error) {
      throw new Error(`project_groups.delete failed: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error(`Project group ${id} not found`);
    }
  },

  /**
   * Remove a project ID from every group's member list. Called from
   * the project service when a project is deleted, to keep the
   * stored membership arrays from accumulating dangling references.
   *
   * Implemented as a read-modify-write against each affected group
   * (rather than one bulk Postgres `array_remove(...)` update)
   * because PostgREST doesn't expose array mutation primitives,
   * and the number of affected groups is small in practice. If this
   * ever becomes a hot path we can drop down to a stored procedure.
   */
  async pruneProjectFromAll(projectId: ProjectId): Promise<void> {
    const affected = await this.getForProject(projectId);
    for (const group of affected) {
      const next = group.member_project_ids.filter((id) => id !== projectId);
      await this.update(group.group_id, { member_project_ids: next });
    }
  },
};
