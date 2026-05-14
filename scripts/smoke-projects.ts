/**
 * Functional smoke test for the project service layer.
 *
 * Exercises the validation and orchestration paths in
 * `lib/projects/service.ts` against a fresh temp directory. The repository
 * layer has its own coverage in `smoke-db.ts`; this test focuses on the
 * service-layer behavior added in Step 3:
 *
 *   - createProject: required-field enforcement, enum validation, ID generation
 *   - updateProject: sparse patches (the inline-status-update path)
 *   - custom field validation against settings.custom_field_definitions
 *
 * Run with:
 *   npx tsx scripts/smoke-projects.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-projects-smoke-"));
process.env.IIM_DATA_DIR = scratch;

async function main() {
  const {
    ValidationError,
    createProject,
    updateProject,
    deleteProject,
  } = await import("../lib/projects/service");
  const { ProjectRepository, SettingsRepository } = await import("../lib/db");

  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    console.log(`  ok  ${label}`);
  }

  async function expectThrows(
    label: string,
    fn: () => Promise<unknown>,
    matcher?: (err: unknown) => boolean,
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      if (!matcher || matcher(err)) {
        console.log(`  ok  ${label}`);
        return;
      }
      console.error(`FAIL: ${label} — wrong error: ${(err as Error).message}`);
      process.exit(1);
    }
    console.error(`FAIL: ${label} — expected to throw`);
    process.exit(1);
  }

  const userId = "user-1";

  // -------------------------------------------------------------------------
  // createProject — happy path
  // -------------------------------------------------------------------------

  console.log("createProject");
  const created = await createProject(
    {
      name: "Test Project",
      description: "A description.",
      application_product: "Automated Insights",
      project_type: "New Feature",
      priority: "High",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: ["Alice", "Bob"],
      project_lead: "Carol",
      additional_resources: ["Dave"],
      target_date: "2026-12-31",
    },
    { createdBy: userId },
  );
  check("project_id assigned", typeof created.project_id === "string");
  check("project_id format", /^\d{4}-\d{3}$/.test(created.project_id));
  check("name persisted", created.name === "Test Project");
  check("created_by set", created.created_by === userId);
  check(
    "primary_stakeholders preserved",
    JSON.stringify(created.primary_stakeholders) ===
      JSON.stringify(["Alice", "Bob"]),
  );
  check("ai fields default null", created.ai_complexity_score === null);
  check("dependencies empty", created.depends_on.length === 0);
  check("custom_fields empty by default", Object.keys(created.custom_fields).length === 0);

  // -------------------------------------------------------------------------
  // createProject — validation failures
  // -------------------------------------------------------------------------

  console.log("createProject — validation");

  await expectThrows(
    "rejects missing name",
    () =>
      createProject(
        {
          name: "",
          description: "x",
          application_product: "x",
          project_type: "New Feature",
          priority: "High",
          status: "Not Started",
          phase: "Qualification",
        },
        { createdBy: userId },
      ),
    (err) => err instanceof ValidationError,
  );

  await expectThrows(
    "rejects unknown enum value",
    () =>
      createProject(
        {
          name: "x",
          application_product: "y",
          project_type: "Bogus",
          priority: "High",
          status: "Not Started",
          phase: "Qualification",
        },
        { createdBy: userId },
      ),
    (err) => err instanceof ValidationError,
  );

  await expectThrows(
    "rejects malformed target_date",
    () =>
      createProject(
        {
          name: "x",
          application_product: "y",
          project_type: "New Feature",
          priority: "High",
          status: "Not Started",
          phase: "Qualification",
          target_date: "not-a-date",
        },
        { createdBy: userId },
      ),
    (err) => err instanceof ValidationError,
  );

  // -------------------------------------------------------------------------
  // updateProject — sparse patch (inline status edit)
  // -------------------------------------------------------------------------

  console.log("updateProject");
  const statusOnly = await updateProject(created.project_id, {
    status: "In Progress",
  });
  check("status updated", statusOnly.status === "In Progress");
  check("name preserved across patch", statusOnly.name === "Test Project");
  check(
    "created_by preserved across patch",
    statusOnly.created_by === userId,
  );

  const renamed = await updateProject(created.project_id, {
    name: "Renamed Project",
    priority: "Critical",
  });
  check("rename applied", renamed.name === "Renamed Project");
  check("priority changed", renamed.priority === "Critical");
  check("status survived second patch", renamed.status === "In Progress");

  await expectThrows(
    "update rejects empty name",
    () => updateProject(created.project_id, { name: "  " }),
    (err) => err instanceof ValidationError,
  );

  // -------------------------------------------------------------------------
  // Custom fields
  // -------------------------------------------------------------------------

  console.log("custom fields");

  await SettingsRepository.update({
    custom_field_definitions: [
      { key: "business_unit", label: "Business Unit", type: "text" },
      {
        key: "complexity",
        label: "Complexity",
        type: "select",
        options: ["S", "M", "L"],
        required: true,
      },
      { key: "estimated_users", label: "Estimated Users", type: "number" },
    ],
  });

  const withCustom = await createProject(
    {
      name: "Custom Field Project",
      application_product: "Topic AI",
      project_type: "Enhancement",
      priority: "Medium",
      status: "In Planning",
      phase: "Planning",
      custom_fields: {
        business_unit: "Retail",
        complexity: "M",
        estimated_users: 250,
        rogue_key: "should be dropped",
      },
    },
    { createdBy: userId },
  );
  check(
    "custom field text persisted",
    withCustom.custom_fields.business_unit === "Retail",
  );
  check(
    "custom field select persisted",
    withCustom.custom_fields.complexity === "M",
  );
  check(
    "custom field number persisted as number",
    withCustom.custom_fields.estimated_users === 250,
  );
  check(
    "unknown custom field key dropped",
    !("rogue_key" in withCustom.custom_fields),
  );

  await expectThrows(
    "rejects missing required custom field",
    () =>
      createProject(
        {
          name: "Missing required",
          application_product: "Topic AI",
          project_type: "Enhancement",
          priority: "Medium",
          status: "In Planning",
          phase: "Planning",
          custom_fields: { business_unit: "Retail" },
        },
        { createdBy: userId },
      ),
    (err) => err instanceof ValidationError,
  );

  await expectThrows(
    "rejects out-of-range select option",
    () =>
      createProject(
        {
          name: "Bad select",
          application_product: "Topic AI",
          project_type: "Enhancement",
          priority: "Medium",
          status: "In Planning",
          phase: "Planning",
          custom_fields: { complexity: "XXL" },
        },
        { createdBy: userId },
      ),
    (err) => err instanceof ValidationError,
  );

  // -------------------------------------------------------------------------
  // Delete (basic)
  // -------------------------------------------------------------------------

  console.log("deleteProject");
  await deleteProject(created.project_id);
  const afterDelete = await ProjectRepository.getById(created.project_id);
  check("project removed", afterDelete === null);

  // -------------------------------------------------------------------------
  // Custom field filter matcher (used by table + export endpoint)
  // -------------------------------------------------------------------------

  console.log("customFieldMatches");
  const { customFieldMatches } = await import(
    "../lib/projects/custom-filter"
  );
  const settings = await SettingsRepository.get();
  const cfDefs = settings.custom_field_definitions;
  const buDef = cfDefs.find((d) => d.key === "business_unit");
  const cxDef = cfDefs.find((d) => d.key === "complexity");
  const usersDef = cfDefs.find((d) => d.key === "estimated_users");
  if (!buDef || !cxDef || !usersDef) {
    console.error("FAIL: expected seeded custom field defs not found");
    process.exit(1);
  }
  // `withCustom` is in scope from the create-with-custom-fields test above.
  check(
    "text filter matches substring",
    customFieldMatches(withCustom, buDef, { text: "tail" }) === true,
  );
  check(
    "text filter rejects non-match",
    customFieldMatches(withCustom, buDef, { text: "Wholesale" }) === false,
  );
  check(
    "select filter matches selected value",
    customFieldMatches(withCustom, cxDef, { values: ["S", "M"] }) === true,
  );
  check(
    "select filter rejects unselected",
    customFieldMatches(withCustom, cxDef, { values: ["L"] }) === false,
  );
  check(
    "number filter matches in-range",
    customFieldMatches(withCustom, usersDef, { min: "100", max: "500" }) === true,
  );
  check(
    "number filter rejects out-of-range",
    customFieldMatches(withCustom, usersDef, { min: "300" }) === false,
  );
  check(
    "empty filter is no-op (passes)",
    customFieldMatches(withCustom, buDef, {}) === true,
  );
  check(
    "undefined filter passes",
    customFieldMatches(withCustom, buDef, undefined) === true,
  );

  // -------------------------------------------------------------------------
  // Start date — auto-set on status transition + validation
  // -------------------------------------------------------------------------

  console.log("\nstart date");

  // Helper: today's ISO date (matches the service's todayIso()).
  const todayIso = () => new Date().toISOString().slice(0, 10);

  // (a) Not Started → In Progress sets start to today when null.
  const a = await createProject(
    {
      name: "Auto-set A",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: null,
    },
    { createdBy: userId },
  );
  check("created with null start_date", a.roadmap_timeline_start === null);
  const aUpdated = await updateProject(
    a.project_id,
    { status: "In Progress" },
    { userId },
  );
  check(
    "Not Started -> In Progress auto-sets start to today",
    aUpdated.roadmap_timeline_start === todayIso(),
  );

  // (b) Not Started → In Progress does NOT overwrite a user-set start.
  const userStart = "2026-01-15";
  const b = await createProject(
    {
      name: "Auto-set B",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: null,
      roadmap_timeline_start: userStart,
    },
    { createdBy: userId },
  );
  check(
    "user-set start_date persisted on create",
    b.roadmap_timeline_start === userStart,
  );
  const bUpdated = await updateProject(
    b.project_id,
    { status: "In Progress" },
    { userId },
  );
  check(
    "user-set start NOT overwritten on transition",
    bUpdated.roadmap_timeline_start === userStart,
  );

  // (c) Not Started → In Planning does NOT auto-set (planning is pre-work).
  const c = await createProject(
    {
      name: "Auto-set C",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: null,
    },
    { createdBy: userId },
  );
  const cUpdated = await updateProject(
    c.project_id,
    { status: "In Planning" },
    { userId },
  );
  check(
    "Not Started -> In Planning does NOT auto-set start",
    cUpdated.roadmap_timeline_start === null,
  );

  // (d) Not Started → On Hold does NOT auto-set.
  const d = await createProject(
    {
      name: "Auto-set D",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: null,
    },
    { createdBy: userId },
  );
  const dUpdated = await updateProject(
    d.project_id,
    { status: "On Hold" },
    { userId },
  );
  check(
    "Not Started -> On Hold does NOT auto-set start",
    dUpdated.roadmap_timeline_start === null,
  );

  // (e) start > target rejected with ValidationError.
  const e = await createProject(
    {
      name: "Auto-set E",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: "2026-06-01",
    },
    { createdBy: userId },
  );
  await expectThrows("start after target rejected", () =>
    updateProject(
      e.project_id,
      { roadmap_timeline_start: "2026-12-01" },
      { userId },
    ),
  );
  // Same invariant on create.
  await expectThrows("start after target rejected on create", () =>
    createProject(
      {
        name: "Bad Start E2",
        description: "",
        application_product: "Test App",
        project_type: "New Feature",
        priority: "Medium",
        status: "Not Started",
        phase: "Qualification",
        primary_stakeholders: [],
        project_lead: "Lead",
        additional_resources: [],
        target_date: "2026-06-01",
        roadmap_timeline_start: "2026-09-01",
      },
      { createdBy: userId },
    ),
  );

  // (f) Explicit start in same patch as status change wins over auto-set.
  const f = await createProject(
    {
      name: "Auto-set F",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: null,
    },
    { createdBy: userId },
  );
  const explicitStart = "2026-03-15";
  const fUpdated = await updateProject(
    f.project_id,
    { status: "In Progress", roadmap_timeline_start: explicitStart },
    { userId },
  );
  check(
    "explicit start in patch wins over auto-set",
    fUpdated.roadmap_timeline_start === explicitStart,
  );

  // (g) Re-entry: Not Started -> In Progress -> Not Started -> In Progress
  // does NOT re-auto-set on the second transition (field already set).
  const g = await createProject(
    {
      name: "Auto-set G",
      description: "",
      application_product: "Test App",
      project_type: "New Feature",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: "Lead",
      additional_resources: [],
      target_date: null,
    },
    { createdBy: userId },
  );
  const g1 = await updateProject(
    g.project_id,
    { status: "In Progress" },
    { userId },
  );
  const firstStart = g1.roadmap_timeline_start;
  await updateProject(g.project_id, { status: "Not Started" }, { userId });
  const g2 = await updateProject(
    g.project_id,
    { status: "In Progress" },
    { userId },
  );
  check(
    "re-entry preserves original start (no second auto-set)",
    g2.roadmap_timeline_start === firstStart,
  );

  console.log("\nAll project service smoke checks passed.");
}

main()
  .catch((err) => {
    console.error("Smoke test crashed:", err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
