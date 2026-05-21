/**
 * Server-only attachment operations: upload, delete, and signed-URL
 * minting. Kept separate from `attachments.ts` because the
 * server-side imports (Supabase service-role client, `node:crypto`
 * via `lib/db/store`) can't be bundled into client code. The submit
 * form imports the validators and constants from `attachments.ts`
 * directly; this module is only reached from API routes and the
 * service layer.
 */

import { newUuid, nowIso } from "@/lib/db/store";
import type { IdeaAttachment, IdeaId } from "@/lib/db";
import { getServiceRoleClient } from "@/lib/supabase/server";
import {
  ATTACHMENTS_BUCKET,
  type ValidatedAttachment,
} from "./attachments";

/**
 * Upload a validated attachment to the bucket and return the
 * IdeaAttachment record that should be appended to the idea.
 *
 * The caller is responsible for cleanup on partial-batch failure
 * (see deleteAttachments). We don't try-catch around the upload
 * here because the caller needs to know which file failed.
 */
export async function uploadAttachment(
  ideaId: IdeaId,
  v: ValidatedAttachment,
): Promise<IdeaAttachment> {
  const fileId = newUuid();
  const storagePath = `${ideaId}/${fileId}-${v.safeFilename}`;

  const buffer = await v.file.arrayBuffer();

  const { error } = await getServiceRoleClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .upload(storagePath, buffer, {
      contentType: v.contentType,
      cacheControl: "3600",
      upsert: false,
    });
  if (error) {
    throw new Error(`Failed to upload ${v.file.name}: ${error.message}`);
  }

  return {
    id: fileId,
    filename: v.file.name,
    storage_path: storagePath,
    content_type: v.contentType,
    size_bytes: v.file.size,
    uploaded_at: nowIso(),
  };
}

/**
 * Best-effort deletion of one or more attachments from the bucket.
 * Used during partial-upload cleanup and on idea delete. Errors are
 * logged but not thrown — orphan storage objects are recoverable; a
 * deletion failure shouldn't block the broader operation.
 */
export async function deleteAttachments(paths: string[]): Promise<void> {
  if (paths.length === 0) return;
  const { error } = await getServiceRoleClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .remove(paths);
  if (error) {
    console.warn(
      `[attachments] best-effort delete failed: ${error.message}`,
    );
  }
}

/**
 * Mint a short-lived signed URL for downloading one attachment.
 * Used by the admin Idea Review page when a reviewer clicks
 * Download. URLs expire after 5 minutes — long enough to start the
 * download, short enough that a leaked URL can't be passed around.
 */
export async function getDownloadUrl(
  storagePath: string,
  options: { expiresInSeconds?: number; downloadFilename?: string } = {},
): Promise<string> {
  const expiresIn = options.expiresInSeconds ?? 300;
  const { data, error } = await getServiceRoleClient()
    .storage.from(ATTACHMENTS_BUCKET)
    .createSignedUrl(storagePath, expiresIn, {
      download: options.downloadFilename ?? true,
    });
  if (error) {
    throw new Error(
      `Failed to mint signed URL for ${storagePath}: ${error.message}`,
    );
  }
  return data.signedUrl;
}
