/**
 * Smoke test for the merge-into-project picker's candidate list
 * (`lib/ideas/merge-candidates.ts`). Pure, no database.
 *
 * Run with:
 *   npm run smoke:merge-candidates
 */

import assert from "node:assert/strict";

import { isMergeable, mergeCandidates } from "@/lib/ideas/merge-candidates";

const p = (project_id: string, name: string, status = "In Progress") => ({
  project_id,
  name,
  status: status as never,
});

const projects = [
  p("2026-005", "zeta alerts"),
  p("2026-001", "Hold Time Analysis"),
  p("2026-002", "alpha bot"),
  p("2026-003", "Done thing", "Completed"),
  p("2026-004", "Dropped idea", "Canceled"),
  p("2026-006", "Project 10"),
  p("2026-007", "Project 2"),
  p("2026-008", "Hold time dashboard", "Blocked"),
];
const ids = (list: { project_id: string }[]) => list.map((x) => x.project_id);

// Closed projects are out; the rest are alphabetical ignoring case, numbers naturally.
assert.deepEqual(ids(mergeCandidates(projects)), [
  "2026-002", // alpha bot
  "2026-001", // Hold Time Analysis
  "2026-008", // Hold time dashboard
  "2026-007", // Project 2
  "2026-006", // Project 10
  "2026-005", // zeta alerts
]);
assert.equal(isMergeable(p("x", "n", "On Hold")), true);
assert.equal(isMergeable(p("x", "n", "Completed")), false);
assert.equal(isMergeable(p("x", "n", "Canceled")), false);

// Search: case-insensitive, name or ID, all words, any order.
assert.deepEqual(ids(mergeCandidates(projects, "hold")), ["2026-001", "2026-008"]);
assert.deepEqual(ids(mergeCandidates(projects, "HOLD TIME")), ["2026-001", "2026-008"]);
assert.deepEqual(ids(mergeCandidates(projects, "analysis hold")), ["2026-001"]);
assert.deepEqual(ids(mergeCandidates(projects, "2026-002")), ["2026-002"]);
assert.deepEqual(ids(mergeCandidates(projects, "  ")), ids(mergeCandidates(projects)), "blank query = all");
assert.deepEqual(mergeCandidates(projects, "no such project"), []);
// A search never resurrects a closed project.
assert.deepEqual(mergeCandidates(projects, "done thing"), []);
assert.deepEqual(mergeCandidates(projects, "dropped"), []);

// Input is not mutated.
assert.equal(projects[0].project_id, "2026-005");

console.log("smoke-merge-candidates: all assertions passed");
