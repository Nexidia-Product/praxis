/**
 * Use case outcomes — pure helpers (no I/O, client-safe).
 *
 * A use case defines outcomes (`{ id, text }`); a project in that use case
 * picks the ones it supports (`Project.use_case_outcome_ids`). The rules
 * live here so the services, the forms and the smoke test share them:
 *
 *   - outcomes need text, no duplicates (ignoring case/spacing), bounded count;
 *   - a project may only reference outcomes of the use case it belongs to,
 *     and none when it belongs to no use case;
 *   - after any use case change, project picks that no longer point at one
 *     of their own use case's outcomes are dropped (`reconcileOutcomeLinks`).
 */

import type { UseCaseOutcome } from "@/lib/db";

export const MAX_USE_CASE_OUTCOMES = 50;
export const MAX_USE_CASE_OUTCOME_LEN = 500;

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

function normText(text: string): string {
  return text.trim().replace(/\s+/g, " ").toLowerCase();
}

/**
 * Validate a raw outcomes array for a use case. Existing ids are kept (so
 * project picks survive a rename); entries without one get `newId()`.
 */
export function normalizeUseCaseOutcomes(
  raw: unknown,
  newId: () => string,
): Result<UseCaseOutcome[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: "outcomes must be an array." };
  if (raw.length > MAX_USE_CASE_OUTCOMES) {
    return {
      ok: false,
      error: `A use case can have at most ${MAX_USE_CASE_OUTCOMES} outcomes.`,
    };
  }

  const out: UseCaseOutcome[] = [];
  const seenText = new Set<string>();
  const seenId = new Set<string>();
  for (const [i, item] of raw.entries()) {
    if (!item || typeof item !== "object") {
      return { ok: false, error: `outcomes[${i}] must be an object.` };
    }
    const o = item as Record<string, unknown>;
    const text = typeof o.text === "string" ? o.text.trim() : "";
    if (!text) return { ok: false, error: `outcomes[${i}].text is required.` };
    if (text.length > MAX_USE_CASE_OUTCOME_LEN) {
      return {
        ok: false,
        error: `outcomes[${i}].text must be ${MAX_USE_CASE_OUTCOME_LEN} characters or fewer.`,
      };
    }
    const key = normText(text);
    if (seenText.has(key)) {
      return { ok: false, error: `Duplicate outcome: "${text}".` };
    }
    seenText.add(key);

    let id = typeof o.id === "string" ? o.id.trim() : "";
    if (!id || seenId.has(id)) id = newId();
    seenId.add(id);
    out.push({ id, text });
  }
  return { ok: true, value: out };
}

/**
 * Validate the outcome ids a project says it supports. `allowedIds` is the
 * set of outcome ids of the project's use case, or null when the project
 * belongs to no use case (then only an empty selection is valid).
 */
export function validateProjectOutcomeIds(
  raw: unknown,
  allowedIds: ReadonlySet<string> | null,
): Result<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) {
    return { ok: false, error: "use_case_outcome_ids must be an array." };
  }
  const ids: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") {
      return { ok: false, error: "use_case_outcome_ids entries must be strings." };
    }
    const id = v.trim();
    if (id && !ids.includes(id)) ids.push(id);
  }
  if (ids.length === 0) return { ok: true, value: [] };
  if (allowedIds === null) {
    return {
      ok: false,
      error: "This project isn't in a use case, so it can't support use case outcomes.",
    };
  }
  const unknown = ids.filter((id) => !allowedIds.has(id));
  if (unknown.length > 0) {
    return {
      ok: false,
      error: "use_case_outcome_ids must be outcomes of the project's own use case.",
    };
  }
  return { ok: true, value: ids };
}

/**
 * Projects whose picks need trimming: any id that isn't an outcome of the
 * use case the project currently belongs to (all of them, when it belongs
 * to none). Returns only the projects that change, with their new ids.
 */
export function reconcileOutcomeLinks(
  projects: ReadonlyArray<{ project_id: string; use_case_outcome_ids?: string[] | null }>,
  useCases: ReadonlyArray<{
    member_project_ids: string[];
    outcomes?: UseCaseOutcome[] | null;
  }>,
): Array<{ project_id: string; use_case_outcome_ids: string[] }> {
  const allowedByProject = new Map<string, Set<string>>();
  for (const uc of useCases) {
    const ids = new Set((uc.outcomes ?? []).map((o) => o.id));
    for (const pid of uc.member_project_ids) allowedByProject.set(pid, ids);
  }

  const changes: Array<{ project_id: string; use_case_outcome_ids: string[] }> = [];
  for (const p of projects) {
    const current = p.use_case_outcome_ids ?? [];
    if (current.length === 0) continue;
    const allowed = allowedByProject.get(p.project_id);
    const next = allowed ? current.filter((id) => allowed.has(id)) : [];
    if (next.length !== current.length) {
      changes.push({ project_id: p.project_id, use_case_outcome_ids: next });
    }
  }
  return changes;
}
