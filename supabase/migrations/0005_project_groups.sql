-- =============================================================================
-- Project groups — symmetric, named clusters of related projects.
-- =============================================================================
--
-- Distinct from project→project dependencies (Section 5.10), which model
-- finish-to-start ordering. Groups capture the "these projects share an
-- analysis / dataset / domain context and should be considered together"
-- relationship that the team needs when planning capacity and
-- prioritization — e.g. Repeat Call Analysis and First Call Resolution
-- both build on the same call-recording corpus, so they're worth thinking
-- about as a pair even when only one is in active work.
--
-- Shape:
--   - Single table, one row per group.
--   - member_project_ids is a text[] of project IDs (the YYYY-NNN format).
--     Storing membership on the group rather than on each project keeps
--     the source of truth in one place; the per-project "what groups am
--     I in?" lookup uses a GIN index on the array for cheap reads.
--   - Group membership is bidirectional by construction: if project A is
--     in group G's member list, G appears on A's "Related groups" panel
--     and vice versa. No explicit reciprocity tracking needed.
--
-- Cascade behavior: deleting a project removes it from every group's
-- member_project_ids array. Handled in lib/projects/service.ts (the
-- repository layer doesn't know about groups, and an FK constraint
-- can't reach into a text[]).

create table public.project_groups (
  group_id            uuid primary key default gen_random_uuid(),
  name                text not null,
  description         text not null default '',
  member_project_ids  text[] not null default '{}',
  created_by          text not null default '',
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

create trigger project_groups_set_updated_at
  before update on public.project_groups
  for each row execute function public.set_updated_at();

-- GIN index supports `project_id = ANY(member_project_ids)` lookups, used
-- by ProjectGroupRepository.getForProject() to find every group a given
-- project belongs to.
create index project_groups_members_idx
  on public.project_groups using gin (member_project_ids);

create index project_groups_created_at_idx
  on public.project_groups (created_at desc);

-- RLS: service-role bypasses, so no policies are written today. Matches
-- the pattern of every other table in this schema.
alter table public.project_groups enable row level security;
