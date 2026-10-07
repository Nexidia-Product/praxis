/**
 * Executive view — pure logic.
 *
 * Shapes the Innovation portfolio into the five pillars (objectives)
 * for a chosen quarter. Framework-free like lib/key-capabilities.ts.
 *
 * Scope rules (agreed with the product owner):
 *   - Innovation program only; Admin-type projects and Canceled projects
 *     are out.
 *   - Only the five core pillars appear. Complaints and Other are
 *     deliberately excluded. Projects with NO pillar yet are not shown
 *     but are counted so the page can say how many are missing.
 *   - A project belongs to a quarter by its Target Application Deployment
 *     Date (fiscal and calendar quarters are the same at NiCE). Projects
 *     with no date are "Unscheduled".
 *   - For the CURRENT quarter only, projects whose date fell in an earlier
 *     quarter and that have not reached Productization are shown as
 *     "carried over" (they are late).
 */

import type { IsoDate, Project } from "@/lib/db";
import {
  STAGE_FIRST,
  STAGE_LAST,
  STAGE_SECOND,
  SECONDARY_OBJECTIVE_OPTIONS,
  SYSTEM_PROGRAMS,
  isAdminProject,
} from "@/lib/projects/display";
import { quarterOf } from "@/lib/key-capabilities";
import { buildReleaseDates, defaultReleaseDate } from "@/lib/releases/calendar";
import type { ReleaseProjectEntry } from "@/lib/releases/report";

export const EXEC_PROGRAM = SYSTEM_PROGRAMS[0]; // "Innovation"

/** The five core pillars, in display order (Complaints/Other excluded). */
export const EXEC_PILLARS: string[] = SECONDARY_OBJECTIVE_OPTIONS;

export const UNSCHEDULED = "unscheduled";

export type ExecPhase = "qualifying" | "inProgress" | "released";

export interface ExecProject {
  entry: ReleaseProjectEntry;
  phase: ExecPhase;
  /** Target date's quarter, e.g. "2026-Q4"; null when unscheduled. */
  quarter: string | null;
  /** Earlier-quarter project not yet at Productization (current quarter only). */
  carriedOver: boolean;
  missingSupports: boolean;
  missingBenefits: boolean;
}

export interface ExecUseCaseGroup {
  name: string;
  projects: ExecProject[];
}

export interface ExecPillar {
  pillar: string;
  projects: ExecProject[];
  groups: ExecUseCaseGroup[];
  counts: {
    total: number;
    qualifying: number;
    inProgress: number;
    released: number;
    missed: number;
    atRisk: number;
    blocked: number;
    undocumented: number;
  };
}

export interface ExecutiveView {
  scope: string;
  pillars: ExecPillar[];
  /** Missed / at-risk / blocked projects in scope, worst first. */
  needsAttention: ExecProject[];
  totalShown: number;
}

export const NO_USE_CASE = "No use case";

export function phaseOf(stage: string): ExecPhase {
  if (stage === STAGE_LAST) return "released";
  if (stage === STAGE_FIRST || stage === STAGE_SECOND) return "qualifying";
  return "inProgress";
}

/** First day of a "YYYY-Qn" quarter as an ISO date. */
export function quarterStart(quarter: string): IsoDate {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) throw new Error(`Bad quarter: ${quarter}`);
  const month = (Number(m[2]) - 1) * 3 + 1;
  return `${m[1]}-${String(month).padStart(2, "0")}-01`;
}

export function previousQuarter(quarter: string): string {
  const m = /^(\d{4})-Q([1-4])$/.exec(quarter);
  if (!m) throw new Error(`Bad quarter: ${quarter}`);
  const y = Number(m[1]);
  const q = Number(m[2]);
  return q === 1 ? `${y - 1}-Q4` : `${y}-Q${q - 1}`;
}

export function quarterOfDate(iso: IsoDate): string {
  return quarterOf(new Date(`${iso}T00:00:00Z`));
}

