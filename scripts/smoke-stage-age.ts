/**
 * Smoke test for "days in stage" (lib/projects/stage-age.ts). Pure logic,
 * no database. Run: `npm run smoke:stage-age`.
 */

import assert from "node:assert/strict";

import { daysInStage, formatDaysInStage } from "@/lib/projects/stage-age";

const now = new Date("2026-10-13T12:00:00Z");

assert.equal(daysInStage({ stage_entered_at: "2026-10-13T01:00:00Z" }, now), 0);
assert.equal(daysInStage({ stage_entered_at: "2026-10-12T11:00:00Z" }, now), 1);
assert.equal(daysInStage({ stage_entered_at: "2026-09-13T12:00:00Z" }, now), 30);
assert.equal(daysInStage({ stage_entered_at: "2026-10-20T00:00:00Z" }, now), 0, "never negative");
assert.equal(daysInStage({}, now), null, "unknown before the migration");
assert.equal(daysInStage({ stage_entered_at: "not a date" }, now), null);

assert.equal(formatDaysInStage(null), "");
assert.equal(formatDaysInStage(0), "Entered today");
assert.equal(formatDaysInStage(1), "1 day in stage");
assert.equal(formatDaysInStage(12), "12 days in stage");

console.log("smoke-stage-age: all assertions passed");
