/**
 * Seed the "Visualization Template" — Track A's 34-task template,
 * authored from `visualization-template-template_with-durations.md`.
 *
 * Run with:
 *   npm run seed:visualization-template
 *
 * Prereqs: NEXT_PUBLIC_SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY in
 * .env.local, and an existing Admin (or any) user to attribute the
 * template to.
 *
 * Durations and dependencies are transcribed from the reference doc's
 * "Medium complexity" column, converted to hours at 8h/business day
 * (`HOURS_PER_BUSINESS_DAY` in lib/tasks/schedule.ts) — the task-level
 * `estimate_hours` field is now what drives due-date scheduling, not the
 * doc's own backward-anchored "Handoff minus N" formulas. Two of the
 * doc's own dependency edges don't survive pure forward duration-chaining
 * and are corrected here (both verified against the doc's example dates
 * by hand before writing this script):
 *   - Task 12 ("Storyline, deck...") now depends on task 8, not task 10 —
 *     the doc flags this exact fix itself.
 *   - Task 11 ("Metric Definition Lock") now depends on task 10, not
 *     task 9 — chaining from task 9 with a 1-day duration lands a day
 *     early relative to the doc's own example (Handoff minus 3).
 *
 * Task 3 (EDA) is the only task whose duration varies by project
 * complexity (Low 4d / Medium 9d / High 19d) — it carries
 * `complexity_estimate_hours` so a High-complexity project automatically
 * gets the longer duration at template-instantiation time
 * (`instantiateTemplate` in lib/tasks/service.ts).
 *
 * Not implemented (see the design conversation for why): the doc's
 * `min(Handoff-5, Release-leadtime)` rule for task 9's visualization-type
 * dependent lead time, and the "Data Only skips tasks 9-11/20-25/28"
 * rule — forward hours-driven chaining produces one deterministic date
 * per task, and there's no conditional-task-inclusion mechanism in
 * `instantiateTemplate` today.
 */

import { UserRepository, type UserId } from "../lib/db";
import { createTemplate } from "../lib/tasks/template-service";

const TRACK_A = "Track A - Dashboard/visualization";
const HOURS_PER_DAY = 8;
const days = (n: number) => n * HOURS_PER_DAY;

interface RawTask {
  local_id: string;
  name: string;
  description: string;
  stage: string;
  default_responsible: string | null;
  estimate_hours: number;
  complexity_estimate_hours?: Partial<Record<"Low" | "High", number>>;
  dependencies: { predecessor_local_id: string; type: "FS" | "SS" }[];
}

