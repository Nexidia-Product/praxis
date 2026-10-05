-- =============================================================================
-- Use cases: caveats.
-- =============================================================================
--
-- Free-form notes documenting limitations, assumptions or exceptions that
-- apply to a use case. Plain text; length validated in
-- lib/use-cases/service.ts.

alter table public.use_cases
  add column if not exists caveats text not null default '';
