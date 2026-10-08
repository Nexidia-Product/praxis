/**
 * Program Coverage — pure graph builder (no I/O, client-safe).
 *
 * Shapes the Innovation portfolio into the drill-down the Program Coverage
 * view renders:
 *
 *   pillar (objective)
 *     └─ use case
 *          └─ use case outcome            (defined on the use case)
 *               └─ supporting projects     (projects that picked the outcome)
 *                    └─ the project's own outcomes ──delivered by──▶ delivery project (leaf)
 *
 * "As of now" — no quarter filter. Everything gets one of three status
 * buckets:
 *
 *   - delivered   reached Productization (or any stage after it), not Canceled
 *   - inProgress  past Prioritization, not yet at Productization
 *   - notStarted  still qualifying, Canceled, not planned, or can't be found
 *
 * How the buckets roll up (`rollupBuckets`): all delivered -> delivered;
 * all not started (or nothing at all) -> not started; anything else ->
 * in progress.
 *   - A project's own outcome is read from the project that delivers it.
 *   - A project is as far along as its own stage AND each of its own
 *     outcomes' delivery (a delivered dashboard whose bot isn't built yet is
 *     in progress, not delivered).
 *   - A use case outcome is as far along as the projects that support it; one
 *     with no supporting project is not started and flagged (`noSupport`).
 *
 * Rules (agreed with the product owner, see ROADMAP-executive-phases.md §8.4):
 *   - Scope matches the Executive view: Innovation program, non-admin,
 *     non-canceled member projects; only the five core pillars. A use case's
 *     pillar is its primary objective. Projects on Tracks D-H
 *     (UI/Application, TopicAI, Complaints, Other, Services Validation) are
 *     left out (`COVERAGE_EXCLUDED_TRACKS`).
 *   - Delivery projects are leaves — their own outcomes are not expanded, so
 *     a link cycle between two projects is harmless. They can be any project
 *     (any program), including one shared by several outcomes.
 *   - Counts are of USE CASE outcomes (what the use case is meant to achieve);
 *     a project's own outcomes show beneath it but aren't counted separately,
 *     and a delivery project is never counted twice.
 *   - A Canceled project is forced to Productization on close-out, so
 *     Canceled is checked explicitly and never reads as delivered.
 */

import type { OutcomeDelivery, Project, ProjectId, UseCase } from "@/lib/db";
import { EXEC_PILLARS, isExecCandidate, phaseOf } from "@/lib/executive/portfolio";
import { deliveryTargetIds } from "@/lib/projects/outcome-delivery";

/**
 * Tracks whose projects don't belong in Program Coverage. Applies to member
 * projects (what the drill-down lists and counts); a project named as an
 * outcome's delivery project is still resolved, since that link is explicit.
 */
export const COVERAGE_EXCLUDED_TRACKS: ReadonlySet<string> = new Set([
  "Track D - UI/Application",
  "Track E - TopicAI",
  "Track F - Complaints",
  "Track G - Other",
  "Track H - Services Validation",
]);

export type OutcomeBucket = "notStarted" | "inProgress" | "delivered";

/** Why an outcome counts as outstanding with nothing to wait on. */
export type OutcomeGap = "notPlanned" | "deliveryCanceled" | "deliveryMissing";

export interface BucketCounts {
  notStarted: number;
  inProgress: number;
  delivered: number;
  total: number;
}

/** Compact reference to a project, for display. */
export interface ProjectRef {
  project_id: ProjectId;
  name: string;
  track: string;
  stage: string;
  status: string;
  target_date: string | null;
  bucket: OutcomeBucket;
}

export interface CoverageOutcome {
  id: string;
  text: string;
  product: string | null;
  type: string | null;
  bucket: OutcomeBucket;
  /** Set when the outcome is outstanding for a structural reason (see `OutcomeGap`). */
  gap: OutcomeGap | null;
  delivery: {
    /** "none" = not yet planned (or a link that can't be resolved). */
    kind: "none" | "self" | "project";
    /** Resolved delivery project; null for "none" and for a missing target. */
    project: ProjectRef | null;
    /** How many outcomes in this graph name `project` as their delivery project (>1 = shared). */
    sharedCount: number;
  };
}

export interface CoverageProject {
  ref: ProjectRef;
  /**
   * How far along the project is counting what it depends on: its own stage
   * and each of its own outcomes' delivery, rolled up (`ref.bucket` is the
   * stage alone).
   */
  bucket: OutcomeBucket;
  visualization_type: string;
  /** The project's own outcomes (what it delivers), each with its delivery project. */
  outcomes: CoverageOutcome[];
  /** Buckets of the project's own outcomes. */
  counts: BucketCounts;
  /** Every project is expected to have an outcome; true when it has none. */
  noOutcomes: boolean;
  /** Ids of the use case outcomes this project supports (only ones the use case defines). */
  supportedOutcomeIds: string[];
}

