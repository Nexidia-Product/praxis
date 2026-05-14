/**
 * Now / Next / Later helpers (Section 5.7).
 *
 * The view has three primary columns plus an "Unplaced" overflow lane.
 * Projects are stored with a free-form `roadmap_bucket` field; for the
 * Now/Next/Later view the convention is that the value is one of "Now",
 * "Next", "Later", "Unplaced", or null. When the value is null the
 * auto-placement heuristic below picks a column — the user can always
 * override by dragging.
 *
 * Heuristic, in order:
 *
 *   1. Active status (In Progress / Blocked / Delayed) → Now.
 *      Work in motion is Now regardless of any planned date.
 *   2. On Hold → Unplaced. Paused work doesn't fit a horizon.
 *   3. Start date is the primary signal when present:
 *        - start_date ≤ today + 14d → Now (starting soon)
 *        - start_date ≤ today + 90d → Next (within ~1 quarter)
 *        - start_date > today + 90d → Later
 *      Imminent active-status target dates can still pull a project
 *      forward to Now even with a far-future start date — but that
 *      already fell out of step 1.
 *   4. No start date, but Not Started / In Planning:
 *        - target_date ≤ today + 30d → Now (target pulls forward)
 *        - has target_date (further out) → Next (status floor; far
 *          target doesn't push back to Later — see ROAD-16)
 *        - no target_date either → Later (no signal at all; the
 *          status alone doesn't earn the Next column ahead of
 *          dated projects)
 *   5. No start date, no committed status:
 *        - target_date drives placement (≤30d Now, ≤90d Next, else Later)
 *   6. Anything left → Unplaced (no signal).
 *
 * Why start_date dominates target_date when both are set:
 * "When does work start?" is the question Now/Next/Later answers.
 * A project due in 9 months that we plan to start next week belongs
 * in Now; the same project starting in 6 months belongs in Later.
 * Target date alone can't make that distinction.
 */

import { parseIsoDate, todayUtc } from "./dates";
import type { Project } from "@/lib/db";

export type NowNextLaterBucket = "Now" | "Next" | "Later" | "Unplaced";

export const NNL_COLUMNS: NowNextLaterBucket[] = [
  "Now",
  "Next",
  "Later",
  "Unplaced",
];

const NOW_DAYS = 30; // Target-date Now window (no start_date)
const START_NOW_DAYS = 14; // Start-date Now window (tighter; "starting soon")
const NEXT_DAYS = 90; // ~1 quarter — both windows

export function suggestedBucket(project: Project): NowNextLaterBucket {
  // 1. Active-status projects are Now regardless of date.
  if (
    project.status === "In Progress" ||
    project.status === "Blocked" ||
    project.status === "Delayed"
  ) {
    return "Now";
  }

  // 2. Paused work doesn't belong on any horizon — flag for human review.
  if (project.status === "On Hold") {
    return "Unplaced";
  }

  const today = todayUtc();
  const start = parseIsoDate(project.roadmap_timeline_start);
  const target = parseIsoDate(project.target_date);

  const startDiffDays = start
    ? Math.round((start.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;
  const targetDiffDays = target
    ? Math.round((target.getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    : null;

  // 3. Start date is the primary signal when present. A negative
  // start_diff (i.e., the planned start is in the past) for a
  // not-yet-active project means "we said we'd start, we didn't" —
  // that's still Now (the work should be happening) rather than
  // somehow demoted.
  if (startDiffDays !== null) {
    if (startDiffDays <= START_NOW_DAYS) return "Now";
    if (startDiffDays <= NEXT_DAYS) return "Next";
    return "Later";
  }

  // 4. Committed-but-not-started projects WITH a target date floor at
  // Next. Imminent target dates pull forward to Now; far targets don't
  // push back to Later — that would penalize the act of dating a
  // project (adding a far-future date would silently demote it).
  //
  // Without a target date, "Not Started + no dates + no other signal"
  // doesn't earn the Next column ahead of projects with concrete
  // near-term plans. Those drop to Later instead — Later is "planned
  // but not yet scheduled," which is exactly what an undated
  // Not Started project is. The floor is a *protection*, not a
  // promotion: it only kicks in when there's a date to protect.
  if (project.status === "In Planning" || project.status === "Not Started") {
    if (targetDiffDays === null) {
      // No date signal at all → Later, not Next.
      return "Later";
    }
    if (targetDiffDays <= NOW_DAYS) return "Now";
    return "Next";
  }

  // 5. Open project with no committed status, no start date. Target
  // date is the only signal.
  if (targetDiffDays !== null) {
    if (targetDiffDays <= NOW_DAYS) return "Now";
    if (targetDiffDays <= NEXT_DAYS) return "Next";
    return "Later";
  }

  // 6. No signals at all. Honest answer: we don't know.
  return "Unplaced";
}

/**
 * Resolve which column a project should appear in. Honors a manual
 * `roadmap_bucket` value when it matches one of the four known buckets;
 * otherwise falls back to the auto-suggestion. Projects with status
 * "Completed" / "Canceled" return null and are excluded from the view.
 */
export function resolveBucket(project: Project): NowNextLaterBucket | null {
  if (project.status === "Completed" || project.status === "Canceled") {
    return null;
  }
  const stored = project.roadmap_bucket;
  if (
    stored === "Now" ||
    stored === "Next" ||
    stored === "Later" ||
    stored === "Unplaced"
  ) {
    return stored;
  }
  return suggestedBucket(project);
}

/** True when the project's bucket comes from the auto-suggester rather
 *  than a manual override. The UI uses this to badge the card as "Auto"
 *  so the user knows they can lock it in by dragging. */
export function isAutoPlaced(project: Project): boolean {
  if (project.status === "Completed" || project.status === "Canceled") {
    return false;
  }
  const stored = project.roadmap_bucket;
  return (
    stored !== "Now" &&
    stored !== "Next" &&
    stored !== "Later" &&
    stored !== "Unplaced"
  );
}
