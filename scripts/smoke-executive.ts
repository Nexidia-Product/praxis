/**
 * Smoke test for the executive view logic (pure, no database).
 * Run: npx tsx scripts/smoke-executive.ts
 */

import assert from "node:assert/strict";

import {
  UNSCHEDULED,
  buildExecutiveView,
  countNoPillar,
  isExecEligible,
  phaseOf,
  previousQuarter,
  quarterStart,
  scopeOptions,
} from "../lib/executive/portfolio";
import { buildProjectEntries } from "../lib/releases/report";
import type { Project } from "../lib/db";

const today = "2026-10-06"; // 2026-Q4

const mk = (over: Partial<Project>): Project =>
  ({
    project_id: "2026-001",
    name: "Alpha",
    program: "Innovation",
    project_type: "New Feature",
    application_product: "Automated Insights",
    status: "In Progress",
    stage: "Kickoff",
    track: "Track A - Dashboard/visualization",
    primary_objective: "Revenue",
    secondary_objectives: [],
    target_date: "2026-11-06",
    target_executable_deployment_date: null,
    project_lead: "u1",
    dependencies: [],
    external_dependencies: [],
    status_history: [],
    outcomes: [],
    supports: "",
    benefits: "",
    ...over,
  }) as Project;

// ---- helpers ----
assert.equal(quarterStart("2026-Q4"), "2026-10-01");
assert.equal(previousQuarter("2026-Q1"), "2025-Q4");
assert.equal(phaseOf("Qualification"), "qualifying");
assert.equal(phaseOf("Kickoff"), "inProgress");
assert.equal(phaseOf("Productization"), "released");

// ---- eligibility ----
assert.equal(isExecEligible(mk({})), true);
assert.equal(isExecEligible(mk({ primary_objective: "Complaints" })), false);
assert.equal(isExecEligible(mk({ primary_objective: "Other" })), false);
assert.equal(isExecEligible(mk({ primary_objective: null })), false);
assert.equal(isExecEligible(mk({ program: "Complaints" })), false);
assert.equal(
  countNoPillar([
    mk({ primary_objective: null }),
    mk({ primary_objective: "Other" }),
    mk({ primary_objective: null, program: "Complaints" }),
  ]),
  1,
);

// ---- scoping ----
const projects = [
  mk({ project_id: "P1", name: "This quarter", target_date: "2026-11-06" }),
  mk({ project_id: "P2", name: "Next quarter", target_date: "2027-01-08" }),
  mk({
    project_id: "P3",
    name: "Late carryover",
    target_date: "2026-09-11",
    stage: "Kickoff",
  }),
  mk({
    project_id: "P4",
    name: "Shipped last quarter",
    target_date: "2026-09-11",
    stage: "Productization",
  }),
  mk({ project_id: "P5", name: "No date", target_date: null }),
  mk({
    project_id: "P6",
    name: "Cost one",
    primary_objective: "Cost-to-Serve",
    target_date: "2026-12-04",
    benefits: "Saves analyst time",
    supports: "Repeat call reduction",
  }),
];
const entries = buildProjectEntries({
  today,
  projects,
  allProjects: projects,
  allTasks: [],
  useCases: [],
  userNamesById: {},
});

const names = (scope: string) =>
  buildExecutiveView({ entries, scope, today })
    .pillars.flatMap((p) => p.projects.map((x) => x.entry.project.name))
    .sort();

// Current quarter: this-quarter projects + the late carry-over, NOT the
// shipped one, and not future/unscheduled.
assert.deepEqual(names("2026-Q4"), ["Cost one", "Late carryover", "This quarter"]);
// A future quarter never shows carry-overs.
assert.deepEqual(names("2027-Q1"), ["Next quarter"]);
// Past quarter shows what had that date, shipped or not.
assert.deepEqual(names("2026-Q3"), ["Late carryover", "Shipped last quarter"]);
assert.deepEqual(names(UNSCHEDULED), ["No date"]);

// ---- pillar rollups ----
const q4 = buildExecutiveView({ entries, scope: "2026-Q4", today });
const revenue = q4.pillars.find((p) => p.pillar === "Revenue")!;
assert.equal(revenue.counts.total, 2);
assert.equal(revenue.counts.missed, 1); // carried-over, past date, not Productization
assert.equal(revenue.counts.undocumented, 2);
const cost = q4.pillars.find((p) => p.pillar === "Cost-to-Serve")!;
assert.equal(cost.counts.undocumented, 0);
assert.equal(cost.groups[0].name, "No use case");
assert.equal(q4.pillars.length, 5);
assert.equal(q4.needsAttention[0].entry.project.name, "Late carryover");

// ---- options ----
const opts = scopeOptions(entries, today, (q) => q);
assert.deepEqual(
  opts.map((o) => o.value),
  ["2026-Q3", "2026-Q4", "2027-Q1", "2027-Q2", "2027-Q3", UNSCHEDULED],
);
assert.equal(opts.find((o) => o.isCurrent)?.value, "2026-Q4");

console.log("smoke-executive: ok");
