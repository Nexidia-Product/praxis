/**
 * Auto-calculated project milestone dates.
 *
 * Each milestone is a pure function of the project's two deployment
 * deadlines (`target_date` — "Target Application Deployment Date" — and
 * `target_executable_deployment_date` — "Target Executable Deployment
 * Date"). They are never stored and never accepted in any create/update
 * payload: every reader (form modal, quick view) calls
 * `computeProjectMilestones` at display time, so a milestone can never
 * drift out of sync with its source date and can never be hand-edited.
 *
 * Business-day math (Mon–Fri, no holiday calendar) doesn't exist anywhere
 * else in this codebase — every other `addDays` helper is plain
 * calendar-day arithmetic — so `subtractBusinessDays` is the first one,
 * scoped to this feature.
 */

import type { IsoDate } from "@/lib/db";

export interface ProjectMilestoneDates {
  new_visualization_file_handoff: IsoDate | null;
  small_function_update_due: IsoDate | null;
  final_input_files_handoff: IsoDate | null;
  final_logic_process_handoff: IsoDate | null;
}

export const MILESTONE_LABELS: Record<keyof ProjectMilestoneDates, string> = {
  new_visualization_file_handoff: "New Visualization File Handoff",
  small_function_update_due: "Small Function Update Due Date",
  final_input_files_handoff: "Final Handoff of Input Files",
  final_logic_process_handoff: "Final Logic/Process Handoff",
};

/**
 * Subtract `days` business days (Monday–Friday; no holiday calendar) from
 * `iso`, landing on a business day. Computed in UTC to dodge DST, same
 * convention as `lib/roadmap/dates.ts`'s `addDays`.
 */
export function subtractBusinessDays(iso: IsoDate, days: number): IsoDate {
  const d = new Date(`${iso}T00:00:00Z`);
  let remaining = days;
  while (remaining > 0) {
    d.setUTCDate(d.getUTCDate() - 1);
    const dow = d.getUTCDay(); // 0 = Sun, 6 = Sat
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

/**
 * Derive the four handoff milestones from a project's two deployment
 * dates. Either input may be `null` (source date not set yet); the
 * milestones that depend on it come back `null` too.
 */
export function computeProjectMilestones(
  targetApplicationDeploymentDate: IsoDate | null,
  targetExecutableDeploymentDate: IsoDate | null,
): ProjectMilestoneDates {
  return {
    new_visualization_file_handoff: targetApplicationDeploymentDate
      ? subtractBusinessDays(targetApplicationDeploymentDate, 15)
      : null,
    small_function_update_due: targetApplicationDeploymentDate
      ? subtractBusinessDays(targetApplicationDeploymentDate, 7)
      : null,
    final_input_files_handoff: targetApplicationDeploymentDate
      ? subtractBusinessDays(targetApplicationDeploymentDate, 3)
      : null,
    final_logic_process_handoff: targetExecutableDeploymentDate
      ? subtractBusinessDays(targetExecutableDeploymentDate, 2)
      : null,
  };
}
