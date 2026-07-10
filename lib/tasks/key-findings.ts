/**
 * Sanitization for task key findings.
 *
 * Key findings accept pasted rich content (headings, lists, and — the
 * reason this exists — tables) from Word, Excel, or another tool. That
 * markup is rendered back with `dangerouslySetInnerHTML`, so it MUST be
 * sanitized before it is ever stored. This runs server-side in the
 * service (the source of truth), so even a hand-crafted API request
 * can't persist a script payload.
 *
 * The allowlist is intentionally narrow: structural + inline formatting
 * and tables, nothing that can execute or load external resources.
 * `script` / `style` and their contents, `on*` handlers, and non-http
 * URL schemes are dropped by default.
 */

import sanitizeHtml from "sanitize-html";

const OPTIONS: sanitizeHtml.IOptions = {
  allowedTags: [
    // structure / blocks
    "h1",
    "h2",
    "h3",
    "h4",
    "h5",
    "h6",
    "p",
    "br",
    "hr",
    "blockquote",
    "pre",
    "code",
    // inline
    "strong",
    "b",
    "em",
    "i",
    "u",
    "s",
    "span",
    "a",
    // lists
    "ul",
    "ol",
    "li",
    // tables
    "table",
    "thead",
    "tbody",
    "tfoot",
    "tr",
    "th",
    "td",
    "caption",
    "colgroup",
    "col",
  ],
  allowedAttributes: {
    a: ["href", "title", "target", "rel"],
    td: ["colspan", "rowspan"],
    th: ["colspan", "rowspan", "scope"],
    col: ["span"],
  },
  // Only safe link schemes; drops javascript:, data:, etc.
  allowedSchemes: ["http", "https", "mailto"],
  // Force external links to open safely, and never leak the referrer to
  // an attacker-controlled target.
  transformTags: {
    a: sanitizeHtml.simpleTransform(
      "a",
      { rel: "noopener noreferrer", target: "_blank" },
      true,
    ),
  },
};

/**
 * Sanitize pasted HTML for storage as a key finding. Returns trusted
 * markup. Returns an empty string for content that is empty once tags
 * and whitespace are stripped, so callers can reject no-op findings.
 */
export function sanitizeKeyFindingHtml(input: string): string {
  const clean = sanitizeHtml(input ?? "", OPTIONS).trim();
  // Guard against "empty" findings: markup with no visible text and no
  // table (an empty <p></p>, stray <br>, etc.).
  const hasText = sanitizeHtml(clean, { allowedTags: [], allowedAttributes: {} })
    .replace(/\s+/g, "")
    .length > 0;
  const hasTable = /<table[\s>]/i.test(clean);
  return hasText || hasTable ? clean : "";
}
