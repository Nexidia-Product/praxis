/**
 * Idea submission attachments — validation, storage, retrieval.
 *
 * The public submission flow is anonymous and rate-limited; this
 * module is the single chokepoint where uploaded files are checked
 * against a server-side allowlist before any bytes touch Supabase
 * Storage. Client-side `accept=` is convenience only — the
 * authoritative gate lives here.
 *
 * Constraints (kept tight because of Vercel's 4.5 MB serverless
 * function body limit and the unauthenticated nature of the route):
 *
 *   - Max 5 files per submission.
 *   - Max 4 MB per file (4_194_304 bytes).
 *   - Max 4 MB total across all files (the body cap still applies;
 *     this number leaves a little headroom for the idea fields).
 *   - MIME type must match the allowlist below (Office, images, PDF,
 *     plaintext / CSV). Anything else is rejected at validation.
 *
 * Storage layout: `<idea_id>/<file-uuid>-<safe-filename>` inside the
 * `idea-attachments` private bucket. The UUID prefix prevents
 * collisions when the same filename gets uploaded twice and stops
 * any path-traversal sequence in the original filename from
 * escaping the bucket.
 */

export const ATTACHMENTS_BUCKET = "idea-attachments" as const;

/** 4 MB. Each individual file must be at or below this size. */
export const MAX_FILE_SIZE_BYTES = 4 * 1024 * 1024;

/** 4 MB. Sum of all files in a submission must be at or below this. */
export const MAX_TOTAL_SIZE_BYTES = 4 * 1024 * 1024;

/** Most a public submitter can attach in one go. */
export const MAX_FILES_PER_SUBMISSION = 5;

/**
 * MIME types the public submission route will accept. Order is
 * documentation-only; the runtime check is a plain Set lookup.
 *
 * SVG is intentionally excluded — it can carry inline JavaScript
 * and the team has no use case for vector graphics on idea
 * submissions. Other image formats are inert when stored as bytes
 * and re-served with the right Content-Type.
 */
export const ALLOWED_MIME_TYPES: ReadonlySet<string> = new Set([
  // Office
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document", // .docx
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // .xlsx
  "application/vnd.openxmlformats-officedocument.presentationml.presentation", // .pptx
  "application/msword", // .doc
  "application/vnd.ms-excel", // .xls
  "application/vnd.ms-powerpoint", // .ppt

  // Images
  "image/png",
  "image/jpeg",
  "image/gif",
  "image/webp",

  // PDF
  "application/pdf",

  // Plain text / CSV
  "text/plain",
  "text/csv",
]);

/** File extensions for the client-side `accept` attribute. The browser
 * uses this for filtering only; the server still enforces the MIME
 * allowlist above. */
export const ALLOWED_ACCEPT_ATTR = [
  ".docx",
  ".xlsx",
  ".pptx",
  ".doc",
  ".xls",
  ".ppt",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".pdf",
  ".txt",
  ".csv",
].join(",");

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class AttachmentValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AttachmentValidationError";
  }
}

/**
 * Shape we accept at the validation boundary. Real `File` objects
 * from FormData satisfy this; tests can hand in plain objects with
 * the same fields.
 */
export interface IncomingAttachment {
  name: string;
  type: string;
  size: number;
  /**
   * Bytes. `File` provides this via `.arrayBuffer()`. Captured here
   * so the validator can be unit-tested without a DOM file.
   */
  arrayBuffer(): Promise<ArrayBuffer>;
}

export interface ValidatedAttachment {
  file: IncomingAttachment;
  safeFilename: string;
  contentType: string;
}

/**
 * Validate a set of incoming attachments. Throws
 * AttachmentValidationError on the first problem (caller surfaces
 * the message to the user). On success, returns a parallel array of
 * validated entries with a safe filename for storage.
 */
export function validateAttachments(
  files: IncomingAttachment[],
): ValidatedAttachment[] {
  if (files.length > MAX_FILES_PER_SUBMISSION) {
    throw new AttachmentValidationError(
      `Up to ${MAX_FILES_PER_SUBMISSION} files per submission.`,
    );
  }

  let total = 0;
  const out: ValidatedAttachment[] = [];
  for (const f of files) {
    if (!ALLOWED_MIME_TYPES.has(f.type)) {
      throw new AttachmentValidationError(
        `"${f.name}" has an unsupported file type (${f.type || "unknown"}). Allowed: Office docs, images (PNG/JPG/GIF/WEBP), PDF, plain text, CSV.`,
      );
    }
    if (f.size <= 0) {
      throw new AttachmentValidationError(`"${f.name}" is empty.`);
    }
    if (f.size > MAX_FILE_SIZE_BYTES) {
      throw new AttachmentValidationError(
        `"${f.name}" is ${formatBytes(f.size)} — max per file is ${formatBytes(MAX_FILE_SIZE_BYTES)}.`,
      );
    }
    total += f.size;
    if (total > MAX_TOTAL_SIZE_BYTES) {
      throw new AttachmentValidationError(
        `Combined attachment size exceeds ${formatBytes(MAX_TOTAL_SIZE_BYTES)}.`,
      );
    }

    out.push({
      file: f,
      safeFilename: sanitizeFilename(f.name),
      contentType: f.type,
    });
  }
  return out;
}

/**
 * Strip filename to a-z, 0-9, dots, dashes, underscores. Empty
 * result falls back to "file" so the storage path always has
 * something readable. Length-capped at 100 chars to keep the
 * storage key reasonable.
 */
export function sanitizeFilename(raw: string): string {
  const base = raw.split(/[/\\]/).pop() ?? "file";
  // Replace any character that isn't alphanumeric / dot / dash /
  // underscore with an underscore. Collapse consecutive underscores.
  const cleaned = base.replace(/[^A-Za-z0-9._-]/g, "_").replace(/_+/g, "_");
  const trimmed = cleaned.replace(/^[._]+|[._]+$/g, "");
  const result = trimmed === "" ? "file" : trimmed;
  return result.length > 100 ? result.slice(0, 100) : result;
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
}

// Storage operations (uploadAttachment, deleteAttachments,
// getDownloadUrl) live in `attachments-server.ts` so this module
// stays safe to import from client components.
