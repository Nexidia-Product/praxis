/**
 * Release caveat repository — CRUD against the `release_caveats` table.
 * See supabase/migrations/0037_release_caveats.sql.
 */

import type { IsoDate, ReleaseCaveat, ReleaseCaveatId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "release_caveats" as const;

export type CreateReleaseCaveatInput = Omit<
  ReleaseCaveat,
  "caveat_id" | "created_at" | "updated_at"
>;

export const ReleaseCaveatRepository = {
  /** Every caveat recorded against one release, oldest first. */
  async getForRelease(releaseDate: IsoDate): Promise<ReleaseCaveat[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("release_date", releaseDate)
      .order("created_at", { ascending: true });
    if (error) {
      throw new Error(`release_caveats.getForRelease failed: ${error.message}`);
    }
    return (data ?? []) as ReleaseCaveat[];
  },

  async getById(id: ReleaseCaveatId): Promise<ReleaseCaveat | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("caveat_id", id)
      .maybeSingle();
    if (error) {
      throw new Error(`release_caveats.getById failed: ${error.message}`);
    }
    return (data as ReleaseCaveat | null) ?? null;
  },

  async create(input: CreateReleaseCaveatInput): Promise<ReleaseCaveat> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert(input)
      .select()
      .single();
    if (error) {
      throw new Error(`release_caveats.create failed: ${error.message}`);
    }
    return data as ReleaseCaveat;
  },

  async update(id: ReleaseCaveatId, caveat: string): Promise<ReleaseCaveat> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update({ caveat })
      .eq("caveat_id", id)
      .select()
      .single();
    if (error) {
      throw new Error(`release_caveats.update failed: ${error.message}`);
    }
    if (!data) throw new Error(`Release caveat ${id} not found`);
    return data as ReleaseCaveat;
  },

  async delete(id: ReleaseCaveatId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("caveat_id", id)
      .select("caveat_id");
    if (error) {
      throw new Error(`release_caveats.delete failed: ${error.message}`);
    }
    if (!data || data.length === 0) {
      throw new Error(`Release caveat ${id} not found`);
    }
  },
};
