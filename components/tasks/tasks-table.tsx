"use client";

/**
 * Tasks page main view (Section 5.2 / 5.3).
 *
 * Owns the in-memory state for the page:
 *   - the task list (server-seeded, then mutated locally as PATCH/POST/DELETE
 *     responses come back);
 *   - the filter set (`TaskFilters`);
 *   - the open-vs-closed status group toggle;
 *   - the group-by selector (none / project / responsible / status / priority);
 *   - which task is open in the form modal.
 *
 * Rows are colored by urgency (Section 5.2): blocked / past-due / due-soon /
 * on-track / none. The default sort is by urgency rank — actionable items
 * float to the top — with priority + target date as secondary keys.
 *
 * `today` is recomputed on window focus so a long-open tab doesn't keep
 * showing yesterday's "due this week" buckets after midnight.
 */

import { useEffect, useMemo, useState } from "react";

import {
  OPEN_TASK_STATUSES,
  TASK_PRIORITIES,
  TASK_PRIORITY_BADGE,
  TASK_STATUSES,
  TASK_STATUS_BADGE,
  URGENCY_ACCENT_CLASS,
  URGENCY_LABEL,
  URGENCY_ROW_CLASS,
  URGENCY_SORT_RANK,
  isOpenStatus,
  taskUrgency,
  todayLocal,
} from "@/lib/tasks/display";
import type {
  Priority,
  Project,
  Task,
  TaskStatus,
  TaskTemplate,
  UserRole,
} from "@/lib/db";
import { TaskFilterBar, EMPTY_TASK_FILTERS, type TaskFilters } from "./filter-bar";
import { TaskFormModal } from "./form-modal";

// ---------------------------------------------------------------------------
// Status group toggle
// ---------------------------------------------------------------------------

type StatusGroup = "open" | "blocked" | "past_due" | "closed" | "all";

const STATUS_GROUP_LABEL: Record<StatusGroup, string> = {
  open: "Open",
  blocked: "Blocked",
  past_due: "Past due",
  closed: "Closed",
  all: "All",
};

/**
 * Predicate used to derive the count for each toggle button. The
 * returned function answers "does this task fall in this bucket?",
 * given today's date for the past-due check. We pass `today` as a
 * parameter (not hardcoded) so the filter test stays pure and the
 * count memo can recompute correctly when the date rolls over.
 */
/**
 * Format an hours value for the table cell. Whole numbers render
 * without decimals (3 → "3"); fractional values keep a single
 * decimal (1.5 → "1.5", 0.25 → "0.3"). Tightens the column visually
 * — "3.0h" looks busier than "3h" — while preserving the precision
 * the user entered.
 */
function formatHours(n: number): string {
  if (Number.isInteger(n)) return String(n);
  return n.toFixed(1);
}

function statusGroupMatches(
  group: StatusGroup,
  task: Task,
  today: string,
): boolean {
  if (group === "all") return true;
  if (group === "closed") {
    return task.status === "Complete" || task.status === "Canceled";
  }
  if (group === "blocked") {
    // The data has both signals — `blocked` (the boolean) and
    // `status === "Blocked"` — and the service keeps them in sync.
    // We OR them so an old record with a desynced state still
    // surfaces here. Closed tasks aren't "blocked" in the
    // actionable sense — exclude them.
    return (
      (task.blocked || task.status === "Blocked") &&
      task.status !== "Complete" &&
      task.status !== "Canceled"
    );
  }
  if (group === "past_due") {
    // Past-due means: target_date in the past AND task is still open.
    // Closed tasks that finished late aren't currently past due.
    if (!task.target_date || task.target_date >= today) return false;
    return isOpenStatus(task.status);
  }
  // "open" — anything in the open-statuses set
  return isOpenStatus(task.status);
}

// ---------------------------------------------------------------------------
// Group-by selector
// ---------------------------------------------------------------------------

type GroupBy = "none" | "project" | "responsible" | "status" | "priority";

const GROUP_BY_LABEL: Record<GroupBy, string> = {
  none: "None",
  project: "Project",
  responsible: "Responsible",
  status: "Status",
  priority: "Priority",
};

const PRIORITY_RANK: Record<Priority, number> = {
  Critical: 0,
  High: 1,
  Medium: 2,
  Low: 3,
};

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