const TASKS: RawTask[] = [
  {
    local_id: "t1",
    name: "Export project, run kickoff and write brief",
    description:
      "Export the Praxis project as PROJECT.md into the project folder\n" +
      "Confirm or tighten the scope, definition of done, tier and visualization type\n" +
      "Write the business question, the lever (AHT, automation, resolution, revenue, risk) and a rough size of the prize\n" +
      "List the data needed and which modes have it\n" +
      "Check it is not already produced by an existing AutoInsights output",
    stage: "Kickoff",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [],
  },
  {
    local_id: "t2",
    name: "Update scope, definition of done and sizing in Praxis",
    description: "Push scope or sizing changes back into Praxis so the dates recalculate",
    stage: "Kickoff",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t1", type: "SS" }],
  },
  {
    local_id: "t3",
    name: "EDA notes and data coverage",
    description:
      "Pull any additional data (air-gapped sources: export a minimal derivative, IDs plus needed columns)\n" +
      "Check coverage per column and per day, and id overlap between intent, action and metadata files\n" +
      "Run on at least one real customer, ideally two with different ontologies\n" +
      "Compare like for like and state confidence (CIs, sample sizes)",
    stage: "Analysis and EDA",
    default_responsible: null,
    estimate_hours: days(9),
    complexity_estimate_hours: { Low: days(4), High: days(19) },
    dependencies: [{ predecessor_local_id: "t2", type: "FS" }],
  },
  {
    local_id: "t4",
    name: "Draft expected-output CSV, reconciled against a run",
    description:
      "Produce the expected-output CSV (what the file will look like in every run) and reconcile it against a finished run",
    stage: "Analysis and EDA",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t3", type: "FS" }],
  },
  {
    local_id: "t5",
    name: "Review packet",
    description:
      "One-page packet: question, approach in three bullets, headline result with confidence, impact arithmetic, what was dropped, open doubts\n" +
      "The expected-output CSV, so its shape gets reviewed before it goes to the dashboard developer\n" +
      "Answers to the three hardest questions a skeptic would ask",
    stage: "Approach Review",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t4", type: "FS" }],
  },
  {
    local_id: "t6",
    name: "Hold review and record outcome",
    description: "",
    stage: "Approach Review",
    default_responsible: "Josh",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t5", type: "SS" }],
  },
  {
    local_id: "t7",
    name: "Revisions and delta note",
    description:
      "Make the changes from the review\n" +
      "Send a short \"what changed and why\" note plus the updated packet for an async check (same-day turnaround)\n" +
      "If the review asked for nothing, mark the stage's tasks not needed",
    stage: "Initial Revisions",
    default_responsible: null,
    estimate_hours: days(2),
    dependencies: [{ predecessor_local_id: "t6", type: "FS" }],
  },
  {
    local_id: "t8",
    name: "Async re-check",
    description: "",
    stage: "Initial Revisions",
    default_responsible: "Josh",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t7", type: "SS" }],
  },
  {
    local_id: "t9",
    name: "Send expected-output CSV and data dictionary",
    description: "",
    stage: "Initiate Visualization",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t8", type: "FS" }],
  },
  {
    local_id: "t10",
    name: "Walkthrough done, files confirmed enough to start",
    description:
      "Send the reviewed expected-output CSV and its data dictionary: every column, unit, grain, and what a blank means\n" +
      "Walk the dashboard developer through it and answer shape questions\n" +
      "Freeze the columns. After this, the logic can still change the values but not the file shape\n\n" +
      "includes Data intake and validation (include: data requirements to DS) requirements from Visualization Developer",
    stage: "Initiate Visualization",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t9", type: "FS" }],
  },
  {
    local_id: "t11",
    name: "Metric Definition Lock",
    description: "Metric definition lock (include: ROI where the data supports it)",
    stage: "Initiate Visualization",
    default_responsible: "Min",
    estimate_hours: days(1),
    // Corrected from the doc's literal "depends on t9" — see module doc.
    dependencies: [{ predecessor_local_id: "t10", type: "FS" }],
  },
  {
    local_id: "t12",
    name: "Storyline, deck, deck check, email",
    description:
      "Write the storyline before any slides: situation, problem, finding, impact, recommendation\n" +
      "One headline per slide that states the takeaway, not the topic\n" +
      "Build the deck with the existing deck skill and email it to reviewer",
    stage: "Deck Review",
    default_responsible: null,
    estimate_hours: days(1),
    // Corrected per the doc's own flagged fix — depends on t8, not t10.
    dependencies: [{ predecessor_local_id: "t8", type: "FS" }],
  },
  {
    local_id: "t13",
    name: "Deck feedback",
    description: "Make any changes from reviewer feedback",
    stage: "Deck Review",
    default_responsible: "Josh",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t12", type: "FS" }],
  },
  {
    local_id: "t14",
    name: "Review deck, meet if needed",
    description: "",
    stage: "Manager Review",
    default_responsible: "Trish",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t13", type: "FS" }],
  },
  {
    local_id: "t15",
    name: "Ship decision, on by default or opt-in",
    description: "Ship it in AutoInsights, yes or no\nOn by default or opt-in per run",
    stage: "Signoff",
    default_responsible: "Brett",
    estimate_hours: days(2),
    dependencies: [{ predecessor_local_id: "t14", type: "FS" }],
  },
  {
    local_id: "t16",
    name: "Handoff package passes contract checks",
    description:
      "Refactor the script to the integration contract (below)\n" +
      "Write HANDOFF.md: entry point, inputs, outputs, modes supported, runtime and cost on real data, known limits\n" +
      "Attach the validation report and the frozen expected-output CSV\n" +
      "Add a tiny synthetic fixture so the feature can run in the offline smoke test",
    stage: "Handoff",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t15", type: "FS" }],
  },
  {
    local_id: "t17",
    name: "Package Accepted",
    description: "",
    stage: "Handoff",
    default_responsible: "Josh",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t16", type: "SS" }],
  },
  {
    local_id: "t18",
    name: "Integrated, output matches expected CSV",
    description:
      "Vendor the AIRE's module unchanged and write a bridge that feeds it the run's own data\n" +
      "Wire it into the right modes, add a skip option, add it to the build lists\n" +
      "Version bump and changelog entry\n" +
      "Run a real customer through it and check the output against the expected-output CSV: same columns, order and types",
    stage: "Integration",
    default_responsible: "Josh",
    estimate_hours: days(4),
    dependencies: [{ predecessor_local_id: "t17", type: "FS" }],
  },
  {
    local_id: "t19",
    name: "Version, changelog, build, deploy",
    description: "Smoke test, build, deploy. The output is now in every customer run\nReal files to the dashboard developer",
    stage: "Integration",
    default_responsible: "Josh",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t18", type: "FS" }],
  },
  {
    local_id: "t20",
    name: "Visualization/readout design (storyline and mockup)",
    description: "",
    stage: "Visualization Build",
    default_responsible: "Min",
    estimate_hours: days(2),
    dependencies: [{ predecessor_local_id: "t11", type: "FS" }],
  },
  {
    local_id: "t21",
    name: "Connect visualization to data (all figures generated from source)",
    description: "",
    stage: "Visualization Build",
    default_responsible: "Min",
    estimate_hours: days(2),
    dependencies: [{ predecessor_local_id: "t20", type: "FS" }],
  },
  {
    local_id: "t22",
    name: "Visualization review (with Brett)",
    description: "",
    stage: "Visualization Build",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t21", type: "FS" }],
  },
  {
    local_id: "t23",
    name: "Refine visualization based on feedback",
    description: "",
    stage: "Visualization Build",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t22", type: "FS" }],
  },
  {
    local_id: "t24",
    name: "Second visualization review (with GTM and others)",
    description: "",
    stage: "Visualization Build",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t23", type: "FS" }],
  },
  {
    local_id: "t25",
    name: "Refine visualization based on GTM feedback (if any)",
    description: "",
    stage: "Visualization Build",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t24", type: "FS" }],
  },
  {
    local_id: "t26",
    name: "Real files in, visualization finished",
    description: "visualization updated with the final version of the csv files",
    stage: "Final Visualization",
    default_responsible: "Min",
    estimate_hours: days(2),
    dependencies: [{ predecessor_local_id: "t19", type: "FS" }],
  },
  {
    local_id: "t27",
    name: "Caveats walkthrough",
    description:
      "The AIRE walks the dashboard developer through anything the numbers shouldn't be used for (for example rates that are floors, not estimates)",
    stage: "Final Visualization",
    default_responsible: null,
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t26", type: "SS" }],
  },
  {
    local_id: "t28",
    name: "Final visualization review and confirmation",
    description: "Final review with Brett",
    stage: "Final Visualization",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t26", type: "FS" }],
  },
  {
    local_id: "t29",
    name: "Integrate final visualization into AutoInsights app",
    description: "",
    stage: "Release",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t28", type: "FS" }],
  },
  {
    local_id: "t30",
    name: "QA updated application",
    description: "",
    stage: "Release",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t29", type: "SS" }],
  },
  {
    local_id: "t31",
    name: "Application deployed",
    description: "",
    stage: "Release",
    default_responsible: "Min",
    estimate_hours: days(1),
    dependencies: [
      { predecessor_local_id: "t27", type: "FS" },
      { predecessor_local_id: "t30", type: "FS" },
    ],
  },
  {
    local_id: "t32",
    name: "Spot-check and exe version recorded",
    description:
      "Spot-check one customer's dashboard against that customer's run folder\nRelease noted in Praxis with the exe version it shipped in",
    stage: "Release",
    default_responsible: "Josh",
    estimate_hours: days(1),
    dependencies: [{ predecessor_local_id: "t31", type: "SS" }],
  },
  {
    local_id: "t33",
    name: "Product write-up and walkthrough",
    description:
      "Product-facing write-up: what the output answers, how to read it, known limits and caveats\n" +
      "Walkthrough with the product owner\n" +
      "Record lessons from the project for the next AIRE",
    stage: "Productization",
    default_responsible: null,
    estimate_hours: days(5),
    dependencies: [
      { predecessor_local_id: "t29", type: "FS" },
      { predecessor_local_id: "t32", type: "FS" },
    ],
  },
  {
    local_id: "t34",
    name: "Product ownership accepted",
    description: "",
    stage: "Productization",
    default_responsible: "Trish",
    estimate_hours: days(5),
    dependencies: [{ predecessor_local_id: "t33", type: "FS" }],
  },
];

async function main() {
  const users = await UserRepository.getAll();
  const admin = users.find((u) => u.role === "Admin") ?? users[0];
  if (!admin) {
    throw new Error("No users found — create at least one user before seeding.");
  }

  const template = await createTemplate(
    {
      template_name: "Visualization Template",
      tracks: [TRACK_A],
      // Every task in the reference doc carries "Default priority: Medium" —
      // injected here rather than repeated 34 times above.
      tasks: TASKS.map((t) => ({ ...t, default_priority: "Medium" as const })),
    },
    { createdBy: admin.user_id as UserId },
  );

  console.log(
    `Created template "${template.template_name}" (${template.template_id}) with ${template.tasks.length} tasks.`,
  );
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
