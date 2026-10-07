/**
 * PowerPoint renderer for the executive deck.
 *
 * Draws the already-paginated `DeckSlidePlan`s from lib/executive/deck.ts
 * with pptxgenjs, reusing the existing header, background and palette from
 * slide-builders.ts so these slides look like the rest of the roadmap
 * deck (and pick up the same template branding).
 */

import type PptxGenJS from "pptxgenjs";

import type {
  DeckSlidePlan,
  ProjectRow,
  SummaryRow,
} from "@/lib/executive/deck";
import { formatDate } from "@/lib/executive/deck";
import type { ResolvedBranding } from "./branding";
import {
  BODY_TOP,
  BODY_W,
  GRAY_100,
  GRAY_200,
  GRAY_500,
  GRAY_700,
  GRAY_900,
  MARGIN,
  WHITE,
  addEmptyState,
  addHeader,
  setContentBackground,
} from "./slide-builders";

type Cell = PptxGenJS.TableCell;

const RED_FILL = "FECACA";
const AMBER_FILL = "FDE68A";
const GREEN_FILL = "D1FAE5";

function pageSuffix(page: number, pages: number): string {
  return pages > 1 ? ` (${page}/${pages})` : "";
}

function headerCell(text: string, b: ResolvedBranding, align: "left" | "center" = "left"): Cell {
  return {
    text,
    options: {
      bold: true,
      color: WHITE,
      fill: { color: b.primaryHex },
      fontFace: b.fontFace,
      fontSize: 10,
      align,
      valign: "middle",
    },
  };
}

function textCell(
  text: string,
  b: ResolvedBranding,
  opts: { bold?: boolean; fill?: string; color?: string; size?: number; align?: "left" | "center" } = {},
): Cell {
  return {
    text,
    options: {
      fontFace: b.fontFace,
      fontSize: opts.size ?? 10,
      bold: opts.bold,
      color: opts.color ?? GRAY_900,
      fill: opts.fill ? { color: opts.fill } : undefined,
      align: opts.align ?? "left",
      valign: "middle",
    },
  };
}

function projectCell(r: ProjectRow, b: ResolvedBranding): Cell {
  return {
    text: [
      {
        text: `${r.id}  ${r.name}${r.carriedOver ? "  (carried over)" : ""}`,
        options: { bold: true, fontSize: 10, color: GRAY_900, breakLine: true },
      },
      { text: r.useCase, options: { fontSize: 8, color: GRAY_500 } },
    ],
    options: { fontFace: b.fontFace, valign: "middle" },
  };
}

function riskCell(r: ProjectRow, b: ResolvedBranding): Cell {
  const fill = r.riskTone === "red" ? RED_FILL : GREEN_FILL;
  const lines: PptxGenJS.TextProps[] = [
    {
      text: r.risk,
      options: { bold: true, fontSize: 10, color: GRAY_900, breakLine: r.blocked > 0 },
    },
  ];
  if (r.blocked > 0) {
    lines.push({
      text: `${r.blocked} blocked`,
      options: { fontSize: 9, color: "92400E" },
    });
  }
  return {
    text: lines,
    options: { fontFace: b.fontFace, fill: { color: fill }, valign: "middle" },
  };
}

function addTable(
  slide: PptxGenJS.Slide,
  rows: Cell[][],
  colW: number[],
  rowH: number,
): void {
  slide.addTable(rows, {
    x: MARGIN,
    y: BODY_TOP,
    w: BODY_W,
    colW,
    rowH: [0.35, ...rows.slice(1).map(() => rowH)],
    border: { type: "solid", pt: 0.5, color: GRAY_200 },
    margin: [0.04, 0.08, 0.04, 0.08],
  });
}

function scaleCols(weights: number[]): number[] {
  const total = weights.reduce((s, w) => s + w, 0);
  return weights.map((w) => (w / total) * BODY_W);
}

// ---------------------------------------------------------------------------
// Slide kinds
// ---------------------------------------------------------------------------