/** Innovation, non-admin projects (Canceled are already dropped upstream). */
export function isExecCandidate(p: Project): boolean {
  return p.program === EXEC_PROGRAM && !isAdminProject(p);
}

/** Candidate that has one of the five pillars as its primary objective. */
export function isExecEligible(p: Project): boolean {
  return (
    isExecCandidate(p) &&
    p.primary_objective !== null &&
    EXEC_PILLARS.includes(p.primary_objective)
  );
}

/**
 * Innovation projects that have no pillar at all yet (excludes the ones
 * deliberately classed Complaints/Other, which are out of scope).
 */
export function countNoPillar(projects: Project[]): number {
  return projects.filter(
    (p) =>
      isExecCandidate(p) && p.status !== "Canceled" && p.primary_objective === null,
  ).length;
}

function toExecProject(
  entry: ReleaseProjectEntry,
  currentQuarter: string,
): ExecProject {
  const p = entry.project;
  const quarter = p.target_date ? quarterOfDate(p.target_date) : null;
  const phase = phaseOf(p.stage);
  const carriedOver =
    p.target_date !== null &&
    p.target_date < quarterStart(currentQuarter) &&
    phase !== "released";
  return {
    entry,
    phase,
    quarter,
    carriedOver,
    missingSupports: p.supports.trim() === "",
    missingBenefits: p.benefits.trim() === "",
  };
}

/** Whether a project belongs in the selected scope. */
export function inScope(
  ep: ExecProject,
  scope: string,
  currentQuarter: string,
): boolean {
  if (scope === UNSCHEDULED) return ep.quarter === null;
  if (ep.quarter === scope) return true;
  return scope === currentQuarter && ep.carriedOver;
}

export interface BuildExecutiveInput {
  /** Entries for eligible (pillar-assigned Innovation) projects only. */
  entries: ReleaseProjectEntry[];
  scope: string;
  today: IsoDate;
}

export function buildExecutiveView(input: BuildExecutiveInput): ExecutiveView {
  const currentQuarter = quarterOfDate(input.today);
  const scoped = input.entries
    .map((e) => toExecProject(e, currentQuarter))
    .filter((ep) => inScope(ep, input.scope, currentQuarter));

  const pillars: ExecPillar[] = EXEC_PILLARS.map((pillar) => {
    const projects = scoped
      .filter((ep) => ep.entry.project.primary_objective === pillar)
      .sort(
        (a, b) =>
          (a.entry.project.target_date ?? "9999").localeCompare(
            b.entry.project.target_date ?? "9999",
          ) || a.entry.project.name.localeCompare(b.entry.project.name),
      );

    const byUseCase = new Map<string, ExecProject[]>();
    for (const ep of projects) {
      const key = ep.entry.useCaseNames[0] ?? NO_USE_CASE;
      const arr = byUseCase.get(key);
      if (arr) arr.push(ep);
      else byUseCase.set(key, [ep]);
    }
    const groups = [...byUseCase.entries()]
      .map(([name, list]) => ({ name, projects: list }))
      .sort((a, b) =>
        a.name === NO_USE_CASE
          ? 1
          : b.name === NO_USE_CASE
            ? -1
            : a.name.localeCompare(b.name),
      );

    return {
      pillar,
      projects,
      groups,
      counts: {
        total: projects.length,
        qualifying: projects.filter((p) => p.phase === "qualifying").length,
        inProgress: projects.filter((p) => p.phase === "inProgress").length,
        released: projects.filter((p) => p.phase === "released").length,
        missed: projects.filter((p) => p.entry.missedDelivery).length,
        atRisk: projects.filter(
          (p) => p.entry.atRisk && !p.entry.missedDelivery,
        ).length,
        blocked: projects.filter((p) => p.entry.blockers.length > 0).length,
        undocumented: projects.filter(
          (p) => p.missingSupports || p.missingBenefits,
        ).length,
      },
    };
  });

  const needsAttention = scoped
    .filter(
      (ep) =>
        ep.entry.missedDelivery ||
        ep.entry.atRisk ||
        ep.entry.blockers.length > 0,
    )
    .sort(
      (a, b) =>
        Number(b.entry.missedDelivery) - Number(a.entry.missedDelivery) ||
        Number(b.entry.atRisk) - Number(a.entry.atRisk) ||
        b.entry.blockers.length - a.entry.blockers.length ||
        a.entry.project.name.localeCompare(b.entry.project.name),
    );

  return {
    scope: input.scope,
    pillars,
    needsAttention,
    totalShown: scoped.length,
  };
}

