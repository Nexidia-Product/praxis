/**
 * Server-side data loading for the Program Coverage page.
 *
 * Projects are filtered to the viewer's allowed programs before the graph
 * is built, so a delivery project in a program the viewer can't see is
 * reported as "not found" rather than leaking its name.
 */

import type { Session } from "@/lib/auth/permissions";
import { ProjectRepository, UseCaseRepository } from "@/lib/db";
import { filterProjectsByProgram, getAllowedPrograms } from "@/lib/projects/visibility";
import { buildCoverageGraph, type CoverageGraph } from "./graph";

export async function loadCoverageGraph(session: Session): Promise<CoverageGraph> {
  const [allProjects, useCases] = await Promise.all([
    ProjectRepository.getAll(),
    UseCaseRepository.getAll(),
  ]);
  const allowed = await getAllowedPrograms(session);
  const visible = filterProjectsByProgram(allProjects, allowed);
  return buildCoverageGraph({ projects: visible, useCases });
}
