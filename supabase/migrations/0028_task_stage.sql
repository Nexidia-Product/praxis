-- =============================================================================
-- Task "stage" — which stage of the parent project's delivery track a task
-- belongs to (one of `stagesForTrack(project.track)`; see lib/projects/display.ts).
-- =============================================================================
--
-- Existing tasks are backfilled to their parent project's *current* stage
-- (a one-time snapshot, not a live link — editing the project's stage
-- afterward does not move its tasks). New tasks have no default; the
-- create form requires the user to pick one explicitly.

alter table public.tasks add column if not exists stage text;

update public.tasks t
set stage = p.stage
from public.projects p
where p.project_id = t.project_id
  and t.stage is null;

alter table public.tasks alter column stage set not null;
