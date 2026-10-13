-- =============================================================================
-- When a project first reached Productization (shipped).
-- =============================================================================
--
-- The Velocity dashboard measures delivery at Productization rather than at
-- status Completed (post-release handover and services validation can run
-- for months afterwards). `stage_entered_at` can't answer "when did it
-- ship?" because it resets on every later stage change, so this records the
-- first time the stage reached Productization or a stage after it.
--
-- The stage names mirror `stagesForTrack` in lib/projects/display.ts:
-- Productization plus the post-Productization stages (today: Track B's
-- Services Validation / Services Signoff / Adoption). Update the list in
-- the function below if more post-Productization stages are added.
--
-- Backfill, for projects already at or past Productization: the earliest
-- audit-log entry recording a move to one of those stages, else
-- `stage_entered_at` (an approximation that can only be later than the true
-- date for projects that have moved on since).

alter table public.projects
  add column if not exists productization_reached_at timestamptz;

update public.projects p
set productization_reached_at = coalesce(
  (
    select min(a.occurred_at)
    from public.audit_log a
    where a.entity_type = 'Project'
      and a.entity_id = p.project_id
      and (
        a.summary like '%→ Productization%'
        or a.summary like '%→ Services Validation%'
        or a.summary like '%→ Services Signoff%'
        or a.summary like '%→ Adoption%'
      )
  ),
  p.stage_entered_at
)
where p.productization_reached_at is null
  and p.stage in ('Productization', 'Services Validation', 'Services Signoff', 'Adoption');

create or replace function public.set_project_productization_reached_at()
returns trigger
language plpgsql
as $$
begin
  if new.productization_reached_at is null
     and new.stage in ('Productization', 'Services Validation', 'Services Signoff', 'Adoption')
  then
    new.productization_reached_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_set_productization_reached_at on public.projects;
create trigger projects_set_productization_reached_at
  before insert or update on public.projects
  for each row execute function public.set_project_productization_reached_at();
