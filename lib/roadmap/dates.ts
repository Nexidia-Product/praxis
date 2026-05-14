/**
 * Date arithmetic used by the Timeline view (Section 5.4) on the
 * Roadmap page and by the Capacity tab on the Insights → Resources
 * page (Section 5.8). Lives under `lib/roadmap/` for historical
 * reasons — this code shipped first as part of the Roadmap, and the
 * Resources Capacity tab reuses it directly rather than forking.
 *
 * Both views share the same projection problem: given a start date, an
 * end date, and a window (start..end of the visible chart), produce a
 * fractional position 0..1 within that window. Projects that fall partly
 * outside the window are clipped at the window edges.
 *
 * All math is done in UTC to avoid surprises on DST boundaries — the JSON
 * store is timezone-agnostic and the dates we work with are calendar
 * dates, not wall-clock instants.
 */

import type { Project } from "@/lib/db";

export type DateGranularity = "weeks" | "months" | "quarters";

export interface TimeWindow {
  start: Date; // inclusive, midnight UTC
  end: Date; // exclusive, midnight UTC
  granularity: DateGranularity;
}

const ONE_DAY_MS = 1000 * 60 * 60 * 24;

/** Parse a YYYY-MM-DD string to a UTC midnight Date. */
export function parseIsoDate(iso: string | null | undefined): Date | null {
  if (!iso) return null;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso);
  if (!m) return null;
  const y = Number(m[1]);
  const mo = Number(m[2]) - 1;
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo, d));
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** Format a Date as YYYY-MM-DD (UTC components). */
export function formatIsoDate(d: Date): string {
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, "0");
  const day = String(d.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** Today as a UTC midnight Date. */
export function todayUtc(): Date {
  const now = new Date();
  return new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
}

export function addDays(d: Date, days: number): Date {
  const result = new Date(d.getTime());
  result.setUTCDate(result.getUTCDate() + days);
  return result;
}

export function addMonths(d: Date, months: number): Date {
  const result = new Date(d.getTime());
  result.setUTCMonth(result.getUTCMonth() + months);
  return result;
}

export function startOfMonth(d: Date): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
}

export function startOfQuarter(d: Date): Date {
  const m = d.getUTCMonth();
  const qStart = m - (m % 3);
  return new Date(Date.UTC(d.getUTCFullYear(), qStart, 1));
}

/** Monday at midnight UTC of the week that contains `d`. */
export function startOfWeek(d: Date): Date {
  // getUTCDay returns 0 (Sun) .. 6 (Sat). Convert to Monday-based:
  //   Mon → 0, Tue → 1, …, Sun → 6
  const dow = (d.getUTCDay() + 6) % 7;
  return addDays(d, -dow);
}

/** Number of whole UTC days between two dates. May be negative. */
export function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / ONE_DAY_MS);
}

// ---------------------------------------------------------------------------
// Window construction
// ---------------------------------------------------------------------------

/**
 * Build a window centered on `today` that stretches `before` units into
 * the past and `after` units into the future. Used as the default
 * landing window for the Timeline view and the Resources Capacity tab.
 */
export function buildWindow(
  granularity: DateGranularity,
  before: number,
  after: number,
  reference: Date = todayUtc(),
): TimeWindow {
  let start: Date;
  let end: Date;
  if (granularity === "weeks") {
    start = startOfWeek(addDays(reference, -before * 7));
    end = startOfWeek(addDays(reference, after * 7 + 7));
  } else if (granularity === "months") {
    start = startOfMonth(addMonths(reference, -before));
    end = startOfMonth(addMonths(reference, after + 1));
  } else {
    start = startOfQuarter(addMonths(reference, -before * 3));
    end = startOfQuarter(addMonths(reference, after * 3 + 3));
  }
  return { start, end, granularity };
}

/**
 * Generate the column tick labels for a window. Each tick is the leading
 * edge of one granularity unit (week / month / quarter).
 *
 * Weekly granularity shows the year on the first tick, on any tick that
 * starts a new calendar month, and on any tick that crosses into a new
 * year. This puts a year stamp on the natural month boundaries the eye
 * already uses to scan a Gantt chart, without repeating "26" on every
 * weekly tick. (A month-only window like "Apr 21, May 5, May 12, Jun 2"
 * would otherwise tell the reader the month-of-year but not the year.)
 */
