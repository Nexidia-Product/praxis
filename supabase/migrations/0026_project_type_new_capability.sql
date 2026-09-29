-- =============================================================================
-- Project type: retire "New Application" and "New Prototype", consolidate
-- into "New Capability".
-- =============================================================================
--
-- project_type is a plain `text` column (no CHECK constraint / enum type),
-- so no schema change is needed — just backfill existing rows to the new
-- value. lib/projects/display.ts's PROJECT_TYPES no longer offers the two
-- retired values, so this also keeps stored data in sync with what the
-- dropdown can produce going forward.

update public.projects
  set project_type = 'New Capability'
  where project_type in ('New Application', 'New Prototype');
