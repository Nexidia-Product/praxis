"use client";

/**
 * My Tasks page shell (Section 5.3).
 *
 * Hosts two interchangeable views of the signed-in user's tasks:
 *   - "List"      — the standard TasksTable (status tabs, filters, grouping).
 *   - "Checklist" — a manually-orderable, drag-to-reorder list of OPEN tasks
 *                   (MyTasksChecklist), persisted per-user.
 *
 * This component owns the canonical `tasks` state so both views stay in sync
 * within a session: TasksTable reports its edits back via `onTasksChange`,
 * and the checklist's complete/edit/create actions update the same state.
 * Only one view is mounted at a time; switching re-seeds the other from the
 * shared state.
 *
 * The checklist's manual order is saved to `/api/profile/my-tasks-order`
 * (a per-user array of task IDs) so it survives reloads and new days.
 */

import { useMemo, useState } from "react";

import { isOpenStatus } from "@/lib/tasks/display";
import type {
  Project,
  Task,
  TaskStatus,
  TaskTemplate,
  UserRole,
} from "@/lib/db";
import { TasksTable } from "./tasks-table";
import { MyTasksChecklist } from "./my-tasks-checklist";
import { TaskFormModal } from "./form-modal";

type Mode = "list" | "checklist";

interface MyTasksViewProps {
  initialTasks: Task[];
  projects: Project[];
  templates?: TaskTemplate[];
  currentUserRole: UserRole;
  permissions?: Record<string, boolean>;
  defaultResponsible?: string;
  activeUserNames?: string[];
  /** The user's saved checklist order (task IDs). */
  savedOrder: string[];
}

export function MyTasksView({
  initialTasks,
  projects,
  templates,
  currentUserRole,
  permissions,
  defaultResponsible,
  activeUserNames = [],
  savedOrder,
}: MyTasksViewProps) {
  const [mode, setMode] = useState<Mode>("list");
  const [tasks, setTasks] = useState<Task[]>(initialTasks);
  // Mirror of the persisted order; updated optimistically so a remount of the
  // checklist (on mode toggle) re-seeds from the latest arrangement.
  const [order, setOrder] = useState<string[]>(savedOrder);
  const [editTask, setEditTask] = useState<Task | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [error, setError] = useState<string | null>(null);

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

  const openTasks = useMemo(
    () => tasks.filter((t) => isOpenStatus(t.status)),
    [tasks],
  );

  // Responsible options for the checklist-mode form modal (TasksTable builds
  // its own internally for list mode). Union of active users + task-derived
  // names, case-insensitive dedup — same shape TasksTable uses.
  const responsibleOptions = useMemo(() => {
    const seen = new Map<string, string>();
    const add = (raw: string) => {
      const t = raw?.trim();
      if (!t) return;
      const k = t.toLowerCase();
      if (!seen.has(k)) seen.set(k, t);
    };
    for (const n of activeUserNames) add(n);
    for (const t of tasks) {
      add(t.responsible);
      for (const a of t.additional_assignees) add(a);
    }
    return Array.from(seen.values()).sort((a, b) =>
      a.localeCompare(b, undefined, { sensitivity: "base" }),
    );
  }, [tasks, activeUserNames]);

  function applyUpdated(updated: Task) {
    setTasks((prev) =>
      prev.map((t) => (t.task_id === updated.task_id ? updated : t)),
    );
  }
  function applyCreated(created: Task) {
    setTasks((prev) => [created, ...prev]);
  }

  async function completeTask(task: Task) {
    if (task.status === "Complete") return;
    const previous = tasks;
    const next: TaskStatus = "Complete";
    setTasks((prev) =>
      prev.map((t) => (t.task_id === task.task_id ? { ...t, status: next } : t)),
    );
    setError(null);
    const res = await fetch(`/api/tasks/${task.task_id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status: next }),
    });
    const data = (await res.json().catch(() => ({}))) as {
      task?: Task;
      error?: string;
    };
    if (!res.ok || !data.task) {
      setTasks(previous); // rollback
      setError(data.error ?? "Could not complete task.");
      return;
    }
    applyUpdated(data.task);
  }

  async function persistOrder(ids: string[]) {
    setOrder(ids); // optimistic; keep the user's arrangement even if save fails
    setError(null);
    const res = await fetch("/api/profile/my-tasks-order", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ order: ids }),
    });
    if (!res.ok) {
      const data = (await res.json().catch(() => ({}))) as { error?: string };
      setError(data.error ?? "Could not save your task order.");
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-3">
        <ModeToggle value={mode} onChange={setMode} />
        {mode === "checklist" && canCreate ? (
          <button
            type="button"
            onClick={() => setShowCreate(true)}
            className="pol-btn pol-btn-primary"
          >
            + New task
          </button>
        ) : null}
      </div>

      {mode === "checklist" ? (
        <p className="text-xs text-gray-500">
          Drag tasks into the order you want to work them. Your arrangement is
          saved automatically and kept for next time.
        </p>
      ) : null}

      {error ? (
        <div role="alert" className="pol-notice pol-notice-err">
          <span aria-hidden="true">!</span>
          <span>{error}</span>
        </div>
      ) : null}

      {mode === "list" ? (
        <TasksTable
          initialTasks={tasks}
          projects={projects}
          templates={templates}
          currentUserRole={currentUserRole}
          permissions={permissions}
          scopeToUser
          defaultResponsible={defaultResponsible}
          activeUserNames={activeUserNames}
          onTasksChange={setTasks}
        />
      ) : (
        <MyTasksChecklist
          tasks={openTasks}
          projects={projects}
          savedOrder={order}
          canEdit={canEdit}
          onReorder={persistOrder}
          onComplete={completeTask}
          onOpen={(t) => setEditTask(t)}
        />
      )}

      {/* Checklist-mode modals. List mode's TasksTable owns its own modal. */}
      {showCreate ? (
        <TaskFormModal
          task={null}
          projects={projects}
          allTasks={tasks}
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
    </div>
  );
}

function ModeToggle({
  value,
  onChange,
}: {
  value: Mode;
  onChange: (m: Mode) => void;
}) {
  const options: { id: Mode; label: string }[] = [
    { id: "list", label: "List" },
    { id: "checklist", label: "Checklist" },
  ];
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
        const active = value === opt.id;
        return (
          <button
            key={opt.id}
            type="button"
            onClick={() => onChange(opt.id)}
            style={{
              padding: "3px 14px",
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
            {opt.label}
          </button>
        );
      })}
    </div>
  );
}
