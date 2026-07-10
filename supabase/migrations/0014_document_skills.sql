-- =============================================================================
-- Document generation: skills library, generated documents, model selection.
-- =============================================================================
--
-- Adds a fourth AI feature — document generation (PRFAQs, Confluence
-- articles, …) — alongside estimate / prioritize / overlap.
--
-- Three changes:
--   1. settings.ai_config gains `document_model_id`, matching the
--      per-feature model-selection pattern from 0004. Defaults to the
--      mid-tier reasoning model — long-form docs reward it. Existing
--      singleton rows are backfilled; the read-side merge in
--      SettingsRepository would cover a missing key anyway, but we keep
--      the stored row honest.
--   2. document_skills — the authored prompt library. Each row is a
--      self-contained "skill" bundle: instructions, an optional shared
--      product profile, a gold-standard example, an input spec that
--      binds Praxis project fields into the prompt, and an ordered
--      section outline. Skills are tuned externally and imported here;
--      `is_active` + `version` let a new version supersede the old
--      without deleting history. At most one active version per `key`.
--   3. generated_documents — drafts produced from a project + a skill.
--      Saved on generation so a user can edit, regenerate, and later
--      publish. `confluence_*` are populated once the publish path
--      lands. Deleting a project cascades to its generated documents.

-- 1. document_model_id on the AI config -------------------------------------
alter table public.settings
  alter column ai_config set default jsonb_build_object(
    'estimate_model_id',   'us.anthropic.claude-haiku-4-5-20251001-v1:0',
    'prioritize_model_id', 'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'overlap_model_id',    'us.anthropic.claude-sonnet-4-5-20250929-v1:0',
    'document_model_id',   'us.anthropic.claude-sonnet-4-5-20250929-v1:0'
  );

update public.settings
   set ai_config = ai_config
     || jsonb_build_object(
          'document_model_id',
          'us.anthropic.claude-sonnet-4-5-20250929-v1:0')
 where not (ai_config ? 'document_model_id');

-- 2. document_skills table ---------------------------------------------------
create table if not exists public.document_skills (
  id              uuid primary key default gen_random_uuid(),
  key             text not null,
  name            text not null,
  title_pattern   text,
  model_id        text,
  instructions    text not null,
  product_profile text,
  example         text,
  inputs          jsonb not null default '{}'::jsonb,
  outline         jsonb not null default '[]'::jsonb,
  version         integer not null default 1,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

-- At most one active version per skill key — this is the row the
-- generator reads via DocumentSkillRepository.getActive().
create unique index if not exists document_skills_active_key_uidx
  on public.document_skills (key)
  where is_active;

-- Lookups across all versions of a key (history, admin authoring).
create index if not exists document_skills_key_idx
  on public.document_skills (key);

-- 3. generated_documents table ----------------------------------------------
create table if not exists public.generated_documents (
  id                 uuid primary key default gen_random_uuid(),
  project_id         text not null
                       references public.projects(project_id) on delete cascade,
  skill_key          text not null,
  skill_version      integer not null,
  title              text not null,
  markdown           text not null,
  sections           jsonb not null default '[]'::jsonb,
  status             text not null default 'draft'
                       check (status in ('draft', 'reviewed', 'published')),
  model_id           text not null,
  usage              jsonb not null default '{}'::jsonb,
  confluence_page_id text,
  confluence_url     text,
  created_by         uuid references public.users(user_id) on delete set null,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

create index if not exists generated_documents_project_idx
  on public.generated_documents (project_id);

-- Match the RLS pattern from 0001: enable RLS with no policies, so the
-- anon / authenticated roles are deny-by-default. The service-role key
-- (used by every repository and the seed script) bypasses RLS, so
-- server-side access is unaffected.
alter table public.document_skills     enable row level security;
alter table public.generated_documents enable row level security;
