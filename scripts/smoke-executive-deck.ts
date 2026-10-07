/**
 * Smoke test for the executive deck: plan logic + a real .pptx render
 * (no database, no template file — fallback branding).
 * Run: npx tsx scripts/smoke-executive-deck.ts
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import PptxGenJS from "pptxgenjs";

import {
  DECK_PRESETS,
  buildDeckPlan,
  clip,
  paginate,
  type DeckOptions,
} from "../lib/executive/deck";
import { EXEC_PILLARS } from "../lib/executive/portfolio";
import { addExecutiveSlide } from "../lib/export/executive-slides";
import { addTitleSlide } from "../lib/export/slide-builders";
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

// 11 Revenue projects in Q4 (forces pagination), plus other pillars/quarters.
const projects: Project[] = [];
for (let i = 1; i <= 11; i += 1) {
  projects.push(
    mk({
      project_id: `2026-${String(i).padStart(3, "0")}`,
      name: `Revenue project ${i}`,
      benefits: i === 1 ? "Saves analysts about two hours per review. ".repeat(10) : "",
      supports: i === 1 ? "Repeat call reduction" : "",
    }),
  );
}
projects.push(
  mk({ project_id: "2026-101", name: "Shipped", stage: "Productization", target_date: "2026-10-02", benefits: "Done" }),
  mk({ project_id: "2026-102", name: "Cost project", primary_objective: "Cost-to-Serve", target_date: "2026-12-04" }),
  mk({ project_id: "2026-103", name: "Next quarter project", primary_objective: "Compliance", target_date: "2027-01-08" }),
  mk({ project_id: "2026-104", name: "Late", target_date: "2026-09-11", stage: "Kickoff" }),
);

const entries = buildProjectEntries({
  today,
  projects,
  allProjects: projects,
  allTasks: [],
  useCases: [],
  userNamesById: {},
});

const base = (over: Partial<DeckOptions> = {}): DeckOptions => ({
  preset: "qbr",
  scope: "2026-Q4",
  pillars: [...EXEC_PILLARS],
  sections: DECK_PRESETS.qbr.sections,
  detail: "detailed",
  ...over,
});

// ---- helpers ----
assert.deepEqual(paginate([], 4), [[]]);
assert.deepEqual(paginate([1, 2, 3, 4, 5], 4), [[1, 2, 3, 4], [5]]);
assert.equal(clip("a  b\n c", 99), "a b c");
assert.equal(clip("x".repeat(10), 5), "xxxx…");

// ---- QBR plan: canonical order, pagination ----
const qbr = buildDeckPlan({ entries, today, noPillarCount: 2, options: base() });
assert.equal(qbr.title, "Innovation Quarterly Business Review");
assert.ok(qbr.subtitle.includes("Q4 2026") && qbr.subtitle.includes("As of"));
const kinds = qbr.slides.map((s) => s.kind);
assert.equal(kinds[0], "summary");
assert.equal(kinds[1], "delivered");
assert.equal(kinds[kinds.length - 1], "releases");
assert.ok(kinds.indexOf("pillar") < kinds.indexOf("attention"));
assert.ok(kinds.indexOf("attention") < kinds.indexOf("nextQuarter"));
// 13 Revenue projects in the Q4 view (11 + "Shipped" + carried-over "Late"),
// detailed = 4/slide => 4 slides.
const revenueSlides = qbr.slides.filter((s) => s.kind === "pillar" && s.pillar === "Revenue");
assert.equal(revenueSlides.length, 4);
assert.ok(revenueSlides.every((s) => s.kind === "pillar" && s.rows.length <= 4));
const summary = qbr.slides[0];
assert.ok(summary.kind === "summary" && summary.footnote.includes("2 Innovation projects have no pillar"));
// Clipped text never exceeds its cap.
for (const s of qbr.slides) {
  if (s.kind === "pillar") {
    for (const r of s.rows) {
      assert.ok(r.benefits.length <= 220 && r.supports.length <= 200);
    }
  }
}
// Next-quarter slide has only next-quarter projects.
const nq = qbr.slides.find((s) => s.kind === "nextQuarter");
assert.ok(nq && nq.kind === "nextQuarter" && nq.rows.map((r) => r.name).join() === "Next quarter project");
// Delivered slide shows only the shipped project in this period? (carried none)
const delivered = qbr.slides.find((s) => s.kind === "delivered");
assert.ok(delivered && delivered.kind === "delivered" && delivered.rows.map((r) => r.name).join() === "Shipped");

// ---- Monthly preset: summary detail, order, no delivered/nextQuarter ----
const monthly = buildDeckPlan({
  entries,
  today,
  noPillarCount: 0,
  options: base({
    preset: "monthly",
    sections: DECK_PRESETS.monthly.sections,
    detail: "summary",
  }),
});
assert.equal(monthly.title, "Innovation Monthly Update");
const mk2 = monthly.slides.map((s) => s.kind);
assert.ok(!mk2.includes("delivered") && !mk2.includes("nextQuarter"));
assert.equal(mk2[0], "summary");
const mRevenue = monthly.slides.filter((s) => s.kind === "pillar" && s.pillar === "Revenue");
assert.equal(mRevenue.length, 2); // 13 projects at 9/slide
const sumNoNote = monthly.slides[0];
assert.ok(sumNoNote.kind === "summary" && !sumNoNote.footnote.includes("no pillar assigned"));

// ---- Pillar filter + custom title + unscheduled has no next quarter ----
const only = buildDeckPlan({
  entries,
  today,
  noPillarCount: 0,
  options: base({ pillars: ["Cost-to-Serve"], scope: "unscheduled", title: "Custom" }),
});
assert.equal(only.title, "Custom");
assert.ok(!only.slides.some((s) => s.kind === "nextQuarter"));
assert.ok(only.slides.every((s) => s.kind !== "pillar" || s.pillar === "Cost-to-Serve"));

// ---- Real render: every slide kind into a .pptx ----
const pptx = new PptxGenJS();
pptx.layout = "LAYOUT_WIDE";
const branding = { primaryHex: "1F2937", secondaryHex: "3B82F6", fontFace: "Calibri" };
addTitleSlide(pptx, branding, { title: qbr.title, subtitle: qbr.subtitle });
for (const s of qbr.slides) addExecutiveSlide(pptx, branding, s);
for (const s of monthly.slides) addExecutiveSlide(pptx, branding, s);

const expectedSlides = 1 + qbr.slides.length + monthly.slides.length;
const internal = (pptx as unknown as { _slides?: unknown[] })._slides ?? [];
assert.equal(internal.length, expectedSlides);

async function render() {
  const out = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  assert.ok(out.length > 10_000, "pptx should be non-trivial");
  assert.equal(out.subarray(0, 2).toString(), "PK"); // zip container
  const file = path.join(os.tmpdir(), "praxis-executive-deck-smoke.pptx");
  fs.writeFileSync(file, out);

  console.log(`smoke-executive-deck: ok (${expectedSlides} slides, ${out.length} bytes -> ${file})`);
}

render().catch((err) => {
  console.error(err);
  process.exit(1);
});
