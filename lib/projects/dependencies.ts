/**
 * Project-dependency graph utilities (Section 5.10).
 *
 * The dependency graph is a property of the project repository — every
 * upstream relationship is stored on the *dependent* project's `depends_on`
 * + `dependencies` fields. There is no separate join table (Section 4.1).
 * That keeps the JSON entity-file count at seven and keeps every dependency
 * write atomic with the project record it lives on.
 *
 * Three responsibilities live in this file:
 *
 *   1. **Validate** an inbound dependency payload (project IDs exist; types
 *      and required_phase are well-formed; no self-loop).
 *   2. **Detect circular chains** at save time, with a clear error pointing
 *      at the cycle. We refuse to save a project whose `depends_on` would
 *      complete a cycle anywhere in the graph.
 *   3. **Compute upstream status** for the dependent — used by the warning
 *      banner on the project record (Section 5.10) and by the timeline
 *      arrow color (Section 5.10).
 *
 * No React, no DOM, no fs — these are pure functions over a project list,
 * exercised directly by `smoke-decisions.ts`.
 */

import type {
  DependencyType,
  Project,
  ProjectDependency,
  ProjectId,
  ProjectPhase,
} from "@/lib/db";
import { PROJECT_PHASES } from "@/lib/projects/display";

const DEPENDENCY_TYPES: DependencyType[] = ["Blocks Start", "Blocks Phase"];

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export class DependencyValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DependencyValidationError";
  }
}

/**
 * The shape `validateDependencies` accepts. The project service shapes the
 * inbound JSON into this before calling us; we don't duplicate the loose
 * `unknown` parsing the service already does for the outer payload.
 */
export interface DependencyInput {
  upstream_id: unknown;
  type: unknown;
  required_phase?: unknown;
}

/**
 * Validate and normalize a list of dependency entries. Returns the canonical
 * form (matching the `ProjectDependency` interface in `lib/db/types.ts`)
 * along with the implied `depends_on` array of upstream IDs.
 *
 * - All upstream IDs must exist in `allProjects` (the dependent itself must
 *   already be in `allProjects` if it's an existing project, but we don't
 *   require the dependent to be present — `selfId` is passed separately so
 *   we can refuse self-loops without searching.)
 * - Self-loops (`upstream_id === selfId`) are rejected.
 * - Duplicate upstream IDs collapse to the last-seen entry rather than
 *   throwing — the form lets a user accidentally pick the same upstream
 *   twice and we'd rather silently dedupe than surface a confusing error.
 * - `Blocks Phase` requires `required_phase`; `Blocks Start` ignores it.
 */
export function validateDependencies(
  raw: unknown,
  selfId: ProjectId | null,
  allProjects: Pick<Project, "project_id">[],
): { dependencies: ProjectDependency[]; depends_on: ProjectId[] } {
  if (raw === undefined || raw === null) {
    return { dependencies: [], depends_on: [] };
  }
  if (!Array.isArray(raw)) {
    throw new DependencyValidationError(
      "dependencies must be an array.",
    );
  }

  const known = new Set(allProjects.map((p) => p.project_id));
  const byUpstream = new Map<ProjectId, ProjectDependency>();

  for (let i = 0; i < raw.length; i++) {
    const item = raw[i];
    if (typeof item !== "object" || item === null) {
      throw new DependencyValidationError(
        `dependencies[${i}] must be an object.`,
      );
    }
    const d = item as DependencyInput;

    if (typeof d.upstream_id !== "string" || !d.upstream_id.trim()) {
      throw new DependencyValidationError(
        `dependencies[${i}].upstream_id is required.`,
      );
    }
    const upstream_id = d.upstream_id.trim();
    if (selfId !== null && upstream_id === selfId) {
      throw new DependencyValidationError(
        `A project cannot depend on itself (${selfId}).`,
      );
    }
    if (!known.has(upstream_id)) {
      throw new DependencyValidationError(
        `Upstream project ${upstream_id} does not exist.`,
      );
    }

    if (
      typeof d.type !== "string" ||
      !(DEPENDENCY_TYPES as string[]).includes(d.type)
    ) {
      throw new DependencyValidationError(
        `dependencies[${i}].type must be one of: ${DEPENDENCY_TYPES.join(", ")}.`,
      );
    }
    const type = d.type as DependencyType;

    let required_phase: ProjectPhase | null = null;
    if (type === "Blocks Phase") {
      if (
        typeof d.required_phase !== "string" ||
        !(PROJECT_PHASES as string[]).includes(d.required_phase)
      ) {
        throw new DependencyValidationError(
          `dependencies[${i}].required_phase must be one of: ${PROJECT_PHASES.join(", ")} (when type is "Blocks Phase").`,
        );
      }
      required_phase = d.required_phase as ProjectPhase;
    }

    byUpstream.set(upstream_id, { upstream_id, type, required_phase });
  }

  const dependencies = Array.from(byUpstream.values());
  const depends_on = dependencies.map((d) => d.upstream_id);
  return { dependencies, depends_on };
}

