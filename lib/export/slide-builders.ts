/**
 * Slide builders for the PPTX export (Section 5.9).
 *
 * Each function takes a `pptxgenjs` deck plus the data + branding it
 * needs and adds exactly one slide. The two categories from
 * `slide-types.ts` map to two builder styles:
 *
 *   - Native slides build text and shapes with `slide.addText` /
 *     `slide.addShape`. These read crisp at any zoom and the text stays
 *     selectable in PowerPoint, so the user can copy a status entry into
 *     a deck of their own.
 *
 *   - Raster slides take a PNG data URL (the html2canvas capture from
 *     the client) and embed it as a full-bleed image. The capture is
 *     produced at 2x device pixel ratio (Section 5.9 implementation
 *     notes) so retina displays don't see jaggies.
 *
 * The deck dimensions are pptxgenjs `LAYOUT_WIDE`, 13.333" × 7.5". Every
 * builder uses a uniform 0.5" margin and a 0.6" header band so the
 * slides feel like one deck, not eight.
 */

import type PptxGenJS from "pptxgenjs";

import {
  PRIORITIES,
  PROJECT_PHASES,
  PROJECT_STATUSES,
} from "@/lib/projects/display";
import { resolveBucket } from "@/lib/roadmap/placement";
import type {
  Project,
  ProjectStatus,
  Task,
} from "@/lib/db";
import type { ResolvedBranding } from "./branding";
import type { SlideCapture } from "./payload";

// ---------------------------------------------------------------------------
// Shared layout constants
// ---------------------------------------------------------------------------

/** Slide dimensions (inches) — pptxgenjs LAYOUT_WIDE. */
export const SLIDE_W = 13.333;
export const SLIDE_H = 7.5;

const MARGIN = 0.5;
const HEADER_H = 0.6;
const HEADER_GAP = 0.2;
/** Top edge of the body region, below the header band. */
const BODY_TOP = MARGIN + HEADER_H + HEADER_GAP;
const BODY_W = SLIDE_W - MARGIN * 2;
const BODY_H = SLIDE_H - BODY_TOP - MARGIN;

// Neutral palette used everywhere. Branding overrides primary/secondary
// only — we keep the gray scale fixed so contrast stays readable across
// brand colors.
const GRAY_900 = "111827";
const GRAY_700 = "374151";
const GRAY_500 = "6B7280";
const GRAY_300 = "D1D5DB";
const GRAY_200 = "E5E7EB";
const GRAY_100 = "F3F4F6";
const GRAY_50 = "F9FAFB";
const WHITE = "FFFFFF";

/** Status → background hex. Mirrors `STATUS_BADGE` semantically. */
const STATUS_FILL: Record<ProjectStatus, string> = {
  "Not Started": GRAY_200,
  "In Planning": "BAE6FD", // sky-200
  "In Progress": "A7F3D0", // emerald-200
  Blocked: "FECACA", // red-200
  "On Hold": "FDE68A", // amber-200
  Delayed: "FED7AA", // orange-200
  Completed: "6EE7B7", // emerald-300
  Canceled: GRAY_300,
};

const PRIORITY_FILL: Record<string, string> = {
  Critical: "FECACA",
  High: "FED7AA",
  Medium: "FDE68A",
  Low: GRAY_200,
};

// ---------------------------------------------------------------------------
// Header helper
// ---------------------------------------------------------------------------

/**
 * Add a consistent header to a slide: a thin colored bar, the slide title
 * on the left, and an optional subtitle on the right. Every non-title
 * slide calls this first so the deck reads as one cohesive document.
 */
/**
 * Apply the template-derived content background image to a slide, if one
 * was supplied. The NiCE basic-content layout is mostly empty space with
 * the wordmark in the lower-right and a slide number — both the title
 * accent bar and the body content rendered by the slide builders sit on
 * top without colliding.
 */
function setContentBackground(
  slide: PptxGenJS.Slide,
  branding: ResolvedBranding,
): void {
  // Cast: ResolvedBranding may be a TemplateBranding subtype carrying
  // image data URLs. Reading the optional field doesn't require the full
  // type to avoid a circular import between branding.ts and template.ts.
  const url = (branding as { contentImageDataUrl?: string })
    .contentImageDataUrl;
  if (url) {
    slide.background = { data: url };
  }
}

function addHeader(
  slide: PptxGenJS.Slide,
  branding: ResolvedBranding,
  title: string,
  rightText?: string,
): void {
  // Thin accent bar at the very top — branded color.
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: SLIDE_W,
    h: 0.08,
    fill: { color: branding.primaryHex },
    line: { type: "none" },
  });

  // Title.
  slide.addText(title, {
    x: MARGIN,
    y: MARGIN,
    w: BODY_W * 0.7,
    h: HEADER_H,
    fontFace: branding.fontFace,
    fontSize: 22,
    bold: true,
    color: GRAY_900,
    valign: "middle",
  });

  if (rightText) {
    slide.addText(rightText, {
      x: MARGIN + BODY_W * 0.7,
      y: MARGIN,
      w: BODY_W * 0.3,
      h: HEADER_H,
      fontFace: branding.fontFace,
      fontSize: 11,
      color: GRAY_500,
      valign: "middle",
      align: "right",
    });
  }

  // Hairline separator below the header.
  slide.addShape("line", {
    x: MARGIN,
    y: BODY_TOP - HEADER_GAP / 2,
    w: BODY_W,
    h: 0,
    line: { color: GRAY_200, width: 0.75 },
  });
}

