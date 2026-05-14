/**
 * PPTX template loading (Section 5.9, branding hook).
 *
 * The export deck inherits brand identity from a swappable template stored
 * at `public/branding/template.pptx` (overridable via the
 * `PRAXIS_PPTX_TEMPLATE_PATH` environment variable). Living under
 * `public/` is what makes the templates ship with the Next.js build
 * output — `data/` is gitignored at the JSON-file level and isn't
 * included in the serverless deployment bundle. The trade-off: the
 * raw template files are also reachable at
 * `/branding/template.pptx`, which is fine for brand assets (no
 * secrets), and saves us from configuring outputFileTracingIncludes.
 *
 * The template's theme XML is parsed at request time to extract:
 *
 *   - primary and secondary colors (from the theme color scheme)
 *   - typeface (from the theme font scheme)
 *
 * These feed the same `ResolvedBranding` shape the slide builders already
 * consume, so updating the template visually re-skins every slide without
 * code changes.
 *
 * In addition, three pre-rendered PNGs may live alongside the template:
 *
 *   - `cover.png`    — used as a full-bleed background on the title slide
 *   - `content.png`  — used as a full-bleed background on every native slide
 *                      (Now/Next/Later, Projects status, Blocked/At-Risk,
 *                      Velocity); the slide builder draws content on top
 *   - `closing.png`  — reserved for a future closing/thank-you slide
 *
 * The PNGs come from the template directly: `npm run prepare:branding`
 * (libreoffice-based) renders them. Runtime never depends on libreoffice.
 *
 * If the template file is missing or unparseable, we fall back to the
 * `BrandingConfig` stored in settings.json. The export still works; it
 * just looks like the previous code-built deck.
 *
 * Performance: parsing a ~10 MB template every request is wasteful. We
 * cache the parsed result in module scope keyed on the file's mtime so a
 * template swap is picked up on the next request without a server
 * restart.
 */

import fs from "node:fs/promises";
import path from "node:path";

import type { BrandingConfig } from "@/lib/db";
import {
  resolveBrandingWithOverrides,
  toPptxHex,
  type ResolvedBranding,
} from "@/lib/export/branding";

// ---------------------------------------------------------------------------
// Paths
// ---------------------------------------------------------------------------

const DEFAULT_TEMPLATE_DIR = path.join(process.cwd(), "public", "branding");

function templateDir(): string {
  return process.env.PRAXIS_PPTX_TEMPLATE_DIR?.trim() || DEFAULT_TEMPLATE_DIR;
}

function templatePath(): string {
  const explicit = process.env.PRAXIS_PPTX_TEMPLATE_PATH?.trim();
  if (explicit) return explicit;
  return path.join(templateDir(), "template.pptx");
}

function coverImagePath(): string {
  return path.join(templateDir(), "cover.png");
}

function contentImagePath(): string {
  return path.join(templateDir(), "content.png");
}

// ---------------------------------------------------------------------------
// Theme parsing
// ---------------------------------------------------------------------------

interface ParsedTheme {
  /** First color from the scheme that's brand-shaped (accent1, dk2, …). */
  primaryHex: string;
  /** Second color — used for secondary accents (accent2). */
  secondaryHex: string;
  /** majorFont latin typeface from the theme (`Arial`, `Calibri`, …). */
  fontFace: string;
}

/**
 * Pull the theme XML out of the .pptx (which is a zip), then read the
 * color scheme and font scheme. We do the zip read by hand rather than
 * pulling in a dependency — pptxgenjs ships JSZip transitively, but
 * importing it from the export route would couple this module to a
 * specific pptxgenjs internal layout. The theme XML is small enough that
 * a hand-rolled extraction is fine.
 */
