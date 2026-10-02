/**
 * One-off patch: retroactively mark the two release-calendar milestone
 * tasks on an already-instantiated project with `friday_anchor` /
 * `fixed_lag_business_days_after`, then recompute the schedule.
 *
 * Exists because re-running "Apply template" on a project that already
 * has tasks duplicates all of them (not idempotent by design). For a
 * project instantiated from the Visualization template BEFORE migration
 * 0031 / the friday_anchor fix landed, this patches just the two
 * milestone tasks in place instead.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/patch-task-schedule-anchors.ts <project_id>
 *
 * Prereqs: migration 0031_task_schedule_anchors.sql must already be
 * applied — this will fail with a "column not found" error otherwise.
 */

import { TaskRepository } from "../lib/db";
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

  await TaskRepository.update(executable.task_id, { friday_anchor: true });
  console.log(`Marked "${executable.task_name}" (${executable.task_id}) as a Friday anchor.`);

  await TaskRepository.update(application.task_id, {
    friday_anchor: true,
    fixed_lag_business_days_after: {
      task_id: executable.task_id,
      business_days: LAG_BUSINESS_DAYS,
    },
  });
  console.log(
    `Marked "${application.task_name}" (${application.task_id}) as a Friday anchor, fixed ${LAG_BUSINESS_DAYS} business days after ${executable.task_id}.`,
  );

  await rescheduleProjectTasks(projectId);
  console.log("Recomputed the project's schedule.");

  const after = await TaskRepository.getByProjectId(projectId);
  const executableAfter = after.find((t) => t.task_id === executable.task_id);
  const applicationAfter = after.find((t) => t.task_id === application.task_id);
  console.log(`\n${EXECUTABLE_TASK_NAME}: ${executableAfter?.target_date ?? "(no date)"}`);
  console.log(`${APPLICATION_TASK_NAME}: ${applicationAfter?.target_date ?? "(no date)"}`);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
