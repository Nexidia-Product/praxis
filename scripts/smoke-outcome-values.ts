/**
 * Smoke test for the outcome product/type list helper
 * (`lib/projects/outcome-values.ts`). Pure, no database.
 *
 * Run with:
 *   npm run smoke:outcome-values
 */

import assert from "node:assert/strict";

import {
  MAX_OUTCOME_VALUE_LEN,
  appendOutcomeValue,
  sortOutcomeValues,
} from "@/lib/projects/outcome-values";

const list = ["Cognigy", "Quality Central"];

// A new value is added (trimmed) in its alphabetical slot, the original array untouched.
const added = appendOutcomeValue(list, "  Atlas ");
assert.ok(added.ok);
assert.deepEqual(added.ok && added.list, ["Atlas", "Cognigy", "Quality Central"]);
assert.equal(added.ok && added.value, "Atlas");
assert.equal(added.ok && added.added, true);
assert.deepEqual(list, ["Cognigy", "Quality Central"]);

// Sorting: case-insensitive, numeric-aware, input untouched.
assert.deepEqual(
  sortOutcomeValues(["quality", "Cognigy", "atlas", "Tier 10", "Tier 2"]),
  ["atlas", "Cognigy", "quality", "Tier 2", "Tier 10"],
);
const unsorted = ["b", "a"];
sortOutcomeValues(unsorted);
assert.deepEqual(unsorted, ["b", "a"], "sort does not mutate");

// A value added to the middle/start lands alphabetically, not at the end.
const mid = appendOutcomeValue(["Alpha", "Zeta"], "Mu");
assert.deepEqual(mid.ok && mid.list, ["Alpha", "Mu", "Zeta"]);

// Adding to an empty list.
const first = appendOutcomeValue([], "automation");
assert.ok(first.ok && first.list.length === 1 && first.added);

// A duplicate (any case) isn't added; the existing spelling comes back.
const dup = appendOutcomeValue(list, "cognigy");
assert.ok(dup.ok);
assert.equal(dup.ok && dup.added, false);
assert.equal(dup.ok && dup.value, "Cognigy");
assert.deepEqual(dup.ok && dup.list, list);

// Rejections.
assert.equal(appendOutcomeValue(list, "   ").ok, false, "blank");
assert.equal(appendOutcomeValue(list, 42).ok, false, "not a string");
assert.equal(appendOutcomeValue(list, undefined).ok, false, "missing");
assert.equal(appendOutcomeValue(list, "x".repeat(MAX_OUTCOME_VALUE_LEN + 1)).ok, false, "too long");
assert.equal(appendOutcomeValue(list, "x".repeat(MAX_OUTCOME_VALUE_LEN)).ok, true, "at the limit");

console.log("smoke-outcome-values: all assertions passed");
