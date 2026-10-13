/**
 * "Days in stage" — how long a project has sat in its current stage.
 * Pure (client-safe). `stage_entered_at` is stamped by a database trigger
 * whenever `stage` changes (migration 0042).
 */

import type { Project } from "@/lib/db";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Whole days since the project entered its current stage (0 = today), or
 * null when that isn't known (column missing before the migration, or an
 * unparseable value). Never negative.
 */
export function daysInStage(
  project: Pick<Project, "stage_entered_at">,
  now: Date = new Date(),
): number | null {
  const raw = project.stage_entered_at;
  if (!raw) return null;
  const entered = Date.parse(raw);
  if (Number.isNaN(entered)) return null;
  return Math.max(0, Math.floor((now.getTime() - entered) / DAY_MS));
}

/** "Entered today", "1 day in stage" or "N days in stage"; "" when unknown. */
export function formatDaysInStage(days: number | null): string {
  if (days === null) return "";
  if (days === 0) return "Entered today";
  return days === 1 ? "1 day in stage" : `${days} days in stage`;
}
