/**
 * Functional smoke test for Step 9 — Velocity & Throughput Dashboard
 * (Section 5.15).
 *
 * Five slices are exercised:
 *
 *   1. **Pure helpers** — `parseEstimateToDays`, `quarterKey`, `weekKey`,
 *      `daysBetween`, `withinRange`, and `resolveRange` cover the date
 *      math the metrics rely on.
 *
 *   2. **Each metric in isolation** — synthesized project / task / idea
 *      lists with controlled timestamps verify each metric returns the
 *      expected counts, averages, and `data_quality` flag.
 *
 *   3. **Filter application** — types / products / leads filters narrow
 *      both the project and task pools; the individual-contributor view
 *      scopes to one user; the range filter shifts which records count.
 *
 *   4. **Cache** — set/get round-trips, TTL expiry shifts a hit to a
 *      miss, invalidation drops every entry, and a different filter set
 *      misses cleanly even when the structure looks similar.
 *
 *   5. **Service-hook integration** — `createProject`, `updateProject`,
 *      `deleteProject`, `createTask`, `updateTask`, `deleteTask` all
 *      blow the velocity cache so the next dashboard request is fresh.
 *
 * Each test runs against `IIM_DATA_DIR` to leave the repo's real data
 * alone. Email dispatch and the daily scheduler are both disabled.
 *
 * Usage:
 *   npx tsx scripts/smoke-velocity.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-step9-velocity-"));
process.env.IIM_DATA_DIR = scratch;
process.env.IIM_DISABLE_SCHEDULER = "1";

async function main() {
  // Deferred imports — IIM_DATA_DIR must be set before any module reads it.
  const {
    NotificationRepository,
    ProjectRepository,
    TaskRepository,
    UserRepository,
  } = await import("../lib/db");
  const {
    applyProjectFilters,
    applyTaskFilters,
    computeAvgTimeToCompletion,
    computeBlockedTime,
    computeCompletedByQuarter,
    computeEstimatedVsActual,
    computeIdeaConversion,
    computePhaseCycleTime,
    computeTaskThroughput,
    computeVelocityMetrics,
    daysBetween,
    parseEstimateToDays,
    quarterKey,
    resolveRange,
    weekKey,
    withinRange,
  } = await import("../lib/velocity/metrics");
  const {
    _cacheSize,
    getCachedVelocityMetrics,
    invalidateVelocityCache,
    setCachedVelocityMetrics,
    VELOCITY_CACHE_TTL_MS,
  } = await import("../lib/velocity/cache");
  const { createProject, deleteProject, updateProject } = await import(
    "../lib/projects/service"
  );
  const { createTask, deleteTask, updateTask } = await import(
    "../lib/tasks/service"
  );

  type NotificationPreferences = import("../lib/db").NotificationPreferences;
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

  function approxEq(label: string, actual: number, expected: number, tolerance = 0.01): void {
    if (Math.abs(actual - expected) > tolerance) {
      console.error(
        `FAIL: ${label}\n  expected: ${expected} (±${tolerance})\n  actual:   ${actual}`,
      );
      process.exit(1);
    }
    passed++;
    console.log(`  ok  ${label}`);
  }

  function section(title: string): void {
    console.log(`\n${title}`);
  }

  // ---- Helpers ---------------------------------------------------------

  // Stable "now" used throughout so quarter / week math is reproducible.
  const NOW = new Date("2026-04-15T12:00:00Z");

  const DEFAULT_PREFS: NotificationPreferences = {
    TaskAssigned: "InAppOnly",
    TaskDueSoon: "InAppOnly",
    TaskOverdue: "InAppOnly",
    ProjectBlocked: "InAppOnly",
    DependencyBlocked: "InAppOnly",
    HealthScoreChanged: "InAppOnly",
    IdeaStatusChanged: "InAppOnly",
  };

  // Synthesize a project record. Defaults align with `ProjectRepository.create`
  // expectations except where overridden.
  function mkProject(overrides: Partial<Project> & Pick<Project, "project_id">): Project {
    return {
      name: `Project ${overrides.project_id}`,
      description: "test project",
      definition_of_done: "",
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
      external_dependencies: [],
      document_links: [],
      custom_fields: {},
      created_by: "seed",
      updated_at: "2026-04-15T00:00:00Z",
      ...overrides,
    };
  }

  function mkTask(overrides: Partial<Task> & Pick<Task, "task_id" | "project_id">): Task {
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

  function mkIdea(overrides: Partial<ProjectIdea> & Pick<ProjectIdea, "idea_id">): ProjectIdea {
    return {
      submitter_name: "Test Submitter",
      submitter_email: null,
      idea_name: `Idea ${overrides.idea_id}`,
      description: "test idea",
      urgency: "Medium",
      requested_target_date: null,
      key_stakeholders: "",
      submitted_at: "2026-04-01T00:00:00Z",
      status: "New",
      admin_comments: "",
      converted_to_project_id: null,
      ai_overlap_analysis: null,
      attachments: [],
      ...overrides,
    };
  }

  function defaultFilters(overrides: Partial<VelocityFilters> = {}): VelocityFilters {
    return {
      range: resolveRange("all", NOW),
      project_types: [],
      application_products: [],
      project_leads: [],
      individual_user_id: null,
      ...overrides,
    };
  }

  // ---- 1. Pure helpers --------------------------------------------------

  section("Pure helpers");

  // parseEstimateToDays
  eq("parseEstimateToDays: '4-6 weeks' -> 35", parseEstimateToDays("4-6 weeks"), 35);
  eq("parseEstimateToDays: '10 days' -> 10", parseEstimateToDays("10 days"), 10);
  eq("parseEstimateToDays: '2 months' -> 60", parseEstimateToDays("2 months"), 60);
  eq("parseEstimateToDays: '~3 weeks' -> 21", parseEstimateToDays("~3 weeks"), 21);
  eq("parseEstimateToDays: '1.5 weeks' -> 10.5", parseEstimateToDays("1.5 weeks"), 10.5);
  eq("parseEstimateToDays: 'unknown' -> null", parseEstimateToDays("very fast"), null);
  eq("parseEstimateToDays: null -> null", parseEstimateToDays(null), null);
  eq("parseEstimateToDays: '' -> null", parseEstimateToDays(""), null);
  eq("parseEstimateToDays: '5 to 7 weeks' -> 42", parseEstimateToDays("5 to 7 weeks"), 42);

  // quarterKey
  eq("quarterKey: 2026-01-15 -> 2026-Q1", quarterKey("2026-01-15"), "2026-Q1");
  eq("quarterKey: 2026-04-01 -> 2026-Q2", quarterKey("2026-04-01"), "2026-Q2");
  eq("quarterKey: 2026-12-31 -> 2026-Q4", quarterKey("2026-12-31"), "2026-Q4");
  eq(
    "quarterKey accepts ISO timestamps",
    quarterKey("2026-07-15T14:32:00Z"),
    "2026-Q3",
  );

  // weekKey: 2026-04-15 is a Wednesday; ISO week starts Monday 2026-04-13.
  eq("weekKey: 2026-04-15 -> 2026-04-13 (Mon)", weekKey("2026-04-15"), "2026-04-13");
  eq("weekKey: 2026-04-13 -> 2026-04-13 (Mon stays Mon)", weekKey("2026-04-13"), "2026-04-13");
  eq("weekKey: Sunday rolls back to prior Mon", weekKey("2026-04-19"), "2026-04-13");

  // daysBetween
  eq("daysBetween: same day -> 0", daysBetween("2026-04-15", "2026-04-15"), 0);
  eq("daysBetween: 7 days", daysBetween("2026-04-08", "2026-04-15"), 7);
  eq(
    "daysBetween: ISO timestamps work too",
    daysBetween("2026-04-08T00:00:00Z", "2026-04-15T23:59:00Z"),
    7,
  );

  // resolveRange
  const range90 = resolveRange("90d", NOW);
  eq("resolveRange: 90d kind", range90.kind, "90d");
  eq("resolveRange: 90d end is today", range90.end, "2026-04-15");
  eq("resolveRange: 90d start is 90 days back", range90.start, "2026-01-15");

  const rangeAll = resolveRange("all", NOW);
  eq("resolveRange: all has null start", rangeAll.start, null);

  const rangeCustom = resolveRange("custom", NOW, {
    start: "2025-01-01",
    end: "2025-06-30",
  });
  eq("resolveRange: custom passes start through", rangeCustom.start, "2025-01-01");
  eq("resolveRange: custom passes end through", rangeCustom.end, "2025-06-30");

  // withinRange
  check(
    "withinRange: inside",
    withinRange("2026-02-15", { kind: "90d", start: "2026-01-15", end: "2026-04-15" }),
  );
  check(
    "withinRange: before",
    !withinRange("2025-12-31", { kind: "90d", start: "2026-01-15", end: "2026-04-15" }),
  );
  check(
    "withinRange: after",
    !withinRange("2026-04-16", { kind: "90d", start: "2026-01-15", end: "2026-04-15" }),
  );
  check(
    "withinRange: null start admits anything ≤ end",
    withinRange("1999-01-01", { kind: "all", start: null, end: "2026-04-15" }),
  );

  // ---- 2. Metrics --------------------------------------------------------

  section("Metric: Projects Completed per Quarter");

  const completedProjects: Project[] = [
    mkProject({ project_id: "P1", status: "Completed", updated_at: "2026-01-15T00:00:00Z" }),
    mkProject({ project_id: "P2", status: "Completed", updated_at: "2026-02-20T00:00:00Z" }),
    mkProject({ project_id: "P3", status: "Completed", updated_at: "2026-04-01T00:00:00Z" }),
    mkProject({ project_id: "P4", status: "In Progress", updated_at: "2026-04-01T00:00:00Z" }),
  ];
  const compMetric = computeCompletedByQuarter(completedProjects, range90);
  eq("completed_by_quarter: total", compMetric.total_completed, 3);
  // 2026-Q1 has P1 + P2 (Jan 15 and Feb 20); 2026-Q2 has P3 (Apr 1).
  // The range is 2026-01-15 to 2026-04-15, so bars include both quarters.
  const q1Bar = compMetric.bars.find((b) => b.quarter === "2026-Q1");
  const q2Bar = compMetric.bars.find((b) => b.quarter === "2026-Q2");
  eq("completed_by_quarter: 2026-Q1 count", q1Bar?.count, 2);
  eq("completed_by_quarter: 2026-Q2 count", q2Bar?.count, 1);
  eq("completed_by_quarter: data_quality", compMetric.data_quality, "proxy");

  section("Metric: Average Time to Completion");

  // P1 completes Jan 15 with date_added Jan 1 → 14 days
  // P2 completes Feb 20 with date_added Jan 1 → 50 days
  // P3 completes Apr 1 with date_added Jan 1 → 90 days
  const avgMetric = computeAvgTimeToCompletion(completedProjects, range90);
  eq("avg_time_to_completion: sample_size", avgMetric.sample_size, 3);
  approxEq(
    "avg_time_to_completion: overall avg",
    avgMetric.overall_avg_days,
    (14 + 50 + 90) / 3,
  );
  const newAppByType = avgMetric.by_type.find((t) => t.project_type === "New Application");
  eq("avg_time_to_completion: New Application sample size", newAppByType?.sample_size, 3);

  section("Metric: Estimated vs Actual");

  const estProjects: Project[] = [
    // 14 days actual, "2 weeks" estimated → 14 estimated → delta 0.
    mkProject({
      project_id: "E1",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-01-15T00:00:00Z",
      ai_time_estimate: "2 weeks",
    }),
    // 50 days actual, "4-6 weeks" → 35 estimated → delta +15.
    mkProject({
      project_id: "E2",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-02-20T00:00:00Z",
      ai_time_estimate: "4-6 weeks",
    }),
    // No estimate → excluded.
    mkProject({
      project_id: "E3",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-04-01T00:00:00Z",
      ai_time_estimate: null,
    }),
    // Garbage estimate → excluded.
    mkProject({
      project_id: "E4",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-04-01T00:00:00Z",
      ai_time_estimate: "no idea lol",
    }),
  ];
  const evaMetric = computeEstimatedVsActual(estProjects, range90);
  eq("estimated_vs_actual: sample_size", evaMetric.sample_size, 2);
  eq("estimated_vs_actual: excluded_count", evaMetric.excluded_count, 2);
  approxEq(
    "estimated_vs_actual: mean_delta_days",
    evaMetric.mean_delta_days,
    (0 + 15) / 2,
  );

  section("Metric: Task Throughput");

  const tasks: Task[] = [
    mkTask({ task_id: "T1", project_id: "P1", status: "Complete", updated_at: "2026-04-13T10:00:00Z" }),
    mkTask({ task_id: "T2", project_id: "P1", status: "Complete", updated_at: "2026-04-14T10:00:00Z" }),
    mkTask({ task_id: "T3", project_id: "P1", status: "Complete", updated_at: "2026-04-06T10:00:00Z" }),
    mkTask({ task_id: "T4", project_id: "P1", status: "Not Started", updated_at: "2026-04-10T10:00:00Z" }),
  ];
  const ttRange = resolveRange("30d", NOW);
  const ttMetric = computeTaskThroughput(tasks, ttRange);
  eq("task_throughput: total_completed", ttMetric.total_completed, 3);
  eq("task_throughput: data_quality is actual", ttMetric.data_quality, "actual");
  // Week of Apr 13 should have 2 (T1 + T2); week of Apr 6 should have 1 (T3).
  const wk413 = ttMetric.weeks.find((w) => w.week_start === "2026-04-13");
  const wk406 = ttMetric.weeks.find((w) => w.week_start === "2026-04-06");
  eq("task_throughput: 2026-04-13 week count", wk413?.count, 2);
  eq("task_throughput: 2026-04-06 week count", wk406?.count, 1);

  section("Metric: Phase Cycle Time");

  const phaseProjects: Project[] = [
    mkProject({
      project_id: "PH1",
      phase: "Planning",
      date_added: "2026-04-01",
      updated_at: "2026-04-15T00:00:00Z",
    }),
    mkProject({
      project_id: "PH2",
      phase: "Planning",
      date_added: "2026-04-08",
      updated_at: "2026-04-15T00:00:00Z",
    }),
    mkProject({
      project_id: "PH3",
      phase: "Closeout",
      date_added: "2026-01-01",
      updated_at: "2026-04-15T00:00:00Z",
    }),
  ];
  const phaseMetric = computePhaseCycleTime(phaseProjects, range90);
  const planning = phaseMetric.bars.find((b) => b.phase === "Planning");
  const closeout = phaseMetric.bars.find((b) => b.phase === "Closeout");
  eq("phase_cycle_time: Planning sample_size", planning?.sample_size, 2);
  approxEq(
    "phase_cycle_time: Planning avg",
    planning?.avg_days ?? -1,
    (14 + 7) / 2,
  );
  eq("phase_cycle_time: Closeout sample_size", closeout?.sample_size, 1);
  approxEq(
    "phase_cycle_time: Closeout avg",
    closeout?.avg_days ?? -1,
    daysBetween("2026-01-01", "2026-04-15"),
  );
  eq("phase_cycle_time: data_quality is proxy", phaseMetric.data_quality, "proxy");
  check(
    "phase_cycle_time: note explains the limitation",
    phaseMetric.note.includes("status-transition history"),
  );

  section("Metric: Blocked Time");

  const blockedProjects: Project[] = [
    mkProject({ project_id: "B1", status: "Blocked", updated_at: "2026-04-15T00:00:00Z" }),
    mkProject({ project_id: "B2", status: "Blocked", updated_at: "2026-04-01T00:00:00Z" }),
    mkProject({ project_id: "B3", status: "In Progress", updated_at: "2026-04-15T00:00:00Z" }),
  ];
  const btMetric = computeBlockedTime(blockedProjects, range90);
  eq("blocked_time: total_blocked_days", btMetric.total_blocked_days, 2);
  eq("blocked_time: data_quality is proxy", btMetric.data_quality, "proxy");
  check("blocked_time: note", btMetric.note.length > 0);

  section("Metric: Idea Conversion");

  const ideas: ProjectIdea[] = [
    mkIdea({ idea_id: "I1", status: "New", submitted_at: "2026-04-01T00:00:00Z" }),
    mkIdea({ idea_id: "I2", status: "Converted", submitted_at: "2026-04-02T00:00:00Z" }),
    mkIdea({ idea_id: "I3", status: "Converted", submitted_at: "2026-04-03T00:00:00Z" }),
    mkIdea({ idea_id: "I4", status: "Rejected", submitted_at: "2026-04-04T00:00:00Z" }),
  ];
  const icMetric = computeIdeaConversion(ideas, range90);
  eq("idea_conversion: total_submitted", icMetric.total_submitted, 4);
  eq("idea_conversion: total_converted", icMetric.total_converted, 2);
  eq("idea_conversion: rate", icMetric.conversion_rate, 50);
  eq("idea_conversion: data_quality is actual", icMetric.data_quality, "actual");

  // No ideas → insufficient.
  const emptyIdeasMetric = computeIdeaConversion([], range90);
  eq(
    "idea_conversion: empty -> insufficient",
    emptyIdeasMetric.data_quality,
    "insufficient",
  );

  // ---- 3. Filter application -------------------------------------------

  section("Filter application");

  const mixedProjects: Project[] = [
    mkProject({
      project_id: "F1",
      project_type: "New Application",
      application_product: "Automated Insights",
      project_lead: "user-A",
    }),
    mkProject({
      project_id: "F2",
      project_type: "New Feature",
      application_product: "Complaints",
      project_lead: "user-B",
    }),
    mkProject({
      project_id: "F3",
      project_type: "New Application",
      application_product: "Topic AI",
      project_lead: "user-C",
      additional_resources: ["user-A"],
      resource_allocations: {},
    }),
  ];

  const byType = applyProjectFilters(
    mixedProjects,
    defaultFilters({ project_types: ["New Application"] }),
  );
  eq("filter by type: count", byType.length, 2);

  const byProduct = applyProjectFilters(
    mixedProjects,
    defaultFilters({ application_products: ["Complaints"] }),
  );
  eq("filter by product: count", byProduct.length, 1);
  eq("filter by product: id", byProduct[0].project_id, "F2");

  const byLead = applyProjectFilters(
    mixedProjects,
    defaultFilters({ project_leads: ["user-B"] }),
  );
  eq("filter by lead: count", byLead.length, 1);

  // Individual: user-A is lead of F1 and a resource on F3 → 2 matches.
  const byIndividual = applyProjectFilters(
    mixedProjects,
    defaultFilters({ individual_user_id: "user-A" }),
  );
  eq("filter by individual: count", byIndividual.length, 2);
  check(
    "filter by individual: includes F1 (lead) and F3 (resource)",
    byIndividual.some((p) => p.project_id === "F1") &&
      byIndividual.some((p) => p.project_id === "F3"),
  );

  // Task filter: only tasks for projects in the filtered set.
  const filteredIds = new Set(byType.map((p) => p.project_id));
  const filteredTasks = applyTaskFilters(
    [
      mkTask({ task_id: "FT1", project_id: "F1", responsible: "user-A" }),
      mkTask({ task_id: "FT2", project_id: "F2", responsible: "user-A" }),
      mkTask({ task_id: "FT3", project_id: "F3", responsible: "user-A" }),
    ],
    filteredIds,
    defaultFilters({ project_types: ["New Application"] }),
  );
  eq("task filter: only kept tasks for filtered projects", filteredTasks.length, 2);

  // Range filter: a project that completed before the range start is excluded
  // from completed_by_quarter even when it's a "Completed" project.
  const rangeProjects: Project[] = [
    mkProject({ project_id: "R1", status: "Completed", updated_at: "2025-01-01T00:00:00Z" }),
    mkProject({ project_id: "R2", status: "Completed", updated_at: "2026-04-01T00:00:00Z" }),
  ];
  const rangeMetric = computeCompletedByQuarter(rangeProjects, range90);
  eq("range filter: only in-range completions counted", rangeMetric.total_completed, 1);

  // ---- 4. Cache --------------------------------------------------------

  section("Cache");

  invalidateVelocityCache();
  eq("cache: starts empty after invalidate", _cacheSize(), 0);

  const f1 = defaultFilters({ project_types: ["New Application"] });
  const f2 = defaultFilters({ project_types: ["New Feature"] });

  // Round trip
  const stub = computeVelocityMetrics([], [], [], f1, NOW);
  setCachedVelocityMetrics(f1, stub);
  eq("cache: size after one set", _cacheSize(), 1);
  const hit = getCachedVelocityMetrics(f1);
  check("cache: hit returns the stored payload", hit !== null);
  eq(
    "cache: hit echoes the same total_completed",
    hit?.completed_by_quarter.total_completed,
    stub.completed_by_quarter.total_completed,
  );

  // Different filter → miss
  const miss = getCachedVelocityMetrics(f2);
  eq("cache: different filter set misses", miss, null);

  // TTL expiry
  const expired = getCachedVelocityMetrics(f1, Date.now() + VELOCITY_CACHE_TTL_MS + 1);
  eq("cache: TTL expiry returns null", expired, null);

  // Invalidate clears
  invalidateVelocityCache();
  eq("cache: invalidate empties the map", _cacheSize(), 0);

  // ---- 5. Service-hook integration -------------------------------------

  section("Service-hook integration");

  // Seed an admin user so notification fan-outs (which read from
  // UserRepository) don't error out the service writes.
  const admin = await UserRepository.create({
    email: "admin@example.com",
    name: "Admin",
    role: "Admin",
    active: true,
    notification_preferences: DEFAULT_PREFS,
    digest_mode: false,
  });

  // Seed cache entry, then create a project and confirm the cache was blown.
  setCachedVelocityMetrics(f1, computeVelocityMetrics([], [], [], f1, NOW));
  eq("cache: pre-create entry exists", _cacheSize(), 1);
  const created = await createProject(
    {
      name: "Hook test project",
      description: "x",
      application_product: "Automated Insights",
      project_type: "New Application",
      priority: "Medium",
      status: "Not Started",
      phase: "Qualification",
      primary_stakeholders: [],
      project_lead: admin.user_id,
      additional_resources: [],
      resource_allocations: {},
      target_date: null,
      roadmap_bucket: null,
      roadmap_timeline_start: null,
      depends_on: [],
      dependencies: [],
      external_dependencies: [],
      document_links: [],
      custom_fields: {},
    },
    { createdBy: admin.user_id },
  );
  eq("cache: createProject blew the cache", _cacheSize(), 0);

  // updateProject
  setCachedVelocityMetrics(f1, computeVelocityMetrics([], [], [], f1, NOW));
  await updateProject(created.project_id, { status: "In Progress" }, { userId: admin.user_id });
  eq("cache: updateProject blew the cache", _cacheSize(), 0);

  // createTask
  setCachedVelocityMetrics(f1, computeVelocityMetrics([], [], [], f1, NOW));
  const task = await createTask(
    {
      project_id: created.project_id,
      task_name: "Hook test task",
      detailed_description: "",
      status: "Not Started",
      priority: "Medium",
      responsible: admin.user_id,
      additional_assignees: [],
      target_date: null,
      blocked: false,
      blocker_issue_task: "",
      comments: "",
      document_links: [],
    },
    { createdBy: admin.user_id },
  );
  eq("cache: createTask blew the cache", _cacheSize(), 0);

  // updateTask
  setCachedVelocityMetrics(f1, computeVelocityMetrics([], [], [], f1, NOW));
  await updateTask(task.task_id, { status: "Complete" }, { userId: admin.user_id });
  eq("cache: updateTask blew the cache", _cacheSize(), 0);

  // deleteTask
  setCachedVelocityMetrics(f1, computeVelocityMetrics([], [], [], f1, NOW));
  await deleteTask(task.task_id);
  eq("cache: deleteTask blew the cache", _cacheSize(), 0);

  // deleteProject
  setCachedVelocityMetrics(f1, computeVelocityMetrics([], [], [], f1, NOW));
  await deleteProject(created.project_id);
  eq("cache: deleteProject blew the cache", _cacheSize(), 0);

  // ---- 6. End-to-end orchestration -------------------------------------

  section("End-to-end orchestration");

  await ProjectRepository.delete(created.project_id).catch(() => {
    // already gone
  });
  // Drain notifications/tasks/projects so we orchestrate over a known state.
  for (const p of await ProjectRepository.getAll()) {
    await ProjectRepository.delete(p.project_id);
  }
  for (const t of await TaskRepository.getAll()) {
    await TaskRepository.delete(t.task_id);
  }
  for (const n of await NotificationRepository.getAll()) {
    await NotificationRepository.delete(n.notification_id);
  }

  // Build a small, controlled portfolio.
  const portfolio: Project[] = [
    mkProject({
      project_id: "2026-100",
      status: "Completed",
      date_added: "2026-01-01",
      updated_at: "2026-02-15T00:00:00Z",
      ai_time_estimate: "6 weeks",
      project_type: "New Application",
    }),
    mkProject({
      project_id: "2026-101",
      status: "Completed",
      date_added: "2026-01-15",
      updated_at: "2026-03-01T00:00:00Z",
      ai_time_estimate: "4-6 weeks",
      project_type: "New Feature",
    }),
    mkProject({
      project_id: "2026-102",
      status: "In Progress",
      date_added: "2026-02-01",
      updated_at: "2026-04-15T00:00:00Z",
      project_type: "Enhancement",
    }),
  ];
  const portfolioTasks: Task[] = [
    mkTask({ task_id: "26-9001", project_id: "2026-100", status: "Complete", updated_at: "2026-02-10T00:00:00Z" }),
    mkTask({ task_id: "26-9002", project_id: "2026-100", status: "Complete", updated_at: "2026-02-12T00:00:00Z" }),
    mkTask({ task_id: "26-9003", project_id: "2026-101", status: "Complete", updated_at: "2026-02-25T00:00:00Z" }),
  ];
  const portfolioIdeas: ProjectIdea[] = [
    mkIdea({ idea_id: "id-1", status: "Converted", submitted_at: "2026-02-01T00:00:00Z" }),
    mkIdea({ idea_id: "id-2", status: "New", submitted_at: "2026-03-15T00:00:00Z" }),
  ];

  const fullMetrics = computeVelocityMetrics(
    portfolio,
    portfolioTasks,
    portfolioIdeas,
    defaultFilters({ range: rangeAll }),
    NOW,
  );

  eq("e2e: total completed", fullMetrics.completed_by_quarter.total_completed, 2);
  eq("e2e: avg time sample", fullMetrics.avg_time_to_completion.sample_size, 2);
  eq("e2e: estimated_vs_actual sample", fullMetrics.estimated_vs_actual.sample_size, 2);
  eq("e2e: task throughput total", fullMetrics.task_throughput.total_completed, 3);
  eq("e2e: idea conversion rate (1/2 = 50)", fullMetrics.idea_conversion.conversion_rate, 50);
  // 2 completed projects < 3 → insufficient_history flag should be true.
  check("e2e: insufficient_history at <3 completed", fullMetrics.insufficient_history);

  // Filter options surface the distinct values.
  check(
    "e2e: filter_options includes project lead",
    fullMetrics.filter_options.project_leads.some((l) => l.user_id === "user-A"),
  );
  check(
    "e2e: filter_options includes Automated Insights product",
    fullMetrics.filter_options.application_products.includes("Automated Insights"),
  );

  // Hit the >=3 threshold to flip the calibration banner off.
  const wider: Project[] = [
    ...portfolio,
    mkProject({
      project_id: "2026-103",
      status: "Completed",
      date_added: "2026-01-15",
      updated_at: "2026-03-15T00:00:00Z",
      project_type: "New Application",
    }),
  ];
  const widerMetrics = computeVelocityMetrics(
    wider,
    portfolioTasks,
    portfolioIdeas,
    defaultFilters({ range: rangeAll }),
    NOW,
  );
  check(
    "e2e: insufficient_history flips off at >=3",
    !widerMetrics.insufficient_history,
  );

  // ---- Done -------------------------------------------------------------

  console.log(`\n${passed} checks passed.`);
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
