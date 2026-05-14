/**
 * Document-link validation (Section 5.14).
 *
 * Pure validators used by both the project and task services. A document
 * link is a labeled URL pointing at an external resource (a GitHub repo,
 * a Confluence page, a Figma board, etc.) and is stored as an array on
 * Project and Task records.
 *
 * The auto-detect heuristic (URL → link type) lives here too so it can be
 * shared between server-side normalization and the client-side editor that
 * pre-fills the type when a user pastes a URL.
 */

import type { DocumentLink, DocumentLinkType, UserId } from "@/lib/db";

/** All document-link types from `lib/db/types.ts`, validated against. */
export const DOCUMENT_LINK_TYPES: DocumentLinkType[] = [
  "GitHub Repo",
  "GitHub PR",
  "Confluence",
  "Network Drive",
  "SharePoint",
  "Figma",
  "Miro",
  "Jira Issue",
  "External",
  "Other",
];

/**
 * Heuristic mapping URL → DocumentLinkType. Used both server-side (when a
 * caller leaves `link_type` unset) and client-side (to pre-fill the editor
 * after the user pastes a URL). The order matters: more specific patterns
 * come first, so `github.com/.../pull/123` matches GitHub PR before falling
 * through to GitHub Repo.
 *
 * Note: there is no auto-detect rule for Network Drive — internal file
 * shares typically appear as UNC paths (`\\server\share\file`), `file://`
 * URLs, or domain-private hostnames that vary per organization. The user
 * picks "Network Drive" explicitly when needed.
 */
export function detectLinkType(url: string): DocumentLinkType {
  let host: string;
  let pathname = "";
  try {
    const u = new URL(url);
    host = u.hostname.toLowerCase();
    pathname = u.pathname.toLowerCase();
  } catch {
    return "External";
  }
  if (host.endsWith("github.com")) {
    return /\/pull\//.test(pathname) ? "GitHub PR" : "GitHub Repo";
  }
  if (host.endsWith("atlassian.net") || host.endsWith("jira.com")) {
    return /\/browse\//.test(pathname) ? "Jira Issue" : "Confluence";
  }
  if (host.endsWith("confluence.com")) return "Confluence";
  if (host.endsWith("sharepoint.com") || host.endsWith("onedrive.live.com")) {
    return "SharePoint";
  }
  if (host.endsWith("figma.com")) return "Figma";
  if (host.endsWith("miro.com")) return "Miro";
  return "External";
}

export class LinkValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "LinkValidationError";
  }
}

/**
 * Validate and normalize an array of document links. Accepts a loose
 * `unknown` payload (the validator is reused across project and task
 * services where the inbound shape isn't pre-narrowed) and returns a
 * fully-typed `DocumentLink[]` ready to persist.
 *
 * `existing` carries the previously-saved links for this entity; we use
 * it to preserve `added_by` and `added_at` on rows that already exist
 * (matched by URL). New rows get the current user's id and the current
 * timestamp.
 */
export function validateDocumentLinks(
  raw: unknown,
  existing: DocumentLink[],
  ctx: { userId: UserId; now: string },
): DocumentLink[] {
  if (raw === undefined || raw === null) return existing;
  if (!Array.isArray(raw)) {
    throw new LinkValidationError("document_links must be an array.");
  }

  const existingByUrl = new Map(existing.map((l) => [l.url, l]));
  const out: DocumentLink[] = [];
  const seen = new Set<string>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "object" || item === null) {
      throw new LinkValidationError(
        `document_links[${i}] must be an object.`,
      );
    }
    const r = item as Record<string, unknown>;

    const url = typeof r.url === "string" ? r.url.trim() : "";
    if (!url) {
      throw new LinkValidationError(
        `document_links[${i}].url is required.`,
      );
    }
    // URL parses are intentionally lenient (we don't require https://) so
    // shorthand internal URLs like `localhost:3000/x` work in dev. We do
    // require *something* parseable as a URL with a host or a relative path.
    try {
      // Throws on truly malformed strings; relative paths slip through, which
      // is what we want for internal references.
      new URL(url, "https://example.test/");
    } catch {
      throw new LinkValidationError(
        `document_links[${i}].url is not a valid URL.`,
      );
    }
    if (seen.has(url)) {
      throw new LinkValidationError(
        `document_links[${i}] duplicates URL ${url}.`,
      );
    }
    seen.add(url);

    const label =
      typeof r.label === "string" && r.label.trim()
        ? r.label.trim()
        : url;

    let link_type: DocumentLinkType;
    if (typeof r.link_type === "string") {
      if (!(DOCUMENT_LINK_TYPES as string[]).includes(r.link_type)) {
        throw new LinkValidationError(
          `document_links[${i}].link_type must be one of: ${DOCUMENT_LINK_TYPES.join(", ")}.`,
        );
      }
      link_type = r.link_type as DocumentLinkType;
    } else {
      link_type = detectLinkType(url);
    }

    const prior = existingByUrl.get(url);
    out.push({
      label,
      url,
      link_type,
      // Preserve provenance on rows the user didn't touch. New rows are
      // tagged with the current user + now so the audit trail stays honest.
      added_by: prior?.added_by ?? ctx.userId,
      added_at: prior?.added_at ?? ctx.now,
    });
  }

  return out;
}
