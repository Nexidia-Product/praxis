/**
 * Executive deck plan — pure logic.
 *
 * Turns the same data the Executive view shows into an ordered list of
 * slide *plans* (plain data, already paginated and text-clipped). The
 * PowerPoint renderer (lib/export/executive-slides.ts) draws them; keeping
 * the shaping here makes the deck testable without pptxgenjs.
 *
 * Two presets seed the options, and every option stays adjustable:
 *   - monthly: summary, risks & blockers, upcoming releases, then the
 *     pillar slides at summary detail.
 *   - qbr: summary, delivered, pillar slides at detailed level (with
 *     Supports/Benefits), risks & blockers, next quarter's plan, and
 *     upcoming releases.
 * Slides always come out in one canonical order regardless of how the
 * sections were ticked.
 */

import type { IsoDate } from "@/lib/db";
import { formatQuarter } from "@/lib/key-capabilities";
import type { ReleaseProjectEntry } from "@/lib/releases/report";
import {
  EXEC_PILLARS,
  NO_USE_CASE,
  UNSCHEDULED,
  buildExecutiveView,
  quarterOfDate,
  riskStatus,
  upcomingReleases,
  type ExecProject,
  type ExecutiveView,
  type UpcomingRelease,
} from "./portfolio";

export type DeckPreset = "monthly" | "qbr";
export type DeckSection =
  | "summary"
  | "delivered"
  | "pillars"
  | "attention"
  | "nextQuarter"
  | "releases";
export type DeckDetail = "summary" | "detailed";

/** Canonical slide order. */
export const DECK_SECTIONS: Array<{
  key: DeckSection;
  label: string;
  description: string;
}> = [
  { key: "summary", label: "Portfolio summary", description: "One row per pillar with phase, risk and blocker counts." },
  { key: "delivered", label: "Delivered", description: "Projects in the period that reached Productization." },
  { key: "pillars", label: "Pillar slides", description: "One or more slides per pillar listing its projects." },
  { key: "attention", label: "Risks & blockers", description: "Missed, at-risk and blocked projects with the reason." },
  { key: "nextQuarter", label: "Next quarter's plan", description: "Projects scheduled for the following quarter." },
  { key: "releases", label: "Upcoming releases", description: "The next three releases and what rides each." },
];

export const DECK_PRESETS: Record<
  DeckPreset,
  { label: string; description: string; sections: DeckSection[]; detail: DeckDetail }
> = {
  monthly: {
    label: "Monthly update",
    description: "In-flight work, upcoming releases, risks and blockers.",
    sections: ["summary", "attention", "releases", "pillars"],
    detail: "summary",
  },
  qbr: {
    label: "Quarterly business review",
    description:
      "Delivered, in flight, risks, next quarter's plan, and benefits by pillar.",
    sections: [
      "summary",
      "delivered",
      "pillars",
      "attention",
      "nextQuarter",
      "releases",
    ],
    detail: "detailed",
  },
};

export interface DeckOptions {
  preset: DeckPreset;
  /** Quarter ("YYYY-Qn") or "unscheduled". */
  scope: string;
  /** Pillars to include; subset of EXEC_PILLARS. */
  pillars: string[];
  sections: DeckSection[];
  detail: DeckDetail;
  /** Overrides the generated deck title. */
  title?: string;
}

// ---------------------------------------------------------------------------
// Plan shapes
// ---------------------------------------------------------------------------

export interface ProjectRow {
  id: string;
  name: string;
  pillar: string;
  useCase: string;
  stage: string;
  status: string;
  release: string;
  risk: "Missed delivery" | "At risk" | "Delivered" | "On track";
  riskTone: "red" | "green";
  blocked: number;
  /** First risk reason or blocker, clipped. */
  issue: string;
  carriedOver: boolean;
  supports: string;
  benefits: string;
}

export interface SummaryRow {
  label: string;
  total: number;
  qualifying: number;
  inProgress: number;
  released: number;
  missed: number;
  atRisk: number;
  blocked: number;
  undocumented: number;
}

