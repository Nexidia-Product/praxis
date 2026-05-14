/**
 * Functional smoke test for Step 7 — Notifications (Section 5.12).
 *
 * Five slices are exercised against a fresh temp data dir:
 *
 *   1. `lib/notifications/service.ts` low-level write — preferences resolve
 *      correctly, Off skips persistence, message bodies look right.
 *   2. Project status-change hook — moving a project to Blocked notifies
 *      stakeholders; non-Blocked moves are silent.
 *   3. Task assignment hook — creating with a UUID `responsible` notifies
 *      that user; reassignment notifies the new owner.
 *   4. Dependency-blocked propagation — moving an upstream project to
 *      Blocked notifies the stakeholders of every downstream dependent.
 *   5. Daily sweep — synthetic past-due / due-soon tasks are picked up,
 *      idempotency check stops a second sweep from duplicating, and
 *      digest dispatch counts the expected user.
 *
 * Each test runs against IIM_DATA_DIR to leave the repo's real data
 * alone. Email dispatch falls through to console-log because no
 * RESEND_API_KEY is configured.
 *
 * Usage:
 *   npx tsx scripts/smoke-notifications.ts
 *
 * Exits non-zero on the first assertion failure.
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const scratch = mkdtempSync(path.join(tmpdir(), "iim-step7-smoke-"));
process.env.IIM_DATA_DIR = scratch;
// Make sure the in-process scheduler doesn't try to fire while we run.
process.env.IIM_DISABLE_SCHEDULER = "1";

async function main() {
  // Deferred imports so IIM_DATA_DIR is set before any module reads it.
  const {
    NotificationRepository,
    ProjectRepository,
    TaskRepository,
    UserRepository,
    SettingsRepository,
  } = await import("../lib/db");
  const {
    createNotification,
    notifyTaskAssigned,
    notifyProjectStatusChange,
    notifyDependencyBlocked,
    notifyHealthScoreDegraded,
    isDegradation,
    listForUser,
    listUnreadForUser,
    markRead,
    markAllReadForUser,
    updatePreferences,
  } = await import("../lib/notifications/service");
  const {
    createProject,
    updateProject,
  } = await import("../lib/projects/service");
  const {
    createTask,
    updateTask,
  } = await import("../lib/tasks/service");
  const {
    runDailySweep,
  } = await import("../lib/notifications/sweep");

  type Notification = import("../lib/db").Notification;
  type NotificationPreferences = import("../lib/db").NotificationPreferences;
  type Project = import("../lib/db").Project;
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

  // node-cron uses real UUIDs as user IDs, but the look-like-UUID heuristic
  // accepts any "long hex with hyphens" string, so we use those for the
  // synthetic users below to keep the smoke test independent of `crypto`.
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

  async function makeUser(opts: {
    name: string;
    email?: string;
    prefs?: Partial<NotificationPreferences>;
    digest_mode?: boolean;
    active?: boolean;
  }): Promise<User> {
    return UserRepository.create({
      email: opts.email ?? `${opts.name}@example.com`.toLowerCase(),
      name: opts.name,
      role: "Project Lead",
      active: opts.active ?? true,
      notification_preferences: { ...defaultPrefs, ...(opts.prefs ?? {}) },
      digest_mode: opts.digest_mode ?? false,
    });
  }

  async function getNotificationsFor(userId: string) {
    return NotificationRepository.getByUserId(userId);
  }

  // -----------------------------------------------------------------------
  // Slice 1: low-level write + preferences
  // -----------------------------------------------------------------------

  console.log("\n[1/5] low-level write + preferences");

  const alice = await makeUser({ name: "Alice" });
  const bob = await makeUser({
    name: "Bob",
    prefs: { TaskAssigned: "Off" },
  });
  const carol = await makeUser({ name: "Carol", active: false });

  // Alice: defaults → write happens.
  const aliceWrite = await createNotification({
    userId: alice.user_id,
    type: "TaskAssigned",
    message: "Hello",
    entityType: "Task",
    entityId: "26-0001",
  });
  check("alice receives notification", aliceWrite !== null);
  const aliceFeed = await getNotificationsFor(alice.user_id);
  eq("alice has one row", aliceFeed.length, 1);
  eq("row carries the message", aliceFeed[0].message, "Hello");
  eq("row defaults read=false", aliceFeed[0].read, false);

  // Bob's saved "Off" is treated as "InAppOnly" — see resolveDelivery in
  // lib/notifications/service.ts. Users are no longer allowed to fully
  // suppress notifications; this asserts that legacy records still
  // produce in-app entries despite carrying a now-disallowed value.
  const bobWrite = await createNotification({
    userId: bob.user_id,
    type: "TaskAssigned",
    message: "Hello",
    entityType: "Task",
    entityId: "26-0001",
  });
  check("bob's legacy Off is migrated to InAppOnly", bobWrite !== null);
  const bobFeed = await getNotificationsFor(bob.user_id);
  eq("bob has one row from migrated pref", bobFeed.length, 1);

  // Bob still gets non-Off types — sanity check that the migration
  // doesn't blow away other prefs.
  const bobOther = await createNotification({
    userId: bob.user_id,
    type: "ProjectBlocked",
    message: "Hi",
    entityType: "Project",
    entityId: "2026-001",
  });
  check("bob receives ProjectBlocked normally", bobOther !== null);

  // Deactivated user: no write.
  const carolWrite = await createNotification({
    userId: carol.user_id,
    type: "TaskAssigned",
    message: "Hi",
    entityType: "Task",
    entityId: "26-0002",
  });
  eq("deactivated user is skipped", carolWrite, null);

  // Unknown user: no error, no write.
  const ghostWrite = await createNotification({
    userId: "no-such-user",
    type: "TaskAssigned",
    message: "Hi",
    entityType: "Task",
    entityId: "26-0003",
  });
  eq("missing user returns null silently", ghostWrite, null);

  // Mark-read.
  const markedRead = await markRead(alice.user_id, aliceFeed[0].notification_id);
  eq("mark-read returns the row", markedRead?.read, true);
  const aliceUnread = await listUnreadForUser(alice.user_id);
  eq("alice has 0 unread after mark-read", aliceUnread.length, 0);

  // Cross-user mark-read is forbidden.
  const crossRead = await markRead(bob.user_id, aliceFeed[0].notification_id);
  eq("cross-user mark-read returns null", crossRead, null);

  // Mark-all-read.
  await createNotification({
    userId: alice.user_id,
    type: "TaskOverdue",
    message: "x",
    entityType: "Task",
    entityId: "26-0001",
  });
  await createNotification({
    userId: alice.user_id,
    type: "TaskDueSoon",
    message: "y",
    entityType: "Task",
    entityId: "26-0002",
  });
  const markedCount = await markAllReadForUser(alice.user_id);
  eq("mark-all-read returns count", markedCount, 2);
  const aliceAfter = await listForUser(alice.user_id);
  check(
    "no row remains unread for alice",
    aliceAfter.every((n) => n.read),
  );

  // -----------------------------------------------------------------------
  // Slice 2: project status-change hook
  // -----------------------------------------------------------------------

  console.log("\n[2/5] project status-change hook");

  const dave = await makeUser({ name: "Dave" });
  const eve = await makeUser({ name: "Eve" });
  const frank = await makeUser({ name: "Frank" });

  const proj = await createProject(
    {
      name: "Test project",
      description: "x",
      application_product: "Insights",
      project_type: "Enhancement",
      priority: "Medium",
      status: "In Progress",
      phase: "Planning",
      primary_stakeholders: [],
      project_lead: dave.user_id,
      additional_resources: [eve.user_id, "Min"],
      target_date: null,
    },
    { createdBy: dave.user_id },
  );

  // No notifications expected — created In Progress, not Blocked.
  const initialDave = await getNotificationsFor(dave.user_id);
  eq(
    "create as In Progress: no project notifications",
    initialDave.length,
    0,
  );

  // Move to Blocked: notifies dave + eve, not Frank (not on the project),
  // not "Min" (free-form name, no resolved user).
  //
  // Step 8 update: this transition also causes the project's health
  // score to drop from Green to Red, which fires a separate
  // HealthScoreChanged notification. We use `find()` rather than
  // `[0]` to assert because both notifications are present and
  // their relative ordering is not contractually fixed.
  await updateProject(proj.project_id, { status: "Blocked" }, {
    userId: dave.user_id,
  });
  const daveAfter = await getNotificationsFor(dave.user_id);
  const eveAfter = await getNotificationsFor(eve.user_id);
  const frankAfter = await getNotificationsFor(frank.user_id);
  check(
    "dave got ProjectBlocked",
    daveAfter.some((n) => n.type === "ProjectBlocked"),
  );
  check(
    "dave also got HealthScoreChanged (Step 8)",
    daveAfter.some((n) => n.type === "HealthScoreChanged"),
  );
  check(
    "eve got ProjectBlocked",
    eveAfter.some((n) => n.type === "ProjectBlocked"),
  );
  eq("frank got nothing", frankAfter.length, 0);

  // Move from Blocked to In Progress: no NEW project-status notification
  // (recoveries are silent for ProjectBlocked). Step 8 note:
  // recalculateAndPersist evaluates Red→Green via isDegradation, which
  // returns false for recoveries, so no new HealthScoreChanged either.
  await updateProject(proj.project_id, { status: "In Progress" }, {
    userId: dave.user_id,
  });
  const daveRecovered = await getNotificationsFor(dave.user_id);
  eq(
    "recovery does not add a row",
    daveRecovered.length,
    daveAfter.length,
  );

  // -----------------------------------------------------------------------
  // Slice 3: task assignment hook
  // -----------------------------------------------------------------------

  console.log("\n[3/5] task assignment hook");

  const grace = await makeUser({ name: "Grace" });
  const hank = await makeUser({ name: "Hank" });

  const task = await createTask(
    {
      project_id: proj.project_id,
      task_name: "Do the thing",
      detailed_description: "",
      status: "Not Started",
      priority: "Medium",
      responsible: grace.user_id,
      additional_assignees: [],
      target_date: null,
      blocked: false,
      blocker_issue_task: "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
    },
    { createdBy: dave.user_id },
  );
  const graceFeed = await getNotificationsFor(grace.user_id);
  eq("grace got TaskAssigned on create", graceFeed[0]?.type, "TaskAssigned");
  check(
    "TaskAssigned message names the task",
    graceFeed[0].message.includes("Do the thing"),
  );

  // Reassign to Hank — Hank notified, Grace's count unchanged.
  await updateTask(task.task_id, { responsible: hank.user_id }, {
    userId: dave.user_id,
  });
  const hankFeed = await getNotificationsFor(hank.user_id);
  const graceAfter = await getNotificationsFor(grace.user_id);
  eq("hank got TaskAssigned on reassign", hankFeed[0]?.type, "TaskAssigned");
  eq(
    "grace's count unchanged on reassignment to others",
    graceAfter.length,
    graceFeed.length,
  );

  // No-op update (status only) does not re-notify.
  const hankBefore = (await getNotificationsFor(hank.user_id)).length;
  await updateTask(task.task_id, { status: "In Progress" }, {
    userId: dave.user_id,
  });
  const hankNoop = (await getNotificationsFor(hank.user_id)).length;
  eq("status-only edit does not re-notify hank", hankNoop, hankBefore);

  // -----------------------------------------------------------------------
  // Slice 4: dependency-blocked propagation
  // -----------------------------------------------------------------------

  console.log("\n[4/5] dependency propagation");

  const upstream = await createProject(
    {
      name: "Upstream",
      description: "",
      application_product: "Insights",
      project_type: "Enhancement",
      priority: "Medium",
      status: "In Progress",
      phase: "Planning",
      primary_stakeholders: [],
      project_lead: dave.user_id,
      additional_resources: [],
      target_date: null,
    },
    { createdBy: dave.user_id },
  );

  const downstream = await createProject(
    {
      name: "Downstream",
      description: "",
      application_product: "Insights",
      project_type: "Enhancement",
      priority: "Medium",
      status: "In Progress",
      phase: "Planning",
      primary_stakeholders: [],
      project_lead: frank.user_id,
      additional_resources: [grace.user_id],
      target_date: null,
      depends_on: [upstream.project_id],
    },
    { createdBy: dave.user_id },
  );
  // Sanity: downstream is wired to upstream.
  const downstreamRecord = await ProjectRepository.getById(
    downstream.project_id,
  );
  eq(
    "downstream depends_on includes upstream",
    downstreamRecord?.depends_on.includes(upstream.project_id),
    true,
  );

  // Snapshot frank/grace counts.
  const frankBefore = (await getNotificationsFor(frank.user_id)).length;
  const graceDepBefore = (await getNotificationsFor(grace.user_id)).length;

  // Move upstream to On Hold: should notify frank + grace.
  //
  // Step 8 update: this transition also degrades the downstream's
  // health score (clear → at-risk → Yellow), so frank/grace also each
  // get a `HealthScoreChanged` row. We assert presence with `find()`
  // rather than `[0]` because both notification types are present and
  // their relative ordering is not contractually fixed. The exact +N
  // count is not asserted because the upstream/downstream cascade can
  // add either 1 or 2 rows per recipient depending on whether the
  // upstream's score also degraded.
  await updateProject(upstream.project_id, { status: "On Hold" }, {
    userId: dave.user_id,
  });
  const frankDepFeed = await getNotificationsFor(frank.user_id);
  const graceDepFeed = await getNotificationsFor(grace.user_id);
  check(
    "frank got DependencyBlocked",
    frankDepFeed.some((n) => n.type === "DependencyBlocked"),
  );
  check(
    "grace got DependencyBlocked",
    graceDepFeed.some((n) => n.type === "DependencyBlocked"),
  );
  check(
    "frank's notif count grew",
    frankDepFeed.length > frankBefore,
  );
  check(
    "grace's notif count grew",
    graceDepFeed.length > graceDepBefore,
  );

  // No-op re-save (still On Hold) does not re-fire.
  // (Same applies to HealthScoreChanged: the score doesn't change, so
  // recalculateAndPersist sees prior === next and skips the notification.)
  await updateProject(upstream.project_id, { status: "On Hold" }, {
    userId: dave.user_id,
  });
  const frankNoop = (await getNotificationsFor(frank.user_id)).length;
  eq(
    "no-op resave does not re-notify frank",
    frankNoop,
    frankDepFeed.length,
  );

  // -----------------------------------------------------------------------
  // Slice 5: daily sweep
  // -----------------------------------------------------------------------

  console.log("\n[5/5] daily sweep");

  // Build a task whose target_date is yesterday: should appear in overdue.
  const yesterday = new Date(Date.now() - 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const overdueTask = await createTask(
    {
      project_id: proj.project_id,
      task_name: "Old task",
      detailed_description: "",
      status: "In Progress",
      priority: "Medium",
      responsible: grace.user_id,
      additional_assignees: [],
      target_date: yesterday,
      blocked: false,
      blocker_issue_task: "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
    },
    { createdBy: dave.user_id },
  );
  // Capture grace's count BEFORE the sweep, AFTER the create-task
  // notification fires. The create itself sent grace a TaskAssigned;
  // the sweep should add TaskOverdue.
  const graceBeforeSweep = (await getNotificationsFor(grace.user_id)).length;

  // A task due in 2 days: should appear in due-soon.
  const inTwoDays = new Date(Date.now() + 2 * 24 * 3600 * 1000)
    .toISOString()
    .slice(0, 10);
  const dueSoonTask = await createTask(
    {
      project_id: proj.project_id,
      task_name: "Soon task",
      detailed_description: "",
      status: "Not Started",
      priority: "Medium",
      responsible: hank.user_id,
      additional_assignees: [],
      target_date: inTwoDays,
      blocked: false,
      blocker_issue_task: "",
      blocker_type: null,
      blocker_task_id: null,
      blocker_project_id: null,
      comments: "",
    },
    { createdBy: dave.user_id },
  );
  const hankBeforeSweep = (await getNotificationsFor(hank.user_id)).length;

  // First sweep.
  const result1 = await runDailySweep();
  check("sweep wrote ≥1 overdue notification", result1.overdue_notified >= 1);
  check("sweep wrote ≥1 due-soon notification", result1.due_soon_notified >= 1);

  const graceAfterSweep = await getNotificationsFor(grace.user_id);
  const hankAfterSweep = await getNotificationsFor(hank.user_id);
  check(
    "grace has at least one TaskOverdue row",
    graceAfterSweep.some(
      (n) => n.type === "TaskOverdue" && n.entity_id === overdueTask.task_id,
    ),
  );
  check(
    "hank has at least one TaskDueSoon row",
    hankAfterSweep.some(
      (n) => n.type === "TaskDueSoon" && n.entity_id === dueSoonTask.task_id,
    ),
  );

  // Second sweep — idempotent: counts should not grow.
  const result2 = await runDailySweep();
  eq(
    "second sweep does not duplicate due-soon",
    result2.due_soon_notified,
    0,
  );
  eq(
    "second sweep does not duplicate overdue",
    result2.overdue_notified,
    0,
  );

  // Digest user — flip on digest_mode for hank with EmailAndInApp on
  // TaskDueSoon, then run sweep. Without RESEND_API_KEY we expect
  // dispatch to log + return delivered=false; the sweep counts only
  // delivered. So the assertion is: digest count is 0 in the no-key
  // scenario, but the digest-eligible user is correctly identified
  // (no exception, sweep completes).
  await UserRepository.update(hank.user_id, {
    digest_mode: true,
    notification_preferences: {
      ...defaultPrefs,
      TaskDueSoon: "EmailAndInApp",
    },
  });
  const result3 = await runDailySweep();
  eq(
    "no resend key → digest reports 0 delivered",
    result3.digests_sent,
    0,
  );

  // Preference update via the service surface.
  const updatedPrefs = await updatePreferences(
    grace.user_id,
    { TaskOverdue: "Off" },
    true,
  );
  eq(
    "updatePreferences honors per-type patch",
    updatedPrefs.preferences.TaskOverdue,
    "Off",
  );
  eq("updatePreferences honors digest_mode", updatedPrefs.digest_mode, true);

  // Health-score helper (Step 8 will use this).
  eq("Green→Yellow is degradation", isDegradation("Green", "Yellow"), true);
  eq("Yellow→Red is degradation", isDegradation("Yellow", "Red"), true);
  eq("Yellow→Green is recovery (false)", isDegradation("Yellow", "Green"), false);
  eq("null prior + Yellow → degradation", isDegradation(null, "Yellow"), true);
  eq("null prior + Green → not", isDegradation(null, "Green"), false);

  // Health-score notification at the service level fires only on degradation.
  const projForHealth = await ProjectRepository.getById(proj.project_id) as Project;
  await notifyHealthScoreDegraded({
    project: projForHealth,
    priorScore: "Green",
    newScore: "Red",
  });
  const daveAfterHealth = await getNotificationsFor(dave.user_id);
  check(
    "dave got HealthScoreChanged on Green→Red",
    daveAfterHealth.some((n) => n.type === "HealthScoreChanged"),
  );

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