export interface ScopeOption {
  value: string;
  label: string;
  count: number;
  isCurrent: boolean;
}

/** Previous, current and next three quarters, plus Unscheduled. */
export function scopeOptions(
  entries: ReleaseProjectEntry[],
  today: IsoDate,
  formatQuarter: (q: string) => string,
): ScopeOption[] {
  const current = quarterOfDate(today);
  const quarters = [previousQuarter(current), current];
  let q = current;
  for (let i = 0; i < 3; i += 1) {
    const m = /^(\d{4})-Q([1-4])$/.exec(q) as RegExpExecArray;
    q = m[2] === "4" ? `${Number(m[1]) + 1}-Q1` : `${m[1]}-Q${Number(m[2]) + 1}`;
    quarters.push(q);
  }
  const eps = entries.map((e) => toExecProject(e, current));
  const opts: ScopeOption[] = quarters.map((value) => ({
    value,
    label: formatQuarter(value),
    count: eps.filter((ep) => inScope(ep, value, current)).length,
    isCurrent: value === current,
  }));
  opts.push({
    value: UNSCHEDULED,
    label: "Unscheduled",
    count: eps.filter((ep) => inScope(ep, UNSCHEDULED, current)).length,
    isCurrent: false,
  });
  return opts;
}

export interface RiskStatus {
  text: "Missed delivery" | "At risk" | "Delivered" | "On track";
  tone: "red" | "green";
}

/** One-word schedule status shared by the page and the deck. */
export function riskStatus(ep: ExecProject): RiskStatus {
  if (ep.entry.missedDelivery) return { text: "Missed delivery", tone: "red" };
  if (ep.entry.atRisk) return { text: "At risk", tone: "red" };
  if (ep.entry.delivered) return { text: "Delivered", tone: "green" };
  return { text: "On track", tone: "green" };
}

export interface UpcomingRelease {
  date: IsoDate;
  projects: number;
  atRisk: number;
  isNext: boolean;
  /** Names of the riding projects (for the deck), at-risk first. */
  items: Array<{ label: string; risk: boolean }>;
}

/**
 * The next `count` scheduled releases on or after today, with how many of
 * the given (eligible) projects ride each and how many are at risk.
 */
export function upcomingReleases(
  entries: ReleaseProjectEntry[],
  today: IsoDate,
  count = 3,
): UpcomingRelease[] {
  const dates = buildReleaseDates(
    entries.map((e) => e.project.target_date).filter((d): d is string => !!d),
    today,
  )
    .filter((o) => o.date >= today)
    .slice(0, count);
  const next = defaultReleaseDate(dates, today);
  return dates.map((o) => {
    const rides = entries.filter((e) => e.project.target_date === o.date);
    return {
      date: o.date,
      projects: rides.length,
      atRisk: rides.filter((e) => e.atRisk || e.missedDelivery).length,
      isNext: o.date === next,
      items: rides
        .map((e) => ({
          label: e.project.name,
          risk: e.atRisk || e.missedDelivery,
        }))
        .sort((a, b) => Number(b.risk) - Number(a.risk) || a.label.localeCompare(b.label)),
    };
  });
}
