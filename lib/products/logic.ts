/**
 * NiCE product alignment — pure helpers (no I/O, client-safe).
 *
 * A use case aligns to products (`UseCase.nice_product_ids`); a project
 * picks from those of the use case it belongs to
 * (`Project.nice_product_ids`). Same shape as use case outcomes
 * (lib/use-cases/outcomes.ts):
 *
 *   - ids must exist; deprecated products can be kept but not newly added;
 *   - a project may only reference products of its own use case (none when
 *     it has no use case);
 *   - after any change, project picks that no longer apply are dropped
 *     (`reconcileProductLinks`).
 *
 * The same module owns the product filter used by every list/insight view
 * (`matchesProductFilter`).
 */

import type { NiceProduct } from "@/lib/db";

export type Result<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_PRODUCT_NAME_LEN = 200;
export const MAX_PRODUCT_DESCRIPTION_LEN = 2000;

function ids(raw: unknown, field: string): Result<string[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, error: `${field} must be an array.` };
  const out: string[] = [];
  for (const v of raw) {
    if (typeof v !== "string") {
      return { ok: false, error: `${field} entries must be strings.` };
    }
    const id = v.trim();
    if (id && !out.includes(id)) out.push(id);
  }
  return { ok: true, value: out };
}

/**
 * Validate the product ids a use case aligns to. Every id must be a known
 * product; a deprecated one is accepted only if it was already on the use
 * case (`existing`).
 */
export function validateUseCaseProductIds(
  raw: unknown,
  products: ReadonlyArray<Pick<NiceProduct, "product_id" | "name" | "deprecated">>,
  existing: readonly string[] = [],
): Result<string[]> {
  const r = ids(raw, "nice_product_ids");
  if (!r.ok) return r;
  const byId = new Map(products.map((p) => [p.product_id, p]));
  for (const id of r.value) {
    const p = byId.get(id);
    if (!p) return { ok: false, error: `Unknown NiCE product ${id}.` };
    if (p.deprecated && !existing.includes(id)) {
      return { ok: false, error: `${p.name} is deprecated and can't be newly added.` };
    }
  }
  return r;
}

/**
 * Validate the product ids a project aligns to. `allowedIds` is the set of
 * product ids of the project's use case, or null when it has none (then only
 * an empty selection is valid).
 */
export function validateProjectProductIds(
  raw: unknown,
  allowedIds: ReadonlySet<string> | null,
): Result<string[]> {
  const r = ids(raw, "nice_product_ids");
  if (!r.ok || r.value.length === 0) return r;
  if (allowedIds === null) {
    return {
      ok: false,
      error: "This project isn't in a use case, so it can't align to NiCE products.",
    };
  }
  if (r.value.some((id) => !allowedIds.has(id))) {
    return {
      ok: false,
      error: "nice_product_ids must be products of the project's own use case.",
    };
  }
  return r;
}

/** Projects whose picks need trimming; returns only those that change. */
export function reconcileProductLinks(
  projects: ReadonlyArray<{ project_id: string; nice_product_ids?: string[] | null }>,
  useCases: ReadonlyArray<{
    member_project_ids: string[];
    nice_product_ids?: string[] | null;
  }>,
): Array<{ project_id: string; nice_product_ids: string[] }> {
  const allowedByProject = new Map<string, Set<string>>();
  for (const uc of useCases) {
    const set = new Set(uc.nice_product_ids ?? []);
    for (const pid of uc.member_project_ids) allowedByProject.set(pid, set);
  }
  const changes: Array<{ project_id: string; nice_product_ids: string[] }> = [];
  for (const p of projects) {
    const current = p.nice_product_ids ?? [];
    if (current.length === 0) continue;
    const allowed = allowedByProject.get(p.project_id);
    const next = allowed ? current.filter((id) => allowed.has(id)) : [];
    if (next.length !== current.length) {
      changes.push({ project_id: p.project_id, nice_product_ids: next });
    }
  }
  return changes;
}

// ---------------------------------------------------------------------------
// Filtering (shared by every view's "Product alignment" filter)
// ---------------------------------------------------------------------------

/** Sentinel filter value meaning "aligned to no product". */
export const NO_PRODUCT = "__none__";

/**
 * True when an item aligned to `itemProductIds` passes a product filter.
 * An empty filter matches everything; otherwise any overlap matches (OR),
 * with `NO_PRODUCT` matching items aligned to nothing.
 */
export function matchesProductFilter(
  itemProductIds: readonly string[] | null | undefined,
  selected: readonly string[],
): boolean {
  if (selected.length === 0) return true;
  const have = itemProductIds ?? [];
  if (have.length === 0) return selected.includes(NO_PRODUCT);
  return have.some((id) => selected.includes(id));
}

/** Filter options: active products first, then deprecated ones labelled as such. */
export function productFilterOptions(
  products: ReadonlyArray<Pick<NiceProduct, "product_id" | "name" | "deprecated">>,
): Array<{ value: string; label: string }> {
  const sorted = [...products].sort(
    (a, b) =>
      Number(a.deprecated) - Number(b.deprecated) || a.name.localeCompare(b.name),
  );
  return [
    ...sorted.map((p) => ({
      value: p.product_id,
      label: p.deprecated ? `${p.name} (deprecated)` : p.name,
    })),
    { value: NO_PRODUCT, label: "No product" },
  ];
}

/** Validate a product's name/description. `name` is mandatory when `requireName`. */
export function validateProductFields(
  name: unknown,
  description: unknown,
  requireName: boolean,
): Result<{ name?: string; description?: string }> {
  const out: { name?: string; description?: string } = {};
  if (name !== undefined || requireName) {
    if (typeof name !== "string" || name.trim() === "") {
      return { ok: false, error: "name is required." };
    }
    const t = name.trim().replace(/\s+/g, " ");
    if (t.length > MAX_PRODUCT_NAME_LEN) {
      return { ok: false, error: `name must be ${MAX_PRODUCT_NAME_LEN} characters or fewer.` };
    }
    out.name = t;
  }
  if (description !== undefined && description !== null) {
    if (typeof description !== "string") {
      return { ok: false, error: "description must be a string." };
    }
    const t = description.trim();
    if (t.length > MAX_PRODUCT_DESCRIPTION_LEN) {
      return {
        ok: false,
        error: `description must be ${MAX_PRODUCT_DESCRIPTION_LEN} characters or fewer.`,
      };
    }
    out.description = t;
  }
  return { ok: true, value: out };
}
