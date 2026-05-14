/**
 * Shared helpers for the storage layer.
 *
 * In Phase 1 this module held the JSON-file read/write machinery
 * (atomic writes via temp-file-and-rename, per-file mutex chain, plus
 * ID generators). Phase 2 — migrating to Supabase — replaces all of
 * that with the Postgres-backed repositories in `lib/db/*.ts`.
 *
 * What's left here is the small handful of pure utilities every
 * repository still uses:
 *
 *   - `nowIso()` / `todayIso()` — ISO timestamps with no Supabase
 *     dependency, used in test scripts and the rare service-layer
 *     site that needs a "now" without hitting the database.
 *   - `newUuid()` — thin wrapper around `crypto.randomUUID()`, kept
 *     so existing call sites don't have to change imports.
 *
 * ID generation for projects (YYYY-NNN) and tasks (YY-NNNN) used to
 * live here too. Both moved to Postgres — see the `next_project_id()`
 * and `next_task_id()` functions in
 * `supabase/migrations/0001_initial_schema.sql`. The repositories
 * insert without specifying the ID column and let the database fill
 * it in atomically.
 */

import { randomUUID } from "node:crypto";

/** Current UTC time as an ISO 8601 timestamp string. */
export function nowIso(): string {
  return new Date().toISOString();
}

/** Current UTC date as an ISO 8601 calendar-date string (`YYYY-MM-DD`). */
export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** UUID v4 string from Node's built-in crypto. */
export function newUuid(): string {
  return randomUUID();
}
