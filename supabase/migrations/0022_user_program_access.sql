-- =============================================================================
-- Per-user program access restriction + primary program.
-- =============================================================================
--
-- `allowed_programs` restricts which programs (see migration 0021) a
-- user's projects/tasks views include. Null means unrestricted (sees
-- every program) — the default for every existing and new user, so
-- nothing changes until an admin explicitly restricts someone via the
-- Users admin panel. This is deliberately per-user, not per-role: two
-- users sharing a role (e.g. Team Member) may need different program
-- access (e.g. one Complaints-only, one unrestricted).
--
-- `primary_program` is the default program view when allowed_programs
-- grants more than one program. Null means "no explicit preference —
-- resolve a sensible default" (see getDefaultProgram in
-- lib/projects/visibility.ts). Moot when allowed_programs has exactly
-- one entry, since that one is automatically the default.

alter table public.users
  add column if not exists allowed_programs text[];

alter table public.users
  add column if not exists primary_program text;
