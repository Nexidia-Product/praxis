-- =============================================================================
-- Release caveats — notes on a project, recorded against a specific
-- Application Release.
-- =============================================================================
--
-- A caveat documents a limitation, assumption, or exception for one
-- project as of one release (release_date = the project's Target
-- Application Deployment Date at the time), so there is a record to refer
-- back to if questions come up. Several caveats can exist per
-- project+release; each carries who wrote it and when. Entries stay tied
-- to the release they were written for even if the project's date later
-- moves. Deleting a project deletes its caveats.
--
-- This also removes the use-case-level `caveats` column that 0036 added —
-- caveats belong to a project in a release, not to a use case.

create table public.release_caveats (
  caveat_id        uuid primary key default gen_random_uuid(),
  release_date     date not null,
  project_id       text not null
                     references public.projects(project_id) on delete cascade,
  caveat           text not null,
  created_by       text not null default '',
  created_by_name  text not null default '',
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);

create trigger release_caveats_set_updated_at
  before update on public.release_caveats
  for each row execute function public.set_updated_at();

create index release_caveats_release_idx
  on public.release_caveats (release_date, project_id);

create index release_caveats_project_idx
  on public.release_caveats (project_id);

-- RLS: service-role bypasses, no policies (matches the rest of the schema).
alter table public.release_caveats enable row level security;

alter table public.use_cases drop column if exists caveats;
