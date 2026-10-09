/**
 * Smoke test for the outcome product/type list helper
 * (`lib/projects/outcome-values.ts`). Pure, no database.
 *
 * Run with:
 *   npm run smoke:outcome-values
 */

import assert from "node:assert/strict";

import { MAX_OUTCOME_VALUE_LEN, appendOutcomeValue } from "@/lib/projects/outcome-values";

const list = ["Cognigy", "Quality Central"];

// A new value is appended (trimmed), the original array untouched.
const added = appendOutcomeValue(list, "  Atlas ");
assert.ok(added.ok);
assert.deepEqual(added.ok && added.list, ["Cognigy", "Quality Central", "Atlas"]);
assert.equal(added.ok && added.value, "Atlas");
assert.equal(added.ok && added.added, true);
assert.deepEqual(list, ["Cognigy", "Quality Central"]);

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
