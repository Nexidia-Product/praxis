/**
 * Document-skill repository — CRUD against the `document_skills` table.
 *
 * A "skill" is an authored bundle used by the document generator
 * (lib/ai/documents): instructions, an optional shared product profile,
 * a gold-standard example, an input spec binding Praxis project fields
 * into the prompt, and a section outline. Skills are tuned externally
 * and imported; `version` + `is_active` let a new version supersede the
 * previous one without losing history. At most one active version
 * exists per `key` (enforced by a partial unique index), so `getActive`
 * is the hot path the generator uses.
 */

import type { DocumentSkill } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "document_skills" as const;

export type CreateDocumentSkillInput = Omit<
  DocumentSkill,
  "id" | "created_at" | "updated_at"
>;

export type UpdateDocumentSkillInput = Partial<CreateDocumentSkillInput>;

export const DocumentSkillRepository = {
  /** The active version for a key, or null if none is active. */
  async getActive(key: string): Promise<DocumentSkill | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("key", key)
      .eq("is_active", true)
      .maybeSingle();
    if (error)
      throw new Error(`document_skills.getActive failed: ${error.message}`);
    return (data as DocumentSkill | null) ?? null;
  },

  /** Every skill row, newest version of each key first. */
  async getAll(): Promise<DocumentSkill[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("key", { ascending: true })
      .order("version", { ascending: false });
    if (error)
      throw new Error(`document_skills.getAll failed: ${error.message}`);
    return (data ?? []) as DocumentSkill[];
  },

  async create(input: CreateDocumentSkillInput): Promise<DocumentSkill> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert(input)
      .select()
      .single();
    if (error)
      throw new Error(`document_skills.create failed: ${error.message}`);
    return data as DocumentSkill;
  },

  async update(
    id: string,
    patch: UpdateDocumentSkillInput,
  ): Promise<DocumentSkill> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update({ ...patch, updated_at: new Date().toISOString() })
      .eq("id", id)
      .select()
      .single();
    if (error)
      throw new Error(`document_skills.update failed: ${error.message}`);
    if (!data) throw new Error(`Document skill ${id} not found`);
    return data as DocumentSkill;
  },

  /**
   * Deactivate every active version for a key. Called before publishing
   * a new version so the partial unique index (one active per key) is
   * never violated.
   */
  async deactivate(key: string): Promise<void> {
    const { error } = await getServiceRoleClient()
      .from(TABLE)
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("key", key)
      .eq("is_active", true);
    if (error)
      throw new Error(`document_skills.deactivate failed: ${error.message}`);
  },

  async delete(id: string): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("id", id)
      .select("id");
    if (error)
      throw new Error(`document_skills.delete failed: ${error.message}`);
    if (!data || data.length === 0)
      throw new Error(`Document skill ${id} not found`);
  },
};