/**
 * Render an "empty state" message in the body region. Used when the
 * filtered project list has nothing to show — better than an empty slide
 * the reviewer has to interpret.
 */
function addEmptyState(
  slide: PptxGenJS.Slide,
  branding: ResolvedBranding,
  message: string,
): void {
  slide.addText(message, {
    x: MARGIN,
    y: BODY_TOP + BODY_H * 0.4,
    w: BODY_W,
    h: 0.6,
    fontFace: branding.fontFace,
    fontSize: 14,
    color: GRAY_500,
    align: "center",
    italic: true,
  });
}

// ---------------------------------------------------------------------------
// Title slide
// ---------------------------------------------------------------------------

export interface TitleSlideOptions {
  title: string;
  subtitle?: string;
  /** Date string shown under the title — defaults to today, locale-formatted. */
  dateLabel?: string;
  /** Optional logo as a data URL or absolute URL. */
  logoDataUrl?: string;
  /**
   * Optional pre-rendered cover image (`data:image/png;base64,…`). When
   * supplied, the slide uses it as a full-bleed background and overlays
   * the title / subtitle / date in the upper-left quadrant where the
   * NiCE template leaves clear space. Falls back to the code-drawn
   * left-accent layout when omitted.
   */
  coverImageDataUrl?: string;
}

/**
 * Cover slide. With a `coverImageDataUrl` (e.g. NiCE template's cover
 * page rendered to PNG) the image fills the slide and the title overlays
 * it in white in the upper-left quadrant, where every NiCE cover layout
 * keeps clear space. Without one, the slide falls back to a code-drawn
 * accent block on the left and title on the right.
 */
export function addTitleSlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  opts: TitleSlideOptions,
): PptxGenJS.Slide {
  const slide = pptx.addSlide();

  if (opts.coverImageDataUrl) {
    // Full-bleed template image. The NiCE cover puts its brand mark in
    // the lower-right quadrant, so we anchor the title in the upper-left
    // — clear space, no clash. Text is white because the cover is a
    // saturated gradient; if a future template uses a light cover, the
    // user can pass a code-drawn cover (omit the image) instead.
    slide.background = { data: opts.coverImageDataUrl };

    slide.addText("INNOVATION INITIATIVE MANAGEMENT", {
      x: 0.6,
      y: 0.7,
      w: SLIDE_W - 1.2,
      h: 0.4,
      fontFace: branding.fontFace,
      fontSize: 13,
      bold: true,
      color: WHITE,
      charSpacing: 4,
    });

    slide.addText(opts.title, {
      x: 0.6,
      y: 1.5,
      w: SLIDE_W - 1.2,
      h: 1.6,
      fontFace: branding.fontFace,
      fontSize: 44,
      bold: true,
      color: WHITE,
      valign: "top",
    });

    if (opts.subtitle) {
      slide.addText(opts.subtitle, {
        x: 0.6,
        y: 3.2,
        w: SLIDE_W - 1.2,
        h: 0.7,
        fontFace: branding.fontFace,
        fontSize: 20,
        color: WHITE,
        valign: "top",
      });
    }

    const dateLabel = opts.dateLabel ?? defaultDateLabel(new Date());
    slide.addText(dateLabel, {
      x: 0.6,
      y: 4.0,
      w: SLIDE_W - 1.2,
      h: 0.4,
      fontFace: branding.fontFace,
      fontSize: 14,
      color: WHITE,
      valign: "top",
    });

    return slide;
  }

  // ── Code-drawn fallback (no template cover image available) ──
  // Left accent block — the deck's signature color.
  slide.addShape("rect", {
    x: 0,
    y: 0,
    w: 3.5,
    h: SLIDE_H,
    fill: { color: branding.primaryHex },
    line: { type: "none" },
  });

  // "INNOVATION INITIATIVE MANAGEMENT" eyebrow over the accent block,
  // in white so it reads on the brand color regardless of how dark
  // the brand color happens to be.
  slide.addText("INNOVATION INITIATIVE", {
    x: 0.5,
    y: 0.7,
    w: 3,
    h: 0.4,
    fontFace: branding.fontFace,
    fontSize: 13,
    bold: true,
    color: WHITE,
    charSpacing: 4,
  });
  slide.addText("MANAGEMENT", {
    x: 0.5,
    y: 1.05,
    w: 3,
    h: 0.4,
    fontFace: branding.fontFace,
    fontSize: 13,
    bold: true,
    color: WHITE,
    charSpacing: 4,
  });

  if (opts.logoDataUrl) {
    // Slot the logo in the lower left, sized to fit a reasonable square.
    slide.addImage({
      data: opts.logoDataUrl,
      x: 0.5,
      y: SLIDE_H - 1.6,
      w: 1.2,
      h: 1.2,
      sizing: { type: "contain", w: 1.2, h: 1.2 },
    });
  }

  // Title and subtitle on the right.
  slide.addText(opts.title, {
    x: 4.2,
    y: 2.2,
    w: SLIDE_W - 4.7,
    h: 1.4,
    fontFace: branding.fontFace,
    fontSize: 40,
    bold: true,
    color: GRAY_900,
    valign: "top",
  });

  if (opts.subtitle) {
    slide.addText(opts.subtitle, {
      x: 4.2,
      y: 3.7,
      w: SLIDE_W - 4.7,
      h: 0.6,
      fontFace: branding.fontFace,
      fontSize: 18,
      color: GRAY_700,
      valign: "top",
    });
  }

  const dateLabel = opts.dateLabel ?? defaultDateLabel(new Date());
  slide.addText(dateLabel, {
    x: 4.2,
    y: 4.5,
    w: SLIDE_W - 4.7,
    h: 0.4,
    fontFace: branding.fontFace,
    fontSize: 13,
    color: GRAY_500,
    valign: "top",
  });

  return slide;
}

