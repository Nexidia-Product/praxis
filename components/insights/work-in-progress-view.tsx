"use client";

/**
 * Work in Progress dashboard view (Insights).
 *
 * Shows every project whose status is "In Planning" or "In Progress",
 * grouped under those two headings. Each project gets a Key-Capabilities-
 * style summary card (identity + health, a task mini-stat strip, a
 * completion bar, and the most recent status-history note) followed by a
 * table of its OPEN (non-terminal) tasks.
 *
 * The task table reuses the very same `TaskRow` the Tasks page renders,
 * plus the same optimistic status / priority / complete / delete handlers,
 * so editing here behaves identically to the Tasks view. Row-click opens
 * the shared `TaskFormModal` (the task "quick view"). The project card
 * name opens the shared `ProjectQuickView`, whose "Edit project" button
 * hands off to `ProjectFormModal`.
 *
 * All lists are held as live client state seeded from the server: an
 * inline project-status edit that moves a project out of "In Planning /
 * In Progress" drops its card, and completing a task removes it from the
 * open list while the card's stats recompute.
 */

import { useEffect, useMemo, useState } from "react";

import {
  HEALTH_BADGE,
  HEALTH_DOT,
  HEALTH_TOOLTIP,
  isAdminProject,
  priorityBadgeClass,
} from "@/lib/projects/display";
import {
  computeProjectTaskStats,
  latestStatusSummary,
} from "@/lib/key-capabilities";
import {
  URGENCY_SORT_RANK,
  isActiveStatus,
  taskUrgency,
  todayLocal,
} from "@/lib/tasks/display";
import { customFieldMatches } from "@/lib/projects/custom-filter";
import { computePortfolioPosition } from "@/lib/projects/portfolio-position";
import type { EnumOption } from "@/lib/projects/enum-options";
import type {
  CustomFieldDefinition,
  PortfolioQuadrantLabels,
  Priority,
  Project,
  ProjectGroup,
  ProjectPhase,
  ProjectStatus,
  Task,
  TaskStatus,
  TaskTemplate,
  UserRole,
} from "@/lib/db";
import { TaskRow } from "@/components/tasks/tasks-table";
import { TaskFormModal } from "@/components/tasks/form-modal";
import { ProjectQuickView } from "@/components/projects/quick-view";
import { ProjectFormModal } from "@/components/projects/form-modal";
import { OutcomesList } from "@/components/projects/outcomes-list";
import {
  ProjectFilterBar,
  EMPTY_FILTERS,
  type ProjectFilters,
} from "@/components/projects/filter-bar";

/** The two project statuses this dashboard scopes to, in display order. */
const WIP_STATUSES: ProjectStatus[] = ["In Progress", "In Planning"];

/** Priority ordering for the open-task sort — mirrors the Tasks table. */
const TASK_PRIORITY_RANK: Record<Priority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

interface EnumOptionSet {
  status: EnumOption[];
  phase: EnumOption[];
  priority: EnumOption[];
  application_product: EnumOption[];
}

interface Props {
  /** Full project list (unfiltered) — the view derives the WIP subset. */
  initialProjects: Project[];
  /** Full task list — the view buckets open tasks per project. */
  initialTasks: Task[];
  customFields: CustomFieldDefinition[];
  enumOptions: EnumOptionSet;
  templates: TaskTemplate[];
  groups: ProjectGroup[];
  quadrantLabels: PortfolioQuadrantLabels;
  aiEnabled: boolean;
  activeUserNames: string[];
  currentUserRole: UserRole;
  /** The signed-in user's id — threaded through for author-only finding edits. */
  currentUserId?: string;
  permissions: Record<string, boolean>;
}