/** An outcome defined on a use case, with the projects that support it. */
export interface CoverageUseCaseOutcome {
  id: string;
  text: string;
  bucket: OutcomeBucket;
  /** "noSupport" when no in-scope project has picked this outcome. */
  gap: "noSupport" | null;
  /** Supporting member projects, in the use case's member order. */
  projects: CoverageProject[];
}

export interface CoverageUseCase {
  use_case_id: string;
  name: string;
  description: string;
  /** Every in-scope member project. */
  projects: CoverageProject[];
  /** The outcomes the use case defines, with their supporting projects. */
  outcomes: CoverageUseCaseOutcome[];
  /** Member projects that support none of the use case's outcomes. */
  unlinkedProjects: CoverageProject[];
  /** Use case outcome counts by bucket. */
  counts: BucketCounts;
  /** Use case outcomes with no supporting project. */
  gapCount: number;
  /** Projects' own outcomes that are unplanned, canceled or missing a delivery project. */
  projectOutcomeGapCount: number;
  warnings: string[];
}

export interface CoveragePillar {
  pillar: string;
  useCases: CoverageUseCase[];
  counts: BucketCounts;
  projectCount: number;
  gapCount: number;
}

export interface CoverageGraph {
  pillars: CoveragePillar[];
  /** Things left out of the drill-down, so the page can footnote them. */
  excluded: {
    /** Use cases with no (core-pillar) primary objective. */
    useCasesWithoutPillar: number;
    /** In-scope pillar projects that belong to no use case and aren't a delivery project. */
    projectsWithoutUseCase: number;
  };
}

export function emptyCounts(): BucketCounts {
  return { notStarted: 0, inProgress: 0, delivered: 0, total: 0 };
}

function addTo(counts: BucketCounts, bucket: OutcomeBucket): void {
  counts[bucket] += 1;
  counts.total += 1;
}

/**
 * Roll several buckets into one: all delivered -> delivered, all not
 * started (or nothing to look at) -> not started, anything else -> in
 * progress.
 */
export function rollupBuckets(buckets: OutcomeBucket[]): OutcomeBucket {
  if (buckets.length === 0) return "notStarted";
  if (buckets.every((b) => b === "delivered")) return "delivered";
  if (buckets.every((b) => b === "notStarted")) return "notStarted";
  return "inProgress";
}

function sumCounts(list: BucketCounts[]): BucketCounts {
  const out = emptyCounts();
  for (const c of list) {
    out.notStarted += c.notStarted;
    out.inProgress += c.inProgress;
    out.delivered += c.delivered;
    out.total += c.total;
  }
  return out;
}

/**
 * Status bucket for a project, from its stage. Canceled is checked first
 * because closing a project out forces it to Productization.
 */
export function bucketOfProject(p: Pick<Project, "stage" | "track" | "status">): OutcomeBucket {
  if (p.status === "Canceled") return "notStarted";
  const phase = phaseOf(p.stage, p.track);
  if (phase === "released") return "delivered";
  if (phase === "inProgress") return "inProgress";
  return "notStarted";
}

function toRef(p: Project): ProjectRef {
  return {
    project_id: p.project_id,
    name: p.name,
    track: p.track,
    stage: p.stage,
    status: p.status,
    target_date: p.target_date,
    bucket: bucketOfProject(p),
  };
}

export interface BuildCoverageInput {
  /** Every project (any program/status): delivery targets are resolved against all of them. */
  projects: Project[];
  useCases: UseCase[];
}

