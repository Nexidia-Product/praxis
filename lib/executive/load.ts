/**
 * Server-side data loading shared by the Executive view page and the deck
 * export route, so both always see exactly the same portfolio.
 */

import type { Session } from "@/lib/auth/permissions";
import {
  ProjectRepository,
  TaskRepository,
  UseCaseRepository,
  UserRepository,
} from "@/lib/db";
import { todayIso } from "@/lib/db/store";
import {
  getAllowedPrograms,
  filterProjectsByProgram,
} from "@/lib/projects/visibility";
import { buildProjectEntries, type ReleaseProjectEntry } from "@/lib/releases/report";
import { countNoPillar, isExecEligible } from "./portfolio";

export interface ExecutiveData {
  today: string;
  /** Entries for pillar-assigned Innovation projects the viewer can see. */
  entries: ReleaseProjectEntry[];
  /** Innovation projects with no pillar yet (not shown, but counted). */
  noPillarCount: number;
}

export async function loadExecutiveData(session: Session): Promise<ExecutiveData> {
  const [allProjects, allTasks, useCases, users] = await Promise.all([
    ProjectRepository.getAll(),
    TaskRepository.getAll(),
    UseCaseRepository.getAll(),
    UserRepository.getAll(),
  ]);

  const allowedPrograms = await getAllowedPrograms(session);
  const visible = filterProjectsByProgram(allProjects, allowedPrograms);

  const userNamesById: Record<string, string> = {};
  for (const u of users) userNamesById[u.user_id] = u.name;

  const today = todayIso();
  const entries = buildProjectEntries({
    today,
    projects: visible.filter(isExecEligible),
    allProjects,
    allTasks,
    useCases,
    userNamesById,
  });

  return {
    today,
    entries,
    noPillarCount: countNoPillar(visible.filter((p) => p.status !== "Canceled")),
  };
}
