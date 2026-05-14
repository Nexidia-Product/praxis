/**
 * Wire types for the PPTX export endpoint (Section 5.9).
 *
 * The export flows in one direction (client POSTs config + raster
 * captures, server returns a binary `.pptx`), but the JSON payload is
 * shared by both sides — the client builds it, the server validates and
 * consumes it. Keeping the type definition in one place avoids the
 * drift that comes from defining `interface ExportRequest` twice.
 *
 * The request shape mirrors Section 5.9 of the design doc:
 *   - `slides`: which slide kinds to include
 *   - `filters`: filter set inherited from the active roadmap view
 *   - `dateRange`: configurable for the timeline slide
 *   - plus a deck title and a per-export branding override (Step 5b
 *     of Section 9).
 *
 * The `captures` map carries the html2canvas output for the raster
 * slides. Each entry is keyed by `SlideKind` and is a PNG data URL
 * (`data:image/png;base64,…`). Native slides are absent from this map
 * because the server constructs them from the project list directly.
 */

import type { RoadmapFilters } from "@/lib/roadmap/filters";
import type { SlideKind } from "./slide-types";

/** Inclusive ISO date range for the timeline slide. */
export interface ExportDateRange {
  start: string; // YYYY-MM-DD
  end: string; // YYYY-MM-DD
}

/** Optional per-export overrides on top of the stored branding config. */
export interface ExportBrandingOverrides {
  /** Hex color, with or without leading "#" — coerced server-side. */
  primary_color?: string;
  secondary_color?: string;
  font?: string;
}

/**
 * One html2canvas capture for a raster slide. Stored as a data URL so
 * a single JSON POST carries everything the server needs — no
 * separate file upload, no temp directory.
 */
export interface SlideCapture {
  /** PNG data URL (`data:image/png;base64,…`). */
  data_url: string;
  /** Pixel width of the captured canvas. */
  width: number;
  /** Pixel height of the captured canvas. */
  height: number;
}

export interface ExportPptxRequest {
  /** Deck title — appears on the title slide and in the filename. */
  title: string;
  /** Sub-title under the deck title, e.g. "Quarterly Roadmap Review". */
  subtitle?: string;
  /** Slide kinds to include. Each must appear in `SLIDE_TYPES`. */
  slides: SlideKind[];
  /** Inherited from the roadmap workspace filters. */
  filters: RoadmapFilters;
  /** Used by the timeline slide; optional. */
  dateRange?: ExportDateRange;
  /** Per-export branding overrides; optional. */
  branding?: ExportBrandingOverrides;
  /** Raster captures keyed by slide kind. Missing keys → slide is skipped. */
  captures?: Partial<Record<SlideKind, SlideCapture>>;
}

/**
 * Filename format from Section 5.9: `IIM_Roadmap_YYYY-MM-DD.pptx`. The
 * server always uses today's date, not the deck's date range, so two
 * exports run on the same day produce filenames that overwrite cleanly
 * if the user is saving to a folder.
 */
export function exportFilename(today: Date = new Date()): string {
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, "0");
  const d = String(today.getDate()).padStart(2, "0");
  return `Praxis_Roadmap_${y}-${m}-${d}.pptx`;
}
