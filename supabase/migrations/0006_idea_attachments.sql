-- =============================================================================
-- Idea submissions can carry attachments — public submitters can upload
-- screenshots, Office docs, PDFs, and small CSVs alongside their idea.
-- =============================================================================
--
-- Schema change: a single jsonb column on public.ideas, storing an array
-- of attachment descriptors. Each entry mirrors the shape of
-- DocumentLink / ExternalDependency rows — flexible jsonb so we can
-- extend without a migration if we ever need to record more metadata
-- (e.g. virus-scan result, OCR text).
--
--   {
--     "id":            "<uuid>",
--     "filename":      "screenshot.png",
--     "storage_path":  "<idea_id>/<file-uuid>-<safe-filename>",
--     "content_type":  "image/png",
--     "size_bytes":    104857,
--     "uploaded_at":   "<ISO timestamp>"
--   }
--
-- Storage: a private 'idea-attachments' bucket. Anonymous submitters
-- never get direct write access — the public submission route uploads
-- via the service-role key. Admin reviewers download via short-lived
-- signed URLs minted server-side.

alter table public.ideas
  add column if not exists attachments jsonb not null default '[]'::jsonb;

-- Create the storage bucket if it doesn't already exist. Inserting
-- into storage.buckets is idempotent via ON CONFLICT on the primary
-- key (id). `public = false` means no anonymous read access; URLs
-- must be signed.
insert into storage.buckets (id, name, public)
values ('idea-attachments', 'idea-attachments', false)
on conflict (id) do nothing;
