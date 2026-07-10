-- =============================================================================
-- Idea edit tokens — let an external submitter edit their idea (pre-conversion)
-- without an account.
-- =============================================================================
--
-- `edit_token_hash` stores the SHA-256 hash (hex) of a high-entropy
-- capability token handed to the submitter at submission time (shown on the
-- confirmation screen and emailed when they left an address). We store only
-- the hash — a database leak then can't be used to edit anyone's idea, since
-- the raw token never touches the row. The token is minted best-effort by the
-- service layer, so this column being absent only disables the edit feature;
-- it never blocks a submission.
--
-- `edited_since_review` is a lightweight flag: set when a submitter edits an
-- idea that has already moved past "New" (i.e. a reviewer has engaged with
-- it), and cleared the next time a reviewer updates the idea. Drives an
-- "Edited since review" badge on the admin review surfaces so a stale
-- assessment is obvious. Defaults false so existing rows backfill cleanly.

alter table public.ideas
  add column if not exists edit_token_hash text;

alter table public.ideas
  add column if not exists edited_since_review boolean not null default false;

-- Token lookups hit this column on every edit-link open; partial index keeps
-- it small (only rows that actually have a token).
create index if not exists ideas_edit_token_hash_idx
  on public.ideas (edit_token_hash)
  where edit_token_hash is not null;
