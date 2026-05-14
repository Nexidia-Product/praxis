/**
 * Catalog of slide types available in the PPTX export (Section 5.9).
 *
 * Centralized so the export modal, the API route, and any future consumer
 * (CLI, scheduled job) all use the same names, ordering, and category
 * split. Adding a new slide is a one-place change here, plus a builder
 * function on the API side.
 *
 * Two categories:
 *
 *   - `native`   The slide is built directly with pptxgenjs primitives
 *                on the server. No client-side capture is needed; the
 *                slide is fully reproducible from the project data and
 *                the configured filters.
 *
 *   - `raster`   The slide is a screenshot of a rendered roadmap view.
 *                The client uses html2canvas at 2x device pixel ratio
 *                (Section 5.9 implementation notes) and POSTs the data
 *                URL to the API along with the rest of the export
 *                config.
 *
 * The `view` field on raster slides identifies which roadmap view to
 * render off-screen and capture. Native slides leave `view` as null.
 */

import type { RoadmapView } from "@/lib/roadmap/views";

/** Stable identifier for one slide kind. */
export type SlideKind =
  | "title"
  | "timeline"
  | "kanban"
  | "bubble"
  | "now-next-later"
  | "projects-status"
  | "blocked-at-risk"
  | "velocity";

export type SlideCategory = "native" | "raster";

export interface SlideTypeDef {
  kind: SlideKind;
  label: string;
  /** One-sentence description shown next to the picker checkbox. */
  description: string;
  category: SlideCategory;
  /**
   * For raster slides, the roadmap view the off-screen renderer should
   * mount and capture. Null for native slides.
   */
  view: RoadmapView | null;
  /**
   * Whether this slide is selected by default when the user opens the
   * export modal. We pre-check the high-leverage ones (Title, Timeline,
   * Now/Next/Later, Status, Blocked) and leave the others off so a casual
   * "Export Deck" click doesn't dump nine slides on someone who wanted
   * three.
   */
  defaultOn: boolean;
}

/**
 * The full catalog. Order is the order slides appear in the deck — Title
 * first, then visual roadmap slides in the same order as the on-page
 * tab strip, then the native summary slides at the end, and finally the
 * Velocity slide (Section 5.15) which sits last because it's a
 * historical analytics view rather than a roadmap snapshot.
 *
 * Section 5.9 also lists "AI Priority Recommendation" (Step 10). That
 * lands in this catalog when the underlying feature ships; this file is
 * the one to edit.
 */
export const SLIDE_TYPES: SlideTypeDef[] = [
  {
    kind: "title",
    label: "Title slide",
    description: "Cover slide with deck title, date, and team name.",
    category: "native",
    view: null,
    defaultOn: true,
  },
  {
    kind: "timeline",
    label: "Timeline (Gantt)",
    description: "Project bars across the chosen date range.",
    category: "raster",
    view: "timeline",
    defaultOn: true,
  },
  {
    kind: "kanban",
    label: "Kanban board",
    description: "Current Kanban configuration as a column board.",
    category: "raster",
    view: "kanban",
    defaultOn: false,
  },
  {
    kind: "bubble",
    label: "Portfolio bubble chart",
    description: "Two-axis scatter for portfolio review meetings.",
    category: "raster",
    view: "bubble",
    defaultOn: false,
  },
  {
    kind: "now-next-later",
    label: "Now / Next / Later",
    description: "Three-column horizon roadmap (rendered natively).",
    category: "native",
    view: null,
    defaultOn: true,
  },
  {
    kind: "projects-status",
    label: "Projects status summary",
    description: "Table of open projects with status, lead, target.",
    category: "native",
    view: null,
    defaultOn: true,
  },
  {
    kind: "blocked-at-risk",
    label: "Blocked / at-risk",
    description: "Projects and tasks that are blocked or past due.",
    category: "native",
    view: null,
    defaultOn: true,
  },
  {
    kind: "velocity",
    label: "Velocity & throughput",
    description: "Top historical metrics: completions, avg duration, throughput.",
    category: "native",
    view: null,
    defaultOn: false,
  },
];

export function findSlideType(kind: string): SlideTypeDef | null {
  return SLIDE_TYPES.find((s) => s.kind === kind) ?? null;
}

/** Filter the catalog to only the slides whose kind is in the given set. */
export function selectedSlides(
  kinds: ReadonlySet<SlideKind>,
): SlideTypeDef[] {
  // Preserve catalog order regardless of the order kinds were provided in.
  return SLIDE_TYPES.filter((s) => kinds.has(s.kind));
}

export function isSlideKind(value: string): value is SlideKind {
  return SLIDE_TYPES.some((s) => s.kind === value);
}
