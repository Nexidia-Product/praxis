-- =============================================================================
-- "Definition of done" — free-form acceptance criteria per project.
-- =============================================================================
--
-- Optional, plain text. Captures the team's view of what needs to be
-- true to mark a project complete — acceptance criteria, deliverable
-- list, success metric, whatever the lead wants to write down. Lives
-- alongside `description` on the project record; the description
-- says "what we're doing", definition_of_done says "how we'll know
-- we're done".
--
-- Stored as text (not jsonb) because there's no shape to it —
-- whatever the lead types is the value. Default empty string so
-- existing projects read back as "unset" without a migration to
-- backfill nulls.

alter table public.projects
  add column if not exists definition_of_done text not null default '';
