/**
 * Smoke test for the template editor's reorder helpers
 * (`lib/tasks/template-reorder.ts`). Pure, no database.
 *
 * Run with:
 *   npm run smoke:template-reorder
 */

import assert from "node:assert/strict";

import { moveItem, moveItemBy } from "@/lib/tasks/template-reorder";

const mk = (...ids: string[]) => ids.map((local_id) => ({ local_id }));
const ids = (items: { local_id: string }[]) => items.map((i) => i.local_id).join("");

const abcd = mk("a", "b", "c", "d");

// moveItem: before / after
assert.equal(ids(moveItem(abcd, "d", "b", "before")), "adbc");
assert.equal(ids(moveItem(abcd, "d", "b", "after")), "abdc");
assert.equal(ids(moveItem(abcd, "a", "c", "after")), "bcad");
assert.equal(ids(moveItem(abcd, "a", "d", "before")), "bcad");
assert.equal(ids(moveItem(abcd, "c", "a", "before")), "cabd");

// Append: no target, unknown target, or dropped on itself.
assert.equal(ids(moveItem(abcd, "a", null, "before")), "bcda");
assert.equal(ids(moveItem(abcd, "a", "zzz", "before")), "bcda");
assert.equal(ids(moveItem(abcd, "a", "a", "after")), "bcda", "self-drop appends (matches the task checklist)");

// No-ops return the same array.
assert.equal(moveItem(abcd, "d", null, "before"), abcd, "already last");
assert.equal(moveItem(abcd, "b", "c", "before"), abcd, "already there");
assert.equal(moveItem(abcd, "b", "a", "after"), abcd, "already there (after)");
assert.equal(moveItem(abcd, "nope", "a", "before"), abcd, "unknown item");

// Input is never mutated.
assert.equal(ids(abcd), "abcd");

// moveItemBy
assert.equal(ids(moveItemBy(abcd, "b", -1)), "bacd");
assert.equal(ids(moveItemBy(abcd, "b", 1)), "acbd");
assert.equal(moveItemBy(abcd, "a", -1), abcd, "top stays");
assert.equal(moveItemBy(abcd, "d", 1), abcd, "bottom stays");
assert.equal(moveItemBy(abcd, "nope", 1), abcd);

console.log("smoke-template-reorder: all assertions passed");
