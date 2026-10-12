/**
 * NiCE product repository — CRUD against the `nice_products` table.
 * No delete: products are retired with `deprecated` instead, so existing
 * use case / project alignments never dangle.
 */

import type { NiceProduct, NiceProductId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "nice_products" as const;

export type CreateNiceProductInput = Pick<NiceProduct, "name" | "description"> &
  Partial<Pick<NiceProduct, "deprecated">>;

export type UpdateNiceProductInput = Partial<
  Pick<NiceProduct, "name" | "description" | "deprecated">
>;

export const NiceProductRepository = {
  async getAll(): Promise<NiceProduct[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(`nice_products.getAll failed: ${error.message}`);
    return (data ?? []) as NiceProduct[];
  },

  async getById(id: NiceProductId): Promise<NiceProduct | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("product_id", id)
      .maybeSingle();
    if (error) throw new Error(`nice_products.getById failed: ${error.message}`);
    return (data as NiceProduct | null) ?? null;
  },

  async create(input: CreateNiceProductInput): Promise<NiceProduct> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert({
        name: input.name,
        description: input.description,
        deprecated: input.deprecated ?? false,
      })
      .select()
      .single();
    if (error) throw new Error(`nice_products.create failed: ${error.message}`);
    return data as NiceProduct;
  },

  async update(
    id: NiceProductId,
    patch: UpdateNiceProductInput,
  ): Promise<NiceProduct> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update(patch)
      .eq("product_id", id)
      .select()
      .single();
    if (error) throw new Error(`nice_products.update failed: ${error.message}`);
    if (!data) throw new Error(`NiCE product ${id} not found`);
    return data as NiceProduct;
  },
};
