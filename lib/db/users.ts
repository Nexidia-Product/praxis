/**
 * User repository — CRUD against the `users` table.
 *
 * Section 4.7 fields, post-Stage-2 shape. Identity (email/password/
 * invite/recovery tokens) is owned by Supabase Auth; this table
 * mirrors the application-level profile keyed by `user_id =
 * auth.users.id`.
 *
 * Standard admin practice is to DEACTIVATE accounts
 * (`update(id, { active: false })`) rather than delete them, since
 * user IDs are referenced by `created_by`, `responsible`,
 * `project_lead`, etc. on other records.
 *
 * `PublicUser` and `User` are now the same shape (Stage 4 dropped
 * the secret columns from the schema). The two type aliases are kept
 * separate at call sites so the intent — "this is OK to send to the
 * UI" — stays explicit.
 */

import type { PublicUser, User, UserId } from "./types";
import { getServiceRoleClient } from "@/lib/supabase/server";

const TABLE = "users" as const;

export type CreateUserInput = Omit<User, "user_id" | "created_at" | "updated_at"> & {
  /**
   * Optional explicit ID. Passed by the admin invite path so the
   * profile's primary key matches the `auth.users` row Supabase Auth
   * created moments earlier.
   */
  user_id?: UserId;
};

export type UpdateUserInput = Partial<Omit<User, "user_id" | "created_at">>;

export const UserRepository = {
  // ---- Reads -----------------------------------------------------------------

  async getAll(): Promise<User[]> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .order("name", { ascending: true });
    if (error) throw new Error(`users.getAll failed: ${error.message}`);
    return (data ?? []) as User[];
  },

  async getById(id: UserId): Promise<User | null> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("user_id", id)
      .maybeSingle();
    if (error) throw new Error(`users.getById failed: ${error.message}`);
    return (data as User | null) ?? null;
  },

  async getByEmail(email: string): Promise<User | null> {
    const normalized = email.trim().toLowerCase();
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .eq("email", normalized)
      .maybeSingle();
    if (error) throw new Error(`users.getByEmail failed: ${error.message}`);
    return (data as User | null) ?? null;
  },

  /**
   * Look up a user by their display name. Used to resolve legacy
   * spreadsheet-seed data where `task.responsible` and
   * `project.project_lead` store free-form names like "Savannah"
   * rather than user_ids. Case-insensitive, exact match.
   *
   * Returns the first active user whose name matches; falls back to
   * an inactive match if no active user has that name.
   */
  async getByName(name: string): Promise<User | null> {
    const target = name.trim();
    if (!target) return null;
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .select("*")
      .ilike("name", target)
      .order("active", { ascending: false });
    if (error) throw new Error(`users.getByName failed: ${error.message}`);
    if (!data || data.length === 0) return null;
    return data[0] as User;
  },

  // `PublicUser` is now structurally identical to `User`. The helpers
  // are retained as call-site documentation: when you write
  // `getAllPublic()`, you're signalling "this set is safe to render
  // in the UI". When the schema diverges again, the type aliases
  // give us a place to add stripping logic without touching callers.

  async getAllPublic(): Promise<PublicUser[]> {
    return this.getAll();
  },

  async getByIdPublic(id: UserId): Promise<PublicUser | null> {
    return this.getById(id);
  },

  // ---- Writes ----------------------------------------------------------------

  async create(input: CreateUserInput): Promise<User> {
    const payload: Record<string, unknown> = {
      email: input.email.trim().toLowerCase(),
      name: input.name,
      role: input.role,
      active: input.active,
      notification_preferences: input.notification_preferences,
      digest_mode: input.digest_mode,
    };
    if (input.user_id) payload.user_id = input.user_id;

    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .insert(payload)
      .select()
      .single();
    if (error) throw new Error(`users.create failed: ${error.message}`);
    return data as User;
  },

  async update(id: UserId, patch: UpdateUserInput): Promise<User> {
    const normalized: UpdateUserInput = { ...patch };
    if (patch.email !== undefined) {
      normalized.email = patch.email.trim().toLowerCase();
    }
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .update(normalized)
      .eq("user_id", id)
      .select()
      .single();
    if (error) throw new Error(`users.update failed: ${error.message}`);
    if (!data) throw new Error(`User ${id} not found`);
    return data as User;
  },

  /**
   * Permanently remove a user record. Prefer
   * `update(id, { active: false })` for the standard admin
   * deactivation flow — many records reference users by ID, and this
   * method does NOT cascade or rewrite those references.
   */
  async delete(id: UserId): Promise<void> {
    const { data, error } = await getServiceRoleClient()
      .from(TABLE)
      .delete()
      .eq("user_id", id)
      .select("user_id");
    if (error) throw new Error(`users.delete failed: ${error.message}`);
    if (!data || data.length === 0) throw new Error(`User ${id} not found`);
  },
};