interface TasksTableProps {
  initialTasks: Task[];
  projects: Project[];
  /**
   * Available task templates. Used by the Admin / Project Lead
   * "Apply template" button to seed a batch of tasks onto an
   * existing project. Optional — when omitted (e.g. tests) the
   * button is hidden.
   */
  templates?: TaskTemplate[];
  currentUserRole: UserRole;
  /**
   * Optional permission map. When provided, edit/delete affordances are
   * driven by `tasks.edit` / `tasks.delete` rather than the role. The
   * role-only fallback below preserves existing behavior for callers
   * that haven't been wired through yet (mainly tests).
   */
  permissions?: Record<string, boolean>;
  /** When true, the "Assigned to" filter is hidden — used on /my-tasks. */
  scopeToUser?: boolean;
  /** When set, the create modal is locked to this project. */
  defaultProjectId?: string;
  /** Pre-fills `responsible` on new tasks (My Tasks page passes the user's name). */
  defaultResponsible?: string;
}

export function TasksTable({
  initialTasks,
  projects,
  templates,
  currentUserRole,
  permissions,
  scopeToUser,
  defaultProjectId,
  defaultResponsible,
}: TasksTableProps) {
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  const [filters, setFilters] = useState<TaskFilters>(() => {
    if (defaultProjectId) {
      return { ...EMPTY_TASK_FILTERS, project_id: [defaultProjectId] };
    }
    return EMPTY_TASK_FILTERS;
  });
  const [statusGroup, setStatusGroup] = useState<StatusGroup>("open");
  const [groupBy, setGroupBy] = useState<GroupBy>("project");
  const [today, setToday] = useState<string>(() => todayLocal());
  const [showCreate, setShowCreate] = useState(false);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [globalError, setGlobalError] = useState<string | null>(null);
  // Apply-template modal state. Held here (not in the modal) so the
  // success message can persist briefly on the toolbar after the
  // modal closes.
  const [showApplyTemplate, setShowApplyTemplate] = useState(false);
  const [applyTemplateMsg, setApplyTemplateMsg] = useState<string | null>(null);

  // Recompute "today" when the window regains focus. Cheap, keeps urgency
  // buckets honest after the tab has been idle past midnight.
  useEffect(() => {
    function onFocus() {
      setToday(todayLocal());
    }
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, []);

  // Permission-driven gating with role fallback. Same pattern as
  // ProjectsTable — preserves existing behavior when `permissions`
  // isn't passed, lets the matrix override when it is.
  const canEdit = permissions
    ? permissions["tasks.edit"] === true
    : currentUserRole === "Admin" ||
      currentUserRole === "Project Lead" ||
      currentUserRole === "Team Member";
  const canCreate = permissions
    ? permissions["tasks.create"] === true
    : currentUserRole === "Admin" ||
      currentUserRole === "Project Lead" ||
      currentUserRole === "Team Member";
  const canDelete = permissions
    ? permissions["tasks.delete"] === true
    : currentUserRole === "Admin" || currentUserRole === "Project Lead";
  // The "Apply template" button is a bulk-create affordance — the
  // user spec restricts it to Admin / Project Lead. We still gate
  // through `tasks.create` (the underlying endpoint), then layer the
  // role restriction on top so an admin can't accidentally widen it
  // by granting `tasks.create` to a Team Member via the matrix.
  const canApplyTemplate =
    (currentUserRole === "Admin" || currentUserRole === "Project Lead") &&
    canCreate;

  // ---- Derived option lists for the filter bar / form datalist. ----
  const projectsById = useMemo(() => {
    const m = new Map<string, Project>();
    for (const p of projects) m.set(p.project_id, p);
    return m;
  }, [projects]);

  const projectOptions = useMemo(
    () => projects.map((p) => p.project_id).sort(),
    [projects],
  );

  const responsibleOptions = useMemo(() => {
    const set = new Set<string>();
    for (const t of tasks) {
      if (t.responsible) set.add(t.responsible);
      for (const a of t.additional_assignees) {
        if (a) set.add(a);
      }
    }
    return Array.from(set).sort();
  }, [tasks]);

  // ---- Filtering. ----
  const visibleTasks = useMemo(() => {
    const search = filters.search.trim().toLowerCase();

    return tasks.filter((t) => {
      if (!statusGroupMatches(statusGroup, t, today)) return false;
      if (filters.status.length && !filters.status.includes(t.status)) {
        return false;
      }
      if (filters.priority.length && !filters.priority.includes(t.priority)) {
        return false;
      }
      if (filters.project_id.length && !filters.project_id.includes(t.project_id)) {
        return false;
      }
      if (filters.responsible.length) {
        const hit =
          filters.responsible.includes(t.responsible) ||
          t.additional_assignees.some((a) => filters.responsible.includes(a));
        if (!hit) return false;
      }
      if (filters.blocked === "yes" && !t.blocked) return false;
      if (filters.blocked === "no" && t.blocked) return false;
      if (filters.due_from) {
        if (!t.target_date || t.target_date < filters.due_from) return false;
      }
      if (filters.due_to) {
        if (!t.target_date || t.target_date > filters.due_to) return false;
      }
      if (search) {
        const haystack =
          `${t.task_id} ${t.task_name} ${t.detailed_description}`.toLowerCase();
        if (!haystack.includes(search)) return false;
      }
      return true;
    });
  }, [tasks, filters, statusGroup, today]);

  // ---- Sorting. urgency → priority → target date → task_id. ----
  const sortedTasks = useMemo(() => {
    const out = [...visibleTasks];
    out.sort((a, b) => {
      const ua = URGENCY_SORT_RANK[taskUrgency(a, today)];
      const ub = URGENCY_SORT_RANK[taskUrgency(b, today)];
      if (ua !== ub) return ua - ub;
      const pa = PRIORITY_RANK[a.priority];
      const pb = PRIORITY_RANK[b.priority];
      if (pa !== pb) return pa - pb;
      const ta = a.target_date ?? "9999-12-31";
      const tb = b.target_date ?? "9999-12-31";
      if (ta !== tb) return ta < tb ? -1 : 1;
      return a.task_id < b.task_id ? -1 : 1;
    });
    return out;
  }, [visibleTasks, today]);

  // ---- Grouping. Each group is a (label, list) pair, in display order. ----
  const groups = useMemo(() => {
    if (groupBy === "none") {
      return [{ label: "All tasks", tasks: sortedTasks }];
    }
    const map = new Map<string, Task[]>();
    for (const t of sortedTasks) {
      const key = groupKey(t, groupBy, projectsById);
      const arr = map.get(key) ?? [];
      arr.push(t);
      map.set(key, arr);
    }
    // Stable order: sort group keys alphabetically except for status/priority
    // groups, which we keep in canonical enum order so "Critical" comes before
    // "High" in a Priority group view, etc.
    const keys = Array.from(map.keys());
    if (groupBy === "status") {
      keys.sort(
        (a, b) =>
          TASK_STATUSES.indexOf(a as TaskStatus) -
          TASK_STATUSES.indexOf(b as TaskStatus),
      );
    } else if (groupBy === "priority") {
      keys.sort(
        (a, b) =>
          TASK_PRIORITIES.indexOf(a as Priority) -
          TASK_PRIORITIES.indexOf(b as Priority),
      );
    } else {
      keys.sort();
    }
    return keys.map((k) => ({ label: k, tasks: map.get(k) ?? [] }));
  }, [sortedTasks, groupBy, projectsById]);

  // ---- Status group counts for the toggle buttons. ----
  const statusCounts = useMemo(() => {
    const counts: Record<StatusGroup, number> = {
      open: 0,
      blocked: 0,
      past_due: 0,
      closed: 0,
      all: tasks.length,
    };
    for (const t of tasks) {
      // Each task can fall into multiple buckets — a Past-Due task
      // is also Open, a Blocked Past-Due task is in three. We
      // increment all that match so the badges reflect "matching
      // tasks" not "exclusive tasks". Same semantics as the filter
      // predicate used to display.
      if (statusGroupMatches("open", t, today)) counts.open++;
      if (statusGroupMatches("blocked", t, today)) counts.blocked++;
      if (statusGroupMatches("past_due", t, today)) counts.past_due++;
      if (statusGroupMatches("closed", t, today)) counts.closed++;
    }
    return counts;
  }, [tasks, today]);

  // ---- Local state mutators. ----
  function applyUpdated(updated: Task) {
    setTasks((prev) =>
      prev.map((t) => (t.task_id === updated.task_id ? updated : t)),
    );
  }

  function applyCreated(created: Task) {
    setTasks((prev) => [created, ...prev]);
  }

  function applyDeleted(id: string) {
    setTasks((prev) => prev.filter((t) => t.task_id !== id));
  }

  // ---- Inline status update (optimistic with rollback). ----
  async function changeStatus(task: Task, status: TaskStatus) {
    const previous = task;
    const optimistic: Task = { ...task, status };
    if (status === "Blocked") optimistic.blocked = true;
    applyUpdated(optimistic);
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
      applyUpdated(previous); // rollback
      setGlobalError(data.error ?? "Could not update task.");
      return;
    }
    applyUpdated(data.task);
  }

  /**
   * Inline priority edit. Same optimistic / revert pattern as
   * `changeStatus` but generalized would add ceremony for one extra
   * field, so we mirror the shape directly.
   */
  async function changePriority(task: Task, priority: Priority) {
    if (task.priority === priority) return;
    const previous = task;
    applyUpdated({ ...task, priority });
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
      applyUpdated(previous);
      setGlobalError(data.error ?? "Could not update task.");
      return;
    }
    applyUpdated(data.task);
  }

  async function quickComplete(task: Task) {
    if (task.status === "Complete") return;
    await changeStatus(task, "Complete");
  }

  async function deleteOne(task: Task) {
    if (!canDelete) return;
    if (!window.confirm(`Delete task ${task.task_id}? This cannot be undone.`)) {
      return;
    }
    setGlobalError(null);
    const res = await fetch(`/api/tasks/${task.task_id}`, { method: "DELETE" });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setGlobalError(data.error ?? "Could not delete task.");
      return;
    }
    applyDeleted(task.task_id);
  }

  /**
   * Apply a template to an existing project — a bulk-create that
   * appends one task per template item. Shows a brief toast on
   * success ("3 tasks created from Standard Onboarding") that
   * auto-clears after 5s.
   */
  async function applyTemplateBatch(
    projectId: string,
    templateId: string,
  ): Promise<void> {
    setGlobalError(null);
    setApplyTemplateMsg(null);
    const res = await fetch(`/api/projects/${projectId}/apply-template`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ template_id: templateId }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      tasks?: Task[];
      count?: number;
      error?: string;
    };
    if (!res.ok || !data.tasks) {
      setGlobalError(data.error ?? "Could not apply template.");
      throw new Error(data.error ?? "apply-template failed");
    }
    // Append the new tasks to local state so they appear in the
    // table without a refetch.
    setTasks((prev) => [...prev, ...(data.tasks ?? [])]);
    const tpl = (templates ?? []).find((t) => t.template_id === templateId);
    const tplLabel = tpl?.template_name ?? "template";
    setApplyTemplateMsg(
      `${data.count ?? data.tasks.length} task${
        (data.count ?? data.tasks.length) === 1 ? "" : "s"
      } created from ${tplLabel}.`,
    );
  }

  // Auto-clear the apply-template toast after 5s. Errors aren't
  // auto-cleared (they sit in `globalError` until the user takes
  // an action).
  useEffect(() => {
    if (!applyTemplateMsg) return;
    const t = window.setTimeout(() => setApplyTemplateMsg(null), 5000);
    return () => window.clearTimeout(t);
  }, [applyTemplateMsg]);

  return (
    <div className="space-y-3">
      {/* Top control row */}
      <div className="toolbar">
        <div style={{ display: "flex", alignItems: "center", gap: 12, flex: 1, flexWrap: "wrap" }}>
          <StatusGroupToggle
            value={statusGroup}
            counts={statusCounts}
            onChange={setStatusGroup}
          />
          <label
            style={{
              display: "flex",
              alignItems: "center",
              gap: 6,
              fontSize: "var(--fs-xs)",
              fontWeight: 700,
              textTransform: "uppercase",
              letterSpacing: 0.5,
              color: "var(--tm)",
            }}
          >
            Group by
            <select
              aria-label="Group by"
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value as GroupBy)}
              className="pol-select"
              style={{ width: 140 }}
            >
              {(Object.keys(GROUP_BY_LABEL) as GroupBy[]).map((g) => (
                <option key={g} value={g}>
                  {GROUP_BY_LABEL[g]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          {applyTemplateMsg ? (
            <span
              role="status"
              style={{
                fontSize: 11,
                color: "var(--ok)",
                paddingRight: 4,
              }}
            >
              {applyTemplateMsg}
            </span>
          ) : null}
          {canApplyTemplate && templates && templates.length > 0 ? (
            <button
              type="button"
              onClick={() => setShowApplyTemplate(true)}
              className="pol-btn pol-btn-secondary"
              title="Add a batch of tasks from a template to an existing project"
            >
              + From template
            </button>
          ) : null}
          {canCreate ? (
            <button
              type="button"
              onClick={() => setShowCreate(true)}
              className="pol-btn pol-btn-primary"
            >
              + New task
            </button>
          ) : null}
        </div>
      </div>

      <TaskFilterBar
        filters={filters}
        onChange={setFilters}
        projectOptions={projectOptions}
        responsibleOptions={responsibleOptions}
        hideResponsible={scopeToUser}
      />

      <UrgencyLegend />

      {globalError ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{globalError}</span>
        </div>
      ) : null}

      {/* Task groups */}
      <div className="space-y-6">
        {groups.length === 0 ? (
          <p className="rounded-md border border-dashed border-gray-200 bg-gray-50 px-4 py-12 text-center text-sm text-gray-500">
            No tasks match your filters.
          </p>
        ) : (
          groups.map((group) => (
            <section key={group.label}>
              {groupBy !== "none" ? (
                <h2 className="mb-2 text-xs font-semibold uppercase tracking-wider text-gray-600">
                  {groupLabelDisplay(group.label, groupBy, projectsById)}{" "}
                  <span className="ml-1 font-normal normal-case text-gray-400">
                    {group.tasks.length} task{group.tasks.length === 1 ? "" : "s"}
                  </span>
                </h2>
              ) : null}
              <div
                style={{
                  background: "var(--card)",
                  border: "1px solid var(--border)",
                  borderRadius: "var(--pol-radius)",
                  overflow: "hidden",
                }}
              >
                <table className="min-w-full text-sm">
                  <thead style={{ background: "var(--bg)", borderBottom: "2px solid var(--border)" }}>
                    <tr style={{ fontSize: 11, fontWeight: 700, textTransform: "uppercase", letterSpacing: 0.5, color: "var(--tm)", textAlign: "left" }}>
                      <th scope="col" className="w-20 px-3 py-2">
                        ID
                      </th>
                      <th scope="col" className="px-3 py-2">
                        Task
                      </th>
                      {groupBy !== "project" ? (
                        <th scope="col" className="w-32 px-3 py-2">
                          Project
                        </th>
                      ) : null}
                      <th scope="col" className="w-32 px-3 py-2">
                        Status
                      </th>
                      <th scope="col" className="w-24 px-3 py-2">
                        Priority
                      </th>
                      {!scopeToUser && groupBy !== "responsible" ? (
                        <th scope="col" className="w-28 px-3 py-2">
                          Responsible
                        </th>
                      ) : null}
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
                    {group.tasks.map((t) => (
                      <TaskRow
                        key={t.task_id}
                        task={t}
                        today={today}
                        project={projectsById.get(t.project_id) ?? null}
                        canEdit={canEdit}
                        canDelete={canDelete}
                        showProject={groupBy !== "project"}
                        showResponsible={!scopeToUser && groupBy !== "responsible"}
                        onStatusChange={(s) => changeStatus(t, s)}
                        onPriorityChange={(p) => changePriority(t, p)}
                        onQuickComplete={() => quickComplete(t)}
                        onEdit={() => setEditTask(t)}
                        onDelete={() => deleteOne(t)}
                      />
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          ))
        )}
      </div>

      {/* Create / edit modals */}
      {showCreate ? (
        <TaskFormModal
          task={null}
          projects={projects}
          allTasks={tasks}
          defaultProjectId={defaultProjectId}
          defaultResponsible={defaultResponsible}
          responsibleOptions={responsibleOptions}
          onClose={() => setShowCreate(false)}
          onSaved={(t) => {
            applyCreated(t);
            setShowCreate(false);
          }}
        />
      ) : null}

      {editTask ? (
        <TaskFormModal
          task={editTask}
          projects={projects}
          allTasks={tasks}
          responsibleOptions={responsibleOptions}
          readOnly={!canEdit}
          onClose={() => setEditTask(null)}
          onSaved={(t) => {
            applyUpdated(t);
            setEditTask(null);
          }}
        />
      ) : null}

      {showApplyTemplate && templates ? (
        <ApplyTemplateModal
          projects={projects}
          templates={templates}
          defaultProjectId={defaultProjectId}
          onClose={() => setShowApplyTemplate(false)}
          onSubmit={async (projectId, templateId) => {
            try {
              await applyTemplateBatch(projectId, templateId);
              setShowApplyTemplate(false);
            } catch {
              /* error already surfaced via globalError */
            }
          }}
        />
      ) : null}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface TaskRowProps {
  task: Task;
  today: string;
  project: Project | null;
  canEdit: boolean;
  canDelete: boolean;
  showProject: boolean;
  showResponsible: boolean;
  onStatusChange: (status: TaskStatus) => void;
  onPriorityChange: (priority: Priority) => void;
  onQuickComplete: () => void;
  onEdit: () => void;
  onDelete: () => void;
}

function TaskRow({
  task,
  today,
  project,
  canEdit,
  canDelete,
  showProject,
  showResponsible,
  onStatusChange,
  onPriorityChange,
  onQuickComplete,
  onEdit,
  onDelete,
}: TaskRowProps) {
  const urgency = taskUrgency(task, today);
  return (
    <tr
      className={`${URGENCY_ROW_CLASS[urgency]} cursor-pointer`}
      onClick={() => onEdit()}
    >
      <td
        className={`whitespace-nowrap px-3 py-2 font-mono text-xs text-gray-700 ${URGENCY_ACCENT_CLASS[urgency]}`}
      >
        {task.task_id}
      </td>
      <td className="px-3 py-2">
        {/* Task name is no longer a separate clickable button — the
            whole row opens the edit pane. We keep it as plain text so
            row-click is the single, consistent affordance. */}
        <div className="font-medium text-gray-900">{task.task_name}</div>
        {task.blocked && task.blocker_issue_task ? (
          <p className="mt-0.5 text-xs text-red-700" title={task.blocker_issue_task}>
            ⚠ {truncate(task.blocker_issue_task, 60)}
          </p>
        ) : null}
      </td>
      {showProject ? (
        <td className="whitespace-nowrap px-3 py-2 text-xs text-gray-600">
          <span className="font-mono">{task.project_id}</span>
          {project ? (
            <p className="truncate text-gray-500" title={project.name}>
              {project.name}
            </p>
          ) : null}
        </td>
      ) : null}
      {/* Status cell — interactive, stop propagation so opening the
          dropdown doesn't also fire row-click. */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <select
            aria-label={`Status for ${task.task_id}`}
            value={task.status}
            onChange={(e) => onStatusChange(e.target.value as TaskStatus)}
            className={`rounded-md border-0 px-2 py-0.5 text-xs font-medium ${TASK_STATUS_BADGE[task.status]} focus:outline-none focus:ring-2 focus:ring-gray-900`}
          >
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TASK_STATUS_BADGE[task.status]}`}
          >
            {task.status}
          </span>
        )}
      </td>
      {/* Priority cell — same inline-edit pattern as Status. The
          select itself is colored as a chip via TASK_PRIORITY_BADGE,
          matching the read-only span when canEdit is false. */}
      <td className="px-3 py-2" onClick={(e) => e.stopPropagation()}>
        {canEdit ? (
          <select
            aria-label={`Priority for ${task.task_id}`}
            value={task.priority}
            onChange={(e) => onPriorityChange(e.target.value as Priority)}
            className={`rounded-md border-0 px-2 py-0.5 text-xs font-medium ${TASK_PRIORITY_BADGE[task.priority]} focus:outline-none focus:ring-2 focus:ring-gray-900`}
          >
            {TASK_PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {p}
              </option>
            ))}
          </select>
        ) : (
          <span
            className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TASK_PRIORITY_BADGE[task.priority]}`}
          >
            {task.priority}
          </span>
        )}
      </td>
      {showResponsible ? (
        <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
          {task.responsible || "—"}
        </td>
      ) : null}
      <td className="whitespace-nowrap px-3 py-2 text-sm text-gray-700">
        {task.target_date ?? "—"}
        {urgency !== "none" && urgency !== "on-track" ? (
          <p className="text-[10px] uppercase tracking-wider text-gray-500">
            {URGENCY_LABEL[urgency]}
          </p>
        ) : null}
      </td>
      {/* Estimate (hours). Right-aligned and tabular so multi-row
          scanning lines up — useful when planning a sprint and
          eyeballing total hours quickly. */}
      <td className="whitespace-nowrap px-3 py-2 text-right text-sm tabular-nums text-gray-700">
        {task.estimate_hours === null ? (
          <span className="text-gray-400">—</span>
        ) : (
          `${formatHours(task.estimate_hours)}h`
        )}
      </td>
      {/* Actions — stop propagation so the icon buttons fire their
          own handlers without the row's click-to-edit firing too. */}
      <td
        className="whitespace-nowrap px-3 py-2 text-right text-sm"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-end gap-1">
          {canEdit && task.status !== "Complete" && task.status !== "Canceled" ? (
            <button
              type="button"
              onClick={onQuickComplete}
              title="Mark complete"
              className="rounded p-1 text-emerald-700 hover:bg-emerald-50"
              aria-label={`Mark ${task.task_id} complete`}
            >
              ✓
            </button>
          ) : null}
          {canDelete ? (
            <button
              type="button"
              onClick={onDelete}
              title="Delete task"
              className="rounded p-1 text-gray-400 hover:bg-red-50 hover:text-red-700"
              aria-label={`Delete ${task.task_id}`}
            >
              ×
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}

function StatusGroupToggle({
  value,
  counts,
  onChange,
}: {
  value: StatusGroup;
  counts: Record<StatusGroup, number>;
  onChange: (next: StatusGroup) => void;
}) {
  const options: StatusGroup[] = ["open", "blocked", "past_due", "closed", "all"];
  return (
    <div
      style={{
        display: "inline-flex",
        border: "1px solid var(--border)",
        borderRadius: "var(--pol-radius)",
        background: "var(--card)",
        padding: 2,
      }}
    >
      {options.map((opt) => {
        const active = value === opt;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange(opt)}
            style={{
              padding: "3px 12px",
              border: "none",
              borderRadius: 2,
              fontSize: 12,
              fontWeight: 600,
              cursor: "pointer",
              background: active ? "var(--brand)" : "transparent",
              color: active ? "#fff" : "var(--t2)",
              transition: "background 0.1s, color 0.1s",
            }}
          >
            {STATUS_GROUP_LABEL[opt]}
            <span
              style={{
                marginLeft: 6,
                fontSize: 11,
                fontWeight: 600,
                opacity: 0.85,
              }}
            >
              {counts[opt]}
            </span>
          </button>
        );
      })}
    </div>
  );
}

function UrgencyLegend() {
  return (
    <div className="flex flex-wrap items-center gap-3 text-[11px] text-gray-600">
      <span className="font-semibold uppercase tracking-wider text-gray-500">
        Row color
      </span>
      <LegendChip color="bg-red-500" label="Blocked" />
      <LegendChip color="bg-orange-500" label="Past due" />
      <LegendChip color="bg-amber-400" label="Due this week" />
      <LegendChip color="bg-emerald-400" label="On track" />
    </div>
  );
}

function LegendChip({ color, label }: { color: string; label: string }) {
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={`inline-block h-2 w-2 rounded-full ${color}`} />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function groupKey(
  task: Task,
  by: GroupBy,
  projectsById: Map<string, Project>,
): string {
  if (by === "project") {
    const p = projectsById.get(task.project_id);
    // Use the project_id as the key so toggling group order doesn't
    // shuffle when two projects share a name; we fold the name back into
    // the visible header via `groupLabelDisplay`.
    return p ? task.project_id : task.project_id;
  }
  if (by === "responsible") return task.responsible || "Unassigned";
  if (by === "status") return task.status;
  if (by === "priority") return task.priority;
  return "All";
}

function groupLabelDisplay(
  key: string,
  by: GroupBy,
  projectsById: Map<string, Project>,
): string {
  if (by === "project") {
    const p = projectsById.get(key);
    return p ? `${key} · ${p.name}` : key;
  }
  return key;
}

function truncate(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

// `OPEN_TASK_STATUSES` referenced for type completeness; not used directly
// inside the table because `isOpenStatus` covers the predicate need.
void OPEN_TASK_STATUSES;

// ---------------------------------------------------------------------------
// Apply-template modal
// ---------------------------------------------------------------------------

/**
 * Two-pick modal: choose a project, choose a template. The template
 * picker filters by project type so we don't offer mismatched
 * options. If the user selects a project whose type has no matching
 * templates we surface an empty state with a link to manage them.
 *
 * Centered modal (not a drawer) since it's a one-off operation,
 * not a long-form edit. Submit fires the parent's `onSubmit` —
 * which in turn calls the service. Cancel just closes.
 */
function ApplyTemplateModal({
  projects,
  templates,
  defaultProjectId,
  onClose,
  onSubmit,
}: {
  projects: Project[];
  templates: TaskTemplate[];
  defaultProjectId?: string;
  onClose: () => void;
  onSubmit: (projectId: string, templateId: string) => Promise<void>;
}) {
  const [projectId, setProjectId] = useState(defaultProjectId ?? "");
  const [templateId, setTemplateId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // ESC closes; matches the form-modal convention.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape" && !busy) onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose, busy]);

  // Templates that match the selected project's type. When no
  // project is picked yet, we show all templates so the user can
  // see what's available — they'll get filtered down once they
  // pick. Reset templateId if the selection no longer matches.
  const selectedProject = projects.find((p) => p.project_id === projectId);
  const matchingTemplates = selectedProject
    ? templates.filter((t) => t.project_type === selectedProject.project_type)
    : templates;
  useEffect(() => {
    if (
      templateId &&
      !matchingTemplates.some((t) => t.template_id === templateId)
    ) {
      setTemplateId("");
    }
  }, [projectId, templateId, matchingTemplates]);

  const canSubmit = !busy && projectId !== "" && templateId !== "";

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    setError(null);
    setBusy(true);
    try {
      await onSubmit(projectId, templateId);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not apply template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-30 flex items-start justify-center overflow-y-auto p-4 sm:p-8"
      role="dialog"
      aria-modal="true"
      aria-labelledby="apply-template-title"
      style={{ background: "rgba(46, 46, 46, 0.4)" }}
    >
      <div
        className="absolute inset-0"
        onClick={() => !busy && onClose()}
        aria-hidden="true"
      />
      <form
        onSubmit={handleSubmit}
        className="relative my-auto w-full max-w-md"
        style={{
          background: "var(--card)",
          border: "1px solid var(--border)",
          borderRadius: "var(--pol-radius)",
          boxShadow: "0 8px 32px rgba(0,0,0,0.18)",
        }}
      >
        <header
          style={{
            display: "flex",
            alignItems: "flex-start",
            justifyContent: "space-between",
            borderBottom: "1px solid var(--border)",
            padding: "12px 16px",
          }}
        >
          <h2
            id="apply-template-title"
            style={{
              fontSize: "var(--fs-base)",
              fontWeight: 700,
              color: "var(--t1)",
            }}
          >
            Add tasks from a template
          </h2>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pol-modal-close"
            aria-label="Close"
          >
            ×
          </button>
        </header>

        <div className="space-y-4 px-6 py-5">
          {error ? (
            <div role="alert" className="pol-notice pol-notice-err">
              <span aria-hidden="true">!</span>
              <span>{error}</span>
            </div>
          ) : null}

          <p className="text-xs text-gray-600">
            Pick a project and a template — one task will be created per
            template item, assigned to the project lead.
          </p>

          <div>
            <label
              htmlFor="apply-tpl-project"
              className="block text-xs font-medium uppercase tracking-wider text-gray-700"
            >
              Project
              <span className="ml-0.5 text-red-600">*</span>
            </label>
            <select
              id="apply-tpl-project"
              value={projectId}
              onChange={(e) => setProjectId(e.target.value)}
              disabled={busy}
              className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
            >
              <option value="">— Select a project —</option>
              {projects.map((p) => (
                <option key={p.project_id} value={p.project_id}>
                  {p.project_id} — {p.name} ({p.project_type})
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="apply-tpl-template"
              className="block text-xs font-medium uppercase tracking-wider text-gray-700"
            >
              Template
              <span className="ml-0.5 text-red-600">*</span>
            </label>
            {matchingTemplates.length > 0 ? (
              <select
                id="apply-tpl-template"
                value={templateId}
                onChange={(e) => setTemplateId(e.target.value)}
                disabled={busy || !projectId}
                className="mt-1 block w-full rounded-md border border-gray-300 bg-white px-3 py-1.5 text-sm text-gray-900 shadow-sm focus:border-gray-900 focus:outline-none focus:ring-1 focus:ring-gray-900 disabled:cursor-not-allowed disabled:bg-gray-100"
              >
                <option value="">— Select a template —</option>
                {matchingTemplates.map((t) => (
                  <option key={t.template_id} value={t.template_id}>
                    {t.template_name} ({t.tasks.length} task
                    {t.tasks.length === 1 ? "" : "s"})
                  </option>
                ))}
              </select>
            ) : (
              <div
                id="apply-tpl-template"
                className="mt-1 rounded-md border border-dashed border-gray-300 px-3 py-2 text-xs text-gray-600"
              >
                No templates exist
                {selectedProject
                  ? ` for project type "${selectedProject.project_type}"`
                  : ""}
                .
              </div>
            )}
            {selectedProject && matchingTemplates.length > 0 ? (
              <p className="mt-1 text-[11px] text-gray-500">
                Filtered to templates matching project type{" "}
                <span className="font-medium text-gray-700">
                  {selectedProject.project_type}
                </span>
                .
              </p>
            ) : null}
          </div>
        </div>

        <footer
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 8,
            borderTop: "1px solid var(--border)",
            background: "var(--bg)",
            padding: "12px 16px",
          }}
        >
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="pol-btn pol-btn-secondary"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={!canSubmit}
            className="pol-btn pol-btn-primary"
          >
            {busy ? "Applying…" : "Apply template"}
          </button>
        </footer>
      </form>
    </div>
  );
}
