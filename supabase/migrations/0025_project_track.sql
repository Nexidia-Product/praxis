-- =============================================================================
-- Project "track" — delivery track a project belongs to, separate from
-- program (top-level workstream) and application_product (product area).
-- =============================================================================
--
-- Ships with three built-ins: "Track A - Dashboard/visualization",
-- "Track B - Cognigy bot inputs", "Track C - WFM/mid-shift reskilling".
-- Admins can curate more via Admin Console > Configuration > Project
-- values > Track, same mechanism as program / application_product.
--
-- `not null default` backfills every existing row to Track A — same
-- "pick the first built-in" convention as program's 'Innovation' default.

alter table public.projects
  add column if not exists track text not null default 'Track A - Dashboard/visualization';
