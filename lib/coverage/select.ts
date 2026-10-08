/**
 * Program Coverage — which drill-down level a URL selects (pure).
 *
 *   (none)                 → level 1: the five pillars
 *   ?pillar=X              → level 2: that pillar's use cases
 *   ?pillar=X&useCase=ID   → level 3: that use case's projects and outcomes
 *
 * An unknown pillar falls back to level 1; an unknown use case (or one
 * that isn't in the pillar) falls back to level 2, so a stale link degrades
 * gracefully instead of 404ing.
 */

import type { CoverageGraph, CoveragePillar, CoverageUseCase } from "./graph";

export type CoverageSelection =
  | { level: 1 }
  | { level: 2; pillar: CoveragePillar }
  | { level: 3; pillar: CoveragePillar; useCase: CoverageUseCase };

export function resolveCoverageSelection(
  graph: CoverageGraph,
  pillarName?: string,
  useCaseId?: string,
): CoverageSelection {
  const pillar = pillarName
    ? graph.pillars.find((p) => p.pillar === pillarName)
    : undefined;
  if (!pillar) return { level: 1 };
  const useCase = useCaseId
    ? pillar.useCases.find((u) => u.use_case_id === useCaseId)
    : undefined;
  if (!useCase) return { level: 2, pillar };
  return { level: 3, pillar, useCase };
}

/** Link to a drill-down level. */
export function coverageHref(pillar?: string, useCaseId?: string): string {
  const base = "/insights/program-coverage";
  if (!pillar) return base;
  const params = new URLSearchParams({ pillar });
  if (useCaseId) params.set("useCase", useCaseId);
  return `${base}?${params.toString()}`;
}
