/**
 * Smoke test for use case outcomes (`lib/use-cases/outcomes.ts`). Pure, no
 * database.
 *
 * Run with:
 *   npm run smoke:use-case-outcomes
 */

import assert from "node:assert/strict";

import {
  MAX_USE_CASE_OUTCOMES,
  normalizeUseCaseOutcomes,
  reconcileOutcomeLinks,
  validateProjectOutcomeIds,
} from "@/lib/use-cases/outcomes";

let n = 0;
const newId = () => `new-${++n}`;

// ---- normalizeUseCaseOutcomes ----
assert.deepEqual(normalizeUseCaseOutcomes(undefined, newId), { ok: true, value: [] });
assert.deepEqual(normalizeUseCaseOutcomes(null, newId), { ok: true, value: [] });
assert.equal(normalizeUseCaseOutcomes("nope", newId).ok, false);

const good = normalizeUseCaseOutcomes(
  [{ id: "keep-1", text: "  Reduce hold time  " }, { text: "Bot handles transfers" }],
  newId,
);
assert.ok(good.ok);
assert.deepEqual(good.ok && good.value, [
  { id: "keep-1", text: "Reduce hold time" },
  { id: "new-1", text: "Bot handles transfers" },
]);

assert.equal(normalizeUseCaseOutcomes([{ text: "   " }], newId).ok, false, "blank text");
assert.equal(normalizeUseCaseOutcomes([null], newId).ok, false, "non-object");
assert.equal(
  normalizeUseCaseOutcomes([{ text: "Same thing" }, { text: "  same   THING " }], newId).ok,
  false,
  "duplicates ignore case and spacing",
);
const dupId = normalizeUseCaseOutcomes([{ id: "x", text: "A" }, { id: "x", text: "B" }], newId);
assert.ok(dupId.ok && dupId.value[0].id === "x" && dupId.value[1].id !== "x", "a repeated id is replaced");
assert.equal(
  normalizeUseCaseOutcomes(Array.from({ length: MAX_USE_CASE_OUTCOMES + 1 }, (_, i) => ({ text: `o${i}` })), newId).ok,
  false,
  "too many",
);
assert.equal(normalizeUseCaseOutcomes([{ text: "x".repeat(501) }], newId).ok, false, "too long");

// ---- validateProjectOutcomeIds ----
const allowed = new Set(["a", "b", "c"]);
assert.deepEqual(validateProjectOutcomeIds(undefined, allowed), { ok: true, value: [] });
assert.deepEqual(validateProjectOutcomeIds(["a", " b ", "a"], allowed), { ok: true, value: ["a", "b"] });
assert.equal(validateProjectOutcomeIds(["z"], allowed).ok, false, "not an outcome of the use case");
assert.equal(validateProjectOutcomeIds("a", allowed).ok, false, "not an array");
assert.equal(validateProjectOutcomeIds([1], allowed).ok, false, "non-string entry");
assert.deepEqual(validateProjectOutcomeIds([], null), { ok: true, value: [] }, "empty is fine with no use case");
assert.equal(validateProjectOutcomeIds(["a"], null).ok, false, "no use case => nothing selectable");

// ---- reconcileOutcomeLinks ----
const useCases = [
  { member_project_ids: ["p1", "p2"], outcomes: [{ id: "a", text: "A" }, { id: "b", text: "B" }] },
  { member_project_ids: ["p3"], outcomes: [{ id: "c", text: "C" }] },
];
const projects = [
  { project_id: "p1", use_case_outcome_ids: ["a", "b"] }, // all valid
  { project_id: "p2", use_case_outcome_ids: ["a", "gone"] }, // one removed from the use case
  { project_id: "p3", use_case_outcome_ids: ["a"] }, // belongs to the other use case now
  { project_id: "p4", use_case_outcome_ids: ["a"] }, // in no use case
  { project_id: "p5", use_case_outcome_ids: [] }, // nothing selected
  { project_id: "p6" }, // legacy row without the column
];
assert.deepEqual(reconcileOutcomeLinks(projects, useCases), [
  { project_id: "p2", use_case_outcome_ids: ["a"] },
  { project_id: "p3", use_case_outcome_ids: [] },
  { project_id: "p4", use_case_outcome_ids: [] },
]);
assert.deepEqual(reconcileOutcomeLinks(projects, [{ member_project_ids: ["p1"] }]), [
  { project_id: "p1", use_case_outcome_ids: [] },
  { project_id: "p2", use_case_outcome_ids: [] },
  { project_id: "p3", use_case_outcome_ids: [] },
  { project_id: "p4", use_case_outcome_ids: [] },
], "a use case with no outcomes (or legacy rows without the field) clears everything");

console.log("smoke-use-case-outcomes: all assertions passed");
