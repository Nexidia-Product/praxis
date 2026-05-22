-- =============================================================================
-- Add "Awaiting Dependency" to the task status check constraint.
-- =============================================================================
--
-- The original constraint (0001) only allowed the seven canonical
-- statuses. The new "Awaiting Dependency" status indicates a task
-- whose Finish-to-Start predecessor isn't yet complete. It's set
-- automatically when an FS dependency is added to a Not Started task
-- and cleared automatically when every FS predecessor reaches
-- Complete (see lib/tasks/service.ts). Distinct from "Blocked",
-- which represents a runtime stuck-ness with a free-text reason.
--
-- Postgres can't add a value to an inline CHECK constraint without
-- dropping and recreating it. The constraint name follows the
-- default Postgres naming pattern (`tasks_status_check`).

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
    'Complete',
    'Canceled'
  ));
