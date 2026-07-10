-- =============================================================================
-- Task key findings — append-only, rich-content notes at the task level.
-- =============================================================================
--
-- Analysts capture discrete "key findings" on a task (often pasted from
-- another tool, keeping tables and formatting). Unlike `comments` (a
-- single evolving field snapshotted into `comment_history`), each key
-- finding is its own entry, so the shape is an array of records:
--
--   [{ id, html, created_at, created_by, created_by_name }, ...]
--
-- `html` is sanitized server-side before storage (see
-- lib/tasks/key-findings.ts) — the column holds trusted markup only.
--
-- RLS is already enabled on public.tasks (migration 0001); adding a
-- column doesn't change that, so no RLS statement is needed here.

alter table public.tasks
  add column if not exists key_findings jsonb not null default '[]'::jsonb;
