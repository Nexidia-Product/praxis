-- =============================================================================
-- Key capability — strategic-project designation + quarter commitment.
-- =============================================================================
--
-- `is_key_capability` flags a project for the Key Capabilities dashboard.
-- Any project can be flagged; defaults false so existing rows read back
-- as "not a key capability" without a backfill.
--
-- `key_capability_quarter` holds the committed quarter as text in the
-- form 'YYYY-Q1'..'YYYY-Q4', or null when the key capability hasn't been
-- slotted yet. The "at most two per quarter" rule is enforced in the
-- service layer (lib/projects/service.ts) rather than by a DB constraint,
-- since it's a cross-row business rule that wants a friendly error, not a
-- 23xxx Postgres exception. Stored as text (not an enum) so new years
-- don't need a migration.

alter table public.projects
  add column if not exists is_key_capability boolean not null default false;

alter table public.projects
  add column if not exists key_capability_quarter text;

-- Speeds up the dashboard's "all flagged projects" read and the
-- per-quarter cap check.
create index if not exists projects_key_capability_idx
  on public.projects (is_key_capability)
  where is_key_capability;