function defaultDateLabel(d: Date): string {
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

// ---------------------------------------------------------------------------
// Raster slide (Timeline / Kanban / Bubble)
// ---------------------------------------------------------------------------

export interface RasterSlideOptions {
  /** Heading shown in the slide header. */
  title: string;
  /** Right-aligned context, e.g. an active filter summary. */
  rightHeader?: string;
  /** PNG data URL captured client-side via html2canvas. */
  capture: SlideCapture;
}

/**
 * Embed a html2canvas capture as the slide body. The capture is fitted
 * inside the body region while preserving aspect ratio — black bars are
 * preferable to a stretched chart.
 */
export function addRasterSlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  opts: RasterSlideOptions,
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  addHeader(slide, branding, opts.title, opts.rightHeader);

  const { width, height } = opts.capture;
  if (width <= 0 || height <= 0) {
    addEmptyState(
      slide,
      branding,
      "Capture was empty — try the export again from the active view.",
    );
    return slide;
  }

  const aspect = width / height;
  const bodyAspect = BODY_W / BODY_H;
  let imgW: number;
  let imgH: number;
  if (aspect > bodyAspect) {
    // Capture is wider than the body region — fit to width.
    imgW = BODY_W;
    imgH = imgW / aspect;
  } else {
    imgH = BODY_H;
    imgW = imgH * aspect;
  }
  const imgX = MARGIN + (BODY_W - imgW) / 2;
  const imgY = BODY_TOP + (BODY_H - imgH) / 2;

  slide.addImage({
    data: opts.capture.data_url,
    x: imgX,
    y: imgY,
    w: imgW,
    h: imgH,
  });

  return slide;
}

// ---------------------------------------------------------------------------
// Now / Next / Later (native)
// ---------------------------------------------------------------------------

/**
 * Three-column horizon view. Each column gets a header band with the
 * branded color and a vertically-stacked list of project cards. Long
 * lists clip with a "+N more" hint at the bottom of the column rather
 * than overflow off-slide; the same projects show up in full on the
 * Projects Status slide.
 */
