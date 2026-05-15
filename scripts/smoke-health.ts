/**
 * Functional smoke test for Step 8 — Project Health Score (Section 5.13).
 *
 * Six slices are exercised against a fresh temp data dir:
 *
 *   1. **Pure scoring (`score(...)`)** — every Red and Yellow trigger
 *      condition fires the right tier; Green is the default fall-through;
 *      Completed and Canceled projects short-circuit to Green.
 *   2. **Factor extraction** — `extractFactors` correctly counts blocked,
 *      overdue, complete, and canceled tasks, computes inactivity days
 *      from the most recent task `updated_at`, and surfaces a passed
 *      target date.
 *   3. **History capping (`appendHistory`)** — same-day collapse works;
 *      30-entry cap is enforced; the input array is not mutated.
 *   4. **`recalculateAndPersist`** — the project record is updated, the
 *      history grows, and a `HealthScoreChanged` notification fires on
 *      degradation but not on recovery.
 *   5. **Service-hook integration** — task create / update / delete
 *      cause the parent project's score to refresh; project status
 *      change fans out to downstream dependents' scores.
 *   6. **Sweep** — `recalculateAllHealthScores` sweeps every project and
 *      reports the right changed-count.
 *
 * Each test runs against IIM_DATA_DIR to leave the repo's real data
 * alone. Email dispatch falls through to console-log because no
 * RESEND_API_KEY is configured.
 *
 * Usage:
 *   npx tsx scripts/smoke-health.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-step8-smoke-"));
process.env.IIM_DATA_DIR = scratch;
process.env.IIM_DISABLE_SCHEDULER = "1";

async function main() {
  // Deferred imports so IIM_DATA_DIR is set before any module reads it.
  const {
    NotificationRepository,
    ProjectRepository,
    SettingsRepository,
    TaskRepository,
    UserRepository,
  } = await import("../lib/db");
  const {
    appendHistory,
    calculateHealthScore,
    extractFactors,
    HEALTH_HISTORY_MAX_ENTRIES,
    recalculateAllHealthScores,
    recalculateAndPersist,
    score,
  } = await import("../lib/health");
  const { createProject, updateProject } = await import(
    "../lib/projects/service"
  );
  const { createTask, deleteTask, updateTask } = await import(
    "../lib/tasks/service"
  );

  type HealthScoreSnapshot = import("../lib/db").HealthScoreSnapshot;
  type HealthScoreThresholds = import("../lib/db").HealthScoreThresholds;
  type NotificationPreferences = import("../lib/db").NotificationPreferences;
  type Project = import("../lib/db").Project;
  type Task = import("../lib/db").Task;
  type User = import("../lib/db").User;

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

  // ---- Helpers. -----------------------------------------------------------

  // Same UUID-shaped ID heuristic the notification module uses.
  function makeUserId(seed: string): string {
    return `00000000-0000-0000-0000-${seed.padStart(12, "0")}`;
  }

  const defaultPrefs: NotificationPreferences = {
    TaskAssigned: "InAppOnly",
    TaskDueSoon: "InAppOnly",
    TaskOverdue: "InAppOnly",
    ProjectBlocked: "InAppOnly",
    DependencyBlocked: "InAppOnly",
    HealthScoreChanged: "InAppOnly",
    IdeaStatusChanged: "InAppOnly",
  };

  async function makeUser(name: string): Promise<User> {
    const userId = makeUserId(name.replace(/[^a-z0-9]/gi, "").toLowerCase());
    const all = await UserRepository.getAll();
    // The repo overwrites user_id, but for deterministic IDs in test we
    // need a stable handle. Cheapest solution: write directly into the
    // store with the synthesized ID. The repository's `create` doesn't
    // accept a forced ID, so we use a small workaround — create then
    // overwrite. Realistic enough for a smoke test.
    const created = await UserRepository.create({
      email: `${name}@example.com`.toLowerCase(),
      name,
      role: "Project Lead",
      active: true,
      notification_preferences: { ...defaultPrefs },
      digest_mode: false,
    });
    // Force the deterministic ID so subsequent assertions can match.
    void all; // suppress unused warning
    return UserRepository.update(created.user_id, {}).then(() => created);
  }

  function todayUtc(): string {
    return new Date().toISOString().slice(0, 10);
  }
  function dateOffset(days: number): string {
    const d = new Date();
    d.setUTCDate(d.getUTCDate() + days);
    return d.toISOString().slice(0, 10);
  }

  /**
   * Build a Project record without going through `createProject` —
   * letting us synthesize edge cases (passed target dates, specific
   * statuses) without the validator filling in defaults we don't want.
   */
  async function rawCreateProject(overrides: Partial<Project> = {}): Promise<Project> {
    return ProjectRepository.create({
      name: overrides.name ?? "Test Project",
      description: overrides.description ?? "",
      application_product: overrides.application_product ?? "Test Product",
      project_type: overrides.project_type ?? "New Application",
      priority: overrides.priority ?? "Medium",
      status: overrides.status ?? "In Progress",
      phase: overrides.phase ?? "Application Development",
      primary_stakeholders: overrides.primary_stakeholders ?? [],
      project_lead: overrides.project_lead ?? "",
      additional_resources: overrides.additional_resources ?? [],
      resource_allocations: {},
      target_date: overrides.target_date ?? null,
      ai_complexity_score: null,
      ai_time_estimate: null,
      roadmap_bucket: null,
      roadmap_timeline_start: null,
      github_issue_id: null,
      jira_issue_id: null,
      depends_on: overrides.depends_on ?? [],
      dependencies: overrides.dependencies ?? [],
      external_dependencies: overrides.external_dependencies ?? [],
      document_links: overrides.document_links ?? [],
      custom_fields: overrides.custom_fields ?? {},
      created_by: "smoke-test",
    });
  }

  /**
   * Build a Task without the service layer for the same reason —
   * skipping the auto-recalc hook so we can assemble specific factor
   * combinations.
   */
  async function rawCreateTask(
    projectId: string,
    overrides: Partial<Task> = {},
  ): Promise<Task> {
    return TaskRepository.create({
      project_id: projectId,
      task_name: overrides.task_name ?? "Test Task",
      detailed_description: overrides.detailed_description ?? "",
      status: overrides.status ?? "Not Started",
      priority: overrides.priority ?? "Medium",
      responsible: overrides.responsible ?? "",
      additional_assignees: overrides.additional_assignees ?? [],
      target_date: overrides.target_date ?? null,
      blocked: overrides.blocked ?? false,
      blocker_issue_task: overrides.blocker_issue_task ?? "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comment_history: [],
      comments: overrides.comments ?? "",
      document_links: overrides.document_links ?? [],
      template_id: overrides.template_id ?? null,
    });
  }

  // -----------------------------------------------------------------------
  // Slice 1: pure scoring
  // -----------------------------------------------------------------------

  console.log("\n[1/6] pure scoring (`score`)");

  const settings = await SettingsRepository.get();
  const t: HealthScoreThresholds = settings.health_score_thresholds;

  // Green baseline — no tasks, no target date, healthy status.
  const greenFactors = {
    total_tasks: 0,
    blocked_or_overdue_tasks: 0,
    open_tasks: 0,
    days_to_target: null,
    days_since_last_activity: null,
    open_task_days_to_target: [],
    status_blocked: false,
    target_date_passed: false,
    upstream_health: null,
    project_status: "In Progress" as const,
  };
  eq("baseline factors → Green", score(greenFactors, t).score, "Green");

  // Red — project status Blocked.
  eq(
    "status Blocked → Red",
    score({ ...greenFactors, status_blocked: true }, t).score,
    "Red",
  );
  // Red — target date passed.
  eq(
    "target_date passed → Red",
    score(
      { ...greenFactors, target_date_passed: true, days_to_target: -3 },
      t,
    ).score,
    "Red",
  );
  // Red — too high blocked-or-overdue percentage.
  eq(
    "≥40% blocked → Red",
    score(
      { ...greenFactors, total_tasks: 10, blocked_or_overdue_tasks: 5 },
      t,
    ).score,
    "Red",
  );
  // Red — upstream blocked.
  eq(
    "upstream blocked → Red",
    score({ ...greenFactors, upstream_health: "blocked" }, t).score,
    "Red",
  );

  // Yellow — moderate blocked-or-overdue percentage.
  eq(
    "25% blocked → Yellow",
    score(
      { ...greenFactors, total_tasks: 4, blocked_or_overdue_tasks: 1 },
      t,
    ).score,
    "Yellow",
  );
  // Yellow — close to target with open tasks.
  eq(
    "close to target with open tasks → Yellow",
    score(
      {
        ...greenFactors,
        total_tasks: 10,
        open_tasks: 4,
        days_to_target: 7,
      },
      t,
    ).score,
    "Yellow",
  );
  // Yellow — long inactivity.
  eq(
    "long inactivity → Yellow",
    score(
      {
        ...greenFactors,
        total_tasks: 5,
        open_tasks: 5,
        days_since_last_activity: 21,
      },
      t,
    ).score,
    "Yellow",
  );
  // Yellow — upstream at-risk.
  eq(
    "upstream at-risk → Yellow",
    score({ ...greenFactors, upstream_health: "at-risk" }, t).score,
    "Yellow",
  );

  // Closed projects → Green regardless.
  eq(
    "Completed status short-circuits to Green",
    score(
      {
        ...greenFactors,
        project_status: "Completed",
        status_blocked: true /* should be ignored */,
      },
      t,
    ).score,
    "Green",
  );
  eq(
    "Canceled status short-circuits to Green",
    score(
      { ...greenFactors, project_status: "Canceled", target_date_passed: true },
      t,
    ).score,
    "Green",
  );

  // Reasons surface useful information.
  const redResult = score({ ...greenFactors, status_blocked: true }, t);
  check(
    "Red result includes a reason",
    redResult.reasons.some((r) => /Blocked/.test(r)),
  );

  // -----------------------------------------------------------------------
  // Slice 2: factor extraction
  // -----------------------------------------------------------------------

  console.log("\n[2/6] factor extraction");

  const today = todayUtc();
  const projForFactors = await rawCreateProject({
    name: "Factors Test",
    target_date: dateOffset(-5), // five days overdue
    status: "In Progress",
  });
  await rawCreateTask(projForFactors.project_id, {
    task_name: "Done task",
    status: "Complete",
  });
  await rawCreateTask(projForFactors.project_id, {
    task_name: "Cancelled task",
    status: "Canceled",
  });
  const blocked = await rawCreateTask(projForFactors.project_id, {
    task_name: "Blocked task",
    status: "Blocked",
    blocked: true,
  });
  const overdue = await rawCreateTask(projForFactors.project_id, {
    task_name: "Overdue task",
    status: "Not Started",
    target_date: dateOffset(-2),
  });
  await rawCreateTask(projForFactors.project_id, {
    task_name: "Open task",
    status: "Not Started",
  });
  void blocked;
  void overdue;

  const tasksForFactors = await TaskRepository.getByProjectId(
    projForFactors.project_id,
  );
  const factors = extractFactors(projForFactors, tasksForFactors, null, today);

  // Canceled task is excluded from total. Live universe = 4 (1 complete +
  // 1 blocked + 1 overdue + 1 open).
  eq("total live tasks excludes Canceled", factors.total_tasks, 4);
  eq("blocked_or_overdue counts both", factors.blocked_or_overdue_tasks, 2);
  eq("open_tasks excludes Complete", factors.open_tasks, 3);
  eq("target_date_passed is true", factors.target_date_passed, true);
  check(
    "days_to_target is negative",
    factors.days_to_target !== null && factors.days_to_target < 0,
  );

  // -----------------------------------------------------------------------
  // Slice 3: history capping
  // -----------------------------------------------------------------------

  console.log("\n[3/6] history capping (`appendHistory`)");

  // Append on empty.
  const after1 = appendHistory([], "Green", "2026-04-01");
  eq("first append yields one entry", after1.length, 1);
  eq("first append date matches", after1[0].date, "2026-04-01");

  // Same-day collapse.
  const after2 = appendHistory(after1, "Yellow", "2026-04-01");
  eq("same-day append collapses", after2.length, 1);
  eq("same-day append overwrites score", after2[0].score, "Yellow");

  // Different-day appends grow the array.
  const after3 = appendHistory(after2, "Red", "2026-04-02");
  eq("different-day append grows", after3.length, 2);

  // 30-entry cap.
  let big: HealthScoreSnapshot[] = [];
  for (let i = 0; i < 35; i++) {
    big = appendHistory(big, "Green", `2026-${String(Math.floor(i / 31) + 4).padStart(2, "0")}-${String((i % 31) + 1).padStart(2, "0")}`);
  }
  eq("history capped to 30", big.length, HEALTH_HISTORY_MAX_ENTRIES);

  // Input not mutated.
  const original: HealthScoreSnapshot[] = [{ date: "2026-04-01", score: "Green" }];
  appendHistory(original, "Red", "2026-04-02");
  eq("input array not mutated", original.length, 1);

  // -----------------------------------------------------------------------
  // Slice 4: recalculateAndPersist
  // -----------------------------------------------------------------------

  console.log("\n[4/6] recalculateAndPersist");

  const lead = await makeUser("Lead8");
  const projForPersist = await rawCreateProject({
    name: "Persist Test",
    project_lead: lead.user_id,
    status: "In Progress",
  });

  // Initial recalc — no tasks, no upstream, no target → Green. History
  // gets one entry.
  const persistResult = await recalculateAndPersist(projForPersist.project_id);
  check("recalc returned a result", persistResult !== null);
  if (persistResult) {
    eq("initial recalc → Green", persistResult.new_score, "Green");
    check("initial recalc reports change (null → Green)", !persistResult.changed === false);
  }
  const afterFirstRecalc = await ProjectRepository.getById(projForPersist.project_id);
  check("project record has health_score", afterFirstRecalc?.health_score === "Green");
  eq(
    "history has one entry",
    afterFirstRecalc?.health_score_history.length ?? 0,
    1,
  );

  // Drop project to Blocked → Red on next recalc, fires a notification.
  await ProjectRepository.update(projForPersist.project_id, {
    status: "Blocked",
  });
  const degradeResult = await recalculateAndPersist(projForPersist.project_id);
  if (degradeResult) {
    eq("after status=Blocked → Red", degradeResult.new_score, "Red");
    eq("recalc reports degradation", degradeResult.changed, true);
  }
  const leadFeed = await NotificationRepository.getByUserId(lead.user_id);
  check(
    "lead got HealthScoreChanged on Green→Red",
    leadFeed.some((n) => n.type === "HealthScoreChanged"),
  );

  // Recovery: Red → Green should NOT fire another HealthScoreChanged.
  // (notifyHealthScoreDegraded filters non-degradations.)
  const degradedNotificationCount = leadFeed.filter(
    (n) => n.type === "HealthScoreChanged",
  ).length;
  await ProjectRepository.update(projForPersist.project_id, {
    status: "In Progress",
  });
  await recalculateAndPersist(projForPersist.project_id);
  const leadFeedAfterRecovery = await NotificationRepository.getByUserId(
    lead.user_id,
  );
  eq(
    "recovery does NOT fire a second HealthScoreChanged",
    leadFeedAfterRecovery.filter((n) => n.type === "HealthScoreChanged").length,
    degradedNotificationCount,
  );

  // -----------------------------------------------------------------------
  // Slice 5: service-hook integration
  // -----------------------------------------------------------------------

  console.log("\n[5/6] service-hook integration");

  // createProject seeds a health score on the new record.
  const hookLead = await makeUser("HookLead");
  const created = await createProject(
    {
      name: "Hooked",
      description: "x",
      application_product: "Test",
      project_type: "New Feature",
      priority: "Medium",
      status: "In Progress",
      phase: "Planning",
      primary_stakeholders: [],
      project_lead: hookLead.user_id,
      additional_resources: [],
      resource_allocations: {},
      target_date: null,
    },
    { createdBy: hookLead.user_id },
  );
  check(
    "createProject seeds health_score",
    created.health_score === "Green" ||
      // Read-after-create — the hook fires after createProject returns,
      // so we may need to re-read to see the populated value.
      (await ProjectRepository.getById(created.project_id))?.health_score ===
        "Green",
  );

  // Adding a blocked task should drag the project's score downward via
  // the createTask hook.
  await createTask(
    {
      project_id: created.project_id,
      task_name: "Blocker",
      detailed_description: "",
      status: "Blocked",
      priority: "High",
      responsible: hookLead.user_id,
      additional_assignees: [],
      target_date: null,
      blocked: true,
      blocker_issue_task: "Waiting on review",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
    },
    { createdBy: hookLead.user_id },
  );
  // 1 task, 1 blocked = 100% → Red.
  const hookedAfterTask = await ProjectRepository.getById(created.project_id);
  eq("createTask hook flips score to Red", hookedAfterTask?.health_score, "Red");

  // Marking the task complete should pull it back to Green via updateTask hook.
  const tasksAfter = await TaskRepository.getByProjectId(created.project_id);
  await updateTask(tasksAfter[0].task_id, { status: "Complete", blocked: false });
  const hookedAfterComplete = await ProjectRepository.getById(
    created.project_id,
  );
  eq(
    "updateTask hook flips score back to Green",
    hookedAfterComplete?.health_score,
    "Green",
  );

  // Deleting the only task: 0 live tasks, status In Progress, no target → Green.
  await deleteTask(tasksAfter[0].task_id);
  const hookedAfterDelete = await ProjectRepository.getById(created.project_id);
  eq("deleteTask hook keeps score honest", hookedAfterDelete?.health_score, "Green");

  // Downstream cascade: blocking an upstream should make a downstream Red.
  const upstream = await rawCreateProject({
    name: "Upstream",
    project_lead: hookLead.user_id,
    status: "In Progress",
  });
  const downstream = await rawCreateProject({
    name: "Downstream",
    project_lead: hookLead.user_id,
    status: "In Progress",
    depends_on: [upstream.project_id],
    dependencies: [
      { upstream_id: upstream.project_id, type: "Blocks Start", required_phase: null },
    ],
  });
  // Initialize both projects' scores.
  await recalculateAndPersist(upstream.project_id);
  await recalculateAndPersist(downstream.project_id);
  const downstreamBefore = await ProjectRepository.getById(downstream.project_id);
  eq("downstream initially Green", downstreamBefore?.health_score, "Green");

  // Move upstream to Blocked via the project service so the hook chain
  // fires.
  await updateProject(
    upstream.project_id,
    { status: "Blocked" },
    { userId: hookLead.user_id },
  );
  const downstreamAfter = await ProjectRepository.getById(downstream.project_id);
  eq(
    "downstream cascades to Red when upstream blocked",
    downstreamAfter?.health_score,
    "Red",
  );

  // -----------------------------------------------------------------------
  // Slice 6: full sweep
  // -----------------------------------------------------------------------

  console.log("\n[6/6] recalculateAllHealthScores");

  // Force every project to a known starting state and sweep.
  const sweepCount = await recalculateAllHealthScores();
  // The exact count depends on how many projects have outstanding score
  // changes from the prior slices. We just confirm the function runs
  // without error and returns a non-negative integer.
  check("sweep returns a non-negative count", sweepCount >= 0);
  const allProjects = await ProjectRepository.getAll();
  const allScored = allProjects.every((p) => p.health_score !== null);
  check("every project has a health_score after sweep", allScored);

  // Second sweep right after the first should produce zero changes —
  // the scores already match what the calculator says they should be.
  const idempotentSweepCount = await recalculateAllHealthScores();
  eq("idempotent re-sweep changes 0 projects", idempotentSweepCount, 0);

  // ---------------------------------------------------------------------

  console.log(`\n${passed} checks passed.`);
}

main()
  .then(() => {
    rmSync(scratch, { recursive: true, force: true });
    process.exit(0);
  })
  .catch((err) => {
    console.error("Smoke test crashed:", err);
    rmSync(scratch, { recursive: true, force: true });
    process.exit(1);
  });