export function WorkInProgressView({
  initialProjects,
  initialTasks,
  customFields,
  enumOptions,
  templates,
  groups,
  quadrantLabels,
  aiEnabled,
  activeUserNames,
  currentUserRole,
  currentUserId,
  permissions,
}: Props) {
  const [projects, setProjects] = useState<Project[]>(initialProjects);
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [today, setToday] = useState<string>(() => todayLocal());
  const [globalError, setGlobalError] = useState<string | null>(null);

  // Standard project filters + the Admin-projects inclusion toggle.
  // Admin projects (Admin type or Admin application/product) are hidden
  // by default and only surface when `includeAdmin` is checked.
  const [filters, setFilters] = useState<ProjectFilters>(EMPTY_FILTERS);
  const [includeAdmin, setIncludeAdmin] = useState(false);

  // Overlay state — one project quick view, one project edit modal, one
  // task edit modal open at a time (same pattern as the source tables).
  const [quickViewId, setQuickViewId] = useState<string | null>(null);
  const [modalProject, setModalProject] = useState<Project | null>(null);
  const [editTask, setEditTask] = useState<Task | null>(null);

  // Recompute "today" on focus so urgency / past-due buckets stay honest
  // after an idle tab crosses midnight (matches the Tasks table).
  useEffect(() => {
    function onFocus() {
      setToday(todayLocal());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // ---- Permission gating (permission-first, role fallback). ----
  const canEditProject =
    permissions["projects.edit"] === true ||
    (permissions["projects.edit"] === undefined &&
      (currentUserRole === "Admin" || currentUserRole === "Project Lead"));
  const canEditTask =
    permissions["tasks.edit"] === true ||
    (permissions["tasks.edit"] === undefined &&
      (currentUserRole === "Admin" ||
        currentUserRole === "Project Lead" ||
        currentUserRole === "Team Member"));
  const canDeleteTask =
    permissions["tasks.delete"] === true ||
    (permissions["tasks.delete"] === undefined &&
      (currentUserRole === "Admin" || currentUserRole === "Project Lead"));
  const canMoveTask =
    permissions["tasks.move"] === true ||
    (permissions["tasks.move"] === undefined &&
      (currentUserRole === "Admin" || currentUserRole === "Project Lead"));

  // ---- Indexes + derived option lists for the reused edit modals. ----
  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.project_id, p);
    return m;
  }, [projects]);

  const groupsByProject = useMemo(() => {
    const m = new Map<string, ProjectGroup[]>();
    for (const g of groups) {
      for (const pid of g.member_project_ids) {
        const list = m.get(pid) ?? [];
        list.push(g);
        m.set(pid, list);
      }
    }
    return m;
  }, [groups]);

  // Distinct leads present in the data — the filter bar's "Project Lead"
  // options (filtering by a lead with no projects isn't useful).
  const leadOptions = useMemo(() => {
    const set = new Set<string>();
    for (const p of projects) if (p.project_lead) set.add(p.project_lead);
    return Array.from(set).sort();
  }, [projects]);

  // Project-lead dropdown source: active users unioned with any lead
  // already present in the data (case-insensitive dedup).
  const formLeadOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    };
    for (const n of activeUserNames) add(n);
    for (const p of projects) add(p.project_lead);
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [activeUserNames, projects]);

  // Application/Product options: admin-curated values first (declared
  // order), then any dataset-discovered values, deduped.
  const applicationOptions = useMemo(() => {
    const seen = new Set<string>();
    const out: string[] = [];
    for (const o of enumOptions.application_product) {
      const key = o.id.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(o.id);
      }
    }
    for (const p of projects) {
      if (!p.application_product) continue;
      const key = p.application_product.toLowerCase();
      if (!seen.has(key)) {
        seen.add(key);
        out.push(p.application_product);
      }
    }
    const curated = enumOptions.application_product.length;
    return [...out.slice(0, curated), ...out.slice(curated).sort()];
  }, [projects, enumOptions.application_product]);

  // Task-responsible dropdown source for the task form modal.
  const formResponsibleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string) => {
      const t = raw.trim();
      if (!t) return;
      const key = t.toLowerCase();
      if (!seen.has(key)) seen.set(key, t);
    };
    for (const n of activeUserNames) add(n);
    for (const t of tasks) {
      add(t.responsible);
      for (const a of t.additional_assignees) add(a);
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [activeUserNames, tasks]);

  // ---- Bucket tasks by project once. ----
  const tasksByProject = useMemo(() => {
    const m = new Map<string, Task[]>();
    for (const t of tasks) {
      const arr = m.get(t.project_id);
      if (arr) arr.push(t);
      else m.set(t.project_id, [t]);
    }
    return m;
  }, [tasks]);

  // Open (non-terminal) tasks for a project, sorted the same way the
  // Tasks table sorts: urgency → priority → target date → id.
  function openTasksFor(projectId: string): Task[] {
    const all = tasksByProject.get(projectId) ?? [];
    const open = all.filter((t) => isActiveStatus(t.status));
    open.sort((a, b) => {
      const ua = URGENCY_SORT_RANK[taskUrgency(a, today)];
      const ub = URGENCY_SORT_RANK[taskUrgency(b, today)];
      if (ua !== ub) return ua - ub;
      const pa = TASK_PRIORITY_RANK[a.priority] ?? 99;
      const pb = TASK_PRIORITY_RANK[b.priority] ?? 99;
      if (pa !== pb) return pa - pb;
      const ta = a.target_date ?? "9999-12-31";
      const tb = b.target_date ?? "9999-12-31";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.task_id < b.task_id ? -1 : 1;
    });
    return open;
  }

  // ---- Filtered WIP subset. ----
  // Base scope: status is In Planning / In Progress. On top of that we
  // apply the Admin-projects exclusion (unless opted in) and the standard
  // project filters — mirroring the Projects table's filter predicate so
  // behavior is identical.
  const filteredProjects = useMemo(() => {
    const search = filters.search.trim().toLowerCase();
    return projects.filter((p) => {
      if (p.status !== "In Planning" && p.status !== "In Progress") {
        return false;
      }
      if (!includeAdmin && isAdminProject(p)) return false;
      if (filters.status.length && !filters.status.includes(p.status)) {
        return false;
      }
      if (filters.phase.length && !filters.phase.includes(p.phase)) {
        return false;
      }
      if (filters.priority.length && !filters.priority.includes(p.priority)) {
        return false;
      }
      if (
        filters.project_type.length &&
        !filters.project_type.includes(p.project_type)
      ) {
        return false;
      }
      if (
        filters.project_lead.length &&
        !filters.project_lead.includes(p.project_lead)
      ) {
        return false;
      }
      if (
        filters.application_product.length &&
        !filters.application_product.includes(p.application_product)
      ) {
        return false;
      }
      if (filters.portfolio_position.length) {
        const pos = computePortfolioPosition(p, quadrantLabels);
        if (!filters.portfolio_position.includes(pos.key)) return false;
      }
      if (filters.target_from) {
        if (!p.target_date || p.target_date < filters.target_from) {
          return false;
        }
      }
      if (filters.target_to) {
        if (!p.target_date || p.target_date > filters.target_to) return false;
      }
      if (search) {
        const hay =
          `${p.project_id} ${p.name} ${p.description}`.toLowerCase();
        if (!hay.includes(search)) return false;
      }
      for (const def of customFields) {
        if (!customFieldMatches(p, def, filters.custom[def.key])) return false;
      }
      return true;
    });
  }, [projects, includeAdmin, filters, quadrantLabels, customFields]);

  // Split the filtered set into the two status sections.
  const sections = useMemo(() => {
    const byStatus = new Map<ProjectStatus, Project[]>();
    for (const s of WIP_STATUSES) byStatus.set(s, []);
    for (const p of filteredProjects) {
      const bucket = byStatus.get(p.status as ProjectStatus);
      if (bucket) bucket.push(p);
    }
    for (const list of byStatus.values()) {
      list.sort((a, b) => (a.project_id < b.project_id ? -1 : 1));
    }
    return WIP_STATUSES.map((status) => ({
      status,
      projects: byStatus.get(status) ?? [],
    }));
  }, [filteredProjects]);

  const totalWip = sections.reduce((n, s) => n + s.projects.length, 0);
  const totalOpenTasks = useMemo(
    () =>
      sections.reduce(
        (n, s) =>
          n +
          s.projects.reduce(
            (m, p) => m + openTasksFor(p.project_id).length,
            0,
          ),
        0,
      ),
    // openTasksFor depends on tasksByProject + today; recompute when either
    // the section set or the task buckets change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sections, tasksByProject, today],
  );

  // ---- Local-state mutators. ----
  function applyUpdatedProject(updated: Project) {
    setProjects((prev) =>
      prev.map((p) => (p.project_id === updated.project_id ? updated : p)),
    );
  }
  function applyUpdatedTask(updated: Task) {
    setTasks((prev) =>
      prev.map((t) => (t.task_id === updated.task_id ? updated : t)),
    );
  }
  function applyDeletedTask(id: string) {
    setTasks((prev) => prev.filter((t) => t.task_id !== id));
  }

  // ---- Project inline edits (optimistic; mirrors ProjectsTable). ----
  async function changeProjectStatus(
    project: Project,
    status: ProjectStatus,
    summary?: string,
  ) {
    const trimmed = summary?.trim() ?? "";
    if (status === project.status && trimmed.length === 0) return;
    setGlobalError(null);
    const prev = projects;
    if (status !== project.status) applyUpdatedProject({ ...project, status });
    const body: Record<string, unknown> = { status };
    if (trimmed.length > 0) body.status_summary = trimmed;
    const res = await fetch(`/api/projects/${project.project_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    if (!res.ok || !data.project) {
      setProjects(prev);
      setGlobalError(data.error ?? "Could not update status.");
      return;
    }
    applyUpdatedProject(data.project);
  }

  async function patchProjectField<K extends "phase" | "priority">(
    project: Project,
    field: K,
    value: K extends "phase" ? ProjectPhase : Priority,
  ) {
    if (project[field] === value) return;
    setGlobalError(null);
    const prev = projects;
    applyUpdatedProject({ ...project, [field]: value } as Project);
    const res = await fetch(`/api/projects/${project.project_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [field]: value }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      project?: Project;
      error?: string;
    };
    if (!res.ok || !data.project) {
      setProjects(prev);
      setGlobalError(data.error ?? `Could not update ${field}.`);
      return;
    }
    applyUpdatedProject(data.project);
  }

  // ---- Task inline edits (optimistic; mirrors TasksTable). ----
  async function changeTaskStatus(task: Task, status: TaskStatus) {
    const previous = task;
    const optimistic: Task = { ...task, status };
    if (status === "Blocked") optimistic.blocked = true;
    applyUpdatedTask(optimistic);
    setGlobalError(null);
    const res = await fetch(`/api/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: Task;
      error?: string;
    };
    if (!res.ok || !data.task) {
      applyUpdatedTask(previous);
      setGlobalError(data.error ?? "Could not update task.");
      return;
    }
    applyUpdatedTask(data.task);
  }

  async function changeTaskPriority(task: Task, priority: Priority) {
    if (task.priority === priority) return;
    const previous = task;
    applyUpdatedTask({ ...task, priority });
    setGlobalError(null);
    const res = await fetch(`/api/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ priority }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: Task;
      error?: string;
    };
    if (!res.ok || !data.task) {
      applyUpdatedTask(previous);
      setGlobalError(data.error ?? "Could not update task.");
      return;
    }
    applyUpdatedTask(data.task);
  }

  async function quickCompleteTask(task: Task) {
    if (task.status === "Complete") return;
    await changeTaskStatus(task, "Complete");
  }

  async function deleteTask(task: Task) {
    if (!canDeleteTask) return;
    if (
      !window.confirm(`Delete task ${task.task_id}? This cannot be undone.`)
    ) {
      return;
    }
    setGlobalError(null);
    const res = await fetch(`/api/tasks/${task.task_id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setGlobalError(data.error ?? "Could not delete task.");
      return;
    }
    applyDeletedTask(task.task_id);
  }

  const quickViewProject =
    quickViewId !== null ? projectsById.get(quickViewId) ?? null : null;

  return (
    <div className="space-y-4">
      {/* Standard project filters */}
      <ProjectFilterBar
        filters={filters}
        onChange={setFilters}
        leadOptions={leadOptions}
        applicationOptions={applicationOptions}
        statusOptions={enumOptions.status}
        phaseOptions={enumOptions.phase}
        priorityOptions={enumOptions.priority}
        customFields={customFields}
        quadrantLabels={quadrantLabels}
      />

      {/* Summary strip + Admin-projects toggle */}
      <div className="flex flex-wrap items-center gap-x-6 gap-y-1 rounded-md border border-gray-200 bg-white px-4 py-3 text-sm">
        <span>
          <span className="font-semibold text-gray-900">{totalWip}</span>{" "}
          <span className="text-gray-500">projects in flight</span>
        </span>
        {sections.map((s) => (
          <span key={s.status}>
            <span className="font-semibold text-gray-900">
              {s.projects.length}
            </span>{" "}
            <span className="text-gray-500">{s.status}</span>
          </span>
        ))}
        <span>
          <span className="font-semibold text-gray-900">{totalOpenTasks}</span>{" "}
          <span className="text-gray-500">open tasks</span>
        </span>
        <label className="ml-auto flex cursor-pointer items-center gap-1.5 text-xs text-gray-600">
          <input
            type="checkbox"
            checked={includeAdmin}
            onChange={(e) => setIncludeAdmin(e.target.checked)}
            className="h-3.5 w-3.5 rounded border-gray-300 text-gray-900 focus:ring-1 focus:ring-gray-900"
          />
          Include Admin projects
        </label>
      </div>

      {globalError ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{globalError}</span>
        </div>
      ) : null}

      {totalWip === 0 ? (
        <p className="rounded-md border border-dashed border-gray-300 px-4 py-10 text-center text-sm text-gray-500">
          No in-planning or in-progress projects match the current filters.
        </p>
      ) : (
        sections.map((section) =>
          section.projects.length === 0 ? null : (
            <section key={section.status} className="space-y-3">
              <h2 className="text-xs font-semibold uppercase tracking-wider text-gray-600">
                {section.status}
                <span className="ml-1.5 font-normal normal-case text-gray-400">
                  {section.projects.length} project
                  {section.projects.length === 1 ? "" : "s"}
                </span>
              </h2>
              {section.projects.map((project) => {
                const stats = computeProjectTaskStats(
                  tasksByProject.get(project.project_id) ?? [],
                  today,
                );
                const openTasks = openTasksFor(project.project_id);
                return (
                  <ProjectWipCard
                    key={project.project_id}
                    project={project}
                    totalTasks={stats.total}
                    openTasks={openTasks}
                    today={today}
                    projectsById={projectsById}
                    canEditTask={canEditTask}
                    canDeleteTask={canDeleteTask}
                    onOpenQuickView={() => setQuickViewId(project.project_id)}
                    onEditTask={(t) => setEditTask(t)}
                    onTaskStatusChange={changeTaskStatus}
                    onTaskPriorityChange={changeTaskPriority}
                    onTaskQuickComplete={quickCompleteTask}
                    onTaskDelete={deleteTask}
                  />
                );
              })}
            </section>
          ),
        )
      )}

      {/* Project quick view (edits route through the inline handlers /
          the Edit button, exactly like the Projects table). */}
      {quickViewProject ? (
        <ProjectQuickView
          project={quickViewProject}
          customFields={customFields}
          canEdit={canEditProject}
          allProjects={projects}
          statusOptions={enumOptions.status}
          phaseOptions={enumOptions.phase}
          priorityOptions={enumOptions.priority}
          groupsForProject={
            groupsByProject.get(quickViewProject.project_id) ?? []
          }
          onClose={() => setQuickViewId(null)}
          onEdit={() => {
            setModalProject(quickViewProject);
            setQuickViewId(null);
          }}
          onSelectRelatedProject={(id) => setQuickViewId(id)}
          onStatusChange={(status, summary) =>
            changeProjectStatus(quickViewProject, status, summary)
          }
          onPhaseChange={(phase) =>
            patchProjectField(quickViewProject, "phase", phase)
          }
          onPriorityChange={(priority) =>
            patchProjectField(quickViewProject, "priority", priority)
          }
        />
      ) : null}

      {/* Project edit modal */}
      {modalProject ? (
        <ProjectFormModal
          project={modalProject}
          customFields={customFields}
          leadOptions={formLeadOptions}
          applicationOptions={applicationOptions}
          statusOptions={enumOptions.status}
          phaseOptions={enumOptions.phase}
          priorityOptions={enumOptions.priority}
          templates={templates}
          allProjects={projects}
          aiEnabled={aiEnabled}
          onClose={() => setModalProject(null)}
          onSaved={(p) => {
            applyUpdatedProject(p);
            setModalProject(null);
          }}
        />
      ) : null}

      {/* Task quick view / edit modal */}
      {editTask ? (
        <TaskFormModal
          task={editTask}
          projects={projects}
          allTasks={tasks}
          responsibleOptions={formResponsibleOptions}
          readOnly={!canEditTask}
          currentUserId={currentUserId}
          canMove={canMoveTask}
          onClose={() => setEditTask(null)}
          onSaved={(t) => {
            applyUpdatedTask(t);
            setEditTask(null);
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// One project block — summary card (à la Key Capabilities) + open-task table.
// ---------------------------------------------------------------------------

function ProjectWipCard({
  project,
  totalTasks,
  openTasks,
  today,
  projectsById,
  canEditTask,
  canDeleteTask,
  onOpenQuickView,
  onEditTask,
  onTaskStatusChange,
  onTaskPriorityChange,
  onTaskQuickComplete,
  onTaskDelete,
}: {
  project: Project;
  totalTasks: number;
  openTasks: Task[];
  today: string;
  projectsById: Map<string, Project>;
  canEditTask: boolean;
  canDeleteTask: boolean;
  onOpenQuickView: () => void;
  onEditTask: (task: Task) => void;
  onTaskStatusChange: (task: Task, status: TaskStatus) => void;
  onTaskPriorityChange: (task: Task, priority: Priority) => void;
  onTaskQuickComplete: (task: Task) => void;
  onTaskDelete: (task: Task) => void;
}) {
  const statusSummary = latestStatusSummary(project.status_history);

  return (
    <div className="overflow-hidden rounded-md border border-gray-200 bg-white shadow-sm">
      {/* Summary — clicking anywhere here opens the project quick view. */}
      <div
        role="button"
        tabIndex={0}
        onClick={onOpenQuickView}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === " ") {
            e.preventDefault();
            onOpenQuickView();
          }
        }}
        title="Open project quick view"
        className="flex cursor-pointer flex-col gap-3 p-4 text-left hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gray-900"
      >
        <div className="flex items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <span className="font-mono text-[11px] text-gray-500">
                {project.project_id}
              </span>
              <span
                className={`inline-flex rounded px-1.5 py-0.5 text-[11px] font-medium ring-1 ring-inset ${priorityBadgeClass(project.priority)}`}
              >
                {project.priority}
              </span>
            </div>
            <h3 className="mt-0.5 truncate text-sm font-semibold text-gray-900">
              {project.name}
            </h3>
          </div>
          {project.health_score ? (
            <span
              className={`inline-flex shrink-0 items-center gap-1 rounded-md px-1.5 py-0.5 text-xs font-medium ${HEALTH_BADGE[project.health_score]}`}
              title={HEALTH_TOOLTIP[project.health_score]}
            >
              <span
                className={`inline-block h-1.5 w-1.5 rounded-full ${HEALTH_DOT[project.health_score]}`}
              />
              {project.health_score}
            </span>
          ) : (
            <span className="shrink-0 text-[11px] text-gray-400">
              No health
            </span>
          )}
        </div>

        <div className="flex flex-wrap gap-x-4 gap-y-0.5 text-[11px] text-gray-500">
          <span>{project.status}</span>
          <span>Lead: {project.project_lead || "—"}</span>
          <span>Target: {project.target_date || "—"}</span>
          <span>Tasks: {totalTasks}</span>
        </div>

        {/* Latest status summary note */}
        <div className="text-[11px] leading-snug">
          <span className="font-medium uppercase tracking-wide text-gray-400">
            Status
          </span>
          {statusSummary ? (
            <p className="mt-0.5 text-gray-600">{statusSummary}</p>
          ) : (
            <p className="mt-0.5 italic text-gray-400">—</p>
          )}
        </div>

        <OutcomesList outcomes={project.outcomes} />
      </div>

      {/* Open-task table — same rows / inline edits as the Tasks view. */}
      <div className="border-t border-gray-200">
        {openTasks.length === 0 ? (
          <p className="px-4 py-4 text-center text-xs italic text-gray-400">
            No open tasks.
          </p>
        ) : (
          <table className="min-w-full text-sm">
            <thead
              style={{
                background: "var(--bg)",
                borderBottom: "2px solid var(--border)",
              }}
            >
              <tr
                style={{
                  fontSize: 11,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: 0.5,
                  color: "var(--tm)",
                  textAlign: "left",
                }}
              >
                <th scope="col" className="w-20 px-3 py-2">
                  ID
                </th>
                <th scope="col" className="px-3 py-2">
                  Task
                </th>
                <th scope="col" className="w-32 px-3 py-2">
                  Status
                </th>
                <th scope="col" className="w-24 px-3 py-2">
                  Priority
                </th>
                <th scope="col" className="w-28 px-3 py-2">
                  Responsible
                </th>
                <th scope="col" className="w-28 px-3 py-2">
                  Due
                </th>
                <th scope="col" className="w-16 px-3 py-2 text-right">
                  Est.
                </th>
                <th scope="col" className="w-20 px-3 py-2 text-right">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody style={{ background: "var(--card)" }}>
              {openTasks.map((t) => (
                <TaskRow
                  key={t.task_id}
                  task={t}
                  today={today}
                  project={projectsById.get(t.project_id) ?? null}
                  canEdit={canEditTask}
                  canDelete={canDeleteTask}
                  showProject={false}
                  showResponsible
                  onStatusChange={(s) => onTaskStatusChange(t, s)}
                  onPriorityChange={(p) => onTaskPriorityChange(t, p)}
                  onQuickComplete={() => onTaskQuickComplete(t)}
                  onEdit={() => onEditTask(t)}
                  onDelete={() => onTaskDelete(t)}
                />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
