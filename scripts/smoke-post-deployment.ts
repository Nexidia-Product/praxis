/**
 * Smoke test for post-deployment classification
 * (lib/projects/post-deployment.ts). Pure logic, no database.
 * Run: `npm run smoke:post-deployment`.
 */

import assert from "node:assert/strict";

import { isDeployed, isPostDeployment } from "@/lib/projects/post-deployment";

const A = "Track A - Dashboard/visualization";

// Stage decides "deployed".
assert.equal(isDeployed({ track: A, stage: "Productization" }), true);
assert.equal(isDeployed({ track: A, stage: "Prioritization" }), false);
assert.equal(isDeployed({ track: A, stage: "Qualification" }), false);

// Open status + deployed = post-deployment work.
for (const status of ["In Progress", "In Planning", "Blocked", "Delayed", "On Hold", "Not Started"]) {
  assert.equal(isPostDeployment({ track: A, stage: "Productization", status }), true, status);
}
// Closed out, or not yet deployed, is not.
assert.equal(isPostDeployment({ track: A, stage: "Productization", status: "Completed" }), false);
assert.equal(isPostDeployment({ track: A, stage: "Productization", status: "Canceled" }), false);
assert.equal(isPostDeployment({ track: A, stage: "Prioritization", status: "In Progress" }), false);

console.log("smoke-post-deployment: all assertions passed");
