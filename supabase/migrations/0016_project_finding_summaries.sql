-- =============================================================================
-- Project finding summaries — one persisted, AI-generated summary per project.
-- =============================================================================
--
-- The Insights → Key findings page can synthesize the key findings across
-- a project's tasks into one overall summary. The result is stored so it
-- stays on screen for the project until it is regenerated (which
-- overwrites it). One row per project, keyed by project_id.
--
-- `summary_md` is GitHub-Flavored Markdown produced by the model.
-- `source_*` record how many tasks / findings fed the summary, so the UI
-- can note staleness after new findings are added. Deleting a project
-- cascades to its summary.

create table if not exists public.project_finding_summaries (
  project_id           text primary key
                         references public.projects(project_id) on delete cascade,
  summary_md           text not null,
  model_id             text not null,
  source_task_count    integer not null default 0,
  source_finding_count integer not null default 0,
  generated_by         uuid references public.users(user_id) on delete set null,
  generated_by_name    text,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);

-- Match the RLS pattern from 0001: enabled, no policies (deny-by-default
-- for anon/authenticated); the service-role key used by the repository
-- bypasses it.
alter table public.project_finding_summaries enable row level security;
