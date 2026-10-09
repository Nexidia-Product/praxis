/**
 * Helpers for choosing a use case when a project is created (pure,
 * client-safe) — shared by the New project form and the idea conversion form.
 *
 * A project that belongs to a use case takes that use case's objectives
 * (`syncMemberObjectives`), so choosing one fills in — and locks — the
 * project's primary/secondary objectives.
 */

import type { UseCase } from "@/lib/db";

const collator = new Intl.Collator("en", { sensitivity: "base", numeric: true });

/** Use cases in alphabetical order by name (the picker's order). */
export function sortedUseCases<T extends Pick<UseCase, "name" | "use_case_id">>(
  useCases: T[],
): T[] {
  return [...useCases].sort(
    (a, b) => collator.compare(a.name, b.name) || collator.compare(a.use_case_id, b.use_case_id),
  );
}

/**
 * The objectives a project inherits from `useCase`, or null when there's
 * nothing to inherit (no use case, or a legacy use case with no primary
 * objective — the server leaves those projects' objectives alone too).
 */
export function inheritedObjectives(
  useCase: Pick<UseCase, "primary_objective" | "secondary_objectives"> | null | undefined,
): { primary: string; secondary: string[] } | null {
  if (!useCase || !useCase.primary_objective) return null;
  return {
    primary: useCase.primary_objective,
    secondary: (useCase.secondary_objectives ?? []).filter((o) => o !== useCase.primary_objective),
  };
}

/** Label for a use case option: its name plus its primary objective. */
export function useCaseOptionLabel(
  useCase: Pick<UseCase, "name" | "primary_objective">,
): string {
  return useCase.primary_objective ? `${useCase.name} (${useCase.primary_objective})` : useCase.name;
}
