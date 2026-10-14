-- =============================================================================
-- Project "visualization_lead" — who leads the visualization deliverable.
-- Free-form name, same shape as project_lead; empty string = unassigned.
-- =============================================================================

alter table public.projects
  add column if not exists visualization_lead text not null default '';
