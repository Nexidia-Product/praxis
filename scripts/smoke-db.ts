/**
 * Functional smoke test for the data access layer. Runs all seven entity
 * repositories plus settings against a fresh temp directory, verifying
 * round-trip CRUD behavior, ID generation, and dependency cleanup.
 *
 * Run with:
 *   npx tsx scripts/smoke-db.ts
 *
 * Exits non-zero on first assertion failure. Not part of the production
 * build; this lives outside `lib/` and is excluded from `tsc --noEmit`
 * via tsconfig (or just runs as a one-off via tsx).
 */

import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

// Point the data layer at a fresh scratch dir BEFORE importing it. The
// store reads `process.env.IIM_DATA_DIR` lazily, so this works.
const scratch = mkdtempSync(path.join(tmpdir(), "iim-smoke-"));
process.env.IIM_DATA_DIR = scratch;

async function main() {
  const {
    ProjectRepository,
    TaskRepository,
    IdeaRepository,
    UserRepository,
    NotificationRepository,
    DecisionRepository,
    TemplateRepository,
    SettingsRepository,
  } = await import("../lib/db");

  function check(label: string, cond: unknown): void {
    if (!cond) {
      console.error(`FAIL: ${label}`);
      process.exit(1);
    }
    console.log(`  ok  ${label}`);
  }

  console.log("Users");
  const admin = await UserRepository.create({
    email: " [email protected] ",
    name: "Admin",
    role: "Admin",
    active: true,
    notification_preferences: {
      TaskAssigned: "InAppOnly",
      TaskDueSoon: "InAppOnly",
      TaskOverdue: "InAppOnly",
      ProjectBlocked: "InAppOnly",
      DependencyBlocked: "InAppOnly",
      HealthScoreChanged: "InAppOnly",
      IdeaStatusChanged: "Off",
    },
    digest_mode: false,
  });
  check("user email is normalized to lowercase", admin.email === "[email protected]");
  const found = await UserRepository.getByEmail("[email protected]");
  check("user lookup by email is case-insensitive", found?.user_id === admin.user_id);
  const pub = await UserRepository.getByIdPublic(admin.user_id);
  check("public user has no password_hash", pub !== null && !("password_hash" in pub));

  console.log("Projects");
  const baseProject = {
    name: "Sample",
    description: "Sample project",
    application_product: "Insights",
    project_type: "New Application" as const,
    priority: "High" as const,
    status: "Not Started" as const,
    phase: "Qualification" as const,
    primary_stakeholders: [],
    project_lead: admin.user_id,
    additional_resources: [],
    resource_allocations: {},
    target_date: null,
    ai_complexity_score: null,
    ai_time_estimate: null,
    roadmap_bucket: null,
    roadmap_timeline_start: null,
    github_issue_id: null,
    jira_issue_id: null,
    depends_on: [],
    dependencies: [],
    external_dependencies: [],
    document_links: [],
    custom_fields: {},
    created_by: admin.user_id,
  };
  const p1 = await ProjectRepository.create(baseProject);
  const p2 = await ProjectRepository.create(baseProject);
  const p3 = await ProjectRepository.create({
    ...baseProject,
    depends_on: [p1.project_id],
    dependencies: [
      { upstream_id: p1.project_id, type: "Blocks Start", required_phase: null },
    ],
  });
  const year = new Date().getUTCFullYear();
  check("project IDs follow YYYY-NNN", p1.project_id === `${year}-001`);
  check("project IDs increment", p2.project_id === `${year}-002`);
  check("third project allocated", p3.project_id === `${year}-003`);

  await ProjectRepository.update(p2.project_id, { status: "In Progress" });
  const p2re = await ProjectRepository.getById(p2.project_id);
  check("project update persists", p2re?.status === "In Progress");
  check("updated_at advances on update", p2re !== null && p2re.updated_at >= p2.updated_at);

  await ProjectRepository.delete(p1.project_id);
  const p3re = await ProjectRepository.getById(p3.project_id);
  check(
    "deleting upstream prunes depends_on on dependents",
    p3re !== null && p3re.depends_on.length === 0,
  );
  check(
    "deleting upstream prunes dependencies array on dependents",
    p3re !== null && p3re.dependencies.length === 0,
  );

  console.log("Tasks");
  const t1 = await TaskRepository.create({
    project_id: p2.project_id,
    task_name: "First task",
    detailed_description: "",
    status: "Not Started",
    priority: "Medium",
    responsible: admin.user_id,
    additional_assignees: [],
    target_date: null,
    blocked: false,
    blocker_issue_task: "",
    blocker_type: null,
    blocker_task_id: null,
    blocker_project_id: null,
    comment_history: [],
    comments: "",
    document_links: [],
    template_id: null,
  });
  const yy = String(year % 100).padStart(2, "0");
  check("task IDs follow YY-NNNN", t1.task_id === `${yy}-0001`);
  const tasksByProject = await TaskRepository.getByProjectId(p2.project_id);
  check("getByProjectId returns the task", tasksByProject.length === 1);

  console.log("Ideas");
  const idea = await IdeaRepository.create({
    submitter_name: "Test",
    submitter_email: null,
    idea_name: "An idea",
    description: "Some description",
    urgency: "Medium",
    requested_target_date: null,
    key_stakeholders: "",
  });
  check("idea defaults to status New", idea.status === "New");
  check("idea has UUID", idea.idea_id.length === 36);

  console.log("Notifications");
  const notif = await NotificationRepository.create({
    user_id: admin.user_id,
    type: "TaskAssigned",
    message: "You were assigned a task",
    entity_type: "Task",
    entity_id: t1.task_id,
  });
  check("notification defaults read=false", notif.read === false);
  await NotificationRepository.markRead(notif.notification_id);
  const after = await NotificationRepository.getById(notif.notification_id);
  check("markRead flips read flag", after?.read === true);

  console.log("Decisions");
  const dec = await DecisionRepository.create({
    project_id: p2.project_id,
    entry_date: "2026-04-20",
    decision_summary: "Test decision",
    rationale: "Because.",
    made_by: admin.user_id,
    decision_type: "Scope Change",
  });
  const decs = await DecisionRepository.getByProjectId(p2.project_id);
  check("decision entry retrievable by project", decs[0]?.entry_id === dec.entry_id);

  console.log("Templates");
  const tmpl = await TemplateRepository.create({
    template_name: "Standard",
    project_type: "New Application",
    tasks: [
      { name: "Kickoff", description: "", default_priority: "High" },
      { name: "Closeout", description: "", default_priority: "Medium" },
    ],
    created_by: admin.user_id,
  });
  const byType = await TemplateRepository.getByProjectType("New Application");
  check("template retrievable by project type", byType[0]?.template_id === tmpl.template_id);

  console.log("Settings");
  const def = await SettingsRepository.get();
  check(
    "settings defaults match doc (Yellow=20, Red=40)",
    def.health_score_thresholds.yellow_blocked_or_overdue_pct === 20 &&
      def.health_score_thresholds.red_blocked_or_overdue_pct === 40,
  );
  await SettingsRepository.update({
    branding: { logo_url: null, primary_color: "#000", secondary_color: "#fff", font: "Arial" },
  });
  const after2 = await SettingsRepository.get();
  check("settings update persists", after2.branding.font === "Arial");
  check(
    "settings update preserves un-patched fields",
    after2.health_score_thresholds.yellow_blocked_or_overdue_pct === 20,
  );

  console.log("\nAll smoke checks passed.");
}

main()
  .catch((err) => {
    console.error(err);
    process.exit(1);
  })
  .finally(() => {
    rmSync(scratch, { recursive: true, force: true });
  });
