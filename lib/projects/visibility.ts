/**
 * Per-user program visibility.
 *
 * Restricting who can see a program (Section: project `program` field) is
 * per-user, not per-role — `User.allowed_programs` (migration 0022), null
 * meaning unrestricted. Every page/route that reads projects or tasks for
 * display should resolve the caller's allowed programs once via
 * `getAllowedPrograms(session)` and filter before the data is used.
 *
 * Tasks don't carry `program` themselves — visibility follows their
 * parent project's, so task filtering always happens after project
 * filtering, using the resulting visible project id set.
 *
 * Deliberately NOT applied to: health-score recalculation (intrinsic to
 * the project, must operate over the true full state regardless of
 * viewer) and the key-capability "max 2 per quarter" check (a global
 * business rule, not a per-viewer list).
 */

import { UserRepository, type Project, type Task } from "@/lib/db";
import type { Session } from "@/lib/auth/permissions";

/**
 * Resolve which programs the current session's user may see.
 * `"all"` means unrestricted (Admins always get this, unconditionally —
 * same hard-bypass convention as every permission check in
 * `lib/auth/permissions.ts`). No session (e.g. a cron/background caller)
 * resolves to `[]` — sees nothing — since there is no viewer to scope to.
 */
export async function getAllowedPrograms(
  session: Session | null,
): Promise<string[] | "all"> {
  if (!session) return [];
  if (session.user.role === "Admin") return "all";
  const user = await UserRepository.getById(session.user.user_id);
  if (!user || user.allowed_programs === null) return "all";
  return user.allowed_programs;
}

export function filterProjectsByProgram<T extends Pick<Project, "program">>(
  projects: T[],
  allowed: string[] | "all",
): T[] {
  if (allowed === "all") return projects;
  const set = new Set(allowed);
  return projects.filter((p) => set.has(p.program));
}

/** Call after filtering projects — restricts tasks to those whose parent
 *  project survived the filter. */
export function filterTasksByVisibleProjects<T extends Pick<Task, "project_id">>(
  tasks: T[],
  visibleProjectIds: ReadonlySet<string>,
): T[] {
  return tasks.filter((t) => visibleProjectIds.has(t.project_id));
}

/**
 * Default program view: a single allowed program always wins (per the
 * confirmed rule — no need for the user to designate a primary when
 * there's only one option); otherwise the user's explicit
 * `primary_program` if it's still valid, else "Innovation" if reachable,
 * else the first allowed program.
 */
export function getDefaultProgram(
  user: { primary_program: string | null },
  allowed: string[] | "all",
): string {
  if (allowed !== "all" && allowed.length === 1) return allowed[0];
  if (
    user.primary_program &&
    (allowed === "all" || allowed.includes(user.primary_program))
  ) {
    return user.primary_program;
  }
  if (allowed === "all" || allowed.includes("Innovation")) return "Innovation";
  return allowed[0] ?? "Innovation";
}
