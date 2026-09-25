-- =============================================================================
-- Target Executable Deployment Date
-- =============================================================================
--
-- Sibling to `target_date` ("Target Application Deployment Date" in the UI —
-- see lib/db/types.ts for the label rationale; the column name stays
-- `target_date` since only the display label changed). This new column
-- tracks the separate executable's deployment deadline and feeds the
-- `final_logic_process_handoff` milestone computed in
-- lib/projects/milestones.ts (2 business days prior). Nullable, no default,
-- matching how `target_date` itself was declared in 0001_initial_schema.sql.

alter table public.projects
  add column if not exists target_executable_deployment_date date;