export function addNowNextLaterSlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  projects: Project[],
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  setContentBackground(slide, branding);
  addHeader(
    slide,
    branding,
    "Now / Next / Later",
    `${projects.length} project${projects.length === 1 ? "" : "s"}`,
  );

  const columns: { label: string; bucket: "Now" | "Next" | "Later" }[] = [
    { label: "Now", bucket: "Now" },
    { label: "Next", bucket: "Next" },
    { label: "Later", bucket: "Later" },
  ];

  const colGap = 0.25;
  const colW = (BODY_W - colGap * (columns.length - 1)) / columns.length;
  const colHeaderH = 0.45;
  const colTop = BODY_TOP;

  // Group projects by their resolved bucket once. The slide
  // deliberately omits "Unplaced" projects — the horizon-roadmap
  // slide is for committed work; parked/unsigned items don't fit the
  // narrative and would dilute the message. Stakeholders who need
  // visibility into parked work should look at the live Now/Next/
  // Later view in-app.
  const byBucket = new Map<"Now" | "Next" | "Later", Project[]>([
    ["Now", []],
    ["Next", []],
    ["Later", []],
  ]);
  for (const p of projects) {
    const b = resolveBucket(p);
    if (b === "Now" || b === "Next" || b === "Later") {
      byBucket.get(b)!.push(p);
    }
  }

  // Sort each column by priority (Critical → Low) then name, so the
  // top of every column is the most important work.
  const priOrder: Record<string, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  };
  for (const list of byBucket.values()) {
    list.sort((a, b) => {
      const pa = priOrder[a.priority] ?? 9;
      const pb = priOrder[b.priority] ?? 9;
      if (pa !== pb) return pa - pb;
      return a.name.localeCompare(b.name);
    });
  }

  const cardH = 0.55;
  const cardGap = 0.1;
  const listTop = colTop + colHeaderH + 0.15;
  const listH = BODY_H - colHeaderH - 0.15;
  const maxCards = Math.max(1, Math.floor(listH / (cardH + cardGap)));

  columns.forEach((col, idx) => {
    const x = MARGIN + idx * (colW + colGap);

    // Column header band.
    slide.addShape("rect", {
      x,
      y: colTop,
      w: colW,
      h: colHeaderH,
      fill: { color: branding.primaryHex },
      line: { type: "none" },
    });
    const items = byBucket.get(col.bucket)!;
    slide.addText(`${col.label}  ·  ${items.length}`, {
      x: x + 0.15,
      y: colTop,
      w: colW - 0.3,
      h: colHeaderH,
      fontFace: branding.fontFace,
      fontSize: 13,
      bold: true,
      color: WHITE,
      valign: "middle",
    });

    // Subtle column background to delineate the lists.
    slide.addShape("rect", {
      x,
      y: listTop,
      w: colW,
      h: listH,
      fill: { color: GRAY_50 },
      line: { color: GRAY_200, width: 0.5 },
    });

    if (items.length === 0) {
      slide.addText("No projects", {
        x: x + 0.15,
        y: listTop + 0.15,
        w: colW - 0.3,
        h: 0.4,
        fontFace: branding.fontFace,
        fontSize: 11,
        color: GRAY_500,
        italic: true,
      });
      return;
    }

    const visible = items.slice(0, maxCards);
    const truncated = items.length - visible.length;
    visible.forEach((p, ci) => {
      const cy = listTop + 0.1 + ci * (cardH + cardGap);
      // Card background.
      slide.addShape("rect", {
        x: x + 0.1,
        y: cy,
        w: colW - 0.2,
        h: cardH,
        fill: { color: WHITE },
        line: { color: GRAY_200, width: 0.5 },
      });
      // Priority pip on the left edge.
      slide.addShape("rect", {
        x: x + 0.1,
        y: cy,
        w: 0.06,
        h: cardH,
        fill: { color: PRIORITY_FILL[p.priority] ?? GRAY_300 },
        line: { type: "none" },
      });
      // Project name.
      slide.addText(p.name, {
        x: x + 0.25,
        y: cy + 0.04,
        w: colW - 0.4,
        h: 0.28,
        fontFace: branding.fontFace,
        fontSize: 11,
        bold: true,
        color: GRAY_900,
        valign: "top",
      });
      // Lead + target date footer.
      const footer =
        [p.project_lead, p.target_date ? `· ${p.target_date}` : null]
          .filter(Boolean)
          .join("  ") || "Unassigned";
      slide.addText(footer, {
        x: x + 0.25,
        y: cy + 0.28,
        w: colW - 0.4,
        h: 0.22,
        fontFace: branding.fontFace,
        fontSize: 9,
        color: GRAY_500,
        valign: "top",
      });
    });

    if (truncated > 0) {
      slide.addText(`+${truncated} more`, {
        x: x + 0.1,
        y: listTop + listH - 0.3,
        w: colW - 0.2,
        h: 0.25,
        fontFace: branding.fontFace,
        fontSize: 9,
        color: GRAY_500,
        align: "center",
        italic: true,
      });
    }
  });

  return slide;
}

// ---------------------------------------------------------------------------
// Projects Status Summary (native table)
// ---------------------------------------------------------------------------

const PROJECTS_STATUS_COLUMNS: {
  label: string;
  /** Width fraction (relative to BODY_W). */
  weight: number;
  text: (p: Project) => string;
  align?: "left" | "center" | "right";
  fillFor?: (p: Project) => string | null;
}[] = [
  { label: "ID", weight: 0.08, text: (p) => p.project_id },
  { label: "Project", weight: 0.28, text: (p) => p.name },
  {
    label: "App / Product",
    weight: 0.14,
    text: (p) => p.application_product,
  },
  {
    label: "Status",
    weight: 0.13,
    text: (p) => p.status,
    fillFor: (p) => STATUS_FILL[p.status],
  },
  {
    label: "Priority",
    weight: 0.1,
    text: (p) => p.priority,
    fillFor: (p) => PRIORITY_FILL[p.priority] ?? null,
  },
  { label: "Lead", weight: 0.12, text: (p) => p.project_lead || "—" },
  {
    label: "Target",
    weight: 0.15,
    text: (p) => p.target_date ?? "—",
    align: "right",
  },
];

/**
 * Tabular roll-up of every project in scope. Sort: priority, then status,
 * then project ID — so the deck's first row is the most-critical
 * actively-running project.
 */
