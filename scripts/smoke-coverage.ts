/**
 * Smoke test for the Program Coverage graph builder (`lib/coverage/graph.ts`).
 * Pure, no database.
 *
 * Run with:
 *   npm run smoke:coverage
 */

import assert from "node:assert/strict";

import {
  COVERAGE_EXCLUDED_TRACKS,
  buildCoverageGraph,
  bucketOfProject,
} from "@/lib/coverage/graph";
import { SYSTEM_TRACKS } from "@/lib/projects/display";
import { coverageHref, resolveCoverageSelection } from "@/lib/coverage/select";
import { countNoPillar } from "@/lib/executive/portfolio";
import type { Project, ProjectOutcome, UseCase } from "@/lib/db";

const TRACK_A = "Track A - Dashboard/visualization";
const TRACK_B = "Track B - Cognigy bot inputs";

const mk = (over: Partial<Project>): Project =>
  ({
    project_id: "2026-001",
    name: "Alpha",
    program: "Innovation",
    project_type: "New Feature",
    application_product: "Automated Insights",
    visualization_type: "New Visualization",
    status: "In Progress",
    stage: "Kickoff",
    track: TRACK_A,
    primary_objective: "Cost-to-Serve",
    secondary_objectives: [],
    target_date: null,
    outcomes: [],
    ...over,
  }) as Project;

const out = (id: string, text: string, delivery: ProjectOutcome["delivery"]): ProjectOutcome => ({
  id,
  text,
  product: null,
  type: null,
  delivery,
});

const uc = (over: Partial<UseCase>): UseCase =>
  ({
    use_case_id: "uc-1",
    name: "Use case",
    description: "",
    primary_objective: "Cost-to-Serve",
    secondary_objectives: [],
    member_project_ids: [],
    ...over,
  }) as UseCase;

// ---- bucketOfProject ----
assert.equal(bucketOfProject(mk({ stage: "Qualification" })), "notStarted");
assert.equal(bucketOfProject(mk({ stage: "Prioritization" })), "notStarted");
assert.equal(bucketOfProject(mk({ stage: "Kickoff" })), "inProgress");
assert.equal(bucketOfProject(mk({ stage: "Productization" })), "delivered");
assert.equal(
  bucketOfProject(mk({ stage: "Productization", status: "Canceled" })),
  "notStarted",
  "canceled is forced to Productization on close-out but is not delivered",
);

// ---- Hold Time Analysis scenario ----
const hold = mk({
  project_id: "2026-024",
  name: "Hold Time Analysis",
  outcomes: [
    out("o1", "Task Assist bot", { kind: "project", project_id: "2026-031" }),
    out("o2", "Quality Central build", null),
    out("o3", "Hold time dashboard", { kind: "self" }),
  ],
});
// Visualization project in the same use case family, same shared bot.
const other = mk({
  project_id: "2026-025",
  name: "Transfer Analysis",
  stage: "Productization",
  outcomes: [out("o4", "Same bot", { kind: "project", project_id: "2026-031" })],
});
const taskAssist = mk({
  project_id: "2026-031",
  name: "Task Assist bot build",
  track: TRACK_B,
  program: "Innovation",
  primary_objective: null,
  stage: "Productization",
  outcomes: [out("t1", "Bot live", { kind: "self" })],
});
const canceledBot = mk({
  project_id: "2026-032",
  name: "Dropped bot",
  track: TRACK_B,
  stage: "Productization",
  status: "Canceled",
  primary_objective: null,
});
const noOutcomes = mk({ project_id: "2026-026", name: "Empty", outcomes: [] });
const dangling = mk({
  project_id: "2026-027",
  name: "Dangling",
  outcomes: [
    out("d1", "To canceled", { kind: "project", project_id: "2026-032" }),
    out("d2", "To missing", { kind: "project", project_id: "2026-999" }),
  ],
});
const canceledMember = mk({ project_id: "2026-028", name: "Gone", status: "Canceled", outcomes: [out("c1", "x", null)] });
const otherProgram = mk({ project_id: "2026-029", name: "Complaints thing", program: "Complaints", outcomes: [out("p1", "y", null)] });
const unassigned = mk({ project_id: "2026-050", name: "Orphan" });

