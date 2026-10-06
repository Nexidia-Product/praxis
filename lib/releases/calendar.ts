/**
 * Application Release calendar.
 *
 * Releases ship every other Friday on a fixed schedule; a project's
 * release is its `target_date` ("Target Application Deployment Date").
 * The schedule is anchored on a known release Friday and steps in
 * 14-day increments in both directions.
 *
 * The selectable list is the schedule UNIONED with every distinct
 * project `target_date`, so a project whose date is off-schedule is
 * never unreachable — it shows up flagged "off-cycle".
 *
 * Pure and framework-free, like lib/key-capabilities.ts.
 */

import type { IsoDate } from "@/lib/db";

/** A known release Friday. Every release is a multiple of 14 days from it. */
export const RELEASE_ANCHOR_DATE: IsoDate = "2026-10-09";

const DAY_MS = 86_400_000;

function toMs(iso: IsoDate): number {
  return Date.parse(`${iso}T00:00:00Z`);
}

function fromMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export interface ReleaseDateOption {
  date: IsoDate;
  /** Number of projects with this Target Application Deployment Date. */
  projectCount: number;
  /** True when the date is not on the every-other-Friday schedule. */
  offCycle: boolean;
}

/** Add `days` calendar days to an ISO date. */
export function addCalendarDays(iso: IsoDate, days: number): IsoDate {
  return fromMs(toMs(iso) + days * DAY_MS);
}

/** Whether `iso` is on the every-other-Friday release schedule. */
export function isScheduledReleaseDate(iso: IsoDate): boolean {
  const days = Math.round((toMs(iso) - toMs(RELEASE_ANCHOR_DATE)) / DAY_MS);
  return days % 14 === 0;
}

/**
 * Selectable release dates, ascending. `projectDates` is every project's
 * `target_date` (nulls already removed; duplicates fine).
 */
export function buildReleaseDates(
  projectDates: IsoDate[],
  today: IsoDate,
): ReleaseDateOption[] {
  // Releases before the anchor were all off-cycle, so they are not part
  // of the release calendar at all: dropped from the list, and any
  // project dated before the anchor is ignored here.
  const counts = new Map<IsoDate, number>();
  for (const d of projectDates) {
    if (d < RELEASE_ANCHOR_DATE) continue;
    counts.set(d, (counts.get(d) ?? 0) + 1);
  }

  let start = addCalendarDays(today, -84);
  if (start < RELEASE_ANCHOR_DATE) start = RELEASE_ANCHOR_DATE;
  let end = addCalendarDays(today, 182);
  for (const d of counts.keys()) {
    if (d > end) end = d;
  }

  const dates = new Set<IsoDate>();
  // First scheduled release on or after `start`.
  const offset = Math.round((toMs(start) - toMs(RELEASE_ANCHOR_DATE)) / DAY_MS);
  const firstSteps = Math.ceil(offset / 14);
  for (
    let d = addCalendarDays(RELEASE_ANCHOR_DATE, firstSteps * 14);
    d <= end;
    d = addCalendarDays(d, 14)
  ) {
    dates.add(d);
  }
  for (const d of counts.keys()) dates.add(d);

  return [...dates].sort().map((date) => ({
    date,
    projectCount: counts.get(date) ?? 0,
    offCycle: !isScheduledReleaseDate(date),
  }));
}

/**
 * Which date to show when none is requested: the upcoming scheduled
 * release, i.e. the first on-schedule date on or after today — whether or
 * not it has projects yet. On a release day itself that release is still
 * "upcoming"; the day after, the default moves to the next one. Falls back
 * to the most recent date in the list if none is upcoming.
 */
export function defaultReleaseDate(
  options: ReleaseDateOption[],
  today: IsoDate,
): IsoDate | null {
  const upcoming = options.find((o) => !o.offCycle && o.date >= today);
  if (upcoming) return upcoming.date;
  return options[options.length - 1]?.date ?? null;
}
