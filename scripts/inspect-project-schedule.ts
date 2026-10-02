/**
 * Diagnostic: print every task on a project with the exact fields the
 * scheduler (`lib/tasks/schedule.ts`) reads, plus what it WOULD compute
 * right now vs. what's actually stored — so a scheduling discrepancy can
 * be pinpointed from real data instead of guessed at.
 *
 * Run with:
 *   npx tsx --env-file=.env.local scripts/inspect-project-schedule.ts <project_id>
 */

import { ProjectRepository, TaskRepository, type TaskId } from "../lib/db";
import { durationBusinessDays, scheduleTaskDates } from "../lib/tasks/schedule";

async function main() {
  const projectId = process.argv[2];
  if (!projectId) {
    throw new Error(
      "Usage: npx tsx --env-file=.env.local scripts/inspect-project-schedule.ts <project_id>",
    );
  }

  const project = await ProjectRepository.getById(projectId);
  if (!project) throw new Error(`Project ${projectId} not found.`);
  const tasks = await TaskRepository.getByProjectId(projectId);
  if (tasks.length === 0) {
    console.log(`Project ${projectId} has no tasks.`);
    return;
  }

  const nameById = new Map(tasks.map((t) => [t.task_id, t.task_name]));

  console.log(`Project ${projectId} — roadmap_timeline_start (Start date): ${project.roadmap_timeline_start ?? "(not set)"}`);
  console.log(`  target_date (Target Application Deployment Date): ${project.target_date ?? "(not set)"}`);
  console.log(`  target_executable_deployment_date: ${project.target_executable_deployment_date ?? "(not set)"}\n`);

  const recomputed = scheduleTaskDates(
    project.roadmap_timeline_start,
    tasks.map((t) => ({
      task_id: t.task_id,
      estimate_hours: t.estimate_hours,
      dependencies: t.dependencies,
      friday_anchor: t.friday_anchor,
      fixed_lag_business_days_after: t.fixed_lag_business_days_after,
      current_target_date: t.target_date,
    })),
    { respectCurrentRootDates: true },
  );

  for (const t of tasks) {
    const duration = t.estimate_hours != null ? durationBusinessDays(t.estimate_hours) : null;
    const deps = t.dependencies.length
      ? t.dependencies
          .map((d) => `${d.type}→${nameById.get(d.predecessor_task_id) ?? d.predecessor_task_id}`)
          .join(", ")
      : "(none)";
    const lag = t.fixed_lag_business_days_after
      ? `${t.fixed_lag_business_days_after.business_days}d after ${nameById.get(t.fixed_lag_business_days_after.task_id) ?? t.fixed_lag_business_days_after.task_id}`
      : "(none)";
    const computed = recomputed.get(t.task_id);
    const mismatch =
      computed !== undefined && computed != null && computed !== t.target_date;

    console.log(`[${t.task_id}] ${t.task_name}`);
    console.log(`  estimate_hours: ${t.estimate_hours ?? "(none)"}  duration: ${duration ?? "(n/a)"}d`);
    console.log(`  dependencies: ${deps}`);
    console.log(`  friday_anchor: ${t.friday_anchor}  fixed_lag_business_days_after: ${lag}`);
    console.log(`  drives_project_date: ${t.drives_project_date ?? "(none)"}`);
    console.log(`  stored target_date: ${t.target_date ?? "(none)"}`);
    console.log(
      `  engine would compute right now: ${computed === undefined ? "(excluded — isolated)" : computed ?? "(null — unresolved)"}${mismatch ? "  <-- DIFFERS FROM STORED" : ""}`,
    );
    console.log("");
  }
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
