/**
 * Audit log service (Step 13 / Section 5.19).
 *
 * One thin wrapper around `AuditLogRepository.record` that:
 *
 *   1. resolves the actor's display name from `users.json` (so the
 *      log row reads "Jane Doe" without joining at read time);
 *   2. swallows write errors and logs to the console — the audit
 *      log is observability, not a load-bearing leg of the request.
 *      A disk hiccup must never roll back the underlying mutation
 *      (creating a project, deleting a task, etc).
 *
 * Service-layer hooks (`lib/projects/service.ts`, etc.) call
 * `audit(...)` after the primary write succeeds, so an audit row
 * implies the change actually happened.
 *
 * The `actor_id === "system"` sentinel mirrors the convention used by
 * `StatusHistoryEntry.changed_by` — anything driven by the daily cron
 * or a seed/migration script, not a logged-in user.
 */

import {
  AuditLogRepository,
  UserRepository,
  type AuditAction,
  type AuditEntityType,
  type UserId,
} from "@/lib/db";

export interface AuditContext {
  actorId: UserId | "system" | null;
  /**
   * Display name for the actor. Pass `session.user.name` from the API
   * route — that's authoritative and avoids the failure mode where a
   * stale JWT carries a user_id that no longer matches any record in
   * `users.json` (after a seed reset, for example). Optional: when
   * omitted, the service tries `UserRepository.getById(actorId)` and
   * falls back to `null` if that lookup fails.
   */
  actorName?: string | null;
  entityType: AuditEntityType;
  entityId: string;
  entityLabel: string;
  action: AuditAction;
  summary: string;
}

/**
 * Best-effort write to the audit log. Never throws — any failure is
 * logged via `console.warn` and the caller proceeds.
 */
export async function audit(ctx: AuditContext): Promise<void> {
  try {
    const actorId =
      ctx.actorId === "system" || ctx.actorId === null ? null : ctx.actorId;
    // Prefer the explicitly-provided name (the session is authoritative).
    // Only fall back to a UserRepository lookup when the caller didn't
    // pass one — keeps the legacy call path working but stops the
    // "Unknown user" issue when the JWT user_id has drifted from
    // users.json.
    const actorName =
      ctx.actorName !== undefined
        ? ctx.actorName
        : actorId
          ? await resolveActorName(actorId)
          : null;
    await AuditLogRepository.record({
      actor_id: actorId,
      actor_name: actorName ?? null,
      entity_type: ctx.entityType,
      entity_id: ctx.entityId,
      entity_label: ctx.entityLabel,
      action: ctx.action,
      summary: ctx.summary,
    });
  } catch (err) {
    console.warn(
      `[audit] failed to record ${ctx.action} on ${ctx.entityType} ${ctx.entityId}:`,
      err,
    );
  }
}

async function resolveActorName(userId: UserId): Promise<string | null> {
  try {
    const user = await UserRepository.getById(userId);
    return user?.name ?? null;
  } catch {
    return null;
  }
}

/**
 * Helper: build a one-line "before → after" diff string for a flat
 * patch object. Used by the project / task / idea service hooks to
 * produce a readable summary without each call site reinventing the
 * format.
 *
 * Keys with identical before/after values are omitted, so a status-
 * only edit doesn't surface every other unchanged field. Limits the
 * number of changes shown so a bulk reshape doesn't produce an
 * unreadable row — anything past the cap collapses to "+N more".
 */
export function summarizeChanges(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  opts: { fields?: string[]; max?: number } = {},
): string {
  const max = opts.max ?? 4;
  const fields = opts.fields ?? Array.from(new Set([...Object.keys(before), ...Object.keys(after)]));
  const parts: string[] = [];
  for (const key of fields) {
    const a = before[key];
    const b = after[key];
    if (sameValue(a, b)) continue;
    parts.push(`${key}: ${formatValue(a)} → ${formatValue(b)}`);
  }
  if (parts.length === 0) return "No field changes";
  if (parts.length <= max) return parts.join("; ");
  const shown = parts.slice(0, max).join("; ");
  return `${shown}; +${parts.length - max} more`;
}

function sameValue(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return a === b;
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    return a.every((v, i) => sameValue(v, b[i]));
  }
  if (typeof a === "object" && typeof b === "object") {
    return JSON.stringify(a) === JSON.stringify(b);
  }
  return false;
}

function formatValue(v: unknown): string {
  if (v === null || v === undefined) return "—";
  if (typeof v === "string") {
    return v.length > 40 ? `${v.slice(0, 37)}…` : v || "—";
  }
  if (Array.isArray(v)) {
    if (v.length === 0) return "[]";
    return `[${v.length}]`;
  }
  if (typeof v === "object") return "{…}";
  return String(v);
}
