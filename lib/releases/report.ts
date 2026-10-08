/**
 * Application Release report — per-project rollup for one release date.
 *
 * Pure function over already-loaded data (no DB, no React), same split as
 * lib/key-capabilities.ts. The page loads everything, calls
 * `buildReleaseReport`, and hands the result to the client view.
 *
 * Definitions:
 *
 *   Blockers — what is currently stopping the project or its tasks:
 *     project status Blocked; upstream project dependencies that are
 *     blocked/at-risk; unresolved external dependencies; tasks that are
 *     blocked (with the blocking task / project / free-text reason); and
 *     tasks waiting on an unfinished Finish-to-Start predecessor.
 *
 *   Missed delivery — the release date has passed and the project's stage
 *     has not reached the final stage (Productization). Delivery is judged
 *     by STAGE, not project status: tasks legitimately continue after the
 *     release, so a project isn't "Completed" at release time.
 *
 *   At risk — the project is behind schedule for a planned date, surfaced
 *     early enough to course-correct. Reasons: open tasks are overdue;
 *     project status is Delayed; or a passed planned date (a handoff
 *     milestone or the executable deployment date) still has open tasks
 *     that were due by then. Once the release has passed, a project that
 *     hasn't reached Productization is a missed delivery instead.
 */

import type {
  ExternalDependency,
  IsoDate,
  Project,
  ReleaseCaveat,
  Task,
  UseCase,
} from "@/lib/db";
import { dependencyHealth } from "@/lib/projects/dependencies";
import {
  STAGE_LAST,
  hasReachedProductization,
  stagesForTrack,
} from "@/lib/projects/display";
import {
  MILESTONE_LABELS,
  computeProjectMilestones,
} from "@/lib/projects/milestones";
import {
  computeProjectTaskStats,
  type ProjectTaskStats,
} from "@/lib/key-capabilities";

const TERMINAL_TASK = new Set(["Complete", "Canceled"]);

export interface BlockerItem {
  /** Whether the block is on the project itself or on one of its tasks. */
  scope: "project" | "task";
  /** Short label of what is blocked, e.g. a task name or "Project". */
  subject: string;
  /** Plain-language description of what is blocking it. */
  reason: string;
}

export interface MilestoneEntry {
  label: string;
  date: IsoDate;
  passed: boolean;
}

export interface ReleaseProjectEntry {
  project: Project;
  leadName: string;
  stats: ProjectTaskStats;
  useCaseNames: string[];
  /** 1-based position of the current stage in the track's stage list. */
  stageIndex: number;
  stageCount: number;
  milestones: MilestoneEntry[];
  /** Caveats recorded against this project for this release. */
  caveats: ReleaseCaveat[];
  blockers: BlockerItem[];
  atRisk: boolean;
  riskReasons: string[];
  /** Release date passed and stage is not yet Productization. */
  missedDelivery: boolean;
  /** Release date passed and the project reached Productization. */
  delivered: boolean;
}

export interface ReleaseReport {
  date: IsoDate;
  entries: ReleaseProjectEntry[];
  atRiskCount: number;
  missedCount: number;
  blockedCount: number;
  deliveredCount: number;
}

export interface ReleaseReportInput {
  date: IsoDate;
  today: IsoDate;
  /** Projects the viewer may see. Entries are drawn from these. */
  projects: Project[];
  /** Every project, used only to resolve names of blocking projects. */
  allProjects: Project[];
  /** Every task, used to resolve blocking / predecessor tasks. */
  allTasks: Task[];
  useCases: UseCase[];
  /** Caveats recorded for this release date (any project). */
  caveats: ReleaseCaveat[];
  userNamesById: Record<string, string>;
}

function isOpen(t: Task): boolean {
  return !TERMINAL_TASK.has(t.status);
}

function plural(n: number, word: string): string {
  return `${n} ${word}${n === 1 ? "" : "s"}`;
}

export interface ProjectEntriesInput {
  today: IsoDate;
  /** Projects to build entries for (Canceled ones are skipped). */
  projects: Project[];
  allProjects: Project[];
  allTasks: Task[];
  useCases: UseCase[];
  /** Optional: caveats to attach, matched by project_id. */
  caveats?: ReleaseCaveat[];
  userNamesById: Record<string, string>;
}

