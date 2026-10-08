/**
 * Outcome → delivery project link: pure helpers (no I/O, client-safe).
 *
 * An outcome's `delivery` says which project delivers it: this project
 * (`self`), another project, or none yet (null). The service validates
 * writes with `normalizeDelivery`; `ProjectRepository.delete` clears links
 * to a deleted project with `clearDeliveryTarget`; the Markdown import
 * carries existing links through unchanged.
 */

import type { OutcomeDelivery, ProjectId, ProjectOutcome } from "@/lib/db";

export type DeliveryResult =
  | { ok: true; value: OutcomeDelivery | null }
  | { ok: false; error: string };

/**
 * Validate one outcome's raw `delivery`. `ownId` is the project the
 * outcome belongs to (undefined on create, when it has no ID yet); a
 * `project` link to the project's own ID is folded into `self`.
 * `knownProjectIds` is the set of target IDs confirmed to exist.
 */
export function normalizeDelivery(
  raw: unknown,
  ownId: ProjectId | undefined,
  knownProjectIds: ReadonlySet<string>,
): DeliveryResult {
  if (raw === undefined || raw === null) return { ok: true, value: null };
  if (typeof raw !== "object") {
    return { ok: false, error: "delivery must be an object or null." };
  }
  const d = raw as Record<string, unknown>;
  if (d.kind === "self") return { ok: true, value: { kind: "self" } };
  if (d.kind === "project") {
    const id = typeof d.project_id === "string" ? d.project_id.trim() : "";
    if (!id) return { ok: false, error: "delivery.project_id is required." };
    if (ownId !== undefined && id === ownId) {
      return { ok: true, value: { kind: "self" } };
    }
    if (!knownProjectIds.has(id)) {
      return { ok: false, error: `delivery project "${id}" was not found.` };
    }
    return { ok: true, value: { kind: "project", project_id: id } };
  }
  return { ok: false, error: 'delivery.kind must be "self" or "project".' };
}

/** Distinct project IDs referenced by `kind: "project"` deliveries in a raw outcomes array. */
export function collectDeliveryTargetIds(raw: unknown): string[] {
  if (!Array.isArray(raw)) return [];
  const ids = new Set<string>();
  for (const o of raw) {
    const d = (o as { delivery?: { kind?: unknown; project_id?: unknown } } | null)?.delivery;
    if (d && d.kind === "project" && typeof d.project_id === "string" && d.project_id.trim()) {
      ids.add(d.project_id.trim());
    }
  }
  return [...ids];
}

/** Outcomes with any link to `projectId` reset to "not yet planned". */
export function clearDeliveryTarget(
  outcomes: ProjectOutcome[],
  projectId: ProjectId,
): ProjectOutcome[] {
  return outcomes.map((o) =>
    o.delivery?.kind === "project" && o.delivery.project_id === projectId
      ? { ...o, delivery: null }
      : o,
  );
}
