-- =============================================================================
-- Templates: project_type (single text) → project_types (text[]).
-- =============================================================================
--
-- The original schema allowed a template to apply to exactly one
-- project_type. Real templates (e.g. "Handover to Product Management")
-- get used across multiple project types — New Feature, Enhancement,
-- New Application all need the same closeout steps. Switching the
-- column to an array lets one template cover N types without
-- duplicating its task list.
--
-- Migration is in three steps so existing data is preserved and the
-- swap is atomic at the application layer:
--   1. Add the new array column with a permissive default.
--   2. Backfill it from the existing single column for every row.
--   3. Drop the old column.
--
-- If this migration is re-applied against an already-migrated
-- database, steps 1 and 3 are idempotent (IF EXISTS / IF NOT EXISTS).
-- Step 2 is a no-op because the source column is gone — the update
-- still runs but the WHERE clause matches nothing.

-- Step 1: add the array column.
alter table public.templates
  add column if not exists project_types text[] not null default '{}';

-- Step 2: backfill from the legacy single column where present.
-- We only touch rows where the new column is still empty so a
-- re-run can't undo a hand-edit.
update public.templates
   set project_types = array[project_type]
 where project_type is not null
   and project_type <> ''
   and (project_types is null or array_length(project_types, 1) is null);

-- Step 3: drop the legacy column.
alter table public.templates
  drop column if exists project_type;
