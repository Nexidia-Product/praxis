-- =============================================================================
-- Release-calendar scheduling anchors on tasks.
-- =============================================================================
--
-- Two tasks in the Track A Visualization template represent release-
-- calendar milestones (executable deployment, application deployment)
-- that must land on a Friday, and must stay an exact number of business
-- days apart regardless of how the ordinary estimate/dependency chain
-- computes dates for the tasks in between. See `lib/tasks/schedule.ts`.
--
--   - `friday_anchor`: when true, the computed due date snaps forward to
--     the next Friday if it doesn't already land on one.
--   - `fixed_lag_business_days_after`: when set, the task's due date is
--     computed as exactly N business days after another specific task's
--     (possibly Friday-snapped) due date, overriding the normal
--     dependency-chain calculation for date purposes only.
--
-- Both default to "off" so every existing task is unaffected; only tasks
-- explicitly authored with these flags (currently: template-instantiated
-- milestone tasks) opt in.

alter table public.tasks
  add column if not exists friday_anchor boolean not null default false;

alter table public.tasks
  add column if not exists fixed_lag_business_days_after jsonb null;