export function addProjectsStatusSlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  projects: Project[],
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  setContentBackground(slide, branding);
  addHeader(
    slide,
    branding,
    "Projects status",
    `${projects.length} project${projects.length === 1 ? "" : "s"}`,
  );

  if (projects.length === 0) {
    addEmptyState(slide, branding, "No projects match the current filters.");
    return slide;
  }

  const sorted = [...projects].sort(compareProjectsForStatus);

  // Column geometry.
  const totalWeight = PROJECTS_STATUS_COLUMNS.reduce(
    (s, c) => s + c.weight,
    0,
  );
  const colWidths = PROJECTS_STATUS_COLUMNS.map(
    (c) => (c.weight / totalWeight) * BODY_W,
  );
  const colXs: number[] = [];
  let cursor = MARGIN;
  for (const w of colWidths) {
    colXs.push(cursor);
    cursor += w;
  }

  const headerH = 0.32;
  const rowH = 0.28;
  const tableTop = BODY_TOP;
  const tableMaxH = BODY_H;
  const maxRows = Math.max(1, Math.floor((tableMaxH - headerH) / rowH));
  const visible = sorted.slice(0, maxRows);
  const truncated = sorted.length - visible.length;

  // Header row.
  slide.addShape("rect", {
    x: MARGIN,
    y: tableTop,
    w: BODY_W,
    h: headerH,
    fill: { color: branding.primaryHex },
    line: { type: "none" },
  });
  PROJECTS_STATUS_COLUMNS.forEach((c, i) => {
    slide.addText(c.label, {
      x: colXs[i] + 0.08,
      y: tableTop,
      w: colWidths[i] - 0.16,
      h: headerH,
      fontFace: branding.fontFace,
      fontSize: 10,
      bold: true,
      color: WHITE,
      valign: "middle",
      align: c.align ?? "left",
    });
  });

  // Body rows. Zebra-stripe so the eye can follow long rows across
  // a wide slide without losing place.
  visible.forEach((p, ri) => {
    const y = tableTop + headerH + ri * rowH;
    if (ri % 2 === 1) {
      slide.addShape("rect", {
        x: MARGIN,
        y,
        w: BODY_W,
        h: rowH,
        fill: { color: GRAY_50 },
        line: { type: "none" },
      });
    }
    PROJECTS_STATUS_COLUMNS.forEach((c, i) => {
      // Cell-level fill (status, priority chips).
      const fill = c.fillFor ? c.fillFor(p) : null;
      if (fill) {
        slide.addShape("rect", {
          x: colXs[i] + 0.08,
          y: y + 0.04,
          w: Math.min(colWidths[i] - 0.16, 1.2),
          h: rowH - 0.08,
          fill: { color: fill },
          line: { type: "none" },
          rectRadius: 0.05,
        });
      }
      slide.addText(c.text(p), {
        x: colXs[i] + 0.14,
        y,
        w: colWidths[i] - 0.28,
        h: rowH,
        fontFace: branding.fontFace,
        fontSize: 9,
        color: GRAY_900,
        valign: "middle",
        align: c.align ?? "left",
      });
    });
  });

  // Bottom hairline so the table reads as a finished block.
  slide.addShape("line", {
    x: MARGIN,
    y: tableTop + headerH + visible.length * rowH,
    w: BODY_W,
    h: 0,
    line: { color: GRAY_300, width: 0.75 },
  });

  if (truncated > 0) {
    slide.addText(
      `+${truncated} more project${truncated === 1 ? "" : "s"} not shown — adjust filters or split across slides`,
      {
        x: MARGIN,
        y: SLIDE_H - MARGIN + 0.05,
        w: BODY_W,
        h: 0.3,
        fontFace: branding.fontFace,
        fontSize: 9,
        color: GRAY_500,
        align: "center",
        italic: true,
      },
    );
  }

  return slide;
}

const STATUS_ORDER: Record<ProjectStatus, number> = {
  Blocked: 0,
  Delayed: 1,
  "In Progress": 2,
  "In Planning": 3,
  "Not Started": 4,
  "On Hold": 5,
  Completed: 6,
  Canceled: 7,
};

function compareProjectsForStatus(a: Project, b: Project): number {
  const priOrder: Record<string, number> = {
    Critical: 0,
    High: 1,
    Medium: 2,
    Low: 3,
  };
  const pa = priOrder[a.priority] ?? 9;
  const pb = priOrder[b.priority] ?? 9;
  if (pa !== pb) return pa - pb;
  const sa = STATUS_ORDER[a.status] ?? 9;
  const sb = STATUS_ORDER[b.status] ?? 9;
  if (sa !== sb) return sa - sb;
  return a.project_id.localeCompare(b.project_id);
}

// ---------------------------------------------------------------------------
// Blocked / At-Risk (native)
// ---------------------------------------------------------------------------

/** What goes into the at-risk slide row. */
interface RiskItem {
  kind: "Project" | "Task";
  reason: string;
  primary: string;
  secondary: string;
  parent?: string;
}

/**
 * Identify projects and tasks that warrant attention. Today these are
 * computed from the data we have — health score lands in Step 8 and will
 * become an additional input here at that time.
 *
 * A project is "at risk" if status is Blocked, Delayed, or On Hold, or
 * if the target date is in the past with status not yet Completed.
 *
 * A task is "at risk" if blocked is true, or status is Blocked, or
 * target_date is in the past with status not Complete/Canceled.
 */