async function parseThemeFromPptx(filePath: string): Promise<ParsedTheme> {
  // Lazy-load JSZip so the import doesn't pay for it on cold starts that
  // never hit the export route. JSZip is already on disk via pptxgenjs.
  const JSZipModule = (await import("jszip")) as unknown as {
    default: typeof import("jszip");
  };
  const JSZip = JSZipModule.default ?? JSZipModule;

  const buf = await fs.readFile(filePath);
  const zip = await JSZip.loadAsync(buf);
  const themeFile = zip.file("ppt/theme/theme1.xml");
  if (!themeFile) {
    throw new Error("Template is missing ppt/theme/theme1.xml.");
  }
  const xml = await themeFile.async("string");

  // Color scheme. We pull accent1 as the primary brand color (matches the
  // convention PowerPoint themes use — accent1 is the deck's signature
  // color) and accent2 as the secondary. Falls back to dk2 if accent1
  // happens to be missing.
  const primaryHex =
    findHexInScheme(xml, "accent1") ??
    findHexInScheme(xml, "dk2") ??
    "1F2937";
  const secondaryHex =
    findHexInScheme(xml, "accent2") ??
    findHexInScheme(xml, "accent3") ??
    "3B82F6";

  // Font scheme. majorFont is the heading face; minorFont is body text.
  // We use majorFont as the deck-wide font since pptxgenjs treats fontFace
  // as a single value per text block; PowerPoint theme inheritance handles
  // the body/heading split downstream when the user opens the file.
  const fontFace = findMajorFont(xml) ?? "Arial";

  return { primaryHex, secondaryHex, fontFace };
}

/**
 * Locate `<a:srgbClr val="RRGGBB"/>` inside a named color slot
 * (`<a:accent1>`, `<a:dk2>`, etc.). Returns null if not found or if the
 * slot uses `<a:sysClr>` only — PowerPoint's `sysClr` falls back to the
 * `lastClr` attribute, which we honor as a secondary lookup.
 */
function findHexInScheme(xml: string, slotName: string): string | null {
  // Match the slot's full element including children: <a:slot>...</a:slot>.
  // The regex is intentionally simple — themes are tightly schema-bound,
  // so attributes like xmlns prefixes are stable. If a hand-edited theme
  // breaks the parser, we fall back to the next candidate.
  const slot = new RegExp(
    `<a:${slotName}>([\\s\\S]*?)<\\/a:${slotName}>`,
    "i",
  ).exec(xml);
  if (!slot) return null;
  const inner = slot[1];

  const srgb = /<a:srgbClr\s+val="([0-9A-Fa-f]{6})"/.exec(inner);
  if (srgb) return srgb[1].toUpperCase();

  const sys = /<a:sysClr[^>]*lastClr="([0-9A-Fa-f]{6})"/.exec(inner);
  if (sys) return sys[1].toUpperCase();

  return null;
}

/**
 * Pull the `latin typeface=…` attribute out of `<a:majorFont>` in the
 * theme's font scheme.
 */
function findMajorFont(xml: string): string | null {
  const major = /<a:majorFont>([\s\S]*?)<\/a:majorFont>/i.exec(xml);
  if (!major) return null;
  const latin = /<a:latin\s+typeface="([^"]+)"/i.exec(major[1]);
  return latin ? latin[1].trim() : null;
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Resolved branding plus optional pre-rendered template assets. The
 * builder code uses `coverImageDataUrl` and `contentImageDataUrl` as
 * full-bleed backgrounds when present, falling back to code-drawn
 * backgrounds otherwise.
 */
export interface TemplateBranding extends ResolvedBranding {
  /**
   * Optional `data:image/png;base64,…` encoding of the template's cover
   * page. Used by `addTitleSlide` as a full-bleed background.
   */
  coverImageDataUrl?: string;
  /**
   * Optional `data:image/png;base64,…` encoding of the template's basic
   * content page (the page with the NiCE wordmark in the lower right).
   * Used as a full-bleed background on every native content slide.
   */
  contentImageDataUrl?: string;
}

interface CacheEntry {
  mtimeMs: number;
  branding: TemplateBranding;
}
let cache: CacheEntry | null = null;

/**
 * Load template-derived branding. Falls back to the stored
 * `BrandingConfig` when the template file is absent or unreadable, so
 * existing setups without a template continue to work.
 *
 * `overrides` are applied on top of the template-derived values — the
 * Admin Console's per-export color/font overrides still take precedence,
 * which is what users expect when they explicitly tweak a deck.
 */
