"use client";

/**
 * Task quick-view side panel.
 *
 * Tasks never had a read-only "quick view" — only the combined
 * create/edit `TaskFormModal`. This adds one, mirroring the shell of
 * `components/projects/quick-view.tsx` (slide-in panel from the right,
 * `role="dialog"`), so a `Mentioned` notification (or any other future
 * task deep-link) can open a lightweight preview instead of jumping
 * straight into edit mode.
 *
 * Two tabs: Details (read-only field summary) and Comments (reuses the
 * extracted `CommentsTab` — the same history view the form modal shows).
 * An "Edit" button hands off to the existing `TaskFormModal` for actual
 * editing, the same contract `ProjectQuickView` uses.
 */

import { useEffect, useState } from "react";

import { TASK_PRIORITY_BADGE, TASK_STATUS_BADGE } from "@/lib/tasks/display";
import type { Project, Task } from "@/lib/db";
import { CommentsTab } from "./comments-tab";

type Tab = "details" | "comments";

const TABS: { id: Tab; label: string }[] = [
  { id: "details", label: "Details" },
  { id: "comments", label: "Comments" },
];

export function TaskQuickView({
  task,
  project,
  canEdit,
  initialTab,
  onClose,
  onEdit,
}: {
  task: Task;
  project: Project | null;
  canEdit: boolean;
  /**
   * Which tab to open on mount. Used by the deep-link from a Mentioned
   * notification (`?tab=comments`) so the panel lands directly on the
   * tab where the mention was made. Defaults to "details".
   */
  initialTab?: Tab;
  onClose: () => void;
  onEdit: () => void;
}) {
  const [tab, setTab] = useState<Tab>(initialTab ?? "details");

  // Reset to the requested tab (or Details) when switching tasks, so the
  // user doesn't land on a stale tab after clicking a different row.
  useEffect(() => {
    setTab(initialTab ?? "details");
  }, [task.task_id, initialTab]);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-30 flex justify-end"
      role="dialog"
      aria-modal="true"
      aria-label={`Task ${task.task_id} details`}
    >
      <div
        className="absolute inset-0 bg-gray-900/30"
        onClick={onClose}
        aria-hidden="true"
      />
      <aside className="relative flex h-full w-full max-w-xl flex-col bg-white shadow-xl">
        <header className="flex items-start justify-between border-b border-gray-200 p-6">
          <div>
            <p className="font-mono text-xs font-medium text-gray-500">
              {task.task_id}
            </p>
            <h2 className="mt-1 text-xl font-semibold tracking-tight text-gray-900">
              {task.task_name}
            </h2>
            {project ? (
              <p className="mt-1 text-sm text-gray-600">
                {project.name} ({project.project_id})
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {canEdit ? (
              <button
                type="button"
                onClick={onEdit}
                className="pol-btn pol-btn-secondary"
              >
                Edit
              </button>
            ) : null}
            <button
              type="button"
              onClick={onClose}
              className="-m-2 rounded-md p-2 text-gray-400 hover:bg-gray-100 hover:text-gray-700"
              aria-label="Close"
            >
              <svg viewBox="0 0 20 20" className="h-5 w-5" aria-hidden="true">
                <path
                  d="M5 5l10 10M15 5L5 15"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                />
              </svg>
            </button>
          </div>
        </header>

        <nav
          className="flex flex-wrap gap-x-1 gap-y-0.5 border-b border-gray-200 px-6"
          role="tablist"
          aria-label="Task details"
        >
          {TABS.map((t) => {
            const active = tab === t.id;
            return (
              <button
                key={t.id}
                role="tab"
                type="button"
                aria-selected={active}
                aria-controls={`task-quickview-panel-${t.id}`}
                id={`task-quickview-tab-${t.id}`}
                onClick={() => setTab(t.id)}
                className={`-mb-px border-b-2 px-3 py-2 text-xs font-medium transition ${
                  active
                    ? "border-gray-900 text-gray-900"
                    : "border-transparent text-gray-500 hover:border-gray-300 hover:text-gray-700"
                }`}
              >
                {t.label}
              </button>
            );
          })}
        </nav>

        <div className="flex-1 overflow-y-auto px-6 py-5">
          {tab === "details" ? (
            <div
              role="tabpanel"
              id="task-quickview-panel-details"
              aria-labelledby="task-quickview-tab-details"
              className="space-y-4"
            >
              <DetailsTab task={task} />
            </div>
          ) : (
            <div
              role="tabpanel"
              id="task-quickview-panel-comments"
              aria-labelledby="task-quickview-tab-comments"
              className="space-y-4"
            >
              <CommentsTab task={task} />
            </div>
          )}
        </div>
      </aside>
    </div>
  );
}

function DetailsTab({ task }: { task: Task }) {
  return (
    <>
      <section className="flex flex-wrap items-center gap-2">
        <span
          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TASK_STATUS_BADGE[task.status]}`}
        >
          {task.status}
        </span>
        <span
          className={`inline-flex rounded-md px-2 py-0.5 text-xs font-medium ${TASK_PRIORITY_BADGE[task.priority]}`}
        >
          {task.priority}
        </span>
        {task.blocked ? (
          <span className="inline-flex rounded-md bg-red-100 px-2 py-0.5 text-xs font-medium text-red-800">
            Blocked
          </span>
        ) : null}
      </section>

      <section className="grid grid-cols-2 gap-3 text-sm">
        <Field label="Responsible" value={task.responsible || "—"} />
        <Field
          label="Additional assignees"
          value={
            task.additional_assignees.length > 0
              ? task.additional_assignees.join(", ")
              : "—"
          }
        />
        <Field label="Target date" value={task.target_date || "—"} />
        <Field
          label="Estimate"
          value={
            task.estimate_hours !== null ? `${task.estimate_hours}h` : "—"
          }
        />
      </section>

      {task.blocked ? (
        <section>
          <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
            Blocker details
          </p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
            {task.blocker_issue_task || "—"}
          </p>
        </section>
      ) : null}

      <section>
        <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
          Description
        </p>
        <p className="mt-1 whitespace-pre-wrap text-sm text-gray-700">
          {task.detailed_description || (
            <span className="text-gray-400">— no description —</span>
          )}
        </p>
      </section>
    </>
  );
}

function Field({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-xs font-medium uppercase tracking-wide text-gray-500">
        {label}
      </p>
      <p className="mt-0.5 text-sm text-gray-900">{value}</p>
    </div>
  );
}
