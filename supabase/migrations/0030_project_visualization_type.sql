-- =============================================================================
-- Project "visualization_type" — what kind of visualization deliverable a
-- project involves. Fixed list (not admin-extensible): Data Only, Function
-- Update, New Visualization, New Page, New Cognigy Build.
-- =============================================================================
--
-- `not null default` backfills every existing project to "Data Only" — the
-- first listed value, same "pick the first built-in" convention used for
-- track's and stage's defaults.

alter table public.projects
  add column if not exists visualization_type text not null default 'Data Only';
