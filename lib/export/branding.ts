/**
 * Branding helpers for the PPTX export (Section 5.9).
 *
 * The `BrandingConfig` shape lives in `lib/db/types.ts` and is configured
 * through the Admin Console (Step 5b. of Section 9 / Section 5.19). At
 * export time we need to:
 *
 *   - resolve color strings to the format pptxgenjs expects (RRGGBB hex,
 *     no leading "#");
 *   - fall back gracefully when the admin hasn't customized the brand
 *     yet (`primary_color` / `secondary_color` / `font` always have
 *     values from the settings defaults, but a hand-edited settings
 *     file could break that);
 *   - keep the font name in a single place so every slide builder uses
 *     the same family.
 *
 * The logo URL is loaded server-side and embedded as a data URL — we
 * don't want PowerPoint making outbound requests when the deck is
 * opened. Logo handling lives in the API route since it needs `fetch`
 * and `Buffer`; this module stays platform-neutral.
 */

import type { BrandingConfig } from "@/lib/db";

/** A subset of branding values normalized for pptxgenjs. */
export interface ResolvedBranding {
  /** RRGGBB hex, no leading "#". Used as the deck accent color. */
  primaryHex: string;
  /** RRGGBB hex, no leading "#". Used for highlights and quadrant lines. */
  secondaryHex: string;
  /** Family name passed to pptxgenjs `fontFace` props. */
  fontFace: string;
}

/** Last-resort defaults if the settings record is empty or malformed. */
const FALLBACK: ResolvedBranding = {
  primaryHex: "1F2937",
  secondaryHex: "3B82F6",
  fontFace: "Inter",
};

/**
 * Convert a color string like "#1f2937", "1f2937", or "rgb(...)" into the
 * RRGGBB hex (uppercase, no `#`) that pptxgenjs expects. Returns the
 * given fallback when the string isn't parseable, so a typo'd brand color
 * never breaks the export.
 */
export function toPptxHex(color: string, fallback: string): string {
  if (!color) return fallback;
  const trimmed = color.trim();
  // "#rrggbb" or "rrggbb" — already hex, just drop the hash and uppercase.
  const hex6 = /^#?([0-9a-fA-F]{6})$/.exec(trimmed);
  if (hex6) return hex6[1].toUpperCase();
  // "#rgb" or "rgb" — expand to 6 chars.
  const hex3 = /^#?([0-9a-fA-F]{3})$/.exec(trimmed);
  if (hex3) {
    const [r, g, b] = hex3[1].split("");
    return `${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }
  // "rgb(r, g, b)" — useful when copy-pasted from CSS dev tools.
  const rgb = /^rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(trimmed);
  if (rgb) {
    const [, r, g, b] = rgb;
    const toHex = (n: string) =>
      Number(n).toString(16).padStart(2, "0").toUpperCase();
    return `${toHex(r)}${toHex(g)}${toHex(b)}`;
  }
  return fallback;
}

/**
 * Resolve a `BrandingConfig` (from `SettingsRepository`) into the shape
 * the slide builders consume. Every slide builder takes one of these
 * rather than the raw config, so adding a new branding field is a
 * one-place edit.
 */
export function resolveBranding(config: BrandingConfig): ResolvedBranding {
  return {
    primaryHex: toPptxHex(config.primary_color, FALLBACK.primaryHex),
    secondaryHex: toPptxHex(config.secondary_color, FALLBACK.secondaryHex),
    fontFace: config.font?.trim() || FALLBACK.fontFace,
  };
}

/**
 * Resolve, but with explicit overrides — used when the export modal
 * lets the user tweak a color for one deck without editing the
 * org-wide settings. Each override is optional; missing ones fall
 * back to the stored config.
 */
export function resolveBrandingWithOverrides(
  config: BrandingConfig,
  overrides: Partial<ResolvedBranding> = {},
): ResolvedBranding {
  const base = resolveBranding(config);
  return {
    primaryHex: overrides.primaryHex ?? base.primaryHex,
    secondaryHex: overrides.secondaryHex ?? base.secondaryHex,
    fontFace: overrides.fontFace ?? base.fontFace,
  };
}
