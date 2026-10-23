/**
 * Build the project that delivers one of a project's outcomes.
 *
 * Admin action behind the "Create delivery project" button on the quick
 * view Outcomes tab. Creates the project from `planOutcomeProject`, then
 * points the source outcome's `delivery` at it. See
 * `lib/projects/outcome-build.ts` for the rules.
 */

import {
  ProjectRepository,
  SettingsRepository,
  UseCaseRepository,
  type Project,
  type ProjectId,
  type UserId,
} from "@/lib/db";
import {
  outcomeBuildBlocker,
  planOutcomeProject,
} from "@/lib/projects/outcome-build";
import {
  ValidationError,
  createProject,
  updateProject,
} from "@/lib/projects/service";

export interface BuildOutcomeResult {
  /** The newly created delivery project. */
  project: Project;
  /** The source project, with the outcome now linked to the new project. */
  source: Project;
  /** Non-fatal follow-up problems (alignment values that could not be set). */
  warnings: string[];
}

export async function buildOutcomeProject(
  sourceId: ProjectId,
  outcomeId: string,
  ctx: { userId: UserId; userName?: string | null },
): Promise<BuildOutcomeResult> {
  const source = await ProjectRepository.getById(sourceId);
  if (!source) throw new ValidationError(`Project ${sourceId} not found.`);

  const outcome = (source.outcomes ?? []).find((o) => o.id === outcomeId);
  if (!outcome) {
    throw new ValidationError(`Outcome not found on project ${sourceId}.`);
  }
  const blocker = outcomeBuildBlocker(outcome);
  if (blocker) throw new ValidationError(blocker);

  const [settings, allProjects, useCases] = await Promise.all([
    SettingsRepository.get(),
    ProjectRepository.getAll(),
    UseCaseRepository.getForProject(sourceId),
  ]);

  const plan = planOutcomeProject(source, outcome, {
    useCase: useCases[0] ?? null,
    knownApplicationProducts: new Set(allProjects.map((p) => p.application_product)),
    outcomeProducts: settings.outcome_products,
    outcomeTypes: settings.outcome_types,
  });

  let project = await createProject(plan.payload, {
    createdBy: ctx.userId,
    userName: ctx.userName,
  });

  const warnings: string[] = [];

  // Alignment values need the use case membership that createProject just
  // set up, so they go in a second write. A failure leaves a usable project.
  if (plan.useCaseOutcomeIds.length > 0 || plan.niceProductIds.length > 0) {
    try {
      project = await updateProject(
        project.project_id,
        {
          use_case_outcome_ids: plan.useCaseOutcomeIds,
          nice_product_ids: plan.niceProductIds,
        },
        ctx,
      );
    } catch (err) {
      console.warn(
        `[outcome-build] ${project.project_id}: could not set use case alignment:`,
        err,
      );
      warnings.push(
        "The project was created, but its use case outcomes and NiCE products could not be set. Add them from Edit project.",
      );
    }
  }

  // Link the source outcome to the new project.
  const updatedOutcomes = source.outcomes.map((o) =>
    o.id === outcome.id
      ? { ...o, delivery: { kind: "project" as const, project_id: project.project_id } }
      : o,
  );
  let updatedSource: Project;
  try {
    updatedSource = await updateProject(sourceId, { outcomes: updatedOutcomes }, ctx);
  } catch (err) {
    console.warn(
      `[outcome-build] ${project.project_id} was created but ${sourceId} could not be linked:`,
      err,
    );
    warnings.push(
      `The project was created, but the outcome could not be linked to it. Set "Delivered by" to ${project.project_id} from Edit project.`,
    );
    updatedSource = source;
  }

  return { project, source: updatedSource, warnings };
}
