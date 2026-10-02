-- =============================================================================
-- Task-driven project deployment dates.
-- =============================================================================
--
-- A task can be tagged as the one whose due date drives a specific field
-- on its parent project (today: "target_date" or
-- "target_executable_deployment_date") — e.g. the Visualization
-- template's "Application deployed" and "Version, changelog, build,
-- deploy" tasks. Whenever that task's due date is set or changes (manual
-- edit or schedule recompute), the project field is kept in sync
-- automatically. See `lib/tasks/service.ts`'s `syncProjectDateFromTask`.
--
-- Deliberately a plain text column (validated in the service layer, same
-- convention as `stage`) rather than a DB-level enum/check constraint —
-- the set of drivable project date fields may grow, and this is
-- track-specific template authoring data, not a fixed system enum.
-- Null (the default) means "this task doesn't drive anything."

alter table public.tasks
  add column if not exists drives_project_date text null;
