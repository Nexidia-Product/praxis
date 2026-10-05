-- =============================================================================
-- Organizational Objective on projects.
-- =============================================================================
--
-- Every project ties back to one of five fixed organizational objectives
-- (Cost-to-Serve, Revenue, Compliance, Customer Experience, Agent
-- Experience — see OBJECTIVES in lib/projects/display.ts), with room for
-- additional secondary objectives. Unlike track/program, this list is
-- NOT admin-extensible — it's a stable, product-level taxonomy.
--
-- `primary_objective` is required going forward (enforced in
-- lib/projects/service.ts: rejected on create, and on update once the
-- resulting value would be null) but stays a nullable column here —
-- existing projects are left as-is rather than force-backfilled, same
-- convention as `tasks.estimate_hours` (migration 0028 era). A legacy
-- project only needs one assigned the next time someone edits it.

alter table public.projects
  add column if not exists primary_objective text null;

alter table public.projects
  add column if not exists secondary_objectives jsonb not null default '[]'::jsonb;