export type DeckSlidePlan =
  | { kind: "summary"; scopeLabel: string; rows: SummaryRow[]; total: SummaryRow; footnote: string }
  | { kind: "pillar"; pillar: string; scopeLabel: string; page: number; pages: number; totalProjects: number; rows: ProjectRow[]; detailed: boolean }
  | { kind: "delivered"; scopeLabel: string; page: number; pages: number; totalProjects: number; rows: ProjectRow[]; detailed: boolean }
  | { kind: "attention"; scopeLabel: string; page: number; pages: number; totalProjects: number; rows: ProjectRow[] }
  | { kind: "nextQuarter"; scopeLabel: string; page: number; pages: number; totalProjects: number; rows: ProjectRow[] }
  | { kind: "releases"; releases: UpcomingRelease[] };

export interface DeckPlan {
  title: string;
  subtitle: string;
  slides: DeckSlidePlan[];
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

export function formatDate(iso: IsoDate): string {
  return new Date(`${iso}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

export function clip(text: string, max: number): string {
  const t = text.replace(/\s+/g, " ").trim();
  return t.length > max ? `${t.slice(0, max - 1).trimEnd()}…` : t;
}

/** Split into pages of `size`; always at least one (empty) page. */
export function paginate<T>(items: T[], size: number): T[][] {
  if (items.length === 0) return [[]];
  const pages: T[][] = [];
  for (let i = 0; i < items.length; i += size) pages.push(items.slice(i, i + size));
  return pages;
}

/** Rows per slide, tuned so a full page fits the slide body. */
export const ROWS_PER_SLIDE = { summary: 9, detailed: 4, attention: 8, other: 9 };

function scopeLabelOf(scope: string): string {
  return scope === UNSCHEDULED ? "Unscheduled" : formatQuarter(scope);
}

function nextQuarterOf(scope: string): string | null {
  const m = /^(\d{4})-Q([1-4])$/.exec(scope);
  if (!m) return null;
  return m[2] === "4" ? `${Number(m[1]) + 1}-Q1` : `${m[1]}-Q${Number(m[2]) + 1}`;
}

function toRow(ep: ExecProject): ProjectRow {
  const p = ep.entry.project;
  const risk = riskStatus(ep);
  return {
    id: p.project_id,
    name: p.name,
    pillar: p.primary_objective ?? "",
    useCase: ep.entry.useCaseNames[0] ?? NO_USE_CASE,
    stage: p.stage,
    status: p.status,
    release: p.target_date ? formatDate(p.target_date) : "Unscheduled",
    risk: risk.text,
    riskTone: risk.tone,
    blocked: ep.entry.blockers.length,
    issue: clip(
      ep.entry.riskReasons[0] ?? ep.entry.blockers[0]?.reason ?? "",
      170,
    ),
    carriedOver: ep.carriedOver,
    supports: clip(p.supports, 200),
    benefits: clip(p.benefits, 220),
  };
}

function summaryRow(label: string, projects: ExecProject[]): SummaryRow {
  return {
    label,
    total: projects.length,
    qualifying: projects.filter((p) => p.phase === "qualifying").length,
    inProgress: projects.filter((p) => p.phase === "inProgress").length,
    released: projects.filter((p) => p.phase === "released").length,
    missed: projects.filter((p) => p.entry.missedDelivery).length,
    atRisk: projects.filter((p) => p.entry.atRisk && !p.entry.missedDelivery).length,
    blocked: projects.filter((p) => p.entry.blockers.length > 0).length,
    undocumented: projects.filter((p) => p.missingSupports || p.missingBenefits).length,
  };
}

// ---------------------------------------------------------------------------
// Plan builder
// ---------------------------------------------------------------------------

export interface BuildDeckInput {
  entries: ReleaseProjectEntry[];
  today: IsoDate;
  noPillarCount: number;
  options: DeckOptions;
}

export function buildDeckPlan(input: BuildDeckInput): DeckPlan {
  const { entries, today, noPillarCount, options } = input;
  const pillars = EXEC_PILLARS.filter((p) => options.pillars.includes(p));
  const wanted = new Set(options.sections);
  const detailed = options.detail === "detailed";
  const scopeLabel = scopeLabelOf(options.scope);

  // Everything is built from the same view the page renders, limited to
  // the chosen pillars.
  const full: ExecutiveView = buildExecutiveView({
    entries,
    scope: options.scope,
    today,
  });
  const chosen = full.pillars.filter((p) => pillars.includes(p.pillar));
  const chosenProjects = chosen.flatMap((p) => p.projects);

  const slides: DeckSlidePlan[] = [];

  if (wanted.has("summary")) {
    const rows = chosen.map((p) => summaryRow(p.pillar, p.projects));
    slides.push({
      kind: "summary",
      scopeLabel,
      rows,
      total: summaryRow("All pillars", chosenProjects),
      footnote:
        "Innovation program, five core pillars — Complaints and Other are not shown." +
        (noPillarCount > 0
          ? ` ${noPillarCount} Innovation project${noPillarCount === 1 ? " has" : "s have"} no pillar assigned yet and ${noPillarCount === 1 ? "is" : "are"} not included.`
          : ""),
    });
  }

  if (wanted.has("delivered")) {
    const delivered = chosenProjects
      .filter((p) => p.phase === "released")
      .map(toRow);
    const pages = paginate(delivered, detailed ? ROWS_PER_SLIDE.detailed : ROWS_PER_SLIDE.other);
    pages.forEach((rows, i) =>
      slides.push({
        kind: "delivered",
        scopeLabel,
        page: i + 1,
        pages: pages.length,
        totalProjects: delivered.length,
        rows,
        detailed,
      }),
    );
  }

  if (wanted.has("pillars")) {
    for (const p of chosen) {
      if (p.projects.length === 0) continue;
      const rows = p.groups.flatMap((g) => g.projects).map(toRow);
      const pages = paginate(rows, detailed ? ROWS_PER_SLIDE.detailed : ROWS_PER_SLIDE.summary);
      pages.forEach((pageRows, i) =>
        slides.push({
          kind: "pillar",
          pillar: p.pillar,
          scopeLabel,
          page: i + 1,
          pages: pages.length,
          totalProjects: rows.length,
          rows: pageRows,
          detailed,
        }),
      );
    }
  }

  if (wanted.has("attention")) {
    const rows = full.needsAttention
      .filter((ep) => pillars.includes(ep.entry.project.primary_objective ?? ""))
      .map(toRow);
    const pages = paginate(rows, ROWS_PER_SLIDE.attention);
    pages.forEach((pageRows, i) =>
      slides.push({
        kind: "attention",
        scopeLabel,
        page: i + 1,
        pages: pages.length,
        totalProjects: rows.length,
        rows: pageRows,
      }),
    );
  }

  const next = nextQuarterOf(options.scope);
  if (wanted.has("nextQuarter") && next) {
    const nextView = buildExecutiveView({ entries, scope: next, today });
    const rows = nextView.pillars
      .filter((p) => pillars.includes(p.pillar))
      .flatMap((p) => p.projects)
      .map(toRow);
    const pages = paginate(rows, ROWS_PER_SLIDE.other);
    pages.forEach((pageRows, i) =>
      slides.push({
        kind: "nextQuarter",
        scopeLabel: formatQuarter(next),
        page: i + 1,
        pages: pages.length,
        totalProjects: rows.length,
        rows: pageRows,
      }),
    );
  }

  if (wanted.has("releases")) {
    // Restrict to the chosen pillars so the slide matches the rest of the deck.
    const scopedEntries = entries.filter((e) =>
      pillars.includes(e.project.primary_objective ?? ""),
    );
    slides.push({ kind: "releases", releases: upcomingReleases(scopedEntries, today) });
  }

  const isQuarter = options.scope !== UNSCHEDULED;
  const monthLabel = new Date(`${today}T00:00:00Z`).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
  const title =
    options.title?.trim() ||
    (options.preset === "qbr"
      ? "Innovation Quarterly Business Review"
      : "Innovation Monthly Update");
  const period =
    options.preset === "qbr" && isQuarter
      ? scopeLabel
      : options.preset === "monthly"
        ? monthLabel
        : scopeLabel;

  const subtitle = [
    period,
    scopeLabel !== period ? scopeLabel : "",
    `As of ${formatDate(today)}`,
  ]
    .filter(Boolean)
    .join(" · ");

  return { title, subtitle, slides };
}

/** Default scope for a deck: the current quarter. */
export function defaultDeckScope(today: IsoDate): string {
  return quarterOfDate(today);
}
