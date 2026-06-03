-- 0011_user_ui_preferences.sql
--
-- Per-user UI state that isn't business data — currently the manual
-- ordering of a user's open tasks on the My Tasks "Checklist" view.
-- Mirrors the existing `notification_preferences` jsonb column: a single
-- flexible bag so future per-user UI preferences don't each need a column.
--
-- Shape (see UserUIPreferences in lib/db/types.ts):
--   { "my_tasks_order": ["26-0007", "26-0012", ...] }
--
-- Defaults to an empty object so existing rows and new inserts are valid
-- without a backfill.

alter table public.users
  add column if not exists ui_preferences jsonb not null default '{}'::jsonb;
