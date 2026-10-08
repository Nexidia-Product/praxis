/**
 * Smoke test for outcome delivery links (`lib/projects/outcome-delivery.ts`)
 * and for the Markdown import carrying them through. Pure, no database.
 *
 * Run with:
 *   npm run smoke:outcome-delivery
 */

import assert from "node:assert/strict";

import type { Project, ProjectOutcome } from "@/lib/db";
import {
  clearDeliveryTarget,
  collectDeliveryTargetIds,
  normalizeDelivery,
} from "@/lib/projects/outcome-delivery";
import {
  buildImportPayload,
  parseProjectMarkdown,
  planImport,
} from "@/lib/projects/markdown-import";

const known = new Set(["2026-031", "2026-040"]);

// ---- normalizeDelivery ----
assert.deepEqual(normalizeDelivery(undefined, "2026-024", known), { ok: true, value: null });
assert.deepEqual(normalizeDelivery(null, "2026-024", known), { ok: true, value: null });
assert.deepEqual(normalizeDelivery({ kind: "self" }, undefined, known), { ok: true, value: { kind: "self" } });
assert.deepEqual(
  normalizeDelivery({ kind: "project", project_id: "2026-031" }, "2026-024", known),
  { ok: true, value: { kind: "project", project_id: "2026-031" } },
);
// A link to the project's own ID folds into "self".
assert.deepEqual(
  normalizeDelivery({ kind: "project", project_id: "2026-024" }, "2026-024", known),
  { ok: true, value: { kind: "self" } },
);
assert.equal(normalizeDelivery({ kind: "project", project_id: "2026-999" }, "2026-024", known).ok, false, "unknown target");
assert.equal(normalizeDelivery({ kind: "project" }, "2026-024", known).ok, false, "missing id");
assert.equal(normalizeDelivery({ kind: "bogus" }, "2026-024", known).ok, false, "bad kind");
assert.equal(normalizeDelivery("2026-031", "2026-024", known).ok, false, "not an object");

// ---- collectDeliveryTargetIds ----
assert.deepEqual(
  collectDeliveryTargetIds([
    { text: "a", delivery: { kind: "project", project_id: "2026-031" } },
    { text: "b", delivery: { kind: "project", project_id: "2026-031" } },
    { text: "c", delivery: { kind: "self" } },
    { text: "d", delivery: null },
    { text: "e" },
    null,
  ]),
  ["2026-031"],
);
assert.deepEqual(collectDeliveryTargetIds("nope"), []);

// ---- clearDeliveryTarget ----
const outcomes: ProjectOutcome[] = [
  { id: "o1", text: "Task Assist bot", product: "Cognigy", type: null, delivery: { kind: "project", project_id: "2026-031" } },
  { id: "o2", text: "Quality Central build", product: null, type: null, delivery: null },
  { id: "o3", text: "Dashboard", product: null, type: null, delivery: { kind: "self" } },
  { id: "o4", text: "Other bot", product: null, type: null, delivery: { kind: "project", project_id: "2026-040" } },
];
const cleared = clearDeliveryTarget(outcomes, "2026-031");
assert.equal(cleared[0].delivery, null);
assert.deepEqual(cleared[2].delivery, { kind: "self" });
assert.deepEqual(cleared[3].delivery, { kind: "project", project_id: "2026-040" });
assert.equal(outcomes[0].delivery?.kind, "project", "input not mutated");

// ---- Markdown import keeps existing links and adds new outcomes unlinked ----
const project = {
  project_id: "2026-024",
  name: "Hold Time Analysis",
  description: "d",
  definition_of_done: "",
  supports: "",
  benefits: "",
  outcomes,
} as unknown as Project;
const md = `# Hold Time Analysis (2026-024)

## Outcomes

- Task Assist bot
- Brand new outcome
`;
const plan = planImport(project, parseProjectMarkdown(md, { products: [], types: [] }));
const payload = buildImportPayload(plan, new Set(), true) as {
  outcomes: { id?: string; text: string; delivery: unknown }[];
};
assert.equal(payload.outcomes.length, 5);
assert.deepEqual(payload.outcomes[0].delivery, { kind: "project", project_id: "2026-031" }, "existing link preserved");
assert.deepEqual(payload.outcomes[2].delivery, { kind: "self" }, "self preserved");
assert.equal(payload.outcomes[4].text, "Brand new outcome");
assert.equal(payload.outcomes[4].delivery, null, "new outcome starts unplanned");

console.log("smoke-outcome-delivery: all assertions passed");
