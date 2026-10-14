-- =============================================================================
-- Idea "Bug / Defect" flag.
-- =============================================================================
--
-- `is_bug_defect` flags an idea as a bug or defect report rather than a new
-- feature request. Works like `is_quality_of_life` (migration 0020): the
-- submitter can set it at submission time and reviewers can set/clear it
-- from the Ideas Review page. Defaults false so existing rows read back as
-- "not flagged" without a backfill.

alter table public.ideas
  add column if not exists is_bug_defect boolean not null default false;

create index if not exists ideas_bug_defect_idx
  on public.ideas (is_bug_defect)
  where is_bug_defect;