export function selectAtRiskItems(
  projects: Project[],
  tasks: Task[],
  today: Date = new Date(),
): RiskItem[] {
  const todayIso = formatYmd(today);
  const items: RiskItem[] = [];

  for (const p of projects) {
    let reason: string | null = null;
    if (p.status === "Blocked") reason = "Blocked";
    else if (p.status === "Delayed") reason = "Delayed";
    else if (p.status === "On Hold") reason = "On hold";
    else if (
      p.target_date &&
      p.target_date < todayIso &&
      p.status !== "Completed" &&
      p.status !== "Canceled"
    ) {
      reason = "Past target date";
    }
    if (reason) {
      const target = p.target_date ?? "no target";
      items.push({
        kind: "Project",
        reason,
        primary: `${p.project_id}  ${p.name}`,
        secondary: `${p.priority} · ${p.project_lead || "Unassigned"} · ${target}`,
      });
    }
  }

  // Map project IDs to names so task rows can show a readable parent.
  const projectName = new Map(projects.map((p) => [p.project_id, p.name]));

  for (const t of tasks) {
    if (t.status === "Complete" || t.status === "Canceled") continue;
    let reason: string | null = null;
    if (t.blocked) reason = "Blocked";
    else if (t.status === "Blocked") reason = "Blocked";
    else if (t.target_date && t.target_date < todayIso) {
      reason = "Past due";
    }
    if (reason) {
      const parent =
        projectName.get(t.project_id) ?? t.project_id;
      items.push({
        kind: "Task",
        reason,
        primary: `${t.task_id}  ${t.task_name}`,
        secondary: `${t.priority} · ${t.responsible || "Unassigned"} · ${
          t.target_date ?? "no target"
        }`,
        parent,
      });
    }
  }

  // Order: blocked first (sharpest signal), then delayed, then past-due.
  // Inside each bucket, tasks before projects so the call-out lists what
  // someone needs to act on this week, not "this project is in trouble"
  // which is harder to action.
  const reasonOrder: Record<string, number> = {
    Blocked: 0,
    Delayed: 1,
    "On hold": 2,
    "Past target date": 3,
    "Past due": 3,
  };
  items.sort((a, b) => {
    const ra = reasonOrder[a.reason] ?? 9;
    const rb = reasonOrder[b.reason] ?? 9;
    if (ra !== rb) return ra - rb;
    if (a.kind !== b.kind) return a.kind === "Task" ? -1 : 1;
    return a.primary.localeCompare(b.primary);
  });

  return items;
}

function formatYmd(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/**
 * Two-column at-risk slide. Left column: at-risk projects. Right column:
 * blocked / past-due tasks. When one side has no entries, it shows an
 * affirming "All clear" note rather than disappearing — symmetry tells
 * the reader we looked at both, not that we forgot one.
 */
export function addBlockedAtRiskSlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  projects: Project[],
  tasks: Task[],
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  setContentBackground(slide, branding);
  const items = selectAtRiskItems(projects, tasks);
  const projectItems = items.filter((i) => i.kind === "Project");
  const taskItems = items.filter((i) => i.kind === "Task");

  addHeader(
    slide,
    branding,
    "Blocked / at-risk",
    `${projectItems.length} project${projectItems.length === 1 ? "" : "s"} · ${taskItems.length} task${
      taskItems.length === 1 ? "" : "s"
    }`,
  );

  const colGap = 0.4;
  const colW = (BODY_W - colGap) / 2;
  const colTop = BODY_TOP;

  drawRiskColumn(
    slide,
    branding,
    "At-risk projects",
    projectItems,
    MARGIN,
    colTop,
    colW,
    BODY_H,
  );
  drawRiskColumn(
    slide,
    branding,
    "Blocked & overdue tasks",
    taskItems,
    MARGIN + colW + colGap,
    colTop,
    colW,
    BODY_H,
  );

  return slide;
}

function drawRiskColumn(
  slide: PptxGenJS.Slide,
  branding: ResolvedBranding,
  heading: string,
  items: RiskItem[],
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  // Heading band — always visible so both columns read symmetrically
  // even when one side is empty.
  slide.addShape("rect", {
    x,
    y,
    w,
    h: 0.4,
    fill: { color: GRAY_900 },
    line: { type: "none" },
  });
  slide.addText(heading, {
    x: x + 0.15,
    y,
    w: w - 0.3,
    h: 0.4,
    fontFace: branding.fontFace,
    fontSize: 12,
    bold: true,
    color: WHITE,
    valign: "middle",
  });

  if (items.length === 0) {
    slide.addText("All clear — nothing flagged.", {
      x,
      y: y + 0.6,
      w,
      h: 0.4,
      fontFace: branding.fontFace,
      fontSize: 12,
      color: "059669", // emerald-600
      italic: true,
      align: "center",
    });
    return;
  }

  const itemH = 0.5;
  const itemGap = 0.08;
  const listTop = y + 0.55;
  const listH = h - 0.55;
  const maxItems = Math.max(1, Math.floor(listH / (itemH + itemGap)));
  const visible = items.slice(0, maxItems);
  const truncated = items.length - visible.length;

  visible.forEach((item, i) => {
    const iy = listTop + i * (itemH + itemGap);

    // Reason badge fill mapped from reason → color.
    const badgeColor = reasonColor(item.reason);

    slide.addShape("rect", {
      x,
      y: iy,
      w,
      h: itemH,
      fill: { color: WHITE },
      line: { color: GRAY_200, width: 0.5 },
    });
    // Reason badge on the left.
    slide.addShape("rect", {
      x: x + 0.1,
      y: iy + 0.1,
      w: 0.85,
      h: 0.3,
      fill: { color: badgeColor.fill },
      line: { type: "none" },
      rectRadius: 0.05,
    });
    slide.addText(item.reason, {
      x: x + 0.1,
      y: iy + 0.1,
      w: 0.85,
      h: 0.3,
      fontFace: branding.fontFace,
      fontSize: 9,
      bold: true,
      color: badgeColor.text,
      valign: "middle",
      align: "center",
    });

    slide.addText(item.primary, {
      x: x + 1.05,
      y: iy + 0.06,
      w: w - 1.15,
      h: 0.25,
      fontFace: branding.fontFace,
      fontSize: 11,
      bold: true,
      color: GRAY_900,
      valign: "top",
    });
    const subline = item.parent
      ? `${item.parent} · ${item.secondary}`
      : item.secondary;
    slide.addText(subline, {
      x: x + 1.05,
      y: iy + 0.28,
      w: w - 1.15,
      h: 0.22,
      fontFace: branding.fontFace,
      fontSize: 9,
      color: GRAY_500,
      valign: "top",
    });
  });

  if (truncated > 0) {
    slide.addText(`+${truncated} more not shown`, {
      x,
      y: listTop + listH - 0.25,
      w,
      h: 0.22,
      fontFace: branding.fontFace,
      fontSize: 9,
      color: GRAY_500,
      align: "center",
      italic: true,
    });
  }
}

