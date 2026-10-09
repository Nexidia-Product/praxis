/**
 * Which projects an idea can be merged into, and in what order (pure,
 * client-safe). Used by the Idea Review "Merge into project" picker.
 *
 *   - Completed and Canceled projects are excluded: the task service rejects
 *     new tasks on them, so offering one is a guaranteed failure.
 *   - Alphabetical by name (case-insensitive, numbers in natural order), then
 *     by ID so equal names have a stable order.
 *   - An optional search matches the name or the project ID, every word of
 *     the query having to appear (any order, ignoring case).
 */

import type { Project } from "@/lib/db";

type Candidate = Pick<Project, "project_id" | "name" | "status">;

export function isMergeable(p: Pick<Project, "status">): boolean {
  return p.status !== "Completed" && p.status !== "Canceled";
}

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

export function mergeCandidates<T extends Candidate>(projects: T[], query = ""): T[] {
  const words = query.toLowerCase().split(/\s+/).filter(Boolean);
  return projects
    .filter(isMergeable)
    .filter((p) => {
      if (words.length === 0) return true;
      const hay = `${p.name} ${p.project_id}`.toLowerCase();
      return words.every((w) => hay.includes(w));
    })
    .sort(
      (a, b) =>
        collator.compare(a.name, b.name) || collator.compare(a.project_id, b.project_id),
    );
}
