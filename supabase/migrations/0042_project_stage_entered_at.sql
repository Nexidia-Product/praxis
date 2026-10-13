-- =============================================================================
-- When a project entered its current stage.
-- =============================================================================
--
-- `projects.stage_entered_at` powers "days in stage" on the Work in progress
-- page. A trigger stamps it whenever `stage` changes (and on insert), so
-- every code path that moves a project — the edit form, the quick view, the
-- stage auto-advance when a stage's tasks finish, idea conversion, the
-- cancel close-out — is covered without each one having to remember.
--
-- Backfill: the most recent audit-log entry whose summary records a stage
-- change for the project ("stage: A → B"), otherwise the date the project
-- was added. Projects whose stage never changed after creation therefore
-- count from their creation date.

alter table public.projects
  add column if not exists stage_entered_at timestamptz;

update public.projects p
set stage_entered_at = coalesce(
  (
    select max(a.occurred_at)
    from public.audit_log a
    where a.entity_type = 'Project'
      and a.entity_id = p.project_id
      and (a.summary like 'stage: %' or a.summary like '%; stage: %')
  ),
  p.date_added::timestamptz
)
where p.stage_entered_at is null;

alter table public.projects
  alter column stage_entered_at set default now();
alter table public.projects
  alter column stage_entered_at set not null;

create or replace function public.set_project_stage_entered_at()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'INSERT' then
    new.stage_entered_at := coalesce(new.stage_entered_at, now());
  elsif new.stage is distinct from old.stage then
    new.stage_entered_at := now();
  end if;
  return new;
end;
$$;

drop trigger if exists projects_set_stage_entered_at on public.projects;
create trigger projects_set_stage_entered_at
  before insert or update on public.projects
  for each row execute function public.set_project_stage_entered_at();