function reasonColor(reason: string): { fill: string; text: string } {
  switch (reason) {
    case "Blocked":
      return { fill: "FECACA", text: "991B1B" };
    case "Delayed":
    case "Past target date":
    case "Past due":
      return { fill: "FED7AA", text: "9A3412" };
    case "On hold":
      return { fill: "FDE68A", text: "92400E" };
    default:
      return { fill: GRAY_200, text: GRAY_700 };
  }
}

// ---------------------------------------------------------------------------
// Velocity slide (Section 5.15 + Section 5.9 "Velocity slide")
// ---------------------------------------------------------------------------

/**
 * Headline numbers shown on the velocity slide. The full Section 5.15
 * dashboard has seven charts; the slide carries the top three by
 * "leadership cares about this in a meeting" weight: completions in the
 * range, average time to completion, and per-week task throughput.
 *
 * Section 5.9 calls this slide "Velocity" and Section 5.15
 * implementation notes describe it as "the top 3 metrics for the
 * selected time period". Keeping this as a small, native slide instead
 * of a screenshot of the dashboard gives selectable text in the deck
 * (so a reader can copy a number into their own notes) and avoids the
 * complexity of routing the dashboard through html2canvas.
 *
 * Inputs come from `lib/velocity/metrics.ts` so the slide and the
 * dashboard always show the same numbers — there is no separate
 * "slide math".
 */
export interface VelocitySlideInput {
  /** Free-form label, e.g. "Last 90 days" or "All time". */
  rangeLabel: string;
  /** Total Completed projects in the range. */
  totalCompleted: number;
  /** Mean days from project creation to completion across the range. */
  avgDaysToCompletion: number;
  /** Number of completed projects the avg was computed against. */
  avgSampleSize: number;
  /** Mean tasks completed per week. */
  meanTasksPerWeek: number;
  /** Total tasks completed in the range. */
  totalTasksCompleted: number;
  /** Idea conversion percentage (0-100). */
  ideaConversionRate: number;
  /** Submitted / converted counts behind the conversion rate. */
  ideasSubmitted: number;
  ideasConverted: number;
  /**
   * True when fewer than three projects completed in the range. The
   * slide still renders, but it adds a "calibration period" footer so
   * the audience knows the numbers are early.
   */
  insufficientHistory: boolean;
}

/**
 * Three-stat slide: Completions, Average duration, Throughput. Plus a
 * smaller idea-conversion stat in the corner so the slide ties out to
 * the dashboard's full set even though it doesn't reproduce all seven
 * charts.
 */
