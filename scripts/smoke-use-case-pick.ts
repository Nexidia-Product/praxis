/**
 * Smoke test for the use case picker helpers (`lib/use-cases/pick.ts`).
 * Pure, no database.
 *
 * Run with:
 *   npm run smoke:use-case-pick
 */

import assert from "node:assert/strict";

import { inheritedObjectives, sortedUseCases, useCaseOptionLabel } from "@/lib/use-cases/pick";

const uc = (use_case_id: string, name: string) => ({ use_case_id, name });

// Alphabetical, case-insensitive, natural numbers; input untouched.
const input = [uc("c", "zeta"), uc("a", "Hold Time"), uc("b", "alpha"), uc("d", "Case 10"), uc("e", "Case 2")];
assert.deepEqual(sortedUseCases(input).map((u) => u.name), ["alpha", "Case 2", "Case 10", "Hold Time", "zeta"]);
assert.equal(input[0].name, "zeta");
assert.deepEqual(sortedUseCases([uc("2", "Same"), uc("1", "Same")]).map((u) => u.use_case_id), ["1", "2"], "ties by id");

// Inherited objectives.
assert.deepEqual(
  inheritedObjectives({ primary_objective: "Cost-to-Serve", secondary_objectives: ["Revenue", "Cost-to-Serve"] }),
  { primary: "Cost-to-Serve", secondary: ["Revenue"] },
  "primary is dropped from the secondaries",
);
assert.deepEqual(inheritedObjectives({ primary_objective: "Revenue", secondary_objectives: [] }), {
  primary: "Revenue",
  secondary: [],
});
assert.equal(inheritedObjectives({ primary_objective: null, secondary_objectives: ["Revenue"] }), null, "legacy use case");
assert.equal(inheritedObjectives(null), null);
assert.equal(inheritedObjectives(undefined), null);

// Option labels.
assert.equal(useCaseOptionLabel({ name: "Hold Time", primary_objective: "Cost-to-Serve" }), "Hold Time (Cost-to-Serve)");
assert.equal(useCaseOptionLabel({ name: "Legacy", primary_objective: null }), "Legacy");

console.log("smoke-use-case-pick: all assertions passed");
