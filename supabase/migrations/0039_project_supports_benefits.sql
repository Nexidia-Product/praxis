-- =============================================================================
-- Project "Supports" and "Benefits" — qualitative business case.
-- =============================================================================
--
-- Two free-text blocks documenting WHAT a project supports and WHAT it
-- benefits, ideally filled in before analysis starts. Both are optional
-- and never block a stage change; their absence is surfaced as a soft
-- flag only. Benefits roll up to the use case in the UI (no column on
-- use_cases). Qualitative on purpose: ROI is calculated per customer in
-- each analysis output, so there is no KPI structure here.

alter table public.projects
  add column if not exists supports text not null default '';

alter table public.projects
  add column if not exists benefits text not null default '';
