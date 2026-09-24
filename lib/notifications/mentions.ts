/**
 * @Mention resolution.
 *
 * Task comments and project status summaries are plain text; the mention
 * picker (`components/shared/mention-textarea.tsx`) inserts literal
 * `@Full Name` tokens rather than a structured reference. This module
 * re-resolves those tokens against the active user roster at save time,
 * mirroring the free-form-name resolution already used for
 * `responsible` / `project_lead` in `lib/notifications/service.ts`
 * (`resolveAssigneeId`), but matching an inline `@Name` token inside a
 * larger block of text instead of a whole field value.
 */

import { UserRepository, type UserId } from "@/lib/db";

/**
 * Resolve every `@Full Name` token in `text` to a user_id, matching
 * against active users' display names, case-insensitively, with a word
 * boundary after the name (so `@Jo` doesn't match inside `@John`).
 *
 * Names are tried longest-first so a two-word name (`@Jo Ellen`) is
 * preferred over a shorter name that's a prefix of it (`@Jo`) when both
 * exist — otherwise the shorter regex could match first and leave " Ellen"
 * as ordinary text.
 */
export async function resolveMentions(text: string): Promise<UserId[]> {
  if (!text || !text.includes("@")) return [];

  const users = await UserRepository.getAll();
  const active = users
    .filter((u) => u.active && u.name.trim().length > 0)
    .sort((a, b) => b.name.trim().length - a.name.trim().length);

  const found = new Set<UserId>();
  for (const u of active) {
    const name = u.name.trim();
    const pattern = new RegExp(`@${escapeRegExp(name)}\\b`, "i");
    if (pattern.test(text)) found.add(u.user_id);
  }
  return [...found];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
