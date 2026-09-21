-- =============================================================================
-- Idea "Quality of Life" flag.
-- =============================================================================
--
-- `is_quality_of_life` flags an idea as a minor usability tweak (e.g. one
-- that would help with customer demos) rather than a substantive feature
-- request. Submitters can set it at submission time; reviewers can also
-- set/clear it from the Ideas Review page. Defaults false so existing rows
-- read back as "not flagged" without a backfill. Mirrors the
-- `is_key_capability` precedent on `projects` (migration 0012).

alter table public.ideas
  add column if not exists is_quality_of_life boolean not null default false;

create index if not exists ideas_quality_of_life_idx
  on public.ideas (is_quality_of_life)
  where is_quality_of_life;
