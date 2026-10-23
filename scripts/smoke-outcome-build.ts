/**
 * Smoke test for lib/projects/outcome-build.ts against a live-data export.
 * Usage: npx tsx scripts/smoke-outcome-build.ts <live.json> <projectId> <outcomeText>
 * Pure: prints the plan, writes nothing.
 */
import fs from "node:fs";
import { planOutcomeProject, outcomeBuildBlocker } from "../lib/projects/outcome-build";

const [file, projectId, text] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(file, "utf8"));
const source = d.projects.find((p: { project_id: string }) => p.project_id === projectId);
const outcome = source.outcomes.find((o: { text: string }) => o.text === text);
const useCase = d.use_cases.find((u: { member_project_ids: string[] }) =>
  u.member_project_ids.includes(projectId),
) ?? null;
console.log("blocker:", outcomeBuildBlocker({ ...outcome, delivery: null }));
console.log(
  JSON.stringify(
    planOutcomeProject(source, { ...outcome, delivery: null }, {
      useCase,
      knownApplicationProducts: new Set(d.projects.map((p: { application_product: string }) => p.application_product)),
      outcomeProducts: ["Automated Insights", "Quality Central"],
      outcomeTypes: ["visualization", "automation"],
    }),
    null,
    1,
  ),
);
