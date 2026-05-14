/**
 * Functional smoke test for the task and template service layers.
 *
 * Mirrors the Step 3 pattern in `scripts/smoke-projects.ts`: a fresh temp
 * directory is created and pointed at via `IIM_DATA_DIR`, then services
 * are dynamically imported so they pick up the override before the JSON
 * store caches paths.
 *
 * Coverage:
 *   - createTask:        required fields, parent project must exist, enum validation
 *   - updateTask:        cross-field consistency (status->Blocked auto-flips boolean)
 *   - deleteTask:        404 on missing
 *   - createTemplate:    requires at least one valid task
 *   - updateTemplate:    full replace; preserves created_by
 *   - instantiateTemplate:  fans out to N tasks, stamps template_id, defaults
 *                           responsible to project_lead
 *
 * Run with:
 *   npx tsx scripts/smoke-tasks.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync, writeFileSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-tasks-smoke-"));
process.env.IIM_DATA_DIR = scratch;

function assert(cond: unknown, msg: string): void {
  if (!cond) {
    console.error("FAIL:", msg);
    cleanup();
    process.exit(1);
  }
}

function cleanup() {
  try {
    rmSync(scratch, { recursive: true, force: true });
  } catch {
    /* ignore */
  }
}

async function main() {
  // Seed a project so tasks have a parent. We write directly to projects.json
  // rather than going through ProjectRepository.create — the goal here is to
  // test task/template logic, not project logic.
  const projectsPath = path.join(scratch, "projects.json");
  const settingsPath = path.join(scratch, "settings.json");
  mkdirSync(scratch, { recursive: true });
  writeFileSync(
    projectsPath,
    JSON.stringify([
      {
        project_id: "2026-001",
        name: "Smoke Project",
        description: "for service smoke tests",
        application_product: "Test",
        project_type: "New Feature",
        priority: "Medium",
        status: "Not Started",
        phase: "Qualification",
        primary_stakeholders: [],
        project_lead: "lead-user-id",
        additional_resources: [],
        date_added: "2026-04-27T00:00:00.000Z",
        target_date: null,
        roadmap_bucket: "",
        roadmap_timeline_start: null,
        ai_complexity_score: null,
        ai_time_estimate: null,
        custom_fields: {},
        last_updated: "2026-04-27T00:00:00.000Z",
        last_updated_by: "smoke",
        created_by: "smoke",
      },
    ]),
  );
  // Settings for next-id generators if the repos peek at them.
  writeFileSync(
    settingsPath,
    JSON.stringify({
      custom_field_definitions: [],
      next_project_seq: 2,
      next_task_seq: 1,
    }),
  );

  const {
    ValidationError,
    NotFoundError,
    createTask,
    updateTask,
    deleteTask,
    instantiateTemplate,
  } = await import("../lib/tasks/service");
  const {
    ValidationError: TplValidationError,
    createTemplate,
    updateTemplate,
    deleteTemplate,
  } = await import("../lib/tasks/template-service");

  // ---- 1. createTask happy path ----
  const t1 = await createTask(
    {
      project_id: "2026-001",
      task_name: "Smoke task 1",
      detailed_description: "",
      status: "Not Started",
      priority: "Medium",
      responsible: "alice",
      additional_assignees: [],
      target_date: null,
      blocked: false,
      blocker_issue_task: "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
    },
    { createdBy: "smoke" },
  );
  assert(typeof t1.task_id === "string" && t1.task_id.length > 0, "task_id assigned");
  assert(t1.project_id === "2026-001", "task carries project_id");
  console.log("OK: createTask", t1.task_id);

  // ---- 2. createTask rejects missing parent ----
  let rejected = false;
  try {
    await createTask(
      {
        project_id: "9999-999",
        task_name: "x",
        status: "Not Started",
        priority: "Low",
        additional_assignees: [],
        target_date: null,
        blocked: false,
        blocker_issue_task: "",
        blocker_type: null,
        blocker_task_id: null,
        blocker_project_id: null,
        comments: "",
        detailed_description: "",
        responsible: "",
      },
      { createdBy: "smoke" },
    );
  } catch (e) {
    rejected = e instanceof ValidationError;
  }
  assert(rejected, "createTask rejects unknown project_id with ValidationError");
  console.log("OK: createTask rejects unknown project_id");

  // ---- 3. updateTask: status->Blocked auto-sets blocked boolean ----
  const t1b = await updateTask(t1.task_id, { status: "Blocked" });
  assert(t1b.status === "Blocked", "status set to Blocked");
  assert(t1b.blocked === true, "blocked boolean auto-flipped to true");
  console.log("OK: status=Blocked auto-flips blocked");

  // ---- 4. updateTask: rename ----
  const t1c = await updateTask(t1.task_id, { task_name: "Smoke task renamed" });
  assert(t1c.task_name === "Smoke task renamed", "rename persisted");
  console.log("OK: rename persisted");

  // ---- 5. updateTask: enum validation ----
  rejected = false;
  try {
    await updateTask(t1.task_id, { priority: "Whatever" as unknown });
  } catch (e) {
    rejected = e instanceof ValidationError;
  }
  assert(rejected, "updateTask rejects bad priority");
  console.log("OK: updateTask rejects bad priority");

  // ---- 6. deleteTask: 404 on missing ----
  rejected = false;
  try {
    await deleteTask("99-9999");
  } catch (e) {
    rejected = e instanceof NotFoundError;
  }
  assert(rejected, "deleteTask raises NotFoundError on missing id");
  console.log("OK: deleteTask 404");

  // ---- 7. createTemplate happy path ----
  const tpl = await createTemplate(
    {
      template_name: "Standard Feature",
      project_type: "New Feature",
      tasks: [
        { name: "Discovery", description: "kickoff", default_priority: "High" },
        { name: "Build", description: "", default_priority: "Medium" },
        { name: "Launch", description: "", default_priority: "Critical" },
      ],
    },
    { createdBy: "admin-id" },
  );
  assert(tpl.tasks.length === 3, "template has 3 tasks");
  assert(tpl.created_by === "admin-id", "template stamps created_by");
  console.log("OK: createTemplate", tpl.template_id);

  // ---- 8. createTemplate rejects empty task list ----
  rejected = false;
  try {
    await createTemplate(
      {
        template_name: "Empty",
        project_type: "New Feature",
        tasks: [],
      },
      { createdBy: "admin-id" },
    );
  } catch (e) {
    rejected = e instanceof TplValidationError;
  }
  assert(rejected, "createTemplate rejects empty tasks");
  console.log("OK: createTemplate rejects empty");

  // ---- 9. updateTemplate replaces contents but preserves created_by ----
  const tpl2 = await updateTemplate(tpl.template_id, {
    template_name: "Standard Feature v2",
    project_type: "New Feature",
    tasks: [{ name: "OnlyOne", description: "", default_priority: "Low" }],
  });
  assert(tpl2.template_name === "Standard Feature v2", "template renamed");
  assert(tpl2.tasks.length === 1, "template tasks replaced");
  assert(tpl2.created_by === "admin-id", "created_by preserved on update");
  console.log("OK: updateTemplate full replace");

  // ---- 10. instantiateTemplate creates one task per item ----
  const created = await instantiateTemplate(tpl2.template_id, "2026-001");
  assert(created.length === 1, "instantiated 1 task");
  assert(created[0].template_id === tpl2.template_id, "template_id stamped");
  assert(created[0].responsible === "lead-user-id", "responsible defaulted to project_lead");
  assert(created[0].priority === "Low", "priority carried from template item");
  console.log("OK: instantiateTemplate fans out");

  // ---- 11. instantiateTemplate sequential ID allocation (no collisions) ----
  const tplBig = await createTemplate(
    {
      template_name: "Big",
      project_type: "New Feature",
      tasks: [
        { name: "A", description: "", default_priority: "Medium" },
        { name: "B", description: "", default_priority: "Medium" },
        { name: "C", description: "", default_priority: "Medium" },
        { name: "D", description: "", default_priority: "Medium" },
        { name: "E", description: "", default_priority: "Medium" },
      ],
    },
    { createdBy: "admin-id" },
  );
  const big = await instantiateTemplate(tplBig.template_id, "2026-001");
  const ids = new Set(big.map((t) => t.task_id));
  assert(ids.size === 5, "5 unique task IDs from sequential instantiation");
  console.log("OK: instantiateTemplate produces unique IDs");

  // ---- 12. deleteTemplate ----
  await deleteTemplate(tpl2.template_id);
  await deleteTemplate(tplBig.template_id);
  console.log("OK: deleteTemplate");

  // Final cleanup of the test task too
  await deleteTask(t1.task_id);
  for (const t of big) await deleteTask(t.task_id);
  for (const c of created) await deleteTask(c.task_id);
  console.log("OK: cleanup");

  // ---- estimate_hours ----
  // Field is optional and validated. Six scenarios:
  //   (a) create with valid hours persists
  //   (b) create with no field → null (default)
  //   (c) create with empty string → null
  //   (d) create with negative → ValidationError
  //   (e) create with > 999 → ValidationError
  //   (f) update sets, then update clears
  console.log("\nestimate_hours");

  const baseTaskInput = {
    project_id: "2026-001",
    task_name: "Estimate test",
    detailed_description: "",
    status: "Not Started" as const,
    priority: "Medium" as const,
    responsible: "alice",
    additional_assignees: [],
    target_date: null,
    blocked: false,
    blocker_issue_task: "",
    blocker_type: null,
    blocker_task_id: null,
    blocker_project_id: null,
    comments: "",
  };

  // (a) create with valid hours
  const ea = await createTask(
    { ...baseTaskInput, task_name: "Est-A", estimate_hours: 1.5 },
    { createdBy: "smoke" },
  );
  assert(ea.estimate_hours === 1.5, "create persists fractional estimate");
  console.log("  ok  create with valid hours persists 1.5");

  // (b) create with no field → null
  const eb = await createTask(
    { ...baseTaskInput, task_name: "Est-B" },
    { createdBy: "smoke" },
  );
  assert(eb.estimate_hours === null, "missing estimate_hours defaults to null");
  console.log("  ok  missing field defaults to null");

  // (c) create with empty string → null (form's empty input case)
  const ec = await createTask(
    { ...baseTaskInput, task_name: "Est-C", estimate_hours: "" as any },
    { createdBy: "smoke" },
  );
  assert(ec.estimate_hours === null, "empty string serializes to null");
  console.log("  ok  empty string → null");

  // (d) create with negative
  let negativeRejected = false;
  try {
    await createTask(
      { ...baseTaskInput, task_name: "Est-D", estimate_hours: -1 },
      { createdBy: "smoke" },
    );
  } catch {
    negativeRejected = true;
  }
  assert(negativeRejected, "negative estimate rejected");
  console.log("  ok  negative rejected");

  // (e) create with > 999
  let oversizedRejected = false;
  try {
    await createTask(
      { ...baseTaskInput, task_name: "Est-E", estimate_hours: 1000 },
      { createdBy: "smoke" },
    );
  } catch {
    oversizedRejected = true;
  }
  assert(oversizedRejected, "estimate > 999 rejected");
  console.log("  ok  > 999 rejected");

  // (f) update sets then clears
  const ef = await createTask(
    { ...baseTaskInput, task_name: "Est-F" },
    { createdBy: "smoke" },
  );
  const efSet = await updateTask(ef.task_id, { estimate_hours: 4.25 });
  assert(efSet.estimate_hours === 4.25, "update sets estimate");
  const efCleared = await updateTask(ef.task_id, { estimate_hours: "" });
  assert(efCleared.estimate_hours === null, "update with empty string clears");
  console.log("  ok  update sets and clears");

  // Cleanup the estimate test tasks
  for (const t of [ea, eb, ec, ef]) await deleteTask(t.task_id);

  console.log("\nAll smoke tests passed.");
}

main()
  .then(() => cleanup())
  .catch((e) => {
    console.error("Unhandled error in smoke test:", e);
    cleanup();
    process.exit(1);
  });