/**
 * Per-project rollup (progress, stage, blockers, schedule risk) with each
 * project judged against ITS OWN `target_date`. Shared by the Application
 * Release page (which filters to one date first) and the executive view.
 * A project with no `target_date` has no release to miss, so it can't be
 * "missed delivery"; its other risk signals still apply.
 */
export function buildProjectEntries(
  input: ProjectEntriesInput,
): ReleaseProjectEntry[] {
  const { today, projects, allProjects, allTasks, useCases } = input;

  const projectsById = new Map(allProjects.map((p) => [p.project_id, p]));
  const tasksById = new Map(allTasks.map((t) => [t.task_id, t]));
  const tasksByProject = new Map<string, Task[]>();
  for (const t of allTasks) {
    const arr = tasksByProject.get(t.project_id);
    if (arr) arr.push(t);
    else tasksByProject.set(t.project_id, [t]);
  }
  const useCasesByProject = new Map<string, string[]>();
  for (const uc of useCases) {
    for (const pid of uc.member_project_ids) {
      const arr = useCasesByProject.get(pid);
      if (arr) arr.push(uc.name);
      else useCasesByProject.set(pid, [uc.name]);
    }
  }

  return projects
    .filter((p) => p.status !== "Canceled")
    .map((project) => {
      const date = project.target_date;
      const tasks = tasksByProject.get(project.project_id) ?? [];

      // ---- Milestones ----
      const ms = computeProjectMilestones(
        project.target_date,
        project.target_executable_deployment_date,
      );
      const milestones: MilestoneEntry[] = [];
      for (const key of Object.keys(ms) as Array<keyof typeof ms>) {
        const d = ms[key];
        if (d) {
          milestones.push({
            label: MILESTONE_LABELS[key],
            date: d,
            passed: d < today,
          });
        }
      }
      milestones.sort((a, b) => a.date.localeCompare(b.date));

      // ---- Blockers ----
      const blockers: BlockerItem[] = [];
      if (project.status === "Blocked") {
        blockers.push({
          scope: "project",
          subject: "Project",
          reason: "Project status is Blocked.",
        });
      }
      for (const dep of project.dependencies) {
        const upstream = projectsById.get(dep.upstream_id);
        const health = dependencyHealth(dep, upstream);
        if (health === "clear") continue;
        const what = upstream
          ? `${upstream.project_id} ${upstream.name} (${upstream.status}, stage: ${upstream.stage})`
          : `${dep.upstream_id} (not found)`;
        const gate =
          dep.type === "Blocks Stage" && dep.required_stage
            ? `must reach "${dep.required_stage}"`
            : "must finish before this can start";
        blockers.push({
          scope: "project",
          subject: "Upstream project",
          reason: `${health === "blocked" ? "Blocked by" : "At risk from"} ${what} — ${gate}.`,
        });
      }
      for (const ext of project.external_dependencies as ExternalDependency[]) {
        if (ext.status === "Resolved") continue;
        const parts = [`${ext.label} (${ext.status})`];
        if (ext.owner) parts.push(`owner: ${ext.owner}`);
        if (ext.target_date) parts.push(`expected ${ext.target_date}`);
        blockers.push({
          scope: "project",
          subject: "External dependency",
          reason: parts.join(" — "),
        });
      }
      for (const t of tasks) {
        if (!isOpen(t)) continue;
        if (t.blocked || t.status === "Blocked") {
          let reason = t.blocker_issue_task.trim();
          if (t.blocker_type === "task" && t.blocker_task_id) {
            const bt = tasksById.get(t.blocker_task_id);
            const bp = bt ? projectsById.get(bt.project_id) : undefined;
            reason = bt
              ? `Blocked by task ${bt.task_id} "${bt.task_name}" (${bt.status}${bp ? `, ${bp.project_id} ${bp.name}` : ""})`
              : `Blocked by task ${t.blocker_task_id} (not found)`;
            if (t.blocker_issue_task.trim()) {
              reason += ` — ${t.blocker_issue_task.trim()}`;
            }
          } else if (t.blocker_type === "project" && t.blocker_project_id) {
            const bp = projectsById.get(t.blocker_project_id);
            reason = bp
              ? `Blocked by project ${bp.project_id} ${bp.name} (${bp.status}, stage: ${bp.stage})`
              : `Blocked by project ${t.blocker_project_id} (not found)`;
            if (t.blocker_issue_task.trim()) {
              reason += ` — ${t.blocker_issue_task.trim()}`;
            }
          } else if (!reason) {
            reason = "Blocked (no reason recorded).";
          }
          blockers.push({
            scope: "task",
            subject: `${t.task_id} ${t.task_name}`,
            reason,
          });
        } else if (t.status === "Awaiting Dependency") {
          const waiting = t.dependencies
            .filter((d) => d.type === "FS")
            .map((d) => tasksById.get(d.predecessor_task_id))
            .filter((p): p is Task => Boolean(p) && isOpen(p as Task));
          blockers.push({
            scope: "task",
            subject: `${t.task_id} ${t.task_name}`,
            reason:
              waiting.length > 0
                ? `Waiting on ${waiting
                    .map((p) => `${p.task_id} "${p.task_name}" (${p.status})`)
                    .join(", ")}`
                : "Waiting on an unfinished predecessor task.",
          });
        }
      }

      // ---- Risk ----
      const riskReasons: string[] = [];
      // Productization or any post-Productization stage (validation,
      // adoption) counts as shipped.
      const reachedFinalStage = hasReachedProductization(project.track, project.stage);
      const released = date !== null && date < today;
      const missedDelivery = released && !reachedFinalStage;
      const delivered = released && reachedFinalStage;

      if (missedDelivery) {
        riskReasons.push(
          `Release date ${date} has passed and the project is still in "${project.stage}" — it has not reached ${STAGE_LAST}.`,
        );
      }
      if (project.status === "Delayed") {
        riskReasons.push("Project status is Delayed.");
      }
      const openTasks = tasks.filter(isOpen);
      // Pre-release work only: once released, remaining tasks are the
      // normal post-release tail and are not "overdue against the release".
      const overdue = openTasks.filter(
        (t) => t.target_date && t.target_date < today,
      );
      if (overdue.length > 0 && !delivered) {
        riskReasons.push(`${plural(overdue.length, "open task")} overdue.`);
      }
      const plannedDates: Array<{ label: string; date: IsoDate }> = milestones
        .filter((m) => m.passed)
        .map((m) => ({ label: m.label, date: m.date }));
      const exec = project.target_executable_deployment_date;
      if (exec && exec < today) {
        plannedDates.push({ label: "Executable deployment", date: exec });
      }
      if (!delivered) {
        for (const m of plannedDates) {
          const late = openTasks.filter(
            (t) => t.target_date && t.target_date <= m.date,
          );
          if (late.length > 0) {
            riskReasons.push(
              `Behind on "${m.label}" (${m.date}): ${plural(late.length, "task")} due by then still open.`,
            );
          }
        }
      }

      const stages = stagesForTrack(project.track);
      const idx = stages.indexOf(project.stage);

      return {
        project,
        leadName: input.userNamesById[project.project_lead] ?? project.project_lead,
        stats: computeProjectTaskStats(tasks, today),
        useCaseNames: useCasesByProject.get(project.project_id) ?? [],
        stageIndex: idx >= 0 ? idx + 1 : 0,
        stageCount: stages.length,
        milestones,
        caveats: (input.caveats ?? []).filter(
          (c) => c.project_id === project.project_id,
        ),
        blockers,
        atRisk: riskReasons.length > 0,
        riskReasons,
        missedDelivery,
        delivered,
      };
    })
    // Missed first, then at-risk, then blocked, then by name.
    .sort(
      (a, b) =>
        Number(b.missedDelivery) - Number(a.missedDelivery) ||
        Number(b.atRisk) - Number(a.atRisk) ||
        Number(b.blockers.length > 0) - Number(a.blockers.length > 0) ||
        a.project.name.localeCompare(b.project.name),
    );
}

export function buildReleaseReport(input: ReleaseReportInput): ReleaseReport {
  const { date } = input;
  const entries = buildProjectEntries({
    ...input,
    projects: input.projects.filter((p) => p.target_date === date),
  });

  return {
    date,
    entries,
    atRiskCount: entries.filter((e) => e.atRisk && !e.missedDelivery).length,
    missedCount: entries.filter((e) => e.missedDelivery).length,
    blockedCount: entries.filter((e) => e.blockers.length > 0).length,
    deliveredCount: entries.filter((e) => e.delivered).length,
  };
}
