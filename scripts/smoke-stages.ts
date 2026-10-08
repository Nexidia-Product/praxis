/**
 * Smoke test for the stage helpers that decide "has it shipped?"
 * (`hasReachedProductization`, `reachedProductizationIn`, `closedOutStage`
 * in lib/projects/display.ts). Pure, no database.
 *
 * Post-Productization stages (validation, adoption) aren't defined for any
 * track yet, so the position logic is exercised on explicit stage lists.
 *
 * Run with:
 *   npm run smoke:stages
 */

import assert from "node:assert/strict";

import {
  STAGE_LAST,
  closedOutStage,
  hasReachedProductization,
  reachedProductizationIn,
  stagesForTrack,
} from "@/lib/projects/display";

const trackA = "Track A - Dashboard/visualization";
const trackB = "Track B - Cognigy bot inputs";

// Real tracks today: Productization is last, behavior matches the old rule.
assert.equal(hasReachedProductization(trackA, "Productization"), true);
assert.equal(hasReachedProductization(trackA, "Release"), false);
assert.equal(hasReachedProductization(trackA, "Qualification"), false);
assert.equal(hasReachedProductization(trackB, "Prioritization"), false);
assert.equal(hasReachedProductization(trackB, "Productization"), true);
assert.equal(hasReachedProductization(trackA, "Some Retired Stage"), false, "unknown stage is not reached");
assert.equal(stagesForTrack(trackA).at(-1), STAGE_LAST);

// Track B: build stages, Productization, then Services stages after it.
assert.deepEqual(stagesForTrack(trackB), [
  "Qualification",
  "Prioritization",
  "Development",
  "Testing",
  "Signoff",
  "Integration",
  "Release",
  "Productization",
  "Services Validation",
  "Services Signoff",
  "Adoption",
]);
for (const s of ["Development", "Testing", "Signoff", "Integration", "Release"]) {
  assert.equal(hasReachedProductization(trackB, s), false, `Track B ${s} is before Productization`);
}
for (const s of ["Productization", "Services Validation", "Services Signoff", "Adoption"]) {
  assert.equal(hasReachedProductization(trackB, s), true, `Track B ${s} counts as shipped`);
}
assert.equal(closedOutStage(trackB, "Testing"), "Productization");
assert.equal(closedOutStage(trackB, "Services Validation"), "Services Validation", "closing out never moves a project backwards");
assert.equal(closedOutStage(trackB, "Adoption"), "Adoption");

// A track with stages after Productization.
const withPost = [
  "Qualification",
  "Prioritization",
  "Build",
  "Productization",
  "Automated Validation",
  "Human Validation",
  "Adoption",
];
assert.equal(reachedProductizationIn(withPost, "Build"), false);
assert.equal(reachedProductizationIn(withPost, "Productization"), true);
assert.equal(reachedProductizationIn(withPost, "Automated Validation"), true);
assert.equal(reachedProductizationIn(withPost, "Adoption"), true);
assert.equal(reachedProductizationIn(withPost, "Nope"), false);

// Close-out: pulled up to Productization, never moved backwards.
assert.equal(closedOutStage(trackA, "Kickoff"), "Productization");
assert.equal(closedOutStage(trackA, "Qualification"), "Productization");
assert.equal(closedOutStage(trackA, "Productization"), "Productization");

console.log("smoke-stages: all assertions passed");
