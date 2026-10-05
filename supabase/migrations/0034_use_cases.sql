-- =============================================================================
-- Use cases — top-level, admin-defined groupings of projects by objective.
-- =============================================================================
--
-- A use case has a name + description, is associated with one or more of
-- the fixed organizational objectives (OBJECTIVES in lib/projects/display.ts,
-- the same taxonomy as projects.primary_objective), and has individually
-- selected member projects. A project can belong to many use cases and a
-- use case can have many projects.
--
-- Completely separate from project_groups (0005): groups are symmetric
-- clusters of related projects; use cases are an objective-aligned
-- rollup concept that is expected to grow its own features over time.
--
-- Same storage shape as project_groups: membership lives on the use case
-- row as a text[] of project IDs (GIN-indexed). Deleting a project prunes
-- it from every use case in lib/projects/service.ts, since an FK can't
-- reach into a text[].
--
-- `objectives` stores objective names (not validated here — the list is
-- code-owned; validation is in lib/use-cases/service.ts).

create table public.use_cases (
  use_case_id         uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text not null default '',
  objectives          text[] not null default '{}',
  member_project_ids  text[] not null default '{}',
  created_by          text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger use_cases_set_updated_at
  before update on public.use_cases
  for each row execute function public.set_updated_at();

create index use_cases_members_idx
  on public.use_cases using gin (member_project_ids);

create index use_cases_objectives_idx
  on public.use_cases using gin (objectives);

create index use_cases_created_at_idx
  on public.use_cases (created_at desc);

-- RLS: service-role bypasses, so no policies are written (matches the
-- rest of the schema).
alter table public.use_cases enable row level security;
