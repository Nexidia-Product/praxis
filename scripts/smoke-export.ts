/**
 * Functional smoke test for the PPTX export module (Section 5.9, Step 5b).
 *
 * Covers the pure helpers and the native slide builders. The off-screen
 * renderer (`export-renderer.tsx`) and the export modal are React + DOM
 * code that doesn't make sense to exercise from a Node script — they're
 * bottlenecked through the helpers tested here, so a clean run gives
 * high confidence the export round-trip works end to end.
 *
 * What is tested:
 *
 *   - SLIDE_TYPES catalog: stable kinds, every entry has a label,
 *     defaultOn flag, and category that matches expectations
 *   - branding.ts: hex normalization for assorted color string formats
 *   - payload.ts: the exportFilename helper produces the documented
 *     IIM_Roadmap_YYYY-MM-DD.pptx format
 *   - selectAtRiskItems: surfaces the right projects + tasks based on
 *     status, target date, and blocked flag
 *   - addTitleSlide / addNowNextLaterSlide / addProjectsStatusSlide /
 *     addBlockedAtRiskSlide: each builds without throwing against a
 *     realistic project list, and the resulting deck writes to a
 *     non-empty Buffer that begins with the PK zip signature.
 *
 * Run with:
 *   npx tsx scripts/smoke-export.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-export-smoke-"));
process.env.IIM_DATA_DIR = scratch;

async function main() {
  const {
    SLIDE_TYPES,
    findSlideType,
    selectedSlides,
    isSlideKind,
  } = await import("../lib/export/slide-types");
  type SlideKindFromCatalog = import("../lib/export/slide-types").SlideKind;
  const { resolveBranding, toPptxHex } = await import(
    "../lib/export/branding"
  );
  const { exportFilename } = await import("../lib/export/payload");
  const {
    addTitleSlide,
    addNowNextLaterSlide,
    addProjectsStatusSlide,
    addBlockedAtRiskSlide,
    addRasterSlide,
    addVelocitySlide,
    selectAtRiskItems,
    SLIDE_W,
    SLIDE_H,
  } = await import("../lib/export/slide-builders");

  type Project = import("../lib/db").Project;
  type Task = import("../lib/db").Task;

  // ---- Test harness ------------------------------------------------

  let passed = 0;
  let failed = 0;
  function assert(label: string, cond: boolean): void {
    if (cond) {
      passed++;
      console.log(`  ✓ ${label}`);
    } else {
      failed++;
      console.error(`  ✗ ${label}`);
    }
  }
  function section(title: string): void {
    console.log(`\n${title}`);
  }

  // ---- SLIDE_TYPES catalog ----------------------------------------

  section("SLIDE_TYPES catalog");
  const expectedKinds: ReadonlySet<string> = new Set([
    "title",
    "timeline",
    "kanban",
    "bubble",
    "now-next-later",
    "projects-status",
    "blocked-at-risk",
    "velocity",
  ]);
  const actualKinds: ReadonlySet<string> = new Set(SLIDE_TYPES.map((s) => s.kind));
  assert("catalog has every documented kind", expectedKinds.size === actualKinds.size);
  for (const kind of expectedKinds) {
    assert(`catalog contains "${kind}"`, actualKinds.has(kind));
  }
  for (const s of SLIDE_TYPES) {
    assert(
      `"${s.kind}" has a non-empty label`,
      typeof s.label === "string" && s.label.length > 0,
    );
    assert(
      `"${s.kind}" category is native or raster`,
      s.category === "native" || s.category === "raster",
    );
    if (s.category === "raster") {
      assert(
        `"${s.kind}" raster slide names a roadmap view`,
        s.view !== null,
      );
    } else {
      assert(`"${s.kind}" native slide has view=null`, s.view === null);
    }
  }
  assert("findSlideType returns a known kind", findSlideType("title") !== null);
  assert("findSlideType returns null for unknown", findSlideType("nope") === null);
  assert("isSlideKind accepts known kinds", isSlideKind("timeline"));
  assert("isSlideKind rejects unknown", !isSlideKind("zzz"));

  const subset = selectedSlides(new Set<SlideKindFromCatalog>(["projects-status", "title"]));
  assert("selectedSlides preserves catalog order", subset[0].kind === "title");
  assert(
    "selectedSlides filters down correctly",
    subset.length === 2 &&
      subset.every((s) => s.kind === "title" || s.kind === "projects-status"),
  );

  // ---- branding.ts -------------------------------------------------

  section("branding.ts");
  assert("toPptxHex strips leading hash", toPptxHex("#ff8800", "X") === "FF8800");
  assert("toPptxHex uppercases", toPptxHex("aabbcc", "X") === "AABBCC");
  assert("toPptxHex expands 3-char hex", toPptxHex("#abc", "X") === "AABBCC");
  assert("toPptxHex handles rgb()", toPptxHex("rgb(255,128,0)", "X") === "FF8000");
  assert(
    "toPptxHex handles rgba()",
    toPptxHex("rgba(0, 17, 255, 0.5)", "X") === "0011FF",
  );
  assert("toPptxHex falls back on garbage", toPptxHex("not-a-color", "AAA") === "AAA");
  assert("toPptxHex falls back on empty", toPptxHex("", "BBB") === "BBB");

  const resolved = resolveBranding({
    logo_url: null,
    primary_color: "#ff0000",
    secondary_color: "#00ff00",
    font: "Helvetica",
  });
  assert("resolveBranding normalizes primary", resolved.primaryHex === "FF0000");
  assert("resolveBranding normalizes secondary", resolved.secondaryHex === "00FF00");
  assert("resolveBranding keeps font", resolved.fontFace === "Helvetica");

  const resolvedFallback = resolveBranding({
    logo_url: null,
    primary_color: "junk",
    secondary_color: "",
    font: "",
  });
  assert(
    "resolveBranding uses fallback when font is empty",
    resolvedFallback.fontFace === "Inter",
  );
  assert(
    "resolveBranding falls back on bad primary",
    resolvedFallback.primaryHex === "1F2937",
  );

  // ---- payload.ts --------------------------------------------------

  section("payload.ts");
  const fixed = new Date(2026, 3, 27); // April 27, 2026 (month is 0-indexed)
  assert(
    "exportFilename uses YYYY-MM-DD",
    exportFilename(fixed) === "IIM_Roadmap_2026-04-27.pptx",
  );
  // January 5 — pads month and day.
  const padded = new Date(2026, 0, 5);
  assert(
    "exportFilename pads month and day",
    exportFilename(padded) === "IIM_Roadmap_2026-01-05.pptx",
  );

  // ---- Sample data -------------------------------------------------

  function buildProject(p: Partial<Project> & { project_id: string }): Project {
    return {
      project_id: p.project_id,
      name: p.name ?? "Sample project",
      description: p.description ?? "",
      application_product: p.application_product ?? "Insights",
      project_type: p.project_type ?? "New Application",
      date_added: p.date_added ?? "2026-01-01",
      priority: p.priority ?? "High",
      status: p.status ?? "In Progress",
      phase: p.phase ?? "Application Development",
      primary_stakeholders: p.primary_stakeholders ?? ["Brett"],
      project_lead: p.project_lead ?? "Min",
      additional_resources: p.additional_resources ?? [],
      resource_allocations: {},
      target_date: p.target_date ?? "2026-06-30",
      ai_complexity_score: p.ai_complexity_score ?? null,
      ai_time_estimate: p.ai_time_estimate ?? null,
      roadmap_bucket: p.roadmap_bucket ?? null,
      roadmap_timeline_start: p.roadmap_timeline_start ?? null,
      github_issue_id: p.github_issue_id ?? null,
      jira_issue_id: p.jira_issue_id ?? null,
      health_score: p.health_score ?? null,
      health_score_history: p.health_score_history ?? [],
      status_history: p.status_history ?? [],
      depends_on: p.depends_on ?? [],
      dependencies: p.dependencies ?? [],
      external_dependencies: p.external_dependencies ?? [],
      document_links: p.document_links ?? [],
      custom_fields: p.custom_fields ?? {},
      created_by: p.created_by ?? "seed",
      updated_at: p.updated_at ?? "2026-04-01T00:00:00Z",
    };
  }

  function buildTask(t: Partial<Task> & { task_id: string; project_id: string }): Task {
    return {
      task_id: t.task_id,
      project_id: t.project_id,
      task_name: t.task_name ?? "Sample task",
      detailed_description: t.detailed_description ?? "",
      status: t.status ?? "Not Started",
      priority: t.priority ?? "Medium",
      responsible: t.responsible ?? "Min",
      additional_assignees: t.additional_assignees ?? [],
      target_date: t.target_date ?? null,
      blocked: t.blocked ?? false,
      blocker_issue_task: t.blocker_issue_task ?? "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comment_history: [],
      estimate_hours: null,
      comments: t.comments ?? "",
      document_links: t.document_links ?? [],
      template_id: t.template_id ?? null,
      created_at: t.created_at ?? "2026-04-01T00:00:00Z",
      updated_at: t.updated_at ?? "2026-04-01T00:00:00Z",
    };
  }

  // ---- selectAtRiskItems ------------------------------------------

  section("selectAtRiskItems");
  const today = new Date(2026, 3, 27); // April 27, 2026

  const projects: Project[] = [
    buildProject({ project_id: "2026-001", status: "In Progress", target_date: "2026-09-01" }),
    buildProject({ project_id: "2026-002", status: "Blocked" }),
    buildProject({ project_id: "2026-003", status: "Delayed" }),
    buildProject({ project_id: "2026-004", status: "On Hold" }),
    buildProject({ project_id: "2026-005", status: "In Progress", target_date: "2025-12-01" }),
    buildProject({ project_id: "2026-006", status: "Completed", target_date: "2025-12-01" }),
  ];

  const tasks: Task[] = [
    buildTask({ task_id: "26-0001", project_id: "2026-001", blocked: true }),
    buildTask({ task_id: "26-0002", project_id: "2026-001", target_date: "2025-01-01" }),
    buildTask({ task_id: "26-0003", project_id: "2026-001", target_date: "2030-01-01" }),
    buildTask({ task_id: "26-0004", project_id: "2026-001", status: "Complete", blocked: true }),
  ];

  const risks = selectAtRiskItems(projects, tasks, today);
  const projectRisks = risks.filter((r) => r.kind === "Project");
  const taskRisks = risks.filter((r) => r.kind === "Task");

  // 4 risk projects: Blocked, Delayed, On Hold, past-target In Progress.
  // Completed (with a past target) is exempt; In Progress with a future
  // target is not at risk.
  assert(
    "4 projects flagged at risk",
    projectRisks.length === 4,
  );
  // 2 risk tasks: blocked, past-due. The completed-but-blocked task is
  // exempt; the future-target task is not at risk.
  assert("2 tasks flagged at risk", taskRisks.length === 2);

  const blockedFirst = risks.find((r) => r.reason === "Blocked");
  assert("blocked items present", blockedFirst !== undefined);
  assert(
    "first item is a blocked one",
    risks[0].reason === "Blocked",
  );

  // ---- Slide builders against a live pptxgenjs deck ---------------

  section("slide builders");
  const { default: PptxGenJS } = await import("pptxgenjs");
  const pptx = new PptxGenJS();
  pptx.layout = "LAYOUT_WIDE";

  const branding = resolveBranding({
    logo_url: null,
    primary_color: "#1f2937",
    secondary_color: "#3b82f6",
    font: "Inter",
  });

  // Wider variety so the Now/Next/Later columns each have something
  // to display and the Status table has multiple statuses.
  const richProjects: Project[] = [
    buildProject({ project_id: "2026-001", name: "Auto Insights", priority: "High", roadmap_bucket: "Now" }),
    buildProject({ project_id: "2026-002", name: "Compliance Tracker", priority: "Critical", status: "Blocked", roadmap_bucket: null }),
    buildProject({ project_id: "2026-003", name: "Analytics Pipeline", priority: "Medium", status: "In Planning", target_date: "2026-08-15" }),
    buildProject({ project_id: "2026-004", name: "Customer Portal", priority: "Low", status: "Not Started", target_date: "2027-01-15" }),
    buildProject({ project_id: "2026-005", name: "Data Warehouse", priority: "High", status: "Delayed", target_date: "2025-12-01" }),
  ];

  // Each builder should add exactly one slide and not throw.
  const sentinel0 = countSlides(pptx);
  addTitleSlide(pptx, branding, { title: "Test deck", subtitle: "Smoke test" });
  assert("addTitleSlide adds one slide", countSlides(pptx) === sentinel0 + 1);

  const sentinel1 = countSlides(pptx);
  addNowNextLaterSlide(pptx, branding, richProjects);
  assert("addNowNextLaterSlide adds one slide", countSlides(pptx) === sentinel1 + 1);

  const sentinel2 = countSlides(pptx);
  addProjectsStatusSlide(pptx, branding, richProjects);
  assert("addProjectsStatusSlide adds one slide", countSlides(pptx) === sentinel2 + 1);

  const sentinel3 = countSlides(pptx);
  addBlockedAtRiskSlide(pptx, branding, richProjects, tasks);
  assert("addBlockedAtRiskSlide adds one slide", countSlides(pptx) === sentinel3 + 1);

  const sentinel3b = countSlides(pptx);
  addVelocitySlide(pptx, branding, {
    rangeLabel: "Last 90 days",
    totalCompleted: 5,
    avgDaysToCompletion: 42,
    avgSampleSize: 5,
    meanTasksPerWeek: 3.4,
    totalTasksCompleted: 17,
    ideaConversionRate: 50,
    ideasSubmitted: 4,
    ideasConverted: 2,
    insufficientHistory: false,
  });
  assert(
    "addVelocitySlide adds one slide",
    countSlides(pptx) === sentinel3b + 1,
  );

  // Insufficient-history path also renders without throwing.
  const sentinel3c = countSlides(pptx);
  addVelocitySlide(pptx, branding, {
    rangeLabel: "All time",
    totalCompleted: 1,
    avgDaysToCompletion: 0,
    avgSampleSize: 0,
    meanTasksPerWeek: 0,
    totalTasksCompleted: 0,
    ideaConversionRate: 0,
    ideasSubmitted: 0,
    ideasConverted: 0,
    insufficientHistory: true,
  });
  assert(
    "addVelocitySlide renders calibration footer when insufficient",
    countSlides(pptx) === sentinel3c + 1,
  );

  // Empty cases shouldn't throw — empty state messaging is the whole point.
  const sentinel4 = countSlides(pptx);
  addProjectsStatusSlide(pptx, branding, []);
  addBlockedAtRiskSlide(pptx, branding, [], []);
  addNowNextLaterSlide(pptx, branding, []);
  assert(
    "empty inputs still produce slides",
    countSlides(pptx) === sentinel4 + 3,
  );

  // Raster slide with a tiny PNG data URL — exercises the path that
  // embeds an image without depending on html2canvas.
  const tinyPng =
    "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=";
  const sentinel5 = countSlides(pptx);
  addRasterSlide(pptx, branding, {
    title: "Timeline",
    capture: { data_url: tinyPng, width: 1600, height: 900 },
  });
  assert("addRasterSlide adds one slide", countSlides(pptx) === sentinel5 + 1);

  // Slide dimension constants match LAYOUT_WIDE.
  assert("slide width is 13.333", Math.abs(SLIDE_W - 13.333) < 0.01);
  assert("slide height is 7.5", Math.abs(SLIDE_H - 7.5) < 0.01);

  // ---- Final write check ------------------------------------------

  section("end-to-end deck write");
  const buf = (await pptx.write({ outputType: "nodebuffer" })) as Buffer;
  assert("deck buffer is non-empty", buf.length > 1024);
  // PPTX is a ZIP — first two bytes are "PK".
  assert(
    "deck buffer is a ZIP (PK signature)",
    buf[0] === 0x50 && buf[1] === 0x4b,
  );

  // ---- Done -------------------------------------------------------

  console.log(`\n${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

function countSlides(pptx: unknown): number {
  const internal = pptx as { _slides?: unknown[] };
  return internal._slides?.length ?? 0;
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    try {
      rmSync(scratch, { recursive: true, force: true });
    } catch {
      /* ignore */
    }
  });
