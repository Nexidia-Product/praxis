/**
 * Post-deployment work — pure helpers (client-safe).
 *
 * A project is "deployed" once its stage has reached Productization (or a
 * track's stage after it). It has "post-deployment work" while it is
 * deployed and its status is still open (anything but Completed / Canceled):
 * the Post-deployment page lists those projects, and Work in progress hides
 * them by default since the build has shipped.
 */

import type { Project } from "@/lib/db";
import { hasReachedProductization } from "@/lib/projects/display";

/** Status values that close a project out. */
const CLOSED_STATUSES: ReadonlySet<string> = new Set(["Completed", "Canceled"]);

/** True once the project's stage has reached Productization or later. */
export function isDeployed(project: Pick<Project, "track" | "stage">): boolean {
  return hasReachedProductization(project.track, project.stage);
}

/** Deployed, and not yet closed out. */
export function isPostDeployment(
  project: Pick<Project, "track" | "stage" | "status">,
): boolean {
  return isDeployed(project) && !CLOSED_STATUSES.has(project.status);
}

/** Section order for the Post-deployment page; other open statuses follow. */
export const POST_DEPLOYMENT_STATUS_ORDER: readonly string[] = [
  "In Progress",
  "In Planning",
  "Blocked",
  "Delayed",
  "On Hold",
  "Not Started",
  "Pending Assignment",
];