export function addVelocitySlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  input: VelocitySlideInput,
): PptxGenJS.Slide {
  const slide = pptx.addSlide();
  setContentBackground(slide, branding);
  addHeader(slide, branding, "Velocity & throughput", input.rangeLabel);

  // Three big stat cards across the top half of the body.
  const cardW = (BODY_W - 0.4) / 3;
  const cardH = 2.4;
  const cardTop = BODY_TOP + 0.1;

  const cards = [
    {
      label: "Projects completed",
      value: String(input.totalCompleted),
      sub:
        input.totalCompleted === 0
          ? "None in this range"
          : `In ${input.rangeLabel.toLowerCase()}`,
    },
    {
      label: "Avg time to completion",
      value:
        input.avgSampleSize === 0
          ? "—"
          : `${Math.round(input.avgDaysToCompletion)}d`,
      sub:
        input.avgSampleSize === 0
          ? "Not enough completed projects"
          : `n = ${input.avgSampleSize}`,
    },
    {
      label: "Tasks per week",
      value:
        input.totalTasksCompleted === 0
          ? "—"
          : input.meanTasksPerWeek.toFixed(1),
      sub:
        input.totalTasksCompleted === 0
          ? "No tasks completed in range"
          : `${input.totalTasksCompleted} total tasks completed`,
    },
  ];

  cards.forEach((card, i) => {
    const x = MARGIN + i * (cardW + 0.2);

    // Card background.
    slide.addShape("rect", {
      x,
      y: cardTop,
      w: cardW,
      h: cardH,
      fill: { color: GRAY_50 },
      line: { color: GRAY_200, width: 0.75 },
      rectRadius: 0.08,
    });

    // Top accent bar in brand color.
    slide.addShape("rect", {
      x,
      y: cardTop,
      w: cardW,
      h: 0.08,
      fill: { color: branding.primaryHex },
      line: { type: "none" },
    });

    // Label.
    slide.addText(card.label.toUpperCase(), {
      x: x + 0.25,
      y: cardTop + 0.25,
      w: cardW - 0.5,
      h: 0.3,
      fontFace: branding.fontFace,
      fontSize: 11,
      bold: true,
      color: GRAY_500,
      charSpacing: 2,
    });

    // Big number.
    slide.addText(card.value, {
      x: x + 0.25,
      y: cardTop + 0.7,
      w: cardW - 0.5,
      h: 1.2,
      fontFace: branding.fontFace,
      fontSize: 60,
      bold: true,
      color: GRAY_900,
      valign: "middle",
    });

    // Subline.
    slide.addText(card.sub, {
      x: x + 0.25,
      y: cardTop + 1.95,
      w: cardW - 0.5,
      h: 0.35,
      fontFace: branding.fontFace,
      fontSize: 11,
      color: GRAY_500,
    });
  });

  // Idea-conversion mini-card occupies the bottom-left half. Sized smaller
  // because conversion is supporting context to the throughput story
  // above, not the headline.
  const miniTop = cardTop + cardH + 0.4;
  const miniH = SLIDE_H - MARGIN - miniTop;
  const miniW = BODY_W * 0.55;

  slide.addShape("rect", {
    x: MARGIN,
    y: miniTop,
    w: miniW,
    h: miniH,
    fill: { color: WHITE },
    line: { color: GRAY_200, width: 0.75 },
    rectRadius: 0.06,
  });
  slide.addText("IDEA CONVERSION", {
    x: MARGIN + 0.25,
    y: miniTop + 0.2,
    w: miniW - 0.5,
    h: 0.28,
    fontFace: branding.fontFace,
    fontSize: 10,
    bold: true,
    color: GRAY_500,
    charSpacing: 2,
  });
  const convText =
    input.ideasSubmitted === 0
      ? "—"
      : `${Math.round(input.ideaConversionRate)}%`;
  slide.addText(convText, {
    x: MARGIN + 0.25,
    y: miniTop + 0.55,
    w: miniW - 0.5,
    h: 0.7,
    fontFace: branding.fontFace,
    fontSize: 36,
    bold: true,
    color: GRAY_900,
    valign: "middle",
  });
  const convSub =
    input.ideasSubmitted === 0
      ? "No ideas submitted in this range yet"
      : `${input.ideasConverted} converted of ${input.ideasSubmitted} submitted`;
  slide.addText(convSub, {
    x: MARGIN + 0.25,
    y: miniTop + 1.3,
    w: miniW - 0.5,
    h: 0.3,
    fontFace: branding.fontFace,
    fontSize: 11,
    color: GRAY_500,
  });

  // Notes column on the right — explains the proxy basis so reviewers
  // know the duration / throughput numbers will sharpen once status
  // history is persisted.
  const noteX = MARGIN + miniW + 0.3;
  const noteW = BODY_W - miniW - 0.3;
  slide.addText("METHODOLOGY", {
    x: noteX,
    y: miniTop + 0.2,
    w: noteW,
    h: 0.28,
    fontFace: branding.fontFace,
    fontSize: 10,
    bold: true,
    color: GRAY_500,
    charSpacing: 2,
  });
  const methodologyLines = [
    "• Completions counted by last project edit (proxy for completion date).",
    "• Avg time = days from project creation to last edit.",
    "• Throughput = tasks marked Complete per ISO week (Mon-start, UTC).",
    "• Ranges become exact once status-transition history is persisted.",
  ];
  slide.addText(methodologyLines.join("\n"), {
    x: noteX,
    y: miniTop + 0.55,
    w: noteW,
    h: miniH - 0.7,
    fontFace: branding.fontFace,
    fontSize: 10,
    color: GRAY_700,
    valign: "top",
    paraSpaceAfter: 4,
  });

  // Calibration banner — small, italic, only when the dashboard says
  // we're under-sampled.
  if (input.insufficientHistory) {
    slide.addText(
      "Calibration period: fewer than 3 projects completed in this range. " +
        "Treat numbers as directional until more history accumulates.",
      {
        x: MARGIN,
        y: SLIDE_H - 0.45,
        w: BODY_W,
        h: 0.25,
        fontFace: branding.fontFace,
        fontSize: 9,
        color: "9A3412",
        italic: true,
        align: "center",
      },
    );
  }

  return slide;
}

// ---------------------------------------------------------------------------
// Re-exports for tests
// ---------------------------------------------------------------------------

/** Exposed for the smoke test to inspect column layout without a deck. */
export const __test__ = {
  PROJECTS_STATUS_COLUMNS,
  STATUS_ORDER,
  STATUS_FILL,
  PRIORITY_FILL,
  PROJECT_STATUSES,
  PRIORITIES,
  PROJECT_PHASES,
};
