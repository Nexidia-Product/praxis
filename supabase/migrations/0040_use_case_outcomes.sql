-- =============================================================================
-- Use case outcomes, and which of them a project supports.
-- =============================================================================
--
-- A use case can define outcomes of its own (what the use case is meant to
-- achieve), each `{ id, text }`. A project that belongs to the use case
-- picks the ones it supports; the picks are stored on the project as the
-- outcome ids. These are separate from `projects.outcomes` (what the
-- project itself delivers, 0017).
--
-- Consistency is enforced in code (lib/use-cases/service.ts reconciles
-- after any use case change; lib/projects/service.ts validates writes):
-- a project can only reference outcomes of the use case it belongs to, and
-- none when it belongs to no use case. An id can't be a real FK because
-- outcomes live inside a jsonb array.

alter table public.use_cases
  add column if not exists outcomes jsonb not null default '[]'::jsonb;

alter table public.projects
  add column if not exists use_case_outcome_ids text[] not null default '{}';

create index if not exists projects_use_case_outcome_ids_idx
  on public.projects using gin (use_case_outcome_ids);