/**
 * Same shape as `validateDependencies` but lets the caller pass through a
 * pre-parsed `depends_on` string array. This is what the inline
 * `depends_on` field on PATCH payloads goes through — when the client only
 * wants to tweak the upstream set without changing types, the existing
 * dependency types are preserved.
 *
 * If a project ID appears in `depends_on` but not in the existing
 * `dependencies`, we default it to `Blocks Start` (the most common type).
 */
export function reconcileDependsOn(
  rawDependsOn: unknown,
  existingDependencies: ProjectDependency[],
  selfId: ProjectId | null,
  allProjects: Pick<Project, "project_id">[],
): { dependencies: ProjectDependency[]; depends_on: ProjectId[] } {
  if (rawDependsOn === undefined || rawDependsOn === null) {
    return {
      dependencies: existingDependencies,
      depends_on: existingDependencies.map((d) => d.upstream_id),
    };
  }
  if (!Array.isArray(rawDependsOn)) {
    throw new DependencyValidationError(
      "depends_on must be an array of project IDs.",
    );
  }
  const known = new Set(allProjects.map((p) => p.project_id));
  const existingByUpstream = new Map(
    existingDependencies.map((d) => [d.upstream_id, d]),
  );
  const out: ProjectDependency[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < rawDependsOn.length; i++) {
    const id = rawDependsOn[i];
    if (typeof id !== "string" || !id.trim()) {
      throw new DependencyValidationError(
        `depends_on[${i}] must be a non-empty string.`,
      );
    }
    const trimmed = id.trim();
    if (selfId !== null && trimmed === selfId) {
      throw new DependencyValidationError(
        `A project cannot depend on itself (${selfId}).`,
      );
    }
    if (!known.has(trimmed)) {
      throw new DependencyValidationError(
        `Upstream project ${trimmed} does not exist.`,
      );
    }
    if (seen.has(trimmed)) continue;
    seen.add(trimmed);
    out.push(
      existingByUpstream.get(trimmed) ?? {
        upstream_id: trimmed,
        type: "Blocks Start",
        required_phase: null,
      },
    );
  }
  return { dependencies: out, depends_on: out.map((d) => d.upstream_id) };
}

// ---------------------------------------------------------------------------
// Circular dependency detection
// ---------------------------------------------------------------------------

/**
 * Detect a cycle that would be introduced by giving project `selfId` the
 * upstream set `proposedUpstreams`, in the context of the current project
 * graph in `allProjects`. Returns the cycle as a list of project IDs
 * (including the closing repeat) if a cycle exists, or `null` if not.
 *
 * Algorithm: build a forward adjacency from each project to its declared
 * upstreams (replacing `selfId`'s with the proposed set), then DFS from
 * `selfId`. If we ever reach `selfId` again we have a cycle.
 *
 * Complexity is O(V + E) over the project graph. The graph is small (low
 * thousands of nodes at most), so we don't bother with iterative-DFS or
 * memoization — a recursive walk is plenty.
 */
