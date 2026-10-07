/**
 * Smoke test for the Markdown import (`lib/projects/markdown-import.ts`).
 *
 * Round-trips against the real exporter so format drift between
 * `buildProjectMarkdown` and the parser fails here.
 *
 * Run with:
 *   npm run smoke:markdown-import
 *
 * Exits non-zero on the first assertion failure.
 */

import assert from "node:assert/strict";

import type { Project } from "@/lib/db";
import { buildProjectMarkdown } from "@/lib/projects/markdown";
import {
  buildImportPayload,
  parseProjectMarkdown,
  planImport,
  type ReplacedFieldKey,
} from "@/lib/projects/markdown-import";

const vocab = { products: ["Cognigy", "Atlas"], types: ["automation", "analytics"] };

function makeProject(over: Partial<Project> = {}): Project {
  return {
    project_id: "2026-024",
    name: "Mistreatment Identification",
    description: "Old description",
    definition_of_done: "Old DoD",
    supports: "",
    benefits: "Old benefits",
    application_product: "Atlas",
    program: "Innovation",
    project_type: "Analysis",
    track: "Analysis",
    primary_objective: "",
    secondary_objectives: [],
    priority: "Medium",
    is_key_capability: false,
    key_capability_quarter: null,
    ai_complexity_score: null,
    visualization_type: "Data Only",
    stage: "Intake",
    project_lead: "Pat",
    target_date: null,
    target_executable_deployment_date: null,
    updated_at: "2026-10-01T00:00:00Z",
    dependencies: [],
    external_dependencies: [],
    outcomes: [
      { id: "o1", text: "Reduce AHT (average handle time)", product: null, type: null },
      { id: "o2", text: "Auto create campaigns", product: "Cognigy", type: "automation" },
    ],
    ...over,
  } as unknown as Project;
}

function main() {
  // 1. Round trip: exporting then parsing gives back the stored values, and
  //    planning against the same project is a no-op.
  const p = makeProject();
  const parsed = parseProjectMarkdown(buildProjectMarkdown(p), vocab);
  assert.equal(parsed.projectId, "2026-024");
  assert.equal(parsed.fields.description, "Old description");
  assert.equal(parsed.fields.supports, "", "placeholder normalizes to empty");
  assert.equal(parsed.outcomes?.length, 2);
  assert.equal(parsed.outcomes?.[0].text, "Reduce AHT (average handle time)");
  assert.equal(parsed.outcomes?.[0].product, null, "non-vocab parenthetical stays in text");
  assert.equal(parsed.outcomes?.[1].product, "Cognigy");
  assert.equal(parsed.outcomes?.[1].type, "automation");
  const noop = planImport(p, parsed);
  assert.deepEqual(noop.errors, []);
  assert.equal(noop.hasChanges, false);

  // 2. Replace fields + append only new outcomes (reworded => new).
  const md = `# Mistreatment Identification (2026-024)

## Description

New description
with two lines

## Definition of Done

New DoD

## Supports

Supports text

## Benefits

_None recorded._

## Outcomes

- Reduce AHT (average handle time)
- Auto create campaigns (Cognigy, automation)
- Auto-create outbound campaigns (Cognigy, automation)
- Detect mistreatment (Cognigy, bogus)
`;
  const plan = planImport(p, parseProjectMarkdown(md, vocab));
  assert.deepEqual(plan.errors, []);
  const changed = plan.fields.filter((f) => f.changed).map((f) => f.key).sort();
  assert.deepEqual(changed, ["benefits", "definition_of_done", "description", "supports"]);
  assert.ok(plan.fields.find((f) => f.key === "benefits")?.clears);
  assert.ok(plan.warnings.some((w) => w.includes("will be cleared")));
  assert.ok(plan.warnings.some((w) => w.includes('"bogus"')));
  assert.equal(plan.outcomes.duplicates.length, 2);
  assert.deepEqual(
    plan.outcomes.added.map((o) => o.text),
    ["Auto-create outbound campaigns", "Detect mistreatment"],
  );
  assert.equal(plan.outcomes.added[1].type, null, "unknown tag dropped");

  const all = new Set<ReplacedFieldKey>(["description", "definition_of_done", "supports", "benefits"]);
  const payload = buildImportPayload(plan, all, true) as {
    description: string;
    outcomes: { id?: string; text: string }[];
  };
  assert.equal(payload.description, "New description\nwith two lines");
  assert.equal(payload.outcomes.length, 4);
  assert.deepEqual(payload.outcomes.slice(0, 2).map((o) => o.id), ["o1", "o2"], "existing kept first, ids preserved");
  assert.equal(payload.outcomes[2].id, undefined, "new outcomes omit id");

  // 3. Unchecked field / outcomes are left out of the payload.
  const partial = buildImportPayload(plan, new Set<ReplacedFieldKey>(["description"]), false);
  assert.deepEqual(Object.keys(partial), ["description"]);

  // 4. Absent sections are left alone.
  const sparse = planImport(p, parseProjectMarkdown("# X (2026-024)\n\n## Supports\n\nOnly this\n", vocab));
  assert.deepEqual(sparse.fields.filter((f) => f.changed).map((f) => f.key), ["supports"]);
  assert.equal(sparse.outcomes.added.length, 0);

  // 5. Wrong or missing project ID blocks the import.
  assert.equal(planImport(p, parseProjectMarkdown("# X (2026-999)\n", vocab)).errors.length, 1);
  assert.equal(planImport(p, parseProjectMarkdown("no title here\n", vocab)).errors.length, 1);

  // 6. CRLF + free-text "## " lines inside a section aren't treated as boundaries.
  const crlf = "# X (2026-024)\r\n\r\n## Description\r\n\r\nLine one\r\n## Random heading\r\nLine two\r\n";
  assert.equal(
    parseProjectMarkdown(crlf, vocab).fields.description,
    "Line one\n## Random heading\nLine two",
  );

  console.log("smoke-markdown-import: all assertions passed");
}

main();