const projects = [hold, other, taskAssist, canceledBot, noOutcomes, dangling, canceledMember, otherProgram, unassigned];
const useCases = [
  uc({
    use_case_id: "uc-hold",
    name: "Hold Time",
    member_project_ids: ["2026-024", "2026-025", "2026-026", "2026-027", "2026-028", "2026-029", "2026-404"],
  }),
  uc({ use_case_id: "uc-none", name: "No pillar", primary_objective: null, member_project_ids: [] }),
  uc({ use_case_id: "uc-complaints", name: "Complaints UC", primary_objective: "Complaints", member_project_ids: [] }),
];

const graph = buildCoverageGraph({ projects, useCases });

assert.deepEqual(graph.pillars.map((p) => p.pillar), [
  "Cost-to-Serve",
  "Revenue",
  "Compliance",
  "Customer Experience",
  "Agent Experience",
]);
const pillar = graph.pillars[0];
assert.equal(pillar.useCases.length, 1);
const hu = pillar.useCases[0];

// Members: only in-scope (Innovation, non-canceled, found) projects, in member order.
assert.deepEqual(hu.projects.map((p) => p.ref.project_id), ["2026-024", "2026-025", "2026-026", "2026-027"]);

const holdNode = hu.projects[0];
assert.equal(holdNode.outcomes.length, 3);
const [taskAssistOutcome, qcOutcome, selfOutcome] = holdNode.outcomes;
assert.equal(taskAssistOutcome.bucket, "delivered");
assert.equal(taskAssistOutcome.gap, null);
assert.equal(taskAssistOutcome.delivery.kind, "project");
assert.equal(taskAssistOutcome.delivery.project?.name, "Task Assist bot build");
assert.equal(taskAssistOutcome.delivery.sharedCount, 2, "bot is shared by two outcomes");
assert.equal(qcOutcome.bucket, "notStarted");
assert.equal(qcOutcome.gap, "notPlanned");
assert.equal(qcOutcome.delivery.kind, "none");
assert.equal(selfOutcome.bucket, "inProgress", "self = the owning project's own stage (Kickoff)");
assert.equal(selfOutcome.delivery.kind, "self");
assert.equal(holdNode.counts.total, 3);
assert.deepEqual(
  [holdNode.counts.notStarted, holdNode.counts.inProgress, holdNode.counts.delivered],
  [1, 1, 1],
);

// Delivery projects are leaves: the bot's own outcome is not counted anywhere.
assert.equal(hu.counts.total, 3 + 1 + 0 + 2);
assert.equal(hu.projects[1].outcomes[0].bucket, "delivered");

// A project with no outcomes is flagged.
assert.equal(hu.projects[2].noOutcomes, true);
assert.equal(hu.projects[0].noOutcomes, false);

// Canceled / missing delivery targets are outstanding with a reason.
const [toCanceled, toMissing] = hu.projects[3].outcomes;
assert.equal(toCanceled.bucket, "notStarted");
assert.equal(toCanceled.gap, "deliveryCanceled");
assert.equal(toMissing.bucket, "notStarted");
assert.equal(toMissing.gap, "deliveryMissing");
assert.equal(hu.gapCount, 1 /* QC */ + 2 /* canceled + missing */);

// Rollups.
assert.equal(pillar.projectCount, 4);
assert.equal(pillar.counts.total, hu.counts.total);
assert.equal(graph.pillars[1].useCases.length, 0);
assert.equal(graph.pillars[1].counts.total, 0);

// Exclusions: use cases without a core pillar; pillar projects with no use case
// (the delivery project and use-case members don't count).
assert.equal(graph.excluded.useCasesWithoutPillar, 2);
assert.equal(graph.excluded.projectsWithoutUseCase, 1, "only the orphan");

// No warnings in the normal case; flag a delivery project that is also a member.
assert.deepEqual(hu.warnings, []);
const both = buildCoverageGraph({
  projects,
  useCases: [uc({ member_project_ids: ["2026-024", "2026-031"] })],
});
assert.equal(both.pillars[0].useCases[0].warnings.length, 1);

