/**
 * Smoke test for the Application Release calendar + report (pure logic,
 * no database). Run: npx tsx scripts/smoke-release.ts
 */

import assert from "node:assert/strict";

import {
  buildReleaseDates,
  defaultReleaseDate,
} from "../lib/releases/calendar";
import { buildReleaseReport } from "../lib/releases/report";
import type { Project, Task } from "../lib/db";

const today = "2026-10-05"; // Monday

// Two Friday deploy dates 14 days apart + one on the off week.
const dates = ["2026-10-09", "2026-10-23", "2026-10-09", "2026-10-16"];
const opts = buildReleaseDates(dates, today);
const byDate = new Map(opts.map((o) => [o.date, o]));

assert.equal(byDate.get("2026-10-09")?.projectCount, 2);
assert.equal(byDate.get("2026-10-09")?.offCycle, false);
assert.equal(byDate.get("2026-10-23")?.offCycle, false);
// Oct 16 is the off week: still selectable, flagged.
assert.equal(byDate.get("2026-10-16")?.offCycle, true);
// Cadence is every other Friday.
assert.ok(byDate.has("2026-11-06") && !byDate.has("2026-10-30"));
assert.ok(byDate.has("2026-09-25") && !byDate.has("2026-09-18"));
assert.equal(defaultReleaseDate(opts, today), "2026-10-09");

// ---- Report ----
const baseProject = {
  project_id: "2026-001",
  name: "Alpha",
  status: "In Progress",
  stage: "Kickoff",
  track: "Track A - Dashboard/visualization",
  target_date: "2026-10-09",
  target_executable_deployment_date: null,
  project_lead: "u1",
  dependencies: [],
  external_dependencies: [
    {
      external_dependency_id: "e1",
      label: "Vendor API",
      owner: "Acme",
      status: "Open",
      target_date: null,
    },
  ],
  status_history: [],
  outcomes: [],
} as unknown as Project;

const task = (over: Partial<Task>): Task =>
  ({
    task_id: "26-0001",
    project_id: "2026-001",
    task_name: "T",
    status: "In Progress",
    blocked: false,
    blocker_issue_task: "",
    blocker_type: null,
    blocker_task_id: null,
    blocker_project_id: null,
    dependencies: [],
    target_date: null,
    ...over,
  }) as Task;

const tasks = [
  task({ task_id: "26-0001", target_date: "2026-10-01" }), // overdue
  task({ task_id: "26-0002", target_date: "2026-10-20" }), // after release
  task({
    task_id: "26-0003",
    blocked: true,
    status: "Blocked",
    blocker_type: "task",
    blocker_task_id: "26-0001",
  }),
  task({ task_id: "26-0004", status: "Complete" }),
];

const report = buildReleaseReport({
  date: "2026-10-09",
  today,
  projects: [baseProject],
  allProjects: [baseProject],
  allTasks: tasks,
  useCases: [
    {
      use_case_id: "uc",
      name: "Self Service",
      member_project_ids: ["2026-001"],
    } as never,
  ],
  userNamesById: { u1: "Pat" },
});

const e = report.entries[0];
assert.equal(e.leadName, "Pat");
assert.deepEqual(e.useCaseNames, ["Self Service"]);
assert.equal(e.atRisk, true);
assert.ok(e.riskReasons.some((r) => r.includes("overdue")));
// Post-release tasks are the normal tail, not a risk.
assert.ok(!e.riskReasons.some((r) => r.includes("after the release")));
assert.equal(e.missedDelivery, false);
assert.ok(e.blockers.some((b) => b.reason.includes("26-0001")));
assert.ok(e.blockers.some((b) => b.subject === "External dependency"));
assert.ok(e.stageIndex > 0);

// Release passed + stage not Productization => missed delivery, even if
// the project status says Completed (status is not the delivery signal).
const late = { ...baseProject, status: "Completed" } as Project;
const r2 = buildReleaseReport({
  date: "2026-10-09",
  today: "2026-10-12",
  projects: [late],
  allProjects: [late],
  allTasks: [],
  useCases: [],
  userNamesById: {},
});
assert.equal(r2.entries[0].missedDelivery, true);
assert.equal(r2.entries[0].atRisk, true);
assert.equal(r2.missedCount, 1);

// Release passed + Productization reached => delivered, with open tail tasks.
const shipped = { ...baseProject, stage: "Productization" } as Project;
const r3 = buildReleaseReport({
  date: "2026-10-09",
  today: "2026-10-12",
  projects: [shipped],
  allProjects: [shipped],
  allTasks: [task({ task_id: "26-0009", target_date: "2026-10-20" })],
  useCases: [],
  userNamesById: {},
});
assert.equal(r3.entries[0].delivered, true);
assert.equal(r3.entries[0].missedDelivery, false);
assert.equal(r3.entries[0].atRisk, false);

console.log("smoke-release: ok");