export function buildCoverageGraph(input: BuildCoverageInput): CoverageGraph {
  const byId = new Map<ProjectId, Project>(input.projects.map((p) => [p.project_id, p]));
  const isMember = (p: Project) =>
    isExecCandidate(p) &&
    p.status !== "Canceled" &&
    !COVERAGE_EXCLUDED_TRACKS.has(p.track);

  // Pass 1: which in-scope projects belong to a pillar use case, and how
  // many outcomes point at each delivery project (for "shared" marking).
  const pillarSet = new Set(EXEC_PILLARS);
  const pillarUseCases = input.useCases.filter(
    (u) => u.primary_objective !== null && pillarSet.has(u.primary_objective),
  );
  const memberIds = new Set<ProjectId>();
  const linkCounts = new Map<ProjectId, number>();
  for (const u of pillarUseCases) {
    for (const id of u.member_project_ids) {
      const p = byId.get(id);
      if (!p || !isMember(p)) continue;
      memberIds.add(id);
      for (const o of p.outcomes ?? []) {
        if (o.delivery?.kind === "project") {
          linkCounts.set(o.delivery.project_id, (linkCounts.get(o.delivery.project_id) ?? 0) + 1);
        }
      }
    }
  }

  function resolveDelivery(
    owner: Project,
    delivery: OutcomeDelivery | null | undefined,
  ): Pick<CoverageOutcome, "bucket" | "gap" | "delivery"> {
    if (!delivery) {
      return {
        bucket: "notStarted",
        gap: "notPlanned",
        delivery: { kind: "none", project: null, sharedCount: 0 },
      };
    }
    if (delivery.kind === "self") {
      const ref = toRef(owner);
      return {
        bucket: ref.bucket,
        gap: null,
        delivery: { kind: "self", project: ref, sharedCount: 0 },
      };
    }
    const target = byId.get(delivery.project_id);
    if (!target) {
      return {
        bucket: "notStarted",
        gap: "deliveryMissing",
        delivery: { kind: "none", project: null, sharedCount: 0 },
      };
    }
    const ref = toRef(target);
    return {
      bucket: ref.bucket,
      gap: target.status === "Canceled" ? "deliveryCanceled" : null,
      delivery: {
        kind: "project",
        project: ref,
        sharedCount: linkCounts.get(target.project_id) ?? 1,
      },
    };
  }

  const pillars: CoveragePillar[] = EXEC_PILLARS.map((pillar) => {
    const useCases: CoverageUseCase[] = pillarUseCases
      .filter((u) => u.primary_objective === pillar)
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((u) => {
        const projects: CoverageProject[] = [];
        const definedOutcomeIds = new Set((u.outcomes ?? []).map((o) => o.id));
        for (const id of u.member_project_ids) {
          const p = byId.get(id);
          if (!p || !isMember(p)) continue;

          const counts = emptyCounts();
          const outcomes: CoverageOutcome[] = (p.outcomes ?? []).map((o) => {
            const r = resolveDelivery(p, o.delivery);
            addTo(counts, r.bucket);
            return {
              id: o.id,
              text: o.text,
              product: o.product,
              type: o.type,
              ...r,
            };
          });

          const ref = toRef(p);
          projects.push({
            ref,
            bucket: rollupBuckets([ref.bucket, ...outcomes.map((o) => o.bucket)]),
            visualization_type: p.visualization_type,
            outcomes,
            counts,
            noOutcomes: outcomes.length === 0,
            supportedOutcomeIds: (p.use_case_outcome_ids ?? []).filter((oid) =>
              definedOutcomeIds.has(oid),
            ),
          });
        }

        // Use case outcomes, each with the member projects that picked it.
        const ucOutcomes: CoverageUseCaseOutcome[] = (u.outcomes ?? []).map((o) => {
          const supporters = projects.filter((p) => p.supportedOutcomeIds.includes(o.id));
          return {
            id: o.id,
            text: o.text,
            bucket: rollupBuckets(supporters.map((p) => p.bucket)),
            gap: supporters.length === 0 ? "noSupport" : null,
            projects: supporters,
          };
        });
        const ucCounts = emptyCounts();
        for (const o of ucOutcomes) addTo(ucCounts, o.bucket);

        // A delivery project that is also a member of the same use case
        // would be shown twice (as a sibling and as a leaf) and have its own
        // outcomes counted as well — flag it rather than guess.
        const warnings: string[] = [];
        const here = new Set(projects.map((p) => p.ref.project_id));
        for (const p of projects) {
          for (const o of p.outcomes) {
            const t = o.delivery.kind === "project" ? o.delivery.project : null;
            if (t && here.has(t.project_id)) {
              warnings.push(
                `${t.name} (${t.project_id}) is both a member of this use case and the delivery project for "${o.text}".`,
              );
            }
          }
        }

        return {
          use_case_id: u.use_case_id,
          name: u.name,
          description: u.description,
          projects,
          outcomes: ucOutcomes,
          unlinkedProjects: projects.filter((p) => p.supportedOutcomeIds.length === 0),
          counts: ucCounts,
          gapCount: ucOutcomes.filter((o) => o.gap !== null).length,
          projectOutcomeGapCount: projects.reduce(
            (n, p) => n + p.outcomes.filter((o) => o.gap !== null).length,
            0,
          ),
          warnings,
        };
      });

    return {
      pillar,
      useCases,
      counts: sumCounts(useCases.map((u) => u.counts)),
      projectCount: useCases.reduce((n, u) => n + u.projects.length, 0),
      gapCount: useCases.reduce((n, u) => n + u.gapCount, 0),
    };
  });

  const deliveryTargets = deliveryTargetIds(input.projects);
  const allMemberIds = new Set(
    input.useCases.flatMap((u) => u.member_project_ids),
  );
  const projectsWithoutUseCase = input.projects.filter(
    (p) =>
      isMember(p) &&
      p.primary_objective !== null &&
      pillarSet.has(p.primary_objective) &&
      !allMemberIds.has(p.project_id) &&
      !deliveryTargets.has(p.project_id),
  ).length;

  return {
    pillars,
    excluded: {
      useCasesWithoutPillar: input.useCases.length - pillarUseCases.length,
      projectsWithoutUseCase,
    },
  };
}