export async function loadTemplateBranding(
  storedConfig: BrandingConfig,
  overrides: { primaryHex?: string; secondaryHex?: string; fontFace?: string } = {},
): Promise<TemplateBranding> {
  const tplPath = templatePath();

  let parsed: ParsedTheme | null = null;
  let coverDataUrl: string | undefined;
  let contentDataUrl: string | undefined;

  try {
    const stat = await fs.stat(tplPath);
    if (cache && cache.mtimeMs === stat.mtimeMs) {
      // Cache hit — the file hasn't changed since we last parsed it.
      // Apply overrides on top of the cached values.
      return {
        primaryHex: overrides.primaryHex ?? cache.branding.primaryHex,
        secondaryHex: overrides.secondaryHex ?? cache.branding.secondaryHex,
        fontFace: overrides.fontFace ?? cache.branding.fontFace,
        coverImageDataUrl: cache.branding.coverImageDataUrl,
        contentImageDataUrl: cache.branding.contentImageDataUrl,
      };
    }

    parsed = await parseThemeFromPptx(tplPath);
    coverDataUrl = await readImageAsDataUrl(coverImagePath());
    contentDataUrl = await readImageAsDataUrl(contentImagePath());
  } catch (err) {
    // Missing file or parse failure: fall through to the stored config.
    // Log once with enough context to debug, but don't let it kill the
    // export — the previous code-drawn deck is a perfectly reasonable
    // fallback.
    console.warn(
      `[pptx template] could not load ${tplPath} — falling back to stored branding. ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
  }

  const baseFromConfig = resolveBrandingWithOverrides(storedConfig);
  const branding: TemplateBranding = {
    primaryHex:
      overrides.primaryHex ??
      parsed?.primaryHex ??
      baseFromConfig.primaryHex,
    secondaryHex:
      overrides.secondaryHex ??
      parsed?.secondaryHex ??
      baseFromConfig.secondaryHex,
    fontFace:
      overrides.fontFace ?? parsed?.fontFace ?? baseFromConfig.fontFace,
    coverImageDataUrl: coverDataUrl,
    contentImageDataUrl: contentDataUrl,
  };

  // Cache the parsed-from-template values without overrides applied, so
  // future requests with different overrides still hit the cache.
  if (parsed) {
    try {
      const stat = await fs.stat(tplPath);
      cache = {
        mtimeMs: stat.mtimeMs,
        branding: {
          primaryHex: parsed.primaryHex,
          secondaryHex: parsed.secondaryHex,
          fontFace: parsed.fontFace,
          coverImageDataUrl: coverDataUrl,
          contentImageDataUrl: contentDataUrl,
        },
      };
    } catch {
      // stat failure between the read and now is harmless — we just
      // skip caching and re-parse on the next request.
    }
  }

  // Apply explicit color hex normalization in case overrides came in as
  // "#abc" or "rgb(…)" strings rather than RRGGBB.
  return {
    primaryHex: toPptxHex(branding.primaryHex, branding.primaryHex),
    secondaryHex: toPptxHex(branding.secondaryHex, branding.secondaryHex),
    fontFace: branding.fontFace,
    coverImageDataUrl: branding.coverImageDataUrl,
    contentImageDataUrl: branding.contentImageDataUrl,
  };
}

/**
 * Read a file from disk and return it as a `data:image/<ext>;base64,…`
 * URL suitable for `<img src>` and pptxgenjs `addImage({ data: … })`.
 * Returns undefined if the file is missing.
 */
async function readImageAsDataUrl(filePath: string): Promise<string | undefined> {
  try {
    const buf = await fs.readFile(filePath);
    const ext = path.extname(filePath).toLowerCase().replace(".", "") || "png";
    const mime = ext === "jpg" || ext === "jpeg" ? "image/jpeg" : `image/${ext}`;
    return `data:${mime};base64,${buf.toString("base64")}`;
  } catch {
    return undefined;
  }
}

/**
 * Test hook: clear the template cache. Used by smoke tests so a swapped
 * template is picked up immediately without waiting for an mtime change
 * (which can collide on fast filesystems).
 */
export function _resetTemplateCacheForTests(): void {
  cache = null;
}
