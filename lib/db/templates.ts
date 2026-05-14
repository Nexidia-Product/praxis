/**
 * Task template repository — CRUD against the `templates` table.
 *
 * Section 4.3 fields. Templates are bundles of standard tasks created by
 * admins (Section 5.19) and offered when a new project of a matching
 * `project_type` is created (Section 9, Step 4). Instantiating a template
 * generates fresh `task_id`s — the templates themselves do not allocate
 * task IDs in advance.
 */

import type { ProjectType, TaskTemplate, TemplateId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "templates" as const;

export type CreateTemplateInput = Omit<TaskTemplate, "template_id">;

export type UpdateTemplateInput = Partial<Omit<TaskTemplate, "template_id">>;

export const TemplateRepository = {
  async getAll(): Promise<TaskTemplate[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*");
    if (error) throw new Error(`templates.getAll failed: ${error.message}`);
    return (data ?? []) as TaskTemplate[];
  },

  async getById(id: TemplateId): Promise<TaskTemplate | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("template_id", id)
      .maybeSingle();
    if (error) throw new Error(`templates.getById failed: ${error.message}`);
    return (data as TaskTemplate | null) ?? null;
  },

  /** All templates that can be applied to a given project type. */
  async getByProjectType(projectType: ProjectType): Promise<TaskTemplate[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("project_type", projectType);
    if (error)
      throw new Error(`templates.getByProjectType failed: ${error.message}`);
    return (data ?? []) as TaskTemplate[];
  },

  async create(input: CreateTemplateInput): Promise<TaskTemplate> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        template_name: input.template_name,
        project_type: input.project_type,
        tasks: input.tasks,
        created_by: input.created_by,
      })
      .select()
      .single();
    if (error) throw new Error(`templates.create failed: ${error.message}`);
    return data as TaskTemplate;
  },

  async update(
    id: TemplateId,
    patch: UpdateTemplateInput,
  ): Promise<TaskTemplate> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update(patch)
      .eq("template_id", id)
      .select()
      .single();
    if (error) throw new Error(`templates.update failed: ${error.message}`);
    if (!data) throw new Error(`Template ${id} not found`);
    return data as TaskTemplate;
  },

  async delete(id: TemplateId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("template_id", id)
      .select("template_id");
    if (error) throw new Error(`templates.delete failed: ${error.message}`);
    if (!data || data.length === 0) {
      throw new Error(`Template ${id} not found`);
    }
  },
};
