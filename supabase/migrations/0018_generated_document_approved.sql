-- =============================================================================
-- Generated documents: add an "approved" status.
-- =============================================================================
--
-- The Publish tab lets a user approve one generated document as the
-- accepted version; on approval every other document for that project is
-- deleted, leaving just the approved one. "approved" is distinct from
-- "published" (reserved for a future Confluence publish).

alter table public.generated_documents
  drop constraint if exists generated_documents_status_check;

alter table public.generated_documents
  add constraint generated_documents_status_check
    check (status in ('draft', 'reviewed', 'published', 'approved'));
