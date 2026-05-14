/**
 * Functional smoke test for Step 11 — Idea Submission Portal (Section 5.17)
 * and Ideas Review (Section 5.18).
 *
 * Exercised:
 *
 *   1. `lib/ideas/service`     — submission validation, status transitions,
 *                                 admin updates, conversion to project,
 *                                 AI overlap heuristic (Step-10 fallback)
 *   2. `lib/ratelimit`          — per-key fixed-window counter behavior
 *
 * Each slice runs against a fresh temp data dir via IIM_DATA_DIR so the
 * smoke test never touches real data. Run with:
 *
 *   npx tsx scripts/smoke-ideas.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-step11-smoke-"));
process.env.IIM_DATA_DIR = scratch;

async function main() {
  // ---- Imports (deferred so IIM_DATA_DIR is set before any module reads it).
  const {
    submitIdea,
    updateIdea,
    convertIdeaToProject,
    aiOverlapAnalysis,
    listIdeas,
    getIdea,
    buildConversionPreview,
    ValidationError,
    ConflictError,
    NotFoundError,
  } = await import("../lib/ideas/service");
  const {
    IdeaRepository,
    ProjectRepository,
    UserRepository,
  } = await import("../lib/db");
  const { checkRateLimit, __resetRateLimitForTests } = await import(
    "../lib/ratelimit"
  );

  // ---- Tiny test harness. -------------------------------------------------

  let passed = 0;
  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    passed++;
    console.log(`  ok  ${label}`);
  }

  async function expectThrows(
    label: string,
    fn: () => Promise<unknown>,
    matcher: (err: unknown) => boolean,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (matcher(err)) {
        passed++;
        console.log(`  ok  ${label}`);
        return;
      }
      console.error(`FAIL: ${label} — wrong error:`, err);
      process.exit(1);
    }
    console.error(`FAIL: ${label} — no error thrown`);
    process.exit(1);
  }

  // ---- Public submission --------------------------------------------------

  console.log("\nPublic submission");

  await expectThrows(
    "submitIdea rejects missing name",
    () =>
      submitIdea({
        idea_name: "x",
        description: "y",
        urgency: "Medium",
      }),
    (e) => e instanceof ValidationError,
  );

  await expectThrows(
    "submitIdea rejects missing description",
    () =>
      submitIdea({
        submitter_name: "Alex",
        idea_name: "x",
        urgency: "Medium",
      }),
    (e) => e instanceof ValidationError,
  );

  await expectThrows(
    "submitIdea rejects bad urgency",
    () =>
      submitIdea({
        submitter_name: "Alex",
        idea_name: "x",
        description: "y",
        urgency: "Sometime",
      }),
    (e) => e instanceof ValidationError,
  );

  await expectThrows(
    "submitIdea rejects malformed email",
    () =>
      submitIdea({
        submitter_name: "Alex",
        submitter_email: "not-an-email",
        idea_name: "x",
        description: "y",
        urgency: "Medium",
      }),
    (e) => e instanceof ValidationError,
  );

  await expectThrows(
    "submitIdea rejects bad target date format",
    () =>
      submitIdea({
        submitter_name: "Alex",
        idea_name: "x",
        description: "y",
        urgency: "Medium",
        requested_target_date: "Q4 2026",
      }),
    (e) => e instanceof ValidationError,
  );

  const idea1 = await submitIdea({
    submitter_name: "  Alex Rivera  ",
    submitter_email: "  alex@example.com  ",
    idea_name: "Self-service health dashboard",
    description: "Customers want to see their account health at a glance.",
    urgency: "Medium",
    requested_target_date: "2026-09-01",
    key_stakeholders: "Support, Product",
  });
  check("submitIdea returns a created record", idea1.idea_id);
  check("submitIdea trims submitter name", idea1.submitter_name === "Alex Rivera");
  check("submitIdea trims and lowercases email", idea1.submitter_email === "alex@example.com");
  check("submitIdea defaults status to New", idea1.status === "New");
  check("submitIdea preserves target date", idea1.requested_target_date === "2026-09-01");
  check("submitIdea has empty admin_comments by default", idea1.admin_comments === "");
  check("submitIdea has null converted_to_project_id by default", idea1.converted_to_project_id === null);

  // Submission without optional email — common case.
  const idea2 = await submitIdea({
    submitter_name: "Jordan Park",
    submitter_email: null,
    idea_name: "CSV export on the activity log",
    description: "Compliance asked for filtered CSV export.",
    urgency: "Low",
  });
  check("submitIdea accepts null email", idea2.submitter_email === null);
  check("submitIdea accepts missing target date", idea2.requested_target_date === null);

  // ---- Admin updates ------------------------------------------------------

  console.log("\nAdmin updates / status workflow");

  // New → Under Review is allowed.
  const reviewing = await updateIdea(idea1.idea_id, {
    status: "Under Review",
    admin_comments: "Looking into this with the dashboard team.",
  });
  check("New → Under Review allowed", reviewing.status === "Under Review");
  check("admin_comments persisted", reviewing.admin_comments.includes("dashboard team"));

  // Under Review → Approved.
  const approved = await updateIdea(idea1.idea_id, { status: "Approved" });
  check("Under Review → Approved allowed", approved.status === "Approved");

  // Reject path on a separate idea.
  const rejected = await updateIdea(idea2.idea_id, {
    status: "Rejected",
    admin_comments: "Already covered by the audit log work in 2026-014.",
  });
  check("New → Rejected allowed", rejected.status === "Rejected");

  // updateIdea refuses to set status to Converted (must go via convertIdea).
  await expectThrows(
    "updateIdea refuses status=Converted",
    () => updateIdea(idea1.idea_id, { status: "Converted" }),
    (e) => e instanceof ValidationError,
  );

  // Update on a non-existent idea.
  await expectThrows(
    "updateIdea throws NotFoundError on unknown id",
    () => updateIdea("non-existent", { status: "Approved" }),
    (e) => e instanceof NotFoundError,
  );

  // ---- Conversion to project ---------------------------------------------

  console.log("\nConversion to project");

  // Need a user to satisfy createProject's `createdBy`.
  const admin = await UserRepository.create({
    email: "admin-smoke@example.com",
    name: "Smoke Admin",
    role: "Admin",
    active: true,
    notification_preferences: {
      TaskAssigned: "InAppOnly",
      TaskDueSoon: "InAppOnly",
      TaskOverdue: "InAppOnly",
      ProjectBlocked: "InAppOnly",
      DependencyBlocked: "InAppOnly",
      HealthScoreChanged: "InAppOnly",
      IdeaStatusChanged: "InAppOnly",
    },
    digest_mode: false,
  });

  // Preview reflects the idea fields and maps urgency → priority.
  const preview = await buildConversionPreview(idea1.idea_id);
  check("buildConversionPreview pulls idea name", preview.name === idea1.idea_name);
  check("buildConversionPreview maps urgency Medium → Medium", preview.priority === "Medium");
  check(
    "buildConversionPreview splits stakeholders to array",
    preview.primary_stakeholders.length === 2 &&
      preview.primary_stakeholders[0] === "Support" &&
      preview.primary_stakeholders[1] === "Product",
  );
  check(
    "buildConversionPreview preserves target date",
    preview.target_date === "2026-09-01",
  );

  const result = await convertIdeaToProject(
    idea1.idea_id,
    {
      name: preview.name,
      description: preview.description,
      application_product: "Customer Portal",
      project_type: "New Feature",
      priority: preview.priority,
      status: preview.status,
      phase: preview.phase,
      primary_stakeholders: preview.primary_stakeholders,
      project_lead: admin.user_id,
      additional_resources: [],
      target_date: preview.target_date,
      custom_fields: {},
      dependencies: [],
      document_links: [],
    },
    { createdBy: admin.user_id },
  );

  check("convertIdeaToProject returns a project", result.project.project_id);
  check(
    "convertIdeaToProject project_id matches YYYY-NNN format",
    /^\d{4}-\d{3}$/.test(result.project.project_id),
  );
  check("convertIdeaToProject sets idea status Converted", result.idea.status === "Converted");
  check(
    "convertIdeaToProject back-links project_id to idea",
    result.idea.converted_to_project_id === result.project.project_id,
  );

  // Verify the project actually persisted.
  const persisted = await ProjectRepository.getById(result.project.project_id);
  check("project persisted in repository", persisted !== null);
  check("project description matches idea description", persisted!.description === idea1.description);
  check(
    "project primary_stakeholders comes from idea split",
    persisted!.primary_stakeholders.length === 2,
  );

  // Cannot convert an already-converted idea.
  await expectThrows(
    "convertIdeaToProject refuses already-converted idea",
    () =>
      convertIdeaToProject(
        idea1.idea_id,
        {
          name: "x",
          description: "y",
          application_product: "z",
          project_type: "New Feature",
          priority: "Low",
          status: "Not Started",
          phase: "Qualification",
          primary_stakeholders: [],
          project_lead: admin.user_id,
          additional_resources: [],
          target_date: null,
          custom_fields: {},
          dependencies: [],
          document_links: [],
        },
        { createdBy: admin.user_id },
      ),
    (e) => e instanceof ConflictError,
  );

  // updateIdea also refuses on Converted.
  await expectThrows(
    "updateIdea refuses edits to Converted idea",
    () => updateIdea(idea1.idea_id, { admin_comments: "late edit" }),
    (e) => e instanceof ConflictError,
  );

  // ---- AI overlap analysis (Step-10 fallback) -----------------------------

  console.log("\nAI overlap analysis (Step-10 fallback)");

  // Submit a fresh idea that should overlap with the just-created project.
  const overlapIdea = await submitIdea({
    submitter_name: "Sam",
    idea_name: "Customer dashboard for health signals",
    description:
      "Build a customer-facing dashboard showing customer health at a glance.",
    urgency: "Medium",
  });

  const overlap = await aiOverlapAnalysis(overlapIdea.idea_id);
  check(
    "aiOverlapAnalysis labels itself as not-yet-AI",
    overlap.source === "heuristic",
  );
  check(
    "aiOverlapAnalysis mentions Step 10 in the analysis",
    overlap.analysis.toLowerCase().includes("step 10"),
  );
  check(
    "aiOverlapAnalysis surfaces the converted project as an overlap",
    overlap.analysis.includes(result.project.project_id),
  );

  const cached = await IdeaRepository.getById(overlapIdea.idea_id);
  check(
    "aiOverlapAnalysis caches result on the idea",
    cached!.ai_overlap_analysis === overlap.analysis,
  );

  // Empty-description case still returns a usable structured result.
  const tinyIdea = await submitIdea({
    submitter_name: "Sam",
    idea_name: "x",
    description: "y",
    urgency: "Low",
  });
  const tinyOverlap = await aiOverlapAnalysis(tinyIdea.idea_id);
  check(
    "aiOverlapAnalysis handles short text gracefully",
    tinyOverlap.source === "heuristic",
  );

  // NotFound on bogus id.
  await expectThrows(
    "aiOverlapAnalysis throws on unknown idea id",
    () => aiOverlapAnalysis("does-not-exist"),
    (e) => e instanceof NotFoundError,
  );

  // ---- listIdeas / getIdea -----------------------------------------------

  console.log("\nlistIdeas / getIdea");

  const all = await listIdeas();
  check("listIdeas returns every idea", all.length >= 4);
  check(
    "listIdeas sorts newest first",
    all[0].submitted_at >= all[all.length - 1].submitted_at,
  );

  const onlyNew = await listIdeas({ status: "New" });
  check("listIdeas filters by status", onlyNew.every((i) => i.status === "New"));

  const fetched = await getIdea(idea1.idea_id);
  check("getIdea returns the converted idea", fetched.idea_id === idea1.idea_id);

  // ---- Rate limiter -------------------------------------------------------

  console.log("\nRate limiter");

  __resetRateLimitForTests();

  const opts = { max: 3, windowMs: 60_000 };
  const r1 = checkRateLimit("ip:test", opts);
  const r2 = checkRateLimit("ip:test", opts);
  const r3 = checkRateLimit("ip:test", opts);
  check("first three requests allowed", r1.allowed && r2.allowed && r3.allowed);
  check("remaining counts down: 2, 1, 0", r1.remaining === 2 && r2.remaining === 1 && r3.remaining === 0);

  const r4 = checkRateLimit("ip:test", opts);
  check("fourth request rejected", !r4.allowed);
  check("retryAfterSec is positive on rejection", r4.retryAfterSec > 0);

  // Different key has its own bucket.
  const otherKey = checkRateLimit("ip:other", opts);
  check("different key has its own bucket", otherKey.allowed && otherKey.remaining === 2);

  // Window rollover (simulated by short window + sleep).
  __resetRateLimitForTests();
  const shortOpts = { max: 1, windowMs: 50 };
  checkRateLimit("ip:short", shortOpts); // consume
  const blocked = checkRateLimit("ip:short", shortOpts);
  check("short-window cap enforced", !blocked.allowed);
  await new Promise((r) => setTimeout(r, 75));
  const reopened = checkRateLimit("ip:short", shortOpts);
  check("window resets after windowMs elapses", reopened.allowed);

  // ---- Done ---------------------------------------------------------------

  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