export function findCycle(
  selfId: ProjectId,
  proposedUpstreams: ProjectId[],
  allProjects: Pick<Project, "project_id" | "depends_on">[],
): ProjectId[] | null {
  const adjacency = new Map<ProjectId, ProjectId[]>();
  for (const p of allProjects) {
    adjacency.set(
      p.project_id,
      p.project_id === selfId ? [...proposedUpstreams] : [...p.depends_on],
    );
  }
  // If `selfId` is brand-new (a project being created), it isn't in
  // `allProjects` yet — give it a synthetic adjacency entry so DFS starts.
  if (!adjacency.has(selfId)) {
    adjacency.set(selfId, [...proposedUpstreams]);
  }

  const stack: ProjectId[] = [];
  const onPath = new Set<ProjectId>();
  const fullyExplored = new Set<ProjectId>();

  function dfs(node: ProjectId): ProjectId[] | null {
    if (onPath.has(node)) {
      // Found a cycle. Slice the path from the first occurrence and append
      // the closing node to make the cycle explicit in the error message.
      const start = stack.indexOf(node);
      return [...stack.slice(start), node];
    }
    if (fullyExplored.has(node)) return null;

    onPath.add(node);
    stack.push(node);

    const upstreams = adjacency.get(node) ?? [];
    for (const u of upstreams) {
      const cycle = dfs(u);
      if (cycle) return cycle;
    }

    onPath.delete(node);
    fullyExplored.add(node);
    stack.pop();
    return null;
  }

  return dfs(selfId);
}

// ---------------------------------------------------------------------------
// Upstream status rollup (UI consumption)
// ---------------------------------------------------------------------------

export type DependencyHealth = "clear" | "at-risk" | "blocked";

/**
 * Status of one declared dependency, from the dependent's perspective.
 *
 *   - `clear`     upstream is on track or already complete past the gate
 *   - `at-risk`   upstream is `On Hold` or `Delayed`
 *   - `blocked`   upstream is `Blocked` (or, for `Blocks Phase`, hasn't
 *                 reached the required phase and the project is otherwise
 *                 actively trying to start)
 *
 * This is what the timeline arrow color and the project-record warning
 * banner key off of.
 */
export function dependencyHealth(
  dependency: ProjectDependency,
  upstream: Project | undefined,
): DependencyHealth {
  if (!upstream) return "blocked"; // dangling reference; treat as critical
  if (upstream.status === "Blocked") return "blocked";
  if (upstream.status === "Canceled") return "blocked";
  if (upstream.status === "On Hold" || upstream.status === "Delayed") {
    return "at-risk";
  }
  if (dependency.type === "Blocks Phase" && dependency.required_phase) {
    // If the upstream isn't yet at or past the required phase, dependent
    // is blocked from advancing into work that depends on it. We compare
    // by phase index (Appendix C ordering, mirrored in PROJECT_PHASES).
    const upstreamIdx = PROJECT_PHASES.indexOf(upstream.phase);
    const requiredIdx = PROJECT_PHASES.indexOf(dependency.required_phase);
    if (upstreamIdx >= 0 && requiredIdx >= 0 && upstreamIdx < requiredIdx) {
      // Upstream is still in motion but hasn't reached the gate. If
      // upstream is Completed, this is fine — completed-before-gate is
      // a sequencing oddity but not a block. Otherwise: at-risk.
      return upstream.status === "Completed" ? "clear" : "at-risk";
    }
  }
  return "clear";
}

/**
 * Roll the per-dependency healths up into a single project-level health.
 * Worst-case wins: any blocked dep makes the project blocked; any at-risk
 * dep makes the project at-risk; otherwise clear.
 *
 * Returns `null` if the project has no dependencies — callers can use that
 * to skip the warning banner entirely instead of rendering "Clear".
 */
export function rollupDependencyHealth(
  project: Project,
  byId: Map<ProjectId, Project>,
): DependencyHealth | null {
  if (project.dependencies.length === 0) return null;
  let worst: DependencyHealth = "clear";
  for (const dep of project.dependencies) {
    const upstream = byId.get(dep.upstream_id);
    const h = dependencyHealth(dep, upstream);
    if (h === "blocked") return "blocked";
    if (h === "at-risk" && worst === "clear") worst = "at-risk";
  }
  return worst;
}

/**
 * Walk the upstream chain from `project` and return the full set of
 * transitively-reached project IDs (excluding `project` itself). Used by
 * the dependency-chain tree UI on the project record.
 *
 * Cycles, if they somehow snuck in, are tolerated gracefully — we cap
 * recursion via a visited set rather than depth.
 */
export function upstreamChain(
  project: Project,
  byId: Map<ProjectId, Project>,
): ProjectId[] {
  const visited = new Set<ProjectId>();
  const stack: ProjectId[] = [...project.depends_on];
  while (stack.length > 0) {
    const id = stack.pop()!;
    if (visited.has(id)) continue;
    visited.add(id);
    const p = byId.get(id);
    if (p) stack.push(...p.depends_on);
  }
  return Array.from(visited);
}
