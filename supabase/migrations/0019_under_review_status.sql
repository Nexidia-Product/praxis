-- =============================================================================
-- Add "Under Review" to the task status check constraint.
-- =============================================================================
--
-- "Under Review" marks a task that's done being actively worked and is
-- now awaiting review or sign-off. It's a parked state (like "On Hold"
-- / "Delayed") — not terminal (the task isn't Complete yet) and not in
-- the default open-work flow, but still on the table. Set and cleared
-- manually.
--
-- Postgres can't add a value to an inline CHECK constraint without
-- dropping and recreating it. The constraint name follows the default
-- Postgres naming pattern (`tasks_status_check`); this recreates it
-- with the 9th value, preserving the eight from 0010.

alter table public.tasks
  drop constraint if exists tasks_status_check;

alter table public.tasks
  add constraint tasks_status_check
  check (status in (
    'Not Started',
    'Awaiting Dependency',
    'In Progress',
    'Blocked',
    'Delayed',
    'On Hold',
    'Under Review',
    'Complete',
    'Canceled'
  ));
