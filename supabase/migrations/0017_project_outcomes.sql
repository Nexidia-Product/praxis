-- =============================================================================
-- Project outcomes — free-form outcomes per project, each optionally tagged
-- with a product and a type from admin-managed vocabularies.
-- =============================================================================
--
-- A project can declare one or more outcomes. Each outcome is free text
-- (e.g. "auto create outbound marketing campaign for Atlas/Verse via
-- Cognigy") and may be tied to a product (e.g. "Cognigy") and a type
-- (e.g. "automation"). Shape:
--
--   [{ id, text, product, type }, ...]   -- product/type nullable
--
-- The product and type vocabularies are admin-managed lists stored on the
-- settings singleton (outcome_products / outcome_types), edited under
-- Admin -> Configuration -> Outcomes. They're plain string arrays — no
-- per-value metadata, unlike enum_extensions — so a dedicated pair of
-- columns is simpler than extending the enum machinery.
--
-- RLS is already enabled on both tables (migration 0001); adding columns
-- doesn't change that.

alter table public.projects
  add column if not exists outcomes jsonb not null default '[]'::jsonb;

alter table public.settings
  add column if not exists outcome_products jsonb not null default '[]'::jsonb;

alter table public.settings
  add column if not exists outcome_types jsonb not null default '[]'::jsonb;
