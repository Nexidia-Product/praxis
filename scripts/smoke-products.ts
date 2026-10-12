/**
 * Smoke test for NiCE product alignment (`lib/products/logic.ts`). Pure, no
 * database.
 *
 * Run with:
 *   npm run smoke:products
 */

import assert from "node:assert/strict";

import {
  NO_PRODUCT,
  matchesProductFilter,
  productFilterOptions,
  reconcileProductLinks,
  validateProductFields,
  validateProjectProductIds,
  validateUseCaseProductIds,
} from "@/lib/products/logic";

const products = [
  { product_id: "p1", name: "Quality Management", deprecated: false },
  { product_id: "p2", name: "Old Thing", deprecated: true },
  { product_id: "p3", name: "Copilot for Agents", deprecated: false },
];

// ---- validateUseCaseProductIds ----
assert.deepEqual(validateUseCaseProductIds(undefined, products), { ok: true, value: [] });
assert.deepEqual(validateUseCaseProductIds(["p1", " p3 ", "p1"], products), { ok: true, value: ["p1", "p3"] });
assert.equal(validateUseCaseProductIds(["nope"], products).ok, false, "unknown product");
assert.equal(validateUseCaseProductIds("p1", products).ok, false, "not an array");
assert.equal(validateUseCaseProductIds([1], products).ok, false, "non-string entry");
assert.equal(validateUseCaseProductIds(["p2"], products).ok, false, "deprecated can't be newly added");
assert.deepEqual(validateUseCaseProductIds(["p2"], products, ["p2"]), { ok: true, value: ["p2"] }, "deprecated can be kept");

// ---- validateProjectProductIds ----
const allowed = new Set(["p1", "p3"]);
assert.deepEqual(validateProjectProductIds(undefined, allowed), { ok: true, value: [] });
assert.deepEqual(validateProjectProductIds(["p1"], allowed), { ok: true, value: ["p1"] });
assert.equal(validateProjectProductIds(["p2"], allowed).ok, false, "not a product of the use case");
assert.deepEqual(validateProjectProductIds([], null), { ok: true, value: [] });
assert.equal(validateProjectProductIds(["p1"], null).ok, false, "no use case => nothing selectable");

// ---- reconcileProductLinks ----
const useCases = [
  { member_project_ids: ["a", "b"], nice_product_ids: ["p1"] },
  { member_project_ids: ["c"], nice_product_ids: ["p3"] },
];
const projects = [
  { project_id: "a", nice_product_ids: ["p1"] }, // valid
  { project_id: "b", nice_product_ids: ["p1", "p3"] }, // p3 not on its use case
  { project_id: "c", nice_product_ids: ["p1"] }, // belongs to the other use case
  { project_id: "d", nice_product_ids: ["p1"] }, // in no use case
  { project_id: "e", nice_product_ids: [] }, // nothing selected
  { project_id: "f" }, // legacy row
];
assert.deepEqual(reconcileProductLinks(projects, useCases), [
  { project_id: "b", nice_product_ids: ["p1"] },
  { project_id: "c", nice_product_ids: [] },
  { project_id: "d", nice_product_ids: [] },
]);

// ---- matchesProductFilter ----
assert.equal(matchesProductFilter(["p1"], []), true, "empty filter matches all");
assert.equal(matchesProductFilter([], []), true);
assert.equal(matchesProductFilter(["p1", "p3"], ["p3"]), true, "any overlap");
assert.equal(matchesProductFilter(["p1"], ["p3"]), false);
assert.equal(matchesProductFilter([], ["p3"]), false, "unaligned doesn't match a product");
assert.equal(matchesProductFilter([], [NO_PRODUCT]), true, "No product matches unaligned");
assert.equal(matchesProductFilter(undefined, [NO_PRODUCT]), true, "legacy rows count as unaligned");
assert.equal(matchesProductFilter(["p1"], [NO_PRODUCT]), false);
assert.equal(matchesProductFilter(["p1"], [NO_PRODUCT, "p1"]), true);

// ---- productFilterOptions ----
assert.deepEqual(productFilterOptions(products).map((o) => o.label), [
  "Copilot for Agents",
  "Quality Management",
  "Old Thing (deprecated)",
  "No product",
]);

// ---- validateProductFields ----
assert.deepEqual(validateProductFields("  NiCE   CXone ", " desc ", true), {
  ok: true,
  value: { name: "NiCE CXone", description: "desc" },
});
assert.equal(validateProductFields("", "", true).ok, false, "name required on create");
assert.equal(validateProductFields(undefined, "x", true).ok, false);
assert.deepEqual(validateProductFields(undefined, undefined, false), { ok: true, value: {} });
assert.equal(validateProductFields("x".repeat(201), "", true).ok, false, "name too long");
assert.equal(validateProductFields("ok", 5, true).ok, false, "description must be a string");

console.log("smoke-products: all assertions passed");
