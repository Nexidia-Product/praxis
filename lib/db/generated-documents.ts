/**
 * Generated-document repository — CRUD against `generated_documents`.
 *
 * Each row is a draft (or reviewed / published) document produced by
 * the document generator (lib/ai/documents) from a Praxis project and a
 * document skill. Drafts are saved on generation so a user can edit,
 * regenerate, and later publish; `confluence_page_id` / `confluence_url`
 * are populated once the publish path lands. Deleting a project
 * cascades to its generated documents (FK `on delete cascade`).
 */

import type { GeneratedDocument, ProjectId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "generated_documents" as const;

export type CreateGeneratedDocumentInput = Omit<
  GeneratedDocument,
  "id" | "created_at" | "updated_at"
>;

export type UpdateGeneratedDocumentInput = Partial<
  Omit<
    GeneratedDocument,
    "id" | "project_id" | "created_by" | "created_at" | "updated_at"
  >
>;

export const GeneratedDocumentRepository = {
  async create(
    input: CreateGeneratedDocumentInput,
  ): Promise<GeneratedDocument> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert(input)
      .select()
      .single();
    if (error)
      throw new Error(`generated_documents.create failed: ${error.message}`);
    return data as GeneratedDocument;
  },

  async getById(id: string): Promise<GeneratedDocument | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("id", id)
      .maybeSingle();
    if (error)
      throw new Error(`generated_documents.getById failed: ${error.message}`);
    return (data as GeneratedDocument | null) ?? null;
  },

  /** All documents generated for a project, newest first. */
  async listByProject(projectId: ProjectId): Promise<GeneratedDocument[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("project_id", projectId)
      .order("created_at", { ascending: false });
    if (error)
      throw new Error(
        `generated_documents.listByProject failed: ${error.message}`,
      );
    return (data ?? []) as GeneratedDocument[];
  },

  async update(
    id: string,
    patch: UpdateGeneratedDocumentInput,
  ): Promise<GeneratedDocument> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error)
      throw new Error(`generated_documents.update failed: ${error.message}`);
    if (!data) throw new Error(`Generated document ${id} not found`);
    return data as GeneratedDocument;
  },

  /** Delete every document for a project except the one to keep (approval cleanup). */
  async deleteByProjectExcept(
    projectId: ProjectId,
    keepId: string,
  ): Promise<void> {
    const { error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("project_id", projectId)
      .neq("id", keepId);
    if (error)
      throw new Error(
        `generated_documents.deleteByProjectExcept failed: ${error.message}`,
      );
  },

  async delete(id: string): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("id", id)
      .select("id");
    if (error)
      throw new Error(`generated_documents.delete failed: ${error.message}`);
    if (!data || data.length === 0)
      throw new Error(`Generated document ${id} not found`);
  },
};
