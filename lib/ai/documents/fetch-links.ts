/**
 * Fetch the content behind fetchable document links so it can ground
 * document generation (PRFAQ, etc.).
 *
 * v1 scope is deliberately narrow: **GitHub Markdown only**. A GitHub
 * "blob" URL (github.com/{owner}/{repo}/blob/{ref}/{path}.md) is rewritten
 * to its raw.githubusercontent.com equivalent and fetched server-side;
 * already-raw URLs pass through. Anything that is not a single Markdown /
 * text file on GitHub is skipped — this keeps the SSRF surface bounded to
 * one host and avoids HTML-to-text extraction.
 *
 * Failures never break generation: a link that 404s, times out, or is too
 * large is logged and dropped, and the document is generated from whatever
 * else is available (the section falls back to "To be determined").
 *
 * Private repositories resolve only when GITHUB_TOKEN is set in the
 * environment; without it, only public repos are reachable.
 */

import type { DocumentLink } from "@/lib/db";

/** A linked document whose content was successfully fetched. */
export interface LinkedDoc {
  label: string;
  url: string;
  content: string;
}

/** Per-fetch network timeout. Kept short so a slow host can't stall a
 * serverless generation request. */
const FETCH_TIMEOUT_MS = 5_000;
/** Max bytes read per document; content beyond this is truncated. */
const MAX_BYTES = 100 * 1024;
/** Max number of links fetched per generation, newest-listed first. */
const MAX_DOCS = 5;

const MARKDOWN_EXTENSIONS = [".md", ".markdown", ".txt"];

/**
 * Resolve a document-link URL to a fetchable raw Markdown URL, or null if
 * it isn't one. Handles:
 *   - github.com/{owner}/{repo}/blob/{ref}/{path}.md  -> raw URL
 *   - raw.githubusercontent.com/.../{path}.md         -> passthrough
 * Query strings and fragments are dropped. Non-GitHub hosts and
 * non-Markdown paths return null.
 */
export function githubBlobToRaw(url: string): string | null {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return null;
  }
  const host = u.hostname.toLowerCase();
  const path = u.pathname;

  const isMarkdownPath = MARKDOWN_EXTENSIONS.some((ext) =>
    path.toLowerCase().endsWith(ext),
  );
  if (!isMarkdownPath) return null;

  if (host === "raw.githubusercontent.com") {
    // Already raw — normalize away query/hash and return.
    return `https://raw.githubusercontent.com${path}`;
  }

  if (host === "github.com" || host === "www.github.com") {
    // /{owner}/{repo}/blob/{ref}/{path...}
    const segments = path.split("/").filter(Boolean);
    if (segments.length >= 5 && segments[2] === "blob") {
      const [owner, repo, , ref, ...rest] = segments;
      const filePath = rest.join("/");
      return `https://raw.githubusercontent.com/${owner}/${repo}/${ref}/${filePath}`;
    }
    return null;
  }

  return null;
}

/** True when a link can be fetched as Markdown under the v1 GitHub scope. */
export function isFetchableMarkdown(link: DocumentLink): boolean {
  return githubBlobToRaw(link.url) !== null;
}

async function fetchOne(
  link: DocumentLink,
  rawUrl: string,
): Promise<LinkedDoc | null> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const headers: Record<string, string> = {
      Accept: "text/plain, text/markdown, */*",
      "User-Agent": "praxis-doc-generator",
    };
    const token = process.env.GITHUB_TOKEN?.trim();
    if (token) headers.Authorization = `Bearer ${token}`;

    const res = await fetch(rawUrl, {
      headers,
      signal: controller.signal,
      redirect: "follow",
    });
    if (!res.ok) {
      console.warn(
        `[documents/fetch-links] ${rawUrl} returned ${res.status}; skipping.`,
      );
      return null;
    }

    const raw = await res.text();
    const truncated =
      Buffer.byteLength(raw, "utf8") > MAX_BYTES
        ? raw.slice(0, MAX_BYTES) + "\n\n…(truncated)"
        : raw;
    const content = truncated.trim();
    if (!content) return null;
    return { label: link.label, url: link.url, content };
  } catch (err) {
    const reason =
      err instanceof Error && err.name === "AbortError"
        ? `timed out after ${FETCH_TIMEOUT_MS}ms`
        : err instanceof Error
          ? err.message
          : String(err);
    console.warn(`[documents/fetch-links] ${rawUrl} failed: ${reason}.`);
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fetch the content of every fetchable Markdown link (up to MAX_DOCS).
 * Non-fetchable links are ignored. Never throws — unreachable links are
 * simply absent from the result.
 */
export async function fetchLinkedDocs(
  links: DocumentLink[],
): Promise<LinkedDoc[]> {
  const fetchable = links
    .map((link) => ({ link, rawUrl: githubBlobToRaw(link.url) }))
    .filter((x): x is { link: DocumentLink; rawUrl: string } =>
      Boolean(x.rawUrl),
    )
    .slice(0, MAX_DOCS);

  const results = await Promise.all(
    fetchable.map(({ link, rawUrl }) => fetchOne(link, rawUrl)),
  );
  return results.filter((d): d is LinkedDoc => d !== null);
}
