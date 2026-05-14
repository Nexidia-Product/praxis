-- =============================================================================
-- Drop legacy auth columns from public.users — Stage 4 cleanup.
-- =============================================================================
--
-- Stage 2 handed identity off to Supabase Auth (`auth.users`). These
-- columns on `public.users` were retained through Stage 2 only so the
-- existing repository code kept compiling against the original User
-- type. Nothing reads or writes them anymore.
--
-- Order of operations is intentional: Stage 1 → 2 → 4 means by the
-- time this migration runs, every active code path is reading
-- identity from `auth.users` and role/name from `public.users` (the
-- profile mirror). The columns below are dead weight.
--
-- Safe to re-run: `IF EXISTS` lets a re-apply against an already-
-- migrated database succeed as a no-op.

alter table public.users drop column if exists password_hash;
alter table public.users drop column if exists invite_token;
alter table public.users drop column if exists invite_token_expires_at;
alter table public.users drop column if exists password_reset_token;
alter table public.users drop column if exists password_reset_token_expires_at;