// ---- Executive "no pillar" footnote ignores delivery projects ----
const noPillarBot = mk({ project_id: "2026-031", primary_objective: null });
const noPillarOrphan = mk({ project_id: "2026-060", primary_objective: null });
const linker = mk({
  project_id: "2026-024",
  outcomes: [out("o1", "bot", { kind: "project", project_id: "2026-031" })],
});
assert.equal(countNoPillar([noPillarBot, noPillarOrphan]), 2);
assert.equal(countNoPillar([noPillarBot, noPillarOrphan, linker]), 1, "linked delivery project is aligned");

// ---- Tracks D-H are excluded; Tracks A-C are not ----
const onTrack = (id: string, track: string) =>
  mk({ project_id: id, name: `On ${track}`, track, outcomes: [out(`o-${id}`, "x", null)] });
const trackProjects = [
  onTrack("2026-101", "Track A - Dashboard/visualization"),
  onTrack("2026-102", "Track B - Cognigy bot inputs"),
  onTrack("2026-103", "Track C - WFM/mid-shift reskilling"),
  onTrack("2026-104", "Track D - UI/Application"),
  onTrack("2026-105", "Track E - TopicAI"),
  onTrack("2026-106", "Track F - Complaints"),
  onTrack("2026-107", "Track G - Other"),
  onTrack("2026-108", "Track H - Services Validation"),
];
const byTrack = buildCoverageGraph({
  projects: [...trackProjects, mk({ project_id: "2026-109", name: "Orphan D", track: "Track D - UI/Application" })],
  useCases: [uc({ use_case_id: "uc-tracks", member_project_ids: trackProjects.map((p) => p.project_id) })],
});
const shown = byTrack.pillars[0].useCases[0].projects.map((p) => p.ref.project_id);
assert.deepEqual(shown, ["2026-101", "2026-102", "2026-103"], "D-H members left out");
assert.equal(byTrack.pillars[0].counts.total, 3, "excluded projects' outcomes aren't counted");
assert.equal(byTrack.excluded.projectsWithoutUseCase, 0, "an excluded-track project isn't reported as unassigned");
assert.equal(
  [...COVERAGE_EXCLUDED_TRACKS].every((t) => SYSTEM_TRACKS.includes(t)),
  true,
  "excluded track names match SYSTEM_TRACKS",
);
// An explicit delivery link to an excluded-track project still resolves.
const linkedD = buildCoverageGraph({
  projects: [
    mk({ project_id: "2026-110", name: "Viz", outcomes: [out("l1", "Ship it", { kind: "project", project_id: "2026-104" })] }),
    trackProjects[3],
  ],
  useCases: [uc({ member_project_ids: ["2026-110"] })],
});
assert.equal(linkedD.pillars[0].useCases[0].projects[0].outcomes[0].delivery.project?.project_id, "2026-104");

// ---- URL selection (drill-down level) ----
assert.equal(resolveCoverageSelection(graph).level, 1);
assert.equal(resolveCoverageSelection(graph, "Nope").level, 1, "unknown pillar -> level 1");
assert.equal(resolveCoverageSelection(graph, "Cost-to-Serve").level, 2);
assert.equal(
  resolveCoverageSelection(graph, "Cost-to-Serve", "missing").level,
  2,
  "unknown use case -> level 2",
);
assert.equal(
  resolveCoverageSelection(graph, "Revenue", "uc-hold").level,
  2,
  "use case from a different pillar -> level 2",
);
const sel = resolveCoverageSelection(graph, "Cost-to-Serve", "uc-hold");
assert.equal(sel.level, 3);
assert.equal(sel.level === 3 && sel.useCase.name, "Hold Time");
assert.equal(coverageHref(), "/insights/program-coverage");
assert.equal(coverageHref("Cost-to-Serve"), "/insights/program-coverage?pillar=Cost-to-Serve");
assert.equal(
  coverageHref("Customer Experience", "uc-1"),
  "/insights/program-coverage?pillar=Customer+Experience&useCase=uc-1",
);

console.log("smoke-coverage: all assertions passed");
