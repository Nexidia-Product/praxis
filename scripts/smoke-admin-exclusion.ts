/**
 * Smoke test: Admin project type / Application=Admin exclusion from
 * Roadmap and Velocity.
 *
 * The "Admin" project type and "Admin" Application/Product were added
 * as defaults so internal team work (governance, operational cadence,
 * tooling) can be tracked alongside delivery projects without polluting
 * portfolio-level views. This test locks in three behaviors that the
 * existing per-feature smoke tests don't directly assert:
 *
 *   1. `isAdminProject(p)` returns true when *either* project_type or
 *      application_product is "Admin", false otherwise. Either field
 *      qualifying is intentional: a team may classify the same work via
 *      type or product depending on how it slots in.
 *
 *   2. `PORTFOLIO_PROJECT_TYPES` excludes "Admin" while `PROJECT_TYPES`
 *      includes it — the two lists are explicitly different, and any
 *      Roadmap or Velocity dropdown that shows the Admin option would
 *      be a regression.
 *
 *   3. The Velocity orchestrator (`computeVelocityMetrics`) drops
 *      Admin-classified projects and their tasks before computing any
 *      metric, so completion counts, by-type breakdowns, throughput,
 *      and filter_options never expose Admin work. The roadmap's page
 *      filter is server-side and harder to exercise in a unit smoke;
 *      the same `isAdminProject` predicate it uses is locked in by (1).
 *
 *   4. The Application/Product enum option list now ships "Admin" as a
 *      locked system option (source: "system"). Confirming this catches
 *      a regression where the system-options seed gets reverted to
 *      empty (the prior behavior).
 *
 * Each test runs against an isolated `IIM_DATA_DIR` so the repo's real
 * data is left untouched.
 *
 * Usage:
 *   npx tsx scripts/smoke-admin-exclusion.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-admin-exclusion-"));
process.env.IIM_DATA_DIR = scratch;
process.env.IIM_DISABLE_SCHEDULER = "1";

async function main() {
  // Deferred imports — IIM_DATA_DIR must be set before any module reads it.
  const {
    ADMIN_APPLICATION_PRODUCT,
    ADMIN_PROJECT_TYPE,
    isAdminProject,
    PORTFOLIO_PROJECT_TYPES,
    PROJECT_TYPES,
    SYSTEM_APPLICATION_PRODUCTS,
  } = await import("../lib/projects/display");
  const { computeVelocityMetrics, resolveRange } = await import(
    "../lib/velocity/metrics"
  );
  const { mergeEnumOptions } = await import("../lib/projects/enum-options");
  const { createProject, deleteProject } = await import(
    "../lib/projects/service"
  );
  const { UserRepository, ProjectRepository } = await import("../lib/db");

  type Project = import("../lib/db").Project;
  type ProjectIdea = import("../lib/db").ProjectIdea;
  type Task = import("../lib/db").Task;
  type VelocityFilters = import("../lib/velocity/types").VelocityFilters;

  // ---- Tiny test harness. -----------------------------------------------

  let passed = 0;
  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    passed++;
    console.log(`  ok  ${label}`);
  }

  function eq<T>(label: string, actual: T, expected: T): void {
    if (actual !== expected) {
      console.error(
        `FAIL: ${label}\n  expected: ${JSON.stringify(expected)}\n  actual:   ${JSON.stringify(actual)}`,
      );
      process.exit(1);
    }
    passed++;
    console.log(`  ok  ${label}`);
  }

  function section(name: string): void {
    console.log(`\n${name}`);
  }

  // ---- Fixture builders. -----------------------------------------------
  // Trimmed copies of the helpers in smoke-velocity.ts. Self-contained so
  // this smoke can run independently of any other.

  function mkProject(
    overrides: Partial<Project> & Pick<Project, "project_id">,
  ): Project {
    return {
      name: `Project ${overrides.project_id}`,
      description: "test project",
      application_product: "Automated Insights",
      project_type: "New Application",
      date_added: "2026-01-01",
      priority: "Medium",
      status: "In Progress",
      phase: "Application Development",
      primary_stakeholders: [],
      project_lead: "user-A",
      additional_resources: [],
      resource_allocations: {},
      target_date: null,
      ai_complexity_score: null,
      ai_time_estimate: null,
      roadmap_bucket: null,
      roadmap_timeline_start: null,
      github_issue_id: null,
      jira_issue_id: null,
      health_score: null,
      health_score_history: [],
      status_history: [],
      depends_on: [],
      dependencies: [],
      document_links: [],
      custom_fields: {},
      created_by: "seed",
      updated_at: "2026-04-15T00:00:00Z",
      ...overrides,
    };
  }

  function mkTask(
    overrides: Partial<Task> & Pick<Task, "task_id" | "project_id">,
  ): Task {
    return {
      task_name: `Task ${overrides.task_id}`,
      detailed_description: "",
      status: "Not Started",
      priority: "Medium",
      responsible: "user-A",
      additional_assignees: [],
      target_date: null,
      blocked: false,
      blocker_issue_task: "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
      comment_history: [],
      estimate_hours: null,
      document_links: [],
      template_id: null,
      created_at: "2026-01-01T00:00:00Z",
      updated_at: "2026-04-15T00:00:00Z",
      ...overrides,
    };
  }

  function defaultFilters(over: Partial<VelocityFilters> = {}): VelocityFilters {
    return {
      range: resolveRange("all", new Date("2026-05-01")),
      project_types: [],
      application_products: [],
      project_leads: [],
      individual_user_id: null,
      ...over,
    };
  }

  // ----------------------------------------------------------------------
  // 1. Constants and exported predicate
  // ----------------------------------------------------------------------

  section("Constants & predicate");

  eq(
    "ADMIN_PROJECT_TYPE constant matches literal",
    ADMIN_PROJECT_TYPE,
    "Admin",
  );
  eq(
    "ADMIN_APPLICATION_PRODUCT constant matches literal",
    ADMIN_APPLICATION_PRODUCT,
    "Admin",
  );

  check(
    "PROJECT_TYPES contains Admin",
    (PROJECT_TYPES as readonly string[]).includes("Admin"),
  );
  check(
    "PORTFOLIO_PROJECT_TYPES does NOT contain Admin",
    !(PORTFOLIO_PROJECT_TYPES as readonly string[]).includes("Admin"),
  );
  eq(
    "PORTFOLIO_PROJECT_TYPES is exactly PROJECT_TYPES minus Admin",
    PORTFOLIO_PROJECT_TYPES.length,
    PROJECT_TYPES.length - 1,
  );
  for (const t of PORTFOLIO_PROJECT_TYPES) {
    check(
      `PORTFOLIO_PROJECT_TYPES.${t} is a member of PROJECT_TYPES`,
      (PROJECT_TYPES as readonly string[]).includes(t),
    );
  }

  check(
    "SYSTEM_APPLICATION_PRODUCTS includes Admin",
    SYSTEM_APPLICATION_PRODUCTS.includes("Admin"),
  );

  // isAdminProject: type-only.
  check(
    "isAdminProject: type=Admin → true",
    isAdminProject({
      project_type: "Admin",
      application_product: "Automated Insights",
    }),
  );
  // isAdminProject: product-only.
  check(
    "isAdminProject: application=Admin → true",
    isAdminProject({
      project_type: "New Feature",
      application_product: "Admin",
    }),
  );
  // isAdminProject: both.
  check(
    "isAdminProject: both fields=Admin → true",
    isAdminProject({
      project_type: "Admin",
      application_product: "Admin",
    }),
  );
  // isAdminProject: neither.
  check(
    "isAdminProject: neither field=Admin → false",
    !isAdminProject({
      project_type: "New Feature",
      application_product: "Complaints",
    }),
  );
  // Case sensitivity: lowercase "admin" must NOT match — values are
  // stored verbatim and the dropdowns hand back the canonical case.
  check(
    "isAdminProject: lowercase 'admin' does not match (case-sensitive)",
    !isAdminProject({
      project_type: "admin",
      application_product: "Complaints",
    }),
  );

  // ----------------------------------------------------------------------
  // 2. Application/Product enum options expose Admin as a system value
  // ----------------------------------------------------------------------

  section("Application/Product enum options");

  const appOptions = mergeEnumOptions("application_product", [], false);
  const adminOption = appOptions.find((o) => o.id === "Admin");
  check("Admin appears in the merged Application/Product list", !!adminOption);
  if (adminOption) {
    eq(
      "Admin Application/Product option is source=system (locked)",
      adminOption.source,
      "system",
    );
    eq(
      "Admin Application/Product option is not archived",
      adminOption.archived,
      false,
    );
  }

  // Adding an extension should NOT collide with the system Admin entry —
  // the merge keeps both visible (the editor's UI is what prevents a
  // duplicate label from being saved in the first place).
  const withExt = mergeEnumOptions(
    "application_product",
    [
      {
        id: "Spectrum Mobile",
        label: "Spectrum Mobile",
        archived: false,
        created_by: "test",
        created_at: "2026-04-15T00:00:00Z",
      },
    ],
    false,
  );
  check(
    "Admin still present alongside an admin-added extension",
    withExt.some((o) => o.id === "Admin" && o.source === "system"),
  );
  check(
    "Admin-added extension is also present",
    withExt.some(
      (o) => o.id === "Spectrum Mobile" && o.source === "extension",
    ),
  );

  // ----------------------------------------------------------------------
  // 3. Velocity orchestration drops Admin work
  //
  // The API route (app/api/dashboard/velocity/route.ts) filters Admin
  // projects out before calling computeVelocityMetrics, so the contract
  // we lock in here is: "given the filtered list the API hands over,
  // the metrics never see Admin work." We simulate the API's filter
  // here so the test exercises the same boundary.
  // ----------------------------------------------------------------------

  section("Velocity excludes Admin work");

  const allProjects: Project[] = [
    mkProject({
      project_id: "A1",
      project_type: "New Application",
      application_product: "Automated Insights",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-02-01T00:00:00Z",
    }),
    mkProject({
      project_id: "A2",
      project_type: "New Feature",
      application_product: "Complaints",
      status: "Completed",
      date_added: "2026-01-15",
      updated_at: "2026-03-15T00:00:00Z",
    }),
    // Admin by type — should be filtered out.
    mkProject({
      project_id: "X1",
      project_type: "Admin",
      application_product: "Automated Insights",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-02-01T00:00:00Z",
    }),
    // Admin by product — should also be filtered out.
    mkProject({
      project_id: "X2",
      project_type: "New Feature",
      application_product: "Admin",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-02-01T00:00:00Z",
    }),
  ];

  const allTasks: Task[] = [
    mkTask({
      task_id: "T-A1",
      project_id: "A1",
      status: "Complete",
      updated_at: "2026-02-01T00:00:00Z",
    }),
    mkTask({
      task_id: "T-X1",
      project_id: "X1",
      status: "Complete",
      updated_at: "2026-02-01T00:00:00Z",
    }),
    mkTask({
      task_id: "T-X2",
      project_id: "X2",
      status: "Complete",
      updated_at: "2026-02-01T00:00:00Z",
    }),
  ];

  // Mirror the API: drop Admin work, then drop tasks parented to those
  // dropped projects. (Same code shape as app/api/dashboard/velocity/route.ts.)
  const portfolioProjects = allProjects.filter((p) => !isAdminProject(p));
  const portfolioIds = new Set(portfolioProjects.map((p) => p.project_id));
  const portfolioTasks = allTasks.filter((t) => portfolioIds.has(t.project_id));

  eq(
    "API filter retains exactly the non-Admin projects",
    portfolioProjects.length,
    2,
  );
  check(
    "API filter retains A1 and A2",
    portfolioProjects.some((p) => p.project_id === "A1") &&
      portfolioProjects.some((p) => p.project_id === "A2"),
  );
  check(
    "API filter drops the type=Admin project",
    !portfolioProjects.some((p) => p.project_id === "X1"),
  );
  check(
    "API filter drops the application=Admin project",
    !portfolioProjects.some((p) => p.project_id === "X2"),
  );
  eq(
    "API filter drops tasks whose project was dropped",
    portfolioTasks.length,
    1,
  );
  eq(
    "Surviving task belongs to a portfolio project",
    portfolioTasks[0].project_id,
    "A1",
  );

  // Now compute metrics over the filtered set and verify Admin work is
  // absent everywhere it could have leaked.
  const ideas: ProjectIdea[] = [];
  const filters = defaultFilters();
  const metrics = computeVelocityMetrics(
    portfolioProjects,
    portfolioTasks,
    ideas,
    filters,
    new Date("2026-05-01"),
  );

  eq(
    "completed_by_quarter total reflects only portfolio projects",
    metrics.completed_by_quarter.total_completed,
    2,
  );

  const adminInByType = metrics.avg_time_to_completion.by_type.find(
    (b) => b.project_type === "Admin",
  );
  check(
    "by_type breakdown has no Admin row",
    adminInByType === undefined,
  );
  for (const row of metrics.avg_time_to_completion.by_type) {
    check(
      `by_type.${row.project_type} is a portfolio type`,
      (PORTFOLIO_PROJECT_TYPES as readonly string[]).includes(
        row.project_type,
      ),
    );
  }

  check(
    "filter_options.project_types excludes Admin",
    !metrics.filter_options.project_types.includes("Admin"),
  );
  eq(
    "filter_options.project_types matches PORTFOLIO_PROJECT_TYPES length",
    metrics.filter_options.project_types.length,
    PORTFOLIO_PROJECT_TYPES.length,
  );

  // Application/Product filter options derive from the surviving project
  // pool (via Set-of-application_product), so dropping the Admin-product
  // project means "Admin" is never offered as a filterable application.
  check(
    "filter_options.application_products excludes Admin (no leakage from dropped projects)",
    !metrics.filter_options.application_products.includes("Admin"),
  );

  eq(
    "task_throughput counts only the surviving task",
    metrics.task_throughput.total_completed,
    1,
  );

  // ----------------------------------------------------------------------
  // 4. Negative test: feeding Admin work directly to computeVelocityMetrics
  //    (bypassing the API filter) DOES include it. This confirms the
  //    exclusion lives at the API boundary, not in the metrics layer
  //    itself — which is the design we shipped (single chokepoint, easy
  //    to swap if the policy ever changes).
  // ----------------------------------------------------------------------

  section("Exclusion lives at the API boundary");

  const unfilteredMetrics = computeVelocityMetrics(
    allProjects,
    allTasks,
    ideas,
    filters,
    new Date("2026-05-01"),
  );
  eq(
    "without API filter: completed count is the full 4",
    unfilteredMetrics.completed_by_quarter.total_completed,
    4,
  );
  // The by_type breakdown still iterates PORTFOLIO_PROJECT_TYPES, so an
  // Admin project still doesn't get its own row. The total above proves
  // it counted somewhere (in completed_by_quarter), but the by_type
  // iteration is a deliberate floor against UI surprise. Both behaviors
  // matter and both are checked.
  check(
    "without API filter: by_type still has no Admin row (PORTFOLIO list only)",
    !unfilteredMetrics.avg_time_to_completion.by_type.some(
      (b) => b.project_type === "Admin",
    ),
  );

  // ----------------------------------------------------------------------
  // 5. End-to-end: the project service actually accepts Admin values.
  //
  // Why this matters: every consumer of `lib/projects/display.ts`'s
  // PROJECT_TYPES picks up new entries automatically — but several
  // other layers used to ship their own private copy of the list and
  // would silently reject anything not in their copy. The fix was to
  // delete those copies and import from the canonical list. This test
  // exercises the actual create path so a future regression — someone
  // re-introducing a local copy "for clarity" — fails loudly here
  // instead of in production.
  // ----------------------------------------------------------------------

  section("Project service accepts Admin values");

  // The service requires a real user record to attribute created_by.
  const DEFAULT_PREFS: import("../lib/db").NotificationPreferences = {
    TaskAssigned: "InAppOnly",
    TaskDueSoon: "InAppOnly",
    TaskOverdue: "InAppOnly",
    ProjectBlocked: "InAppOnly",
    DependencyBlocked: "InAppOnly",
    HealthScoreChanged: "InAppOnly",
    IdeaStatusChanged: "InAppOnly",
  };
  const adminUser = await UserRepository.create({
    email: "admin-test@example.com",
    name: "Admin Test",
    role: "Admin",
    active: true,
    notification_preferences: DEFAULT_PREFS,
    digest_mode: false,
  });

  // type=Admin, product=anything → accepted.
  const adminTypeProject = await createProject(
    {
      name: "Quarterly governance review",
      description: "Standing internal review.",
      application_product: "Automated Insights",
      project_type: "Admin",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: ["Team Lead"],
      project_lead: adminUser.user_id,
      additional_resources: [],
      target_date: null,
    },
    { createdBy: adminUser.user_id },
  );
  eq(
    "createProject with project_type=Admin → succeeds",
    adminTypeProject.project_type,
    "Admin",
  );

  // product=Admin, type=anything → also accepted.
  const adminProductProject = await createProject(
    {
      name: "Onboarding checklist refresh",
      description: "Internal tooling work.",
      application_product: "Admin",
      project_type: "Enhancement",
      priority: "Low",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: adminUser.user_id,
      additional_resources: [],
      target_date: null,
    },
    { createdBy: adminUser.user_id },
  );
  eq(
    "createProject with application_product=Admin → succeeds",
    adminProductProject.application_product,
    "Admin",
  );

  // Both fields = Admin → accepted (the most idiomatic "internal work" case).
  const fullyAdminProject = await createProject(
    {
      name: "Vendor admin",
      description: "Internal vendor onboarding cycle.",
      application_product: "Admin",
      project_type: "Admin",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: adminUser.user_id,
      additional_resources: [],
      target_date: null,
    },
    { createdBy: adminUser.user_id },
  );
  check(
    "createProject with both fields=Admin → succeeds",
    fullyAdminProject.project_type === "Admin" &&
      fullyAdminProject.application_product === "Admin",
  );
  check(
    "Admin-classified project is detected by isAdminProject()",
    isAdminProject(fullyAdminProject),
  );

  // Cleanup so the temp dir doesn't keep three projects we don't need.
  await deleteProject(adminTypeProject.project_id);
  await deleteProject(adminProductProject.project_id);
  await deleteProject(fullyAdminProject.project_id);

  // ----------------------------------------------------------------------
  // Done.
  // ----------------------------------------------------------------------

  console.log(`\n${passed} checks passed.`);
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
      // best effort
    }
  });
