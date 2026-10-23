/**
 * "Build this outcome" — pure helpers (no I/O, client-safe).
 *
 * Given a project and one of its not-yet-planned outcomes, work out the
 * payload for the new project that will deliver that outcome, so an admin
 * doesn't have to key it in by hand. `lib/projects/outcome-build-service.ts`
 * does the I/O: it creates the project from this plan and points the
 * outcome's `delivery` at it.
 *
 * The rules follow how these projects are set up by hand today, e.g.
 * 2026-022 (Enhanced Analysis using Auto Score) → 2026-159 (Coaching Plan
 * for Enhanced Analysis using Auto Score).
 */

import type { Project, ProjectOutcome, UseCase } from "@/lib/db";

/** Why an outcome can't be built, or null when it can. */
export function outcomeBuildBlocker(outcome: ProjectOutcome): string | null {
  if (outcome.delivery) {
    return "This outcome already has a delivery project.";
  }
  return null;
}

/** Everything the plan needs to know about the surrounding data. */
export interface OutcomeBuildContext {
  /** The use case the source project belongs to, if any. */
  useCase: UseCase | null;
  /** `application_product` values already in use, to avoid inventing products. */
  knownApplicationProducts: ReadonlySet<string>;
  /** Admin-managed outcome vocabularies, so generated outcomes stay valid. */
  outcomeProducts: readonly string[];
  outcomeTypes: readonly string[];
}

export interface OutcomeBuildPlan {
  /** Create payload for `createProject`. */
  payload: Record<string, unknown>;
  /** Follow-up values set after creation (they need the use case membership). */
  useCaseOutcomeIds: string[];
  niceProductIds: string[];
}

const COACHING_TRACK = "Track I - Coaching Plan";
const COGNIGY_TRACK = "Track B - Cognigy bot inputs";

const isCoachingPlan = (o: ProjectOutcome) =>
  (o.product ?? "").toLowerCase() === "quality central" &&
  /coaching/i.test(o.text);

/** Lower-case, singularised text for matching outcome names to use case outcomes. */
function matchKey(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => (w.length > 3 ? w.replace(/s$/, "") : w))
    .join(" ");
}

/** Track for the delivery project: by what the outcome is, else the source's track. */
export function trackForOutcome(source: Project, outcome: ProjectOutcome): string {
  if (isCoachingPlan(outcome)) return COACHING_TRACK;
  if ((outcome.product ?? "").toLowerCase() === "cognigy") return COGNIGY_TRACK;
  return source.track;
}

/**
 * The plan for the project that delivers `outcome` of `source`. Throws
 * nothing: the caller checks `outcomeBuildBlocker` first and the service
 * validates the payload as for any other create.
 */
export function planOutcomeProject(
  source: Project,
  outcome: ProjectOutcome,
  ctx: OutcomeBuildContext,
): OutcomeBuildPlan {
  const coaching = isCoachingPlan(outcome);
  const outcomeText = outcome.text.trim();

  const application_product =
    outcome.product && ctx.knownApplicationProducts.has(outcome.product)
      ? outcome.product
      : source.application_product;

  // The new project owns the outcome it was built for, plus (for a coaching
  // plan) the visualization update that surfaces the plans.
  const outcomes: Partial<ProjectOutcome>[] = [
    {
      text: outcomeText,
      product: outcome.product,
      type: outcome.type,
      delivery: { kind: "self" },
    },
  ];
  if (
    coaching &&
    ctx.outcomeProducts.includes("Automated Insights") &&
    ctx.outcomeTypes.includes("visualization")
  ) {
    outcomes.push({
      text: "Updated Automated Insights visualization",
      product: "Automated Insights",
      type: "visualization",
      delivery: { kind: "self" },
    });
  }

  const payload: Record<string, unknown> = {
    name: coaching
      ? `Coaching Plan for ${source.name}`
      : `${outcomeText} for ${source.name}`,
    description: coaching
      ? `Automated coaching plan data developed for ${source.name}. Visualization updated to show coaching plans using the standard view.`
      : `${outcomeText} developed for ${source.name} (${source.project_id}).`,
    definition_of_done: coaching
      ? "Data created for the top 3 agents as part of the executable. Visualization updated with the standard modal."
      : `${outcomeText} delivered and accepted by the product team.`,
    application_product,
    project_type: "New Feature",
    program: source.program,
    track: trackForOutcome(source, outcome),
    visualization_type: source.visualization_type,
    primary_objective: source.primary_objective,
    secondary_objectives: source.secondary_objectives ?? [],
    priority: "Medium",
    status: "Not Started",
    stage: "Qualification",
    project_lead: source.project_lead,
    primary_stakeholders: source.primary_stakeholders,
    outcomes,
  };
  if (ctx.useCase) payload.use_case_id = ctx.useCase.use_case_id;

  // Alignment: same NiCE products as the source, and the use case outcome
  // with the same name as the outcome being built ("Automated Coaching Plan"
  // → "Automated Coaching Plans"). Only values the use case actually has.
  let useCaseOutcomeIds: string[] = [];
  let niceProductIds: string[] = [];
  if (ctx.useCase) {
    const key = matchKey(outcomeText);
    const match = (ctx.useCase.outcomes ?? []).find((o) => matchKey(o.text) === key);
    if (match) useCaseOutcomeIds = [match.id];
    const allowed = new Set(ctx.useCase.nice_product_ids ?? []);
    niceProductIds = (source.nice_product_ids ?? []).filter((id) => allowed.has(id));
  }

  return { payload, useCaseOutcomeIds, niceProductIds };
}
