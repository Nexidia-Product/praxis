-- =============================================================================
-- Use cases: primary + secondary objectives (replaces flat `objectives`).
-- =============================================================================
--
-- Mirrors projects.primary_objective / secondary_objectives (0033). The
-- earlier flat `objectives` array from 0034 is folded in: its first entry
-- becomes the primary, the rest become secondaries, then the column and
-- its index are dropped. Single-project-per-use-case is enforced in
-- lib/use-cases/service.ts (membership is a text[], so no DB constraint).

alter table public.use_cases
  add column if not exists primary_objective text null;

alter table public.use_cases
  add column if not exists secondary_objectives text[] not null default '{}';

do $$
begin
  if exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'use_cases'
      and column_name = 'objectives'
  ) then
    update public.use_cases
       set primary_objective = objectives[1],
           secondary_objectives = coalesce(objectives[2:array_length(objectives, 1)], '{}')
     where primary_objective is null and array_length(objectives, 1) >= 1;
    drop index if exists public.use_cases_objectives_idx;
    alter table public.use_cases drop column objectives;
  end if;
end $$;