function drawSummary(
  pptx: PptxGenJS,
  b: ResolvedBranding,
  plan: Extract<DeckSlidePlan, { kind: "summary" }>,
): void {
  const slide = pptx.addSlide();
  setContentBackground(slide, b);
  addHeader(slide, b, "Portfolio summary", plan.scopeLabel);

  const head = ["Pillar", "Projects", "Qualifying", "In progress", "Released", "Missed", "At risk", "Blocked", "Need benefits"];
  const tone = (n: number, fill: string) => (n > 0 ? fill : undefined);
  const body = (r: SummaryRow, bold = false): Cell[] => [
    textCell(r.label, b, { bold: true }),
    textCell(String(r.total), b, { bold, align: "center" }),
    textCell(String(r.qualifying), b, { align: "center" }),
    textCell(String(r.inProgress), b, { align: "center" }),
    textCell(String(r.released), b, { align: "center" }),
    textCell(String(r.missed), b, { align: "center", fill: tone(r.missed, RED_FILL), bold: r.missed > 0 }),
    textCell(String(r.atRisk), b, { align: "center", fill: tone(r.atRisk, RED_FILL), bold: r.atRisk > 0 }),
    textCell(String(r.blocked), b, { align: "center", fill: tone(r.blocked, AMBER_FILL), bold: r.blocked > 0 }),
    textCell(String(r.undocumented), b, { align: "center", fill: tone(r.undocumented, GRAY_100) }),
  ];

  addTable(
    slide,
    [
      head.map((h, i) => headerCell(h, b, i === 0 ? "left" : "center")),
      ...plan.rows.map((r) => body(r)),
      body(plan.total, true).map((c) => ({
        text: c.text,
        options: { ...c.options, bold: true, fill: { color: GRAY_200 } },
      })),
    ],
    scaleCols([2.6, 1.1, 1.2, 1.2, 1.1, 1, 1, 1, 1.4]),
    0.5,
  );

  slide.addText(plan.footnote, {
    x: MARGIN,
    y: 6.6,
    w: BODY_W,
    h: 0.4,
    fontFace: b.fontFace,
    fontSize: 9,
    color: GRAY_500,
    italic: true,
    valign: "top",
  });
}

function projectTable(
  slide: PptxGenJS.Slide,
  b: ResolvedBranding,
  rows: ProjectRow[],
  detailed: boolean,
): void {
  if (detailed) {
    addTable(
      slide,
      [
        [
          headerCell("Project", b),
          headerCell("Stage / status", b),
          headerCell("Release", b),
          headerCell("Risk", b),
          headerCell("Supports", b),
          headerCell("Benefits", b),
        ],
        ...rows.map((r) => [
          projectCell(r, b),
          textCell(`${r.stage}\n${r.status}`, b, { size: 9 }),
          textCell(r.release, b, { size: 9 }),
          riskCell(r, b),
          textCell(r.supports || "Not documented", b, {
            size: 9,
            color: r.supports ? GRAY_700 : GRAY_500,
          }),
          textCell(r.benefits || "Not documented", b, {
            size: 9,
            color: r.benefits ? GRAY_700 : GRAY_500,
          }),
        ]),
      ],
      scaleCols([2.6, 1.6, 1.2, 1.3, 2.8, 2.8]),
      1.15,
    );
  } else {
    addTable(
      slide,
      [
        [
          headerCell("Project", b),
          headerCell("Stage", b),
          headerCell("Status", b),
          headerCell("Release", b),
          headerCell("Risk", b),
        ],
        ...rows.map((r) => [
          projectCell(r, b),
          textCell(r.stage, b, { size: 9 }),
          textCell(r.status, b, { size: 9 }),
          textCell(r.release, b, { size: 9 }),
          riskCell(r, b),
        ]),
      ],
      scaleCols([4.3, 2.2, 1.5, 1.7, 2.6]),
      0.5,
    );
  }
}

