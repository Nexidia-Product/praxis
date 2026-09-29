-- =============================================================================
-- Templates: project_types (text[]) -> tracks (text[]).
-- =============================================================================
--
-- Templates are now built by delivery track instead of project type —
-- there's no meaningful mapping from one to the other, so unlike
-- migration 0008 (project_type -> project_types) this is not a backfill.
-- Existing templates end up with an empty `tracks` array (invalid under
-- the new "must contain at least one" rule) and won't be offered
-- anywhere until edited or deleted — expected, per product direction.
--
-- Per-task additions (`stage`, `default_responsible`) live inside the
-- `tasks` jsonb column and need no schema change; existing template
-- task rows simply lack those keys until the template is re-saved.

alter table public.templates
  add column if not exists tracks text[] not null default '{}';

alter table public.templates
  drop column if exists project_types;