export function generateTicks(
  window: TimeWindow,
): { date: Date; label: string }[] {
  const { start, end, granularity } = window;
  const ticks: { date: Date; label: string }[] = [];
  let cursor = new Date(start.getTime());
  let lastYear: number | null = null;
  let lastMonth: number | null = null;
  while (cursor < end) {
    let label: string;
    if (granularity === "weeks") {
      const month = cursor.toLocaleString("en-US", {
        month: "short",
        timeZone: "UTC",
      });
      const year = cursor.getUTCFullYear();
      const monthIdx = cursor.getUTCMonth();
      const showYear =
        lastYear === null ||
        year !== lastYear ||
        monthIdx !== lastMonth;
      label = showYear
        ? `${month} ${cursor.getUTCDate()}, ${String(year).slice(2)}`
        : `${month} ${cursor.getUTCDate()}`;
      lastYear = year;
      lastMonth = monthIdx;
    } else if (granularity === "months") {
      label = cursor.toLocaleString("en-US", {
        month: "short",
        year: "2-digit",
        timeZone: "UTC",
      });
    } else {
      const q = Math.floor(cursor.getUTCMonth() / 3) + 1;
      label = `Q${q} ${String(cursor.getUTCFullYear()).slice(2)}`;
    }
    ticks.push({ date: new Date(cursor.getTime()), label });
    if (granularity === "weeks") {
      cursor = addDays(cursor, 7);
    } else if (granularity === "months") {
      cursor = addMonths(cursor, 1);
    } else {
      cursor = addMonths(cursor, 3);
    }
  }
  return ticks;
}

// ---------------------------------------------------------------------------
// Project → bar projection
// ---------------------------------------------------------------------------

export interface ProjectedBar {
  /** 0..1, fraction of window width where the bar starts. */
  leftFrac: number;
  /** 0..1, fraction of window width where the bar ends. */
  rightFrac: number;
  /** True if the bar is fully outside the window. */
  hidden: boolean;
  /** True if the bar's start was clipped to the window. */
  clippedStart: boolean;
  /** True if the bar's end was clipped to the window. */
  clippedEnd: boolean;
  /** True if no end date was supplied. */
  openEnded: boolean;
  start: Date;
  end: Date;
}

/**
 * Project a (start, end) pair onto a window. Falls back gracefully when
 * either date is missing:
 *
 *   - both null    → hidden (caller should probably skip the row)
 *   - end null     → uses today as the end (open-ended bar)
 *   - start null   → uses end - 14 days as a placeholder so the bar has
 *                    width; flagged with `clippedStart`
 */
export function projectInterval(
  startDate: Date | null,
  endDate: Date | null,
  window: TimeWindow,
): ProjectedBar | null {
  if (!startDate && !endDate) return null;
  const today = todayUtc();
  let openEnded = false;
  if (!endDate) {
    openEnded = true;
    endDate = today > (startDate ?? window.start) ? today : window.end;
  }
  if (!startDate) {
    startDate = addDays(endDate, -14);
  }
  const totalMs = window.end.getTime() - window.start.getTime();
  if (totalMs <= 0) return null;

  let actualStart = startDate;
  let actualEnd = endDate;
  let clippedStart = false;
  let clippedEnd = false;

  if (actualEnd <= window.start || actualStart >= window.end) {
    return {
      leftFrac: 0,
      rightFrac: 0,
      hidden: true,
      clippedStart: false,
      clippedEnd: false,
      openEnded,
      start: actualStart,
      end: actualEnd,
    };
  }

  if (actualStart < window.start) {
    actualStart = window.start;
    clippedStart = true;
  }
  if (actualEnd > window.end) {
    actualEnd = window.end;
    clippedEnd = true;
  }

  const leftFrac =
    (actualStart.getTime() - window.start.getTime()) / totalMs;
  const rightFrac = (actualEnd.getTime() - window.start.getTime()) / totalMs;

  return {
    leftFrac: Math.max(0, Math.min(1, leftFrac)),
    rightFrac: Math.max(0, Math.min(1, rightFrac)),
    hidden: false,
    clippedStart,
    clippedEnd,
    openEnded,
    start: startDate,
    end: endDate,
  };
}

/**
 * Convenience: project a project's roadmap window. Uses
 * `roadmap_timeline_start` if set, falling back to `date_added`. Uses
 * `target_date` for the end; if absent, falls back to today (treated as
 * an open-ended bar).
 */
export function projectProjectBar(
  project: Project,
  window: TimeWindow,
): ProjectedBar | null {
  const startIso = project.roadmap_timeline_start ?? project.date_added;
  const start = parseIsoDate(startIso);
  const end = parseIsoDate(project.target_date);
  return projectInterval(start, end, window);
}

/**
 * Inverse of `projectProjectBar` for a single date drag-end gesture.
 * Given a fractional position within the window, returns the calendar
 * date it represents. Used by the Timeline view to snap a bar end-drag
 * back to a `target_date` value.
 */
export function fractionToDate(frac: number, window: TimeWindow): Date {
  const totalMs = window.end.getTime() - window.start.getTime();
  const ms = window.start.getTime() + frac * totalMs;
  return new Date(Math.round(ms / ONE_DAY_MS) * ONE_DAY_MS);
}