function drawPillar(
  pptx: PptxGenJS,
  b: ResolvedBranding,
  plan: Extract<DeckSlidePlan, { kind: "pillar" }>,
): void {
  const slide = pptx.addSlide();
  setContentBackground(slide, b);
  addHeader(
    slide,
    b,
    `${plan.pillar}${pageSuffix(plan.page, plan.pages)}`,
    `${plan.scopeLabel} · ${plan.totalProjects} project${plan.totalProjects === 1 ? "" : "s"}`,
  );
  projectTable(slide, b, plan.rows, plan.detailed);
}

function drawDelivered(
  pptx: PptxGenJS,
  b: ResolvedBranding,
  plan: Extract<DeckSlidePlan, { kind: "delivered" }>,
): void {
  const slide = pptx.addSlide();
  setContentBackground(slide, b);
  addHeader(
    slide,
    b,
    `Delivered${pageSuffix(plan.page, plan.pages)}`,
    `${plan.scopeLabel} · ${plan.totalProjects} project${plan.totalProjects === 1 ? "" : "s"}`,
  );
  if (plan.rows.length === 0) {
    addEmptyState(slide, b, "No projects reached Productization in this period.");
    return;
  }
  if (plan.detailed) {
    addTable(
      slide,
      [
        [headerCell("Project", b), headerCell("Pillar", b), headerCell("Release", b), headerCell("Benefits", b)],
        ...plan.rows.map((r) => [
          projectCell(r, b),
          textCell(r.pillar, b, { size: 9 }),
          textCell(r.release, b, { size: 9 }),
          textCell(r.benefits || "Not documented", b, {
            size: 9,
            color: r.benefits ? GRAY_700 : GRAY_500,
          }),
        ]),
      ],
      scaleCols([3.6, 1.8, 1.4, 5.5]),
      1.0,
    );
  } else {
    addTable(
      slide,
      [
        [headerCell("Project", b), headerCell("Pillar", b), headerCell("Release", b)],
        ...plan.rows.map((r) => [
          projectCell(r, b),
          textCell(r.pillar, b, { size: 9 }),
          textCell(r.release, b, { size: 9 }),
        ]),
      ],
      scaleCols([6, 2.5, 2]),
      0.5,
    );
  }
}

function drawAttention(
  pptx: PptxGenJS,
  b: ResolvedBranding,
  plan: Extract<DeckSlidePlan, { kind: "attention" }>,
): void {
  const slide = pptx.addSlide();
  setContentBackground(slide, b);
  addHeader(
    slide,
    b,
    `Risks & blockers${pageSuffix(plan.page, plan.pages)}`,
    `${plan.scopeLabel} · ${plan.totalProjects} project${plan.totalProjects === 1 ? "" : "s"}`,
  );
  if (plan.rows.length === 0) {
    addEmptyState(slide, b, "Nothing flagged for this period.");
    return;
  }
  addTable(
    slide,
    [
      [
        headerCell("Project", b),
        headerCell("Pillar", b),
        headerCell("Release", b),
        headerCell("Risk", b),
        headerCell("Why", b),
      ],
      ...plan.rows.map((r) => [
        projectCell(r, b),
        textCell(r.pillar, b, { size: 9 }),
        textCell(r.release, b, { size: 9 }),
        riskCell(r, b),
        textCell(r.issue || "—", b, { size: 9, color: GRAY_700 }),
      ]),
    ],
    scaleCols([3.2, 1.6, 1.3, 1.5, 4.7]),
    0.55,
  );
}

function drawNextQuarter(
  pptx: PptxGenJS,
  b: ResolvedBranding,
  plan: Extract<DeckSlidePlan, { kind: "nextQuarter" }>,
): void {
  const slide = pptx.addSlide();
  setContentBackground(slide, b);
  addHeader(
    slide,
    b,
    `Next quarter's plan${pageSuffix(plan.page, plan.pages)}`,
    `${plan.scopeLabel} · ${plan.totalProjects} project${plan.totalProjects === 1 ? "" : "s"}`,
  );
  if (plan.rows.length === 0) {
    addEmptyState(slide, b, "No projects are scheduled for next quarter yet.");
    return;
  }
  addTable(
    slide,
    [
      [
        headerCell("Project", b),
        headerCell("Pillar", b),
        headerCell("Stage", b),
        headerCell("Release", b),
        headerCell("Status", b),
      ],
      ...plan.rows.map((r) => [
        projectCell(r, b),
        textCell(r.pillar, b, { size: 9 }),
        textCell(r.stage, b, { size: 9 }),
        textCell(r.release, b, { size: 9 }),
        textCell(r.status, b, { size: 9 }),
      ]),
    ],
    scaleCols([4.3, 1.9, 2.2, 1.7, 2.2]),
    0.5,
  );
}

