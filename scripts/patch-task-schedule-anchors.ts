/**
 * One-off patch: retroactively mark the two release-calendar milestone
 * tasks on an already-instantiated project with `friday_anchor` /
 * `fixed_lag_business_days_after` / `drives_project_date`, then recompute
 * the schedule (which also pushes the corrected dates onto the project's
 * Target Application/Executable Deployment Date fields).
 *
 * Exists because re-running "Apply template" on a project that already
 * has tasks duplicates all of them (not idempotent by design). For a
 * project instantiated from the Visualization template BEFORE migration
 * 0031/0032 or the friday_anchor/drives_project_date fixes landed, this
 * patches just the two milestone tasks in place instead.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/patch-task-schedule-anchors.ts <project_id>
 *
 * Prereqs: migrations 0031_task_schedule_anchors.sql and
 * 0032_task_drives_project_date.sql must already be applied — this will
 * fail with a "column not found" error otherwise.
 */

import { ProjectRepository, TaskRepository } from "../lib/db";
import { rescheduleProjectTasks } from "../lib/tasks/service";

const EXECUTABLE_TASK_NAME = "Version, changelog, build, deploy";
const APPLICATION_TASK_NAME = "Application deployed";
const LAG_BUSINESS_DAYS = 5;

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    throw new Error(
      "Usage: npx tsx --env-file=.env.local scripts/patch-task-schedule-anchors.ts <project_id>",
    );
  }

  const tasks = await TaskRepository.getByProjectId(projectId);
  if (tasks.length === 0) {
    throw new Error(`No tasks found for project ${projectId}.`);
  }

  const executable = tasks.find((t) => t.task_name === EXECUTABLE_TASK_NAME);
  const application = tasks.find((t) => t.task_name === APPLICATION_TASK_NAME);
  if (!executable) {
    throw new Error(`Could not find a task named "${EXECUTABLE_TASK_NAME}" on ${projectId}.`);
  }
  if (!application) {
    throw new Error(`Could not find a task named "${APPLICATION_TASK_NAME}" on ${projectId}.`);
  }

  await TaskRepository.update(executable.task_id, {
    friday_anchor: true,
    drives_project_date: "target_executable_deployment_date",
  });
  console.log(
    `Marked "${executable.task_name}" (${executable.task_id}) as a Friday anchor driving target_executable_deployment_date.`,
  );

  await TaskRepository.update(application.task_id, {
    friday_anchor: true,
    fixed_lag_business_days_after: {
      task_id: executable.task_id,
      business_days: LAG_BUSINESS_DAYS,
    },
    drives_project_date: "target_date",
  });
  console.log(
    `Marked "${application.task_name}" (${application.task_id}) as a Friday anchor, fixed ${LAG_BUSINESS_DAYS} business days after ${executable.task_id}, driving target_date.`,
  );

  await rescheduleProjectTasks(projectId);
  console.log("Recomputed the project's schedule and synced the project's deployment dates.");

  const after = await TaskRepository.getByProjectId(projectId);
  const executableAfter = after.find((t) => t.task_id === executable.task_id);
  const applicationAfter = after.find((t) => t.task_id === application.task_id);
  const project = await ProjectRepository.getById(projectId);
  console.log(`\n${EXECUTABLE_TASK_NAME}: ${executableAfter?.target_date ?? "(no date)"}`);
  console.log(`${APPLICATION_TASK_NAME}: ${applicationAfter?.target_date ?? "(no date)"}`);
  console.log(`\nProject target_executable_deployment_date: ${project?.target_executable_deployment_date ?? "(no date)"}`);
  console.log(`Project target_date: ${project?.target_date ?? "(no date)"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