function drawReleases(
  pptx: PptxGenJS,
  b: ResolvedBranding,
  plan: Extract<DeckSlidePlan, { kind: "releases" }>,
): void {
  const slide = pptx.addSlide();
  setContentBackground(slide, b);
  addHeader(slide, b, "Upcoming releases", "Next three scheduled releases");
  if (plan.releases.length === 0) {
    addEmptyState(slide, b, "No upcoming releases.");
    return;
  }
  const gap = 0.3;
  const cols = 3;
  const w = (BODY_W - gap * (cols - 1)) / cols;
  const h = 5.3;
  plan.releases.forEach((r, i) => {
    const x = MARGIN + i * (w + gap);
    slide.addShape("rect", {
      x,
      y: BODY_TOP,
      w,
      h,
      fill: { color: WHITE },
      line: { color: GRAY_200, width: 1 },
    });
    slide.addShape("rect", {
      x,
      y: BODY_TOP,
      w,
      h: 0.7,
      fill: { color: b.primaryHex },
      line: { type: "none" },
    });
    slide.addText(`${formatDate(r.date)}${r.isNext ? "  ·  next" : ""}`, {
      x: x + 0.15,
      y: BODY_TOP,
      w: w - 0.3,
      h: 0.7,
      fontFace: b.fontFace,
      fontSize: 16,
      bold: true,
      color: WHITE,
      valign: "middle",
    });
    slide.addText(
      [
        { text: `${r.projects} project${r.projects === 1 ? "" : "s"}`, options: { bold: true, color: GRAY_900 } },
        ...(r.atRisk > 0
          ? [{ text: `   ${r.atRisk} at risk`, options: { bold: true, color: "B91C1C" } }]
          : []),
      ],
      {
        x: x + 0.15,
        y: BODY_TOP + 0.8,
        w: w - 0.3,
        h: 0.4,
        fontFace: b.fontFace,
        fontSize: 13,
      },
    );
    const shown = r.items.slice(0, 9);
    const more = r.items.length - shown.length;
    const lines: PptxGenJS.TextProps[] = shown.map((it) => ({
      text: `${it.risk ? "▲ " : "• "}${it.label.length > 42 ? `${it.label.slice(0, 41)}…` : it.label}`,
      options: { color: it.risk ? "B91C1C" : GRAY_700, breakLine: true },
    }));
    if (more > 0) lines.push({ text: `+ ${more} more`, options: { color: GRAY_500, italic: true } });
    if (lines.length === 0) lines.push({ text: "No projects yet.", options: { color: GRAY_500, italic: true } });
    slide.addText(lines, {
      x: x + 0.15,
      y: BODY_TOP + 1.3,
      w: w - 0.3,
      h: h - 1.4,
      fontFace: b.fontFace,
      fontSize: 11,
      valign: "top",
      paraSpaceAfter: 4,
    });
  });
}

export function addExecutiveSlide(
  pptx: PptxGenJS,
  branding: ResolvedBranding,
  plan: DeckSlidePlan,
): void {
  switch (plan.kind) {
    case "summary":
      return drawSummary(pptx, branding, plan);
    case "pillar":
      return drawPillar(pptx, branding, plan);
    case "delivered":
      return drawDelivered(pptx, branding, plan);
    case "attention":
      return drawAttention(pptx, branding, plan);
    case "nextQuarter":
      return drawNextQuarter(pptx, branding, plan);
    case "releases":
      return drawReleases(pptx, branding, plan);
  }
}
